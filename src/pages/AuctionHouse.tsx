import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { StarRating } from "@/components/cards/StarRating";
import { resolveCardVisuals, type CardData, type GemTierData } from "@/lib/cardVisuals";
import { Coins, Clock, Zap, ShoppingCart, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function AuctionHouse() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState("all");
  const [buyId, setBuyId] = useState<string | null>(null);
  const [buyPrice, setBuyPrice] = useState(0);

  const { data: profile } = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("coins, gems").eq("user_id", user!.id).single();
      return data;
    },
    enabled: !!user,
  });

  const { data: listings = [], isLoading } = useQuery({
    queryKey: ["auction-listings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("auction_listings")
        .select("*, player_cards(id, name, rating, gem_tier_id, gem_name, position1, position2, card_color_primary, card_color_secondary, card_glow_color, gem_tiers(name, color, sort_order, stars))")
        .eq("is_active", true)
        .is("bought_by", null)
        .gt("expires_at", new Date().toISOString())
        .order("listed_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 30000,
  });

  const { data: gemTiers = [] } = useQuery({
    queryKey: ["gem-tiers"],
    queryFn: async () => {
      const { data } = await supabase.from("gem_tiers").select("*").order("sort_order");
      return data ?? [];
    },
  });

  const { data: auctionConfig } = useQuery({
    queryKey: ["auction-config"],
    queryFn: async () => {
      const { data } = await supabase.from("rule_config").select("value").eq("key", "auction_config").single();
      return data?.value as any;
    },
  });

  const buyMut = useMutation({
    mutationFn: async (listingId: string) => {
      const { data, error } = await supabase.functions.invoke("buy-auction-card", { body: { listing_id: listingId } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["auction-listings"] });
      qc.invalidateQueries({ queryKey: ["profile"] });
      setBuyId(null);
      toast.success(`Card purchased! ${data.coins_remaining} coins remaining`);
    },
    onError: (e) => toast.error(e.message),
  });

  // Determine snipe threshold from config
  const snipeThreshold = auctionConfig?.min_price ? Math.round(auctionConfig.min_price * 0.5) : 150;

  const filtered = listings.filter((l: any) => {
    const card = l.player_cards;
    if (!card) return false;
    if (search && !card.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (tierFilter !== "all") {
      const tierName = card.gem_tiers?.name?.toLowerCase();
      if (tierName !== tierFilter.toLowerCase()) return false;
    }
    return true;
  });

  function timeRemaining(expiresAt: string) {
    const diff = new Date(expiresAt).getTime() - Date.now();
    if (diff <= 0) return "Expired";
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ${mins % 60}m`;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ShoppingCart className="h-6 w-6 text-primary" /> Auction House
        </h1>
        <div className="flex items-center gap-2">
          <Coins className="h-4 w-4 text-gem-gold" />
          <span className="font-mono font-bold">{profile?.coins ?? 0}</span>
        </div>
      </div>

      <div className="flex gap-3 flex-wrap">
        <Input placeholder="Search cards…" value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
        <Select value={tierFilter} onValueChange={setTierFilter}>
          <SelectTrigger className="w-40"><SelectValue placeholder="All Tiers" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Tiers</SelectItem>
            {gemTiers.map((t) => <SelectItem key={t.id} value={t.name.toLowerCase()}>{t.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">No listings available. Check back soon!</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((listing: any) => {
            const card = listing.player_cards;
            const gemTier = card.gem_tiers as GemTierData | null;
            const visuals = resolveCardVisuals(card as CardData, gemTier);
            const isHsl = (c: string) => /^\d+\s/.test(c);
            const bg = (c: string) => isHsl(c) ? `hsl(${c})` : c;
            const isSnipe = listing.price <= snipeThreshold;

            return (
              <Card key={listing.id} className="overflow-hidden relative group">
                {isSnipe && (
                  <Badge className="absolute top-2 right-2 z-10 bg-destructive text-destructive-foreground gap-1 animate-pulse">
                    <Zap className="h-3 w-3" /> SNIPE
                  </Badge>
                )}
                <div
                  className="h-24 flex items-center justify-center"
                  style={{
                    background: `linear-gradient(135deg, ${bg(visuals.primary)}, ${bg(visuals.secondary)})`,
                    boxShadow: `inset 0 -10px 20px -10px ${bg(visuals.glow)}40`,
                  }}
                >
                  <div className="text-center">
                    <p className="font-bold text-lg drop-shadow">{card.name}</p>
                    <StarRating rating={card.rating} glowColor={bg(visuals.glow)} size="sm" />
                  </div>
                </div>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      {gemTier?.name && <Badge variant="outline" className="text-xs">{gemTier.name}</Badge>}
                      {card.position1 && <Badge variant="secondary" className="text-xs">{card.position1}</Badge>}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {timeRemaining(listing.expires_at)}
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1">
                      <Coins className="h-4 w-4 text-gem-gold" />
                      <span className="font-bold font-mono text-lg">{listing.price.toLocaleString()}</span>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => { setBuyId(listing.id); setBuyPrice(listing.price); }}
                      disabled={(profile?.coins ?? 0) < listing.price}
                    >
                      Buy Now
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!buyId}
        onOpenChange={(o) => !o && setBuyId(null)}
        title="Confirm Purchase"
        description={`Buy this card for ${buyPrice.toLocaleString()} coins?`}
        onConfirm={() => buyId && buyMut.mutate(buyId)}
        loading={buyMut.isPending}
      />
    </div>
  );
}
