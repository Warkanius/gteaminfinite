// Public game-content reads and aggregated scout payloads.
//
// Everything here is data a normal player is allowed to know: challenge rules,
// Domination roads and opponents, Runs, plus the authenticated player's own
// completion progress. No admin/Commissioner capability is reachable from here.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { InsiderError } from "./errors.ts";
import { BASE_STAT_KEYS, RUN_STAT_KEYS, lineupModeRule, round2 } from "./rules.ts";
import { loadContext, type CollectionContext } from "./cards.ts";

type Row = Record<string, any>;

const OPP_CARD_COLUMNS =
  "id, name, gem_tier_id, gem_name, position1, position2, rating, run_rating, avatar_url, " +
  BASE_STAT_KEYS.join(", ") + ", " + RUN_STAT_KEYS.join(", ");

function statBlock(row: Row, keys: readonly string[]) {
  const out: Record<string, number | null> = {};
  for (const k of keys) out[k] = row[k] === null || row[k] === undefined ? null : Number(row[k]);
  return out;
}

/** Public opponent-card view: full attributes, badges and traits, no ownership. */
async function opponentCards(client: SupabaseClient, ctx: CollectionContext, rows: Row[], overrides?: Map<string, Row>) {
  const ids = rows.map((r) => r.player_cards?.id).filter(Boolean);
  const [badges, traits] = await Promise.all([
    ids.length ? client.from("player_card_badges").select("player_card_id, badge_id, tier").in("player_card_id", ids) : Promise.resolve({ data: [] as Row[] }),
    ids.length ? client.from("player_card_traits").select("player_card_id, trait_id, tier, target_stat").in("player_card_id", ids) : Promise.resolve({ data: [] as Row[] }),
  ]);
  const badgeCatalog = new Map(ctx.badges.map((b) => [b.id, b]));
  const traitCatalog = new Map(ctx.traits.map((t) => [t.id, t]));
  return rows
    .filter((r) => r.player_cards)
    .map((r) => {
      const c: Row = r.player_cards;
      const ov = overrides?.get(c.id);
      return {
        player_card_id: c.id,
        slot: r.slot ?? null,
        name: c.name,
        gem_tier: c.gem_name ?? ctx.gemTiers.find((t) => t.id === c.gem_tier_id)?.name ?? null,
        gem_tier_id: c.gem_tier_id ?? null,
        position1: c.position1 ?? null,
        position2: c.position2 ?? null,
        rating: c.rating === null ? null : Number(c.rating),
        run_rating: ov?.run_rating ?? (c.run_rating === null ? null : Number(c.run_rating)),
        attributes: statBlock(c, BASE_STAT_KEYS),
        run_attributes: ov ? statBlock(ov, RUN_STAT_KEYS) : statBlock(c, RUN_STAT_KEYS),
        badges: (badges.data ?? []).filter((b: Row) => b.player_card_id === c.id).map((b: Row) => ({
          badge_id: b.badge_id,
          name: badgeCatalog.get(b.badge_id)?.name ?? null,
          abbreviation: badgeCatalog.get(b.badge_id)?.abbreviation ?? null,
          tier: b.tier,
        })),
        traits: (traits.data ?? []).filter((t: Row) => t.player_card_id === c.id).map((t: Row) => ({
          trait_id: t.trait_id,
          name: traitCatalog.get(t.trait_id)?.name ?? null,
          abbreviation: traitCatalog.get(t.trait_id)?.abbreviation ?? null,
          condition_type: traitCatalog.get(t.trait_id)?.condition_type ?? null,
          tier: t.tier,
          target_stat: t.target_stat ?? null,
        })),
      };
    })
    .sort((a, b) => Number(a.slot ?? 0) - Number(b.slot ?? 0));
}

function activeOnly<T extends Row>(rows: T[]): T[] {
  return rows.filter((r) => r.status === undefined || r.status === "active");
}

// ───────────────────────────── list reads ─────────────────────────────

