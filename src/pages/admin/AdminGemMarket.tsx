import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { PlayerCombobox } from "@/components/admin/PlayerCombobox";
import { X, Plus, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";

type PlayerCard = Tables<"player_cards">;
type GemTier = Tables<"gem_tiers">;

const RECOMMENDED_MAX = 10;

export default function AdminGemMarket() {
  const qc = useQueryClient();
  const [addingTierId, setAddingTierId] = useState<string | null>(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [gemNameInput, setGemNameInput] = useState("");

  const { data: tiers = [] } = useQuery({
    queryKey: ["gem-tiers"],
    queryFn: async () => {
      const { data } = await supabase.from("gem_tiers").select("*").order("sort_order");
      return data ?? [];
    },
  });

  const { data: players = [] } = useQuery({
    queryKey: ["admin-players"],
    queryFn: async () => {
      const { data } = await supabase.from("player_cards").select("*").order("name");
      return data ?? [];
    },
  });

  const playersByTier = (tierId: string) =>
    players.filter((p) => p.gem_tier_id === tierId);

  const unassignedPlayers = players.filter(
    (p) => !p.gem_tier_id
  );

  const assignMut = useMutation({
    mutationFn: async ({ playerId, tierId, gemName }: { playerId: string; tierId: string; gemName: string }) => {
      const { error } = await supabase
        .from("player_cards")
        .update({ gem_tier_id: tierId, gem_name: gemName || null })
        .eq("id", playerId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-players"] });
      setAddingTierId(null);
      setSelectedPlayerId("");
      setGemNameInput("");
      toast.success("Player added to tier");
    },
    onError: (e) => toast.error(e.message),
  });

  const removeMut = useMutation({
    mutationFn: async (playerId: string) => {
      const { error } = await supabase
        .from("player_cards")
        .update({ gem_tier_id: null, gem_name: null })
        .eq("id", playerId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-players"] });
      toast.success("Player removed from tier");
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Gem Market Manager</CardTitle>
          <CardDescription>
            Manage which players appear in each gem tier. Recommended max {RECOMMENDED_MAX} players per tier.
          </CardDescription>
        </CardHeader>
      </Card>

      {tiers.map((tier) => {
        const tierPlayers = playersByTier(tier.id);
        const isOver = tierPlayers.length > RECOMMENDED_MAX;
        const isAdding = addingTierId === tier.id;

        return (
          <Card key={tier.id}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className="h-4 w-4 rounded-full border"
                    style={{ backgroundColor: tier.color }}
                  />
                  <CardTitle className="text-base">
                    {"⭐".repeat(tier.stars)} {tier.name}
                  </CardTitle>
                  <Badge variant={isOver ? "destructive" : "secondary"} className="text-xs">
                    {tierPlayers.length}/{RECOMMENDED_MAX}
                  </Badge>
                  {isOver && (
                    <AlertTriangle className="h-4 w-4 text-destructive" />
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setAddingTierId(isAdding ? null : tier.id);
                    setSelectedPlayerId("");
                    setGemNameInput("");
                  }}
                  className="gap-1"
                >
                  <Plus className="h-3 w-3" />
                  Add Player
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {isAdding && (
                <div className="flex flex-col sm:flex-row gap-2 p-3 rounded-lg border border-primary/30 bg-primary/5">
                  <div className="flex-1">
                    <Label className="text-xs">Player</Label>
                    <PlayerCombobox
                      players={unassignedPlayers.map((p) => ({ id: p.id, name: `${p.name} (${p.rating} OVR)` }))}
                      value={selectedPlayerId}
                      onValueChange={setSelectedPlayerId}
                      placeholder="Select unassigned player…"
                    />
                  </div>
                  <div className="w-full sm:w-40">
                    <Label className="text-xs">Gem Name</Label>
                    <Input
                      value={gemNameInput}
                      onChange={(e) => setGemNameInput(e.target.value)}
                      placeholder="e.g. Fire Opal"
                    />
                  </div>
                  <div className="flex items-end">
                    <Button
                      size="sm"
                      disabled={!selectedPlayerId || assignMut.isPending}
                      onClick={() =>
                        assignMut.mutate({
                          playerId: selectedPlayerId,
                          tierId: tier.id,
                          gemName: gemNameInput,
                        })
                      }
                    >
                      Add
                    </Button>
                  </div>
                </div>
              )}

              {tierPlayers.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">No players in this tier.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {tierPlayers.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between p-2 rounded-md border bg-card"
                    >
                      <div className="min-w-0">
                        <span className="font-medium text-sm truncate block">{p.name}</span>
                        {p.gem_name && (
                          <span className="text-xs text-muted-foreground italic">{p.gem_name}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Badge variant="outline" className="text-xs">{p.rating} OVR</Badge>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => removeMut.mutate(p.id)}
                          disabled={removeMut.isPending}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
