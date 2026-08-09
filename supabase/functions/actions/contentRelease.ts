/**
 * Atomic content release: normalization, validation and payload construction.
 *
 * A release is one JSON document describing a collection, its cards, a release
 * team, a pack (ordered pool + exact-100% odds) and multi-step evo paths where
 * EVERY step materializes a playable evo card version.
 *
 * Everything here is zero-write. It runs client-side for fast, field-level
 * feedback and produces the exact payload sent to `public.admin_apply_batch`,
 * which re-validates and is the single source of truth.
 */

import {
  deriveRunStats,
  runBandForBase,
  runBandLabel,
  runRatingFromStats,
  runStatMatchesBase,
  RUN_STAT_RANGE,
  RUN_SCALE_DOC,
} from "../_shared/admin-api/runScale.ts";
import {
  completeRunRating,
  completeRunStats as sharedCompleteRunStats,
  PLAYABLE_CARD_FIELDS,
} from "../_shared/admin-api/playableCard.ts";
import { checkAssignmentLimits } from "../_shared/admin-api/assignmentRules.ts";
import { expandDominationSection } from "../_shared/admin-api/domination.ts";


export const STAT_KEYS = [
  "stat_3pt",
  "stat_mid",
  "stat_fin",
  "stat_dnk",
  "stat_ast",
  "stat_stl",
  "stat_reb",
  "stat_blk",
  "stat_int",
] as const;
export type StatKey = (typeof STAT_KEYS)[number];

/** Runs-mode mirrors of the nine base stats (player_cards.run_stat_*). */
export const RUN_STAT_KEYS = STAT_KEYS.map((k) => `run_${k}`) as unknown as readonly `run_${StatKey}`[];
export type RunStatKey = `run_${StatKey}`;

export const STAT_RANGE = { min: 0, max: 99 };


export const ASSIGNMENT_TIERS = ["base", "gold", "hof", "diamond", "actolytrene"] as const;
export type AssignmentTier = (typeof ASSIGNMENT_TIERS)[number];

/** Extensible registry of tracked evo objectives (mirrors evo_objective_registry). */
export const EVO_OBJECTIVES = {
  points: { objective_type: "total_stat", stat_key: "points", label: "Points" },
  three_pointers_made: { objective_type: "total_stat", stat_key: "stat_3pt", label: "Three-pointers made" },
  mid_range_shots_made: { objective_type: "total_stat", stat_key: "stat_mid", label: "Mid-range shots made" },
  dunks_made: { objective_type: "total_stat", stat_key: "stat_dnk", label: "Dunks made" },
  assists: { objective_type: "total_stat", stat_key: "stat_ast", label: "Assists" },
  steals: { objective_type: "total_stat", stat_key: "stat_stl", label: "Steals" },
  rebounds: { objective_type: "total_stat", stat_key: "stat_reb", label: "Rebounds" },
  blocks: { objective_type: "total_stat", stat_key: "stat_blk", label: "Blocks" },
  games_won: { objective_type: "games_won", stat_key: null, label: "Games won" },
} as const;
export type EvoObjectiveKey = keyof typeof EVO_OBJECTIVES;

export const SPECIAL_ODDS_SLOTS = ["player_choice"] as const;

// ---------------------------------------------------------------- input types

export interface Assignment {
  badge?: string;
  badge_id?: string;
  trait?: string;
  trait_id?: string;
  tier?: AssignmentTier;
  target_stat?: StatKey;
}

export type StatBlock = Partial<Record<StatKey, number>>;
export type RunStatBlock = Partial<Record<RunStatKey, number>>;

export interface ReleaseStepInput {
  from_tier: string;
  to_tier: string;
  step_order: number;
  /** Immutable id of an existing step to update in place (optional, authoritative). */
  evo_path_id?: string;
  /** Step status. Omitted falls back to the path status; never forced to draft. */
  status?: ContentStatus;
  objectives: Array<{ stat: string; amount: number; description?: string }>;
  /**
   * A complete playable card snapshot for this step (see PLAYABLE_CARD_FIELDS):
   * identity, both ratings, base stats, Runs stats and assignments.
   */
  resulting_version: {
    rating?: number;
    run_rating?: number;
    gem_name?: string;
    gem_tier?: string;
    position1?: string;
    position2?: string | null;
    status?: string;
    stats: StatBlock;
    /** Runs-mode stats for this version. Flat run_stat_* keys are also accepted. */
    run_stats?: RunStatBlock;
    badges?: Assignment[];
    traits?: Assignment[];
    [extra: string]: unknown;
  };

}


/**
 * Content status is never silently downgraded. `published` is the release-document
 * wording for the stored `active` status; every other supported status is passed
 * through exactly as submitted, and an unknown value is a hard validation error.
 */
export type ContentStatus = "draft" | "scheduled" | "active" | "disabled" | "archived" | "published";

export const CONTENT_STATUSES = ["draft", "scheduled", "active", "disabled", "archived"] as const;

export function releaseStatus(value: unknown, fallback = "draft"): string {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  const v = String(value).trim().toLowerCase();
  const mapped = v === "published" ? "active" : v;
  if (!(CONTENT_STATUSES as readonly string[]).includes(mapped)) {
    throw new Error(
      `INVALID_STATUS: "${String(value)}" is not a content status. Use one of ${CONTENT_STATUSES.join(", ")} (or "published" for active).`,
    );
  }
  return mapped;
}

export interface ReleaseEvoPathInput {
  player_name?: string;
  /** Immutable target. Resolved directly against player_cards.id — never a temp ref. */
  player_card_id?: string;
  card_key?: string;
  /** Distinguishing fields for an exact-name lookup, and the source card's current tier. */
  source_gem_tier?: string;
  rating?: number;
  collection?: string;
  sub_collection?: string;
  team?: string;
  card_variant?: string;
  evo_stage?: number;
  status?: ContentStatus;
  /**
   * Whole-path replacement (default). `steps` is the complete, authoritative
   * step list for this card: matching steps are updated in place by immutable
   * id, missing steps are created, and leftover steps are deleted together with
   * their objectives and playable versions.
   * Set false to only add/update the listed steps and leave the rest alone.
   */
  replace_existing_path?: boolean;
  steps: ReleaseStepInput[];
}


export interface ReleasePlayerInput {
  name: string;
  player_card_id?: string;
  new_name?: string;
  gem_tier?: string;
  gem_name?: string;
  position1?: string;
  position2?: string | null;
  rating?: number;
  run_rating?: number;
  collection?: string;
  sub_collection?: string;
  team?: string;
  is_collection_reward?: boolean;
  /** Base stats. Flat stat_3pt … stat_int keys on the player are also accepted. */
  stats?: StatBlock;
  /** Runs-mode stats. Flat run_stat_3pt … run_stat_int keys are also accepted. */
  run_stats?: RunStatBlock;
  badges?: Assignment[];
  traits?: Assignment[];
  [extra: string]: unknown;
}

export interface ContentReleaseInput {
  release: { name: string; slug?: string; status?: ContentStatus; description?: string };
  collection?: {
    name: string;
    description?: string;
    player_cards?: Array<{ player_name?: string; player_card_id?: string; slot?: number; is_reward?: boolean }>;
    reward_player_name?: string;
    reward_player_card_id?: string;
  };
  players?: ReleasePlayerInput[];
  team?: {
    name: string;
    category?: string;
    unlock_cost?: number;
    roster: Array<{ player_name?: string; player_card_id?: string; slot: number }>;
  };
  pack?: {
    /** Immutable pack id. Authoritative target for an existing pack. */
    pack_id?: string;
    name?: string;
    new_name?: string;
    pack_type?: "standard" | "premium" | "promo";
    cost?: number;
    ten_box_cost?: number | null;
    status?: ContentStatus;
    /** Ordered pool. `slot` is optional; submitted order is the pool order. */
    players?: Array<{ player_name?: string; player_card_id?: string; card_key?: string; slot?: number }>;
    odds?: Array<{ result_slot: string | number; percentage: number | string; description?: string }>;
  };
  evo_paths?: ReleaseEvoPathInput[];
  /**
   * Locker codes shipped with the release. A code may reward the pack created in
   * this same release: set reward_type "pack" and either reward_release_pack
   * (true) or reward_value.pack_name.
   */
  locker_codes?: Array<{
    code: string;
    reward_type?: "coins" | "gems" | "pack" | "card";
    reward_value?: Record<string, unknown>;
    /** Rewards the pack defined in this release, resolved inside the transaction. */
    reward_release_pack?: boolean;
    max_redemptions?: number | null;
    expires_at?: string | null;
    status?: ContentStatus;
  }>;
  /** Challenges shipped with the release, including same-release card/pack rewards. */
  challenges?: ReleaseChallengeInput[];
  /**
   * One Domination road (or an array of them) in the singular GPT shape:
   * `{ road_name, mode, games: [...] }`. Forwarded to the domination_roads group.
   */
  domination?: Record<string, unknown> | Record<string, unknown>[];
  forbid_existing_links_to?: string[];
}

