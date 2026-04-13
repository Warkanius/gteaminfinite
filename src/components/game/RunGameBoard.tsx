import { useState, useRef } from "react";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ActivationLogEntry } from "@/components/game/ActivationBanner";
import {
  SCORING_STATS, STAT_LABELS, STATS, type StatKey,
  rollDice, getRunDiceCount, getDefenseStat, isInsideStat,
  resolveRunShotContest, pickRebounderSlot, resolveRunReboundRoll,
  type ShotContestResult, type CardGameResult,
} from "@/lib/gameEngine";
import {
  resolveBadgeEffects, getTeammateBadges,
  type CardBadge, type BadgeActivation,
} from "@/lib/badgeEngine";
import {
  resolveTraitBoosts, resolveTeammateTraitBoosts, getTeammateTraits,
  computeCardAvgStat, type CardTrait, type TraitActivation,
} from "@/lib/traitEngine";
import { trackEvoProgress } from "@/lib/evoProgressTracker";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

interface Props {
  run: any;
  playerLineup: any[];
  cpuLineup: any[];
  badgeMap: Record<string, CardBadge[]>;
  traitMap: Record<string, CardTrait[]>;
  onGameComplete: () => void;
}

type Phase = "choose" | "rolling" | "rebound" | "done";
type Possession = "player" | "cpu";

interface LogEntry {
  msg: string;
  type: "score-player" | "score-cpu" | "miss" | "rebound" | "info" | "badge";
  activation?: (BadgeActivation | TraitActivation);
}

interface CardAccum {
  points: number;
  statValues: Record<StatKey, number>;
}

