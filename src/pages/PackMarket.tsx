import { useEffect, useState, useCallback } from "react";
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

  // Sequential 10-box state
  const [multiPackQueue, setMultiPackQueue] = useState<number>(0); // total packs in sequence
  const [multiPackIndex, setMultiPackIndex] = useState<number>(0); // current pack (1-based)

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

  const openSinglePack = useCallback(async (packId: string): Promise<any[] | null> => {
    const { data, error } = await supabase.functions.invoke("open-pack", {
      body: { pack_id: packId },
    });

    if (error || data?.error) {
      toast({
        title: "Pack Error",
        description: data?.error || error?.message || "Failed to open pack",
        variant: "destructive",
      });
      return null;
    }

    setCoins(data.coins_remaining);
    return data.cards;
  }, [toast]);

  async function handleBuy(packId: string, quantity: 1 | 10) {
    setOpening(true);
    setLastPackId(packId);

    if (quantity === 10) {
      // Sequential 10-box: open first pack, set up queue
      setMultiPackQueue(10);
      setMultiPackIndex(1);
      const cards = await openSinglePack(packId);
      if (cards) {
        setPulledCards(cards);
      } else {
        setMultiPackQueue(0);
        setMultiPackIndex(0);
      }
    } else {
      setMultiPackQueue(0);
      setMultiPackIndex(0);
      const cards = await openSinglePack(packId);
      if (cards) {
        setPulledCards(cards);
      }
    }

    setOpening(false);
  }

  async function handleNextPack() {
    if (!lastPackId || multiPackIndex >= multiPackQueue) return;
    setOpening(true);
    const nextIndex = multiPackIndex + 1;
    setMultiPackIndex(nextIndex);
    setPulledCards(null);

    const cards = await openSinglePack(lastPackId);
    if (cards) {
      setPulledCards(cards);
    } else {
      // Error — stop the sequence
      setMultiPackQueue(0);
      setMultiPackIndex(0);
    }
    setOpening(false);
  }

  function handleOpenAnother() {
    setPulledCards(null);
    setMultiPackQueue(0);
    setMultiPackIndex(0);
    if (lastPackId) handleBuy(lastPackId, 1);
  }

  function handleClose() {
    setPulledCards(null);
    setMultiPackQueue(0);
    setMultiPackIndex(0);
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
          onClose={handleClose}
          packProgress={multiPackQueue > 1 ? { current: multiPackIndex, total: multiPackQueue } : null}
          onNextPack={handleNextPack}
        />
      )}
    </div>
  );
}