/** Challenge fields the release engine understands. */
export interface ReleaseChallengeInput {
  name: string;
  challenge_id?: string;
  description?: string;
  challenge_type?: string;
  win_condition?: string;
  win_by_amount?: number;
  series_length?: number;
  series_win_coins?: number;
  series_loss_coins?: number;
  opponent_team?: string;
  /** Set true to face the team created in this same release. */
  opponent_release_team?: boolean;
  coin_reward?: number;
  gem_reward?: number;
  /** Rewards a card: a name (resolved, including cards created in this release) or an id. */
  card_reward?: string;
  card_reward_id?: string;
  /** Rewards the pack defined in this release. */
  pack_reward?: string;
  pack_release_reward?: boolean;
  stat_limit_player?: string;
  stat_limit_stat?: string;
  stat_limit_value?: number;
  prerequisite?: string;
  spotlight_group?: string;
  sort_order?: number;
  conditions?: Record<string, unknown>;
  reward_payload?: Record<string, unknown>;
  lineup_restrictions?: Record<string, unknown>;
  is_repeatable?: boolean;
  /** Alias of is_repeatable. */
  repeatable?: boolean;
  /** Numeric goal of the win condition (points scored, games won, stat total, ...). */
  target_value?: number;
  /** Aliases of target_value. */
  target?: number;
  goal?: number;
  /** Alias of win_by_amount. */
  win_by?: number;
  /** Stat the target applies to, e.g. stat_3pt or "three pointers". */
  target_stat?: string;
  /** Grouped rewards: { coins, gems, card, pack }. Flattened onto the real columns. */
  rewards?: { coins?: number; gems?: number; card?: string; pack?: string; [k: string]: unknown };
  expires_at?: string | null;
  status?: ContentStatus;
}

/** Every top-level section a release document may contain. */
export const RELEASE_SECTIONS = [
  "release",
  "collection",
  "players",
  "team",
  "pack",
  "evo_paths",
  "locker_codes",
  "challenges",
  // Singular Domination road object (GPT Actions shape); forwarded to the
  // domination_roads batch group.
  "domination",
  "forbid_existing_links_to",
] as const;

/**
 * Batch groups a release may carry verbatim. They are NOT dropped: each array is
 * forwarded into the admin_apply_batch payload and applied in group order.
 */
export const RELEASE_PASSTHROUGH_GROUPS = [
  "gem_tiers",
  "badges",
  "signature_traits",
  "sub_collections",
  "collection_requirements",
  "gem_tasks",
  "runs",
  "domination_roads",
  "domination_games",
  "dynamic_duos",
  "storylines",
  "location_accounts",
  "social_posts",
] as const;

export interface ValidationResult {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  entity?: string;
}

// ------------------------------------------------------------- normalization

const BADGE_TIER_ALIASES: Record<string, AssignmentTier> = {
  base: "base",
  bronze: "base",
  silver: "base",
  gold: "gold",
  hof: "hof",
  "hall of fame": "hof",
  "hall-of-fame": "hof",
  legend: "hof",
  diamond: "diamond",
  actolytrene: "actolytrene",
  acto: "actolytrene",
};

const STAT_ALIASES: Record<string, StatKey> = {
  "3pt": "stat_3pt",
  three: "stat_3pt",
  "three point": "stat_3pt",
  "three pointers": "stat_3pt",
  mid: "stat_mid",
  "mid range": "stat_mid",
  midrange: "stat_mid",
  fin: "stat_fin",
  finishing: "stat_fin",
  layup: "stat_fin",
  dnk: "stat_dnk",
  dunk: "stat_dnk",
  dunks: "stat_dnk",
  ast: "stat_ast",
  assist: "stat_ast",
  assists: "stat_ast",
  stl: "stat_stl",
  steal: "stat_stl",
  steals: "stat_stl",
  reb: "stat_reb",
  rebound: "stat_reb",
  rebounds: "stat_reb",
  blk: "stat_blk",
  block: "stat_blk",
  blocks: "stat_blk",
  int: "stat_int",
  intangibles: "stat_int",
  iq: "stat_int",
};

/** "Hall of Fame" -> "hof". Unknown values are returned lowercased for validation. */
export function normalizeTier(value: unknown): string {
  const key = String(value ?? "base").trim().toLowerCase();
  return BADGE_TIER_ALIASES[key] ?? key;
}

/** "3PT", "Three Pointers", "stat_3pt" -> "stat_3pt". */
export function normalizeStatKey(value: unknown): string {
  const raw = String(value ?? "").trim().toLowerCase().replace(/[_-]+/g, " ").trim();
  if ((STAT_KEYS as readonly string[]).includes(raw.replace(/\s+/g, "_"))) return raw.replace(/\s+/g, "_");
  if (raw.startsWith("stat ")) {
    const direct = `stat_${raw.slice(5).replace(/\s+/g, "_")}`;
    if ((STAT_KEYS as readonly string[]).includes(direct)) return direct;
  }
  return STAT_ALIASES[raw] ?? raw.replace(/\s+/g, "_");
}

/** "Three Pointers Made" -> "three_pointers_made" (registry key). */
export function normalizeObjectiveKey(value: unknown): string {
  const raw = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const aliases: Record<string, EvoObjectiveKey> = {
    pts: "points",
    points: "points",
    total_points: "points",
    "3pt": "three_pointers_made",
    threes: "three_pointers_made",
    three_pointers: "three_pointers_made",
    three_pointers_made: "three_pointers_made",
    mid_range: "mid_range_shots_made",
    mid_range_shots: "mid_range_shots_made",
    mid_range_shots_made: "mid_range_shots_made",
    dunks: "dunks_made",
    dunks_made: "dunks_made",
    assists: "assists",
    steals: "steals",
    rebounds: "rebounds",
    blocks: "blocks",
    wins: "games_won",
    games_won: "games_won",
  };
  return aliases[raw] ?? raw;
}

function normalizeStats(stats: unknown): StatBlock {
  const out: StatBlock = {};
  for (const [k, v] of Object.entries((stats ?? {}) as Record<string, unknown>)) {
    const key = normalizeStatKey(k) as StatKey;
    out[key] = typeof v === "number" ? v : Number(v);
  }
  return out;
}

/** "run_3pt", "runs 3PT", "run_stat_3pt" -> "run_stat_3pt". */
export function normalizeRunStatKey(value: unknown): string {
  const raw = String(value ?? "").trim().toLowerCase();
  const stripped = raw.replace(/^(run|runs)[\s_-]*(stat[\s_-]*)?/, "");
  const base = normalizeStatKey(stripped);
  return base.startsWith("stat_") ? `run_${base}` : raw.replace(/[\s-]+/g, "_");
}

function normalizeRunStats(stats: unknown): RunStatBlock {
  const out: RunStatBlock = {};
  for (const [k, v] of Object.entries((stats ?? {}) as Record<string, unknown>)) {
    const key = normalizeRunStatKey(k) as RunStatKey;
    out[key] = typeof v === "number" ? v : Number(v);
  }
  return out;
}