export function RunGameBoard({ run, playerLineup, cpuLineup, badgeMap, traitMap, onGameComplete }: Props) {
  const { user } = useAuth();
  const targetScore = run.target_score;
  const runsContext = { isHome: false, isAway: true, isKeyGame: false };

  const [playerScore, setPlayerScore] = useState(0);
  const [cpuScore, setCpuScore] = useState(0);
  const [possession, setPossession] = useState<Possession>("player");
  const [phase, setPhase] = useState<Phase>("choose");
  const [selectedShooterIdx, setSelectedShooterIdx] = useState(0);
  const [selectedStat, setSelectedStat] = useState<StatKey>("stat_3pt");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [lastContest, setLastContest] = useState<ShotContestResult | null>(null);
  const [cpuShooterIdx, setCpuShooterIdx] = useState(0);
  const [cpuStat, setCpuStat] = useState<StatKey>("stat_3pt");

  // Accumulate per-card stats for evo tracking (user cards only)
  const cardAccumRef = useRef<Record<string, CardAccum>>({});

  const accumulateCardStat = (cardId: string, stat: StatKey, rollValue: number, pointsScored: number) => {
    const accum = cardAccumRef.current;
    if (!accum[cardId]) {
      const empty = {} as Record<StatKey, number>;
      for (const s of STATS) empty[s] = 0;
      accum[cardId] = { points: 0, statValues: empty };
    }
    accum[cardId].statValues[stat] += rollValue;
    accum[cardId].points += pointsScored;
  };

  const checkWinner = (pScore: number, cScore: number) => {
    if (pScore >= targetScore && pScore - cScore >= 2) return "player";
    if (cScore >= targetScore && cScore - pScore >= 2) return "cpu";
    return null;
  };

  const addLog = (entry: LogEntry) => {
    setLogs(prev => [entry, ...prev].slice(0, 15));
  };

  const handleGameEnd = async (winner: "player" | "cpu", newPScore: number, newCScore: number) => {
    setPhase("done");
    toast({
      title: winner === "player" ? "You Won the Match!" : "You Lost the Match!",
      description: `${newPScore} - ${newCScore}`,
      variant: winner === "player" ? "default" : "destructive",
    });

    if (user) {
      // Track evo progress for user cards
      const accum = cardAccumRef.current;
      const userCards: CardGameResult[] = playerLineup.map((card: any) => {
        const a = accum[card.id];
        const statValues = (a?.statValues ?? {}) as Record<StatKey, number>;
        return {
          playerCardId: card.id,
          cardName: card.name,
          side: "user" as const,
          statResults: [],
          totalPoints: a?.points ?? 0,
          statValues,
        };
      });
      await trackEvoProgress(user.id, userCards, winner === "player");

      const { data: userRun } = await supabase
        .from("user_runs")
        .select("id, current_wins, highest_wins")
        .eq("run_id", run.id)
        .eq("user_id", user.id)
        .maybeSingle();

      const oldHighest = userRun?.highest_wins || 0;
      const currentWins = winner === "player" ? (userRun?.current_wins || 0) + 1 : 0;
      const highestWins = Math.max(currentWins, oldHighest);

      if (userRun) {
        await supabase.from("user_runs").update({ current_wins: currentWins, highest_wins: highestWins }).eq("id", userRun.id);
      } else {
        await supabase.from("user_runs").insert({ user_id: user.id, run_id: run.id, current_wins: currentWins, highest_wins: highestWins });
      }

      // --- Per-Run Milestone rewards ---
      if (winner === "player" && run.milestones && Array.isArray(run.milestones)) {
        const reachedMilestone = run.milestones.find((m: any) => m.wins_required === currentWins);
        if (reachedMilestone) {
          const { data: profile } = await supabase.from("profiles").select("coins, gems").eq("user_id", user.id).single();
          if (profile) {
            const newCoins = profile.coins + (reachedMilestone.coin_reward || 0);
            const newGems = profile.gems + (reachedMilestone.gem_reward || 0);
            await supabase.from("profiles").update({ coins: newCoins, gems: newGems }).eq("user_id", user.id);

            const rewardParts: string[] = [];
            if (reachedMilestone.coin_reward) rewardParts.push(`${reachedMilestone.coin_reward} Coins`);
            if (reachedMilestone.gem_reward) rewardParts.push(`${reachedMilestone.gem_reward} Gems`);

            if (reachedMilestone.pack_reward) {
              await grantPackReward(user.id, reachedMilestone.pack_reward, rewardParts, "run_milestone");
            }

            toast({ title: "🏆 Milestone Reached!", description: rewardParts.join(" + ") || "Milestone completed!" });
          }
        }
      }

      // --- Global Rank Reward Ladder ---
      if (winner === "player" && highestWins > oldHighest) {
        // Find all rank rewards between old highest and new highest
        const { data: rankRewards } = await supabase
          .from("run_rank_rewards")
          .select("*")
          .gt("wins_required", oldHighest)
          .lte("wins_required", highestWins)
          .order("sort_order");

        if (rankRewards && rankRewards.length > 0) {
          // Check which ranks already claimed
          const rankNames = rankRewards.map(r => r.rank_name);
          const { data: existingClaims } = await supabase
            .from("user_rank_claims")
            .select("rank_name")
            .eq("user_id", user.id)
            .in("rank_name", rankNames);

          const claimedSet = new Set((existingClaims ?? []).map(c => c.rank_name));
          const unclaimedRewards = rankRewards.filter(r => !claimedSet.has(r.rank_name));

          if (unclaimedRewards.length > 0) {
            let totalCoins = 0;
            let totalGems = 0;
            const packParts: string[] = [];

            for (const reward of unclaimedRewards) {
              totalCoins += reward.coin_reward;
              totalGems += reward.gem_reward;

              if (reward.pack_reward) {
                await grantPackReward(user.id, reward.pack_reward, packParts, "rank_reward");
              }

              // Record claim
              await supabase.from("user_rank_claims").insert({
                user_id: user.id,
                rank_name: reward.rank_name,
              });
            }

            // Grant coins/gems
            if (totalCoins > 0 || totalGems > 0) {
              const { data: profile } = await supabase.from("profiles").select("coins, gems").eq("user_id", user.id).single();
              if (profile) {
                await supabase.from("profiles").update({
                  coins: profile.coins + totalCoins,
                  gems: profile.gems + totalGems,
                }).eq("user_id", user.id);
              }
            }

            const highestRank = unclaimedRewards[unclaimedRewards.length - 1];
            const rewardSummary: string[] = [];
            if (totalCoins > 0) rewardSummary.push(`${totalCoins.toLocaleString()} Coins`);
            if (totalGems > 0) rewardSummary.push(`${totalGems} Gems`);
            rewardSummary.push(...packParts);

            toast({
              title: `🎖️ Rank Up: ${highestRank.rank_name}!`,
              description: rewardSummary.join(" + ") || "New rank achieved!",
            });
          }
        }
      }
    }
    setTimeout(() => onGameComplete(), 2500);
  };

  const resolveRebound = (newPScore: number, newCScore: number) => {
    const playerRebSlot = pickRebounderSlot();
    const cpuRebSlot = pickRebounderSlot();
    const pRebounder = playerLineup[playerRebSlot];
    const cRebounder = cpuLineup[cpuRebSlot];

    const pRating = pRebounder._runRating ?? 60;
    const cRating = cRebounder._runRating ?? 60;

    const pDice = rollDice(getRunDiceCount(pRating)).dice;
    const cDice = rollDice(getRunDiceCount(cRating)).dice;

    const pRebRoll = resolveRunReboundRoll(pRebounder.stat_reb, pRebounder.stat_blk, pRating, pDice);
    const cRebRoll = resolveRunReboundRoll(cRebounder.stat_reb, cRebounder.stat_blk, cRating, cDice);

    const rebWinner: Possession = pRebRoll >= cRebRoll ? "player" : "cpu";
    addLog({
      msg: `🏀 Rebound: ${pRebounder.name} (${pRebRoll}) vs ${cRebounder.name} (${cRebRoll}) → ${rebWinner === "player" ? "Your ball" : "CPU ball"}`,
      type: "rebound",
    });

    // Accumulate rebound stat for user rebounder
    accumulateCardStat(pRebounder.id, "stat_reb", pRebRoll, 0);

    setPossession(rebWinner);

    // If CPU gets possession after rebound, set up their shot
    if (rebWinner === "cpu") {
      const idx = Math.floor(Math.random() * 3);
      const stat = SCORING_STATS[Math.floor(Math.random() * SCORING_STATS.length)];
      setCpuShooterIdx(idx);
      setCpuStat(stat);
    }

    setPhase("choose");

    // Check winner after rebound
    const winner = checkWinner(newPScore, newCScore);
    if (winner) handleGameEnd(winner, newPScore, newCScore);
  };

  const logBadgeActivations = (activations: (BadgeActivation | TraitActivation)[]) => {
    for (const ba of activations) {
      addLog({ msg: `${ba.abbreviation} (${ba.tier}) — ${ba.effect}`, type: "badge", activation: ba });
    }
  };

  /** Player shoots on their possession */
  const handlePlayerShoot = () => {
    setPhase("rolling");
    const shooter = playerLineup[selectedShooterIdx];
    const offRating = shooter._runRating ?? 60;

    const defStat = getDefenseStat(selectedStat);
    const defenderIdx = isInsideStat(selectedStat) ? 2 : selectedShooterIdx;
    const defender = cpuLineup[defenderIdx];
    const defRating = defender._runRating ?? 60;

    // Apply trait boosts to offense FIRST
    const shooterTraits = traitMap[shooter.id] ?? [];
    const shooterTeammateTraits = getTeammateTraits(traitMap, playerLineup, shooter.id);
    const shooterAvg = computeCardAvgStat(shooter);
    const offTraitResult = resolveTraitBoosts(
      selectedStat, shooter[selectedStat], shooterTraits, runsContext, "runs",
      defender.rating, shooter.rating, shooterAvg,
    );
    const offTeammateTraitResult = resolveTeammateTraitBoosts(
      selectedStat, offTraitResult.adjustedStat, shooterTeammateTraits, "runs",
    );

    // Apply badge effects to offense (with trait-adjusted stat)
    const shooterBadges = badgeMap[shooter.id] ?? [];
    const defenderBadges = badgeMap[defender.id] ?? [];
    const shooterTeammateBadges = getTeammateBadges(badgeMap, playerLineup, shooter.id);

    const offDiceRaw = rollDice(getRunDiceCount(offRating)).dice;
    const offBadge = resolveBadgeEffects(
      selectedStat, offTeammateTraitResult.adjustedStat, offDiceRaw,
      shooterBadges, defenderBadges, shooterTeammateBadges, "runs",
    );

    // Apply trait boosts to defense
    const defTraits = traitMap[defender.id] ?? [];
    const defTeammateTraitsT = getTeammateTraits(traitMap, cpuLineup, defender.id);
    const defAvg = computeCardAvgStat(defender);
    const defTraitResult = resolveTraitBoosts(
      defStat, defender[defStat], defTraits, runsContext, "runs",
      shooter.rating, defender.rating, defAvg,
    );
    const defTeammateTraitResult = resolveTeammateTraitBoosts(
      defStat, defTraitResult.adjustedStat, defTeammateTraitsT, "runs",
    );

    // Apply badge effects to defense (with trait-adjusted stat)
    const defBadgesOwn = badgeMap[defender.id] ?? [];
    const defTeammateBadges = getTeammateBadges(badgeMap, cpuLineup, defender.id);
    const defDiceRaw = rollDice(getRunDiceCount(defRating)).dice;
    const defBadge = resolveBadgeEffects(
      defStat, defTeammateTraitResult.adjustedStat, defDiceRaw,
      defBadgesOwn, shooterBadges, defTeammateBadges, "runs",
    );

    logBadgeActivations([
      ...offTraitResult.activations, ...offTeammateTraitResult.activations,
      ...offBadge.activations,
      ...defTraitResult.activations, ...defTeammateTraitResult.activations,
      ...defBadge.activations,
    ]);

    const result = resolveRunShotContest(
      selectedStat, offBadge.adjustedStat, offRating, offBadge.finalDice,
      defStat, defBadge.adjustedStat, defRating, defBadge.finalDice,
      offBadge.totalBonus, defBadge.totalBonus,
    );
    setLastContest(result);

    let newPScore = playerScore;
    let newCScore = cpuScore;

    // Accumulate offensive stat for evo tracking
    accumulateCardStat(shooter.id, selectedStat, result.offenseRoll, 0);

    if (result.made) {
      const pts = result.points;
      newPScore += pts;
      setPlayerScore(newPScore);
      addLog({ msg: `🏀 ${shooter.name} hits ${STAT_LABELS[selectedStat]}! +${pts}pts (${result.offenseRoll} vs ${result.defenseRoll})`, type: "score-player" });
      accumulateCardStat(shooter.id, selectedStat, 0, pts);
      
      const idx = Math.floor(Math.random() * 3);
      const stat = SCORING_STATS[Math.floor(Math.random() * SCORING_STATS.length)];
      setCpuShooterIdx(idx);
      setCpuStat(stat);
      setPossession("cpu");
      setPhase("choose");

      const winner = checkWinner(newPScore, newCScore);
      if (winner) handleGameEnd(winner, newPScore, newCScore);
    } else {
      addLog({ msg: `❌ ${shooter.name} misses ${STAT_LABELS[selectedStat]}! (${result.offenseRoll} vs ${result.defenseRoll}) → Rebound...`, type: "miss" });
      setTimeout(() => resolveRebound(newPScore, newCScore), 800);
    }
  };

  /** Player contests CPU's shot */
  const handleContestShot = () => {
    setPhase("rolling");
    const shooter = cpuLineup[cpuShooterIdx];
    const offRating = shooter._runRating ?? 60;

    const defStat = getDefenseStat(cpuStat);
    const defenderIdx = isInsideStat(cpuStat) ? 2 : cpuShooterIdx;
    const defender = playerLineup[defenderIdx];
    const defRating = defender._runRating ?? 60;

    // Apply trait boosts to CPU offense
    const cpuShooterTraits = traitMap[shooter.id] ?? [];
    const cpuShooterTeammateTraits = getTeammateTraits(traitMap, cpuLineup, shooter.id);
    const cpuShooterAvg = computeCardAvgStat(shooter);
    const cpuOffTraitResult = resolveTraitBoosts(
      cpuStat, shooter[cpuStat], cpuShooterTraits, runsContext, "runs",
      defender.rating, shooter.rating, cpuShooterAvg,
    );
    const cpuOffTeammateTraitResult = resolveTeammateTraitBoosts(
      cpuStat, cpuOffTraitResult.adjustedStat, cpuShooterTeammateTraits, "runs",
    );

    // Badge effects for CPU offense (with trait-adjusted stat)
    const shooterBadges = badgeMap[shooter.id] ?? [];
    const defenderBadges = badgeMap[defender.id] ?? [];
    const shooterTeammateBadges = getTeammateBadges(badgeMap, cpuLineup, shooter.id);

    const offDiceRaw = rollDice(getRunDiceCount(offRating)).dice;
    const offBadge = resolveBadgeEffects(
      cpuStat, cpuOffTeammateTraitResult.adjustedStat, offDiceRaw,
      shooterBadges, defenderBadges, shooterTeammateBadges, "runs",
    );

    // Apply trait boosts to player defense
    const defTraitsC = traitMap[defender.id] ?? [];
    const defTeammateTraitsC = getTeammateTraits(traitMap, playerLineup, defender.id);
    const defAvgC = computeCardAvgStat(defender);
    const defTraitResultC = resolveTraitBoosts(
      defStat, defender[defStat], defTraitsC, runsContext, "runs",
      shooter.rating, defender.rating, defAvgC,
    );
    const defTeammateTraitResultC = resolveTeammateTraitBoosts(
      defStat, defTraitResultC.adjustedStat, defTeammateTraitsC, "runs",
    );

    // Badge effects for player defense (with trait-adjusted stat)
    const defBadgesOwn = badgeMap[defender.id] ?? [];
    const defTeammateBadges = getTeammateBadges(badgeMap, playerLineup, defender.id);
    const defDiceRaw = rollDice(getRunDiceCount(defRating)).dice;
    const defBadge = resolveBadgeEffects(
      defStat, defTeammateTraitResultC.adjustedStat, defDiceRaw,
      defBadgesOwn, shooterBadges, defTeammateBadges, "runs",
    );

    logBadgeActivations([
      ...cpuOffTraitResult.activations, ...cpuOffTeammateTraitResult.activations,
      ...offBadge.activations,
      ...defTraitResultC.activations, ...defTeammateTraitResultC.activations,
      ...defBadge.activations,
    ]);

    const result = resolveRunShotContest(
      cpuStat, offBadge.adjustedStat, offRating, offBadge.finalDice,
      defStat, defBadge.adjustedStat, defRating, defBadge.finalDice,
      offBadge.totalBonus, defBadge.totalBonus,
    );
    setLastContest(result);

    let newPScore = playerScore;
    let newCScore = cpuScore;

    // Accumulate defensive stat for evo tracking (user defender)
    accumulateCardStat(defender.id, defStat, result.defenseRoll, 0);

    if (result.made) {
      const pts = result.points;
      newCScore += pts;
      setCpuScore(newCScore);
      addLog({ msg: `🏀 CPU ${shooter.name} hits ${STAT_LABELS[cpuStat]}! +${pts}pts (${result.offenseRoll} vs ${result.defenseRoll})`, type: "score-cpu" });
      
      setPossession("player");
      setPhase("choose");

      const winner = checkWinner(newPScore, newCScore);
      if (winner) handleGameEnd(winner, newPScore, newCScore);
    } else {
      addLog({ msg: `🛡️ ${defender.name} stops CPU ${shooter.name} on ${STAT_LABELS[cpuStat]}! (${result.defenseRoll} vs ${result.offenseRoll}) → Rebound...`, type: "miss" });
      setTimeout(() => resolveRebound(newPScore, newCScore), 800);
    }
  };

  const pCard = playerLineup[selectedShooterIdx];
  const cCard = cpuLineup[cpuShooterIdx];

  return (
    <div className="space-y-6">
      {/* Scoreboard */}
      <div className="bg-card border border-border/50 rounded-xl p-4 flex items-center justify-between shadow-lg">
        <div className="text-center space-y-1">
          <p className="text-xs text-muted-foreground uppercase font-semibold tracking-wider">You</p>
          <p className="text-5xl font-display font-bold text-primary">{playerScore}</p>
        </div>
        <div className="text-center space-y-1.5">
          <Badge variant={possession === "player" ? "default" : "destructive"} className="text-xs uppercase tracking-wider">
            {possession === "player" ? "🏀 Your Possession" : "🛡️ CPU Possession"}
          </Badge>
          <p className="text-xs font-bold uppercase text-muted-foreground">Target: {targetScore} • Win by 2</p>
        </div>
        <div className="text-center space-y-1">
          <p className="text-xs text-muted-foreground uppercase font-semibold tracking-wider">CPU</p>
          <p className="text-5xl font-display font-bold text-destructive">{cpuScore}</p>
        </div>
      </div>

      {/* Game Area */}
      {possession === "player" && phase === "choose" && (
        <div className="space-y-4">
          <h3 className="font-display text-lg">🏀 Your Possession — Pick Shooter & Shot</h3>
          
          {/* Shooter Selection */}
          <div className="flex gap-3 justify-center">
            {playerLineup.map((card: any, idx: number) => (
              <div
                key={card.id}
                onClick={() => setSelectedShooterIdx(idx)}
                className={`cursor-pointer transition-all w-28 sm:w-32 ${
                  selectedShooterIdx === idx
                    ? "ring-2 ring-primary rounded-lg scale-105"
                    : "opacity-60 hover:opacity-90"
                }`}
              >
                <PlayerCard card={card} />
                <p className="text-center text-xs font-semibold mt-1">Slot {idx + 1}</p>
              </div>
            ))}
          </div>

          {/* Stat Selection */}
          <div className="flex flex-wrap gap-2 justify-center">
            {SCORING_STATS.map(stat => (
              <Button
                key={stat}
                variant={selectedStat === stat ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedStat(stat)}
                className="font-mono text-xs"
              >
                {STAT_LABELS[stat]} ({pCard[stat]})
              </Button>
            ))}
          </div>

          <div className="text-center text-xs text-muted-foreground">
            Defender: {isInsideStat(selectedStat)
              ? `${cpuLineup[2].name} (BLK: ${cpuLineup[2].stat_blk}) — Rim Protector`
              : `${cpuLineup[selectedShooterIdx].name} (STL: ${cpuLineup[selectedShooterIdx].stat_stl}) — Direct Matchup`}
          </div>

          <Button
            className="w-full font-display tracking-wider text-lg h-14"
            onClick={handlePlayerShoot}
            disabled={phase !== "choose"}
          >
            SHOOT
          </Button>
        </div>
      )}

      {possession === "cpu" && phase === "choose" && (
        <div className="space-y-4">
          <h3 className="font-display text-lg text-destructive">🛡️ CPU Possession — Contest the Shot</h3>
          
          <div className="flex gap-6 justify-center items-start">
            <div className="text-center w-28 sm:w-32">
              <p className="text-xs font-semibold text-destructive mb-1">CPU Shooter</p>
              <PlayerCard card={cCard} />
              <p className="text-xs mt-1 font-mono">{STAT_LABELS[cpuStat]}: {cCard[cpuStat]}</p>
            </div>
            <div className="text-center text-lg font-display text-muted-foreground self-center">VS</div>
            <div className="text-center w-28 sm:w-32">
              <p className="text-xs font-semibold text-primary mb-1">Your Defender</p>
              <PlayerCard card={playerLineup[isInsideStat(cpuStat) ? 2 : cpuShooterIdx]} />
              <p className="text-xs mt-1 font-mono">
                {STAT_LABELS[getDefenseStat(cpuStat)]}: {playerLineup[isInsideStat(cpuStat) ? 2 : cpuShooterIdx][getDefenseStat(cpuStat)]}
              </p>
            </div>
          </div>

          <Button
            className="w-full font-display tracking-wider text-lg h-14 bg-destructive hover:bg-destructive/90"
            onClick={handleContestShot}
            disabled={phase !== "choose"}
          >
            CONTEST
          </Button>
        </div>
      )}

      {phase === "rolling" && (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <span className="ml-3 font-display text-lg">Resolving...</span>
        </div>
      )}

      {phase === "done" && (
        <div className="text-center py-12">
          <p className="font-display text-2xl">Game Over!</p>
          <p className="text-muted-foreground">{playerScore} - {cpuScore}</p>
        </div>
      )}

      {/* Action Log */}
      <div className="bg-muted/30 border border-border/50 rounded-xl p-4">
        <h4 className="font-display text-sm mb-2">Play-by-Play</h4>
        <div className="space-y-1.5 max-h-48 overflow-y-auto">
          {logs.map((log, i) => (
            log.type === "badge" && log.activation ? (
              <ActivationLogEntry key={i} activation={log.activation} />
            ) : (
              <div
                key={i}
                className={`text-xs p-2 rounded-md border-l-4 ${
                  log.type === "score-player" ? "bg-primary/10 border-primary" :
                  log.type === "score-cpu" ? "bg-destructive/10 border-destructive" :
                  log.type === "rebound" ? "bg-accent/20 border-accent" :
                  "bg-muted border-muted-foreground"
                }`}
              >
                {log.msg}
              </div>
            )
          ))}
          {logs.length === 0 && <p className="text-xs text-muted-foreground">Tip the ball to start!</p>}
        </div>
      </div>
    </div>
  );
}