import { useState, useRef, useEffect } from "react";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ActivationLogEntry } from "@/components/game/ActivationBanner";
import { RunContestResult } from "@/components/game/RunContestResult";
import { cn } from "@/lib/utils";
import {
  SCORING_STATS, STAT_LABELS, STATS, type StatKey,
  rollDice, getDefenseStat, isInsideStat,
  resolveRunShotContest, pickRebounderSlot, resolveRunReboundRoll,
  runStatToStars, getStatDiceCount,
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
import { postLeagueEvent } from "@/lib/leagueEvents";
import type { ActiveDynamicDuo } from "@/lib/dynamicDuos";

interface Props {
  run: any;
  playerLineup: any[];
  cpuLineup: any[];
  badgeMap: Record<string, CardBadge[]>;
  traitMap: Record<string, CardTrait[]>;
  activeDuos?: ActiveDynamicDuo[];
  onGameComplete: () => void;
  runId?: string;
}

type Phase = "choose" | "rolling" | "result" | "rebound-rolling" | "rebound-result" | "done";
type Possession = "player" | "cpu";
type LastPlay = null | { kind: "make" | "miss" | "rebound" | "steal" | "block"; side: "player" | "cpu" };

interface PendingContest {
  kind: "shot" | "rebound";
  shooter: any;
  defender: any;
  offenseStat: StatKey;
  defenseStat: StatKey;
  contest: ShotContestResult;
  activations: (BadgeActivation | TraitActivation)[];
  shooterSide: "player" | "cpu";
  // Continuation: applies score, updates possession, advances phase, returns winner check
  applyOutcome: () => void;
}

interface LogEntry {
  msg: string;
  type: "score-player" | "score-cpu" | "miss" | "rebound" | "info" | "badge";
  activation?: (BadgeActivation | TraitActivation);
}

interface CardAccum {
  points: number;
  statValues: Record<StatKey, number>;
}

export function RunGameBoard({ run, playerLineup, cpuLineup, badgeMap, traitMap, activeDuos = [], onGameComplete }: Props) {
  const { user } = useAuth();
  const targetScore = run.target_score;
  const runsContext = { isHome: false, isAway: true, isKeyGame: false, isHomeHeroEligible: false, isRankUpGame: false };

  // Fire one appearance event per qualifying card on first mount (server gates by tier + cooldown).
  useEffect(() => {
    if (!run?.id) return;
    (async () => {
      try {
        const { data: prof } = user
          ? await supabase.from("profiles").select("display_name, team_name").eq("user_id", user.id).maybeSingle()
          : { data: null };
        const display = prof?.team_name ?? prof?.display_name ?? "A challenger";
        for (const card of playerLineup) {
          await postLeagueEvent({
            event_type: "appearance",
            run_id: run.id,
            player_card_id: (card as any).id,
            player_name: (card as any).name,
            gem_tier_name: (card as any).gem_tiers?.name ?? (card as any).gem_name ?? null,
            user_display: display,
          });
        }
      } catch (e) {
        console.warn("[RunGameBoard] appearance swallow", (e as Error).message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  const [playerScore, setPlayerScore] = useState(0);
  const [cpuScore, setCpuScore] = useState(0);
  const [possession, setPossession] = useState<Possession>("player");
  const [phase, setPhase] = useState<Phase>("choose");
  const [selectedShooterIdx, setSelectedShooterIdx] = useState(0);
  const [selectedStat, setSelectedStat] = useState<StatKey>("stat_3pt");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [lastContest, setLastContest] = useState<ShotContestResult | null>(null);
  const [pendingContest, setPendingContest] = useState<PendingContest | null>(null);
  const [possessions, setPossessions] = useState(0);
  const [lastPlay, setLastPlay] = useState<LastPlay>(null);
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

      // Streak tracking, milestone rewards and the rank ladder are all
      // resolved server-side from the run config — the client only reports
      // the outcome and renders the result.
      const { data: grant, error: grantErr } = await supabase.functions.invoke("grant-rewards", {
        body: { action: "run_result", run_id: run.id, won: winner === "player" },
      });

      if (grantErr || grant?.error) {
        console.error("[RunGameBoard] grant-rewards failed", grantErr, grant?.error);
      }

      // League streak post when a new personal best is set
      if (grant?.new_best) {
        try {
          const { data: prof } = await supabase.from("profiles").select("display_name, team_name").eq("user_id", user.id).maybeSingle();
          await postLeagueEvent({
            event_type: "streak",
            run_id: run.id,
            user_display: prof?.team_name ?? prof?.display_name ?? "A challenger",
            streak: grant.highest_wins,
          });
        } catch {}
      }

      if (grant?.milestone_parts?.length) {
        toast({ title: "🏆 Milestone Reached!", description: grant.milestone_parts.join(" + ") });
      }

      if (grant?.rank_name) {
        toast({
          title: `🎖️ Rank Up: ${grant.rank_name}!`,
          description: grant.rank_parts?.join(" + ") || "New rank achieved!",
        });
      }

    }
    setTimeout(() => onGameComplete(), 2500);
  };

  /** Roll dice for a stat using its individual star band. Returns an empty array if 0 stars. */
  const rollForStat = (statValue: number): number[] => {
    const stars = runStatToStars(statValue);
    const count = getStatDiceCount(stars);
    return count > 0 ? rollDice(count).dice : [];
  };

  /** Kick off a rebound contest with full visualization. */
  const resolveRebound = (newPScore: number, newCScore: number) => {
    const playerRebSlot = pickRebounderSlot();
    const cpuRebSlot = pickRebounderSlot();
    const pRebounder = playerLineup[playerRebSlot];
    const cRebounder = cpuLineup[cpuRebSlot];

    const pCombined = (pRebounder.stat_reb + pRebounder.stat_blk) / 2;
    const cCombined = (cRebounder.stat_reb + cRebounder.stat_blk) / 2;
    const pDice = rollForStat(pCombined);
    const cDice = rollForStat(cCombined);

    const pRebRoll = resolveRunReboundRoll(pRebounder.stat_reb, pRebounder.stat_blk, pDice);
    const cRebRoll = resolveRunReboundRoll(cRebounder.stat_reb, cRebounder.stat_blk, cDice);

    const playerWins = pRebRoll >= cRebRoll;
    const rebWinner: Possession = playerWins ? "player" : "cpu";

    const contest: ShotContestResult = {
      offenseRoll: pRebRoll,
      defenseRoll: cRebRoll,
      made: playerWins,
      points: 0,
      offenseDice: pDice,
      defenseDice: cDice,
      offenseModifier: 1,
      defenseModifier: 1,
      offenseStat: "stat_reb",
      defenseStat: "stat_reb",
      outcome: "rebound",
      gap: Math.abs(pRebRoll - cRebRoll),
    };

    accumulateCardStat(pRebounder.id, "stat_reb", pRebRoll, 0);

    setPendingContest({
      kind: "rebound",
      shooter: pRebounder,
      defender: cRebounder,
      offenseStat: "stat_reb",
      defenseStat: "stat_reb",
      contest,
      activations: [],
      shooterSide: "player",
      applyOutcome: () => {
        addLog({
          msg: `🏀 Rebound: ${pRebounder.name} (${pRebRoll}) vs ${cRebounder.name} (${cRebRoll}) → ${rebWinner === "player" ? "Your ball" : "CPU ball"}`,
          type: "rebound",
        });
        setLastPlay({ kind: "rebound", side: rebWinner });
        setPossession(rebWinner);
        if (rebWinner === "cpu") {
          const idx = Math.floor(Math.random() * 3);
          const stat = SCORING_STATS[Math.floor(Math.random() * SCORING_STATS.length)];
          setCpuShooterIdx(idx);
          setCpuStat(stat);
        }
        setPendingContest(null);
        setPhase("choose");
        const winner = checkWinner(newPScore, newCScore);
        if (winner) handleGameEnd(winner, newPScore, newCScore);
      },
    });
    setPhase("rebound-rolling");
    setTimeout(() => setPhase("rebound-result"), 900);
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

    const defStat = getDefenseStat(selectedStat);
    const defenderIdx = isInsideStat(selectedStat) ? 2 : selectedShooterIdx;
    const defender = cpuLineup[defenderIdx];

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

    const shooterBadges = badgeMap[shooter.id] ?? [];
    const defenderBadges = badgeMap[defender.id] ?? [];
    const shooterTeammateBadges = getTeammateBadges(badgeMap, playerLineup, shooter.id);

    const offDiceRaw = rollForStat(offTeammateTraitResult.adjustedStat);
    const offBadge = resolveBadgeEffects(
      selectedStat, offTeammateTraitResult.adjustedStat, offDiceRaw,
      shooterBadges, defenderBadges, shooterTeammateBadges, "runs",
    );

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

    const defBadgesOwn = badgeMap[defender.id] ?? [];
    const defTeammateBadges = getTeammateBadges(badgeMap, playerLineup, defender.id);
    const defDiceRaw = rollForStat(defTeammateTraitResult.adjustedStat);
    const defBadge = resolveBadgeEffects(
      defStat, defTeammateTraitResult.adjustedStat, defDiceRaw,
      defBadgesOwn, shooterBadges, defTeammateBadges, "runs",
    );

    const allActivations = [
      ...offTraitResult.activations, ...offTeammateTraitResult.activations,
      ...offBadge.activations,
      ...defTraitResult.activations, ...defTeammateTraitResult.activations,
      ...defBadge.activations,
    ];

    const result = resolveRunShotContest(
      selectedStat, offBadge.adjustedStat, offBadge.finalDice,
      defStat, defBadge.adjustedStat, defBadge.finalDice,
      offBadge.totalBonus, defBadge.totalBonus,
    );
    setLastContest(result);

    const baseP = playerScore;
    const baseC = cpuScore;

    accumulateCardStat(shooter.id, selectedStat, result.offenseRoll, 0);

    setPossessions(p => p + 1);
    const capturedSelectedStat = selectedStat;

    setPendingContest({
      kind: "shot",
      shooter,
      defender,
      offenseStat: capturedSelectedStat,
      defenseStat: defStat,
      contest: result,
      activations: allActivations,
      shooterSide: "player",
      applyOutcome: () => {
        logBadgeActivations(allActivations);
        let newPScore = baseP;
        const newCScore = baseC;
        if (result.outcome === "make") {
          const pts = result.points;
          newPScore += pts;
          setPlayerScore(newPScore);
          addLog({ msg: `🏀 ${shooter.name} hits ${STAT_LABELS[capturedSelectedStat]}! +${pts}pts (${result.offenseRoll} vs ${result.defenseRoll})`, type: "score-player" });
          accumulateCardStat(shooter.id, capturedSelectedStat, 0, pts);
          setLastPlay({ kind: "make", side: "player" });
          const idx = Math.floor(Math.random() * 3);
          const stat = SCORING_STATS[Math.floor(Math.random() * SCORING_STATS.length)];
          setCpuShooterIdx(idx);
          setCpuStat(stat);
          setPossession("cpu");
          setPendingContest(null);
          setPhase("choose");
          const winner = checkWinner(newPScore, newCScore);
          if (winner) handleGameEnd(winner, newPScore, newCScore);
        } else if (result.outcome === "steal") {
          addLog({ msg: `🛡️ STOLEN by ${defender.name}! (${result.defenseRoll} vs ${result.offenseRoll}, gap ${result.gap}) → CPU ball`, type: "miss" });
          setLastPlay({ kind: "steal", side: "cpu" });
          const idx = Math.floor(Math.random() * 3);
          const stat = SCORING_STATS[Math.floor(Math.random() * SCORING_STATS.length)];
          setCpuShooterIdx(idx);
          setCpuStat(stat);
          setPossession("cpu");
          setPendingContest(null);
          setPhase("choose");
        } else if (result.outcome === "block") {
          addLog({ msg: `🚫 BLOCKED by ${defender.name}! (${result.defenseRoll} vs ${result.offenseRoll}, gap ${result.gap}) → Rebound...`, type: "miss" });
          setLastPlay({ kind: "block", side: "cpu" });
          setPendingContest(null);
          resolveRebound(newPScore, newCScore);
        } else {
          addLog({ msg: `❌ ${shooter.name} misses ${STAT_LABELS[capturedSelectedStat]}! (${result.offenseRoll} vs ${result.offenseRoll}) → Rebound...`, type: "miss" });
          setLastPlay({ kind: "miss", side: "player" });
          setPendingContest(null);
          resolveRebound(newPScore, newCScore);
        }
      },
    });
    setTimeout(() => setPhase("result"), 900);
  };

  /** Player contests CPU's shot */
  const handleContestShot = () => {
    setPhase("rolling");
    const shooter = cpuLineup[cpuShooterIdx];

    const defStat = getDefenseStat(cpuStat);
    const defenderIdx = isInsideStat(cpuStat) ? 2 : cpuShooterIdx;
    const defender = playerLineup[defenderIdx];

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

    const shooterBadges = badgeMap[shooter.id] ?? [];
    const defenderBadges = badgeMap[defender.id] ?? [];
    const shooterTeammateBadges = getTeammateBadges(badgeMap, cpuLineup, shooter.id);

    const offDiceRaw = rollForStat(cpuOffTeammateTraitResult.adjustedStat);
    const offBadge = resolveBadgeEffects(
      cpuStat, cpuOffTeammateTraitResult.adjustedStat, offDiceRaw,
      shooterBadges, defenderBadges, shooterTeammateBadges, "runs",
    );

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

    const defBadgesOwn = badgeMap[defender.id] ?? [];
    const defTeammateBadges = getTeammateBadges(badgeMap, playerLineup, defender.id);
    const defDiceRaw = rollForStat(defTeammateTraitResultC.adjustedStat);
    const defBadge = resolveBadgeEffects(
      defStat, defTeammateTraitResultC.adjustedStat, defDiceRaw,
      defBadgesOwn, shooterBadges, defTeammateBadges, "runs",
    );

    const allActivations = [
      ...cpuOffTraitResult.activations, ...cpuOffTeammateTraitResult.activations,
      ...offBadge.activations,
      ...defTraitResultC.activations, ...defTeammateTraitResultC.activations,
      ...defBadge.activations,
    ];

    const result = resolveRunShotContest(
      cpuStat, offBadge.adjustedStat, offBadge.finalDice,
      defStat, defBadge.adjustedStat, defBadge.finalDice,
      offBadge.totalBonus, defBadge.totalBonus,
    );
    setLastContest(result);

    const baseP = playerScore;
    const baseC = cpuScore;

    accumulateCardStat(defender.id, defStat, result.defenseRoll, 0);
    setPossessions(p => p + 1);
    const capturedCpuStat = cpuStat;

    setPendingContest({
      kind: "shot",
      shooter,
      defender,
      offenseStat: capturedCpuStat,
      defenseStat: defStat,
      contest: result,
      activations: allActivations,
      shooterSide: "cpu",
      applyOutcome: () => {
        logBadgeActivations(allActivations);
        const newPScore = baseP;
        let newCScore = baseC;
        if (result.outcome === "make") {
          const pts = result.points;
          newCScore += pts;
          setCpuScore(newCScore);
          addLog({ msg: `🏀 CPU ${shooter.name} hits ${STAT_LABELS[capturedCpuStat]}! +${pts}pts (${result.offenseRoll} vs ${result.defenseRoll})`, type: "score-cpu" });
          setLastPlay({ kind: "make", side: "cpu" });
          setPossession("player");
          setPendingContest(null);
          setPhase("choose");
          const winner = checkWinner(newPScore, newCScore);
          if (winner) handleGameEnd(winner, newPScore, newCScore);
        } else if (result.outcome === "steal") {
          // Player defender stole CPU's pass — player keeps possession
          addLog({ msg: `🛡️ ${defender.name} STEALS from CPU! (${result.defenseRoll} vs ${result.offenseRoll}, gap ${result.gap}) → Your ball`, type: "rebound" });
          setLastPlay({ kind: "steal", side: "player" });
          setPossession("player");
          setPendingContest(null);
          setPhase("choose");
        } else if (result.outcome === "block") {
          addLog({ msg: `🚫 ${defender.name} BLOCKS CPU ${shooter.name}! (${result.defenseRoll} vs ${result.offenseRoll}, gap ${result.gap}) → Rebound...`, type: "miss" });
          setLastPlay({ kind: "block", side: "player" });
          setPendingContest(null);
          resolveRebound(newPScore, newCScore);
        } else {
          addLog({ msg: `🛡️ ${defender.name} stops CPU ${shooter.name} on ${STAT_LABELS[capturedCpuStat]}! (${result.defenseRoll} vs ${result.offenseRoll}) → Rebound...`, type: "miss" });
          setLastPlay({ kind: "miss", side: "cpu" });
          setPendingContest(null);
          resolveRebound(newPScore, newCScore);
        }
      },
    });
    setTimeout(() => setPhase("result"), 900);
  };

  const pCard = playerLineup[selectedShooterIdx];
  const cCard = cpuLineup[cpuShooterIdx];

  return (
    <div className="space-y-6">
      {/* Active dynamic duos banner */}
      {activeDuos.length > 0 && (
        <div className="rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-xs space-y-1">
          {activeDuos.map((d) => (
            <div key={d.id} className="flex items-center gap-2">
              <span className="font-semibold text-primary">{d.name}</span>
              <span className="text-muted-foreground truncate">— {d.cardNames.join(" + ")}</span>
            </div>
          ))}
        </div>
      )}

      {/* Scoreboard */}

      <div className="bg-card border border-border/50 rounded-xl p-4 flex items-center justify-between shadow-lg">
        <div className="text-center space-y-1">
          <p className="text-xs text-muted-foreground uppercase font-semibold tracking-wider">You</p>
          <p className="text-5xl font-display font-bold text-primary">{playerScore}</p>
        </div>
        <div className="text-center space-y-1.5">
          <p className="text-xs font-bold uppercase text-muted-foreground">Target: {targetScore} • Win by 2</p>
          <div className="flex items-center justify-center gap-1.5 flex-wrap">
            <Badge variant="outline" className="text-[10px] uppercase tracking-wider px-1.5 py-0">
              Poss: {possessions}
            </Badge>
            {lastPlay && (
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] uppercase tracking-wider px-1.5 py-0",
                  lastPlay.kind === "make" && lastPlay.side === "player" && "border-primary/60 text-primary",
                  lastPlay.kind === "make" && lastPlay.side === "cpu" && "border-destructive/60 text-destructive",
                  lastPlay.kind === "miss" && "border-muted-foreground/40 text-muted-foreground",
                  lastPlay.kind === "rebound" && "border-accent text-accent-foreground",
                  lastPlay.kind === "steal" && "border-primary/60 text-primary",
                  lastPlay.kind === "block" && "border-destructive/60 text-destructive",
                )}
              >
                {lastPlay.kind === "make" ? "✅ Make"
                  : lastPlay.kind === "miss" ? "❌ Miss"
                  : lastPlay.kind === "steal" ? `🛡️ Steal ${lastPlay.side === "player" ? "(You)" : "(CPU)"}`
                  : lastPlay.kind === "block" ? `🚫 Block ${lastPlay.side === "player" ? "(You)" : "(CPU)"}`
                  : `🏀 Reb ${lastPlay.side === "player" ? "(You)" : "(CPU)"}`}
              </Badge>
            )}
          </div>
        </div>
        <div className="text-center space-y-1">
          <p className="text-xs text-muted-foreground uppercase font-semibold tracking-wider">CPU</p>
          <p className="text-5xl font-display font-bold text-destructive">{cpuScore}</p>
        </div>
      </div>

      {/* Possession Banner */}
      {phase === "choose" && (
        <div
          className={cn(
            "rounded-xl border-2 p-3 text-center font-display tracking-wider animate-pulse",
            possession === "player"
              ? "border-primary/50 bg-primary/10 text-primary"
              : "border-destructive/50 bg-destructive/10 text-destructive",
          )}
        >
          {possession === "player" ? "🏀 YOUR BALL — Pick Your Shot" : "🛡️ CPU HAS THE BALL — Contest Their Shot"}
        </div>
      )}

      {/* Game Area */}
      {possession === "player" && phase === "choose" && (
        <div className="space-y-4">
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
                <PlayerCard card={card._displayCard ?? card} gemTier={(card._displayCard ?? card).gem_tiers} />
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
          <div className="flex gap-6 justify-center items-start">
            <div className="text-center w-28 sm:w-32">
              <p className="text-xs font-semibold text-destructive mb-1">CPU Shooter</p>
              <PlayerCard card={cCard._displayCard ?? cCard} gemTier={(cCard._displayCard ?? cCard).gem_tiers} />
              <p className="text-xs mt-1 font-mono">{STAT_LABELS[cpuStat]}: {cCard[cpuStat]}</p>
            </div>
            <div className="text-center text-lg font-display text-muted-foreground self-center">VS</div>
            <div className="text-center w-28 sm:w-32">
              <p className="text-xs font-semibold text-primary mb-1">Your Defender</p>
              {(() => {
                const def = playerLineup[isInsideStat(cpuStat) ? 2 : cpuShooterIdx];
                return <PlayerCard card={def._displayCard ?? def} gemTier={(def._displayCard ?? def).gem_tiers} />;
              })()}
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

      {/* Shot contest visualization (rolling → result) */}
      {(phase === "rolling" || phase === "result") && pendingContest && (
        <RunContestResult
          kind={pendingContest.kind}
          shooter={pendingContest.shooter}
          defender={pendingContest.defender}
          offenseStat={pendingContest.offenseStat}
          defenseStat={pendingContest.defenseStat}
          contest={pendingContest.contest}
          activations={pendingContest.activations}
          rolling={phase === "rolling"}
          shooterSide={pendingContest.shooterSide}
          onContinue={pendingContest.applyOutcome}
        />
      )}

      {/* Rebound visualization */}
      {(phase === "rebound-rolling" || phase === "rebound-result") && pendingContest && (
        <RunContestResult
          kind="rebound"
          shooter={pendingContest.shooter}
          defender={pendingContest.defender}
          offenseStat={pendingContest.offenseStat}
          defenseStat={pendingContest.defenseStat}
          contest={pendingContest.contest}
          activations={pendingContest.activations}
          rolling={phase === "rebound-rolling"}
          shooterSide={pendingContest.shooterSide}
          onContinue={pendingContest.applyOutcome}
        />
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