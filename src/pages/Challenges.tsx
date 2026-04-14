import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trophy, Coins, Gem, Package, Target, CheckCircle2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function Challenges() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const { data: challenges = [], isLoading } = useQuery({
    queryKey: ["challenges"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("challenges")
        .select("*, opponent_team:teams!challenges_opponent_team_id_fkey(name), card_reward:player_cards!challenges_card_reward_id_fkey(name)")
        .order("sort_order");
      if (error) throw error;
      return data;
    },
  });

  const { data: completions = [] } = useQuery({
    queryKey: ["challenge-completions", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("challenge_completions")
        .select("challenge_id")
        .eq("user_id", user.id);
      if (error) throw error;
      return data.map((c: any) => c.challenge_id);
    },
    enabled: !!user,
  });

  const completedSet = new Set(completions);

  // Filter out expired challenges
  const now = new Date().toISOString();
  const activeChallenges = challenges.filter((c: any) => {
    if (c.expires_at && c.expires_at < now) return false;
    return true;
  });

  // Group by spotlight_group
  const spotlightGroups = activeChallenges.reduce((acc: Record<string, any[]>, c: any) => {
    const group = c.spotlight_group || "Other";
    if (!acc[group]) acc[group] = [];
    acc[group].push(c);
    return acc;
  }, {});

  const handlePlay = (c: any) => {
    navigate("/play/match", {
      state: {
        challengeId: c.id,
        challengeTeamId: c.opponent_team_id,
        opponentName: (c.opponent_team as any)?.name ?? "Challenge",
        coinReward: c.coin_reward,
        gemReward: c.gem_reward,
        packReward: c.pack_reward,
        cardRewardId: c.card_reward_id,
        winCondition: c.win_condition,
        winByAmount: c.win_by_amount,
        seriesLength: c.series_length,
        lineupRestrictions: c.lineup_restrictions,
      },
    });
  };

  const formatRestrictions = (restrictions: any) => {
    if (!restrictions) return null;
    const tags: string[] = [];
    if (restrictions.positions?.length) tags.push(`${restrictions.positions.join("/")} only`);
    if (restrictions.card_colors?.length) tags.push(`${restrictions.card_colors.join(", ")} cards`);
    if (restrictions.gem_tier_ids?.length) tags.push("Specific gem tiers");
    if (restrictions.badge_ids?.length) tags.push("Requires badges");
    if (restrictions.trait_ids?.length) tags.push("Requires traits");
    if (restrictions.team_ids?.length) tags.push("Specific teams");
    if (restrictions.collection_ids?.length) tags.push("Specific collection");
    if (restrictions.sub_collection_ids?.length) tags.push("Specific sub-collection");
    return tags;
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (activeChallenges.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="font-display text-3xl font-bold">Challenges</h1>
        <div className="text-center py-20 text-muted-foreground">
          <Target className="h-12 w-12 mx-auto mb-3 opacity-50" />
          <p className="text-lg">No challenges available yet</p>
          <p className="text-sm mt-1">Check back soon!</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-12">
      <div>
        <h1 className="font-display text-3xl font-bold">Challenges</h1>
        <p className="text-muted-foreground mt-1">Complete challenges to earn exclusive rewards.</p>
      </div>

      {Object.entries(spotlightGroups).map(([group, items]) => (
        <div key={group} className="space-y-3">
          <h2 className="text-lg font-semibold text-primary">{group}</h2>
          <div className="space-y-3">
            {(items as any[]).map((c: any) => {
              const restrictionTags = formatRestrictions(c.lineup_restrictions);
              const isCompleted = completedSet.has(c.id);
              const isLocked = isCompleted && !c.is_repeatable;
              return (
                <Card key={c.id} className={`border-border/50 bg-card ${isLocked ? "opacity-60" : ""}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 space-y-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold">{c.name}</h3>
                          {isCompleted && (
                            <Badge variant="secondary" className="text-[10px] gap-1">
                              <CheckCircle2 className="h-3 w-3" /> Completed
                            </Badge>
                          )}
                          <Badge variant="outline" className="text-[10px]">{c.challenge_type}</Badge>
                          {c.win_condition !== "win" && (
                            <Badge variant="secondary" className="text-[10px]">{c.win_condition}</Badge>
                          )}
                          {c.win_by_amount && (
                            <Badge variant="secondary" className="text-[10px]">Win by {c.win_by_amount}+</Badge>
                          )}
                          {c.expires_at && (
                            <Badge variant="outline" className="text-[10px] border-destructive/30 text-destructive">
                              Expires {new Date(c.expires_at).toLocaleDateString()}
                            </Badge>
                          )}
                        </div>
                        {c.description && <p className="text-sm text-muted-foreground">{c.description}</p>}
                        {(c.opponent_team as any)?.name && (
                          <p className="text-xs text-muted-foreground">vs. {(c.opponent_team as any).name}</p>
                        )}
                        {/* Restriction tags */}
                        {restrictionTags && restrictionTags.length > 0 && (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {restrictionTags.map((tag, i) => (
                              <Badge key={i} variant="outline" className="text-[10px] border-primary/30 text-primary">
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        )}
                        {/* Rewards */}
                        <div className="flex items-center gap-3 pt-1 flex-wrap">
                          {c.coin_reward > 0 && (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Coins className="h-3 w-3" /> {c.coin_reward}
                            </span>
                          )}
                          {c.gem_reward > 0 && (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Gem className="h-3 w-3" /> {c.gem_reward}
                            </span>
                          )}
                          {c.pack_reward && (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Package className="h-3 w-3" /> Pack
                            </span>
                          )}
                          {(c.card_reward as any)?.name && (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Trophy className="h-3 w-3" /> {(c.card_reward as any).name}
                            </span>
                          )}
                        </div>
                      </div>
                      <Button size="sm" className="shrink-0" onClick={() => handlePlay(c)} disabled={isLocked}>
                        {isLocked ? "Done" : "Play"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