export async function listChallenges(client: SupabaseClient, userId: string) {
  const [{ data, error }, completions] = await Promise.all([
    client.from("challenges")
      .select("id, name, description, challenge_type, win_condition, win_by_amount, series_length, coin_reward, gem_reward, series_win_coins, series_loss_coins, pack_reward, card_reward_id, opponent_team_id, lineup_restrictions, conditions, is_repeatable, prerequisite_id, spotlight_group, sort_order, status, expires_at")
      .order("sort_order"),
    client.from("challenge_completions").select("challenge_id, completed_at").eq("user_id", userId),
  ]);
  if (error) throw new InsiderError("INTERNAL_ERROR", error.message);
  const done = new Map((completions.data ?? []).map((c: Row) => [c.challenge_id, c.completed_at]));
  return {
    challenges: activeOnly(data ?? []).map((c: Row) => ({
      challenge_id: c.id,
      name: c.name,
      description: c.description,
      challenge_type: c.challenge_type,
      win_condition: c.win_condition,
      win_by_amount: c.win_by_amount,
      series_length: c.series_length,
      mode: "5v5",
      slots_required: lineupModeRule("5v5").slots,
      lineup_restrictions: c.lineup_restrictions ?? null,
      conditions: c.conditions ?? null,
      opponent_team_id: c.opponent_team_id,
      rewards: {
        coins: c.coin_reward, gems: c.gem_reward, pack: c.pack_reward,
        card_reward_id: c.card_reward_id,
        series_win_coins: c.series_win_coins, series_loss_coins: c.series_loss_coins,
      },
      is_repeatable: c.is_repeatable,
      prerequisite_id: c.prerequisite_id,
      spotlight_group: c.spotlight_group,
      completed: done.has(c.id),
      completed_at: done.get(c.id) ?? null,
    })),
  };
}

export async function listDomination(client: SupabaseClient, userId: string) {
  const [roads, games, progress] = await Promise.all([
    client.from("domination_roads").select("id, name, slug, description, sort_order, is_active, status").order("sort_order"),
    client.from("domination_games").select("id, road_id, road_name, opponent_name, game_order, difficulty_stars, coin_reward, pack_reward, pack_reward_id, opponent_team_id, status").order("game_order"),
    client.from("user_rttr_progress").select("road_name, domination_game_id, wins").eq("user_id", userId),
  ]);
  const wins = new Map((progress.data ?? []).map((p: Row) => [p.domination_game_id, p.wins]));
  const allGames = activeOnly(games.data ?? []);
  return {
    roads: activeOnly(roads.data ?? []).map((r: Row) => {
      const roadGames = allGames.filter((g: Row) => g.road_id === r.id || g.road_name === r.name);
      const completed = roadGames.filter((g: Row) => Number(wins.get(g.id) ?? 0) > 0);
      const next = roadGames.find((g: Row) => Number(wins.get(g.id) ?? 0) === 0) ?? null;
      return {
        road_id: r.id,
        name: r.name,
        slug: r.slug,
        description: r.description,
        is_active: r.is_active,
        game_count: roadGames.length,
        completed_count: completed.length,
        next_game: next ? { domination_game_id: next.id, game_order: next.game_order, opponent_name: next.opponent_name, difficulty_stars: next.difficulty_stars } : null,
        games: roadGames.map((g: Row) => ({
          domination_game_id: g.id,
          game_order: g.game_order,
          opponent_name: g.opponent_name,
          difficulty_stars: g.difficulty_stars,
          coin_reward: g.coin_reward,
          pack_reward_id: g.pack_reward_id ?? null,
          wins: Number(wins.get(g.id) ?? 0),
          completed: Number(wins.get(g.id) ?? 0) > 0,
        })),
      };
    }),
  };
}

