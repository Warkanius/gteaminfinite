// Canonical, structured lineup + attribute rules shared by the Insider API,
// the in-game Lineups page and the legality engine.
//
// Nothing here talks to the database: it is pure declared truth so the game UI
// and the GTeam Insider Custom GPT evaluate identical rules.

/** The nine base gameplay attributes (star scale, 0.00 - 6.99). */
export const BASE_STAT_KEYS = [
  "stat_3pt", "stat_mid", "stat_fin", "stat_dnk",
  "stat_ast", "stat_stl", "stat_reb", "stat_blk", "stat_int",
] as const;

/** The nine Runs attributes (Runs point scale, 20 points per star, 0 - 139). */
export const RUN_STAT_KEYS = [
  "run_stat_3pt", "run_stat_mid", "run_stat_fin", "run_stat_dnk",
  "run_stat_ast", "run_stat_stl", "run_stat_reb", "run_stat_blk", "run_stat_int",
] as const;

export const STAT_LABELS: Record<string, string> = {
  stat_3pt: "3PT", stat_mid: "MID", stat_fin: "FIN", stat_dnk: "DNK",
  stat_ast: "AST", stat_stl: "STL", stat_reb: "REB", stat_blk: "BLK", stat_int: "INT",
};

/**
 * Deterministic attribute groupings used by lineup summaries.
 * Documented here so a summary number can always be re-derived by hand.
 */
export const ATTRIBUTE_GROUPS: Record<string, readonly string[]> = {
  shooting: ["stat_3pt", "stat_mid"],
  finishing: ["stat_fin", "stat_dnk", "stat_int"],
  playmaking: ["stat_ast"],
  defense: ["stat_stl", "stat_blk"],
  rebounding: ["stat_reb"],
};

export interface LineupModeRule {
  mode: string;
  label: string;
  slots: number;
  /** Which attribute scale the mode actually plays on. */
  scale: "base" | "runs";
  /** Games that can constrain a lineup in this mode. */
  contexts: readonly string[];
  allow_duplicate_players: boolean;
  description: string;
}

/**
 * GTeam Infinite has exactly two playable roster shapes today:
 *   5v5   — Challenges, Domination and exhibition games, five cards, base stats.
 *   runs  — The Runs, three cards, Runs attribute scale.
 * There are no fixed positional slots: any owned card may occupy any slot unless
 * a game's structured restrictions say otherwise.
 */
export const LINEUP_MODES: Record<string, LineupModeRule> = {
  "5v5": {
    mode: "5v5",
    label: "5v5",
    slots: 5,
    scale: "base",
    contexts: ["exhibition", "challenge", "domination"],
    allow_duplicate_players: false,
    description: "Five cards. Used by Challenges, Domination road games and exhibition games. Plays on base attributes.",
  },
  runs: {
    mode: "runs",
    label: "The Runs",
    slots: 3,
    scale: "runs",
    contexts: ["run"],
    allow_duplicate_players: false,
    description: "Three cards. Used by The Runs. Plays on the separate Runs attribute scale (20 points per star, 0-139).",
  },
};

export function lineupModeRule(mode: string | null | undefined): LineupModeRule {
  const key = (mode ?? "5v5").toLowerCase();
  return LINEUP_MODES[key] ?? LINEUP_MODES["5v5"];
}

/**
 * Structured lineup-restriction keys stored on challenges.lineup_restrictions.
 * Semantics are OR across categories: a card qualifies when it satisfies AT
 * LEAST ONE populated category (this mirrors the in-game selector exactly).
 */
export const RESTRICTION_KEYS = [
  "positions",
  "gem_tier_ids",
  "team_ids",
  "collection_ids",
  "sub_collection_ids",
  "card_colors",
  "badge_ids",
  "trait_ids",
] as const;

/** Filters supported by the Insider collection / eligible-card reads. */
export const FILTER_KEYS = [
  "position",
  "gem_tier",
  "gem_tier_id",
  "min_rating",
  "max_rating",
  "min_run_rating",
  "badge",
  "badge_tier",
  "trait",
  "min_stat",
  "stat_key",
  "evo_active",
  "evo_completed",
  "evo_destination_tier",
  "collection",
  "favorite",
  "grinding",
  "core_player",
  "name",
  "limit",
  "offset",
] as const;

export const BADGE_TIERS = ["base", "gold", "hof", "diamond", "actolytrene"] as const;
export const TRAIT_TIERS = ["base", "gold", "hof", "diamond", "actolytrene"] as const;

export const INSIDER_API_LIMITS = {
  max_collection_page_size: 200,
  default_collection_page_size: 60,
  max_lineups_per_player: 50,
  max_compare_cards: 6,
  max_lineup_slots: 5,
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Deterministic lineup summary.
 *
 * Every group value is the plain SUM of the member attributes across the
 * lineup, plus the arithmetic mean per card. No hidden chemistry, no weighting.
 */
export function summarizeLineup(
  cards: Array<Record<string, unknown>>,
  scale: "base" | "runs",
): Record<string, unknown> {
  const prefix = scale === "runs" ? "run_" : "";
  const groups: Record<string, { total: number; per_card: number }> = {};
  for (const [group, keys] of Object.entries(ATTRIBUTE_GROUPS)) {
    let total = 0;
    for (const card of cards) for (const k of keys) total += num(card[`${prefix}${k}`]);
    groups[group] = {
      total: round2(total),
      per_card: cards.length ? round2(total / cards.length) : 0,
    };
  }
  const ratingKey = scale === "runs" ? "run_rating" : "rating";
  const ratings = cards.map((c) => num(c[ratingKey]));
  const positions: Record<string, number> = {};
  for (const card of cards) {
    for (const p of [card.position1, card.position2]) {
      if (typeof p === "string" && p) positions[p] = (positions[p] ?? 0) + 1;
    }
  }
  return {
    scale,
    card_count: cards.length,
    groups,
    rating_total: round2(ratings.reduce((a, b) => a + b, 0)),
    rating_average: ratings.length ? round2(ratings.reduce((a, b) => a + b, 0) / ratings.length) : 0,
    position_counts: positions,
    method:
      "Group values are the unweighted sum of their member attributes across every card in the lineup; per_card is that sum divided by the card count. Groups: " +
      Object.entries(ATTRIBUTE_GROUPS).map(([g, k]) => `${g}=${k.join("+")}`).join(", ") + ".",
  };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
