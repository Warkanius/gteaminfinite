/**
 * Badge Engine — Shared badge resolution logic for 5v5 and Runs modes.
 *
 * Badge effect_types from DB:
 *   reroll  — re-roll dice and keep best (Sniper, Eraser, Pickpocket…)
 *   bonus   — add partial/full bonus dice value (Limitless Range, Fade Ace…)
 *   debuff  — reduce opponent's stat before rolling (Lockdown, Intimidator…)
 *   cancel  — nullify an opponent's debuff badge if tier ≥ theirs (Art of F You)
 *   boost   — increase a teammate's stat (Floor General)
 *   passive — special per-badge logic:
 *     Hidden Gem   — protects from difficulty penalties (does NOT upgrade roll)
 *     Mr. Versatile — adds extra Signature Trait slots per tier level
 */

import { rollDice, type StatKey } from "@/lib/gameEngine";

// ─── Types ───

export interface CardBadge {
  badgeId: string;
  name: string;
  abbreviation: string;
  affected_stat: string | null;
  effect_type: string;
  tier: BadgeTier;
}

export type BadgeTier = "base" | "gold" | "diamond" | "hof" | "actolytrene";

const TIER_ORDER: Record<BadgeTier, number> = {
  base: 0,
  gold: 1,
  hof: 2,
  diamond: 3,
  actolytrene: 4,
};

export interface BadgeActivation {
  badgeName: string;
  abbreviation: string;
  tier: BadgeTier;
  effect: string; // human-readable description of what happened
}

// ─── Tier-scaled values ───

/** Number of rerolls granted per tier */
function rerollCount(tier: BadgeTier): number {
  const map: Record<BadgeTier, number> = { base: 1, gold: 2, diamond: 2, hof: 3, actolytrene: 3 };
  return map[tier];
}

/** Flat bonus dice value added per tier (in addition to rerolls at diamond+) */
function bonusDiceValue(tier: BadgeTier): number {
  // base=0, gold=0, diamond=+0.5, hof=0, actolytrene=+1
  const map: Record<BadgeTier, number> = { base: 0, gold: 0, diamond: 0.5, hof: 0, actolytrene: 1 };
  return map[tier];
}

/** Bonus-type badge: flat dice bonus per tier */
function bonusTypeDiceValue(tier: BadgeTier): number {
  const map: Record<BadgeTier, number> = { base: 0.5, gold: 0.5, diamond: 0.5, hof: 1, actolytrene: 1.5 };
  return map[tier];
}

/** Bonus-type badge: number of rerolls on the bonus dice (gold+) */
function bonusTypeRerolls(tier: BadgeTier): number {
  const map: Record<BadgeTier, number> = { base: 0, gold: 1, diamond: 2, hof: 0, actolytrene: 0 };
  return map[tier];
}

/** Debuff: how much to subtract from opponent stat (star-based for 5v5, raw for Runs) */
export function debuffAmount(tier: BadgeTier, mode: "5v5" | "runs"): number {
  const starMap: Record<BadgeTier, number> = { base: 1, gold: 2, diamond: 4, hof: 3, actolytrene: 5 };
  const runMap: Record<BadgeTier, number> = { base: 20, gold: 40, diamond: 80, hof: 60, actolytrene: 100 };
  return mode === "runs" ? runMap[tier] : starMap[tier];
}

/** Floor General boost per tier (star-based for 5v5) */
function boostAmount(tier: BadgeTier, mode: "5v5" | "runs"): number {
  const starMap: Record<BadgeTier, number> = { base: 1, gold: 2, diamond: 3, hof: 4, actolytrene: 5 };
  const runMap: Record<BadgeTier, number> = { base: 10, gold: 20, diamond: 30, hof: 40, actolytrene: 50 };
  return mode === "runs" ? runMap[tier] : starMap[tier];
}

// ─── Passive badge helpers ───

/** Hidden Gem: penalty reduction fraction per tier (1.0 = full negation) */
function hiddenGemPenaltyReduction(tier: BadgeTier): number {
  const map: Record<BadgeTier, number> = { base: 0.5, gold: 1.0, diamond: 1.0, hof: 1.0, actolytrene: 1.0 };
  return map[tier];
}

/** Hidden Gem: bonus multiplier added on top (only at diamond+) */
function hiddenGemBoostPercent(tier: BadgeTier): number {
  const map: Record<BadgeTier, number> = { base: 0, gold: 0, diamond: 0.05, hof: 0.10, actolytrene: 0.15 };
  return map[tier];
}