export async function listRuns(client: SupabaseClient, userId: string) {
  const [runs, progress, rewards] = await Promise.all([
    client.from("runs").select("id, name, target_score, team_id, milestones, status").order("name"),
    client.from("user_runs").select("run_id, current_wins, highest_wins").eq("user_id", userId),
    client.from("run_rank_rewards").select("rank_name, wins_required, coin_reward, gem_reward").order("wins_required"),
  ]);
  const byRun = new Map((progress.data ?? []).map((p: Row) => [p.run_id, p]));
  return {
    runs: activeOnly(runs.data ?? []).map((r: Row) => ({
      run_id: r.id,
      name: r.name,
      target_score: r.target_score,
      mode: "runs",
      slots_required: lineupModeRule("runs").slots,
      milestones: r.milestones ?? null,
      current_wins: byRun.get(r.id)?.current_wins ?? 0,
      highest_wins: byRun.get(r.id)?.highest_wins ?? 0,
    })),
    rank_rewards: rewards.data ?? [],
    runs_scale_note: "Runs games use the separate Runs attribute scale (20 points per star, 0-139) and three-card lineups.",
  };
}

// ───────────────────────────── scouts ─────────────────────────────

export async function challengeScout(client: SupabaseClient, userId: string, challengeId: string) {
  const ctx = await loadContext(client);
  const { data: c, error } = await client
    .from("challenges")
    .select("id, name, description, challenge_type, win_condition, win_by_amount, series_length, coin_reward, gem_reward, series_win_coins, series_loss_coins, pack_reward, card_reward_id, opponent_team_id, lineup_restrictions, conditions, stat_limit_player_id, stat_limit_stat, stat_limit_value, is_repeatable, status")
    .eq("id", challengeId)
    .maybeSingle();
  if (error) throw new InsiderError("INTERNAL_ERROR", error.message);
  if (!c) throw new InsiderError("GAME_NOT_FOUND", `No challenge with id ${challengeId}`);

  const roster = c.opponent_team_id
    ? (await client.from("team_players").select(`slot, player_cards(${OPP_CARD_COLUMNS})`).eq("team_id", c.opponent_team_id)).data ?? []
    : [];
  const [{ data: team }, { data: completion }] = await Promise.all([
    c.opponent_team_id
      ? client.from("teams").select("id, name, category").eq("id", c.opponent_team_id).maybeSingle()
      : Promise.resolve({ data: null }),
    client.from("challenge_completions").select("completed_at").eq("user_id", userId).eq("challenge_id", challengeId).maybeSingle(),
  ]);

  const opponents = await opponentCards(client, ctx, roster);
  return {
    game: {
      type: "challenge",
      challenge_id: c.id,
      name: c.name,
      description: c.description,
      challenge_type: c.challenge_type,
      mode: "5v5",
      slots_required: lineupModeRule("5v5").slots,
    },
    rules: {
      win_condition: c.win_condition,
      win_by_amount: c.win_by_amount,
      series_length: c.series_length,
      stat_limit: c.stat_limit_stat ? { player_card_id: c.stat_limit_player_id, stat: c.stat_limit_stat, value: c.stat_limit_value } : null,
      is_repeatable: c.is_repeatable,
      conditions: c.conditions ?? null,
    },
    restrictions: c.lineup_restrictions ?? null,
    restriction_semantics: "A card qualifies when it satisfies AT LEAST ONE populated restriction category (OR logic). Evolved cards inherit their chain root's tier, team, collection and colour.",
    opponent: { team_id: team?.id ?? null, team_name: team?.name ?? null, roster_size: opponents.length, cards: opponents },
    opponent_strength: {
      rating_average: opponents.length ? round2(opponents.reduce((s, o) => s + Number(o.rating ?? 0), 0) / opponents.length) : 0,
    },
    rewards: {
      coins: c.coin_reward, gems: c.gem_reward, pack: c.pack_reward, card_reward_id: c.card_reward_id,
      series_win_coins: c.series_win_coins, series_loss_coins: c.series_loss_coins,
    },
    user_progress: { completed: !!completion, completed_at: completion?.completed_at ?? null },
  };
}

