import { useState, useMemo, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { DiceInput } from "@/components/game/DiceInput";
import { DiceRoll } from "@/components/game/DiceRoll";
import { RoundResult } from "@/components/game/RoundResult";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dice5 } from "lucide-react";
import type { GameCard, RoundLog } from "@/pages/Play";

const STATS = ["stat_3pt", "stat_mid", "stat_fin", "stat_dnk", "stat_ast", "stat_stl", "stat_reb", "stat_blk", "stat_int"] as const;
const STAT_LABELS: Record<string, string> = {
  stat_3pt: "3PT", stat_mid: "MID", stat_fin: "FIN", stat_dnk: "DNK",
  stat_ast: "AST", stat_stl: "STL", stat_reb: "REB", stat_blk: "BLK", stat_int: "INT",
};

interface GameBoardProps {
  userLineup: GameCard[];
  cpuLineup: GameCard[];
  onComplete: (logs: RoundLog[], score: { user: number; cpu: number }) => void;
}

function pickStat(card: GameCard): typeof STATS[number] {
  // Weighted random toward highest stats
  const values = STATS.map((s) => ({ stat: s, value: card[s] }));
  const total = values.reduce((sum, v) => sum + v.value * v.value, 0);
  let r = Math.random() * total;
  for (const v of values) {
    r -= v.value * v.value;
    if (r <= 0) return v.stat;
  }
  return values[0].stat;
}

