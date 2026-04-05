// Evo Path Auto-Generator — creates tier-to-tier evolution steps with challenges

export interface GemTier {
  id: string;
  name: string;
  sort_order: number;
  stars: number;
}

export interface EvoStep {
  from_tier_id: string | null;
  to_tier_id: string;
  step_order: number;
  challenge_description: string;
  challenge_type: string;
  challenge_target: number;
  challenge_stat: string | null;
  stat_boosts: Record<string, number>;
  new_badges: { badge_id: string; tier: string }[];
}

const CHALLENGE_TYPES = ["points_scored", "games_won", "total_stat", "single_game_stat", "stat_game_count"] as const;

const STAT_KEYS = ["stat_3pt", "stat_mid", "stat_fin", "stat_dnk", "stat_ast", "stat_stl", "stat_reb", "stat_blk", "stat_int"];

const STAT_LABELS: Record<string, string> = {
  stat_3pt: "3-pointers", stat_mid: "mid-range shots", stat_fin: "finishes",
  stat_dnk: "dunks", stat_ast: "assists", stat_stl: "steals",
  stat_reb: "rebounds", stat_blk: "blocks", stat_int: "interceptions",
};

const CHALLENGE_TEMPLATES: Record<string, (target: number, stat?: string) => string> = {
  points_scored: (t) => `Score ${t} total points with this card`,
  games_won: (t) => `Win ${t} games with this card in your lineup`,
  total_stat: (t, s) => `Record ${t} total ${s ? STAT_LABELS[s] ?? s : "stat rolls"} with this card`,
  single_game_stat: (t, s) => `Record ${t}+ ${s ? STAT_LABELS[s] ?? s : "stat"} in a single game`,
  stat_game_count: (t, s) => `Record ${t} games with 20+ ${s ? STAT_LABELS[s] ?? s : "stat"}`,
};

// Scale challenge difficulty by tier progression step
const BASE_TARGETS: Record<string, number[]> = {
  points_scored: [50, 100, 200, 400, 750],
  games_won: [3, 5, 10, 15, 25],
  total_stat: [50, 100, 200, 400, 750],
  single_game_stat: [15, 20, 25, 30, 40],
  stat_game_count: [3, 5, 10, 15, 20],
};

export function generateEvoPath(
  currentTierId: string | null,
  allTiers: GemTier[],
  existingBadges: { badge_id: string; tier: string }[],
  cardStats: Record<string, number>,
): EvoStep[] {
  const sortedTiers = [...allTiers].sort((a, b) => a.sort_order - b.sort_order);
  if (sortedTiers.length < 2) return [];

  const currentIdx = currentTierId
    ? sortedTiers.findIndex((t) => t.id === currentTierId)
    : -1;

  const startIdx = currentIdx >= 0 ? currentIdx : 0;
  const steps: EvoStep[] = [];

  for (let i = startIdx; i < sortedTiers.length - 1; i++) {
    const fromTier = sortedTiers[i];
    const toTier = sortedTiers[i + 1];
    const stepNum = i - startIdx;
    const challengeIdx = stepNum % CHALLENGE_TYPES.length;
    const challengeType = CHALLENGE_TYPES[challengeIdx];
    const targets = BASE_TARGETS[challengeType];
    const target = targets[Math.min(stepNum, targets.length - 1)];

    // Stat boosts: pick 3-4 random stats and boost by 1-2
    const boostCount = 3 + (stepNum > 2 ? 1 : 0);
    const shuffledStats = [...STAT_KEYS].sort(() => Math.random() - 0.5);
    const statBoosts: Record<string, number> = {};
    for (let s = 0; s < boostCount; s++) {
      const stat = shuffledStats[s];
      const boost = stepNum >= 3 ? 2 : 1;
      const currentVal = cardStats[stat] ?? 0;
      // Don't boost beyond 99 for star-based stats
      if (currentVal + boost <= 99) {
        statBoosts[stat] = boost;
      }
    }

    // Badge upgrades: promote one existing badge to next tier
    const TIERS_ORDER = ["base", "gold", "hof", "diamond", "actolytrene"];
    const newBadges: { badge_id: string; tier: string }[] = [];
    if (existingBadges.length > 0 && stepNum < existingBadges.length) {
      const badge = existingBadges[stepNum % existingBadges.length];
      const currentTierIdx = TIERS_ORDER.indexOf(badge.tier);
      if (currentTierIdx < TIERS_ORDER.length - 1) {
        newBadges.push({ badge_id: badge.badge_id, tier: TIERS_ORDER[currentTierIdx + 1] });
      }
    }

    steps.push({
      from_tier_id: fromTier.id,
      to_tier_id: toTier.id,
      step_order: stepNum + 1,
      challenge_description: CHALLENGE_TEMPLATES[challengeType](target),
      challenge_type: challengeType,
      challenge_target: target,
      stat_boosts: statBoosts,
      new_badges: newBadges,
    });
  }

  return steps;
}
