import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { RefreshCw, Save } from "lucide-react";
import { toast } from "sonner";

interface AuctionConfig {
  min_price: number;
  max_price: number;
  snipe_chance: number;
  snipe_discount_min: number;
  snipe_discount_max: number;
  listings_per_refresh: number;
  listing_duration_minutes: number;
  tier_weights: Record<string, number>;
}

const DEFAULT_CONFIG: AuctionConfig = {
  min_price: 200,
  max_price: 5000,
  snipe_chance: 10,
  snipe_discount_min: 15,
  snipe_discount_max: 40,
  listings_per_refresh: 5,
  listing_duration_minutes: 60,
  tier_weights: {},
};

export default function AdminAuction() {
  const qc = useQueryClient();
  const [config, setConfig] = useState<AuctionConfig>(DEFAULT_CONFIG);
  const [dirty, setDirty] = useState(false);

  const { data: configRow, isLoading: configLoading } = useQuery({
    queryKey: ["auction-config"],
    queryFn: async () => {
      const { data } = await supabase
        .from("rule_config")
        .select("*")
        .eq("key", "auction_config")
        .single();
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

  useEffect(() => {
    if (configRow?.value) {
      setConfig({ ...DEFAULT_CONFIG, ...(configRow.value as any) });
    }
  }, [configRow]);

  const saveMut = useMutation({
    mutationFn: async () => {
      if (configRow) {
        const { error } = await supabase
          .from("rule_config")
          .update({ value: config as any, updated_at: new Date().toISOString() })
          .eq("key", "auction_config");
        if (error) throw error;
      } else {
        const { error } = await supabase.from("rule_config").insert({
          key: "auction_config",
          value: config as any,
          description: "Auction House bot listing configuration",
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["auction-config"] });
      setDirty(false);
      toast.success("Auction config saved");
    },
    onError: (e) => toast.error(e.message),
  });

  const refreshMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("refresh-auction");
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Market refreshed: ${data?.generated ?? 0} new listings`);
    },
    onError: (e) => toast.error(e.message),
  });

  function update<K extends keyof AuctionConfig>(key: K, value: AuctionConfig[K]) {
    setConfig((c) => ({ ...c, [key]: value }));
    setDirty(true);
  }

  function updateTierWeight(tierName: string, value: number) {
    setConfig((c) => ({
      ...c,
      tier_weights: { ...c.tier_weights, [tierName]: value },
    }));
    setDirty(true);
  }

  if (configLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Auction House Settings</CardTitle>
          <CardDescription>
            Configure how the bot-generated marketplace behaves. Only cards from paid packs appear in listings.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-8">
          {/* Price Range */}
          <div className="bg-muted/30 p-4 rounded-lg border space-y-4">
            <h3 className="font-semibold text-sm">Pricing</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Min Price (coins)</Label>
                <Input
                  type="number"
                  min={1}
                  value={config.min_price}
                  onChange={(e) => update("min_price", Number(e.target.value) || 0)}
                />
              </div>
              <div className="space-y-1">
                <Label>Max Price (coins)</Label>
                <Input
                  type="number"
                  min={1}
                  value={config.max_price}
                  onChange={(e) => update("max_price", Number(e.target.value) || 0)}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Listings are priced using each card's Market Value (±30% variance), clamped to this range.
            </p>
          </div>

          {/* Snipe Settings */}
          <div className="bg-muted/30 p-4 rounded-lg border space-y-4">
            <h3 className="font-semibold text-sm">Snipe Settings</h3>
            <div className="space-y-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Snipe Likelihood</Label>
                  <span className="text-sm font-mono text-primary">{config.snipe_chance}%</span>
                </div>
                <Slider
                  value={[config.snipe_chance]}
                  onValueChange={([v]) => update("snipe_chance", v)}
                  min={0}
                  max={100}
                  step={1}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Snipe Discount Min (%)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={99}
                    value={config.snipe_discount_min}
                    onChange={(e) => update("snipe_discount_min", Number(e.target.value) || 15)}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Snipe Discount Max (%)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={99}
                    value={config.snipe_discount_max}
                    onChange={(e) => update("snipe_discount_max", Number(e.target.value) || 40)}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                A "snipe" listing is priced at {config.snipe_discount_min}–{config.snipe_discount_max}% of the card's market value.
              </p>
            </div>
          </div>

          {/* Refresh Settings */}
          <div className="bg-muted/30 p-4 rounded-lg border space-y-4">
            <h3 className="font-semibold text-sm">Refresh Cycle</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Listings Per Refresh</Label>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={config.listings_per_refresh}
                  onChange={(e) => update("listings_per_refresh", Number(e.target.value) || 5)}
                />
              </div>
              <div className="space-y-1">
                <Label>Listing Duration (minutes)</Label>
                <Input
                  type="number"
                  min={1}
                  value={config.listing_duration_minutes}
                  onChange={(e) => update("listing_duration_minutes", Number(e.target.value) || 60)}
                />
              </div>
            </div>
          </div>

          {/* Tier Weights */}
          {gemTiers.length > 0 && (
            <div className="bg-muted/30 p-4 rounded-lg border space-y-4">
              <h3 className="font-semibold text-sm">Tier Weights</h3>
              <p className="text-xs text-muted-foreground">
                Higher weight = that tier appears more often. Default is 1 for all tiers.
              </p>
              <div className="space-y-3">
                {gemTiers.map((tier) => {
                  const tierKey = tier.name.toLowerCase();
                  const weight = config.tier_weights[tierKey] ?? 1;
                  return (
                    <div key={tier.id} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <Label className="flex items-center gap-2">
                          <span
                            className="w-3 h-3 rounded-full inline-block"
                            style={{ backgroundColor: tier.color }}
                          />
                          {tier.name}
                        </Label>
                        <span className="text-sm font-mono text-primary">{weight}</span>
                      </div>
                      <Slider
                        value={[weight]}
                        onValueChange={([v]) => updateTierWeight(tierKey, v)}
                        min={0}
                        max={10}
                        step={0.5}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 justify-end">
            <Button
              variant="outline"
              onClick={() => refreshMut.mutate()}
              disabled={refreshMut.isPending}
              className="gap-1"
            >
              <RefreshCw className={`h-4 w-4 ${refreshMut.isPending ? "animate-spin" : ""}`} />
              Force Refresh Market
            </Button>
            <Button
              onClick={() => saveMut.mutate()}
              disabled={saveMut.isPending || !dirty}
              className="gap-1"
            >
              <Save className="h-4 w-4" />
              {dirty ? "Save Changes" : "Saved"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