export function GameBoard({ userLineup, cpuLineup, onComplete }: GameBoardProps) {
  const [round, setRound] = useState(0);
  const [logs, setLogs] = useState<RoundLog[]>([]);
  const [userScore, setUserScore] = useState(0);
  const [cpuScore, setCpuScore] = useState(0);
  const [phase, setPhase] = useState<"dice" | "result">("dice");
  const [currentResult, setCurrentResult] = useState<RoundLog | null>(null);
  const [useOwnDice, setUseOwnDice] = useState(false);

  // Auto-roll state
  const [rolling, setRolling] = useState(false);
  const [autoUserDice, setAutoUserDice] = useState<number | null>(null);
  const [autoCpuDice, setAutoCpuDice] = useState<number | null>(null);

  // Pick stat for this round
  const currentStat = useMemo(() => pickStat(userLineup[round] ?? userLineup[0]), [round, userLineup]);

  const { data: gemTiers = [] } = useQuery({
    queryKey: ["gem-tiers"],
    queryFn: async () => {
      const { data } = await supabase.from("gem_tiers").select("*").order("sort_order");
      return data ?? [];
    },
  });
  const gemTierMap = useMemo(() => Object.fromEntries(gemTiers.map((g) => [g.id, g])), [gemTiers]);

  const userCard = userLineup[round];
  const cpuCard = cpuLineup[round];

  const handleDiceSubmit = useCallback((userDice: number, cpuDice: number) => {
    const userGem = gemTierMap[userCard.gem_tier_id ?? ""];
    const cpuGem = gemTierMap[cpuCard.gem_tier_id ?? ""];

    const userStatVal = userCard[currentStat];
    const cpuStatVal = cpuCard[currentStat];
    const userMod = userGem?.roll_modifier ?? 0;
    const cpuMod = cpuGem?.roll_modifier ?? 0;

    const userTotal = userStatVal + userDice + userMod;
    const cpuTotal = cpuStatVal + cpuDice + cpuMod;

    const winner = userTotal > cpuTotal ? "user" : cpuTotal > userTotal ? "cpu" : "tie";

    const log: RoundLog = {
      round: round + 1,
      stat: STAT_LABELS[currentStat],
      userValue: userStatVal,
      userDice,
      userTotal,
      cpuValue: cpuStatVal,
      cpuDice,
      cpuTotal,
      winner,
    };

    const newLogs = [...logs, log];
    const newUserScore = userScore + (winner === "user" ? 1 : 0);
    const newCpuScore = cpuScore + (winner === "cpu" ? 1 : 0);

    setLogs(newLogs);
    setUserScore(newUserScore);
    setCpuScore(newCpuScore);
    setCurrentResult(log);
    setPhase("result");
  }, [gemTierMap, userCard, cpuCard, currentStat, round, logs, userScore, cpuScore]);

  const handleAutoRoll = useCallback(() => {
    setRolling(true);
    setAutoUserDice(null);
    setAutoCpuDice(null);

    setTimeout(() => {
      const uDice = Math.floor(Math.random() * 6) + 1;
      const cDice = Math.floor(Math.random() * 6) + 1;
      setAutoUserDice(uDice);
      setAutoCpuDice(cDice);
      setRolling(false);

      // Small delay so user sees the result before resolving
      setTimeout(() => {
        handleDiceSubmit(uDice, cDice);
      }, 600);
    }, 1000);
  }, [handleDiceSubmit]);

  const handleNextRound = () => {
    if (round >= 4) {
      onComplete(logs, { user: userScore, cpu: cpuScore });
    } else {
      setRound((r) => r + 1);
      setPhase("dice");
      setCurrentResult(null);
      setAutoUserDice(null);
      setAutoCpuDice(null);
    }
  };

  if (!userCard || !cpuCard) return null;

  return (
    <div className="space-y-6">
      {/* Scoreboard */}
      <div className="flex items-center justify-center gap-6">
        <div className="text-center">
          <p className="text-xs text-muted-foreground uppercase">You</p>
          <p className="text-3xl font-bold font-display">{userScore}</p>
        </div>
        <div className="text-sm text-muted-foreground">Round {round + 1}/5</div>
        <div className="text-center">
          <p className="text-xs text-muted-foreground uppercase">CPU</p>
          <p className="text-3xl font-bold font-display">{cpuScore}</p>
        </div>
      </div>

      {/* Stat being compared */}
      <div className="text-center">
        <span className="text-xs text-muted-foreground uppercase">Stat: </span>
        <span className="font-display text-lg text-primary">{STAT_LABELS[currentStat]}</span>
      </div>

      {/* Cards face-off */}
      <div className="grid grid-cols-2 gap-4 max-w-md mx-auto">
        <div className="flex flex-col items-center gap-2">
          <PlayerCard
            card={userCard}
            gemTier={gemTierMap[userCard.gem_tier_id ?? ""]}
          />
          <span className="text-sm font-medium">{STAT_LABELS[currentStat]}: {userCard[currentStat]}</span>
        </div>
        <div className="flex flex-col items-center gap-2">
          <PlayerCard
            card={cpuCard}
            gemTier={gemTierMap[cpuCard.gem_tier_id ?? ""]}
          />
          {phase === "result" ? (
            <span className="text-sm font-medium">{STAT_LABELS[currentStat]}: {cpuCard[currentStat]}</span>
          ) : (
            <span className="text-sm text-muted-foreground">???</span>
          )}
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

      {/* Dice input or result */}
      {phase === "dice" && !useOwnDice && (
        <div className="space-y-4">
          <div className="flex justify-center gap-8">
            <DiceRoll rolling={rolling} value={autoUserDice} label="Your Roll" />
            <DiceRoll rolling={rolling} value={autoCpuDice} label="CPU Roll" />
          </div>
          <div className="text-center">
            <Button onClick={handleAutoRoll} disabled={rolling}>
              {rolling ? "Rolling..." : "Roll Dice"}
            </Button>
          </div>
        </div>
      )}

      {phase === "dice" && useOwnDice && (
        <DiceInput onSubmit={handleDiceSubmit} />
      )}

      {phase === "result" && currentResult && (
        <div className="space-y-4">
          <RoundResult result={currentResult} />
          <div className="text-center">
            <Button onClick={handleNextRound}>
              {round >= 4 ? "See Results" : "Next Round"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
