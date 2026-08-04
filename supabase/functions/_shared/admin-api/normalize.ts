// Canonical normalizer + validator + planner for the versioned bulk admin API.
//
// One implementation, used by BOTH preview and commit and by both the bulk and
// the single-entity endpoints. Single-entity endpoints simply wrap their item in
// the matching group array, so no schema can drift between the two shapes.

import { apiError, apiWarning, type AdminApiError, type AdminApiWarning } from "./errors.ts";
import { canonicalize, compact } from "./canonical.ts";
import {
  checkOvr,
  oddsTotal,
  ODDS_TARGET,
  unscaled,
  scaled,
  STAT_KEYS,
  RUN_STAT_KEYS,
  tierKey,
  bandFor,
  bandLabel,
  GEM_TIER_ORDER,
  OVR_TOLERANCE,
} from "./decimal.ts";
import { normalizeRef, hasTarget, isUuid } from "./refs.ts";

/** Groups understood by public.admin_apply_batch, in dependency order. */
export const GROUPS = [
  "gem_tiers",
  "badges",
  "signature_traits",
  "collections",
  "sub_collections",
  "teams",
  "players",
  "packs",
  "collection_requirements",
  "evo_paths",
  "gem_tasks",
  "runs",
  "domination_roads",
  "domination_games",
  "challenges",
  "locker_codes",
  "dynamic_duos",
  "storylines",
  "location_accounts",
  "social_posts",
  "release_bundles",
] as const;
export type Group = (typeof GROUPS)[number];

export const PASSTHROUGH_KEYS = ["notes", "release", "expected_counts"] as const;

/** Single-entity endpoint name -> bulk group. Guarantees singular/bulk parity. */
export const ENTITY_TO_GROUP: Record<string, Group> = {
  player: "players",
  players: "players",
  "player-card": "players",
  team: "teams",
  teams: "teams",
  pack: "packs",
  packs: "packs",
  collection: "collections",
  collections: "collections",
  "sub-collection": "sub_collections",
  "sub-collections": "sub_collections",
  badge: "badges",
  badges: "badges",
  trait: "signature_traits",
  traits: "signature_traits",
  "gem-tier": "gem_tiers",
  "gem-tiers": "gem_tiers",
  "gem-task": "gem_tasks",
  "gem-tasks": "gem_tasks",
  "evo-path": "evo_paths",
  "evo-paths": "evo_paths",
  run: "runs",
  runs: "runs",
  "domination-road": "domination_roads",
  "domination-roads": "domination_roads",
  "domination-game": "domination_games",
  "domination-games": "domination_games",
  challenge: "challenges",
  challenges: "challenges",
  "locker-code": "locker_codes",
  "locker-codes": "locker_codes",
  "dynamic-duo": "dynamic_duos",
  "dynamic-duos": "dynamic_duos",
  storyline: "storylines",
  storylines: "storylines",
  "location-account": "location_accounts",
  "location-accounts": "location_accounts",
  "social-post": "social_posts",
  "social-posts": "social_posts",
};

/** Player-ref bearing array fields per group, used for alias normalization. */
const PLAYER_LISTS: Partial<Record<Group, string[]>> = {
  teams: ["roster"],
  packs: ["players", "pool"],
  runs: ["roster"],
  domination_games: ["roster"],
  collections: ["player_cards", "members", "requirements"],
  sub_collections: ["player_cards", "members", "requirements"],
  dynamic_duos: ["players"],
  storylines: ["players"],
};

export interface NormalizeResult {
  canonical: Record<string, unknown>;
  errors: AdminApiError[];
  warnings: AdminApiWarning[];
  plan: {
    groups: Array<{ group: string; items: number }>;
    entity_count: number;
    destructive: AdminApiWarning[];
  };
}

/** Continuous evolution tier progression, including the Game Over tier. */
const EVO_TIER_ORDER = GEM_TIER_ORDER;

/** Badge / signature-trait assignment tiers. */
const ASSIGNMENT_TIERS = ["base", "gold", "hof", "diamond", "actolytrene"];

