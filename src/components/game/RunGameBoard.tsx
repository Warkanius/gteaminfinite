import { useState } from "react";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  SCORING_STATS, STAT_LABELS, type StatKey,
  rollDice, getRunDiceCount, getDefenseStat, isInsideStat,
  resolveRunShotContest, pickRebounderSlot, resolveRunReboundRoll,
  type ShotContestResult,
} from "@/lib/gameEngine";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

interface Props {
  run: any;
  playerLineup: any[];
  cpuLineup: any[];
  onGameComplete: () => void;
}

type Phase = "choose" | "rolling" | "rebound" | "done";
type Possession = "player" | "cpu";

interface LogEntry {
  msg: string;
  type: "score-player" | "score-cpu" | "miss" | "rebound" | "info";
}

export function RunGameBoard({ run, playerLineup, cpuLineup, onGameComplete }: Props) {
  const { user } = useAuth();
  const targetScore = run.target_score;

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
      const { data: userRun } = await supabase
        .from("user_runs")
        .select("id, current_wins, highest_wins")
        .eq("run_id", run.id)
        .eq("user_id", user.id)
        .maybeSingle();

      const currentWins = winner === "player" ? (userRun?.current_wins || 0) + 1 : 0;
      const highestWins = Math.max(currentWins, userRun?.highest_wins || 0);

      if (userRun) {
        await supabase.from("user_runs").update({ current_wins: currentWins, highest_wins: highestWins }).eq("id", userRun.id);
      } else {
        await supabase.from("user_runs").insert({ user_id: user.id, run_id: run.id, current_wins: currentWins, highest_wins: highestWins });
      }

      if (winner === "player" && run.milestones && Array.isArray(run.milestones)) {
        const reachedMilestone = run.milestones.find((m: any) => m.wins_required === currentWins);
        if (reachedMilestone) {
          const { data: profile } = await supabase.from("profiles").select("coins, gems").eq("user_id", user.id).single();
          if (profile) {
            const newCoins = profile.coins + (reachedMilestone.coin_reward || 0);
            const newGems = profile.gems + (reachedMilestone.gem_reward || 0);
            await supabase.from("profiles").update({ coins: newCoins, gems: newGems }).eq("user_id", user.id);
            toast({ title: "Milestone Reached!", description: `You earned ${reachedMilestone.coin_reward || 0} Coins and ${reachedMilestone.gem_reward || 0} Gems!` });
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

  /** Player shoots on their possession */
  const handlePlayerShoot = () => {
    setPhase("rolling");
    const shooter = playerLineup[selectedShooterIdx];
    const offRating = shooter._runRating ?? 60;

    // Determine defender
    const defStat = getDefenseStat(selectedStat);
    const defenderIdx = isInsideStat(selectedStat) ? 2 : selectedShooterIdx; // slot 3 for inside, direct matchup for perimeter
    const defender = cpuLineup[defenderIdx];
    const defRating = defender._runRating ?? 60;

    const offDice = rollDice(getRunDiceCount(offRating)).dice;
    const defDice = rollDice(getRunDiceCount(defRating)).dice;

    const result = resolveRunShotContest(
      selectedStat, shooter[selectedStat], offRating, offDice,
      defStat, defender[defStat], defRating, defDice,
    );
    setLastContest(result);

    let newPScore = playerScore;
    let newCScore = cpuScore;

    if (result.made) {
      newPScore += result.points;
      setPlayerScore(newPScore);
      addLog({ msg: `🏀 ${shooter.name} hits ${STAT_LABELS[selectedStat]}! +${result.points}pts (${result.offenseRoll} vs ${result.defenseRoll})`, type: "score-player" });
      
      // Possession changes to CPU
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
      // Trigger rebound
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

    const offDice = rollDice(getRunDiceCount(offRating)).dice;
    const defDice = rollDice(getRunDiceCount(defRating)).dice;

    const result = resolveRunShotContest(
      cpuStat, shooter[cpuStat], offRating, offDice,
      defStat, defender[defStat], defRating, defDice,
    );
    setLastContest(result);

    let newPScore = playerScore;
    let newCScore = cpuScore;

    if (result.made) {
      newCScore += result.points;
      setCpuScore(newCScore);
      addLog({ msg: `🏀 CPU ${shooter.name} hits ${STAT_LABELS[cpuStat]}! +${result.points}pts (${result.offenseRoll} vs ${result.defenseRoll})`, type: "score-cpu" });
      
      // Possession goes to player
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
          ))}
          {logs.length === 0 && <p className="text-xs text-muted-foreground">Tip the ball to start!</p>}
        </div>
      </div>
    </div>
  );
}
