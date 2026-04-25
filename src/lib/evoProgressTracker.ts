import { supabase } from "@/integrations/supabase/client";
import type { CardGameResult, StatKey } from "@/lib/gameEngine";
import { fetchTraitsForCards, getEvolutionMultiplier, type CardTrait } from "@/lib/traitEngine";
import { postLeagueEvent } from "@/lib/leagueEvents";

/** When an evo step just completed, fire a media event so the league reacts. */
async function maybePostEvolution(userId: string, playerCardId: string, evoPathId: string) {
  try {
    // Resolve the destination card (after evolution) and its tier name.
    const { data: path } = await supabase
      .from("evo_paths")
      .select("evolves_to_card_id, to_tier_id, player_card_id")
      .eq("id", evoPathId)
      .maybeSingle();
    const targetCardId = path?.evolves_to_card_id ?? playerCardId;
    const { data: card } = await supabase
      .from("player_cards")
      .select("name, gem_tiers(name, sort_order)")
      .eq("id", targetCardId)
      .maybeSingle();
    const tierName = (card as any)?.gem_tiers?.name ?? null;

    // Check the configurable gate.
    const { data: minRule } = await supabase
      .from("rule_config")
      .select("value")
      .eq("key", "evolution_post_min_gem_tier")
      .maybeSingle();
    const minTierName = (minRule?.value ?? null) as string | null;
    if (minTierName && tierName) {
      const { data: tiers } = await supabase.from("gem_tiers").select("name, sort_order");
      const min = (tiers ?? []).find((t: any) => t.name === minTierName)?.sort_order ?? null;
      const cur = (tiers ?? []).find((t: any) => t.name === tierName)?.sort_order ?? null;
      if (min == null || cur == null || cur < min) return;
    }

    await postLeagueEvent({
      event_type: "evolution",
      player_card_id: targetCardId,
      player_name: card?.name ?? null,
      gem_tier_name: tierName,
      to_tier: tierName,
    });
  } catch (e) {
    console.warn("[maybePostEvolution] swallowed", (e as Error).message);
  }
}

export interface CompoundChallenge {
  type: string;
  stat: string | null;
  target: number;
  description: string;
}

/**
 * After a game completes, update evolution progress for all user cards.
 * Supports both single challenges and compound (multi-requirement) challenges.
 */
export async function trackEvoProgress(
  userId: string,
  userCards: CardGameResult[],
  won: boolean,
) {
  const cardIds = userCards.map((c) => c.playerCardId);
  if (cardIds.length === 0) return;

  const { data: evoPaths, error: evoErr } = await supabase
    .from("evo_paths")
    .select("*")
    .in("player_card_id", cardIds)
    .order("step_order");

  if (evoErr || !evoPaths || evoPaths.length === 0) return;

  const { data: existingProgress } = await supabase
    .from("user_evo_progress")
    .select("*")
    .eq("user_id", userId)
    .in("player_card_id", cardIds);

  const progressMap = new Map(
    (existingProgress ?? []).map((p) => [p.evo_path_id, p])
  );

  // Fetch traits for Scientist multiplier
  const traitMap = await fetchTraitsForCards(supabase, cardIds);

  const pathsByCard = new Map<string, typeof evoPaths>();
  for (const path of evoPaths) {
    const arr = pathsByCard.get(path.player_card_id) ?? [];
    arr.push(path);
    pathsByCard.set(path.player_card_id, arr);
  }

  for (const card of userCards) {
    const paths = pathsByCard.get(card.playerCardId);
    if (!paths) continue;

    const activeStep = paths.find((p) => {
      const prog = progressMap.get(p.id);
      return !prog || !prog.completed;
    });
    if (!activeStep) continue;

    const compounds = (activeStep.compound_challenges as unknown as CompoundChallenge[] | null) ?? [];
    const isCompound = compounds.length > 0;

    const cardTraits = traitMap[card.playerCardId] ?? [];
    const evoMultiplier = getEvolutionMultiplier(cardTraits);

    if (isCompound) {
      await trackCompoundProgress(userId, card, won, activeStep, compounds, progressMap, evoMultiplier);
    } else {
      await trackSingleProgress(userId, card, won, activeStep, progressMap, evoMultiplier);
    }
  }
}