/** Every mutable player-card field the bulk API accepts. */
export const PLAYER_FIELDS = [
  "player_card_id",
  "card_key",
  "temp_ref",
  "client_ref",
  "name",
  "player_name",
  "new_name",
  "gem_tier",
  "gem_name",
  "tier",
  "position1",
  "position2",
  "rating",
  "ovr",
  "run_rating",
  "stats",
  "run_stats",
  ...STAT_KEYS,
  ...RUN_STAT_KEYS,
  "market_value",
  "social_handle",
  "avatar_url",
  "is_collection_reward",
  "card_color_primary",
  "card_color_secondary",
  "card_glow_color",
  "card_animation",
  "collection",
  "sub_collection",
  "team",
  "status",
  "evo_stage",
  "badges",
  "traits",
] as const;

const PLAYER_FIELD_SET = new Set<string>(PLAYER_FIELDS as unknown as string[]);

export const EVO_OBJECTIVE_KEYS = [
  "points",
  "three_pointers_made",
  "mid_range_shots_made",
  "dunks_made",
  "assists",
  "steals",
  "rebounds",
  "blocks",
  "games_won",
];

/** Normalizes, validates and plans a bulk document. Never touches the database. */
export function normalizeDocument(input: Record<string, unknown>): NormalizeResult {
  const errors: AdminApiError[] = [];
  const warnings: AdminApiWarning[] = [];
  const destructive: AdminApiWarning[] = [];
  const canonical: Record<string, unknown> = {};
  const groupsPlan: Array<{ group: string; items: number }> = [];
  let entityCount = 0;

  for (const key of Object.keys(input)) {
    if (!GROUPS.includes(key as Group) && !PASSTHROUGH_KEYS.includes(key as never)) {
      errors.push(
        apiError("UNKNOWN_GROUP", `"${key}" is not a supported group.`, {
          path: key,
          expected: GROUPS,
          remediation: "Use GET /admin-api/v1/capabilities for the supported group list.",
        }),
      );
    }
  }
  for (const key of PASSTHROUGH_KEYS) {
    if (input[key] !== undefined) canonical[key] = input[key];
  }

  for (const group of GROUPS) {
    const raw = input[group];
    if (raw === undefined || raw === null) continue;
    if (!Array.isArray(raw)) {
      errors.push(
        apiError("INVALID_GROUP", `"${group}" must be an array of items.`, {
          path: group,
          expected: "array",
          received: typeof raw,
        }),
      );
      continue;
    }
    const items = raw.map((item, index) => normalizeItem(group, item as Record<string, unknown>, `${group}[${index}]`, errors, warnings, destructive));
    canonical[group] = items;
    groupsPlan.push({ group, items: items.length });
    entityCount += items.length;
  }

  return {
    canonical: canonicalize(canonical) as Record<string, unknown>,
    errors,
    warnings,
    plan: { groups: groupsPlan, entity_count: entityCount, destructive },
  };
}

