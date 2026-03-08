import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { STAT_LABELS, STATS, type CardGameResult, type StatKey } from "@/lib/gameEngine";
import { PackReveal } from "@/components/packs/PackReveal";
import type { FullGameResult } from "@/pages/Play";

const DEFAULT_WIN_REWARD = 100;

interface GameResultsProps {
  result: FullGameResult;
  onPlayAgain: () => void;
  coinReward?: number;
  opponentName?: string;
  mode?: string;
  packReward?: string;
}

interface PulledCard {
  id: string;
  name: string;
  rating: number;
  position1?: string | null;
  position2?: string | null;
  gem_name?: string | null;
  card_color_primary?: string | null;
  card_color_secondary?: string | null;
  card_glow_color?: string | null;
  card_animation?: string | null;
  gem_tiers?: { color?: string; name?: string } | null;
}

export function GameResults({ result, onPlayAgain, coinReward, opponentName, mode = "5v5", packReward }: GameResultsProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [saved, setSaved] = useState(false);
  const [rewardCards, setRewardCards] = useState<PulledCard[] | null>(null);
  const [showReveal, setShowReveal] = useState(false);
  const won = result.userTotal > result.cpuTotal;
  const tied = result.userTotal === result.cpuTotal;
  const reward = coinReward ?? DEFAULT_WIN_REWARD;

  useEffect(() => {
    if (!user || saved) return;
    const save = async () => {
      const { data: gameLog } = await supabase.from("game_logs").insert({
        user_id: user.id,
        mode,
        opponent_name: opponentName ?? null,
        user_score: result.userTotal,
        cpu_score: result.cpuTotal,
        won,
        player_stats: [...result.userCards, ...result.cpuCards] as any,
      }).select("id").single();

      if (gameLog) {
        const rows = [...result.userCards, ...result.cpuCards].map((c) => ({
          game_log_id: gameLog.id,
          user_id: user.id,
          player_card_id: c.playerCardId,
          side: c.side,
          stat_3pt: c.statValues.stat_3pt,
          stat_mid: c.statValues.stat_mid,
          stat_fin: c.statValues.stat_fin,
          stat_dnk: c.statValues.stat_dnk,
          stat_ast: c.statValues.stat_ast,
          stat_stl: c.statValues.stat_stl,
          stat_reb: c.statValues.stat_reb,
          stat_blk: c.statValues.stat_blk,
          stat_int: c.statValues.stat_int,
          points_scored: c.totalPoints,
        }));
        await supabase.from("card_game_stats").insert(rows);
      }

      if (won) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("coins")
          .eq("user_id", user.id)
          .maybeSingle();
        if (profile) {
          await supabase
            .from("profiles")
            .update({ coins: profile.coins + reward })
            .eq("user_id", user.id);
        }

        // Open reward pack if present
        if (packReward) {
          try {
            const { data } = await supabase.functions.invoke("open-pack", {
              body: { pack_id: packReward, quantity: 1 },
            });
            if (data?.cards && data.cards.length > 0) {
              setRewardCards(data.cards);
              setShowReveal(true);
            }
          } catch (e) {
            console.error("Failed to open reward pack:", e);
          }
        }
      }
      setSaved(true);
    };
    save();
  }, [user, saved, result, won, reward, mode, opponentName, packReward]);

  const isDomination = mode === "domination";

  if (showReveal && rewardCards) {
    return (
      <PackReveal
        cards={rewardCards}
        onOpenAnother={() => setShowReveal(false)}
        onClose={() => setShowReveal(false)}
      />
    );
  }

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Result banner */}
      <div className={cn(
        "text-center rounded-lg border p-6",
        won ? "border-gem-emerald/50 bg-gem-emerald/10" :
        tied ? "border-border bg-muted/20" :
        "border-destructive/50 bg-destructive/10"
      )}>
        <h2 className="font-display text-3xl mb-2">
          {won ? "Victory!" : tied ? "Draw!" : "Defeat"}
        </h2>
        <p className="text-4xl font-display">{result.userTotal} — {result.cpuTotal}</p>
        {won && (
          <p className="text-sm text-gem-emerald mt-2">+{reward} coins earned!</p>
        )}
        {won && packReward && !showReveal && rewardCards && (
          <p className="text-sm text-primary mt-1">🎁 Reward pack opened!</p>
        )}
      </div>

      {/* Box scores */}
      <div className="space-y-4">
        <h3 className="font-display text-sm text-muted-foreground uppercase">Your Box Score</h3>
        <BoxScore cards={result.userCards} />
        <h3 className="font-display text-sm text-muted-foreground uppercase">
          {opponentName ? `${opponentName} Box Score` : "CPU Box Score"}
        </h3>
        <BoxScore cards={result.cpuCards} />
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        {isDomination ? (
          <Button onClick={() => navigate("/domination")} className="flex-1">
            Back to Domination
          </Button>
        ) : (
          <Button onClick={onPlayAgain} className="flex-1">Play Again</Button>
        )}
        <Button variant="outline" onClick={() => navigate("/")} className="flex-1">Dashboard</Button>
      </div>
    </div>
  );
}

function BoxScore({ cards }: { cards: CardGameResult[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs border-collapse">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left p-1.5 text-muted-foreground">Player</th>
            {STATS.map((s) => (
              <th key={s} className="p-1.5 text-center text-muted-foreground">{STAT_LABELS[s]}</th>
            ))}
            <th className="p-1.5 text-center font-bold">PTS</th>
          </tr>
        </thead>
        <tbody>
          {cards.map((c) => (
            <tr key={c.playerCardId} className="border-b border-border/50">
              <td className="p-1.5 font-medium whitespace-nowrap">{c.cardName}</td>
              {STATS.map((s) => (
                <td key={s} className="p-1.5 text-center font-mono">
                  {c.statValues[s]}
                </td>
              ))}
              <td className="p-1.5 text-center font-bold text-primary">{c.totalPoints}</td>
            </tr>
          ))}
          <tr className="font-bold">
            <td className="p-1.5">Total</td>
            {STATS.map((s) => (
              <td key={s} className="p-1.5 text-center font-mono">
                {cards.reduce((sum, c) => sum + c.statValues[s], 0)}
              </td>
            ))}
            <td className="p-1.5 text-center text-primary">
              {cards.reduce((sum, c) => sum + c.totalPoints, 0)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