/**
 * Pulls flat stat fields off an object into canonical blocks so a card may be
 * described flat (`stat_3pt: 88`, `run_stat_3pt: 90`), nested (`stats`,
 * `run_stats`) or with aliases ("3PT") — all three produce the same payload.
 */
function splitStatFields(source: Record<string, unknown>): {
  rest: Record<string, unknown>;
  stats: StatBlock;
  runStats: RunStatBlock;
} {
  const rest: Record<string, unknown> = {};
  const flat: Record<string, unknown> = {};
  const flatRun: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    const lower = key.trim().toLowerCase();
    if (lower === "stats" || lower === "run_stats" || lower === "runs_stats") continue;
    if (/^(run|runs)[\s_-]*(stat)?[\s_-]*/.test(lower) && (RUN_STAT_KEYS as readonly string[]).includes(normalizeRunStatKey(lower))) {
      flatRun[lower] = value;
    } else if ((STAT_KEYS as readonly string[]).includes(normalizeStatKey(lower))) {
      flat[lower] = value;
    } else {
      rest[key] = value;
    }
  }
  const nestedRun = (source.run_stats ?? (source as Record<string, unknown>).runs_stats) as unknown;
  return {
    rest,
    stats: { ...normalizeStats(source.stats), ...normalizeStats(flat) },
    runStats: { ...normalizeRunStats(nestedRun), ...normalizeRunStats(flatRun) },
  };
}


function normalizeAssignments(list: unknown, kind: "badge" | "trait"): Assignment[] {
  return (Array.isArray(list) ? list : []).map((raw) => {
    const item = typeof raw === "string" ? { [kind]: raw } : { ...(raw as Record<string, unknown>) };
    const out: Assignment = {
      tier: normalizeTier(item.tier) as AssignmentTier,
    };
    const name = (item[kind] ?? item.name) as string | undefined;
    if (kind === "badge") {
      out.badge = name;
      if (item.badge_id) out.badge_id = String(item.badge_id);
    } else {
      out.trait = name;
      if (item.trait_id) out.trait_id = String(item.trait_id);
      if (item.target_stat) out.target_stat = normalizeStatKey(item.target_stat) as StatKey;
    }
    return out;
  });
}

/**
 * Runs stats sit on their own point scale: every star of a base stat is worth
 * twenty Runs points (star 0 = 0-19, star 1 = 20-39, ... star 6 = 120-139).
 * Missing values are derived from the base stats, correlated with the star value
 * and its decimals and randomised deterministically inside the band.
 *
 * The derivation itself lives in the shared playable-card model so normal cards
 * and evo card versions can never diverge.
 */
function completeRunStats(
  stats: Record<string, unknown>,
  runStats: Record<string, unknown>,
  seed: string,
): RunStatBlock {
  return sharedCompleteRunStats(stats, runStats, seed) as RunStatBlock;
}


/** Validates supplied Runs stats against the Runs point scale and their bands. */
function validateRunStats(
  stats: Record<string, unknown>,
  runStats: Record<string, unknown>,
  scope: string,
  err: (code: string, message: string, path: string) => void,
) {
  for (const [stat, value] of Object.entries(runStats)) {
    if (!(RUN_STAT_KEYS as readonly string[]).includes(stat)) {
      err("UNKNOWN_RUN_STAT_KEY", `"${stat}" is not a supported Runs stat.`, scope);
      continue;
    }
    if (typeof value !== "number" || Number.isNaN(value) || value < RUN_STAT_RANGE.min || value > RUN_STAT_RANGE.max) {
      err(
        "STAT_OUT_OF_RANGE",
        `${stat} must be between ${RUN_STAT_RANGE.min} and ${RUN_STAT_RANGE.max} on the Runs point scale.`,
        scope,
      );
      continue;
    }
    const base = stats[stat.replace("run_", "")];
    if (base === undefined || base === null) continue;
    if (!runStatMatchesBase(base as number, value)) {
      const band = runBandForBase(base as number);
      err(
        "RUN_STAT_SCALE_MISMATCH",
        `${stat} must sit inside ${runBandLabel(band)} for a base value of ${String(base)}. ${RUN_SCALE_DOC}`,
        scope,
      );
    }
  }
}

/** Normalizes an imported release document. Never writes anything. */
export function normalizeRelease(input: ContentReleaseInput): ContentReleaseInput {
  const out: ContentReleaseInput = JSON.parse(JSON.stringify(input ?? {}));
  out.players = (out.players ?? []).map((p) => {
    const { rest, stats, runStats } = splitStatFields(p as unknown as Record<string, unknown>);
    const seed = String(p.player_card_id ?? p.name ?? "");
    return {
      ...(rest as unknown as ReleasePlayerInput),
      stats,
      run_stats: completeRunStats(stats, runStats, seed),
      badges: normalizeAssignments(p.badges, "badge"),
      traits: normalizeAssignments(p.traits, "trait"),
    };
  });
  out.evo_paths = (out.evo_paths ?? []).map((path) => ({
    ...path,
    steps: [...(path.steps ?? [])]
      .sort((a, b) => a.step_order - b.step_order)
      .map((step) => {
        const version = (step.resulting_version ?? { stats: {} }) as Record<string, unknown>;
        const { rest, stats, runStats } = splitStatFields(version);
        // Same seed shape as normal cards so a version's Runs stats are stable
        // across preview and commit.
        const seed = `${path.player_name ?? path.player_card_id ?? ""}|step${step.step_order}`;
        const completedRunStats = completeRunStats(stats, runStats, seed);
        const runRating = completeRunRating(completedRunStats, (version.run_rating ?? null) as number | null);
        return {
          ...step,
          objectives: (step.objectives ?? []).map((o) => ({
            ...o,
            stat: normalizeObjectiveKey(o.stat),
            amount: Number(o.amount),
          })),
          resulting_version: {
            ...(rest as ReleaseStepInput["resulting_version"]),
            stats,
            run_stats: completedRunStats,
            ...(runRating !== null ? { run_rating: runRating } : {}),
            badges: normalizeAssignments(version.badges, "badge"),
            traits: normalizeAssignments(version.traits, "trait"),
          },
        };
      }),

  }));
  if (out.pack) {
    // `slot` is optional: submitted order IS the pool order, so fill it in
    // before sorting so preview and commit see the identical canonical pool.
    out.pack.players = [...(out.pack.players ?? [])]
      .map((p, i) => ({ ...p, slot: typeof p.slot === "number" && p.slot > 0 ? p.slot : i + 1 }))
      .sort((a, b) => a.slot - b.slot);
    out.pack.odds = (out.pack.odds ?? []).map((o) => ({ ...o, result_slot: String(o.result_slot) }));
  }
  if (out.locker_codes?.length) {
    out.locker_codes = out.locker_codes.map((c) => ({
      ...c,
      code: String(c.code ?? "").trim().toUpperCase(),
      reward_type: c.reward_type ?? (c.reward_release_pack ? "pack" : "coins"),
    }));
  }
  if (out.challenges?.length) {
    out.challenges = out.challenges.map((c) => ({
      ...c,
      name: String(c.name ?? "").trim(),
      ...(c.stat_limit_stat ? { stat_limit_stat: normalizeStatKey(c.stat_limit_stat) } : {}),
    }));
  }
  if (out.team) out.team.roster = [...(out.team.roster ?? [])].sort((a, b) => a.slot - b.slot);
  return out;
}

// --------------------------------------------------------------- odds (exact)

/**
 * Sums percentages in fixed-precision hundredths — never binary floats — so
 * 33.33 + 33.33 + 33.34 is exactly 100.
 */
export function oddsTotalHundredths(odds: Array<{ percentage: number | string }>): number {
  return (odds ?? []).reduce((sum, row) => sum + toHundredths(row.percentage), 0);
}

export function toHundredths(value: number | string): number {
  const text = typeof value === "number" ? value.toFixed(4) : String(value ?? "").trim();
  const match = text.match(/^-?\d+(\.\d+)?$/);
  if (!match) return NaN;
  const negative = text.startsWith("-");
  const [whole, frac = ""] = text.replace("-", "").split(".");
  const cents = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  const remainder = frac.slice(2).replace(/0+$/, "");
  if (remainder) return NaN; // more precision than hundredths is not representable
  return negative ? -cents : cents;
}