function normalizeItem(
  group: Group,
  item: Record<string, unknown>,
  path: string,
  errors: AdminApiError[],
  warnings: AdminApiWarning[],
  destructive: AdminApiWarning[],
): Record<string, unknown> {
  if (!item || typeof item !== "object") {
    errors.push(apiError("INVALID_ITEM", `${path} must be an object.`, { path }));
    return {};
  }
  let out: Record<string, unknown> = { ...item };

  // ---- canonical references -------------------------------------------------
  const refKind =
    group === "players" || group === "evo_paths"
      ? "player"
      : group === "teams"
        ? "team"
        : group === "collections"
          ? "collection"
          : group === "packs"
            ? "pack"
            : group === "domination_roads" || group === "domination_games"
              ? "road"
              : group === "runs"
                ? "run"
                : group === "challenges"
                  ? "challenge"
                  : null;
  if (refKind) {
    const { fields, warnings: refWarnings } = normalizeRef(refKind, out, path);
    out = fields;
    warnings.push(...refWarnings);
  }
  // players/evo paths keep `name` as the mutable display name; restore it.
  if ((group === "players" || group === "gem_tiers" || group === "badges" || group === "signature_traits") && out.player_name && !out.name) {
    out.name = out.player_name;
    delete out.player_name;
  }
  if (group === "evo_paths" && out.name && !out.player_name) {
    out.player_name = out.name;
    delete out.name;
  }

  for (const listField of PLAYER_LISTS[group] ?? []) {
    const list = out[listField];
    if (!Array.isArray(list)) continue;
    out[listField] = list.map((entry, i) => {
      const asObject = typeof entry === "string"
        ? isUuid(entry)
          ? { player_card_id: entry }
          : { player_name: entry }
        : (entry as Record<string, unknown>);
      const { fields, warnings: w } = normalizeRef("player", asObject, `${path}.${listField}[${i}]`);
      warnings.push(...w);
      if (!hasTarget("player", fields)) {
        errors.push(
          apiError("UNRESOLVED_REFERENCE", "No player target given for this entry.", {
            path: `${path}.${listField}[${i}]`,
            entity_type: "player_card",
            expected: "player_card_id, card_key, player_name or client_ref",
          }),
        );
      }
      return compact(fields);
    });
    destructive.push(
      apiWarning("REPLACEMENT", `${path}.${listField} replaces the entire existing list (${(out[listField] as unknown[]).length} entries).`, {
        severity: "destructive",
        path: `${path}.${listField}`,
        remediation: "Omit the field to leave the current list untouched; send [] to clear it.",
      }),
    );
  }

  // ---- per-group validation -------------------------------------------------
  if (group === "players") validatePlayer(out, path, errors, warnings, destructive);
  if (group === "packs") validatePack(out, path, errors, destructive);
  if (group === "collections" || group === "sub_collections") validateCollection(out, path, errors);
  if (group === "evo_paths") validateEvoPath(out, path, errors, warnings);
  if (group === "dynamic_duos") validateDuo(out, path, errors);
  if (group === "locker_codes" && typeof out.code === "string") out.code = out.code.trim().toUpperCase();
  if (group === "runs" && Array.isArray(out.rank_rewards)) {
    destructive.push(
      apiWarning("GLOBAL_LADDER_REPLACEMENT", "rank_rewards is a GLOBAL ladder shared by every Run; sending it replaces the whole ladder.", {
        severity: "destructive",
        path: `${path}.rank_rewards`,
        remediation: "Omit rank_rewards to change only this Run.",
      }),
    );
  }
  if (group === "domination_games" && out.game_order === undefined && !out.domination_game_id) {
    errors.push(
      apiError("MISSING_GAME_TARGET", "Domination games must be targeted by domination_game_id or road + game_order.", {
        path,
        entity_type: "domination_game",
        remediation: "Opponents repeat on a road, so opponent_name alone is never a valid target.",
      }),
    );
  }
  if (group === "domination_roads" && String(out.mode ?? "").toLowerCase() === "replace") {
    destructive.push(
      apiWarning("ROAD_REPLACE", "mode='replace' deletes every game on the road that is not listed in this payload.", {
        severity: "destructive",
        path: `${path}.mode`,
        remediation: "Use mode='merge' to keep unlisted games.",
      }),
    );
  }

  return compact(out);
}

function statBlock(item: Record<string, unknown>): Record<string, unknown> {
  const nested = (item.stats ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of STAT_KEYS) {
    const v = item[key] ?? nested[key];
    if (v !== undefined) out[key] = v;
  }
  return out;
}

