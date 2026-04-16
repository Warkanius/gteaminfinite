import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { DiceInput } from "@/components/game/DiceInput";
import { DiceRoll } from "@/components/game/DiceRoll";
import { StatResult } from "@/components/game/StatResult";
import { RerollChoice } from "@/components/game/RerollChoice";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

import { Dice5 } from "lucide-react";
import {
  STATS, STAT_LABELS, getStatDiceCount, resolveStatRoll, buildCardResult,
  rollDice, getCpuDifficultyModifier, type StatRollResult, type CardGameResult, type StatKey,
} from "@/lib/gameEngine";
import {
  resolveBadgeEffects, applyRerolls, getPendingReroll, resolveRerollChoice,
  getTeammateBadges, applyHiddenGem, applyDebuffs, applyFloorGeneralBoost, applyBonusBadge,
  type CardBadge, type BadgeActivation,
} from "@/lib/badgeEngine";
import {
  resolveTraitBoosts, resolveTeammateTraitBoosts, getTeammateTraits,
  computeCardAvgStat, type CardTrait, type TraitActivation, type GameContext,
} from "@/lib/traitEngine";
import type { GameCard, FullGameResult } from "@/pages/Play";

interface GameBoardProps {
  userLineup: GameCard[];
  cpuLineup: GameCard[];
  badgeMap: Record<string, CardBadge[]>;
  traitMap: Record<string, CardTrait[]>;
  onComplete: (result: FullGameResult) => void;
  difficultyStars?: number;
  gameContext: GameContext;
}

function resolveGameplayStars(card: GameCard | undefined, gemStars?: number | null): number {
  if (!card) return 0;
  if (gemStars != null) return Math.max(1, gemStars);

  const roundedRating = Math.round(Number(card.rating) || 0);
  if (roundedRating > 0) return roundedRating;

  return STATS.some((stat) => (card[stat] ?? 0) > 0) ? 1 : 0;
}