export function formatHundredths(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

// ---------------------------------------------------------------- validation

interface ValidateOptions {
  /** Gem tier names ordered from lowest to highest (the tier progression graph). */
  tierOrder?: string[];
  /** Extra transitions allowed to skip intermediate tiers, e.g. "diamond>actolytrene". */
  allowedSkips?: string[];
}

const sameRef = (a: string | undefined, b: string | undefined) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();



/** Full zero-write validation. Collects every problem instead of failing fast. */
export function validateRelease(
  input: ContentReleaseInput,
  options: ValidateOptions = {},
): ValidationResult[] {
  const release = normalizeRelease(input);
  const out: ValidationResult[] = [];
  const err = (code: string, message: string, entity?: string) =>
    out.push({ code, severity: "error", message, entity });
  const warn = (code: string, message: string, entity?: string) =>
    out.push({ code, severity: "warning", message, entity });

  if (!release.release?.name?.trim()) err("RELEASE_NAME_REQUIRED", "Release name is required.", "release");

  // No section is ever silently dropped: a key is either a release section, a
  // forwarded batch group, or an explicit UNKNOWN_RELEASE_SECTION error.
  for (const [key, value] of Object.entries((input ?? {}) as Record<string, unknown>)) {
    if ((RELEASE_SECTIONS as readonly string[]).includes(key)) continue;
    if ((RELEASE_PASSTHROUGH_GROUPS as readonly string[]).includes(key)) {
      if (!Array.isArray(value)) {
        err("INVALID_RELEASE_GROUP", `"${key}" must be an array of items.`, key);
      }
      continue;
    }
    err(
      "UNKNOWN_RELEASE_SECTION",
      `"${key}" is not a release section. Sections: ${RELEASE_SECTIONS.join(", ")}. Forwarded groups: ${RELEASE_PASSTHROUGH_GROUPS.join(", ")}.`,
      key,
    );
  }

  const players = release.players ?? [];
  const known = (ref: { player_name?: string; player_card_id?: string }) =>
    players.some(
      (p) =>
        (ref.player_card_id && p.player_card_id === ref.player_card_id) ||
        sameRef(p.name, ref.player_name) ||
        sameRef(p.new_name, ref.player_name),
    );

  // players
  const seen = new Map<string, number>();
  players.forEach((p, i) => {
    const scope = `players[${i}]`;
    if (!p.name?.trim() && !p.player_card_id) {
      err("PLAYER_REF_REQUIRED", "Each player needs a name or player_card_id.", scope);
    }
    const key = (p.player_card_id ?? p.name ?? "").trim().toLowerCase();
    if (key) seen.set(key, (seen.get(key) ?? 0) + 1);
    for (const [stat, value] of Object.entries(p.stats ?? {})) {
      if (!(STAT_KEYS as readonly string[]).includes(stat)) {
        err("UNKNOWN_STAT_KEY", `"${stat}" is not a supported stat.`, `${scope}.stats`);
      } else if (typeof value !== "number" || Number.isNaN(value) || value < STAT_RANGE.min || value > STAT_RANGE.max) {
        err("STAT_OUT_OF_RANGE", `${stat} must be between ${STAT_RANGE.min} and ${STAT_RANGE.max}.`, `${scope}.stats`);
      }
    }
    validateRunStats(p.stats ?? {}, p.run_stats ?? {}, `${scope}.run_stats`, err);
    if (p.run_rating !== undefined && p.run_rating !== null) {
      const expected = runRatingFromStats((p.run_stats ?? {}) as Record<string, unknown>);
      if (expected !== null && Math.abs(Number(p.run_rating) - Number(expected)) > 1) {
        err(
          "RUN_RATING_MISMATCH",
          `run_rating must be the mean of the nine Runs stats (${expected}). ${RUN_SCALE_DOC}`,
          `${scope}.run_rating`,
        );
      }
    }
    validateAssignments(p.badges, p.traits, scope, err);
  });
  for (const [key, count] of seen) {
    if (count > 1) {
      err(
        "AMBIGUOUS_PLAYER_NAME",
        `"${key}" appears ${count} times in this release — supply player_card_id to disambiguate.`,
        "players",
      );
    }
  }

  // collection — a release may create a brand-new collection out of cards that
  // already exist in the database. Such members are resolved server-side by
  // player_card_id or unique name, so they are informational, never errors.
  const collection = release.collection;
  if (collection?.name?.trim()) {
    const members = collection.player_cards ?? [];
    const slots = new Set<number>();
    members.forEach((m, i) => {
      const scope = `collection.player_cards[${i}]`;
      if (!m.player_card_id && !m.player_name?.trim()) {
        err("MEMBER_REF_REQUIRED", "Each collection member needs player_name or player_card_id.", scope);
      } else if (!known(m)) {
        out.push({
          code: "EXISTING_COLLECTION_MEMBER",
          severity: "info",
          message: `"${m.player_name ?? m.player_card_id}" is not defined in this release and will be resolved from existing player cards.`,
          entity: scope,
        });
      }
      if (m.slot != null) {
        if (slots.has(m.slot)) err("DUPLICATE_COLLECTION_SLOT", `Slot ${m.slot} is used twice.`, scope);
        slots.add(m.slot);
      }
    });

    // One canonical identity per reward candidate so a membership entry flagged
    // is_reward and an equivalent reward_player_* field are never double-counted.
    const canonical = (ref: { player_name?: string; player_card_id?: string }) => {
      if (ref.player_card_id) return `id:${ref.player_card_id.toLowerCase()}`;
      const name = ref.player_name?.trim().toLowerCase() ?? "";
      const match = players.find((p) => sameRef(p.name, name) || sameRef(p.new_name, name));
      if (match?.player_card_id) return `id:${match.player_card_id.toLowerCase()}`;
      return `name:${name}`;
    };
    const rewardRefs = new Set<string>();
    members.filter((m) => m.is_reward).forEach((m) => rewardRefs.add(canonical(m)));
    players
      .filter((p) => p.is_collection_reward)
      .forEach((p) => rewardRefs.add(canonical({ player_name: p.name, player_card_id: p.player_card_id })));
    if (collection.reward_player_card_id || collection.reward_player_name) {
      rewardRefs.add(
        canonical({
          player_card_id: collection.reward_player_card_id,
          player_name: collection.reward_player_name,
        }),
      );
    }
    const rewardName =
      collection.reward_player_name ??
      members.find((m) => m.is_reward)?.player_name ??
      players.find((p) => p.is_collection_reward)?.name;
    if (rewardRefs.size > 1) {
      err(
        "MULTIPLE_COLLECTION_REWARDS",
        `Exactly one card may be the collection reward (found ${[...rewardRefs].join(", ")}).`,
        "collection.reward",
      );
    }
    if (!rewardRefs.size) {
      warn("NO_COLLECTION_REWARD", "This collection has no completion reward card.", "collection.reward");
    }
    if (rewardName && release.pack?.players?.some((s) => sameRef(s.player_name, rewardName))) {
      err(
        "REWARD_IN_PACK",
        `"${rewardName}" is the collection reward and must not be pullable from the pack.`,
        "pack.players",
      );
    }
  }


  // cross-release safety
  for (const forbidden of release.forbid_existing_links_to ?? []) {
    if (players.some((p) => sameRef(p.collection, forbidden))) {
      err(
        "FORBIDDEN_EXISTING_LINK",
        `A card in this release is still linked to "${forbidden}", which this release forbids.`,
        "forbid_existing_links_to",
      );
    }
  }

  // team
  if (release.team?.name) {
    const slots = new Set<number>();
    (release.team.roster ?? []).forEach((r, i) => {
      const scope = `team.roster[${i}]`;
      if (!known(r)) err("UNKNOWN_ROSTER_CARD", `"${r.player_name ?? r.player_card_id}" is not part of this release.`, scope);
      if (slots.has(r.slot)) err("DUPLICATE_ROSTER_SLOT", `Roster slot ${r.slot} is used twice.`, scope);
      slots.add(r.slot);
    });
  }

  // pack
  const pack = release.pack;
  if (pack?.name?.trim() || pack?.pack_id || pack?.players?.length || pack?.odds?.length) {
    if (!pack?.name?.trim() && !pack?.pack_id) {
      err("PACK_NAME_REQUIRED", "Pack name or pack_id is required when a pack is included.", "pack");
    }
    const slots = new Set<number>();
    (pack?.players ?? []).forEach((s, i) => {
      const scope = `pack.players[${i}]`;
      if (slots.has(s.slot as number)) err("DUPLICATE_POOL_SLOT", `Pool slot ${s.slot} is used twice.`, scope);
      slots.add(s.slot as number);
      // A pool card may be created in this release OR already exist; existing
      // cards are targeted by immutable id / card_key and resolved server-side.
      if (!s.player_card_id && !s.card_key && !known(s)) {
        err("UNKNOWN_POOL_CARD", `"${s.player_name ?? s.player_card_id}" is not part of this release.`, scope);
      }
      }
    });
    const ordered = [...slots].sort((a, b) => a - b);
    ordered.forEach((slot, i) => {
      if (slot !== i + 1) {
        warn("POOL_SLOT_GAP", `Pool slots are not sequential from 1 (found ${slot} at position ${i + 1}).`, "pack.players");
      }
    });

    const oddsSeen = new Set<string>();
    (pack?.odds ?? []).forEach((row, i) => {
      const scope = `pack.odds[${i}]`;
      const resultSlot = String(row.result_slot ?? "").trim();
      const cents = toHundredths(row.percentage);
      if (Number.isNaN(cents)) {
        err("INVALID_PERCENTAGE", `"${row.percentage}" is not a percentage with at most two decimals.`, scope);
      } else if (cents <= 0) {
        err("NON_POSITIVE_PERCENTAGE", "Percentage must be greater than 0.", scope);
      }
      if (oddsSeen.has(resultSlot)) {
        err("DUPLICATE_ODDS_ROW", `result_slot "${resultSlot}" appears more than once.`, scope);
      }
      oddsSeen.add(resultSlot);
      const numeric = Number(resultSlot);
      const special = (SPECIAL_ODDS_SLOTS as readonly string[]).includes(resultSlot);
      // With no pool submitted the pack keeps its existing pool, so slot
      // membership is validated inside the transaction instead.
      if (!special && (!Number.isFinite(numeric) || (slots.size > 0 && !slots.has(numeric)))) {
        err("UNKNOWN_RESULT_SLOT", `result_slot "${resultSlot}" is not in the pool.`, scope);
      }
    });
    if (pack?.odds?.length) {
      const total = oddsTotalHundredths(pack.odds);
      if (total !== 10000) {
        err("ODDS_NOT_100", `Odds total ${formatHundredths(total)}% — must be exactly 100.00%.`, "pack.odds");
      }
    }
  }

  // evo paths + materialized versions
  const tierOrder = (options.tierOrder ?? []).map((t) => t.toLowerCase());
  const tierIndex = new Map(tierOrder.map((t, i) => [t, i]));
  const skips = new Set((options.allowedSkips ?? []).map((s) => s.toLowerCase()));

  (release.evo_paths ?? []).forEach((path, pi) => {
    const scope = `evo_paths[${pi}]`;
    const base = players.find(
      (p) =>
        (path.player_card_id && p.player_card_id === path.player_card_id) || sameRef(p.name, path.player_name),
    );
    if (!path.player_name && !path.player_card_id && !path.card_key) {
      err("EVO_PLAYER_REQUIRED", "Evo path needs player_card_id, card_key or player_name.", scope);
    } else if (!base) {
      // An evo-only release may target a card that already exists and is not
      // recreated here. It is resolved server-side by immutable id, card_key or
      // exact unique name (ambiguous names are rejected inside the transaction).
      out.push({
        code: "EXISTING_EVO_SOURCE_CARD",
        severity: "info",
        message: path.player_card_id
          ? `Evo source card ${path.player_card_id} is resolved from existing player cards; this release does not modify it.`
          : `"${path.player_name ?? path.card_key}" is not defined in this release and is resolved from existing player cards by exact name (ambiguous names are rejected).`,
        entity: scope,
      });
    }
    const steps = path.steps ?? [];
    if (!steps.length) err("EVO_NO_STEPS", "Evo path needs at least one step.", scope);

    const sourceTier = base?.gem_tier ?? path.source_gem_tier;

    steps.forEach((step, si) => {
      const sScope = `${scope}.steps[${si}]`;
      if (step.step_order !== si + 1) {
        err("EVO_STEP_ORDER", `Step order must be contiguous from 1 (expected ${si + 1}, got ${step.step_order}).`, sScope);
      }
      if (!step.from_tier || !step.to_tier) {
        err("EVO_TIER_REQUIRED", "Both from_tier and to_tier are required.", sScope);
      }
      if (si === 0 && sourceTier && step.from_tier && !sameRef(sourceTier, step.from_tier)) {
        err(
          "EVO_FIRST_STEP_TIER",
          `First step must start at the source card tier "${sourceTier}" (got "${step.from_tier}").`,
          sScope,
        );
      }

      if (si > 0 && steps[si - 1].to_tier && step.from_tier && !sameRef(steps[si - 1].to_tier, step.from_tier)) {
        err(
          "EVO_STEP_CHAIN",
          `Step must start from "${steps[si - 1].to_tier}" (the previous version's tier).`,
          sScope,
        );
      }
      if (tierIndex.size && step.from_tier && step.to_tier) {
        const from = tierIndex.get(step.from_tier.toLowerCase());
        const to = tierIndex.get(step.to_tier.toLowerCase());
        if (from == null) err("UNKNOWN_GEM_TIER", `Unknown tier "${step.from_tier}".`, sScope);
        if (to == null) err("UNKNOWN_GEM_TIER", `Unknown tier "${step.to_tier}".`, sScope);
        if (from != null && to != null) {
          if (to <= from) {
            err("INVALID_TIER_PROGRESSION", `"${step.to_tier}" does not progress past "${step.from_tier}".`, sScope);
          } else if (to - from > 1 && !skips.has(`${step.from_tier.toLowerCase()}>${step.to_tier.toLowerCase()}`)) {
            const missing = tierOrder.slice(from + 1, to);
            err(
              "MISSING_INTERMEDIATE_TIER",
              `Missing intermediate step(s) for ${missing.join(", ")} between "${step.from_tier}" and "${step.to_tier}".`,
              sScope,
            );
          }
        }
      }

      if (!step.objectives?.length) err("EVO_NO_OBJECTIVES", "Each step needs at least one objective.", sScope);
      step.objectives?.forEach((obj, oi) => {
        const oScope = `${sScope}.objectives[${oi}]`;
        if (!(obj.stat in EVO_OBJECTIVES)) {
          out.push({
            code: "UNSUPPORTED_OBJECTIVE",
            severity: "error",
            message: `"${obj.stat}" is not a supported tracked objective (${Object.keys(EVO_OBJECTIVES).join(", ")}).`,
            entity: oScope,
          });
        }
        if (!Number.isFinite(obj.amount) || obj.amount <= 0) {
          err("INVALID_OBJECTIVE_TARGET", "Objective amount must be a positive number.", oScope);
        }
      });

      const version = step.resulting_version;
      if (!version || !version.stats || !Object.keys(version.stats).length) {
        err(
          "MISSING_RESULTING_VERSION",
          `Step ${step.step_order} (${step.from_tier} → ${step.to_tier}) has no resulting_version stats — every step must materialize a playable card version.`,
          sScope,
        );
      } else {
        for (const [stat, value] of Object.entries(version.stats)) {
          if (!(STAT_KEYS as readonly string[]).includes(stat)) {
            err("UNKNOWN_STAT_KEY", `"${stat}" is not a supported stat.`, `${sScope}.resulting_version.stats`);
          } else if (typeof value !== "number" || Number.isNaN(value) || value < STAT_RANGE.min || value > STAT_RANGE.max) {
            err(
              "STAT_OUT_OF_RANGE",
              `${stat} must be between ${STAT_RANGE.min} and ${STAT_RANGE.max}.`,
              `${sScope}.resulting_version.stats`,
            );
          }
        }
        validateRunStats(
          version.stats ?? {},
          version.run_stats ?? {},
          `${sScope}.resulting_version.run_stats`,
          err,
        );
        if (version.run_rating !== undefined && version.run_rating !== null) {
          const expectedRun = runRatingFromStats((version.run_stats ?? {}) as Record<string, unknown>);
          if (expectedRun !== null && Math.abs(Number(version.run_rating) - Number(expectedRun)) > 1) {
            err(
              "RUN_RATING_MISMATCH",
              `run_rating must be the mean of the nine Runs stats (${expectedRun}). ${RUN_SCALE_DOC}`,
              `${sScope}.resulting_version.run_rating`,
            );
          }
        }
        validateAssignments(version.badges, version.traits, `${sScope}.resulting_version`, err);

      }
    });

    // one version per step, contiguous version order
    const orders = steps.map((s) => s.step_order);
    if (new Set(orders).size !== orders.length) {
      err("DUPLICATE_EVO_VERSION_ORDER", "Two steps share the same step_order, so their versions would collide.", scope);
    }
  });

  // evo versions must never be pullable or counted as collection cards
  const versionTiers = new Set(
    (release.evo_paths ?? []).flatMap((p) => (p.steps ?? []).map((s) => `${p.player_name}|${s.to_tier}`.toLowerCase())),
  );
  (release.pack?.players ?? []).forEach((s, i) => {
    if (versionTiers.has(`${s.player_name}|${s.player_name}`.toLowerCase())) {
      err("EVO_VERSION_IN_PACK", "Evo versions cannot be added to a pack pool.", `pack.players[${i}]`);
    }
  });

  // locker codes
  const codesSeen = new Set<string>();
  (release.locker_codes ?? []).forEach((c, i) => {
    const scope = `locker_codes[${i}]`;
    const code = String(c.code ?? "").trim();
    if (!code) err("LOCKER_CODE_REQUIRED", "Each locker code needs a code.", scope);
    if (codesSeen.has(code.toUpperCase())) {
      err("DUPLICATE_LOCKER_CODE", `Code "${code}" appears more than once in this release.`, scope);
    }
    codesSeen.add(code.toUpperCase());
    const type = c.reward_type ?? (c.reward_release_pack ? "pack" : "coins");
    if (!["coins", "gems", "pack", "card"].includes(type)) {
      err("INVALID_LOCKER_REWARD_TYPE", `"${type}" is not a locker reward type (coins, gems, pack, card).`, scope);
    }
    if (type === "pack") {
      const named = c.reward_value?.pack_name ?? c.reward_value?.pack_id;
      if (!c.reward_release_pack && !named) {
        err(
          "LOCKER_PACK_REF_REQUIRED",
          "A pack reward needs reward_release_pack: true (the pack in this release) or reward_value.pack_name.",
          scope,
        );
      }
      if (c.reward_release_pack && !release.pack?.name?.trim()) {
        err("LOCKER_RELEASE_PACK_MISSING", "reward_release_pack is set but this release does not define a pack.", scope);
      }
    } else if ((type === "coins" || type === "gems") && !(Number(c.reward_value?.amount) > 0)) {
      err("LOCKER_AMOUNT_REQUIRED", `A ${type} reward needs reward_value.amount greater than 0.`, scope);
    } else if (type === "card" && !c.reward_value?.card_name && !c.reward_value?.player_card_id) {
      err("LOCKER_CARD_REF_REQUIRED", "A card reward needs reward_value.card_name or reward_value.player_card_id.", scope);
    }
  });

  // challenges
  const challengeNames = new Set<string>();
  (release.challenges ?? []).forEach((c, i) => {
    const scope = `challenges[${i}]`;
    const name = String(c.name ?? "").trim();
    if (!name) err("CHALLENGE_NAME_REQUIRED", "Each challenge needs a name.", scope);
    if (name && challengeNames.has(name.toLowerCase())) {
      err("DUPLICATE_CHALLENGE", `Challenge "${name}" appears more than once in this release.`, scope);
    }
    challengeNames.add(name.toLowerCase());
    if (c.card_reward && !c.card_reward_id && !known({ player_name: c.card_reward })) {
      out.push({
        code: "EXISTING_CHALLENGE_REWARD_CARD",
        severity: "info",
        message: `"${c.card_reward}" is not defined in this release and is resolved from existing player cards (ambiguous names are rejected).`,
        entity: `${scope}.card_reward`,
      });
    }
    if (c.pack_release_reward && !release.pack?.name?.trim()) {
      err("CHALLENGE_RELEASE_PACK_MISSING", "pack_release_reward is set but this release does not define a pack.", scope);
    }
    if (c.opponent_release_team && !release.team?.name?.trim()) {
      err("CHALLENGE_RELEASE_TEAM_MISSING", "opponent_release_team is set but this release does not define a team.", scope);
    }
    if (c.stat_limit_stat && !(STAT_KEYS as readonly string[]).includes(normalizeStatKey(c.stat_limit_stat))) {
      err("INVALID_CHALLENGE_STAT", `"${c.stat_limit_stat}" is not one of the nine base stats.`, `${scope}.stat_limit_stat`);
    }
    for (const field of ["coin_reward", "gem_reward", "sort_order", "win_by_amount", "series_length"] as const) {
      const value = c[field];
      if (value !== undefined && value !== null && !Number.isFinite(Number(value))) {
        err("INVALID_CHALLENGE_NUMBER", `${field} must be a number.`, `${scope}.${field}`);
      }
    }
  });

  return out;

}

