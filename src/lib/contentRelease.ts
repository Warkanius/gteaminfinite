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

export interface ReleaseStepInput {
  from_tier: string;
  to_tier: string;
  step_order: number;
  objectives: Array<{ stat: string; amount: number; description?: string }>;
  resulting_version: {
    rating?: number;
    gem_name?: string;
    stats: StatBlock;
    badges?: Assignment[];
    traits?: Assignment[];
  };
}

export interface ReleaseEvoPathInput {
  player_name?: string;
  player_card_id?: string;
  status?: "draft" | "published";
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
  stats?: StatBlock;
  badges?: Assignment[];
  traits?: Assignment[];
  [extra: string]: unknown;
}

export interface ContentReleaseInput {
  release: { name: string; slug?: string; status?: "draft" | "published"; description?: string };
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
    name: string;
    pack_type?: "standard" | "premium" | "promo";
    cost?: number;
    ten_box_cost?: number | null;
    players: Array<{ player_name?: string; player_card_id?: string; slot: number }>;
    odds: Array<{ result_slot: string; percentage: number | string; description?: string }>;
  };
  evo_paths?: ReleaseEvoPathInput[];
  forbid_existing_links_to?: string[];
}

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

/** Normalizes an imported release document. Never writes anything. */
export function normalizeRelease(input: ContentReleaseInput): ContentReleaseInput {
  const out: ContentReleaseInput = JSON.parse(JSON.stringify(input ?? {}));
  out.players = (out.players ?? []).map((p) => ({
    ...p,
    stats: normalizeStats(p.stats),
    badges: normalizeAssignments(p.badges, "badge"),
    traits: normalizeAssignments(p.traits, "trait"),
  }));
  out.evo_paths = (out.evo_paths ?? []).map((path) => ({
    ...path,
    steps: [...(path.steps ?? [])]
      .sort((a, b) => a.step_order - b.step_order)
      .map((step) => ({
        ...step,
        objectives: (step.objectives ?? []).map((o) => ({
          ...o,
          stat: normalizeObjectiveKey(o.stat),
          amount: Number(o.amount),
        })),
        resulting_version: {
          ...(step.resulting_version ?? { stats: {} }),
          stats: normalizeStats(step.resulting_version?.stats),
          badges: normalizeAssignments(step.resulting_version?.badges, "badge"),
          traits: normalizeAssignments(step.resulting_version?.traits, "trait"),
        },
      })),
  }));
  if (out.pack) {
    out.pack.players = [...(out.pack.players ?? [])].sort((a, b) => a.slot - b.slot);
    out.pack.odds = (out.pack.odds ?? []).map((o) => ({ ...o, result_slot: String(o.result_slot) }));
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

function playerKey(ref: { player_name?: string; player_card_id?: string }) {
  return (ref.player_card_id ?? ref.player_name ?? "").trim().toLowerCase();
}

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

  // collection
  const collection = release.collection;
  if (collection?.name) {
    const members = collection.player_cards ?? [];
    const slots = new Set<number>();
    members.forEach((m, i) => {
      const scope = `collection.player_cards[${i}]`;
      if (!known(m)) err("UNKNOWN_COLLECTION_MEMBER", `"${m.player_name ?? m.player_card_id}" is not part of this release.`, scope);
      if (m.slot != null) {
        if (slots.has(m.slot)) err("DUPLICATE_COLLECTION_SLOT", `Slot ${m.slot} is used twice.`, scope);
        slots.add(m.slot);
      }
    });
    const rewardRefs = new Set<string>();
    members.filter((m) => m.is_reward).forEach((m) => rewardRefs.add(playerKey(m)));
    players.filter((p) => p.is_collection_reward).forEach((p) => rewardRefs.add((p.player_card_id ?? p.name).toLowerCase()));
    if (collection.reward_player_card_id) rewardRefs.add(collection.reward_player_card_id.toLowerCase());
    else if (collection.reward_player_name) rewardRefs.add(collection.reward_player_name.trim().toLowerCase());
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
    if (rewardName && !known({ player_name: rewardName })) {

      err("REWARD_NOT_IN_RELEASE", `Reward card "${rewardName}" is not part of this release.`, "collection.reward");
    }
    if (rewardName && release.pack?.players?.some((s) => sameRef(s.player_name, rewardName))) {
      err(
        "REWARD_IN_PACK",
        `"${rewardName}" is the collection reward and must not be pullable from the pack.`,
        "pack.players",
      );
    }
    if (members.length && !members.some((m) => m.is_reward) && rewardName && !collection.reward_player_name) {
      warn("REWARD_MEMBERSHIP", `Reward "${rewardName}" is not flagged in the membership list.`, "collection.player_cards");
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
  if (pack?.name?.trim() || pack?.players?.length || pack?.odds?.length) {
    if (!pack?.name?.trim()) err("PACK_NAME_REQUIRED", "Pack name is required when a pack is included.", "pack");
    const slots = new Set<number>();
    (pack?.players ?? []).forEach((s, i) => {
      const scope = `pack.players[${i}]`;
      if (slots.has(s.slot)) err("DUPLICATE_POOL_SLOT", `Pool slot ${s.slot} is used twice.`, scope);
      slots.add(s.slot);
      if (!known(s)) err("UNKNOWN_POOL_CARD", `"${s.player_name ?? s.player_card_id}" is not part of this release.`, scope);
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
      const cents = toHundredths(row.percentage);
      if (Number.isNaN(cents)) {
        err("INVALID_PERCENTAGE", `"${row.percentage}" is not a percentage with at most two decimals.`, scope);
      } else if (cents <= 0) {
        err("NON_POSITIVE_PERCENTAGE", "Percentage must be greater than 0.", scope);
      }
      if (oddsSeen.has(row.result_slot)) {
        err("DUPLICATE_ODDS_ROW", `result_slot "${row.result_slot}" appears more than once.`, scope);
      }
      oddsSeen.add(row.result_slot);
      const numeric = Number(row.result_slot);
      const special = (SPECIAL_ODDS_SLOTS as readonly string[]).includes(row.result_slot);
      if (!special && (!Number.isFinite(numeric) || !slots.has(numeric))) {
        err("UNKNOWN_RESULT_SLOT", `result_slot "${row.result_slot}" is not in the pool.`, scope);
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
    if (!path.player_name && !path.player_card_id) {
      err("EVO_PLAYER_REQUIRED", "Evo path needs player_name or player_card_id.", scope);
    } else if (!known({ player_name: path.player_name, player_card_id: path.player_card_id })) {
      err("EVO_PLAYER_UNKNOWN", `"${path.player_name ?? path.player_card_id}" is not part of this release.`, scope);
    }
    const steps = path.steps ?? [];
    if (!steps.length) err("EVO_NO_STEPS", "Evo path needs at least one step.", scope);

    const base = players.find(
      (p) =>
        (path.player_card_id && p.player_card_id === path.player_card_id) || sameRef(p.name, path.player_name),
    );

    steps.forEach((step, si) => {
      const sScope = `${scope}.steps[${si}]`;
      if (step.step_order !== si + 1) {
        err("EVO_STEP_ORDER", `Step order must be contiguous from 1 (expected ${si + 1}, got ${step.step_order}).`, sScope);
      }
      if (!step.from_tier || !step.to_tier) {
        err("EVO_TIER_REQUIRED", "Both from_tier and to_tier are required.", sScope);
      }
      if (si === 0 && base?.gem_tier && step.from_tier && !sameRef(base.gem_tier, step.from_tier)) {
        err(
          "EVO_FIRST_STEP_TIER",
          `First step must start at the base card tier "${base.gem_tier}" (got "${step.from_tier}").`,
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
}

// ------------------------------------------------------------ payload builder

const slug = (value: string) =>
  value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

const RELEASE_REF = "ref:release:main";
const COLLECTION_REF = "ref:collection:main";
const cardRef = (name: string) => `ref:player:${slug(name)}`;

function refFor(release: ContentReleaseInput, ref: { player_name?: string; player_card_id?: string }) {
  if (ref.player_card_id) return ref.player_card_id;
  const match = (release.players ?? []).find((p) => sameRef(p.name, ref.player_name));
  if (match?.player_card_id) return match.player_card_id;
  return cardRef(match?.name ?? ref.player_name ?? "");
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
        status: release.release.status === "published" ? "active" : "draft",
      },
    ],
  };

  if (release.players?.length) {
    payload.players = release.players.map((p) => {
      const { stats, is_collection_reward, new_name, player_card_id, badges, traits, ...rest } = p;
      return {
        ...(player_card_id ? { id: player_card_id } : { temp_ref: cardRef(p.name) }),
        action: player_card_id ? "update" : "upsert",
        ...rest,
        ...(new_name ? { name: new_name } : {}),
        ...(stats ?? {}),
        ...(badges?.length ? { badges, replace_badges: true } : {}),
        ...(traits?.length ? { traits, replace_traits: true } : {}),
        release_bundle_ref: RELEASE_REF,
      };
    });
  }

  const collection = release.collection;
  if (collection?.name) {
    const rewardRef =
      collection.reward_player_card_id ??
      (collection.reward_player_name
        ? refFor(release, { player_name: collection.reward_player_name })
        : (() => {
            const flagged =
              collection.player_cards?.find((m) => m.is_reward) ??
              (release.players ?? []).find((p) => p.is_collection_reward);
            const name = (flagged as { player_name?: string; name?: string } | undefined);
            return name ? refFor(release, { player_name: name.player_name ?? name.name }) : undefined;
          })());
    payload.collections = [
      {
        temp_ref: COLLECTION_REF,
        action: "upsert",
        name: collection.name,
        description: collection.description ?? null,
        release_bundle_ref: RELEASE_REF,
        ...(rewardRef ? { reward_card_ref: rewardRef } : {}),
      },
    ];
    const members =
      collection.player_cards?.length
        ? [...collection.player_cards].sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0))
        : (release.players ?? []).map((p, i) => ({ player_name: p.name, slot: i + 1, is_reward: p.is_collection_reward }));
    payload.collection_requirements = [
      {
        action: "replace",
        collection_ref: COLLECTION_REF,
        requirements: members.map((m, i) => ({
          player_ref: refFor(release, m),
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
        ...(release.team.category ? { category: release.team.category } : {}),
        ...(release.team.unlock_cost != null ? { unlock_cost: release.team.unlock_cost } : {}),
        release_bundle_ref: RELEASE_REF,
        replace_roster: true,
        roster: [...(release.team.roster ?? [])]
          .sort((a, b) => a.slot - b.slot)
          .map((r) => ({ slot_number: r.slot, player_ref: refFor(release, r) })),
      },
    ];
  }

  const pack = release.pack;
  if (pack?.name?.trim()) {
    payload.packs = [
      {
        action: "upsert",
        name: pack.name,
        pack_type: pack.pack_type ?? "standard",
        cost: pack.cost ?? 0,
        ten_box_cost: pack.ten_box_cost ?? null,
        release_bundle_ref: RELEASE_REF,
        ...(collection?.name ? { collection_ref: COLLECTION_REF } : {}),
        replace_pool: true,
        pool: [...(pack.players ?? [])]
          .sort((a, b) => a.slot - b.slot)
          .map((s) => ({ slot_number: s.slot, player_ref: refFor(release, s) })),
        replace_odds: true,
        odds: (pack.odds ?? []).map((o) => ({
          dice_roll: o.result_slot,
          result_slot: o.result_slot,
          percentage: Number(formatHundredths(toHundredths(o.percentage))),
          description: o.description ?? null,
          pack_type: pack.pack_type ?? "standard",
        })),
      },
    ];
  }

  if (release.evo_paths?.length) {
    payload.evo_paths = release.evo_paths.flatMap((path) => {
      const source = refFor(release, { player_name: path.player_name, player_card_id: path.player_card_id });
      return [...(path.steps ?? [])]
        .sort((a, b) => a.step_order - b.step_order)
        .map((step) => ({
          action: "upsert",
          source_player_ref: source,
          from_tier: step.from_tier,
          to_tier: step.to_tier,
          step_order: step.step_order,
          status: path.status === "published" ? "active" : "draft",
          objectives: step.objectives.map((o, i) => ({
            key: o.stat,
            ...EVO_OBJECTIVES[o.stat as EvoObjectiveKey],
            target: o.amount,
            description: o.description ?? null,
            sort_order: i + 1,
          })),
          resulting_version: {
            rating: step.resulting_version.rating ?? null,
            gem_name: step.resulting_version.gem_name ?? step.to_tier,
            stats: step.resulting_version.stats,
            badges: step.resulting_version.badges ?? [],
            traits: step.resulting_version.traits ?? [],
            status: "draft",
          },
          release_bundle_ref: RELEASE_REF,
        }));
    });
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
