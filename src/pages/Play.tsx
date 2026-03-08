import { useState, useCallback } from "react";
import { LineupSelect } from "@/components/game/LineupSelect";
import { GameBoard } from "@/components/game/GameBoard";
import { GameResults } from "@/components/game/GameResults";

export interface GameCard {
  id: string;
  name: string;
  rating: number;
  position1: string | null;
  position2: string | null;
  gem_name: string | null;
  gem_tier_id: string | null;
  card_color_primary: string | null;
  card_color_secondary: string | null;
  card_glow_color: string | null;
  card_animation: string | null;
  stat_3pt: number;
  stat_mid: number;
  stat_fin: number;
  stat_dnk: number;
  stat_ast: number;
  stat_stl: number;
  stat_reb: number;
  stat_blk: number;
  stat_int: number;
}

export interface RoundLog {
  round: number;
  stat: string;
  userValue: number;
  userDice: number;
  userTotal: number;
  cpuValue: number;
  cpuDice: number;
  cpuTotal: number;
  winner: "user" | "cpu" | "tie";
}

type Phase = "lineup" | "game" | "results";

export default function Play() {
  const [phase, setPhase] = useState<Phase>("lineup");
  const [userLineup, setUserLineup] = useState<GameCard[]>([]);
  const [cpuLineup, setCpuLineup] = useState<GameCard[]>([]);
  const [roundLogs, setRoundLogs] = useState<RoundLog[]>([]);
  const [score, setScore] = useState({ user: 0, cpu: 0 });

  const handleLineupConfirm = useCallback((user: GameCard[], cpu: GameCard[]) => {
    setUserLineup(user);
    setCpuLineup(cpu);
    setPhase("game");
  }, []);

  const handleGameComplete = useCallback((logs: RoundLog[], finalScore: { user: number; cpu: number }) => {
    setRoundLogs(logs);
    setScore(finalScore);
    setPhase("results");
  }, []);

  const handlePlayAgain = useCallback(() => {
    setPhase("lineup");
    setUserLineup([]);
    setCpuLineup([]);
    setRoundLogs([]);
    setScore({ user: 0, cpu: 0 });
  }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">5v5 Dice Mode</h1>
      {phase === "lineup" && <LineupSelect onConfirm={handleLineupConfirm} />}
      {phase === "game" && (
        <GameBoard
          userLineup={userLineup}
          cpuLineup={cpuLineup}
          onComplete={handleGameComplete}
        />
      )}
      {phase === "results" && (
        <GameResults
          score={score}
          roundLogs={roundLogs}
          onPlayAgain={handlePlayAgain}
        />
      )}
    </div>
  );
}
