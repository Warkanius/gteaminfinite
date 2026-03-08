import { useState, useCallback } from "react";
import { LineupSelect } from "@/components/game/LineupSelect";
import { GameBoard } from "@/components/game/GameBoard";
import { GameResults } from "@/components/game/GameResults";
import type { CardGameResult } from "@/lib/gameEngine";

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

export interface FullGameResult {
  userCards: CardGameResult[];
  cpuCards: CardGameResult[];
  userTotal: number;
  cpuTotal: number;
}

type Phase = "lineup" | "game" | "results";

export default function Play() {
  const [phase, setPhase] = useState<Phase>("lineup");
  const [userLineup, setUserLineup] = useState<GameCard[]>([]);
  const [cpuLineup, setCpuLineup] = useState<GameCard[]>([]);
  const [gameResult, setGameResult] = useState<FullGameResult | null>(null);

  const handleLineupConfirm = useCallback((user: GameCard[], cpu: GameCard[]) => {
    setUserLineup(user);
    setCpuLineup(cpu);
    setPhase("game");
  }, []);

  const handleGameComplete = useCallback((result: FullGameResult) => {
    setGameResult(result);
    setPhase("results");
  }, []);

  const handlePlayAgain = useCallback(() => {
    setPhase("lineup");
    setUserLineup([]);
    setCpuLineup([]);
    setGameResult(null);
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
      {phase === "results" && gameResult && (
        <GameResults
          result={gameResult}
          onPlayAgain={handlePlayAgain}
        />
      )}
    </div>
  );
}
