import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useNavigate } from "react-router-dom";
import { Trophy, Flame, Target, Star, ChevronRight } from "lucide-react";

export default function RunsHub() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const { data: runs, isLoading } = useQuery({
    queryKey: ["runs", user?.id],
    queryFn: async () => {
      const { data: runsData, error: runsError } = await supabase
        .from("runs")
        .select(`
          id, name, target_score, milestones,
          teams ( name ),
          user_runs ( current_wins, highest_wins )
        `);
      
      if (runsError) throw runsError;
      return runsData;
    },
    enabled: !!user,
  });

  const getRankData = (wins: number) => {
    if (wins < 3) return { rank: "Prospect", nextRank: "Hooper", winsNeeded: 3 - wins, progress: (wins / 3) * 100, color: "text-slate-400" };
    if (wins < 7) return { rank: "Hooper", nextRank: "Baller", winsNeeded: 7 - wins, progress: ((wins - 3) / 4) * 100, color: "text-green-500" };
    if (wins < 12) return { rank: "Baller", nextRank: "Star", winsNeeded: 12 - wins, progress: ((wins - 7) / 5) * 100, color: "text-blue-400" };
    if (wins < 18) return { rank: "Star", nextRank: "Superstar", winsNeeded: 18 - wins, progress: ((wins - 12) / 6) * 100, color: "text-purple-500" };
    if (wins < 25) return { rank: "Superstar", nextRank: "Legend", winsNeeded: 25 - wins, progress: ((wins - 18) / 7) * 100, color: "text-pink-500" };
    return { rank: "Legend", nextRank: "Max", winsNeeded: 0, progress: 100, color: "text-yellow-500" };
  };

  if (isLoading) {
    return <div className="flex h-64 items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;
  }

  return (
    <div className="space-y-8 pb-12">
      <div>
        <h1 className="font-display text-4xl font-bold tracking-wider flex items-center gap-3">
          <Trophy className="h-8 w-8 text-gem-amethyst" />
          The Runs
        </h1>
        <p className="text-muted-foreground mt-2 max-w-2xl">
          A grueling 3v3 Gauntlet. Race to 21 (Win by 2). Keep your streak alive to earn escalating rewards based on the milestone tiers.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {runs?.map((run) => {
          const userRun = run.user_runs?.[0];
          const currentWins = userRun?.current_wins || 0;
          const highestWins = userRun?.highest_wins || 0;
          const opponentName = run.teams?.name || "Unknown Team";
          
          return (
            <Card key={run.id} className="border-border/50 bg-card overflow-hidden">
              <div className="h-2 w-full bg-gradient-to-r from-gem-amethyst to-gem-diamond" />
              <CardHeader>
                <CardTitle className="font-display text-2xl">{run.name}</CardTitle>
                <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
                  <Target className="h-4 w-4" />
                  Target Score: {run.target_score}
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="bg-muted/30 rounded-lg p-4 flex justify-between items-center border border-border/50">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Active Streak</p>
                    <div className="flex items-center gap-2">
                      <Flame className={`h-5 w-5 ${currentWins > 0 ? "text-orange-500" : "text-muted-foreground"}`} />
                      <span className="text-2xl font-bold">{currentWins}</span>
                    </div>
                  </div>
                  <div className="space-y-1 text-right">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Personal Best</p>
                    <span className="text-xl font-bold text-muted-foreground">{highestWins}</span>
                  </div>
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-semibold text-foreground/80">Opponent Pool:</p>
                  <p className="text-sm text-muted-foreground">{opponentName}</p>
                </div>

                <Button 
                  className="w-full font-display tracking-wider bg-gem-amethyst hover:bg-gem-amethyst/90 text-white" 
                  size="lg"
                  onClick={() => navigate(`/runs/${run.id}`)}
                >
                  {currentWins > 0 ? "CONTINUE RUN" : "START NEW RUN"}
                </Button>
              </CardContent>
            </Card>
          );
        })}
        {runs?.length === 0 && (
          <div className="col-span-full py-12 text-center text-muted-foreground border border-dashed rounded-lg">
            No Runs have been configured yet. Check back later!
          </div>
        )}
      </div>
    </div>
  );
}
