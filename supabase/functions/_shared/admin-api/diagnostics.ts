// Read-only diagnostics: every check the GPT needs to find broken content,
// each with remediation guidance. Nothing here writes.

import type { Client } from "./store.ts";
import { ODDS_TARGET, oddsTotal, checkOvr, unscaled, STAT_KEYS, tierKey } from "./decimal.ts";
import { EVO_OBJECTIVE_KEYS } from "./normalize.ts";

export interface Finding {
  code: string;
  entity_type: string;
  severity: "error" | "warning" | "info";
  message: string;
  entity_id?: string;
  label?: string;
  detail?: Record<string, unknown>;
  remediation: string;
}

const EVO_ORDER = ["emerald", "amethyst", "diamond", "pink diamond", "actolytrene", "game over"];

export interface DiagnosticsFilters {
  scope?: string;
  player_card_ids?: string[];
  codes?: string[];
  entity_types?: string[];
  release_slug?: string;
  label?: string;
  limit?: number;
  cursor?: string;
}

const MAX_PAGE = 200;

/**
 * Filtered, paged diagnostics. A broad read can produce thousands of findings,
 * which overflows the GPT response budget, so callers filter by scope, explicit
 * ids, codes or label, and page through the rest with an opaque cursor.
 */
export async function runDiagnostics(
  client: Client,
  filters: DiagnosticsFilters = {},
): Promise<Record<string, unknown>> {
  const full = await runDiagnosticsAll(client);
  const ids = new Set((filters.player_card_ids ?? []).map((v) => v.toLowerCase()));
  const codes = new Set((filters.codes ?? []).map((v) => v.toUpperCase()));
  const types = new Set((filters.entity_types ?? []).map((v) => v.toLowerCase()));
  const scope = filters.scope?.toLowerCase().replace(/s$/, "");
  const label = filters.label?.toLowerCase();
  const slug = filters.release_slug?.toLowerCase();

  let findings = full.findings;
  if (ids.size) findings = findings.filter((f) => f.entity_id && ids.has(f.entity_id.toLowerCase()));
  if (codes.size) findings = findings.filter((f) => codes.has(f.code));
  if (types.size) findings = findings.filter((f) => types.has(f.entity_type.toLowerCase()));
  if (scope) findings = findings.filter((f) => f.entity_type.toLowerCase().replace(/s$/, "") === scope);
  if (label) findings = findings.filter((f) => (f.label ?? "").toLowerCase().includes(label));
  if (slug) {
    findings = findings.filter((f) => JSON.stringify(f.detail ?? {}).toLowerCase().includes(slug) || (f.label ?? "").toLowerCase().includes(slug));
  }

  const total = findings.length;
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), MAX_PAGE);
  const offset = Number.parseInt(filters.cursor ?? "0", 10) || 0;
  const page = findings.slice(offset, offset + limit);
  const nextOffset = offset + page.length;
  const counts: Record<string, number> = {};
  for (const f of findings) counts[f.code] = (counts[f.code] ?? 0) + 1;

  return {
    ok: findings.every((f) => f.severity !== "error"),
    checked: full.checked,
    items: page,
    findings: page,
    counts,
    total_count: total,
    returned: page.length,
    next_cursor: nextOffset < total ? String(nextOffset) : null,
    truncated: nextOffset < total,
    applied_filters: {
      scope: filters.scope ?? null,
      player_card_ids: filters.player_card_ids ?? [],
      codes: filters.codes ?? [],
      entity_types: filters.entity_types ?? [],
      release_slug: filters.release_slug ?? null,
      label: filters.label ?? null,
      limit,
      cursor: filters.cursor ?? null,
    },
  };
}

