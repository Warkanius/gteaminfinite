import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Lock, Star, Coins, Check, Swords, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";

interface DominationGame {
  id: string;
  road_name: string;
  game_order: number;
  opponent_name: string;
  difficulty_stars: number;
  coin_reward: number;
  pack_reward: string | null;
}

export default function Domination() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [selectedRoad, setSelectedRoad] = useState<string | null>(null);
  const [mode, setMode] = useState<"base" | "rttr">("base");

  const { data: games = [], isLoading } = useQuery({
    queryKey: ["domination-games"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("domination_games")
        .select("*")
        .order("game_order");
      if (error) throw error;
      return data as DominationGame[];
    },
  });

  const { data: wins = [] } = useQuery({
    queryKey: ["domination-wins", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("game_logs")
        .select("domination_game_id")
        .eq("user_id", user!.id)
        .eq("won", true)
        .eq("mode", "domination")
        .not("domination_game_id", "is", null);
      if (error) throw error;
      return (data ?? []).map((d) => d.domination_game_id).filter(Boolean) as string[];
    },
  });

  const { data: rttrProgress = [] } = useQuery({
    queryKey: ["rttr-progress", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_rttr_progress")
        .select("domination_game_id, wins")
        .eq("user_id", user!.id);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Identify which packs are RTTR so we can mark RTTR-eligible nodes
  const packIds = useMemo(
    () => Array.from(new Set(games.map((g) => g.pack_reward).filter(Boolean))) as string[],
    [games],
  );
  const { data: rttrPackIds = [] } = useQuery({
    queryKey: ["rttr-pack-ids", packIds.sort().join(",")],
    enabled: packIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("packs").select("id, pack_type").in("id", packIds);
      return (data ?? []).filter((p: any) => p.pack_type === "rttr").map((p: any) => p.id) as string[];
    },
  });
  const rttrPackSet = useMemo(() => new Set(rttrPackIds), [rttrPackIds]);
  const rttrWinMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rttrProgress as any[]) map.set(r.domination_game_id, r.wins || 0);
    return map;
  }, [rttrProgress]);

  const wonSet = useMemo(() => new Set(wins), [wins]);

  const roads = useMemo(() => {
    const map = new Map<string, DominationGame[]>();
    for (const g of games) {
      const list = map.get(g.road_name) ?? [];
      list.push(g);
      map.set(g.road_name, list);
    }
    return Array.from(map.entries());
  }, [games]);

  const isUnlocked = (road: DominationGame[], index: number) => {
    if (index === 0) return true;
    return wonSet.has(road[index - 1].id);
  };

  const handlePlay = (game: DominationGame, variant: "base" | "rttr", roadName: string) => {
    navigate("/play/match", {
      state: {
        dominationGameId: game.id,
        opponentName: game.opponent_name,
        coinReward: game.coin_reward,
        packReward: game.pack_reward,
        difficultyStars: game.difficulty_stars,
        dominationVariant: variant,
        roadName,
      },
    });
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-display">Domination</h1>
        <p className="text-muted-foreground text-sm mt-1">Choose your road and conquer each opponent in order.</p>
      </div>

      {/* Road selector */}
      {!selectedRoad && (
        <div className="grid gap-4 sm:grid-cols-2">
          {roads.map(([roadName, roadGames]) => {
            const completed = roadGames.filter((g) => wonSet.has(g.id)).length;
            const roadCompleted = completed === roadGames.length;
            const hasRttr = roadGames.some((g) => g.pack_reward && rttrPackSet.has(g.pack_reward));
            return (
              <Card
                key={roadName}
                className="cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => { setSelectedRoad(roadName); setMode("base"); }}
              >
                <CardContent className="p-6 space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="font-display text-lg font-bold">{roadName}</h2>
                    <Badge variant="secondary">{completed}/{roadGames.length}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {roadGames.map((g) => g.opponent_name).join(" → ")}
                  </p>
                  <div className="flex gap-1">
                    {roadGames.map((g) => (
                      <div
                        key={g.id}
                        className={cn(
                          "h-2 flex-1 rounded-full",
                          wonSet.has(g.id) ? "bg-primary" : "bg-muted"
                        )}
                      />
                    ))}
                  </div>
                  {roadCompleted && hasRttr && (
                    <Badge className="bg-primary/20 text-primary border-0 gap-1">
                      <Trophy className="h-3 w-3" /> Road to the Ring unlocked
                    </Badge>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Road detail */}
      {selectedRoad && (() => {
        const roadGames = roads.find(([name]) => name === selectedRoad)?.[1] ?? [];
        const roadCompleted = roadGames.length > 0 && roadGames.every((g) => wonSet.has(g.id));
        const rttrNodes = roadGames.filter((g) => g.pack_reward && rttrPackSet.has(g.pack_reward));
        const showRttrTab = roadCompleted && rttrNodes.length > 0;

        return (
          <div className="space-y-4">
            <Button variant="ghost" size="sm" onClick={() => setSelectedRoad(null)}>
              ← All Roads
            </Button>
            <h2 className="font-display text-xl font-bold">{selectedRoad}</h2>

            <Tabs value={mode} onValueChange={(v) => setMode(v as "base" | "rttr")}>
              <TabsList>
                <TabsTrigger value="base">Domination</TabsTrigger>
                <TabsTrigger value="rttr" disabled={!showRttrTab}>
                  <Trophy className="h-3.5 w-3.5 mr-1" />
                  Road to the Ring
                </TabsTrigger>
              </TabsList>

              <TabsContent value="base" className="mt-4">
                <div className="relative space-y-3">
                  <div className="absolute left-6 top-4 bottom-4 w-px bg-border" />
                  {roadGames.map((game, idx, arr) => {
                    const unlocked = isUnlocked(arr, idx);
                    const beaten = wonSet.has(game.id);
                    return (
                      <div key={game.id} className="relative flex items-start gap-4 pl-3">
                        <div
                          className={cn(
                            "relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2",
                            beaten
                              ? "border-primary bg-primary text-primary-foreground"
                              : unlocked
                              ? "border-primary bg-background"
                              : "border-muted bg-muted"
                          )}
                        >
                          {beaten ? <Check className="h-3.5 w-3.5" /> : unlocked ? <Swords className="h-3.5 w-3.5 text-primary" /> : <Lock className="h-3 w-3 text-muted-foreground" />}
                        </div>
                        <Card
                          className={cn(
                            "flex-1 transition-colors",
                            beaten && "border-primary/30 bg-primary/5",
                            unlocked && !beaten && "border-primary/50 hover:border-primary",
                            !unlocked && "opacity-50"
                          )}
                        >
                          <CardContent className="p-4 flex items-center justify-between gap-3">
                            <div className="space-y-1 min-w-0">
                              <p className="font-display font-bold truncate">{game.opponent_name}</p>
                              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                                <span className="flex items-center gap-0.5">
                                  {Array.from({ length: 5 }, (_, i) => (
                                    <Star key={i} className={cn("h-3 w-3", i < game.difficulty_stars ? "fill-primary text-primary" : "text-muted")} />
                                  ))}
                                </span>
                                <span className="flex items-center gap-1"><Coins className="h-3 w-3" />{game.coin_reward}</span>
                              </div>
                            </div>
                            {unlocked && !beaten && (
                              <Button size="sm" onClick={() => handlePlay(game, "base", selectedRoad)}>Play</Button>
                            )}
                            {beaten && <Badge className="bg-primary/20 text-primary border-0">Won</Badge>}
                          </CardContent>
                        </Card>
                      </div>
                    );
                  })}
                </div>
              </TabsContent>

              <TabsContent value="rttr" className="mt-4 space-y-3">
                <p className="text-sm text-muted-foreground">
                  Replay each RTTR opponent in order to chase pack rewards. Each replay must be earned in sequence.
                </p>
                {rttrNodes.map((game, idx) => {
                  // Sequential RTTR unlock: first node always available, later
                  // nodes require the prior RTTR node to have at least 1 replay win.
                  const prev = idx === 0 ? null : rttrNodes[idx - 1];
                  const unlocked = idx === 0 || (prev ? (rttrWinMap.get(prev.id) ?? 0) > 0 : true);
                  const replayWins = rttrWinMap.get(game.id) ?? 0;
                  return (
                    <Card
                      key={game.id}
                      className={cn(
                        "transition-colors",
                        unlocked ? "border-primary/40 hover:border-primary" : "opacity-50"
                      )}
                    >
                      <CardContent className="p-4 flex items-center justify-between gap-3">
                        <div className="space-y-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <Trophy className="h-4 w-4 text-primary shrink-0" />
                            <p className="font-display font-bold truncate">{game.opponent_name}</p>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1"><Coins className="h-3 w-3" />{game.coin_reward}</span>
                            <span>RTTR replays: {replayWins}</span>
                          </div>
                        </div>
                        {unlocked ? (
                          <Button size="sm" onClick={() => handlePlay(game, "rttr", selectedRoad)}>Replay</Button>
                        ) : (
                          <Lock className="h-4 w-4 text-muted-foreground" />
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </TabsContent>
            </Tabs>
          </div>
        );
      })()}
    </div>
  );
}
