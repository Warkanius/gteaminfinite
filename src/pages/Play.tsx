import { useState, useCallback, useMemo } from "react";
import { useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { LineupSelect } from "@/components/game/LineupSelect";
import { MatchupArrange } from "@/components/game/MatchupArrange";
import { GameBoard } from "@/components/game/GameBoard";
import { GameResults } from "@/components/game/GameResults";
import type { CardGameResult } from "@/lib/gameEngine";
import type { CardBadge } from "@/lib/badgeEngine";
import type { CardTrait } from "@/lib/traitEngine";

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

type Phase = "lineup" | "matchup" | "game" | "results";

interface GameState {
  dominationGameId?: string;
  difficultyStars?: number;
  challengeId?: string;
  challengeTeamId?: string;
  lineupRestrictions?: any;
  winCondition?: string;
  winByAmount?: number;
  seriesLength?: number;
  gemReward?: number;
  cardRewardId?: string;
  opponentName?: string;
  coinReward?: number;
  packReward?: string;
}

export default function Play() {
  const location = useLocation();
  const gameState = (location.state as GameState) ?? {};

  const [phase, setPhase] = useState<Phase>("lineup");
  const [userLineup, setUserLineup] = useState<GameCard[]>([]);
  const [cpuLineup, setCpuLineup] = useState<GameCard[]>([]);
  const [badgeMap, setBadgeMap] = useState<Record<string, CardBadge[]>>({});
  const [traitMap, setTraitMap] = useState<Record<string, CardTrait[]>>({});
  const [gameResult, setGameResult] = useState<FullGameResult | null>(null);

  const { data: gemTiers = [] } = useQuery({
    queryKey: ["gem-tiers"],
    queryFn: async () => {
      const { data } = await supabase.from("gem_tiers").select("*").order("sort_order");
      return data ?? [];
    },
  });
  const gemTierMap = useMemo(() => Object.fromEntries(gemTiers.map((g) => [g.id, g])), [gemTiers]);

  const isDomination = !!gameState.dominationGameId;
  const isChallenge = !!gameState.challengeId;

  const handleLineupConfirm = useCallback((user: GameCard[], cpu: GameCard[], badges: Record<string, CardBadge[]>, traits: Record<string, CardTrait[]>) => {
    setUserLineup(user);
    setCpuLineup(cpu);
    setBadgeMap(badges);
    setTraitMap(traits);
    // Go to matchup arrangement phase
    setPhase("matchup");
  }, []);

  const handleMatchupConfirm = useCallback((arrangedUser: GameCard[]) => {
    setUserLineup(arrangedUser);
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
    setTraitMap({});
    setGameResult(null);
  }, []);

  const title = isDomination
    ? `vs ${gameState.opponentName}`
    : isChallenge
    ? `Challenge: ${gameState.opponentName ?? "Challenge"}`
    : "5v5 Dice Mode";

  const mode = isDomination ? "domination" : isChallenge ? "challenge" : "5v5";

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold font-display">{title}</h1>
      {phase === "lineup" && (
        <LineupSelect
          onConfirm={handleLineupConfirm}
          dominationGameId={gameState.dominationGameId}
          challengeTeamId={gameState.challengeTeamId}
          lineupRestrictions={gameState.lineupRestrictions}
        />
      )}
      {phase === "matchup" && (
        <MatchupArrange
          userLineup={userLineup}
          cpuLineup={cpuLineup}
          gemTierMap={gemTierMap}
          onConfirm={handleMatchupConfirm}
        />
      )}
      {phase === "game" && (
        <GameBoard
          userLineup={userLineup}
          cpuLineup={cpuLineup}
          badgeMap={badgeMap}
          traitMap={traitMap}
          onComplete={handleGameComplete}
          difficultyStars={gameState.difficultyStars}
          gameContext={{ isHome: !isDomination, isAway: isDomination, isKeyGame: false }}
        />
      )}
      {phase === "results" && gameResult && (
        <GameResults
          result={gameResult}
          onPlayAgain={handlePlayAgain}
          coinReward={gameState.coinReward}
          opponentName={gameState.opponentName}
          mode={mode}
          packReward={gameState.packReward}
          gemReward={gameState.gemReward}
          cardRewardId={gameState.cardRewardId}
          challengeId={gameState.challengeId}
          dominationGameId={gameState.dominationGameId}
        />
      )}
    </div>
  );
}