function validateAssignments(
  badges: Assignment[] | undefined,
  traits: Assignment[] | undefined,
  scope: string,
  err: (code: string, message: string, entity?: string) => void,
) {
  const badgeSeen = new Set<string>();
  (badges ?? []).forEach((b, i) => {
    const key = (b.badge_id ?? b.badge ?? "").toLowerCase();
    if (!key) err("BADGE_REF_REQUIRED", "Badge needs a name or badge_id.", `${scope}.badges[${i}]`);
    if (key && badgeSeen.has(key)) {
      err("DUPLICATE_BADGE_ASSIGNMENT", `Badge "${b.badge ?? key}" is assigned twice.`, `${scope}.badges[${i}]`);
    }
    badgeSeen.add(key);
    if (b.tier && !(ASSIGNMENT_TIERS as readonly string[]).includes(b.tier)) {
      err("INVALID_BADGE_TIER", `"${b.tier}" is not a badge tier.`, `${scope}.badges[${i}]`);
    }
  });
  const traitSeen = new Set<string>();
  (traits ?? []).forEach((t, i) => {
    const key = (t.trait_id ?? t.trait ?? "").toLowerCase();
    if (!key) err("TRAIT_REF_REQUIRED", "Trait needs a name or trait_id.", `${scope}.traits[${i}]`);
    if (key && traitSeen.has(key)) {
      err("DUPLICATE_TRAIT_ASSIGNMENT", `Trait "${t.trait ?? key}" is assigned twice.`, `${scope}.traits[${i}]`);
    }
    traitSeen.add(key);
    if (t.tier && !(ASSIGNMENT_TIERS as readonly string[]).includes(t.tier)) {
      err("INVALID_TRAIT_TIER", `"${t.tier}" is not a trait tier.`, `${scope}.traits[${i}]`);
    }
    if (t.target_stat && !(STAT_KEYS as readonly string[]).includes(t.target_stat)) {
      err("INVALID_TRAIT_TARGET_STAT", `"${t.target_stat}" is not a valid trait target stat.`, `${scope}.traits[${i}]`);
    }
  });

  // Five badges and one signature trait, unless Mr. Versatile raises the caps.
  for (const issue of checkAssignmentLimits(badges, traits)) {
    err(issue.code, issue.message, `${scope}.${issue.field}`);
  }
}

