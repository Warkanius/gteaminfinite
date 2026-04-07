import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { KeyRound, Gift, Loader2, Package } from "lucide-react";
import { toast } from "sonner";
import { PackReveal } from "@/components/packs/PackReveal";

interface PendingPack {
  id: string;
  pack_id: string;
  source: string;
  pack_name: string;
}

export default function LockerCodes() {
  const { user } = useAuth();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [reward, setReward] = useState<{ type: string; description: string } | null>(null);
  const [pendingPacks, setPendingPacks] = useState<PendingPack[]>([]);
  const [loadingPacks, setLoadingPacks] = useState(false);

  // Pack reveal state
  const [revealCards, setRevealCards] = useState<any[] | null>(null);
  const [openingInventoryId, setOpeningInventoryId] = useState<string | null>(null);

  useEffect(() => {
    if (user) fetchPendingPacks();
  }, [user]);

  async function fetchPendingPacks() {
    if (!user) return;
    setLoadingPacks(true);
    const { data } = await supabase
      .from("user_pack_inventory")
      .select("id, pack_id, source, packs(name)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    setPendingPacks(
      (data || []).map((d: any) => ({
        id: d.id,
        pack_id: d.pack_id,
        source: d.source,
        pack_name: d.packs?.name ?? "Unknown Pack",
      }))
    );
    setLoadingPacks(false);
  }

  async function openInventoryPack(inventoryId: string) {
    setOpeningInventoryId(inventoryId);
    try {
      const { data, error } = await supabase.functions.invoke("open-pack", {
        body: { inventory_id: inventoryId },
      });
      if (error || data?.error) {
        toast.error(data?.error || error?.message || "Failed to open pack");
        setOpeningInventoryId(null);
        return;
      }
      setRevealCards(data.cards);
      // Remove from pending list
      setPendingPacks((prev) => prev.filter((p) => p.id !== inventoryId));
    } catch {
      toast.error("Failed to open pack");
      setOpeningInventoryId(null);
    }
  }

  async function handleRedeem() {
    if (!code.trim()) { toast.error("Enter a code"); return; }
    setLoading(true);
    setReward(null);
    try {
      const { data, error } = await supabase.functions.invoke("redeem-locker-code", {
        body: { code: code.trim().toUpperCase() },
      });
      if (error) throw error;
      if (data?.error) { toast.error(data.error); setLoading(false); return; }

      setReward({ type: data.reward_type, description: data.reward_description });
      toast.success("Code redeemed!");
      setCode("");

      // If it's a pack reward, immediately open it
      if (data.reward_type === "pack" && data.inventory_id) {
        await openInventoryPack(data.inventory_id);
      }
    } catch (e: any) {
      toast.error(e.message ?? "Failed to redeem");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <KeyRound className="h-6 w-6 text-primary" /> Locker Codes
      </h1>
      <Card>
        <CardHeader>
          <CardTitle>Enter a Code</CardTitle>
          <CardDescription>Redeem locker codes for coins, gems, cards, or packs.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="e.g. GTEAM-2024"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && handleRedeem()}
              className="font-mono text-lg tracking-wider uppercase"
              maxLength={30}
            />
            <Button onClick={handleRedeem} disabled={loading || !code.trim()} className="gap-1.5 shrink-0">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              Redeem
            </Button>
          </div>
        </CardContent>
      </Card>

      {reward && (
        <Card className="border-primary/50 bg-primary/5 animate-in fade-in-50 slide-in-from-bottom-4 duration-500">
          <CardContent className="flex items-center gap-4 py-6">
            <div className="h-14 w-14 rounded-full bg-primary/20 flex items-center justify-center">
              <Gift className="h-7 w-7 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground uppercase tracking-wider">Reward Unlocked</p>
              <p className="text-xl font-bold">{reward.description}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pending Packs Section */}
      {pendingPacks.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" /> Your Packs
          </h2>
          {pendingPacks.map((pp) => (
            <Card key={pp.id} className="border-border/50">
              <CardContent className="flex items-center justify-between py-4">
                <div>
                  <p className="font-semibold">{pp.pack_name}</p>
                  <p className="text-xs text-muted-foreground capitalize">From: {pp.source.replace("_", " ")}</p>
                </div>
                <Button
                  size="sm"
                  onClick={() => openInventoryPack(pp.id)}
                  disabled={openingInventoryId === pp.id}
                >
                  {openingInventoryId === pp.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Open"
                  )}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Pack Reveal Overlay */}
      {revealCards && revealCards.length > 0 && (
        <PackReveal
          cards={revealCards}
          onOpenAnother={() => {
            setRevealCards(null);
            setOpeningInventoryId(null);
          }}
          onClose={() => {
            setRevealCards(null);
            setOpeningInventoryId(null);
          }}
        />
      )}
    </div>
  );
}