async function trackSingleProgress(
  userId: string,
  card: CardGameResult,
  won: boolean,
  activeStep: any,
  progressMap: Map<string, any>,
  evoMultiplier: number,
) {
  const rawIncrement = computeIncrement(activeStep, card, won);
  if (rawIncrement <= 0) return;
  const increment = Math.round(rawIncrement * evoMultiplier);

  const existing = progressMap.get(activeStep.id);
  const newValue = (existing?.current_value ?? 0) + increment;
  const completed = newValue >= activeStep.challenge_target;
  const wasCompleted = !!existing?.completed;

  if (existing) {
    await supabase
      .from("user_evo_progress")
      .update({
        current_value: newValue,
        completed,
        completed_at: completed ? new Date().toISOString() : null,
      })
      .eq("id", existing.id);
  } else {
    await supabase.from("user_evo_progress").insert({
      user_id: userId,
      player_card_id: card.playerCardId,
      evo_path_id: activeStep.id,
      current_value: newValue,
      completed,
      completed_at: completed ? new Date().toISOString() : null,
    });
  }

  if (completed && !wasCompleted) {
    await maybePostEvolution(userId, card.playerCardId, activeStep.id);
  }
}

async function trackCompoundProgress(
  userId: string,
  card: CardGameResult,
  won: boolean,
  activeStep: any,
  compounds: CompoundChallenge[],
  progressMap: Map<string, any>,
  evoMultiplier: number,
) {
  const existing = progressMap.get(activeStep.id);
  const currentCompound: Record<string, number> = (existing?.compound_progress as Record<string, number>) ?? {};

  let anyChanged = false;
  const updatedCompound = { ...currentCompound };

  for (let i = 0; i < compounds.length; i++) {
    const req = compounds[i];
    const key = String(i);
    const prev = updatedCompound[key] ?? 0;
    if (prev >= req.target) continue; // already met

    const rawInc = computeIncrement(
      { challenge_type: req.type, challenge_target: req.target, challenge_stat: req.stat },
      card,
      won,
    );
    const inc = Math.round(rawInc * evoMultiplier);
    if (inc > 0) {
      updatedCompound[key] = prev + inc;
      anyChanged = true;
    }
  }

  if (!anyChanged) return;

  // Check if ALL sub-requirements are met
  const allMet = compounds.every((req, i) => (updatedCompound[String(i)] ?? 0) >= req.target);
  // current_value = number of completed sub-requirements (for display)
  const completedCount = compounds.filter((req, i) => (updatedCompound[String(i)] ?? 0) >= req.target).length;

  if (existing) {
    await supabase
      .from("user_evo_progress")
      .update({
        current_value: completedCount,
        compound_progress: updatedCompound,
        completed: allMet,
        completed_at: allMet ? new Date().toISOString() : null,
      } as any)
      .eq("id", existing.id);
  } else {
    await supabase.from("user_evo_progress").insert({
      user_id: userId,
      player_card_id: card.playerCardId,
      evo_path_id: activeStep.id,
      current_value: completedCount,
      compound_progress: updatedCompound,
      completed: allMet,
      completed_at: allMet ? new Date().toISOString() : null,
    } as any);
  }
}

function computeIncrement(
  step: {
    challenge_type: string;
    challenge_target: number;
    challenge_stat?: string | null;
  },
  card: CardGameResult,
  won: boolean,
): number {
  const stat = (step.challenge_stat as StatKey) || null;

  switch (step.challenge_type) {
    case "points_scored":
      return card.totalPoints;

    case "games_won":
      return won ? 1 : 0;

    case "stat_threshold":
    case "total_stat":
      if (stat && card.statValues[stat] != null) {
        return card.statValues[stat];
      }
      return Object.values(card.statValues).reduce((a, b) => a + b, 0);

    case "single_game_stat":
      if (stat && card.statValues[stat] != null) {
        return card.statValues[stat] >= step.challenge_target ? 1 : 0;
      }
      return 0;

    case "stat_game_count":
      if (stat && card.statValues[stat] != null) {
        return card.statValues[stat] >= 20 ? 1 : 0;
      }
      return 0;

    default:
      return 0;
  }
}
