import { supabase } from "@/integrations/supabase/client";
import type { CardGameResult, StatKey } from "@/lib/gameEngine";

/**
 * After a game completes, update evolution progress for all user cards.
 * Evaluates each card's active (incomplete) evo step and increments progress.
 */
export async function trackEvoProgress(
  userId: string,
  userCards: CardGameResult[],
  won: boolean,
) {
  // Get all player card IDs
  const cardIds = userCards.map((c) => c.playerCardId);
  if (cardIds.length === 0) return;

  // Fetch evo paths for these cards
  const { data: evoPaths, error: evoErr } = await supabase
    .from("evo_paths")
    .select("*")
    .in("player_card_id", cardIds)
    .order("step_order");

  if (evoErr || !evoPaths || evoPaths.length === 0) return;

  // Fetch existing progress
  const { data: existingProgress } = await supabase
    .from("user_evo_progress")
    .select("*")
    .eq("user_id", userId)
    .in("player_card_id", cardIds);

  const progressMap = new Map(
    (existingProgress ?? []).map((p) => [p.evo_path_id, p])
  );

  // Group evo paths by player card
  const pathsByCard = new Map<string, typeof evoPaths>();
  for (const path of evoPaths) {
    const arr = pathsByCard.get(path.player_card_id) ?? [];
    arr.push(path);
    pathsByCard.set(path.player_card_id, arr);
  }

  for (const card of userCards) {
    const paths = pathsByCard.get(card.playerCardId);
    if (!paths) continue;

    // Find the first incomplete step
    const activeStep = paths.find((p) => {
      const prog = progressMap.get(p.id);
      return !prog || !prog.completed;
    });
    if (!activeStep) continue;

    const increment = computeIncrement(activeStep, card, won);
    if (increment <= 0) continue;

    const existing = progressMap.get(activeStep.id);
    const newValue = (existing?.current_value ?? 0) + increment;
    const completed = newValue >= activeStep.challenge_target;

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
      // Accumulate a specific stat across games
      if (stat && card.statValues[stat] != null) {
        return card.statValues[stat];
      }
      // Fallback: sum all stat rolls
      return Object.values(card.statValues).reduce((a, b) => a + b, 0);

    case "single_game_stat":
      // Check if the stat value in THIS game meets the target
      if (stat && card.statValues[stat] != null) {
        return card.statValues[stat] >= step.challenge_target ? 1 : 0;
      }
      return 0;

    case "stat_game_count":
      // Count games where the stat exceeds target threshold
      // For this type, challenge_target is the NUMBER of games needed,
      // and we need a secondary threshold. We use challenge_target as the game count
      // and infer a per-game threshold from the description or use a default.
      // Since we track incrementally, each game that hits the stat threshold adds 1.
      if (stat && card.statValues[stat] != null) {
        // The per-game threshold is embedded in the target; we use 20 as default
        // or parse from description. For simplicity: if stat >= 20, count it.
        return card.statValues[stat] >= 20 ? 1 : 0;
      }
      return 0;

    default:
      return 0;
  }
}
