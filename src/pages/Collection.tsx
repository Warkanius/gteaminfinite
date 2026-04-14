import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { CardDetailDialog } from "@/components/cards/CardDetailDialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search } from "lucide-react";
import { toast } from "sonner";

export default function Collection() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState("all");
  const [posFilter, setPosFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"name" | "rating">("rating");
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

  // Fetch raw collection entries (includes is_locked, id per entry)
  const { data: rawCollection = [], isLoading } = useQuery({
    queryKey: ["user-collection", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_collections")
        .select("*, player_cards(*, player_card_badges(id))")
        .eq("user_id", user!.id);
      if (error) throw error;
      return data;
    },
  });

  const { data: gemTiers = [] } = useQuery({
    queryKey: ["gem-tiers"],
    queryFn: async () => {
      const { data } = await supabase.from("gem_tiers").select("*").order("sort_order");
      return data ?? [];
    },
  });

  const { data: teams = [] } = useQuery({
    queryKey: ["teams"],
    queryFn: async () => {
      const { data } = await supabase.from("teams").select("*");
      return data ?? [];
    },
  });

  // Total cards in the game
  const { data: totalCardsInGame = 0 } = useQuery({
    queryKey: ["total-player-cards"],
    queryFn: async () => {
      const { count } = await supabase.from("player_cards").select("id", { count: "exact", head: true });
      return count ?? 0;
    },
  });

  const gemTierMap = useMemo(() => Object.fromEntries(gemTiers.map((g: any) => [g.id, g])), [gemTiers]);
  const teamMap = useMemo(() => Object.fromEntries(teams.map((t: any) => [t.id, t.name])), [teams]);

  // Group by player_card_id for duplicate counting & dedup display
  const { groupedCards, duplicateMap, lockMap, collectionIdMap, sourceMap } = useMemo(() => {
    const dupMap: Record<string, number> = {};
    const lockMap: Record<string, boolean> = {};
    const colIdMap: Record<string, string> = {};
    const srcMap: Record<string, string> = {};

    for (const entry of rawCollection as any[]) {
      const pcId = entry.player_card_id;
      dupMap[pcId] = (dupMap[pcId] || 0) + 1;
      if (entry.is_locked) lockMap[pcId] = true;

      // For quicksell: prefer an unlocked standard_pack entry
      const currentBest = colIdMap[pcId];
      if (!currentBest) {
        colIdMap[pcId] = entry.id;
      } else {
        // Find the current best entry to compare
        const currentEntry = (rawCollection as any[]).find((e: any) => e.id === currentBest);
        const currentIsIdeal = currentEntry && !currentEntry.is_locked && currentEntry.source === "standard_pack";
        const newIsIdeal = !entry.is_locked && entry.source === "standard_pack";
        if (!currentIsIdeal && newIsIdeal) {
          colIdMap[pcId] = entry.id;
        } else if (!currentIsIdeal && !entry.is_locked && currentEntry?.is_locked) {
          colIdMap[pcId] = entry.id;
        }
      }

      if (!srcMap[pcId]) srcMap[pcId] = entry.source ?? "standard_pack";
      if (entry.source === "standard_pack") srcMap[pcId] = "standard_pack";
    }

    const seen = new Set<string>();
    const grouped: any[] = [];
    for (const entry of rawCollection as any[]) {
      const pc = entry.player_cards;
      if (!pc || seen.has(pc.id)) continue;
      seen.add(pc.id);
      grouped.push(pc);
    }

    return { groupedCards: grouped, duplicateMap: dupMap, lockMap, collectionIdMap: colIdMap, sourceMap: srcMap };
  }, [rawCollection]);

  // Filter & sort
  const cards = useMemo(() => {
    let items = [...groupedCards];
    if (search) {
      const q = search.toLowerCase();
      items = items.filter((c: any) => c.name.toLowerCase().includes(q) || (c.gem_name ?? "").toLowerCase().includes(q));
    }
    if (tierFilter !== "all") {
      items = items.filter((c: any) => c.gem_tier_id === tierFilter);
    }
    if (posFilter !== "all") {
      items = items.filter((c: any) => c.position1 === posFilter || c.position2 === posFilter);
    }
    items.sort((a: any, b: any) => sortBy === "rating" ? b.rating - a.rating : a.name.localeCompare(b.name));
    return items;
  }, [groupedCards, search, tierFilter, posFilter, sortBy]);

  // Stats
  const uniqueOwned = groupedCards.length;
  const completionPct = totalCardsInGame > 0 ? Math.round((uniqueOwned / totalCardsInGame) * 100) : 0;

  // Tier breakdown
  const tierBreakdown = useMemo(() => {
    return gemTiers.map((tier: any) => {
      const owned = groupedCards.filter((c: any) => c.gem_tier_id === tier.id).length;
      return { ...tier, owned };
    });
  }, [gemTiers, groupedCards]);

  // All player cards count per tier (for progress)
  const { data: tierTotals = {} } = useQuery({
    queryKey: ["tier-totals"],
    queryFn: async () => {
      const { data } = await supabase.from("player_cards").select("gem_tier_id");
      const counts: Record<string, number> = {};
      for (const row of data ?? []) {
        if (row.gem_tier_id) counts[row.gem_tier_id] = (counts[row.gem_tier_id] || 0) + 1;
      }
      return counts;
    },
  });

  // Selected card detail
  const selectedCard = cards.find((c: any) => c.id === selectedCardId) ?? null;

  const { data: selectedBadges = [] } = useQuery({
    queryKey: ["card-badges", selectedCardId],
    enabled: !!selectedCardId,
    queryFn: async () => {
      const { data } = await supabase
        .from("player_card_badges")
        .select("tier, badges(name)")
        .eq("player_card_id", selectedCardId!);
      return (data ?? []).map((d: any) => ({ name: d.badges?.name ?? "", tier: d.tier }));
    },
  });

  const { data: selectedTraits = [] } = useQuery({
    queryKey: ["card-traits", selectedCardId],
    enabled: !!selectedCardId,
    queryFn: async () => {
      const { data } = await supabase
        .from("player_card_traits")
        .select("tier, target_stat, signature_traits(name)")
        .eq("player_card_id", selectedCardId!);
      return (data ?? []).map((d: any) => ({ name: d.signature_traits?.name ?? "", tier: d.tier, target_stat: d.target_stat }));
    },
  });

  // Toggle lock
  const toggleLockMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCardId) return;
      // Find all collection entries for this card and toggle the first one's lock
      const entries = (rawCollection as any[]).filter((e) => e.player_card_id === selectedCardId);
      // Toggle: if any is locked, unlock all; otherwise lock all
      const anyLocked = entries.some((e: any) => e.is_locked);
      for (const entry of entries) {
        await supabase.from("user_collections").update({ is_locked: !anyLocked }).eq("id", entry.id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-collection"] });
    },
  });

  // Quicksell
  const quicksellMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCardId) throw new Error("No card selected");
      const collectionId = collectionIdMap[selectedCardId];
      if (!collectionId) throw new Error("No collection entry found");
      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke("quicksell-card", {
        body: { collection_id: collectionId },
      });
      if (res.error) throw new Error(res.error.message);
      return res.data;
    },
    onSuccess: (data: any) => {
      toast.success(`Sold for ${data.coin_value} coins! Balance: ${data.coins}`);
      queryClient.invalidateQueries({ queryKey: ["user-collection"] });
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      setSelectedCardId(null);
    },
    onError: (err: any) => {
      toast.error(err.message || "Quicksell failed");
    },
  });

  const POSITIONS = ["PG", "SG", "SF", "PF", "C"];
  const isHsl = (c: string) => /^\d+\s/.test(c);
  const bg = (c: string) => isHsl(c) ? `hsl(${c})` : c;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">My Collection</h1>

      {/* Stats Header */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-baseline gap-3">
          <span className="text-3xl font-bold text-primary">{completionPct}%</span>
          <span className="text-sm text-muted-foreground">
            {uniqueOwned} / {totalCardsInGame} unique cards
          </span>
        </div>
        <Progress value={completionPct} className="h-2" />

        {/* Tier breakdown */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 pt-1">
          {tierBreakdown.map((tier: any) => {
            const total = (tierTotals as Record<string, number>)[tier.id] || 0;
            const pct = total > 0 ? Math.round((tier.owned / total) * 100) : 0;
            return (
              <div key={tier.id} className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium" style={{ color: bg(tier.color) }}>{tier.name}</span>
                  <span className="text-muted-foreground">{tier.owned}/{total}</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${pct}%`, backgroundColor: bg(tier.color) }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search cards…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={tierFilter} onValueChange={setTierFilter}>
          <SelectTrigger className="w-36"><SelectValue placeholder="Gem Tier" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Tiers</SelectItem>
            {gemTiers.map((g: any) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={posFilter} onValueChange={setPosFilter}>
          <SelectTrigger className="w-28"><SelectValue placeholder="Position" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Pos</SelectItem>
            {POSITIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="rating">By Rating</SelectItem>
            <SelectItem value="name">By Name</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="flex justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : cards.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <p className="text-lg">No cards yet</p>
          <p className="text-sm mt-1">Open packs to start building your collection!</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {cards.map((card: any) => (
            <PlayerCard
              key={card.id}
              card={card}
              gemTier={gemTierMap[card.gem_tier_id]}
              badgeCount={card.player_card_badges?.length ?? 0}
              duplicateCount={duplicateMap[card.id] ?? 1}
              isLocked={!!lockMap[card.id]}
              onClick={() => setSelectedCardId(card.id)}
            />
          ))}
        </div>
      )}

      <CardDetailDialog
        open={!!selectedCardId}
        onOpenChange={(o) => !o && setSelectedCardId(null)}
        card={selectedCard}
        gemTier={selectedCard ? gemTierMap[selectedCard.gem_tier_id] : null}
        teamName={selectedCard ? teamMap[selectedCard.team_id] : undefined}
        badges={selectedBadges}
        traits={selectedTraits}
        duplicateCount={selectedCardId ? (duplicateMap[selectedCardId] ?? 1) : 1}
        isLocked={selectedCardId ? !!lockMap[selectedCardId] : false}
        canSell={selectedCardId ? (sourceMap[selectedCardId] === "standard_pack") : false}
        onToggleLock={() => toggleLockMutation.mutate()}
        onQuicksell={() => quicksellMutation.mutate()}
        quicksellLoading={quicksellMutation.isPending}
      />
    </div>
  );
}