/** Mr. Versatile: extra Signature Trait slots per tier */
function versatileSlots(tier: BadgeTier): number {
  const map: Record<BadgeTier, number> = { base: 1, gold: 2, diamond: 3, hof: 4, actolytrene: 5 };
  return map[tier];
}

// ─── Badge matching ───

/** Get badges that match a specific stat and effect type */
function findBadges(badges: CardBadge[], stat: StatKey, effectType: string): CardBadge[] {
  return badges.filter(
    (b) => b.effect_type === effectType && b.affected_stat === stat,
  );
}

/** Get the highest-tier badge of a given type for a stat */
function bestBadge(badges: CardBadge[], stat: StatKey, effectType: string): CardBadge | null {
  const matches = findBadges(badges, stat, effectType);
  if (matches.length === 0) return null;
  return matches.reduce((best, b) => (TIER_ORDER[b.tier] > TIER_ORDER[best.tier] ? b : best));
}

// ─── Public API ───

/**
 * Apply debuffs: check if the opponent has Lockdown/Intimidator-type badges
 * that affect the stat being used. Returns the reduced stat value and activations.
 *
 * Also checks if the roller has a "cancel" badge (Art of F You) that can nullify.
 */
export function applyDebuffs(
  stat: StatKey,
  statValue: number,
  opponentBadges: CardBadge[],
  rollerBadges: CardBadge[],
  mode: "5v5" | "runs",
): { adjustedStat: number; activations: BadgeActivation[] } {
  const activations: BadgeActivation[] = [];
  let adjusted = statValue;

  const debuffBadge = bestBadge(opponentBadges, stat, "debuff");
  if (!debuffBadge) return { adjustedStat: adjusted, activations };

  // Check for cancel badge on the roller
  const cancelBadge = bestBadge(rollerBadges, stat, "cancel");
  if (cancelBadge && TIER_ORDER[cancelBadge.tier] >= TIER_ORDER[debuffBadge.tier]) {
    activations.push({
      badgeName: cancelBadge.name,
      abbreviation: cancelBadge.abbreviation,
      tier: cancelBadge.tier,
      effect: `Cancelled ${debuffBadge.name} (${debuffBadge.tier})`,
    });
    return { adjustedStat: adjusted, activations };
  }

  const reduction = debuffAmount(debuffBadge.tier, mode);
  adjusted = Math.max(0, adjusted - reduction);
  activations.push({
    badgeName: debuffBadge.name,
    abbreviation: debuffBadge.abbreviation,
    tier: debuffBadge.tier,
    effect: `-${reduction} ${stat} (debuff)`,
  });

  return { adjustedStat: adjusted, activations };
}

/**
 * Apply Floor General boost: check if any teammate has a "boost" badge
 * that matches the active stat.
 */
export function applyFloorGeneralBoost(
  stat: StatKey,
  statValue: number,
  teammateBadges: CardBadge[], // badges from all OTHER cards on the team (not the active card)
  mode: "5v5" | "runs",
): { adjustedStat: number; activations: BadgeActivation[] } {
  const activations: BadgeActivation[] = [];
  let adjusted = statValue;

  // Floor General has affected_stat = null (boosts all stats) or specific stat
  const boostBadges = teammateBadges.filter(
    (b) => b.effect_type === "boost" && (b.affected_stat === null || b.affected_stat === stat),
  );

  if (boostBadges.length === 0) return { adjustedStat: adjusted, activations };

  // Use highest tier among all teammates' boost badges
  const best = boostBadges.reduce((a, b) => (TIER_ORDER[b.tier] > TIER_ORDER[a.tier] ? b : a));
  const boost = boostAmount(best.tier, mode);
  adjusted += boost;
  activations.push({
    badgeName: best.name,
    abbreviation: best.abbreviation,
    tier: best.tier,
    effect: `+${boost} ${stat} (teammate boost)`,
  });

  return { adjustedStat: adjusted, activations };
}

/**
 * Apply reroll badges: if the card has a "reroll" badge for this stat,
 * re-roll dice up to N times and keep the best total.
 */