export async function dominationScout(client: SupabaseClient, userId: string, gameId: string) {
  const ctx = await loadContext(client);
  const { data: g, error } = await client
    .from("domination_games")
    .select("id, road_id, road_name, opponent_name, game_order, difficulty_stars, coin_reward, pack_reward, pack_reward_id, opponent_team_id, status")
    .eq("id", gameId)
    .maybeSingle();
  if (error) throw new InsiderError("INTERNAL_ERROR", error.message);
  if (!g) throw new InsiderError("GAME_NOT_FOUND", `No domination game with id ${gameId}`);

  const [{ data: roster }, { data: road }, { data: progress }] = await Promise.all([
    client.from("domination_game_players").select(`slot, player_cards(${OPP_CARD_COLUMNS})`).eq("domination_game_id", gameId).order("slot"),
    g.road_id ? client.from("domination_roads").select("id, name, slug, description").eq("id", g.road_id).maybeSingle() : Promise.resolve({ data: null }),
    client.from("user_rttr_progress").select("wins").eq("user_id", userId).eq("domination_game_id", gameId).maybeSingle(),
  ]);
  const opponents = await opponentCards(client, ctx, roster ?? []);
  return {
    game: {
      type: "domination",
      domination_game_id: g.id,
      road_id: g.road_id,
      road_name: road?.name ?? g.road_name,
      game_order: g.game_order,
      opponent_name: g.opponent_name,
      mode: "5v5",
      slots_required: lineupModeRule("5v5").slots,
    },
    difficulty: { stars: g.difficulty_stars },
    rules: { win_condition: "win" },
    restrictions: null,
    opponent: { roster_size: opponents.length, cards: opponents },
    opponent_strength: {
      rating_average: opponents.length ? round2(opponents.reduce((s, o) => s + Number(o.rating ?? 0), 0) / opponents.length) : 0,
    },
    rewards: { coins: g.coin_reward, pack: g.pack_reward, pack_reward_id: g.pack_reward_id },
    user_progress: { wins: Number(progress?.wins ?? 0), completed: Number(progress?.wins ?? 0) > 0 },
  };
}

export async function runScout(client: SupabaseClient, userId: string, runId: string) {
  const ctx = await loadContext(client);
  const { data: r, error } = await client.from("runs").select("id, name, target_score, team_id, milestones, status").eq("id", runId).maybeSingle();
  if (error) throw new InsiderError("INTERNAL_ERROR", error.message);
  if (!r) throw new InsiderError("GAME_NOT_FOUND", `No run with id ${runId}`);

  const [{ data: roster }, { data: progress }, { data: rewards }] = await Promise.all([
    client.from("run_players").select(`id, run_rating, ${RUN_STAT_KEYS.join(", ")}, player_cards(${OPP_CARD_COLUMNS})`).eq("run_id", runId),
    client.from("user_runs").select("current_wins, highest_wins").eq("user_id", userId).eq("run_id", runId).maybeSingle(),
    client.from("run_rank_rewards").select("rank_name, wins_required, coin_reward, gem_reward").order("wins_required"),
  ]);
  const overrides = new Map<string, Row>();
  for (const row of (roster ?? []) as Row[]) if (row.player_cards?.id) overrides.set(row.player_cards.id, row);
  const opponents = await opponentCards(client, ctx, (roster ?? []) as Row[], overrides);
  return {
    game: {
      type: "run",
      run_id: r.id,
      name: r.name,
      target_score: r.target_score,
      mode: "runs",
      slots_required: lineupModeRule("runs").slots,
    },
    rules: {
      scale: "runs",
      scale_note: "Runs attributes are a separate point scale: 20 points per star, 0-139. Base star attributes do not apply.",
      target_score: r.target_score,
      milestones: r.milestones ?? null,
    },
    restrictions: null,
    opponent: { roster_size: opponents.length, cards: opponents },
    rewards: { rank_rewards: rewards ?? [] },
    user_progress: { current_wins: progress?.current_wins ?? 0, highest_wins: progress?.highest_wins ?? 0 },
  };
}

// ───────────────────── progression + play-next ─────────────────────

