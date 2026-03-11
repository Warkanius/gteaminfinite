import { useState, useCallback } from "react";
import { useLocation } from "react-router-dom";
import { LineupSelect } from "@/components/game/LineupSelect";
import { GameBoard } from "@/components/game/GameBoard";
import { GameResults } from "@/components/game/GameResults";
import type { CardGameResult } from "@/lib/gameEngine";
import type { CardBadge } from "@/lib/badgeEngine";

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

interface DominationState {
  dominationGameId?: string;
  opponentName?: string;
  coinReward?: number;
  packReward?: string;
  difficultyStars?: number;
}

export default function Play() {
  const location = useLocation();
  const domState = (location.state as DominationState) ?? {};

  const [phase, setPhase] = useState<Phase>("lineup");
  const [userLineup, setUserLineup] = useState<GameCard[]>([]);
  const [cpuLineup, setCpuLineup] = useState<GameCard[]>([]);
  const [badgeMap, setBadgeMap] = useState<Record<string, CardBadge[]>>({});
  const [gameResult, setGameResult] = useState<FullGameResult | null>(null);

  const isDomination = !!domState.dominationGameId;

  const handleLineupConfirm = useCallback((user: GameCard[], cpu: GameCard[], badges: Record<string, CardBadge[]>) => {
    setUserLineup(user);
    setCpuLineup(cpu);
    setBadgeMap(badges);
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
    setBadgeMap({});
    setGameResult(null);
  }, []);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold font-display">
        {isDomination ? `vs ${domState.opponentName}` : "5v5 Dice Mode"}
      </h1>
      {phase === "lineup" && (
        <LineupSelect
          onConfirm={handleLineupConfirm}
          dominationGameId={domState.dominationGameId}
        />
      )}
      {phase === "game" && (
        <GameBoard
          userLineup={userLineup}
          cpuLineup={cpuLineup}
          badgeMap={badgeMap}
          onComplete={handleGameComplete}
          difficultyStars={domState.difficultyStars}
        />
      )}
      {phase === "results" && gameResult && (
        <GameResults
          result={gameResult}
          onPlayAgain={handlePlayAgain}
          coinReward={domState.coinReward}
          opponentName={domState.opponentName}
          mode={isDomination ? "domination" : "5v5"}
          packReward={domState.packReward}
        />
      )}
    </div>
  );
}