export function applyRerolls(
  stat: StatKey,
  originalDice: number[],
  badges: CardBadge[],
): { finalDice: number[]; bonusValue: number; activations: BadgeActivation[] } {
  const activations: BadgeActivation[] = [];
  let bestDice = [...originalDice];
  let bestTotal = originalDice.reduce((a, b) => a + b, 0);
  let bonusValue = 0;

  const badge = bestBadge(badges, stat, "reroll");
  if (!badge) return { finalDice: bestDice, bonusValue, activations };

  const rerolls = rerollCount(badge.tier);
  const diceCount = originalDice.length as 1 | 2;
  let rerolled = false;

  for (let i = 0; i < rerolls; i++) {
    const newRoll = rollDice(diceCount);
    if (newRoll.diceTotal > bestTotal) {
      bestDice = newRoll.dice;
      bestTotal = newRoll.diceTotal;
      rerolled = true;
    }
  }

  // Diamond/Actolytrene also add a flat dice bonus
  const flatBonus = bonusDiceValue(badge.tier);
  bonusValue = flatBonus;

  const parts: string[] = [];
  if (rerolled) parts.push(`rerolled → [${bestDice.join("+")}]`);
  if (flatBonus > 0) parts.push(`+${flatBonus} bonus`);

  if (parts.length > 0) {
    activations.push({
      badgeName: badge.name,
      abbreviation: badge.abbreviation,
      tier: badge.tier,
      effect: parts.join(", "),
    });
  }

  return { finalDice: bestDice, bonusValue, activations };
}

/**
 * Apply bonus badges: add partial/full bonus dice value to the roll total.
 * Gold/Diamond tiers also get rerolls on the bonus itself.
 */
export function applyBonusBadge(
  stat: StatKey,
  badges: CardBadge[],
): { bonusValue: number; activations: BadgeActivation[] } {
  const activations: BadgeActivation[] = [];
  const badge = bestBadge(badges, stat, "bonus");
  if (!badge) return { bonusValue: 0, activations };

  let baseBonus = bonusTypeDiceValue(badge.tier);
  const rerolls = bonusTypeRerolls(badge.tier);

  // For tiers with rerolls, roll a d6 and potentially reroll
  if (rerolls > 0) {
    let bestRoll = rollDice(1).dice[0];
    for (let i = 0; i < rerolls; i++) {
      const newRoll = rollDice(1).dice[0];
      if (newRoll > bestRoll) bestRoll = newRoll;
    }
    // Scale the bonus by the roll (e.g., 0.5 * best_d6_roll / 6)
    baseBonus = Math.round(baseBonus * bestRoll) / 6 + baseBonus;
  }

  const roundedBonus = Math.round(baseBonus * 10) / 10;

  activations.push({
    badgeName: badge.name,
    abbreviation: badge.abbreviation,
    tier: badge.tier,
    effect: `+${roundedBonus} bonus dice`,
  });

  return { bonusValue: roundedBonus, activations };
}

/**
 * Master function: apply all badge effects to a roll in sequence.
 * Order: debuffs → boosts → roll → rerolls → bonuses
 *
 * Returns the adjusted stat value, final dice, total bonus, and all activations.
 */
export function resolveBadgeEffects(
  stat: StatKey,
  statValue: number,
  originalDice: number[],
  cardBadges: CardBadge[],
  opponentBadges: CardBadge[],
  teammateBadges: CardBadge[],
  mode: "5v5" | "runs",
): {
  adjustedStat: number;
  finalDice: number[];
  totalBonus: number;
  activations: BadgeActivation[];
} {
  const allActivations: BadgeActivation[] = [];

  // 1. Debuffs from opponent
  const { adjustedStat: afterDebuff, activations: debuffActs } = applyDebuffs(
    stat, statValue, opponentBadges, cardBadges, mode,
  );
  allActivations.push(...debuffActs);

  // 2. Teammate boosts (Floor General)
  const { adjustedStat: afterBoost, activations: boostActs } = applyFloorGeneralBoost(
    stat, afterDebuff, teammateBadges, mode,
  );
  allActivations.push(...boostActs);

  // 3. Rerolls on own dice
  const { finalDice, bonusValue: rerollBonus, activations: rerollActs } = applyRerolls(
    stat, originalDice, cardBadges,
  );
  allActivations.push(...rerollActs);

  // 4. Bonus badges
  const { bonusValue: bonusBadgeVal, activations: bonusActs } = applyBonusBadge(
    stat, cardBadges,
  );
  allActivations.push(...bonusActs);

  return {
    adjustedStat: afterBoost,
    finalDice,
    totalBonus: rerollBonus + bonusBadgeVal,
    activations: allActivations,
  };
}

// ─── Passive badge API ───

