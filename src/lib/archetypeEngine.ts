/**
 * Client-side keyword-based player archetype generator.
 * Parses basketball descriptions and outputs stats, badge suggestions, and positions.
 * Zero API calls — runs entirely in the browser.
 */

// ── Types ────────────────────────────────────────────────

export interface GeneratedPlayer {
  stats: Record<string, number>;
  badges: { abbreviation: string; tier: string }[];
  positions: [string, string | null];
  summary: string;
}

interface StatProfile {
  stat_3pt: number; stat_mid: number; stat_fin: number; stat_dnk: number;
  stat_ast: number; stat_stl: number; stat_reb: number; stat_blk: number; stat_int: number;
}

interface Archetype {
  name: string;
  keywords: string[];
  /** 0-1 weights for each stat — determines distribution shape */
  weights: StatProfile;
  positions: [string, string | null];
  /** Stats this archetype focuses on for badge matching */
  focusStats: string[];
}

// ── Archetypes ───────────────────────────────────────────

const ARCHETYPES: Archetype[] = [
  {
    name: "Sharpshooter",
    keywords: ["sharpshooter", "shooter", "sniper", "lights out shooter", "catch and shoot"],
    weights: { stat_3pt: 1, stat_mid: 0.85, stat_fin: 0.4, stat_dnk: 0.2, stat_ast: 0.5, stat_stl: 0.4, stat_reb: 0.2, stat_blk: 0.15, stat_int: 0.6 },
    positions: ["SG", "SF"],
    focusStats: ["stat_3pt", "stat_mid"],
  },
  {
    name: "Slasher",
    keywords: ["slasher", "driver", "attacker", "rim attacker"],
    weights: { stat_3pt: 0.35, stat_mid: 0.55, stat_fin: 1, stat_dnk: 0.9, stat_ast: 0.45, stat_stl: 0.45, stat_reb: 0.3, stat_blk: 0.2, stat_int: 0.5 },
    positions: ["SG", "SF"],
    focusStats: ["stat_fin", "stat_dnk"],
  },
  {
    name: "Playmaker",
    keywords: ["playmaker", "floor general", "point god", "facilitator", "passer"],
    weights: { stat_3pt: 0.6, stat_mid: 0.65, stat_fin: 0.55, stat_dnk: 0.3, stat_ast: 1, stat_stl: 0.5, stat_reb: 0.2, stat_blk: 0.15, stat_int: 0.9 },
    positions: ["PG", "SG"],
    focusStats: ["stat_ast", "stat_int"],
  },
  {
    name: "Lockdown Defender",
    keywords: ["lockdown", "defensive anchor", "perimeter defender", "stopper", "clamp"],
    weights: { stat_3pt: 0.3, stat_mid: 0.35, stat_fin: 0.35, stat_dnk: 0.3, stat_ast: 0.3, stat_stl: 1, stat_reb: 0.6, stat_blk: 0.85, stat_int: 0.7 },
    positions: ["SF", "PF"],
    focusStats: ["stat_stl", "stat_blk"],
  },
  {
    name: "Glass Cleaner",
    keywords: ["glass cleaner", "rebounder", "board man"],
    weights: { stat_3pt: 0.15, stat_mid: 0.3, stat_fin: 0.5, stat_dnk: 0.6, stat_ast: 0.2, stat_stl: 0.3, stat_reb: 1, stat_blk: 0.75, stat_int: 0.4 },
    positions: ["PF", "C"],
    focusStats: ["stat_reb", "stat_blk"],
  },
  {
    name: "Stretch Big",
    keywords: ["stretch big", "stretch four", "stretch five", "shooting big"],
    weights: { stat_3pt: 0.85, stat_mid: 0.7, stat_fin: 0.4, stat_dnk: 0.55, stat_ast: 0.3, stat_stl: 0.25, stat_reb: 0.8, stat_blk: 0.65, stat_int: 0.4 },
    positions: ["PF", "C"],
    focusStats: ["stat_3pt", "stat_reb"],
  },
  {
    name: "Two-Way",
    keywords: ["two-way", "two way", "3&d", "3 and d", "three and d"],
    weights: { stat_3pt: 0.7, stat_mid: 0.65, stat_fin: 0.6, stat_dnk: 0.55, stat_ast: 0.55, stat_stl: 0.75, stat_reb: 0.5, stat_blk: 0.5, stat_int: 0.65 },
    positions: ["SF", "SG"],
    focusStats: ["stat_3pt", "stat_stl"],
  },
  {
    name: "Rim Protector",
    keywords: ["rim protector", "shot blocker", "paint anchor", "rim guardian"],
    weights: { stat_3pt: 0.1, stat_mid: 0.2, stat_fin: 0.45, stat_dnk: 0.65, stat_ast: 0.2, stat_stl: 0.35, stat_reb: 0.85, stat_blk: 1, stat_int: 0.5 },
    positions: ["C", "PF"],
    focusStats: ["stat_blk", "stat_reb"],
  },
  {
    name: "Post Scorer",
    keywords: ["post scorer", "back to basket", "post up", "mid post"],
    weights: { stat_3pt: 0.2, stat_mid: 0.75, stat_fin: 0.85, stat_dnk: 0.7, stat_ast: 0.35, stat_stl: 0.3, stat_reb: 0.7, stat_blk: 0.55, stat_int: 0.5 },
    positions: ["C", "PF"],
    focusStats: ["stat_fin", "stat_mid", "stat_reb"],
  },
  {
    name: "Combo Guard",
    keywords: ["combo guard", "scoring guard", "microwave", "microwave scorer", "instant offense"],
    weights: { stat_3pt: 0.75, stat_mid: 0.8, stat_fin: 0.75, stat_dnk: 0.5, stat_ast: 0.7, stat_stl: 0.5, stat_reb: 0.25, stat_blk: 0.15, stat_int: 0.7 },
    positions: ["PG", "SG"],
    focusStats: ["stat_3pt", "stat_mid", "stat_ast"],
  },
  {
    name: "Point Forward",
    keywords: ["point forward", "ball handling forward", "facilitating forward"],
    weights: { stat_3pt: 0.55, stat_mid: 0.6, stat_fin: 0.65, stat_dnk: 0.6, stat_ast: 0.85, stat_stl: 0.5, stat_reb: 0.55, stat_blk: 0.4, stat_int: 0.8 },
    positions: ["SF", "PF"],
    focusStats: ["stat_ast", "stat_int", "stat_fin"],
  },
  {
    name: "Inside-Out",
    keywords: ["inside-out", "inside out", "versatile scorer", "complete scorer"],
    weights: { stat_3pt: 0.75, stat_mid: 0.8, stat_fin: 0.8, stat_dnk: 0.65, stat_ast: 0.5, stat_stl: 0.4, stat_reb: 0.4, stat_blk: 0.3, stat_int: 0.6 },
    positions: ["SF", "SG"],
    focusStats: ["stat_3pt", "stat_fin", "stat_mid"],
  },
  {
    name: "Paint Beast",
    keywords: ["paint beast", "interior force", "bully ball", "physical big"],
    weights: { stat_3pt: 0.1, stat_mid: 0.3, stat_fin: 0.8, stat_dnk: 0.9, stat_ast: 0.2, stat_stl: 0.3, stat_reb: 0.9, stat_blk: 0.8, stat_int: 0.35 },
    positions: ["C", "PF"],
    focusStats: ["stat_dnk", "stat_fin", "stat_reb", "stat_blk"],
  },
];