function validatePlayer(
  item: Record<string, unknown>,
  path: string,
  errors: AdminApiError[],
  warnings: AdminApiWarning[],
  destructive: AdminApiWarning[],
) {
  const stats = statBlock(item);
  const tier = item.gem_tier ?? item.gem_name ?? item.tier;
  const rating = item.rating ?? item.ovr;

  for (const [key, value] of Object.entries(stats)) {
    let units: number;
    try {
      units = scaled(value as number, 2);
    } catch {
      errors.push(apiError("NOT_A_NUMBER", `${key} must be numeric.`, { path: `${path}.${key}`, received: value }));
      continue;
    }
    if (units < 0 || units > 9900) {
      errors.push(
        apiError("STAT_OUT_OF_RANGE", `${key} must be between 0 and 99.`, {
          path: `${path}.${key}`,
          expected: "0 through 99",
          received: value,
        }),
      );
    }
  }

  if (Object.keys(stats).length === STAT_KEYS.length) {
    const check = checkOvr(stats, tier, rating);
    if (!check.ok && check.code === "OVR_TIER_MISMATCH") {
      errors.push(
        apiError("OVR_TIER_MISMATCH", `Calculated OVR ${check.computed} does not fit ${String(tier)}.`, {
          path: `${path}.rating`,
          entity_type: "player_card",
          entity_id: item.player_card_id as string | undefined,
          input_ref: item.name as string | undefined,
          expected: check.expected,
          received: check.computed,
          remediation: `Adjust ${(check.offenders ?? []).join(", ")} or request a different gem tier explicitly.`,
        }),
      );
    } else if (!check.ok && check.code === "OVR_RATING_MISMATCH") {
      errors.push(
        apiError("OVR_RATING_MISMATCH", `Stored rating does not match the stat average (${check.computed}).`, {
          path: `${path}.rating`,
          entity_type: "player_card",
          expected: check.computed,
          received: check.received,
          remediation: "Send rating equal to the mean of the nine base stats, or omit rating so it is derived.",
        }),
      );
    } else if (!check.ok && check.code === "UNKNOWN_GEM_TIER") {
      errors.push(
        apiError("UNKNOWN_GEM_TIER", `"${String(tier)}" is not a known gem tier.`, {
          path: `${path}.gem_tier`,
          expected: EVO_TIER_ORDER,
          received: tier,
        }),
      );
    } else if (check.ok && check.computed && rating === undefined) {
      item.rating = check.computed;
      warnings.push(
        apiWarning("OVR_DERIVED", `rating derived from the nine stats as ${check.computed}.`, {
          severity: "info",
          path: `${path}.rating`,
        }),
      );
    }
  } else if (Object.keys(stats).length > 0 && Object.keys(stats).length < STAT_KEYS.length && item.player_card_id === undefined && item.name === undefined) {
    errors.push(apiError("INCOMPLETE_STATS", "Partial stat updates need an explicit player target.", { path }));
  }

  for (const field of ["badges", "traits"] as const) {
    if (Array.isArray(item[field])) {
      const count = (item[field] as unknown[]).length;
      destructive.push(
        apiWarning(
          "ASSIGNMENT_REPLACEMENT",
          count === 0
            ? `${path}.${field} = [] removes every ${field.slice(0, -1)} assignment on this card.`
            : `${path}.${field} replaces the card's full ${field} set with ${count} assignment(s).`,
          {
            severity: "destructive",
            path: `${path}.${field}`,
            remediation: `Omit ${field} to leave existing assignments untouched.`,
          },
        ),
      );
    }
  }
}

function validatePack(item: Record<string, unknown>, path: string, errors: AdminApiError[], destructive: AdminApiWarning[]) {
  const odds = item.odds;
  if (Array.isArray(odds) && odds.length) {
    let total: number;
    try {
      total = oddsTotal(odds as Array<{ percentage: number | string }>);
    } catch (e) {
      errors.push(apiError("NOT_A_NUMBER", `Pack odds percentages must be numeric: ${(e as Error).message}`, { path: `${path}.odds` }));
      return;
    }
    if (total !== ODDS_TARGET) {
      errors.push(
        apiError("ODDS_TOTAL", `Pack odds total ${unscaled(total)}%, not 100.00%.`, {
          path: `${path}.odds`,
          entity_type: "pack",
          expected: "100.00",
          received: unscaled(total),
          remediation: "Adjust one or more percentages so the fixed-precision total is exactly 100.00.",
        }),
      );
    }
    const pool = Array.isArray(item.players) ? (item.players as unknown[]).length : null;
    (odds as Array<Record<string, unknown>>).forEach((row, i) => {
      const slot = String(row.result_slot ?? "").trim();
      if (slot === "player_choice") return;
      const n = Number(slot);
      if (!Number.isInteger(n) || n < 1 || (pool !== null && n > pool)) {
        errors.push(
          apiError("INVALID_ODDS_SLOT", `result_slot "${slot}" is not a pool slot or "player_choice".`, {
            path: `${path}.odds[${i}].result_slot`,
            entity_type: "pack",
            expected: pool ? `1 through ${pool}, or "player_choice"` : `pool slot number, or "player_choice"`,
            received: slot,
          }),
        );
      }
      if (scaled((row.percentage as number) ?? 0, 2) <= 0) {
        errors.push(
          apiError("INVALID_ODDS_PERCENTAGE", "Every odds row must be greater than 0.", {
            path: `${path}.odds[${i}].percentage`,
            received: row.percentage,
          }),
        );
      }
    });
    destructive.push(
      apiWarning("ODDS_REPLACEMENT", `${path}.odds replaces the pack's entire odds table.`, {
        severity: "destructive",
        path: `${path}.odds`,
      }),
    );
  }
}