/**
 * Hidden Gem: Adjusts the difficulty modifier based on tier.
 *
 * - Base: reduces difficulty penalty by 50%
 * - Gold: fully negates difficulty penalty
 * - Diamond: negates penalty + 5% boost
 * - HOF: negates penalty + 10% boost
 * - Actolytrene: negates penalty + 15% boost
 *
 * Returns the adjusted difficulty modifier and an optional activation.
 * If the card has no Hidden Gem badge, returns the original modifier unchanged.
 */
export function applyHiddenGem(
  difficultyModifier: number,
  badges: CardBadge[],
): { adjustedModifier: number; activation: BadgeActivation | null } {
  const badge = badges.find(
    (b) => b.effect_type === "passive" && b.name.toLowerCase().includes("hidden gem"),
  );
  if (!badge) return { adjustedModifier: difficultyModifier, activation: null };

  let adjusted = difficultyModifier;
  const parts: string[] = [];

  // If there's a penalty (modifier < 1.0), reduce or negate it
  if (difficultyModifier < 1.0) {
    const penalty = 1.0 - difficultyModifier; // e.g. 0.2 for a 2-star gap
    const reduction = hiddenGemPenaltyReduction(badge.tier);
    adjusted = 1.0 - penalty * (1.0 - reduction);
    if (reduction >= 1.0) {
      parts.push("penalty negated");
    } else {
      parts.push(`${Math.round(reduction * 100)}% penalty reduced`);
    }
  }

  // Diamond+ adds a boost on top
  const boost = hiddenGemBoostPercent(badge.tier);
  if (boost > 0) {
    adjusted += boost;
    parts.push(`+${Math.round(boost * 100)}% boost`);
  }

  return {
    adjustedModifier: adjusted,
    activation: {
      badgeName: badge.name,
      abbreviation: badge.abbreviation,
      tier: badge.tier,
      effect: parts.join(", "),
    },
  };
}

/** @deprecated Use applyHiddenGem instead */
export function hasHiddenGem(badges: CardBadge[]): boolean {
  return badges.some(
    (b) => b.effect_type === "passive" && b.name.toLowerCase().includes("hidden gem"),
  );
}

/** Default badge slot count per player card */
export const BASE_BADGE_SLOTS = 5;

/**
 * Mr. Versatile: Grants extra Signature Trait slots based on tier.
 * Base = +1 slot, Gold = +2, Diamond = +3, HOF = +4, Actolytrene = +5.
 *
 * Returns the number of additional trait slots (0 if no badge).
 */
export function getMrVersatileSlots(badges: CardBadge[]): {
  extraSlots: number;
  activation: BadgeActivation | null;
} {
  const badge = badges.find(
    (b) => b.effect_type === "passive" && b.name.toLowerCase().includes("versatile"),
  );
  if (!badge) return { extraSlots: 0, activation: null };

  const slots = versatileSlots(badge.tier);
  return {
    extraSlots: slots,
    activation: {
      badgeName: badge.name,
      abbreviation: badge.abbreviation,
      tier: badge.tier,
      effect: `+${slots} Signature Trait slot${slots > 1 ? "s" : ""}`,
    },
  };
}

/**
 * Fetch badges for a list of card IDs from the database.
 * Returns a map of cardId → CardBadge[].
 */
export async function fetchBadgesForCards(
  supabaseClient: any,
  cardIds: string[],
): Promise<Record<string, CardBadge[]>> {
  if (cardIds.length === 0) return {};

  const { data, error } = await supabaseClient
    .from("player_card_badges")
    .select("player_card_id, tier, badges(id, name, abbreviation, affected_stat, effect_type)")
    .in("player_card_id", cardIds);

  if (error || !data) return {};

  const map: Record<string, CardBadge[]> = {};
  for (const row of data as any[]) {
    const badge = row.badges;
    if (!badge) continue;
    const cardId = row.player_card_id;
    if (!map[cardId]) map[cardId] = [];
    map[cardId].push({
      badgeId: badge.id,
      name: badge.name,
      abbreviation: badge.abbreviation,
      affected_stat: badge.affected_stat,
      effect_type: badge.effect_type,
      tier: row.tier as BadgeTier,
    });
  }
  return map;
}

/**
 * Get all teammate badges for a lineup (excluding the active card's own badges).
 */
export function getTeammateBadges(
  badgeMap: Record<string, CardBadge[]>,
  lineup: { id: string }[],
  activeCardId: string,
): CardBadge[] {
  return lineup
    .filter((c) => c.id !== activeCardId)
    .flatMap((c) => badgeMap[c.id] ?? []);
}
