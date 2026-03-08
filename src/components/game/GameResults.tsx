import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { RoundResult } from "@/components/game/RoundResult";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import type { RoundLog } from "@/pages/Play";

const WIN_REWARD = 100;

interface GameResultsProps {
  score: { user: number; cpu: number };
  roundLogs: RoundLog[];
  onPlayAgain: () => void;
}

export function GameResults({ score, roundLogs, onPlayAgain }: GameResultsProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [saved, setSaved] = useState(false);
  const won = score.user > score.cpu;
  const tied = score.user === score.cpu;

  useEffect(() => {
    if (!user || saved) return;
    const save = async () => {
      // Log game
      await supabase.from("game_logs").insert({
        user_id: user.id,
        mode: "5v5",
        user_score: score.user,
        cpu_score: score.cpu,
        won,
        player_stats: roundLogs as any,
      });

      // Award coins on win
      if (won) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("coins")
          .eq("user_id", user.id)
          .maybeSingle();
        if (profile) {
          await supabase
            .from("profiles")
            .update({ coins: profile.coins + WIN_REWARD })
            .eq("user_id", user.id);
        }
      }
      setSaved(true);
    };
    save();
  }, [user, saved, score, won, roundLogs]);

  return (
    <div className="space-y-6 max-w-md mx-auto">
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
        <p className="text-4xl font-display">{score.user} — {score.cpu}</p>
        {won && (
          <p className="text-sm text-gem-emerald mt-2">+{WIN_REWARD} coins earned!</p>
        )}
      </div>

      {/* Round breakdown */}
      <div className="space-y-2">
        <h3 className="font-display text-sm text-muted-foreground uppercase">Round Breakdown</h3>
        {roundLogs.map((log) => (
          <RoundResult key={log.round} result={log} />
        ))}
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <Button onClick={onPlayAgain} className="flex-1">Play Again</Button>
        <Button variant="outline" onClick={() => navigate("/")} className="flex-1">Dashboard</Button>
      </div>
    </div>
  );
}
