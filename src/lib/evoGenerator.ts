// Evo Path Auto-Generator — creates tier-to-tier evolution steps with challenges

export interface GemTier {
  id: string;
  name: string;
  sort_order: number;
  stars: number;
}

export interface CompoundChallenge {
  type: string;
  stat: string | null;
  target: number;
  description: string;
}

export interface EvoStep {
  from_tier_id: string | null;
  to_tier_id: string;
  step_order: number;
  challenge_description: string;
  challenge_type: string;
  challenge_target: number;
  challenge_stat: string | null;
  new_badges: { badge_id: string; tier: string }[];
  evolves_to_card_id: string | null;
  compound_challenges: CompoundChallenge[];
}

const CHALLENGE_TYPES = ["points_scored", "games_won", "total_stat", "single_game_stat", "stat_game_count"] as const;

const STAT_KEYS = ["stat_3pt", "stat_mid", "stat_fin", "stat_dnk", "stat_ast", "stat_stl", "stat_reb", "stat_blk", "stat_int"];

const STAT_LABELS: Record<string, string> = {
  stat_3pt: "3-pointers", stat_mid: "mid-range shots", stat_fin: "finishes",
  stat_dnk: "dunks", stat_ast: "assists", stat_stl: "steals",
  stat_reb: "rebounds", stat_blk: "blocks", stat_int: "interceptions",
};

export const CHALLENGE_TEMPLATES: Record<string, (target: number, stat?: string | null) => string> = {
  points_scored: (t) => `Score ${t} total points with this card`,
  games_won: (t) => `Win ${t} games with this card in your lineup`,
  total_stat: (t, s) => `Record ${t} total ${s ? STAT_LABELS[s] ?? s : "stat rolls"} with this card`,
  single_game_stat: (t, s) => `Record ${t}+ ${s ? STAT_LABELS[s] ?? s : "stat"} in a single game`,
  stat_game_count: (t, s) => `Record ${t} games with 20+ ${s ? STAT_LABELS[s] ?? s : "stat"}`,
};

/** Build a human-readable description for a challenge requirement. */
export function describeChallenge(type: string, target: number, stat?: string | null): string {
  const tpl = CHALLENGE_TEMPLATES[type];
  if (tpl) return tpl(target, stat ?? undefined);
  return `${type.replace(/_/g, " ")} — ${target}`;
}

// Scale challenge difficulty by tier progression step
const BASE_TARGETS: Record<string, number[]> = {
  points_scored: [50, 100, 200, 400, 750],
  games_won: [3, 5, 10, 15, 25],
  total_stat: [50, 100, 200, 400, 750],
  single_game_stat: [15, 20, 25, 30, 40],
  stat_game_count: [3, 5, 10, 15, 20],
};

/**
 * Generate a single next evo step based on the card's current tier, stats, and badges.
 * Returns null if there's no next tier to evolve to.
 */
export function generateSingleEvoStep(
  currentTierId: string | null,
  allTiers: GemTier[],
  existingBadges: { badge_id: string; tier: string }[],
  cardStats: Record<string, number>,
  existingStepCount: number,
): EvoStep | null {
  const sortedTiers = [...allTiers].sort((a, b) => a.sort_order - b.sort_order);
  if (sortedTiers.length < 2) return null;

  const currentIdx = currentTierId
    ? sortedTiers.findIndex((t) => t.id === currentTierId)
    : -1;

  // The "from" tier for the next step: if we already have steps, advance from the last step's to_tier
  const fromIdx = currentIdx >= 0 ? currentIdx + existingStepCount : existingStepCount;
  const toIdx = fromIdx + 1;

  if (fromIdx < 0 || toIdx >= sortedTiers.length) return null;

  const fromTier = sortedTiers[fromIdx];
  const toTier = sortedTiers[toIdx];
  const stepNum = existingStepCount;

  // Pick a challenge type that relates to the card's strongest stats
  const sortedStats = [...STAT_KEYS]
    .map(k => ({ key: k, val: cardStats[k] ?? 0 }))
    .sort((a, b) => b.val - a.val);

  const topStats = sortedStats.slice(0, 4);
  const challengeIdx = stepNum % CHALLENGE_TYPES.length;
  const challengeType = CHALLENGE_TYPES[challengeIdx];
  const targets = BASE_TARGETS[challengeType];
  const target = targets[Math.min(stepNum, targets.length - 1)];

  // Badge upgrades — upgrade one existing badge
  const TIERS_ORDER = ["base", "gold", "hof", "diamond", "actolytrene"];
  const newBadges: { badge_id: string; tier: string }[] = [];
  if (existingBadges.length > 0) {
    const badge = existingBadges[stepNum % existingBadges.length];
    const currentTierIdx = TIERS_ORDER.indexOf(badge.tier);
    if (currentTierIdx < TIERS_ORDER.length - 1) {
      newBadges.push({ badge_id: badge.badge_id, tier: TIERS_ORDER[currentTierIdx + 1] });
    }
  }

  // Pick a stat challenge based on the card's top stats (playstyle-aware)
  const isStatChallenge = ["total_stat", "single_game_stat", "stat_game_count"].includes(challengeType);
  const challengeStat = isStatChallenge ? topStats[stepNum % topStats.length].key : null;

  return {
    from_tier_id: fromTier.id,
    to_tier_id: toTier.id,
    step_order: existingStepCount + 1,
    challenge_description: CHALLENGE_TEMPLATES[challengeType](target, challengeStat ?? undefined),
    challenge_type: challengeType,
    challenge_target: target,
    challenge_stat: challengeStat,
    new_badges: newBadges,
    evolves_to_card_id: null,
    compound_challenges: [],
  };
}

// Keep legacy function for backward compat but it's no longer used by the UI
export function generateEvoPath(
  currentTierId: string | null,
  allTiers: GemTier[],
  existingBadges: { badge_id: string; tier: string }[],
  cardStats: Record<string, number>,
): EvoStep[] {
  const steps: EvoStep[] = [];
  let count = 0;
  while (true) {
    const step = generateSingleEvoStep(currentTierId, allTiers, existingBadges, cardStats, count);
    if (!step) break;
    steps.push(step);
    count++;
  }
  return steps;
}
