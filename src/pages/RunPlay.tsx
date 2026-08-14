import { useState } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { RunLineupSelect } from "@/components/game/RunLineupSelect";
import { RunGameBoard } from "@/components/game/RunGameBoard";
import type { CardBadge } from "@/lib/badgeEngine";
import type { CardTrait } from "@/lib/traitEngine";
import type { ActiveDynamicDuo } from "@/lib/dynamicDuos";

export default function RunPlay() {
  const { runId } = useParams<{ runId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [playerLineup, setPlayerLineup] = useState<any[]>([]);
  const [cpuLineup, setCpuLineup] = useState<any[]>([]);
  const [badgeMap, setBadgeMap] = useState<Record<string, CardBadge[]>>({});
  const [traitMap, setTraitMap] = useState<Record<string, CardTrait[]>>({});
  const [activeDuos, setActiveDuos] = useState<ActiveDynamicDuo[]>([]);
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
          savedLineupId={(location.state as { savedLineupId?: string } | null)?.savedLineupId}
          onLineupConfirmed={(player, cpu, badges, traits, duos) => {
            setPlayerLineup(player);
            setCpuLineup(cpu);
            setBadgeMap(badges);
            setTraitMap(traits);
            setActiveDuos(duos);
            setPhase("game");
          }}
        />
      )}

      {phase === "game" && (
        <RunGameBoard
          run={run}
          playerLineup={playerLineup}
          cpuLineup={cpuLineup}
          badgeMap={badgeMap}
          traitMap={traitMap}
          activeDuos={activeDuos}
          onGameComplete={() => navigate("/runs")}
          runId={run.id}
        />
      )}
    </div>
  );
}