export function GameBoard({ userLineup, cpuLineup, badgeMap, traitMap, onComplete, difficultyStars, gameContext }: GameBoardProps) {
  const [playerIdx, setPlayerIdx] = useState(0);
  const [statIdx, setStatIdx] = useState(0);
  const [useOwnDice, setUseOwnDice] = useState(false);

  // Accumulated results per player
  const [userCardResults, setUserCardResults] = useState<CardGameResult[]>([]);
  const [cpuCardResults, setCpuCardResults] = useState<CardGameResult[]>([]);

  // Current player's accumulated stat results
  const [currentUserStats, setCurrentUserStats] = useState<StatRollResult[]>([]);
  const [currentCpuStats, setCurrentCpuStats] = useState<StatRollResult[]>([]);

  // Phase: roll dice, reroll choice, or show result for this stat
  const [phase, setPhase] = useState<"dice" | "reroll" | "result">("dice");
  const [lastUserResult, setLastUserResult] = useState<StatRollResult | null>(null);
  const [lastCpuResult, setLastCpuResult] = useState<StatRollResult | null>(null);

  // Auto-roll animation state
  const [rolling, setRolling] = useState(false);
  const [autoUserDice, setAutoUserDice] = useState<(number | null)[]>([null]);
  const [autoCpuDice, setAutoCpuDice] = useState<(number | null)[]>([null]);

  // Badge + trait activations for display
  const [lastBadgeActivations, setLastBadgeActivations] = useState<(BadgeActivation | TraitActivation)[]>([]);

  // Reroll state
  const [pendingReroll, setPendingReroll] = useState<{
    originalUserDice: number[];
    rerollDice: number[];
    badge: CardBadge;
    bonusValue: number;
    cpuDice: number[];
    precomputedActivations: (BadgeActivation | TraitActivation)[];
    userTraitAdjustedStat: number;
    cpuTraitAdjustedStat: number;
    cpuBadgeResult: any;
    effectiveDifficulty: number | undefined;
  } | null>(null);

  // Running score
  const userRunningScore = useMemo(
    () => userCardResults.reduce((s, c) => s + c.totalPoints, 0) +
      currentUserStats.reduce((s, r) => s + r.points, 0),
    [userCardResults, currentUserStats]
  );
  const cpuRunningScore = useMemo(
    () => cpuCardResults.reduce((s, c) => s + c.totalPoints, 0) +
      currentCpuStats.reduce((s, r) => s + r.points, 0),
    [cpuCardResults, currentCpuStats]
  );

  const { data: gemTiers = [] } = useQuery({
    queryKey: ["gem-tiers"],
    queryFn: async () => {
      const { data } = await supabase.from("gem_tiers").select("*").order("sort_order");
      return data ?? [];
    },
  });
  const gemTierMap = useMemo(() => Object.fromEntries(gemTiers.map((g) => [g.id, g])), [gemTiers]);

  const userCard = userLineup[playerIdx];
  const cpuCard = cpuLineup[playerIdx];
  const currentStat = STATS[statIdx];

  const userGem = gemTierMap[userCard?.gem_tier_id ?? ""];
  const cpuGem = gemTierMap[cpuCard?.gem_tier_id ?? ""];
  const userStars = resolveGameplayStars(userCard, userGem?.stars);
  const cpuStars = resolveGameplayStars(cpuCard, cpuGem?.stars);
  // Dice count is now derived from individual stat value, not overall stars
  const userStatValue = userCard?.[currentStat] ?? 0;
  const cpuStatValue = cpuCard?.[currentStat] ?? 0;
  const userDiceCount = getStatDiceCount(userStatValue);
  const cpuDiceCount = getStatDiceCount(cpuStatValue);
  const maxDiceCount = Math.max(userDiceCount, cpuDiceCount);

  // Finalize the stat result given user's final dice (after reroll choice or direct)
  const finalizeStatResult = useCallback((
    userFinalDice: number[],
    userRerollBonus: number,
    userRerollActivations: BadgeActivation[],
    cpuDice: number[],
    preActivations: (BadgeActivation | TraitActivation)[],
    userTraitAdjustedStat: number,
    cpuTraitAdjustedStat: number,
    cpuBadgeResult: any,
    effectiveDifficulty: number | undefined,
  ) => {
    const allActivations = [...preActivations, ...userRerollActivations];

    // User: apply debuffs, boosts, bonus badges (non-reroll) on the final dice
    const userBadges = badgeMap[userCard.id] ?? [];
    const cpuDefenderBadges = badgeMap[cpuCard.id] ?? [];
    const userTeammateBadges = getTeammateBadges(badgeMap, userLineup, userCard.id);

    const { adjustedStat: userAfterDebuff, activations: debuffActs } = applyDebuffs(
      currentStat, userTraitAdjustedStat, cpuDefenderBadges, userBadges, "5v5",
    );
    allActivations.push(...debuffActs);

    const { adjustedStat: userAfterBoost, activations: boostActs } = applyFloorGeneralBoost(
      currentStat, userAfterDebuff, userTeammateBadges, "5v5",
    );
    allActivations.push(...boostActs);

    const { bonusValue: userBonusBadgeVal, activations: bonusActs } = applyBonusBadge(currentStat, userBadges);
    allActivations.push(...bonusActs);

    const userTotalBonus = userRerollBonus + userBonusBadgeVal;

    // Hidden Gem
    let finalEffectiveDifficulty = effectiveDifficulty;
    if (difficultyStars != null) {
      const userBadgesForGem = badgeMap[userCard.id] ?? [];
      const rawDiffMod = 1 + (userStars - difficultyStars) * 0.1;
      const { adjustedModifier, activation: gemAct } = applyHiddenGem(rawDiffMod, userBadgesForGem);
      if (gemAct) {
        allActivations.push(gemAct);
        finalEffectiveDifficulty = userStars - (adjustedModifier - 1) / 0.1;
      }
    }

    // CPU badge result activations
    allActivations.push(...cpuBadgeResult.activations);

    const uResult = resolveStatRoll(
      currentStat, userAfterBoost, userStars,
      userFinalDice, finalEffectiveDifficulty,
    );
    if (userTotalBonus > 0) {
      uResult.rollResult += Math.round(userTotalBonus);
      uResult.points = uResult.rollResult * uResult.pointMultiplier;
    }

    const cResult = resolveStatRoll(
      currentStat, cpuBadgeResult.adjustedStat, cpuStars,
      cpuBadgeResult.finalDice,
    );
    if (cpuBadgeResult.totalBonus > 0) {
      cResult.rollResult += Math.round(cpuBadgeResult.totalBonus);
      cResult.points = cResult.rollResult * cResult.pointMultiplier;
    }

    setLastUserResult(uResult);
    setLastCpuResult(cResult);
    setCurrentUserStats((prev) => [...prev, uResult]);
    setCurrentCpuStats((prev) => [...prev, cResult]);
    setLastBadgeActivations(allActivations);
    setPhase("result");
  }, [currentStat, userCard, cpuCard, userStars, cpuStars, difficultyStars, badgeMap, userLineup]);

  const handleRerollChoice = useCallback((keepReroll: boolean) => {
    if (!pendingReroll) return;
    const { originalUserDice, rerollDice, badge, bonusValue, cpuDice, precomputedActivations, userTraitAdjustedStat, cpuTraitAdjustedStat, cpuBadgeResult, effectiveDifficulty } = pendingReroll;
    const { finalDice, bonusValue: rerollBonusVal, activations: rerollActs } = resolveRerollChoice(
      originalUserDice, rerollDice, keepReroll, badge, bonusValue,
    );
    setPendingReroll(null);
    finalizeStatResult(finalDice, rerollBonusVal, rerollActs, cpuDice, precomputedActivations, userTraitAdjustedStat, cpuTraitAdjustedStat, cpuBadgeResult, effectiveDifficulty);
  }, [pendingReroll, finalizeStatResult]);

  const handleDiceSubmit = useCallback((userDice: number[], cpuDice: number[]) => {
    const preActivations: (BadgeActivation | TraitActivation)[] = [];

    // --- User card: apply traits ---
    const userTraits = traitMap[userCard.id] ?? [];
    const userTeammateTraits = getTeammateTraits(traitMap, userLineup, userCard.id);
    const userAvgStat = computeCardAvgStat(userCard);
    
    const userTraitResult = resolveTraitBoosts(
      currentStat, userCard[currentStat], userTraits, gameContext, "5v5",
      cpuCard.rating, userCard.rating, userAvgStat,
    );
    preActivations.push(...userTraitResult.activations);
    const userTeammateTraitResult = resolveTeammateTraitBoosts(
      currentStat, userTraitResult.adjustedStat, userTeammateTraits, "5v5",
    );
    preActivations.push(...userTeammateTraitResult.activations);

    // --- CPU card: apply traits + full badge resolution (CPU auto-resolves) ---
    const cpuTraits = traitMap[cpuCard.id] ?? [];
    const cpuTeammateTraits = getTeammateTraits(traitMap, cpuLineup, cpuCard.id);
    const cpuAvgStat = computeCardAvgStat(cpuCard);

    const cpuTraitResult = resolveTraitBoosts(
      currentStat, cpuCard[currentStat], cpuTraits, gameContext, "5v5",
      userCard.rating, cpuCard.rating, cpuAvgStat,
    );
    preActivations.push(...cpuTraitResult.activations);
    const cpuTeammateTraitResult = resolveTeammateTraitBoosts(
      currentStat, cpuTraitResult.adjustedStat, cpuTeammateTraits, "5v5",
    );
    preActivations.push(...cpuTeammateTraitResult.activations);

    const cpuBadges = badgeMap[cpuCard.id] ?? [];
    const userDefenderBadges = badgeMap[userCard.id] ?? [];
    const cpuTeammateBadges = getTeammateBadges(badgeMap, cpuLineup, cpuCard.id);

    const cpuBadgeResult = resolveBadgeEffects(
      currentStat, cpuTeammateTraitResult.adjustedStat, cpuDice,
      cpuBadges, userDefenderBadges, cpuTeammateBadges, "5v5",
    );

    // Check if user has a reroll badge for this stat
    const userBadges = badgeMap[userCard.id] ?? [];
    const rerollInfo = getPendingReroll(currentStat, userDice, userBadges);

    if (rerollInfo) {
      // Show reroll choice to user
      setPendingReroll({
        originalUserDice: userDice,
        rerollDice: rerollInfo.rerollDice,
        badge: rerollInfo.badge,
        bonusValue: rerollInfo.bonusValue,
        cpuDice,
        precomputedActivations: preActivations,
        userTraitAdjustedStat: userTeammateTraitResult.adjustedStat,
        cpuTraitAdjustedStat: cpuTeammateTraitResult.adjustedStat,
        cpuBadgeResult,
        effectiveDifficulty: difficultyStars,
      });
      setPhase("reroll");
    } else {
      // No reroll — finalize directly
      finalizeStatResult(userDice, 0, [], cpuDice, preActivations, userTeammateTraitResult.adjustedStat, cpuTeammateTraitResult.adjustedStat, cpuBadgeResult, difficultyStars);
    }
  }, [currentStat, userCard, cpuCard, userStars, cpuStars, difficultyStars, badgeMap, traitMap, gameContext, userLineup, cpuLineup, finalizeStatResult]);

  const handleAutoRoll = useCallback(() => {
    setRolling(true);
    setAutoUserDice(Array(userDiceCount).fill(null));
    setAutoCpuDice(Array(cpuDiceCount).fill(null));

    setTimeout(() => {
      const uRoll = rollDice(userDiceCount);
      const cRoll = rollDice(cpuDiceCount);
      setAutoUserDice(uRoll.dice);
      setAutoCpuDice(cRoll.dice);
      setRolling(false);

      setTimeout(() => {
        handleDiceSubmit(uRoll.dice, cRoll.dice);
      }, 600);
    }, 1000);
  }, [handleDiceSubmit, userDiceCount, cpuDiceCount]);

  const handleManualSubmit = useCallback((userDice: number[], cpuDice: number[]) => {
    handleDiceSubmit(userDice, cpuDice);
  }, [handleDiceSubmit]);

  const handleNext = useCallback(() => {
    const nextStatIdx = statIdx + 1;

    if (nextStatIdx < STATS.length) {
      // Next stat, same player
      setStatIdx(nextStatIdx);
      setPhase("dice");
      setLastUserResult(null);
      setLastCpuResult(null);
      setAutoUserDice(Array(userDiceCount).fill(null));
      setAutoCpuDice(Array(cpuDiceCount).fill(null));
    } else {
      // Player done — save their results
      const uCardResult = buildCardResult(userCard.id, userCard.name, "user", currentUserStats);
      const cCardResult = buildCardResult(cpuCard.id, cpuCard.name, "cpu", currentCpuStats);
      const newUserResults = [...userCardResults, uCardResult];
      const newCpuResults = [...cpuCardResults, cCardResult];

      if (playerIdx + 1 < 5) {
        // Next player
        setUserCardResults(newUserResults);
        setCpuCardResults(newCpuResults);
        setPlayerIdx(playerIdx + 1);
        setStatIdx(0);
        setCurrentUserStats([]);
        setCurrentCpuStats([]);
        setPhase("dice");
        setLastUserResult(null);
        setLastCpuResult(null);
      } else {
        // Game complete
        const userTotal = newUserResults.reduce((s, c) => s + c.totalPoints, 0);
        const cpuTotal = newCpuResults.reduce((s, c) => s + c.totalPoints, 0);
        onComplete({ userCards: newUserResults, cpuCards: newCpuResults, userTotal, cpuTotal });
      }
    }
  }, [statIdx, playerIdx, userCard, cpuCard, currentUserStats, currentCpuStats, userCardResults, cpuCardResults, userDiceCount, cpuDiceCount, onComplete]);

  if (!userCard || !cpuCard) return null;

  const isLastStat = statIdx >= STATS.length - 1;
  const isLastPlayer = playerIdx >= 4;

  return (
    <div className="space-y-5">
      {/* Scoreboard */}
      <div className="flex items-center justify-center gap-6">
        <div className="text-center">
          <p className="text-xs text-muted-foreground uppercase">You</p>
          <p className="text-3xl font-bold font-display">{userRunningScore}</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-muted-foreground">Player {playerIdx + 1}/5</p>
          <p className="text-xs text-muted-foreground">Stat {statIdx + 1}/9</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-muted-foreground uppercase">CPU</p>
          <p className="text-3xl font-bold font-display">{cpuRunningScore}</p>
        </div>
      </div>

      {/* Current stat */}
      <div className="text-center">
        <span className="text-xs text-muted-foreground uppercase">Stat: </span>
        <span className="font-display text-lg text-primary">{STAT_LABELS[currentStat]}</span>
      </div>

      {/* Cards face-off */}
      <div className="grid grid-cols-2 gap-4 max-w-xs mx-auto">
        <div className="flex flex-col items-center gap-1.5">
          <PlayerCard card={userCard} gemTier={userGem} className="w-full max-w-[140px] aspect-[3/4]" />
          <span className="text-sm font-semibold">{STAT_LABELS[currentStat]}: {"★".repeat(userCard[currentStat])}</span>
          <span className="text-xs text-muted-foreground">{userStatValue}★ → {userDiceCount}d6</span>
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <PlayerCard card={cpuCard} gemTier={cpuGem} className="w-full max-w-[140px] aspect-[3/4]" />
          {phase === "result" ? (
            <span className="text-sm font-semibold">{STAT_LABELS[currentStat]}: {"★".repeat(cpuCard[currentStat])}</span>
          ) : (
            <span className="text-sm text-muted-foreground">???</span>
          )}
          <span className="text-xs text-muted-foreground">{cpuStatValue}★ → {cpuDiceCount}d6</span>
        </div>
      </div>

      {/* Dice mode toggle */}
      {phase === "dice" && (
        <div className="flex items-center justify-center gap-2">
          <Dice5 className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Got your own dice?</span>
          <Switch checked={useOwnDice} onCheckedChange={setUseOwnDice} />
        </div>
      )}

      {/* Auto-roll */}
      {phase === "dice" && !useOwnDice && (
        <div className="space-y-4">
          <div className="flex justify-center gap-8">
            <DiceRoll rolling={rolling} values={autoUserDice} label="Your Roll" highlightDoubles />
            <DiceRoll rolling={rolling} values={autoCpuDice} label="CPU Roll" highlightDoubles />
          </div>
          <div className="text-center">
            <Button onClick={handleAutoRoll} disabled={rolling}>
              {rolling ? "Rolling..." : "Roll Dice"}
            </Button>
          </div>
        </div>
      )}

      {/* Manual dice */}
      {phase === "dice" && useOwnDice && (
        <DiceInput diceCount={maxDiceCount} onSubmit={handleManualSubmit} />
      )}

      {/* Reroll choice */}
      {phase === "reroll" && pendingReroll && (
        <RerollChoice
          statLabel={STAT_LABELS[currentStat]}
          originalDice={pendingReroll.originalUserDice}
          rerollDice={pendingReroll.rerollDice}
          onChoose={handleRerollChoice}
        />
      )}

      {/* Result for this stat */}
      {phase === "result" && lastUserResult && lastCpuResult && (
        <div className="space-y-4">
          <StatResult userResult={lastUserResult} cpuResult={lastCpuResult} activations={lastBadgeActivations} />
          <div className="text-center">
            <Button onClick={handleNext}>
              {isLastStat && isLastPlayer ? "See Final Results" :
               isLastStat ? "Next Player →" : "Next Stat →"}
            </Button>
          </div>
        </div>
      )}

      {/* Current player stat progress */}
      {currentUserStats.length > 0 && (
        <div className="space-y-1">
          <h4 className="text-xs text-muted-foreground uppercase">This Matchup</h4>
          <div className="grid grid-cols-3 gap-1 text-xs">
            {currentUserStats.map((ur, i) => {
              const cr = currentCpuStats[i];
              return (
                <div key={i} className="text-center p-1 rounded bg-muted/20">
                  <span className="font-medium">{STAT_LABELS[ur.stat]}</span>
                  <span className="text-muted-foreground ml-1">{ur.points} - {cr.points}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
