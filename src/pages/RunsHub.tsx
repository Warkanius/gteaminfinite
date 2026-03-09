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

  const RANKS = [
    { name: "Nobody I", wins: 1, color: "text-muted-foreground" },
    { name: "Nobody II", wins: 5, color: "text-muted-foreground" },
    { name: "Nobody III", wins: 10, color: "text-muted-foreground" },
    { name: "Nobody IV", wins: 15, color: "text-muted-foreground" },
    { name: "Nobody V", wins: 20, color: "text-muted-foreground" },
    { name: "Regular I", wins: 25, color: "text-gem-emerald" },
    { name: "Regular II", wins: 35, color: "text-gem-emerald" },
    { name: "Regular III", wins: 45, color: "text-gem-emerald" },
    { name: "Regular IV", wins: 55, color: "text-gem-emerald" },
    { name: "Regular V", wins: 65, color: "text-gem-emerald" },
    { name: "Hooper I", wins: 75, color: "text-gem-amethyst" },
    { name: "Hooper II", wins: 90, color: "text-gem-amethyst" },
    { name: "Hooper III", wins: 105, color: "text-gem-amethyst" },
    { name: "Hooper IV", wins: 120, color: "text-gem-amethyst" },
    { name: "Hooper V", wins: 135, color: "text-gem-amethyst" },
    { name: "Top Pick I", wins: 150, color: "text-gem-diamond" },
    { name: "Top Pick II", wins: 170, color: "text-gem-diamond" },
    { name: "Top Pick III", wins: 190, color: "text-gem-diamond" },
    { name: "Top Pick IV", wins: 210, color: "text-gem-diamond" },
    { name: "Top Pick V", wins: 230, color: "text-gem-diamond" },
    { name: "Legend I", wins: 250, color: "text-gem-gold" },
    { name: "Legend II", wins: 350, color: "text-gem-gold" },
    { name: "Legend III", wins: 500, color: "text-gem-gold" },
    { name: "Legend IV", wins: 725, color: "text-gem-gold" },
    { name: "Legend V", wins: 1000, color: "text-gem-gold" },
  ];

  const getRankData = (wins: number) => {
    let currentRankIndex = -1;
    for (let i = RANKS.length - 1; i >= 0; i--) {
      if (wins >= RANKS[i].wins) {
        currentRankIndex = i;
        break;
      }
    }

    if (currentRankIndex === -1) {
      const nextRank = RANKS[0];
      return {
        rank: "Unranked",
        nextRank: nextRank.name,
        winsNeeded: nextRank.wins - wins,
        progress: (wins / nextRank.wins) * 100,
        color: "text-muted-foreground"
      };
    }

    const currentRank = RANKS[currentRankIndex];
    
    if (currentRankIndex === RANKS.length - 1) {
      return {
        rank: currentRank.name,
        nextRank: "Max",
        winsNeeded: 0,
        progress: 100,
        color: currentRank.color
      };
    }

    const nextRank = RANKS[currentRankIndex + 1];
    const prevWins = currentRank.wins;
    const nextWins = nextRank.wins;
    const progress = ((wins - prevWins) / (nextWins - prevWins)) * 100;

    return {
      rank: currentRank.name,
      nextRank: nextRank.name,
      winsNeeded: nextWins - wins,
      progress,
      color: currentRank.color
    };
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
          const rankInfo = getRankData(highestWins);
          
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
                {/* Rank & Progression Bar */}
                <div className="space-y-3">
                  <div className="flex justify-between items-end">
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-1">Lifetime Rank</p>
                      <div className={`font-display text-2xl font-bold flex items-center gap-2 ${rankInfo.color}`}>
                        <Star className="h-5 w-5 fill-current" />
                        {rankInfo.rank}
                      </div>
                    </div>
                    {rankInfo.winsNeeded > 0 && (
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Next Tier</p>
                        <p className="text-sm font-bold flex items-center justify-end gap-1">
                          {rankInfo.nextRank} <ChevronRight className="h-3 w-3" />
                        </p>
                      </div>
                    )}
                  </div>
                  
                  <div className="space-y-1">
                    <Progress value={rankInfo.progress} className="h-2.5 bg-muted" />
                    {rankInfo.winsNeeded > 0 ? (
                      <p className="text-xs text-right text-muted-foreground">
                        <span className="font-bold text-foreground">{rankInfo.winsNeeded}</span> wins to rank up
                      </p>
                    ) : (
                      <p className="text-xs text-right text-gem-gold font-bold">Max Rank Reached!</p>
                    )}
                  </div>
                </div>

                <div className="bg-muted/30 rounded-lg p-4 flex justify-between items-center border border-border/50">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Active Streak</p>
                    <div className="flex items-center gap-2">
                      <Flame className={`h-5 w-5 ${currentWins > 0 ? "text-gem-ruby" : "text-muted-foreground"}`} />
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
