import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { RunLineupSelect } from "@/components/game/RunLineupSelect";
import { RunGameBoard } from "@/components/game/RunGameBoard";

export default function RunPlay() {
  const { runId } = useParams<{ runId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [playerLineup, setPlayerLineup] = useState<any[]>([]);
  const [cpuLineup, setCpuLineup] = useState<any[]>([]);
  const [phase, setPhase] = useState<"lineup" | "game">("lineup");

  const { data: run, isLoading } = useQuery({
    queryKey: ["run", runId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("runs")
        .select(`*, teams ( id, name )`)
        .eq("id", runId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!runId,
  });

  if (isLoading) {
    return <div className="flex min-h-screen items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;
  }

  if (!run) return <div>Run not found</div>;

  return (
    <div className="space-y-6 pb-12">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/runs")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="font-display text-3xl font-bold tracking-wider">{run.name}</h1>
          <p className="text-muted-foreground text-sm">Target Score: {run.target_score} • Win by 2</p>
        </div>
      </div>

      {phase === "lineup" && (
        <RunLineupSelect
          runId={run.id}
          teamId={run.team_id}
          onLineupConfirmed={(player, cpu) => {
            setPlayerLineup(player);
            setCpuLineup(cpu);
            setPhase("game");
          }}
        />
      )}

      {phase === "game" && (
        <RunGameBoard
          run={run}
          playerLineup={playerLineup}
          cpuLineup={cpuLineup}
          onGameComplete={() => navigate("/runs")}
        />
      )}
    </div>
  );
}