// ── Modifiers ────────────────────────────────────────────

interface Modifier {
  keywords: string[];
  apply: (weights: StatProfile, config: ModifierConfig) => void;
}

interface ModifierConfig {
  badgeCountMult: number;
  badgeTierBoost: number;
  varianceMult: number;
  statSpreadMult: number; // <1 = tighter, >1 = wider
}

const STAT_KEYS: (keyof StatProfile)[] = [
  "stat_3pt", "stat_mid", "stat_fin", "stat_dnk",
  "stat_ast", "stat_stl", "stat_reb", "stat_blk", "stat_int",
];

const SHOOTING_STATS: (keyof StatProfile)[] = ["stat_3pt", "stat_mid"];
const FINISHING_STATS: (keyof StatProfile)[] = ["stat_fin", "stat_dnk"];
const DEFENSIVE_STATS: (keyof StatProfile)[] = ["stat_stl", "stat_blk", "stat_reb"];
const PLAYMAKING_STATS: (keyof StatProfile)[] = ["stat_ast", "stat_int"];

function boostStats(weights: StatProfile, stats: (keyof StatProfile)[], amount: number) {
  for (const s of stats) {
    weights[s] = Math.min(1, weights[s] + amount);
  }
}

const MODIFIERS: Modifier[] = [
  {
    keywords: ["elite shooter", "elite shooting", "lights out", "pure shooter"],
    apply: (w) => boostStats(w, SHOOTING_STATS, 0.25),
  },
  {
    keywords: ["elite finisher", "elite finishing", "contact finisher"],
    apply: (w) => boostStats(w, FINISHING_STATS, 0.25),
  },
  {
    keywords: ["elite defender", "elite defense", "dpoy"],
    apply: (w) => boostStats(w, DEFENSIVE_STATS, 0.25),
  },
  {
    keywords: ["elite playmaker", "elite playmaking", "elite passer"],
    apply: (w) => boostStats(w, PLAYMAKING_STATS, 0.25),
  },
  {
    keywords: ["athletic freak", "athletic", "explosive", "bouncy"],
    apply: (w) => { boostStats(w, ["stat_fin", "stat_dnk"], 0.2); boostStats(w, ["stat_stl"], 0.1); },
  },
  {
    keywords: ["high iq", "cerebral", "smart", "savvy"],
    apply: (w) => boostStats(w, ["stat_int", "stat_ast"], 0.2),
  },
  {
    keywords: ["badge heavy", "badge loaded"],
    apply: (_w, config) => { config.badgeCountMult = 1.6; config.badgeTierBoost = 1; },
  },
  {
    keywords: ["hidden gem", "sleeper", "underrated"],
    apply: (_w, config) => { config.badgeCountMult = 0.6; config.badgeTierBoost = 2; config.statSpreadMult = 1.5; },
  },
  {
    keywords: ["raw", "low floor", "project", "unpolished"],
    apply: (_w, config) => { config.varianceMult = 2; config.statSpreadMult = 1.4; },
  },
  {
    keywords: ["balanced", "complete", "well-rounded", "well rounded"],
    apply: (w, config) => {
      config.statSpreadMult = 0.5;
      // Pull all weights toward average
      const avg = STAT_KEYS.reduce((s, k) => s + w[k], 0) / STAT_KEYS.length;
      for (const k of STAT_KEYS) {
        w[k] = w[k] * 0.4 + avg * 0.6;
      }
    },
  },
];

