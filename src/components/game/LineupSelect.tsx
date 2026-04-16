import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";
import type { GameCard } from "@/pages/Play";
import { fetchBadgesForCards, type CardBadge } from "@/lib/badgeEngine";
import { fetchTraitsForCards, type CardTrait } from "@/lib/traitEngine";
import { hslToColorBucket } from "@/lib/colorBucket";

interface LineupRestrictions {
  positions?: string[];
  badge_ids?: string[];
  trait_ids?: string[];
  gem_tier_ids?: string[];
  team_ids?: string[];
  collection_ids?: string[];
  sub_collection_ids?: string[];
  card_colors?: string[];
}

interface LineupSelectProps {
  onConfirm: (userLineup: GameCard[], cpuLineup: GameCard[], badgeMap: Record<string, CardBadge[]>, traitMap: Record<string, CardTrait[]>) => void;
  dominationGameId?: string;
  challengeTeamId?: string;
  lineupRestrictions?: LineupRestrictions;
}

export function LineupSelect({ onConfirm, dominationGameId, challengeTeamId, lineupRestrictions }: LineupSelectProps) {
  const { user } = useAuth();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Fetch user's full collection with player_cards joined
  const { data: rawCollection = [], isLoading } = useQuery({
    queryKey: ["user-collection-play", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_collections")
        .select("*, player_cards(*)")
        .eq("user_id", user!.id);
      if (error) throw error;
      return (data ?? []).map((c: any) => c.player_cards).filter(Boolean) as (GameCard & { team_id?: string; collection_id?: string; sub_collection_id?: string })[];
    },
  });

  // For non-domination, non-challenge: fetch all cards for random CPU
  const { data: allCards = [] } = useQuery({
    queryKey: ["all-player-cards"],
    enabled: !dominationGameId && !challengeTeamId,
    queryFn: async () => {
      const { data } = await supabase.from("player_cards").select("*");
      return (data ?? []) as GameCard[];
    },
  });

  // For domination: fetch fixed CPU lineup
  const { data: domCpuLineup, isLoading: domCpuLoading } = useQuery({
    queryKey: ["domination-cpu-lineup", dominationGameId],
    enabled: !!dominationGameId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("domination_game_players")
        .select("slot, player_cards(*)")
        .eq("domination_game_id", dominationGameId!)
        .order("slot");
      if (error) throw error;
      return (data ?? []).map((d: any) => d.player_cards).filter(Boolean) as GameCard[];
    },
  });

  // For challenge: fetch CPU from team_players
  const { data: challengeCpuLineup, isLoading: challengeCpuLoading } = useQuery({
    queryKey: ["challenge-cpu-lineup", challengeTeamId],
    enabled: !!challengeTeamId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("team_players")
        .select("slot, player_cards(*)")
        .eq("team_id", challengeTeamId!)
        .order("slot");
      if (error) throw error;
      return (data ?? []).map((d: any) => d.player_cards).filter(Boolean) as GameCard[];
    },
  });

  // Fetch badge/trait assignments for restriction filtering
  const { data: cardBadgeAssignments = [] } = useQuery({
    queryKey: ["card-badge-assignments-play"],
    enabled: !!(lineupRestrictions?.badge_ids?.length),
    queryFn: async () => {
      const { data } = await supabase.from("player_card_badges").select("player_card_id, badge_id");
      return data ?? [];
    },
  });

  const { data: cardTraitAssignments = [] } = useQuery({
    queryKey: ["card-trait-assignments-play"],
    enabled: !!(lineupRestrictions?.trait_ids?.length),
    queryFn: async () => {
      const { data } = await supabase.from("player_card_traits").select("player_card_id, trait_id");
      return data ?? [];
    },
  });

  const { data: gemTiers = [] } = useQuery({
    queryKey: ["gem-tiers"],
    queryFn: async () => {
      const { data } = await supabase.from("gem_tiers").select("*").order("sort_order");
      return data ?? [];
    },
  });

  const gemTierMap = useMemo(() => Object.fromEntries(gemTiers.map((g) => [g.id, g])), [gemTiers]);

  // Apply lineup restrictions to filter the collection
  const collection = useMemo(() => {
    if (!lineupRestrictions) return rawCollection;

    return rawCollection.filter((card: any) => {
      // Position filter
      if (lineupRestrictions.positions?.length) {
        const cardPositions = [card.position1, card.position2].filter(Boolean);
        if (!cardPositions.some((p: string) => lineupRestrictions.positions!.includes(p))) return false;
      }

      // Gem tier filter
      if (lineupRestrictions.gem_tier_ids?.length) {
        if (!card.gem_tier_id || !lineupRestrictions.gem_tier_ids.includes(card.gem_tier_id)) return false;
      }

      // Team filter
      if (lineupRestrictions.team_ids?.length) {
        if (!card.team_id || !lineupRestrictions.team_ids.includes(card.team_id)) return false;
      }

      // Collection filter
      if (lineupRestrictions.collection_ids?.length) {
        if (!card.collection_id || !lineupRestrictions.collection_ids.includes(card.collection_id)) return false;
      }

      // Sub-collection filter
      if (lineupRestrictions.sub_collection_ids?.length) {
        if (!card.sub_collection_id || !lineupRestrictions.sub_collection_ids.includes(card.sub_collection_id)) return false;
      }

      // Card color filter
      if (lineupRestrictions.card_colors?.length) {
        const bucket = hslToColorBucket(card.card_color_primary);
        if (!bucket || !lineupRestrictions.card_colors.includes(bucket)) return false;
      }

      // Badge filter
      if (lineupRestrictions.badge_ids?.length) {
        const cardBadgeIds = cardBadgeAssignments
          .filter((a: any) => a.player_card_id === card.id)
          .map((a: any) => a.badge_id);
        if (!lineupRestrictions.badge_ids.some((bid: string) => cardBadgeIds.includes(bid))) return false;
      }

      // Trait filter
      if (lineupRestrictions.trait_ids?.length) {
        const cardTraitIds = cardTraitAssignments
          .filter((a: any) => a.player_card_id === card.id)
          .map((a: any) => a.trait_id);
        if (!lineupRestrictions.trait_ids.some((tid: string) => cardTraitIds.includes(tid))) return false;
      }

      return true;
    });
  }, [rawCollection, lineupRestrictions, cardBadgeAssignments, cardTraitAssignments]);

  const toggleCard = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < 5) {
        next.add(id);
      }
      return next;
    });
  };

  const selectedCards = collection.filter((c) => selectedIds.has(c.id));

  const handleStart = async () => {
    let cpuCards: GameCard[];
    if (dominationGameId) {
      if (!domCpuLineup || domCpuLineup.length === 0) {
        toast.error("Opponent roster not ready — try again in a moment");
        return;
      }
      cpuCards = domCpuLineup;
    } else if (challengeTeamId) {
      if (!challengeCpuLineup || challengeCpuLineup.length === 0) {
        toast.error("Opponent roster not ready — try again in a moment");
        return;
      }
      cpuCards = challengeCpuLineup;
    } else {
      // Random CPU (only when not domination/challenge)
      const pool = allCards.filter((c) => !selectedIds.has(c.id));
      const shuffled = [...pool].sort(() => Math.random() - 0.5);
      cpuCards = shuffled.slice(0, 5);
    }
    // Fetch badges and traits for all 10 cards
    const allCardIds = [...selectedCards.map(c => c.id), ...cpuCards.map(c => c.id)];
    const [badgeMap, traitMap] = await Promise.all([
      fetchBadgesForCards(supabase, allCardIds),
      fetchTraitsForCards(supabase, allCardIds),
    ]);
    onConfirm(selectedCards, cpuCards, badgeMap, traitMap);
  };

  const opponentLoading =
    (!!dominationGameId && (domCpuLoading || domCpuLineup === undefined)) ||
    (!!challengeTeamId && (challengeCpuLoading || challengeCpuLineup === undefined));
  const startDisabled = selectedIds.size !== 5 || opponentLoading;

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (collection.length < 5) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        <p className="text-lg">
          {lineupRestrictions
            ? "You don't have enough eligible cards for this challenge"
            : "You need at least 5 cards to play"}
        </p>
        <p className="text-sm mt-1">Open packs to build your collection!</p>
      </div>
    );
  }

  // Domination game has no players assigned yet
  if (dominationGameId && domCpuLineup && domCpuLineup.length === 0) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        <p className="text-lg">This opponent's roster hasn't been set up yet</p>
        <p className="text-sm mt-1">Check back later!</p>
      </div>
    );
  }

  // Challenge team has no players
  if (challengeTeamId && challengeCpuLineup && challengeCpuLineup.length === 0) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        <p className="text-lg">This challenge team hasn't been set up yet</p>
        <p className="text-sm mt-1">Check back later!</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground">Select 5 cards for your lineup</p>

      {/* Selected bench */}
      <div className="flex gap-2 items-center min-h-[48px] flex-wrap">
        {Array.from({ length: 5 }, (_, i) => {
          const card = selectedCards[i];
          return card ? (
            <Badge
              key={card.id}
              variant="secondary"
              className="text-sm py-1 px-3 gap-1 cursor-pointer"
              onClick={() => toggleCard(card.id)}
            >
              {card.name}
              <X className="w-3 h-3" />
            </Badge>
          ) : (
            <div key={i} className="w-20 h-8 rounded-md border border-dashed border-border flex items-center justify-center text-xs text-muted-foreground">
              Slot {i + 1}
            </div>
          );
        })}
      </div>

      <Button onClick={handleStart} disabled={selectedIds.size !== 5} className="w-full sm:w-auto">
        Start Game ({selectedIds.size}/5)
      </Button>

      {/* Card grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {collection.map((card) => (
          <div key={card.id} className="relative w-full">
            <PlayerCard
              card={card}
              gemTier={gemTierMap[card.gem_tier_id ?? ""]}
              onClick={() => toggleCard(card.id)}
              className={selectedIds.has(card.id) ? "ring-2 ring-primary" : "opacity-80"}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