// ------------------------------------------------------------ payload builder

const slug = (value: string) =>
  value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

const RELEASE_REF = "ref:release:main";
const COLLECTION_REF = "ref:collection:main";
const PACK_REF = "ref:pack:main";
const TEAM_REF = "ref:team:main";
const cardRef = (name: string) => `ref:player:${slug(name)}`;

/**
 * Source-card fields for an evo path item. An existing card is targeted by its
 * immutable `player_card_id` (never treated as a temp ref), or by `card_key`, or
 * by exact name plus any distinguishing fields so the database rejects ambiguous
 * names. Only a card created in this same release uses a temp ref.
 */
function evoSourceFields(release: ContentReleaseInput, path: ReleaseEvoPathInput): Record<string, unknown> {
  const match = (release.players ?? []).find(
    (p) =>
      (path.player_card_id && p.player_card_id === path.player_card_id) ||
      sameRef(p.name, path.player_name) ||
      sameRef(p.new_name, path.player_name),
  );
  const id = path.player_card_id ?? match?.player_card_id;
  if (id) return { player_card_id: id };
  if (path.card_key) return { source: { card_key: path.card_key } };
  if (match) return { player_card_ref: cardRef(match.name) };
  const name = (path.player_name ?? "").trim();
  const distinguishing: Record<string, unknown> = { name };
  for (const key of ["rating", "collection", "sub_collection", "team", "card_variant", "evo_stage"] as const) {
    if (path[key] != null) distinguishing[key] = path[key];
  }
  if (path.source_gem_tier) distinguishing.gem_tier = path.source_gem_tier;
  return Object.keys(distinguishing).length > 1
    ? { player_name: name, source: distinguishing }
    : { player_name: name };
}


