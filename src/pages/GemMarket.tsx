import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Lock, Gem, Check } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

interface GemTier {
  id: string;
  name: string;
  color: string;
  gem_value: number;
  sort_order: number;
  stars: number;
}

interface PlayerCard {
  id: string;
  name: string;
  rating: number;
  position1: string | null;
  position2: string | null;
  gem_tier_id: string | null;
  gem_name: string | null;
}

export default function GemMarket() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [tiers, setTiers] = useState<GemTier[]>([]);
  const [cardsByTier, setCardsByTier] = useState<Record<string, PlayerCard[]>>({});
  const [ownedCardIds, setOwnedCardIds] = useState<Set<string>>(new Set());
  const [gems, setGems] = useState(0);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState(false);
  const [confirmCard, setConfirmCard] = useState<PlayerCard | null>(null);
  const [confirmTier, setConfirmTier] = useState<GemTier | null>(null);

  useEffect(() => {
    if (user) fetchAll();
  }, [user]);

  async function fetchAll() {
    setLoading(true);
    const [tiersRes, cardsRes, collRes, profileRes] = await Promise.all([
      supabase.from("gem_tiers").select("*").order("sort_order"),
      supabase.from("player_cards").select("id, name, rating, position1, position2, gem_tier_id, gem_name").not("gem_tier_id", "is", null),
      supabase.from("user_collections").select("player_card_id").eq("user_id", user!.id),
      supabase.from("profiles").select("gems").eq("user_id", user!.id).single(),
    ]);

    setTiers(tiersRes.data || []);
    setGems(profileRes.data?.gems ?? 0);
    setOwnedCardIds(new Set((collRes.data || []).map((c) => c.player_card_id)));

    const grouped: Record<string, PlayerCard[]> = {};
    for (const card of cardsRes.data || []) {
      if (!card.gem_tier_id) continue;
      if (!grouped[card.gem_tier_id]) grouped[card.gem_tier_id] = [];
      grouped[card.gem_tier_id].push(card);
    }
    // Sort each tier's cards by rating desc
    for (const key in grouped) {
      grouped[key].sort((a, b) => b.rating - a.rating);
    }
    setCardsByTier(grouped);
    setLoading(false);
  }

  function isTierUnlocked(tier: GemTier, tierIndex: number): boolean {
    if (tierIndex === 0) return true;
    const prevTier = tiers[tierIndex - 1];
    const prevCards = cardsByTier[prevTier.id] || [];
    if (prevCards.length === 0) return true;
    const ownedInPrev = prevCards.filter((c) => ownedCardIds.has(c.id)).length;
    return ownedInPrev >= Math.ceil(prevCards.length / 2);
  }

  function getTierProgress(tierIndex: number): { owned: number; total: number; required: number } {
    const tier = tiers[tierIndex];
    const cards = cardsByTier[tier.id] || [];
    const owned = cards.filter((c) => ownedCardIds.has(c.id)).length;
    return { owned, total: cards.length, required: Math.ceil(cards.length / 2) };
  }

  async function handleBuy() {
    if (!confirmCard || !confirmTier) return;
    setBuying(true);
    try {
      const { data, error } = await supabase.functions.invoke("buy-gem-card", {
        body: { player_card_id: confirmCard.id },
      });
      if (error || data?.error) {
        toast({ title: "Purchase Failed", description: data?.error || error?.message, variant: "destructive" });
      } else {
        toast({ title: "Card Acquired!", description: `${confirmCard.name} added to your collection` });
        setGems(data.remaining_gems);
        setOwnedCardIds((prev) => new Set([...prev, confirmCard.id]));
      }
    } catch {
      toast({ title: "Error", description: "Something went wrong", variant: "destructive" });
    }
    setBuying(false);
    setConfirmCard(null);
    setConfirmTier(null);
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-40 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-wider">Gem Market</h1>
          <p className="text-muted-foreground mt-1">Purchase player cards with gems</p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2">
          <Gem className="h-5 w-5 text-gem-amethyst" />
          <span className="font-display text-xl font-bold">{gems.toLocaleString()}</span>
        </div>
      </div>

      {tiers.map((tier, idx) => {
        const unlocked = isTierUnlocked(tier, idx);
        const cards = cardsByTier[tier.id] || [];
        const progress = getTierProgress(idx);
        const nextTierExists = idx < tiers.length - 1;

        return (
          <div key={tier.id} className={`space-y-4 ${!unlocked ? "opacity-50" : ""}`}>
            <div className="flex items-center gap-3">
              {!unlocked && <Lock className="h-5 w-5 text-muted-foreground" />}
              <h2 className="font-display text-xl font-bold" style={{ color: tier.color }}>
                {tier.name}
              </h2>
              <Badge variant="outline" className="text-xs">
                {tier.gem_value} <Gem className="h-3 w-3 ml-1 inline" />
              </Badge>
              <span className="text-sm text-muted-foreground ml-auto">
                {progress.owned}/{progress.total} owned
              </span>
            </div>

            {nextTierExists && (
              <div className="space-y-1">
                <Progress
                  value={progress.total > 0 ? (progress.owned / progress.required) * 100 : 0}
                  className="h-2"
                />
                <p className="text-xs text-muted-foreground">
                  Own {progress.required} to unlock next tier ({progress.owned}/{progress.required})
                </p>
              </div>
            )}

            {!unlocked ? (
              <Card className="border-border/30 bg-card/50">
                <CardContent className="py-8 text-center">
                  <Lock className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                  <p className="text-muted-foreground">
                    Own at least half the cards from the previous tier to unlock
                  </p>
                </CardContent>
              </Card>
            ) : cards.length === 0 ? (
              <Card className="border-border/30 bg-card/50">
                <CardContent className="py-8 text-center">
                  <p className="text-muted-foreground">No cards in this tier yet</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {cards.map((card) => {
                  const isOwned = ownedCardIds.has(card.id);
                  return (
                    <Card
                      key={card.id}
                      className={`border-border/50 bg-card transition-colors ${isOwned ? "border-gem-emerald/30" : "hover:bg-accent/20"}`}
                    >
                      <CardHeader className="pb-2">
                        <div className="flex items-center justify-between">
                          <CardTitle className="font-display text-base">{card.name}</CardTitle>
                          {isOwned && <Check className="h-4 w-4 text-gem-emerald" />}
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        {card.gem_name && (
                          <p className="text-xs text-muted-foreground italic">{card.gem_name}</p>
                        )}
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <span>{card.rating} OVR</span>
                          {card.position1 && <span>• {card.position1}</span>}
                          {card.position2 && <span>/ {card.position2}</span>}
                        </div>
                        <Button
                          size="sm"
                          className="w-full"
                          disabled={isOwned || gems < tier.gem_value}
                          onClick={() => {
                            setConfirmCard(card);
                            setConfirmTier(tier);
                          }}
                        >
                          {isOwned ? "Owned" : `${tier.gem_value} Gems`}
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      <Dialog open={!!confirmCard} onOpenChange={() => { setConfirmCard(null); setConfirmTier(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-display">Confirm Purchase</DialogTitle>
            <DialogDescription>
              Buy <strong>{confirmCard?.gem_name || confirmCard?.name}</strong> for{" "}
              <strong>{confirmTier?.gem_value} gems</strong>?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmCard(null)}>Cancel</Button>
            <Button onClick={handleBuy} disabled={buying}>
              {buying ? "Purchasing..." : "Buy Now"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
