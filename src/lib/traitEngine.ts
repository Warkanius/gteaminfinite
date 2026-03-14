/**
 * Trait Engine — Signature Trait resolution for 5v5 and Runs modes.
 *
 * condition_type values:
 *   home       — boost target_stat if home game
 *   away       — boost target_stat if away game
 *   key_game   — boost target_stat if key game
 *   underdog   — boost target_stat if opponent rated higher
 *   low_stat   — boost target_stat if that stat is below average
 *   teammate   — boost a teammate's target_stat
 *   passive    — Mr. Versatile (badge slots), Scientist (evolution)
 */

import type { StatKey } from "@/lib/gameEngine";

// ─── Types ───

export type TraitTier = "base" | "gold" | "diamond" | "hof" | "actolytrene";

export interface CardTrait {
  traitId: string;
  name: string;
  abbreviation: string;
  condition_type: string | null;
  target_stat: string | null;
  tier: TraitTier;
}

export interface TraitActivation {
  traitName: string;
  abbreviation: string;
  tier: TraitTier;
  effect: string;
}

export interface GameContext {
  isHome: boolean;
  isAway: boolean;
  isKeyGame: boolean;
}

// ─── Tier scaling ───

const TIER_LEVEL: Record<TraitTier, number> = {
  base: 1,
  gold: 2,
  hof: 3,
  diamond: 4,
  actolytrene: 5,
};

/** Boost amount per tier: stars for 5v5, ×20 for runs */
function boostPerTier(tier: TraitTier, mode: "5v5" | "runs"): number {
  const level = TIER_LEVEL[tier];
  return mode === "runs" ? level * 20 : level;
}

// ─── Condition checkers ───

function conditionMet(
  conditionType: string | null,
  context: GameContext,
  opponentRating?: number,
  cardRating?: number,
  statValue?: number,
  cardAvgStat?: number,
): boolean {
  switch (conditionType) {
    case "home":
      return context.isHome;
    case "away":
      return context.isAway;
    case "key_game":
      return context.isKeyGame;
    case "underdog":
      return opponentRating != null && cardRating != null && opponentRating > cardRating;
    case "low_stat":
      return statValue != null && cardAvgStat != null && statValue < cardAvgStat;
    default:
      return false;
  }
}

// ─── Public API ───

/**
 * Fetch traits for a list of card IDs from the database.
 * Returns a map of cardId → CardTrait[].
 */
export async function fetchTraitsForCards(
  supabaseClient: any,
  cardIds: string[],
): Promise<Record<string, CardTrait[]>> {
  if (cardIds.length === 0) return {};

  const { data, error } = await supabaseClient
    .from("player_card_traits")
    .select("player_card_id, tier, target_stat, signature_traits(id, name, abbreviation, condition_type)")
    .in("player_card_id", cardIds);

  if (error || !data) return {};

  const map: Record<string, CardTrait[]> = {};
  for (const row of data as any[]) {
    const trait = row.signature_traits;
    if (!trait) continue;
    const cardId = row.player_card_id;
    if (!map[cardId]) map[cardId] = [];
    map[cardId].push({
      traitId: trait.id,
      name: trait.name,
      abbreviation: trait.abbreviation,
      condition_type: trait.condition_type,
      target_stat: row.target_stat,
      tier: row.tier as TraitTier,
    });
  }
  return map;
}

/**
 * Resolve trait boosts for a given stat on a card.
 * Checks each conditional trait and applies boost if condition is met and target_stat matches.
 */
export function resolveTraitBoosts(
  stat: StatKey,
  statValue: number,
  traits: CardTrait[],
  context: GameContext,
  mode: "5v5" | "runs",
  opponentRating?: number,
  cardRating?: number,
  cardAvgStat?: number,
): { adjustedStat: number; activations: TraitActivation[] } {
  const activations: TraitActivation[] = [];
  let adjusted = statValue;

  for (const trait of traits) {
    // Skip passive and teammate traits
    if (trait.condition_type === "passive" || trait.condition_type === "teammate") continue;
    // Must target this stat
    if (trait.target_stat !== stat) continue;

    const statForCheck = trait.condition_type === "low_stat" ? statValue : undefined;

    if (conditionMet(trait.condition_type, context, opponentRating, cardRating, statForCheck, cardAvgStat)) {
      const boost = boostPerTier(trait.tier, mode);
      adjusted += boost;
      activations.push({
        traitName: trait.name,
        abbreviation: trait.abbreviation,
        tier: trait.tier,
        effect: `+${boost} ${stat} (${trait.condition_type})`,
      });
    }
  }

  return { adjustedStat: adjusted, activations };
}

/**
 * Resolve teammate trait boosts (FTN / "_____ these _____s").
 * Checks all teammates' traits for condition_type === "teammate" targeting this stat.
 */
export function resolveTeammateTraitBoosts(
  stat: StatKey,
  statValue: number,
  teammateTraits: CardTrait[],
  mode: "5v5" | "runs",
): { adjustedStat: number; activations: TraitActivation[] } {
  const activations: TraitActivation[] = [];
  let adjusted = statValue;

  // Find the best teammate trait targeting this stat
  let bestTrait: CardTrait | null = null;
  for (const trait of teammateTraits) {
    if (trait.condition_type !== "teammate") continue;
    if (trait.target_stat !== stat) continue;
    if (!bestTrait || TIER_LEVEL[trait.tier] > TIER_LEVEL[bestTrait.tier]) {
      bestTrait = trait;
    }
  }

  if (bestTrait) {
    const boost = boostPerTier(bestTrait.tier, mode);
    adjusted += boost;
    activations.push({
      traitName: bestTrait.name,
      abbreviation: bestTrait.abbreviation,
      tier: bestTrait.tier,
      effect: `+${boost} ${stat} (teammate trait)`,
    });
  }

  return { adjustedStat: adjusted, activations };
}

/**
 * Get all teammate traits for a lineup (excluding the active card).
 */
export function getTeammateTraits(
  traitMap: Record<string, CardTrait[]>,
  lineup: { id: string }[],
  activeCardId: string,
): CardTrait[] {
  return lineup
    .filter((c) => c.id !== activeCardId)
    .flatMap((c) => traitMap[c.id] ?? []);
}

/**
 * Compute average stat value across the 9 stats for low_stat condition.
 */
export function computeCardAvgStat(card: any): number {
  const stats = [
    card.stat_3pt, card.stat_mid, card.stat_fin, card.stat_dnk,
    card.stat_ast, card.stat_stl, card.stat_reb, card.stat_blk, card.stat_int,
  ];
  return stats.reduce((a: number, b: number) => a + b, 0) / stats.length;
}

/**
 * Mr. Versatile: returns extra badge slots from traits (mirrors badgeEngine).
 */
export function getTraitBadgeSlots(traits: CardTrait[]): number {
  const mv = traits.find(
    (t) => t.condition_type === "passive" && t.abbreviation === "MV",
  );
  if (!mv) return 0;
  return TIER_LEVEL[mv.tier];
}

/**
 * Scientist: returns evolution multiplier.
 * base=1.2, gold=1.4, hof=1.6, diamond=1.8, actolytrene=2.0
 */
export function getEvolutionMultiplier(traits: CardTrait[]): number {
  const sci = traits.find(
    (t) => t.condition_type === "passive" && t.abbreviation === "Sci",
  );
  if (!sci) return 1.0;
  return 1.0 + TIER_LEVEL[sci.tier] * 0.2;
}
