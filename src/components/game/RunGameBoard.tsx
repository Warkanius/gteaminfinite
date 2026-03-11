import { useState, useEffect } from "react";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SCORING_STATS, STAT_LABELS, type StatKey, rollDice, resolveRunStatRoll, getRunDiceCount } from "@/lib/gameEngine";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

interface Props {
  run: any;
  playerLineup: any[];
  cpuLineup: any[];
  onGameComplete: () => void;
}

export function RunGameBoard({ run, playerLineup, cpuLineup, onGameComplete }: Props) {
  const { user } = useAuth();
  
  const targetScore = run.target_score;
  const [playerScore, setPlayerScore] = useState(0);
  const [cpuScore, setCpuScore] = useState(0);
  
  const [playerIndex, setPlayerIndex] = useState(0);
  const [cpuIndex, setCpuIndex] = useState(0);
  
  const [selectedStat, setSelectedStat] = useState<StatKey>("stat_3pt");
  const [isRolling, setIsRolling] = useState(false);
  const [logs, setLogs] = useState<{ msg: string; pPts: number; cPts: number }[]>([]);

  const checkWinner = (pScore: number, cScore: number) => {
    if (pScore >= targetScore && pScore - cScore >= 2) return "player";
    if (cScore >= targetScore && cScore - pScore >= 2) return "cpu";
    return null;
  };

  const handleRoll = async () => {
    if (isRolling) return;
    setIsRolling(true);

    const pCard = playerLineup[playerIndex];
    const cCard = cpuLineup[cpuIndex];

    const pDice = rollDice(pCard.rating >= 85 ? 2 : 1).dice;
    const cDice = rollDice(cCard.rating >= 85 ? 2 : 1).dice;

    // We need star conversions or assume rating/20. The gameEngine uses stars.
    // Assuming standard rating logic: 99=5, 95=4, 90=3, 85=2, 80=1, else 0
    const getStars = (r: number) => r >= 99 ? 5 : r >= 95 ? 4 : r >= 90 ? 3 : r >= 85 ? 2 : r >= 80 ? 1 : 0;

    const pResult = resolveStatRoll(selectedStat, pCard[selectedStat], getStars(pCard.rating), pDice);
    const cResult = resolveStatRoll(selectedStat, cCard[selectedStat], getStars(cCard.rating), cDice);

    const newLogs = [...logs];
    let newPScore = playerScore;
    let newCScore = cpuScore;

    if (pResult.rollResult > cResult.rollResult) {
      newPScore += pResult.points;
      newLogs.unshift({ msg: `Player ${pCard.name} won ${STAT_LABELS[selectedStat]} roll! (+${pResult.points} pts)`, pPts: pResult.points, cPts: 0 });
    } else if (cResult.rollResult > pResult.rollResult) {
      newCScore += cResult.points;
      newLogs.unshift({ msg: `CPU ${cCard.name} won ${STAT_LABELS[selectedStat]} roll! (+${cResult.points} pts)`, pPts: 0, cPts: cResult.points });
    } else {
      newLogs.unshift({ msg: `Tie on ${STAT_LABELS[selectedStat]}! No points.`, pPts: 0, cPts: 0 });
    }

    setPlayerScore(newPScore);
    setCpuScore(newCScore);
    setLogs(newLogs.slice(0, 10));

    // Next turn
    setPlayerIndex((playerIndex + 1) % 3);
    setCpuIndex((cpuIndex + 1) % 3);
    
    const winner = checkWinner(newPScore, newCScore);
    
    if (winner) {
      toast({
        title: winner === "player" ? "You Won the Match!" : "You Lost the Match!",
        description: `${newPScore} - ${newCScore}`,
        variant: winner === "player" ? "default" : "destructive"
      });

      // Update user_runs
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
          await supabase.from("user_runs").insert({
            user_id: user.id,
            run_id: run.id,
            current_wins: currentWins,
            highest_wins: highestWins
          });
        }
        
        // Milestone reward checks
        if (winner === "player" && run.milestones && Array.isArray(run.milestones)) {
          const reachedMilestone = run.milestones.find((m: any) => m.wins_required === currentWins);
          if (reachedMilestone) {
            const { data: profile } = await supabase.from("profiles").select("coins, gems").eq("user_id", user.id).single();
            if (profile) {
              const newCoins = profile.coins + (reachedMilestone.coin_reward || 0);
              const newGems = profile.gems + (reachedMilestone.gem_reward || 0);
              await supabase.from("profiles").update({ coins: newCoins, gems: newGems }).eq("user_id", user.id);
              
              toast({
                title: "Milestone Reached!",
                description: `You earned ${reachedMilestone.coin_reward || 0} Coins and ${reachedMilestone.gem_reward || 0} Gems!`,
                variant: "default"
              });
            }
          }
        }
      }

      setTimeout(() => onGameComplete(), 2000);
    } else {
      setIsRolling(false);
    }
  };

  const pCard = playerLineup[playerIndex];
  const cCard = cpuLineup[cpuIndex];

  return (
    <div className="space-y-8">
      {/* Scoreboard */}
      <div className="bg-card border border-border/50 rounded-xl p-6 flex items-center justify-between shadow-lg">
        <div className="text-center space-y-1">
          <p className="text-sm text-muted-foreground uppercase font-semibold tracking-wider">Your Team</p>
          <p className="text-6xl font-display font-bold text-primary">{playerScore}</p>
        </div>
        <div className="text-center space-y-2">
          <p className="text-sm font-bold uppercase text-muted-foreground bg-muted/50 px-3 py-1 rounded-full">Target: {targetScore}</p>
          <p className="text-xs text-muted-foreground font-semibold">Win By 2</p>
        </div>
        <div className="text-center space-y-1">
          <p className="text-sm text-muted-foreground uppercase font-semibold tracking-wider">Opponent</p>
          <p className="text-6xl font-display font-bold text-destructive">{cpuScore}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Player Side */}
        <div className="space-y-4 flex flex-col items-center">
          <h3 className="font-display text-xl">Your Player (Pos {playerIndex + 1})</h3>
          <div className="transform scale-110 mb-4">
            <PlayerCard card={pCard} />
          </div>
          
          <div className="w-full max-w-xs space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Select Stat to Roll</label>
              <Select value={selectedStat} onValueChange={(v) => setSelectedStat(v as StatKey)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCORING_STATS.map(stat => (
                    <SelectItem key={stat} value={stat}>
                      {STAT_LABELS[stat]} ({pCard[stat]})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <Button 
              className="w-full font-display tracking-wider text-lg h-14 bg-primary hover:bg-primary/90" 
              onClick={handleRoll}
              disabled={isRolling}
            >
              {isRolling ? "ROLLING..." : "ROLL STAT"}
            </Button>
          </div>
        </div>

        {/* CPU Side */}
        <div className="space-y-4 flex flex-col items-center opacity-90">
          <h3 className="font-display text-xl text-destructive">CPU (Pos {cpuIndex + 1})</h3>
          <div className="transform scale-110 mb-4">
            <PlayerCard card={cCard} />
          </div>
          <div className="w-full max-w-xs space-y-2 mt-4 text-center">
            <p className="text-sm font-semibold text-muted-foreground">CPU is waiting for your roll...</p>
          </div>
        </div>
      </div>

      {/* Log */}
      <div className="bg-muted/30 border border-border/50 rounded-xl p-4 mt-8">
        <h4 className="font-display text-lg mb-3">Action Log</h4>
        <div className="space-y-2">
          {logs.map((log, i) => (
            <div key={i} className={`text-sm p-2 rounded-md border-l-4 ${log.pPts > 0 ? "bg-primary/10 border-primary" : log.cPts > 0 ? "bg-destructive/10 border-destructive" : "bg-muted border-muted-foreground"}`}>
              {log.msg}
            </div>
          ))}
          {logs.length === 0 && <p className="text-sm text-muted-foreground">Match hasn't started yet.</p>}
        </div>
      </div>
    </div>
  );
}