/**
 * Card reference fields for a batch item. Cards defined in this release use a
 * temp_ref; cards that already exist are referenced by id, or by name so the
 * database resolves them (and rejects ambiguous names) inside the transaction.
 */
function cardRefFields(
  release: ContentReleaseInput,
  ref: { player_name?: string; player_card_id?: string },
): Record<string, unknown> {
  if (ref.player_card_id) return { player_card_id: ref.player_card_id };
  const match = (release.players ?? []).find(
    (p) => sameRef(p.name, ref.player_name) || sameRef(p.new_name, ref.player_name),
  );
  if (match?.player_card_id) return { player_card_id: match.player_card_id };
  if (match) return { player_ref: cardRef(match.name) };
  return { player_name: (ref.player_name ?? "").trim() };
}


/**
 * Turns a release document into an `admin_apply_batch` payload. Cross-entity
 * links use temp_refs so cards, collection, team, pack and evo versions all
 * resolve inside the single commit transaction.
 */
export function buildReleasePayload(input: ContentReleaseInput): Record<string, unknown> {
  const release = normalizeRelease(input);
  const payload: Record<string, unknown> = {
    release_bundles: [
      {
        temp_ref: RELEASE_REF,
        action: "upsert",
        name: release.release.name,
        notes: release.release.description ?? null,
        status: releaseStatus(release.release.status),
      },
    ],
  };

  if (release.players?.length) {
    payload.players = release.players.map((p) => {
      const { stats, run_stats, is_collection_reward, new_name, player_card_id, badges, traits, ...rest } = p;
      return {
        ...(player_card_id ? { id: player_card_id } : { temp_ref: cardRef(p.name) }),
        action: player_card_id ? "update" : "upsert",
        ...rest,
        ...(new_name ? { name: new_name } : {}),
        ...(stats ?? {}),
        ...(run_stats ?? {}),
        ...(badges?.length ? { badges, replace_badges: true } : {}),
        ...(traits?.length ? { traits, replace_traits: true } : {}),
        release_bundle_ref: RELEASE_REF,
      };
    });
  }

  const collection = release.collection;
  if (collection?.name?.trim()) {
    const rewardTarget: { player_name?: string; player_card_id?: string } | undefined =
      collection.reward_player_card_id || collection.reward_player_name
        ? { player_card_id: collection.reward_player_card_id, player_name: collection.reward_player_name }
        : (() => {
            const flagged = collection.player_cards?.find((m) => m.is_reward);
            if (flagged) return { player_name: flagged.player_name, player_card_id: flagged.player_card_id };
            const own = (release.players ?? []).find((p) => p.is_collection_reward);
            return own ? { player_name: own.name, player_card_id: own.player_card_id } : undefined;
          })();
    const rewardFields = rewardTarget ? cardRefFields(release, rewardTarget) : undefined;

    const members =
      collection.player_cards?.length
        ? [...collection.player_cards].sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0))
        : (release.players ?? []).map((p, i) => ({
            player_name: p.name,
            player_card_id: p.player_card_id,
            slot: i + 1,
            is_reward: p.is_collection_reward,
          }));

    // Requirements ride along on the collection item itself so the collection
    // name is always present in the same write — a separate group referencing an
    // unwritten collection would look like a nameless new collection in preview.
    payload.collections = [
      {
        temp_ref: COLLECTION_REF,
        action: "upsert",
        name: collection.name,
        description: collection.description ?? null,
        release_bundle_ref: RELEASE_REF,
        ...(rewardFields
          ? rewardFields.player_card_id
            ? { reward_card_id: rewardFields.player_card_id }
            : rewardFields.player_ref
              ? { reward_card_ref: rewardFields.player_ref }
              : { reward_card: rewardFields }
          : {}),

        replace_requirements: true,
        requirements: members.map((m, i) => ({
          ...cardRefFields(release, m),
          sort_order: m.slot ?? i + 1,
          is_reward_card: !!m.is_reward,
        })),
      },
    ];
  }


  if (release.team?.name) {
    payload.teams = [
      {
        action: "upsert",
        name: release.team.name,
        temp_ref: TEAM_REF,
        ...(release.team.category ? { category: release.team.category } : {}),
        ...(release.team.unlock_cost != null ? { unlock_cost: release.team.unlock_cost } : {}),
        release_bundle_ref: RELEASE_REF,
        replace_roster: true,
        roster: [...(release.team.roster ?? [])]
          .sort((a, b) => a.slot - b.slot)
          .map((r) => ({ slot_number: r.slot, ...cardRefFields(release, r) })),
      },
    ];
  }

  const pack = release.pack;
  if (pack?.name?.trim() || pack?.pack_id) {
    payload.packs = [
      {
        temp_ref: PACK_REF,
        action: "upsert",
        // pack_id is authoritative; the batch writer resolves the name from it.
        ...(pack.pack_id ? { pack_id: pack.pack_id } : {}),
        ...(pack.name?.trim() ? { name: pack.name.trim() } : {}),
        ...(pack.new_name ? { new_name: pack.new_name } : {}),
        ...(pack.pack_type ? { pack_type: pack.pack_type } : {}),
        ...(pack.cost != null ? { cost: pack.cost } : {}),
        ...(pack.ten_box_cost !== undefined ? { ten_box_cost: pack.ten_box_cost } : {}),
        ...(pack.status ? { status: releaseStatus(pack.status) } : {}),
        release_bundle_ref: RELEASE_REF,
        ...(collection?.name ? { collection_ref: COLLECTION_REF } : {}),
        // `players` is the ordered pool the batch writer replaces wholesale.
        // Omit the key entirely to keep the pack's current pool.
        ...(pack.players
          ? {
              replace_pool: true,
              players: [...pack.players]
                .sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0))
                .map((s) => ({ ...cardRefFields(release, s), slot_number: s.slot })),
            }
          : {}),
        ...(pack.odds
          ? {
              replace_odds: true,
              odds: pack.odds.map((o) => ({
                dice_roll: String(o.result_slot),
                result_slot: String(o.result_slot),
                percentage: Number(formatHundredths(toHundredths(o.percentage))),
                description: o.description ?? null,
                ...(pack.pack_type ? { pack_type: pack.pack_type } : {}),
              })),
            }
          : {}),
      },
    ];
  }


  if (release.evo_paths?.length) {
    // Every path is submitted as ONE item so the database applies explicit
    // whole-path replacement semantics in a single transaction. `replace_path`
    // updates existing steps in place by immutable id and deletes leftovers;
    // replace_existing_path: false falls back to per-step upserts that never
    // delete anything.
    const stepItem = (path: ReleaseEvoPathInput, step: ReleaseStepInput) => ({
      from_tier: step.from_tier,
      to_tier: step.to_tier,
      step_order: step.step_order,
      ...(step.evo_path_id ? { evo_path_id: step.evo_path_id } : {}),
      status: releaseStatus(step.status ?? path.status),
      objectives: step.objectives.map((o, i) => ({
        key: o.stat,
        ...EVO_OBJECTIVES[o.stat as EvoObjectiveKey],
        target: o.amount,
        description: o.description ?? null,
        sort_order: i + 1,
      })),
      // A resulting_version is a COMPLETE playable card snapshot: tier, positions,
      // both ratings, the nine base stats, the nine Runs stats and assignments.
      resulting_version: {
        rating: step.resulting_version.rating ?? null,
        ...(step.resulting_version.run_rating != null ? { run_rating: step.resulting_version.run_rating } : {}),
        gem_name: step.resulting_version.gem_name ?? step.to_tier,
        gem_tier: step.resulting_version.gem_tier ?? step.to_tier,
        ...(step.resulting_version.position1 != null ? { position1: step.resulting_version.position1 } : {}),
        ...(step.resulting_version.position2 !== undefined ? { position2: step.resulting_version.position2 } : {}),
        stats: step.resulting_version.stats,
        ...(Object.keys(step.resulting_version.run_stats ?? {}).length
          ? { run_stats: step.resulting_version.run_stats }
          : {}),
        badges: step.resulting_version.badges ?? [],
        traits: step.resulting_version.traits ?? [],
        status: releaseStatus(step.resulting_version.status ?? step.status ?? path.status),
      },

    });

    payload.evo_paths = release.evo_paths.flatMap((path): Record<string, unknown>[] => {
      const source = evoSourceFields(release, path);
      const steps = [...(path.steps ?? [])]
        .sort((a, b) => a.step_order - b.step_order)
        .map((step) => stepItem(path, step));
      if (path.replace_existing_path === false) {
        return steps.map((step) => ({
          action: "upsert",
          ...source,
          ...step,
          release_bundle_ref: RELEASE_REF,
        }));
      }
      return [
        {
          action: "replace_path",
          ...source,
          steps,
          release_bundle_ref: RELEASE_REF,
        },
      ];
    });
  }

  if (release.locker_codes?.length) {
    payload.locker_codes = release.locker_codes.map((c) => {
      const type = c.reward_type ?? (c.reward_release_pack ? "pack" : "coins");
      const rewardValue: Record<string, unknown> =
        type === "pack" && c.reward_release_pack
          ? { pack_ref: PACK_REF }
          : { ...(c.reward_value ?? {}) };
      return {
        action: "upsert",
        code: String(c.code ?? "").trim().toUpperCase(),
        reward_type: type,
        reward_value: rewardValue,
        ...(c.max_redemptions != null ? { max_redemptions: c.max_redemptions } : {}),
        ...(c.expires_at != null ? { expires_at: c.expires_at } : {}),
        ...(c.status ? { status: releaseStatus(c.status) } : {}),
      };
    });
  }

  if (release.challenges?.length) {
    payload.challenges = release.challenges.map((raw) => {
      // Canonicalize the wording a Commissioner naturally uses onto the real
      // challenge columns before anything is planned, so nothing is dropped.
      const c: ReleaseChallengeInput = { ...raw };
      const rewards = c.rewards ?? {};
      if (c.coin_reward === undefined && rewards.coins !== undefined) c.coin_reward = Number(rewards.coins);
      if (c.gem_reward === undefined && rewards.gems !== undefined) c.gem_reward = Number(rewards.gems);
      if (!c.card_reward && typeof rewards.card === "string") c.card_reward = rewards.card;
      if (!c.pack_reward && typeof rewards.pack === "string") c.pack_reward = rewards.pack;
      if (c.win_by_amount === undefined && c.win_by !== undefined) c.win_by_amount = c.win_by;
      if (c.is_repeatable === undefined && c.repeatable !== undefined) c.is_repeatable = c.repeatable;
      if (c.target_value === undefined) c.target_value = c.target ?? c.goal;
      const cond = (c.conditions ?? {}) as Record<string, unknown>;
      if (c.target_value === undefined && cond.amount !== undefined) c.target_value = Number(cond.amount);
      if (c.target_value === undefined && cond.target !== undefined) c.target_value = Number(cond.target);
      if (!c.challenge_type && typeof cond.type === "string") c.challenge_type = cond.type;
      if (!c.target_stat && typeof cond.stat === "string") c.target_stat = cond.stat;
      delete c.rewards;
      delete c.win_by;
      delete c.repeatable;
      delete c.target;
      delete c.goal;
      const rewardCard = c.card_reward_id
        ? { card_reward_id: c.card_reward_id }
        : c.card_reward
          ? (() => {
              const fields = cardRefFields(release, { player_name: c.card_reward });
              if (fields.player_card_id) return { card_reward_id: fields.player_card_id };
              if (fields.player_ref) return { card_reward_ref: fields.player_ref };
              return { card_reward: c.card_reward };
            })()
          : {};
      const rewardPack = c.pack_release_reward
        ? { pack_reward_ref: PACK_REF }
        : c.pack_reward
          ? { pack_reward: c.pack_reward }
          : {};
      const opponent = c.opponent_release_team
        ? { opponent_team_ref: TEAM_REF }
        : c.opponent_team
          ? { opponent_team: c.opponent_team }
          : {};
      const scalars: Record<string, unknown> = {};
      for (const key of [
        "description",
        "challenge_type",
        "win_condition",
        "win_by_amount",
        "series_length",
        "series_win_coins",
        "series_loss_coins",
        "coin_reward",
        "gem_reward",
        "stat_limit_player",
        "stat_limit_value",
        "prerequisite",
        "spotlight_group",
        "sort_order",
        "conditions",
        "reward_payload",
        "lineup_restrictions",
        "is_repeatable",
        "target_value",
        "expires_at",
      ] as const) {
        if (c[key] !== undefined) scalars[key] = c[key];
      }
      if (c.stat_limit_stat) scalars.stat_limit_stat = normalizeStatKey(c.stat_limit_stat);
      if (c.target_stat) scalars.stat_limit_stat = normalizeStatKey(c.target_stat);
      return {
        action: "upsert",
        ...(c.challenge_id ? { challenge_id: c.challenge_id } : {}),
        name: String(c.name ?? "").trim(),
        ...scalars,
        ...rewardCard,
        ...rewardPack,
        ...opponent,
        ...(c.status ? { status: releaseStatus(c.status) } : {}),
      };
    });
  }

  // Singular `domination` road object -> domination_roads group, so the GPT
  // shape reaches the batch writer instead of being dropped.
  if (release.domination) {
    const { domination_roads } = expandDominationSection(release.domination);
    if (domination_roads.length) {
      const existing = Array.isArray(payload.domination_roads) ? (payload.domination_roads as unknown[]) : [];
      payload.domination_roads = [...existing, ...domination_roads];
    }
  }

  // Forwarded groups (duos, runs, domination, storylines, ...) travel verbatim so
  // a release never quietly does less than the document asked for.
  for (const group of RELEASE_PASSTHROUGH_GROUPS) {
    const items = (release as unknown as Record<string, unknown>)[group];
    if (!Array.isArray(items) || items.length === 0) continue;
    const existing = Array.isArray(payload[group]) ? (payload[group] as unknown[]) : [];
    payload[group] = [...existing, ...items];
  }

  return payload;
}

/** Convenience: normalize + validate + build in one pass (still zero-write). */
export function prepareRelease(input: ContentReleaseInput, options: ValidateOptions = {}) {
  const normalized = normalizeRelease(input);
  const validations = validateRelease(normalized, options);
  return {
    normalized,
    validations,
    valid: !validations.some((v) => v.severity === "error"),
    payload: buildReleasePayload(normalized),
  };
}