function validateCollection(item: Record<string, unknown>, path: string, errors: AdminApiError[]) {
  const members = (item.player_cards ?? item.members ?? item.requirements) as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(members)) return;
  const rewards = members.filter((m) => m.is_reward === true);
  const explicit = item.reward_player_card_id ?? item.reward_player_name;
  if (rewards.length > 1) {
    errors.push(
      apiError("MULTIPLE_COLLECTION_REWARDS", `${rewards.length} membership entries set is_reward.`, {
        path: `${path}.player_cards`,
        entity_type: "collection",
        expected: "exactly one is_reward entry",
        received: rewards.length,
      }),
    );
  }
  if (rewards.length === 1 && explicit) {
    errors.push(
      apiError("DUPLICATE_REWARD_DECLARATION", "Reward declared twice (is_reward entry plus reward_player_* field).", {
        path: `${path}.reward_player_name`,
        entity_type: "collection",
        remediation: "Keep either the is_reward membership flag or the reward_player_* field, not both.",
      }),
    );
  }
  if (!item.name && !item.collection_id) {
    errors.push(
      apiError("MISSING_NAME", "A collection needs name (to create) or collection_id (to target an existing one).", {
        path: `${path}.name`,
        entity_type: "collection",
      }),
    );
  }
}

function validateEvoPath(
  item: Record<string, unknown>,
  path: string,
  errors: AdminApiError[],
  warnings: AdminApiWarning[],
  destructive: AdminApiWarning[],
) {
  if (!hasTarget("player", item)) {
    errors.push(
      apiError("UNRESOLVED_REFERENCE", "Evo paths need a source card: player_card_id (canonical), card_key or a unique player_name.", {
        path: `${path}.player_card_id`,
        entity_type: "player_card",
      }),
    );
  }
  const steps = item.steps;
  if (!Array.isArray(steps) || steps.length === 0) {
    errors.push(apiError("MISSING_EVO_STEPS", "An evo path needs at least one step.", { path: `${path}.steps` }));
    return;
  }
  const seenOrders = new Map<string, number>();
  (steps as Array<Record<string, unknown>>).forEach((step, i) => {
    const order = String(step.step_order ?? "");
    if (order && seenOrders.has(order)) {
      errors.push(
        apiError("DUPLICATE_STEP_ORDER", `step_order ${order} is used by steps ${seenOrders.get(order)! + 1} and ${i + 1}.`, {
          path: `${path}.steps[${i}].step_order`,
          received: step.step_order,
          remediation: "step_order must be unique inside one evo path.",
        }),
      );
    }
    if (order) seenOrders.set(order, i);
  });
  let previousTo: string | null = tierKey(item.source_gem_tier ?? "") || null;
  (steps as Array<Record<string, unknown>>).forEach((step, i) => {
    const from = tierKey(step.from_tier);
    const to = tierKey(step.to_tier);
    const fromIndex = EVO_TIER_ORDER.indexOf(from);
    const toIndex = EVO_TIER_ORDER.indexOf(to);
    if (fromIndex < 0 || toIndex < 0) {
      errors.push(
        apiError("UNKNOWN_GEM_TIER", `Unknown tier in step ${i + 1}.`, {
          path: `${path}.steps[${i}]`,
          expected: EVO_TIER_ORDER,
          received: { from_tier: step.from_tier, to_tier: step.to_tier },
        }),
      );
      return;
    }
    if (toIndex !== fromIndex + 1) {
      errors.push(
        apiError("EVO_TIER_SKIP", `Step ${i + 1} jumps ${from} -> ${to}.`, {
          path: `${path}.steps[${i}].to_tier`,
          expected: EVO_TIER_ORDER[fromIndex + 1] ?? "next tier",
          received: to,
          remediation: "Evolution must advance exactly one tier per step.",
        }),
      );
    }
    if (previousTo && previousTo !== from) {
      errors.push(
        apiError("EVO_TIER_DISCONTINUITY", `Step ${i + 1} starts at ${from} but the previous state is ${previousTo}.`, {
          path: `${path}.steps[${i}].from_tier`,
          expected: previousTo,
          received: from,
        }),
      );
    }
    previousTo = to;

    const objectives = step.objectives;
    if (!Array.isArray(objectives) || objectives.length === 0) {
      errors.push(apiError("MISSING_EVO_OBJECTIVES", `Step ${i + 1} has no objectives.`, { path: `${path}.steps[${i}].objectives` }));
    } else {
      (objectives as Array<Record<string, unknown>>).forEach((objective, j) => {
        const stat = String(objective.stat ?? "").trim();
        if (!EVO_OBJECTIVE_KEYS.includes(stat)) {
          errors.push(
            apiError("UNSUPPORTED_EVO_OBJECTIVE", `"${stat}" is not a supported objective statistic.`, {
              path: `${path}.steps[${i}].objectives[${j}].stat`,
              expected: EVO_OBJECTIVE_KEYS,
              received: stat,
            }),
          );
        }
        if (!(Number(objective.amount) > 0)) {
          errors.push(
            apiError("INVALID_EVO_AMOUNT", "Objective amount must be greater than 0.", {
              path: `${path}.steps[${i}].objectives[${j}].amount`,
              received: objective.amount,
            }),
          );
        }
      });
    }

    const version = step.resulting_version as Record<string, unknown> | undefined;
    if (!version) {
      errors.push(
        apiError("EVO_MISSING_VERSION", `Step ${i + 1} has no resulting_version, so the unlocked card would not be playable.`, {
          path: `${path}.steps[${i}].resulting_version`,
          remediation: "Every step must materialize stats (and optional badges/traits) for the version it unlocks.",
        }),
      );
      return;
    }
    const stats = statBlock(version);
    if (Object.keys(stats).length !== STAT_KEYS.length) {
      errors.push(
        apiError("INCOMPLETE_STATS", `Step ${i + 1} resulting_version must set all nine base stats.`, {
          path: `${path}.steps[${i}].resulting_version.stats`,
          expected: STAT_KEYS,
          received: Object.keys(stats),
        }),
      );
      return;
    }
    const targetTier = version.gem_name ?? version.gem_tier ?? step.to_tier;
    const check = checkOvr(stats, targetTier, version.rating);
    if (!check.ok && check.code === "OVR_TIER_MISMATCH") {
      const band = bandFor(targetTier);
      errors.push(
        apiError("OVR_TIER_MISMATCH", `Step ${i + 1} resulting OVR ${check.computed} does not fit ${String(targetTier)}.`, {
          path: `${path}.steps[${i}].resulting_version.stats`,
          entity_type: "evo_card_version",
          expected: band ? bandLabel(band) : check.expected,
          received: check.computed,
          remediation: "Adjust the resulting stats so the average falls inside the resulting tier band.",
        }),
      );
    } else if (!check.ok && check.code === "OVR_RATING_MISMATCH") {
      errors.push(
        apiError("OVR_RATING_MISMATCH", `Step ${i + 1} resulting rating does not match its stats (${check.computed_exact}).`, {
          path: `${path}.steps[${i}].resulting_version.rating`,
          expected: check.computed_exact,
          received: check.received,
          remediation: `Send the exact nine-stat average (tolerance ${OVR_TOLERANCE}) or omit rating so it is derived.`,
        }),
      );
    } else if (!check.ok && check.code === "UNKNOWN_GEM_TIER") {
      errors.push(
        apiError("UNKNOWN_GEM_TIER", `Step ${i + 1} resulting tier "${String(targetTier)}" is not a known gem tier.`, {
          path: `${path}.steps[${i}].resulting_version.gem_name`,
          expected: EVO_TIER_ORDER,
          received: targetTier,
        }),
      );
    } else if (check.ok && check.computed_exact && version.rating === undefined) {
      version.rating = check.computed_exact;
      warnings.push(
        apiWarning("OVR_DERIVED", `Step ${i + 1} resulting rating derived as ${check.computed_exact}.`, {
          severity: "info",
          path: `${path}.steps[${i}].resulting_version.rating`,
        }),
      );
    }
    if (check.computed_exact) {
      warnings.push(
        apiWarning(
          "OVR_REPORT",
          `Step ${i + 1} resulting version: supplied rating ${String(version.rating ?? "(derived)")}, calculated OVR ${check.computed_exact}, requested tier ${String(targetTier)}.`,
          { severity: "info", path: `${path}.steps[${i}].resulting_version` },
        ),
      );
    }
    validateAssignments(version, `${path}.steps[${i}].resulting_version`, errors, destructive);
    if (Array.isArray(version.run_stats) === false && typeof version.run_stats === "object" && version.run_stats) {
      validateStatRange(version.run_stats as Record<string, unknown>, `${path}.steps[${i}].resulting_version.run_stats`, errors);
    }
  });
}

