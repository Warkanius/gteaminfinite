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

  // Evo chain links: every evolved card id -> its base (root) card id.
  // Used so an evolved variant inherits its base card's collection/team/tier/color
  // when checking lineup restrictions.
  const { data: evoLinks = [] } = useQuery({
    queryKey: ["evo-links-lineup"],
    enabled: !!lineupRestrictions,
    queryFn: async () => {
      const { data } = await supabase
        .from("evo_paths")
        .select("player_card_id, evolves_to_card_id")
        .not("evolves_to_card_id", "is", null);
      return data ?? [];
    },
  });

  const chainRootOf = useMemo(() => {
    // Walk evolved -> parent links until we reach a card that isn't an evolution target.
    const parentOf = new Map<string, string>();
    for (const link of evoLinks as any[]) {
      const from = link.player_card_id as string;
      const to = link.evolves_to_card_id as string;
      if (!from || !to || from === to) continue;
      parentOf.set(to, from);
    }
    const rootOf = new Map<string, string>();
    for (const evolvedId of parentOf.keys()) {
      let cur = evolvedId;
      const seen = new Set<string>([cur]);
      while (parentOf.has(cur)) {
        const next = parentOf.get(cur)!;
        if (seen.has(next)) break; // cycle guard
        seen.add(next);
        cur = next;
      }
      rootOf.set(evolvedId, cur);
    }
    return rootOf;
  }, [evoLinks]);

  // Fetch any root cards that aren't already in the user's collection so we can
  // read their collection_id / sub_collection_id / team_id / gem_tier_id / card_color_primary.
  const missingRootIds = useMemo(() => {
    if (!lineupRestrictions) return [] as string[];
    const have = new Set((rawCollection as any[]).map((c) => c.id));
    const need = new Set<string>();
    for (const card of rawCollection as any[]) {
      const root = chainRootOf.get(card.id);
      if (root && !have.has(root)) need.add(root);
    }
    return Array.from(need);
  }, [rawCollection, chainRootOf, lineupRestrictions]);

  const { data: rootCards = [] } = useQuery({
    queryKey: ["evo-root-cards-lineup", missingRootIds.sort().join(",")],
    enabled: missingRootIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from("player_cards")
        .select("id, collection_id, sub_collection_id, team_id, gem_tier_id, card_color_primary")
        .in("id", missingRootIds);
      return data ?? [];
    },
  });

  const cardById = useMemo(() => {
    const map: Record<string, any> = {};
    for (const c of rawCollection as any[]) map[c.id] = c;
    for (const c of rootCards as any[]) if (!map[c.id]) map[c.id] = c;
    return map;
  }, [rawCollection, rootCards]);

  // Resolve a card to its chain-root version for inherited-property checks.
  const resolveRoot = (card: any) => {
    const rootId = chainRootOf.get(card.id);
    if (!rootId) return card;
    return cardById[rootId] ?? card;
  };

  // Apply lineup restrictions to filter the collection.
  // A card qualifies if it matches AT LEAST ONE of the active restriction categories (OR logic).
  const collection = useMemo(() => {
    if (!lineupRestrictions) return rawCollection;

    const activeChecks: Array<(card: any) => boolean> = [];

    if (lineupRestrictions.positions?.length) {
      activeChecks.push((card) => {
        const cardPositions = [card.position1, card.position2].filter(Boolean);
        return cardPositions.some((p: string) => lineupRestrictions.positions!.includes(p));
      });
    }
    if (lineupRestrictions.gem_tier_ids?.length) {
      activeChecks.push((card) => {
        const root = resolveRoot(card);
        return !!root.gem_tier_id && lineupRestrictions.gem_tier_ids!.includes(root.gem_tier_id);
      });
    }
    if (lineupRestrictions.team_ids?.length) {
      activeChecks.push((card) => {
        const root = resolveRoot(card);
        return !!root.team_id && lineupRestrictions.team_ids!.includes(root.team_id);
      });
    }
    if (lineupRestrictions.collection_ids?.length) {
      activeChecks.push((card) => {
        const root = resolveRoot(card);
        return !!root.collection_id && lineupRestrictions.collection_ids!.includes(root.collection_id);
      });
    }
    if (lineupRestrictions.sub_collection_ids?.length) {
      activeChecks.push((card) => {
        const root = resolveRoot(card);
        return !!root.sub_collection_id && lineupRestrictions.sub_collection_ids!.includes(root.sub_collection_id);
      });
    }
    if (lineupRestrictions.card_colors?.length) {
      activeChecks.push((card) => {
        const root = resolveRoot(card);
        const bucket = hslToColorBucket(root.card_color_primary);
        return !!bucket && lineupRestrictions.card_colors!.includes(bucket);
      });
    }
    if (lineupRestrictions.badge_ids?.length) {
      activeChecks.push((card) => {
        const cardBadgeIds = cardBadgeAssignments
          .filter((a: any) => a.player_card_id === card.id)
          .map((a: any) => a.badge_id);
        return lineupRestrictions.badge_ids!.some((bid: string) => cardBadgeIds.includes(bid));
      });
    }
    if (lineupRestrictions.trait_ids?.length) {
      activeChecks.push((card) => {
        const cardTraitIds = cardTraitAssignments
          .filter((a: any) => a.player_card_id === card.id)
          .map((a: any) => a.trait_id);
        return lineupRestrictions.trait_ids!.some((tid: string) => cardTraitIds.includes(tid));
      });
    }

    if (activeChecks.length === 0) return rawCollection;

    return rawCollection.filter((card: any) => activeChecks.some((check) => check(card)));
  }, [rawCollection, lineupRestrictions, cardBadgeAssignments, cardTraitAssignments, chainRootOf, cardById]);

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

      <div className="flex items-center gap-3 flex-wrap">
        <Button onClick={handleStart} disabled={startDisabled} className="w-full sm:w-auto">
          Start Game ({selectedIds.size}/5)
        </Button>
        {opponentLoading && (
          <span className="text-sm text-muted-foreground">Loading opponent…</span>
        )}
      </div>

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