export async function progressionOverview(client: SupabaseClient, userId: string) {
  const [challenges, domination, runs] = await Promise.all([
    listChallenges(client, userId),
    listDomination(client, userId),
    listRuns(client, userId),
  ]);
  const completed = challenges.challenges.filter((c) => c.completed);
  const open = challenges.challenges.filter((c) => !c.completed || c.is_repeatable);
  return {
    challenges: {
      total: challenges.challenges.length,
      completed: completed.map((c) => ({ challenge_id: c.challenge_id, name: c.name })),
      available: open.map((c) => ({ challenge_id: c.challenge_id, name: c.name, restrictions: c.lineup_restrictions, rewards: c.rewards })),
    },
    domination: domination.roads.map((r) => ({
      road_id: r.road_id, name: r.name, game_count: r.game_count, completed_count: r.completed_count, next_game: r.next_game,
    })),
    runs: runs.runs.map((r) => ({ run_id: r.run_id, name: r.name, current_wins: r.current_wins, highest_wins: r.highest_wins })),
  };
}

/**
 * Structured candidates for "what should I play next?". The backend supplies
 * facts (open games, rewards, difficulty, active evo objectives); the Custom GPT
 * decides.
 */
export async function playNextCandidates(client: SupabaseClient, userId: string, activeEvos: Row[]) {
  const overview = await progressionOverview(client, userId);
  const candidates: Row[] = [];
  for (const c of overview.challenges.available.slice(0, 40)) {
    candidates.push({
      type: "challenge",
      id: c.challenge_id,
      name: c.name,
      has_restrictions: !!c.restrictions,
      restrictions: c.restrictions ?? null,
      rewards: c.rewards,
    });
  }
  for (const road of overview.domination) {
    if (road.next_game) {
      candidates.push({
        type: "domination",
        id: road.next_game.domination_game_id,
        name: `${road.name} — game ${road.next_game.game_order} vs ${road.next_game.opponent_name}`,
        difficulty_stars: road.next_game.difficulty_stars,
        road_progress: `${road.completed_count}/${road.game_count}`,
      });
    }
  }
  for (const run of overview.runs) {
    candidates.push({ type: "run", id: run.run_id, name: run.name, current_wins: run.current_wins, highest_wins: run.highest_wins });
  }
  return {
    candidates,
    active_evo_objectives: activeEvos,
    note: "Facts only. The backend does not rank these; the caller reasons over them.",
  };
}

/**
 * Deterministic overlap of active EVO objectives: which cards can grind the same
 * objective category in the same games.
 */
export function evoObjectiveOverlap(activeEvos: Row[]) {
  const byCategory = new Map<string, Row[]>();
  for (const evo of activeEvos) {
    for (const o of (evo.objectives ?? []) as Row[]) {
      if (o.completed) continue;
      const key = String(o.objective_type ?? "unknown") + (o.stat_key ? `:${o.stat_key}` : "");
      const list = byCategory.get(key) ?? [];
      list.push({
        owned_card_id: evo.owned_card_id,
        name: evo.name,
        evo_step_id: evo.evo_step_id,
        objective_type: o.objective_type,
        stat_key: o.stat_key,
        remaining: Math.max(0, Number(o.target ?? 0) - Number(o.current_value ?? 0)),
        target: o.target,
        current_value: o.current_value,
      });
      byCategory.set(key, list);
    }
  }
  const groups = Array.from(byCategory.entries()).map(([category, members]) => ({
    objective_category: category,
    card_count: members.length,
    members,
    compatible: members.length > 1,
  }));
  // "single_game_stat" objectives compete for the same game state per card, so
  // flag them rather than presenting them as freely stackable.
  const conflicts = groups
    .filter((g) => g.objective_category.startsWith("single_game_stat") && g.card_count > 1)
    .map((g) => ({
      objective_category: g.objective_category,
      reason: "single_game_stat objectives require a per-game threshold on each card individually",
      members: g.members.map((m: Row) => m.owned_card_id),
    }));
  return {
    active_evo_cards: activeEvos.map((e) => ({ owned_card_id: e.owned_card_id, name: e.name, evo_step_id: e.evo_step_id })),
    overlap_groups: groups.filter((g) => g.compatible),
    all_groups: groups,
    conflicts,
    note: "Grouping is by objective type + stat key. Cards in one group progress from the same game events.",
  };
}
