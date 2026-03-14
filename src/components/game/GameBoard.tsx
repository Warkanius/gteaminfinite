import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { DiceInput } from "@/components/game/DiceInput";
import { DiceRoll } from "@/components/game/DiceRoll";
import { StatResult } from "@/components/game/StatResult";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Dice5 } from "lucide-react";
import {
  STATS, STAT_LABELS, getDiceCount, resolveStatRoll, buildCardResult,
  rollDice, type StatRollResult, type CardGameResult, type StatKey,
} from "@/lib/gameEngine";
import {
  resolveBadgeEffects, getTeammateBadges,
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

  // Phase: roll dice or show result for this stat
  const [phase, setPhase] = useState<"dice" | "result">("dice");
  const [lastUserResult, setLastUserResult] = useState<StatRollResult | null>(null);
  const [lastCpuResult, setLastCpuResult] = useState<StatRollResult | null>(null);

  // Auto-roll animation state
  const [rolling, setRolling] = useState(false);
  const [autoUserDice, setAutoUserDice] = useState<(number | null)[]>([null]);
  const [autoCpuDice, setAutoCpuDice] = useState<(number | null)[]>([null]);

  // Badge + trait activations for display
  const [lastBadgeActivations, setLastBadgeActivations] = useState<(BadgeActivation | TraitActivation)[]>([]);

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
  const userStars = userGem?.stars ?? 0;
  const cpuStars = cpuGem?.stars ?? 0;
  const userDiceCount = getDiceCount(userStars);
  const cpuDiceCount = getDiceCount(cpuStars);
  // For display, use the max dice count (both sides roll same visual)
  const maxDiceCount = Math.max(userDiceCount, cpuDiceCount) as 1 | 2;

  const handleDiceSubmit = useCallback((userDice: number[], cpuDice: number[]) => {
    const allActivations: (BadgeActivation | TraitActivation)[] = [];

    // --- User card: apply traits FIRST, then badges ---
    const userTraits = traitMap[userCard.id] ?? [];
    const userTeammateTraits = getTeammateTraits(traitMap, userLineup, userCard.id);
    const userAvgStat = computeCardAvgStat(userCard);
    
    // Trait boosts on user
    const userTraitResult = resolveTraitBoosts(
      currentStat, userCard[currentStat], userTraits, gameContext, "5v5",
      cpuCard.rating, userCard.rating, userAvgStat,
    );
    allActivations.push(...userTraitResult.activations);
    // Teammate trait boosts on user
    const userTeammateTraitResult = resolveTeammateTraitBoosts(
      currentStat, userTraitResult.adjustedStat, userTeammateTraits, "5v5",
    );
    allActivations.push(...userTeammateTraitResult.activations);

    // Apply badges to user roll (with trait-adjusted stat)
    const userBadges = badgeMap[userCard.id] ?? [];
    const cpuDefenderBadges = badgeMap[cpuCard.id] ?? [];
    const userTeammateBadges = getTeammateBadges(badgeMap, userLineup, userCard.id);

    const userBadgeResult = resolveBadgeEffects(
      currentStat, userTeammateTraitResult.adjustedStat, userDice,
      userBadges, cpuDefenderBadges, userTeammateBadges, "5v5",
    );
    allActivations.push(...userBadgeResult.activations);

    // --- CPU card: apply traits FIRST, then badges ---
    const cpuTraits = traitMap[cpuCard.id] ?? [];
    const cpuTeammateTraits = getTeammateTraits(traitMap, cpuLineup, cpuCard.id);
    const cpuAvgStat = computeCardAvgStat(cpuCard);

    const cpuTraitResult = resolveTraitBoosts(
      currentStat, cpuCard[currentStat], cpuTraits, gameContext, "5v5",
      userCard.rating, cpuCard.rating, cpuAvgStat,
    );
    allActivations.push(...cpuTraitResult.activations);
    const cpuTeammateTraitResult = resolveTeammateTraitBoosts(
      currentStat, cpuTraitResult.adjustedStat, cpuTeammateTraits, "5v5",
    );
    allActivations.push(...cpuTeammateTraitResult.activations);

    const cpuBadges = badgeMap[cpuCard.id] ?? [];
    const userDefenderBadges = badgeMap[userCard.id] ?? [];
    const cpuTeammateBadges = getTeammateBadges(badgeMap, cpuLineup, cpuCard.id);

    const cpuBadgeResult = resolveBadgeEffects(
      currentStat, cpuTeammateTraitResult.adjustedStat, cpuDice,
      cpuBadges, userDefenderBadges, cpuTeammateBadges, "5v5",
    );
    allActivations.push(...cpuBadgeResult.activations);

    // Resolve stat rolls with badge-adjusted values
    const uResult = resolveStatRoll(
      currentStat, userBadgeResult.adjustedStat, userStars,
      userBadgeResult.finalDice, difficultyStars,
    );
    // Add badge bonus to points
    if (userBadgeResult.totalBonus > 0) {
      uResult.rollResult += Math.round(userBadgeResult.totalBonus);
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
  }, [currentStat, userCard, cpuCard, userStars, cpuStars, difficultyStars, badgeMap, traitMap, gameContext, userLineup, cpuLineup]);

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
      <div className="grid grid-cols-2 gap-4 max-w-md mx-auto">
        <div className="flex flex-col items-center gap-2">
          <PlayerCard card={userCard} gemTier={userGem} />
          <span className="text-sm font-medium">{STAT_LABELS[currentStat]}: {userCard[currentStat]}</span>
          <span className="text-xs text-muted-foreground">{userStars}★ ({userDiceCount}d)</span>
        </div>
        <div className="flex flex-col items-center gap-2">
          <PlayerCard card={cpuCard} gemTier={cpuGem} />
          {phase === "result" ? (
            <span className="text-sm font-medium">{STAT_LABELS[currentStat]}: {cpuCard[currentStat]}</span>
          ) : (
            <span className="text-sm text-muted-foreground">???</span>
          )}
          <span className="text-xs text-muted-foreground">{cpuStars}★ ({cpuDiceCount}d)</span>
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

      {/* Result for this stat */}
      {phase === "result" && lastUserResult && lastCpuResult && (
        <div className="space-y-4">
          <StatResult userResult={lastUserResult} cpuResult={lastCpuResult} />
          {/* Badge activations */}
          {lastBadgeActivations.length > 0 && (
            <div className="flex flex-wrap gap-1.5 justify-center">
              {lastBadgeActivations.map((ba, i) => (
                <Badge key={i} variant="secondary" className="text-[10px] gap-1">
                  🏅 {ba.abbreviation} ({ba.tier}) — {ba.effect}
                </Badge>
              ))}
            </div>
          )}
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