// ── Tier Scaling ─────────────────────────────────────────

interface TierRange {
  min: number;
  max: number;
  badgeCount: [number, number];
  badgeTiers: string[];
}

const TIER_RANGES: Record<number, TierRange> = {
  1: { min: 45, max: 65, badgeCount: [1, 3], badgeTiers: ["base"] },
  2: { min: 55, max: 75, badgeCount: [2, 4], badgeTiers: ["base", "gold"] },
  3: { min: 65, max: 82, badgeCount: [3, 6], badgeTiers: ["base", "gold", "diamond"] },
  4: { min: 75, max: 90, badgeCount: [5, 8], badgeTiers: ["gold", "diamond", "hof"] },
  5: { min: 85, max: 99, badgeCount: [6, 10], badgeTiers: ["diamond", "hof", "actolytrene"] },
};

// ── Random helpers ───────────────────────────────────────

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

// ── Main Generator ───────────────────────────────────────

export function generatePlayer(
  description: string,
  starRating: number,
  availableBadges: { id: string; abbreviation: string; affected_stat: string | null; effect_type: string }[],
): GeneratedPlayer {
  const input = description.toLowerCase().trim();
  const stars = clamp(starRating, 1, 5);
  const tier = TIER_RANGES[stars];

  // 1. Find best matching archetype
  let bestArchetype = ARCHETYPES[0];
  let bestScore = -1;
  for (const arch of ARCHETYPES) {
    for (const kw of arch.keywords) {
      if (input.includes(kw) && kw.length > bestScore) {
        bestArchetype = arch;
        bestScore = kw.length;
      }
    }
  }

  // 2. Copy weights and apply modifiers
  const weights: StatProfile = { ...bestArchetype.weights };
  const config: ModifierConfig = {
    badgeCountMult: 1,
    badgeTierBoost: 0,
    varianceMult: 1,
    statSpreadMult: 1,
  };

  const appliedMods: string[] = [];
  for (const mod of MODIFIERS) {
    for (const kw of mod.keywords) {
      if (input.includes(kw)) {
        mod.apply(weights, config);
        appliedMods.push(kw);
        break;
      }
    }
  }

  // 3. Generate stats from weights
  const range = tier.max - tier.min;
  const stats: Record<string, number> = {};
  for (const k of STAT_KEYS) {
    const base = tier.min + weights[k] * range * config.statSpreadMult;
    const variance = rand(-3, 3) * config.varianceMult;
    stats[k] = clamp(Math.round(base + variance), Math.max(25, tier.min - 15), 99);
  }

  // 4. Generate badges
  const badgeCountRange = tier.badgeCount;
  let numBadges = rand(badgeCountRange[0], badgeCountRange[1]);
  numBadges = Math.round(numBadges * config.badgeCountMult);
  numBadges = clamp(numBadges, 1, 15);

  // Score badges by relevance to archetype focus
  const scoredBadges = availableBadges.map((b) => {
    let score = Math.random() * 0.3; // base randomness
    if (b.affected_stat && bestArchetype.focusStats.includes(b.affected_stat)) {
      score += 1;
    }
    return { ...b, score };
  }).sort((a, b) => b.score - a.score);

  const selectedBadges = scoredBadges.slice(0, numBadges);
  const availableTiers = [...tier.badgeTiers];

  const badges = selectedBadges.map((b, i) => {
    // Higher-ranked badges get better tiers
    let tierIdx = Math.floor((1 - i / numBadges) * availableTiers.length);
    tierIdx = clamp(tierIdx + Math.floor(config.badgeTierBoost * 0.5), 0, availableTiers.length - 1);
    // Add some randomness to tier
    tierIdx = clamp(tierIdx + rand(-1, 0), 0, availableTiers.length - 1);
    return { abbreviation: b.abbreviation, tier: availableTiers[tierIdx] };
  });

  // 5. Positions
  const positions: [string, string | null] = [bestArchetype.positions[0], bestArchetype.positions[1]];

  // 6. Summary
  const modDesc = appliedMods.length > 0 ? `, ${appliedMods.join(", ")}` : "";
  const summary = `${bestArchetype.name}${modDesc} (${stars}★)`;

  return { stats, badges, positions, summary };
}