async function runDiagnosticsAll(client: Client): Promise<{ ok: boolean; checked: string[]; findings: Finding[]; counts: Record<string, number> }> {
  const findings: Finding[] = [];
  const rows = async (table: string, select = "*") => {
    const { data } = await client.from(table).select(select).limit(5000);
    return (data ?? []) as Array<Record<string, any>>;
  };

  const [
    cards,
    tiers,
    teams,
    teamPlayers,
    packs,
    packPlayers,
    packOdds,
    collections,
    requirements,
    evoPaths,
    evoObjectives,
    evoVersions,
    roads,
    games,
    gamePlayers,
    challenges,
    codes,
    duos,
    runs,
    runPlayers,
    traits,
    badges,
    cardTraits,
    jobs,
    storylineEntities,
  ] = await Promise.all([
    rows("player_cards", "id,name,card_key,gem_tier_id,rating,status," + STAT_KEYS.join(",")),
    rows("gem_tiers", "id,name"),
    rows("teams", "id,name"),
    rows("team_players", "team_id,player_card_id,slot"),
    rows("packs", "id,name,cost,status"),
    rows("pack_players", "pack_id,player_card_id,slot"),
    rows("pack_odds", "pack_id,result_slot,percentage"),
    rows("collections", "id,name,status"),
    rows("collection_requirements", "collection_id,player_card_id,is_reward,sort_order"),
    rows("evo_paths", "id,player_card_id,step_order,from_tier_id,to_tier_id,tier_progression_override,status"),
    rows("evo_objectives", "id,evo_path_id,group_key,objective_type,stat_key,scope,target,sort_order"),
    rows("evo_card_versions", "id,evo_path_id,version_order,gem_tier_id,gem_name,rating"),

    rows("domination_roads", "id,name"),
    rows("domination_games", "id,road_id,game_order,opponent_name,pack_reward"),
    rows("domination_game_players", "domination_game_id,player_card_id"),
    rows("challenges", "id,name,challenge_type,pack_reward,spotlight_player_id,prerequisite_challenge_id,status"),
    rows("locker_codes", "id,code,reward_type,reward_payload,expires_at,is_active"),
    rows("dynamic_duos", "id,name,player_a_id,player_b_id"),
    rows("runs", "id,name,target_score"),
    rows("run_players", "run_id,player_card_id"),
    rows("signature_traits", "id,name"),
    rows("badges", "id,name"),
    rows("player_card_traits", "player_card_id,signature_trait_id,target_stat"),
    rows("admin_api_scheduled_jobs", "id,label,operation,payload_hash,run_at,status"),
    rows("storyline_entities", "storyline_id,entity_type,entity_id"),
  ]);

  const tierName = new Map(tiers.map((t) => [t.id, t.name]));
  const cardById = new Map(cards.map((c) => [c.id, c]));

  // ---- cards: OVR, tier, duplicates ---------------------------------------
  const byName = new Map<string, Array<Record<string, any>>>();
  for (const card of cards) {
    const key = String(card.name ?? "").trim().toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), card]);

    const statsPresent = STAT_KEYS.every((k) => card[k] !== null && card[k] !== undefined);
    if (!statsPresent) {
      findings.push({
        code: "INCOMPLETE_STATS",
        entity_type: "player_card",
        severity: "error",
        entity_id: card.id,
        label: card.name,
        message: "Card is missing one or more of the nine base stats.",
        remediation: "Send the full stat block for this card_id through /admin-api/v1/player/preview.",
      });
      continue;
    }
    const tier = tierName.get(card.gem_tier_id);
    const check = checkOvr(card, tier, card.rating);
    if (!check.ok) {
      findings.push({
        code: check.code ?? "OVR_INVALID",
        entity_type: "player_card",
        severity: "error",
        entity_id: card.id,
        label: card.name,
        message: `Computed OVR ${check.computed} vs stored ${card.rating} / tier ${tier ?? "none"}.`,
        detail: { computed: check.computed, stored_rating: card.rating, tier, expected: check.expected, offenders: check.offenders },
        remediation: "Either correct the stats or explicitly change the gem tier; the API never auto-corrects tiers.",
      });
    }
  }
  for (const [name, list] of byName) {
    if (list.length > 1) {
      findings.push({
        code: "DUPLICATE_PLAYER_NAME",
        entity_type: "player_card",
        severity: "warning",
        label: name,
        message: `${list.length} cards share this display name; name-based references are ambiguous.`,
        detail: { matches: list.map((c) => ({ id: c.id, card_key: c.card_key })) },
        remediation: "Reference these cards by player_card_id, or give them distinct card_key values.",
      });
    }
  }

  // ---- collections ---------------------------------------------------------
  for (const collection of collections) {
    const members = requirements.filter((r) => r.collection_id === collection.id);
    if (!members.length) {
      findings.push({
        code: "EMPTY_COLLECTION",
        entity_type: "collection",
        severity: "warning",
        entity_id: collection.id,
        label: collection.name,
        message: "Collection has no membership requirements.",
        remediation: "Send player_cards[] for this collection_id to define ordered membership.",
      });
    }
    const rewards = members.filter((m) => m.is_reward);
    if (rewards.length > 1) {
      findings.push({
        code: "MULTIPLE_COLLECTION_REWARDS",
        entity_type: "collection",
        severity: "error",
        entity_id: collection.id,
        label: collection.name,
        message: `${rewards.length} reward cards are flagged.`,
        remediation: "Exactly one membership entry may set is_reward.",
      });
    }
    for (const member of members) {
      if (!cardById.has(member.player_card_id)) {
        findings.push({
          code: "BROKEN_COLLECTION_LINK",
          entity_type: "collection",
          severity: "error",
          entity_id: collection.id,
          label: collection.name,
          message: `Membership points at missing card ${member.player_card_id}.`,
          remediation: "Remove the membership row or restore the referenced card.",
        });
      }
    }
    const rewardIds = new Set(rewards.map((r) => r.player_card_id));
    for (const pool of packPlayers) {
      if (rewardIds.has(pool.player_card_id)) {
        findings.push({
          code: "REWARD_IN_PACK_POOL",
          entity_type: "pack",
          severity: "error",
          entity_id: pool.pack_id,
          message: `Collection reward card ${pool.player_card_id} also sits in a pack pool.`,
          remediation: "Remove the reward card from the pack pool so it stays exclusive to collection completion.",
        });
      }
    }
  }

  // ---- packs ---------------------------------------------------------------
  for (const pack of packs) {
    const pool = packPlayers.filter((p) => p.pack_id === pack.id);
    const odds = packOdds.filter((o) => o.pack_id === pack.id);
    if (!pool.length) {
      findings.push({
        code: "PACK_WITHOUT_POOL",
        entity_type: "pack",
        severity: "error",
        entity_id: pack.id,
        label: pack.name,
        message: "Pack has no player pool.",
        remediation: "Send players[] (ordered) for this pack_id.",
      });
    }
    if (!odds.length) {
      findings.push({
        code: "PACK_WITHOUT_ODDS",
        entity_type: "pack",
        severity: "error",
        entity_id: pack.id,
        label: pack.name,
        message: "Pack has no odds table.",
        remediation: "Send odds[] totalling exactly 100.00 for this pack_id.",
      });
    } else {
      let total = 0;
      try {
        total = oddsTotal(odds as Array<{ percentage: number }>);
      } catch {
        total = -1;
      }
      if (total !== ODDS_TARGET) {
        findings.push({
          code: "ODDS_TOTAL",
          entity_type: "pack",
          severity: "error",
          entity_id: pack.id,
          label: pack.name,
          message: `Odds total ${total < 0 ? "unparseable" : unscaled(total)}%, not 100.00%.`,
          remediation: "Resend the full odds table with fixed-precision percentages summing to 100.00.",
        });
      }
      const slots = new Set(pool.map((p) => String(p.slot)));
      for (const row of odds) {
        const slot = String(row.result_slot);
        if (slot !== "player_choice" && !slots.has(slot)) {
          findings.push({
            code: "INVALID_ODDS_SLOT",
            entity_type: "pack",
            severity: "error",
            entity_id: pack.id,
            label: pack.name,
            message: `Odds row targets slot ${slot}, which is not in the pool.`,
            remediation: "Resend pool and odds together so slot numbers line up.",
          });
        }
      }
    }
  }

  // ---- teams / runs / domination ------------------------------------------
  for (const team of teams) {
    const roster = teamPlayers.filter((r) => r.team_id === team.id);
    if (roster.length === 0) {
      findings.push({
        code: "TEAM_WITHOUT_ROSTER",
        entity_type: "team",
        severity: "warning",
        entity_id: team.id,
        label: team.name,
        message: "Team has no roster.",
        remediation: "Send roster[] for this team_id.",
      });
    }
    const seen = new Set<string>();
    for (const slot of roster) {
      if (seen.has(slot.player_card_id)) {
        findings.push({
          code: "DUPLICATE_ROSTER_PLAYER",
          entity_type: "team",
          severity: "error",
          entity_id: team.id,
          label: team.name,
          message: `Card ${slot.player_card_id} appears twice on the roster.`,
          remediation: "Resend roster[] with unique cards.",
        });
      }
      seen.add(slot.player_card_id);
      if (!cardById.has(slot.player_card_id)) {
        findings.push({
          code: "BROKEN_ROSTER_LINK",
          entity_type: "team",
          severity: "error",
          entity_id: team.id,
          label: team.name,
          message: `Roster references missing card ${slot.player_card_id}.`,
          remediation: "Resend the roster without the deleted card.",
        });
      }
    }
  }
  for (const run of runs) {
    if (!runPlayers.some((r) => r.run_id === run.id)) {
      findings.push({
        code: "RUN_WITHOUT_ROSTER",
        entity_type: "run",
        severity: "error",
        entity_id: run.id,
        label: run.name,
        message: "Run has no opponent roster.",
        remediation: "Send roster[] for this run_id.",
      });
    }
  }
  const orderSeen = new Map<string, Set<number>>();
  const packIds = new Set(packs.map((p) => p.id));
  const packNames = new Set(packs.map((p) => String(p.name).toLowerCase()));
  for (const game of games) {
    if (!gamePlayers.some((g) => g.domination_game_id === game.id)) {
      findings.push({
        code: "DOMINATION_GAME_WITHOUT_ROSTER",
        entity_type: "domination_game",
        severity: "error",
        entity_id: game.id,
        label: `${game.opponent_name} (order ${game.game_order})`,
        message: "Domination game has no roster.",
        remediation: "Send roster[] for this domination_game_id.",
      });
    }
    const set = orderSeen.get(game.road_id) ?? new Set<number>();
    if (set.has(game.game_order)) {
      findings.push({
        code: "DUPLICATE_GAME_ORDER",
        entity_type: "domination_game",
        severity: "error",
        entity_id: game.id,
        message: `Two games share order ${game.game_order} on road ${game.road_id}.`,
        remediation: "Reindex the road with a replace-mode road payload.",
      });
    }
    set.add(game.game_order);
    orderSeen.set(game.road_id, set);
    if (game.pack_reward && !packIds.has(game.pack_reward) && !packNames.has(String(game.pack_reward).toLowerCase())) {
      findings.push({
        code: "MISSING_PACK_REWARD",
        entity_type: "domination_game",
        severity: "error",
        entity_id: game.id,
        message: `pack_reward "${game.pack_reward}" does not resolve to a pack.`,
        remediation: "Set pack_reward to an existing pack_id.",
      });
    }
  }
  for (const road of roads) {
    if (!games.some((g) => g.road_id === road.id)) {
      findings.push({
        code: "EMPTY_ROAD",
        entity_type: "domination_road",
        severity: "warning",
        entity_id: road.id,
        label: road.name,
        message: "Road has no games.",
        remediation: "Import games with /admin-api/v1/domination-road/preview.",
      });
    }
  }

  // ---- evo ----------------------------------------------------------------
  for (const path of evoPaths) {
    if (!cardById.has(path.player_card_id)) {
      findings.push({
        code: "BROKEN_EVO_SOURCE",
        entity_type: "evo_path",
        severity: "error",
        entity_id: path.id,
        message: `Evo path source card ${path.player_card_id} no longer exists.`,
        remediation: "Delete the path or repoint it at an existing player_card_id.",
      });
      continue;
    }
    const label = `${cardById.get(path.player_card_id)?.name ?? "?"} step ${path.step_order ?? 1}`;
    const versions = evoVersions
      .filter((v) => v.evo_path_id === path.id)
      .sort((a, b) => (a.version_order ?? 0) - (b.version_order ?? 0));
    const objectives = evoObjectives.filter((o) => o.evo_path_id === path.id);

    if (!objectives.length) {
      findings.push({
        code: "EVO_MISSING_OBJECTIVES",
        entity_type: "evo_path",
        severity: "error",
        entity_id: path.id,
        label,
        message: "Evo step has no objectives, so it can never be completed in game.",
        remediation: "Resend the path with objectives[] through /admin-api/v1/content-release/preview.",
      });
    }
    if (!versions.length) {
      findings.push({
        code: "EVO_MISSING_VERSION",
        entity_type: "evo_path",
        severity: "error",
        entity_id: path.id,
        label,
        message: "Evo step has no playable resulting version, so the reward card state is undefined.",
        remediation: "Resend the path with resulting_version on every step.",
      });
    }
    for (const objective of objectives) {
      const key = String(objective.stat_key ?? objective.objective_type ?? "");
      if (!EVO_OBJECTIVE_KEYS.includes(key) && !EVO_OBJECTIVE_KEYS.includes(String(objective.objective_type ?? ""))) {
        findings.push({
          code: "UNSUPPORTED_EVO_OBJECTIVE",
          entity_type: "evo_objective",
          severity: "error",
          entity_id: objective.id,
          label,
          message: `"${objective.objective_type}${objective.stat_key ? `/${objective.stat_key}` : ""}" is not a supported objective.`,
          detail: { supported: EVO_OBJECTIVE_KEYS },
          remediation: "Use one of the supported objective types/statistics.",
        });
      }
      if (objective.target === null || Number(objective.target) <= 0) {
        findings.push({
          code: "INVALID_EVO_TARGET",
          entity_type: "evo_objective",
          severity: "error",
          entity_id: objective.id,
          label,
          message: "Objective target must be greater than zero.",
          remediation: "Send a positive target for every objective.",
        });
      }
    }

    // tier progression: each step must advance exactly one tier
    const from = tierKey(tierName.get(path.from_tier_id) ?? tierName.get(cardById.get(path.player_card_id)?.gem_tier_id));
    const to = tierKey(tierName.get(path.to_tier_id));
    const fromIndex = EVO_ORDER.indexOf(from);
    const toIndex = EVO_ORDER.indexOf(to);
    if (fromIndex >= 0 && toIndex >= 0 && toIndex !== fromIndex + 1 && !path.tier_progression_override) {
      findings.push({
        code: "EVO_TIER_SKIP",
        entity_type: "evo_path",
        severity: "error",
        entity_id: path.id,
        label,
        message: `Step moves ${from} -> ${to}, which is not a single-tier advance.`,
        remediation: "Rebuild the path so each step advances exactly one tier, or set tier_progression_override.",
      });
    }
    for (const version of versions) {
      if (version.gem_tier_id && path.to_tier_id && version.gem_tier_id !== path.to_tier_id) {
        findings.push({
          code: "EVO_VERSION_TIER_MISMATCH",
          entity_type: "evo_card_version",
          severity: "error",
          entity_id: version.id,
          label,
          message: "Playable version tier does not match the step's target tier.",
          remediation: "Set the version gem tier to the step's to_tier.",
        });
      }
    }
  }

  const traitIds = new Set(traits.map((t) => t.id));
  for (const assignment of cardTraits) {
    if (!traitIds.has(assignment.signature_trait_id)) {
      findings.push({
        code: "MISSING_TRAIT_DEFINITION",
        entity_type: "player_card_trait",
        severity: "error",
        message: `Assignment references unknown trait ${assignment.signature_trait_id}.`,
        remediation: "Create the trait definition or resend the card's traits[].",
      });
    }
    if (assignment.target_stat && !STAT_KEYS.includes(assignment.target_stat)) {
      findings.push({
        code: "INVALID_TRAIT_TARGET_STAT",
        entity_type: "player_card_trait",
        severity: "error",
        message: `target_stat "${assignment.target_stat}" is not one of the nine base stats.`,
        detail: { supported: STAT_KEYS },
        remediation: "Set target_stat to a stat_* key.",
      });
    }
  }

  // ---- challenges / codes / duos / storylines / schedule ------------------
  const challengeIds = new Set(challenges.map((c) => c.id));
  for (const challenge of challenges) {
    if (challenge.prerequisite_challenge_id && !challengeIds.has(challenge.prerequisite_challenge_id)) {
      findings.push({
        code: "BROKEN_CHALLENGE_REFERENCE",
        entity_type: "challenge",
        severity: "error",
        entity_id: challenge.id,
        label: challenge.name,
        message: "Prerequisite challenge does not exist.",
        remediation: "Point prerequisite_challenge at an existing challenge_id.",
      });
    }
    if (challenge.spotlight_player_id && !cardById.has(challenge.spotlight_player_id)) {
      findings.push({
        code: "BROKEN_CHALLENGE_REFERENCE",
        entity_type: "challenge",
        severity: "error",
        entity_id: challenge.id,
        label: challenge.name,
        message: "Spotlight player card does not exist.",
        remediation: "Repoint spotlight_player at an existing player_card_id.",
      });
    }
  }
  const codeSeen = new Set<string>();
  for (const code of codes) {
    const key = String(code.code).trim().toUpperCase();
    if (codeSeen.has(key)) {
      findings.push({
        code: "DUPLICATE_LOCKER_CODE",
        entity_type: "locker_code",
        severity: "error",
        entity_id: code.id,
        label: key,
        message: "Duplicate locker code.",
        remediation: "Delete or rename one of the duplicates.",
      });
    }
    codeSeen.add(key);
    if (!code.reward_type || code.reward_payload === null) {
      findings.push({
        code: "INVALID_LOCKER_REWARD",
        entity_type: "locker_code",
        severity: "error",
        entity_id: code.id,
        label: key,
        message: "Locker code has no usable reward definition.",
        remediation: "Set reward_type and reward_payload.",
      });
    }
    if (code.is_active && code.expires_at && new Date(code.expires_at) < new Date()) {
      findings.push({
        code: "EXPIRED_ACTIVE_CONTENT",
        entity_type: "locker_code",
        severity: "warning",
        entity_id: code.id,
        label: key,
        message: "Code is active but already expired.",
        remediation: "Deactivate the code or extend expires_at.",
      });
    }
  }
  for (const duo of duos) {
    if (duo.player_a_id && duo.player_a_id === duo.player_b_id) {
      findings.push({
        code: "DUO_SAME_PLAYER",
        entity_type: "dynamic_duo",
        severity: "error",
        entity_id: duo.id,
        label: duo.name,
        message: "Both duo sides use the same card.",
        remediation: "Assign two different player_card_ids.",
      });
    }
    for (const side of ["player_a_id", "player_b_id"]) {
      if (duo[side] && !cardById.has(duo[side])) {
        findings.push({
          code: "BROKEN_DUO_REFERENCE",
          entity_type: "dynamic_duo",
          severity: "error",
          entity_id: duo.id,
          label: duo.name,
          message: `${side} points at a missing card.`,
          remediation: "Repoint the duo at existing cards.",
        });
      }
    }
  }
  for (const link of storylineEntities) {
    if (link.entity_type === "player_card" && !cardById.has(link.entity_id)) {
      findings.push({
        code: "ORPHANED_STORYLINE_ENTITY",
        entity_type: "storyline_entity",
        severity: "warning",
        entity_id: link.storyline_id,
        message: `Storyline links a missing player card ${link.entity_id}.`,
        remediation: "Remove the link or restore the card.",
      });
    }
  }
  for (const job of jobs) {
    if (job.status === "scheduled" && new Date(job.run_at) < new Date(Date.now() - 60 * 60_000)) {
      findings.push({
        code: "STALE_SCHEDULED_JOB",
        entity_type: "scheduled_job",
        severity: "warning",
        entity_id: job.id,
        label: job.label ?? job.operation,
        message: "Scheduled job is more than an hour overdue and has not executed.",
        remediation: "Check the scheduler, or cancel and re-preview the job.",
      });
    }
  }

  const counts: Record<string, number> = {};
  for (const f of findings) counts[f.code] = (counts[f.code] ?? 0) + 1;

  return {
    ok: findings.every((f) => f.severity !== "error"),
    checked: [
      "player stats/OVR/tier bands",
      "duplicate names and ambiguous references",
      "collections, membership, rewards, reward-in-pack contamination",
      "packs, pools, odds precision and slots",
      "teams, runs and domination rosters",
      "domination game ordering and pack rewards",
      "evo sources, tier progression, objectives and playable versions",
      "badge/trait definitions and trait target stats",
      "challenges, locker codes, dynamic duos, storyline links",
      "scheduled job freshness",
    ],
    findings,
    counts,
  };
}
