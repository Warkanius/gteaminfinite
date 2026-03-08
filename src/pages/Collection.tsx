import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { CardDetailDialog } from "@/components/cards/CardDetailDialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search } from "lucide-react";

export default function Collection() {
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState("all");
  const [posFilter, setPosFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"name" | "rating">("rating");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: collection = [], isLoading } = useQuery({
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

  const gemTierMap = useMemo(() => Object.fromEntries(gemTiers.map((g) => [g.id, g])), [gemTiers]);
  const teamMap = useMemo(() => Object.fromEntries(teams.map((t) => [t.id, t.name])), [teams]);

  const cards = useMemo(() => {
    let items = collection
      .map((c: any) => c.player_cards)
      .filter(Boolean);

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
  }, [collection, search, tierFilter, posFilter, sortBy]);

  // Detail dialog data
  const selectedCard = cards.find((c: any) => c.id === selectedId) ?? null;

  const { data: selectedBadges = [] } = useQuery({
    queryKey: ["card-badges", selectedId],
    enabled: !!selectedId,
    queryFn: async () => {
      const { data } = await supabase
        .from("player_card_badges")
        .select("tier, badges(name)")
        .eq("player_card_id", selectedId!);
      return (data ?? []).map((d: any) => ({ name: d.badges?.name ?? "", tier: d.tier }));
    },
  });

  const { data: selectedTraits = [] } = useQuery({
    queryKey: ["card-traits", selectedId],
    enabled: !!selectedId,
    queryFn: async () => {
      const { data } = await supabase
        .from("player_card_traits")
        .select("tier, target_stat, signature_traits(name)")
        .eq("player_card_id", selectedId!);
      return (data ?? []).map((d: any) => ({ name: d.signature_traits?.name ?? "", tier: d.tier, target_stat: d.target_stat }));
    },
  });

  const POSITIONS = ["PG", "SG", "SF", "PF", "C"];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">My Collection</h1>

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
            {gemTiers.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
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
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {cards.map((card: any) => (
            <PlayerCard
              key={card.id}
              card={card}
              gemTier={gemTierMap[card.gem_tier_id]}
              onClick={() => setSelectedId(card.id)}
            />
          ))}
        </div>
      )}

      <CardDetailDialog
        open={!!selectedId}
        onOpenChange={(o) => !o && setSelectedId(null)}
        card={selectedCard}
        gemTier={selectedCard ? gemTierMap[selectedCard.gem_tier_id] : null}
        teamName={selectedCard ? teamMap[selectedCard.team_id] : undefined}
        badges={selectedBadges}
        traits={selectedTraits}
      />
    </div>
  );
}
