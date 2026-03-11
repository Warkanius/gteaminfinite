import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";
import type { GameCard } from "@/pages/Play";
import { fetchBadgesForCards, type CardBadge } from "@/lib/badgeEngine";

interface LineupSelectProps {
  onConfirm: (userLineup: GameCard[], cpuLineup: GameCard[], badgeMap: Record<string, CardBadge[]>) => void;
  dominationGameId?: string;
}

export function LineupSelect({ onConfirm, dominationGameId }: LineupSelectProps) {
  const { user } = useAuth();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const { data: collection = [], isLoading } = useQuery({
    queryKey: ["user-collection-play", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_collections")
        .select("*, player_cards(*)")
        .eq("user_id", user!.id);
      if (error) throw error;
      return (data ?? []).map((c: any) => c.player_cards).filter(Boolean) as GameCard[];
    },
  });

  // For non-domination: fetch all cards for random CPU
  const { data: allCards = [] } = useQuery({
    queryKey: ["all-player-cards"],
    enabled: !dominationGameId,
    queryFn: async () => {
      const { data } = await supabase.from("player_cards").select("*");
      return (data ?? []) as GameCard[];
    },
  });

  // For domination: fetch fixed CPU lineup
  const { data: domCpuLineup } = useQuery({
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

  const { data: gemTiers = [] } = useQuery({
    queryKey: ["gem-tiers"],
    queryFn: async () => {
      const { data } = await supabase.from("gem_tiers").select("*").order("sort_order");
      return data ?? [];
    },
  });

  const gemTierMap = useMemo(() => Object.fromEntries(gemTiers.map((g) => [g.id, g])), [gemTiers]);

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

  const handleStart = () => {
    let cpuLineup: GameCard[];
    if (dominationGameId && domCpuLineup && domCpuLineup.length > 0) {
      cpuLineup = domCpuLineup;
    } else {
      // Random CPU
      const pool = allCards.filter((c) => !selectedIds.has(c.id));
      const shuffled = [...pool].sort(() => Math.random() - 0.5);
      cpuLineup = shuffled.slice(0, 5);
    }
    onConfirm(selectedCards, cpuLineup);
  };

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
        <p className="text-lg">You need at least 5 cards to play</p>
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
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
        {collection.map((card) => (
          <div key={card.id} className="relative">
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