/** Range-checks a stat map (base or Runs-mode) without float comparison. */
function validateStatRange(stats: Record<string, unknown>, path: string, errors: AdminApiError[]) {
  for (const [key, value] of Object.entries(stats)) {
    if (value === undefined || value === null || value === "") continue;
    let units: number;
    try {
      units = scaled(value as number, 2);
    } catch {
      errors.push(apiError("NOT_A_NUMBER", `${key} must be numeric.`, { path: `${path}.${key}`, received: value }));
      continue;
    }
    if (units < 0 || units > 9900) {
      errors.push(
        apiError("STAT_OUT_OF_RANGE", `${key} must be between 0 and 99.`, {
          path: `${path}.${key}`,
          expected: "0 through 99",
          received: value,
        }),
      );
    }
  }
}

/**
 * Badge / trait replacement validation shared by player cards and evo versions.
 * A supplied array always replaces the full set; [] removes every assignment.
 */
function validateAssignments(
  item: Record<string, unknown>,
  path: string,
  errors: AdminApiError[],
  destructive: AdminApiWarning[],
) {
  for (const field of ["badges", "traits"] as const) {
    const list = item[field];
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      errors.push(apiError("INVALID_ASSIGNMENTS", `${path}.${field} must be an array.`, { path: `${path}.${field}`, received: typeof list }));
      continue;
    }
    list.forEach((entry, i) => {
      const row = (typeof entry === "string" ? { [field === "badges" ? "badge" : "trait"]: entry } : entry) as Record<string, unknown>;
      const nameKey = field === "badges" ? (row.badge ?? row.badge_id ?? row.name) : (row.trait ?? row.trait_id ?? row.name);
      if (!nameKey) {
        errors.push(
          apiError("MISSING_ASSIGNMENT_TARGET", `${path}.${field}[${i}] needs a ${field === "badges" ? "badge" : "trait"} name or id.`, {
            path: `${path}.${field}[${i}]`,
          }),
        );
      }
      if (row.tier !== undefined && !ASSIGNMENT_TIERS.includes(tierKey(row.tier).replace("hall of fame", "hof"))) {
        errors.push(
          apiError("UNKNOWN_ASSIGNMENT_TIER", `"${String(row.tier)}" is not a valid assignment tier.`, {
            path: `${path}.${field}[${i}].tier`,
            expected: ASSIGNMENT_TIERS,
            received: row.tier,
          }),
        );
      }
      if (field === "traits" && row.target_stat !== undefined && row.target_stat !== null) {
        const target = String(row.target_stat).toLowerCase().replace(/^3pt$/, "stat_3pt");
        if (!(STAT_KEYS as readonly string[]).includes(target)) {
          errors.push(
            apiError("UNKNOWN_TRAIT_TARGET_STAT", `"${String(row.target_stat)}" is not one of the nine base stats.`, {
              path: `${path}.${field}[${i}].target_stat`,
              expected: STAT_KEYS,
              received: row.target_stat,
            }),
          );
        }
      }
    });
    destructive.push(
      apiWarning(
        "ASSIGNMENT_REPLACEMENT",
        list.length === 0
          ? `${path}.${field} = [] removes every ${field === "badges" ? "badge" : "trait"} assignment.`
          : `${path}.${field} replaces the full ${field} set with ${list.length} assignment(s).`,
        {
          severity: "destructive",
          path: `${path}.${field}`,
          remediation: `Omit ${field} to leave existing assignments untouched.`,
        },
      ),
    );
  }
}

function validateDuo(item: Record<string, unknown>, path: string, errors: AdminApiError[]) {
  const a = item.player_a_id ?? item.player_a ?? item.player_a_name;
  const b = item.player_b_id ?? item.player_b ?? item.player_b_name;
  if (a && b && String(a).toLowerCase() === String(b).toLowerCase()) {
    errors.push(
      apiError("DUO_SAME_PLAYER", "A dynamic duo cannot use the same card on both sides.", {
        path: `${path}.player_b`,
        received: b,
      }),
    );
  }
}

/** Wraps a single-entity body into the canonical bulk document shape. */
export function documentForEntity(entity: string, body: Record<string, unknown>) {
  const group = ENTITY_TO_GROUP[entity];
  if (!group) return null;
  return { [group]: [body] } as Record<string, unknown>;
}
