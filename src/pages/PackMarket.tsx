import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PackCard } from "@/components/packs/PackCard";
import { PackReveal } from "@/components/packs/PackReveal";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";

interface Pack {
  id: string;
  name: string;
  pack_type: string;
  cost: number;
  ten_box_cost: number | null;
}

export default function PackMarket() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [packs, setPacks] = useState<Pack[]>([]);
  const [coins, setCoins] = useState(0);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [pulledCards, setPulledCards] = useState<any[] | null>(null);
  const [lastPackId, setLastPackId] = useState<string | null>(null);
  const [lastQty, setLastQty] = useState<1 | 10>(1);

  useEffect(() => {
    fetchData();
  }, [user]);

  async function fetchData() {
    if (!user) return;
    setLoading(true);
    const [packsRes, profileRes] = await Promise.all([
      supabase.from("packs").select("*").eq("pack_type", "standard").order("name"),
      supabase.from("profiles").select("coins").eq("user_id", user.id).single(),
    ]);
    setPacks(packsRes.data || []);
    setCoins(profileRes.data?.coins ?? 0);
    setLoading(false);
  }

  async function handleBuy(packId: string, quantity: 1 | 10) {
    setOpening(true);
    setLastPackId(packId);
    setLastQty(quantity);

    const { data, error } = await supabase.functions.invoke("open-pack", {
      body: { pack_id: packId, quantity },
    });

    if (error || data?.error) {
      toast({
        title: "Pack Error",
        description: data?.error || error?.message || "Failed to open pack",
        variant: "destructive",
      });
      setOpening(false);
      return;
    }

    setCoins(data.coins_remaining);
    setPulledCards(data.cards);
    setOpening(false);
  }

  function handleOpenAnother() {
    setPulledCards(null);
    if (lastPackId) handleBuy(lastPackId, lastQty);
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-bold text-foreground">Pack Market</h1>
        <div className="flex items-center gap-2 text-lg font-semibold">
          <span>🪙</span>
          <span className="text-foreground">{coins.toLocaleString()}</span>
        </div>
      </div>

      {packs.length === 0 ? (
        <p className="text-muted-foreground">No packs available yet.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {packs.map((pack) => (
            <PackCard
              key={pack.id}
              pack={pack}
              coins={coins}
              loading={opening}
              onBuy={handleBuy}
            />
          ))}
        </div>
      )}

      {/* Reveal overlay */}
      {pulledCards && pulledCards.length > 0 && (
        <PackReveal
          cards={pulledCards}
          onOpenAnother={handleOpenAnother}
          onClose={() => setPulledCards(null)}
        />
      )}
    </div>
  );
}
