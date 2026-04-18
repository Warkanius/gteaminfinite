import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { computeOVR } from "@/lib/ovrUtils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormDialog } from "@/components/admin/FormDialog";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { Plus, Trash2, Pencil, X, Gift, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export default function AdminStarterPacks() {
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [packName, setPackName] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [managingPack, setManagingPack] = useState<{ id: string; name: string } | null>(null);
  const [slotPlayer, setSlotPlayer] = useState("");

  const { data: starterPacks = [], isLoading } = useQuery({
    queryKey: ["admin-starter-packs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("packs")
        .select("*")
        .eq("pack_type", "starter")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: playerCards = [] } = useQuery({
    queryKey: ["player-cards-list"],
    queryFn: async () => {
      const { data } = await supabase
        .from("player_cards")
        .select("id, name, rating, position1, stat_3pt, stat_mid, stat_fin, stat_dnk, stat_stl, stat_blk, stat_ast, stat_reb, stat_int")
        .order("name");
      return data ?? [];
    },
  });

  // Cards that are evo targets — exclude from starter pack picker
  const { data: evoTargetIds = new Set<string>() } = useQuery({
    queryKey: ["evo-target-ids"],
    queryFn: async () => {
      const { data } = await supabase
        .from("evo_paths")
        .select("evolves_to_card_id")
        .not("evolves_to_card_id", "is", null);
      return new Set((data ?? []).map((r: any) => r.evolves_to_card_id as string));
    },
  });

  const { data: packPlayers = [], refetch: refetchPlayers } = useQuery({
    queryKey: ["starter-pack-players", managingPack?.id],
    enabled: !!managingPack,
    queryFn: async () => {
      const { data } = await supabase
        .from("pack_players")
        .select("*")
        .eq("pack_id", managingPack!.id)
        .order("slot_number");
      return data ?? [];
    },
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = { name: packName, pack_type: "starter" as const, cost: 0, ten_box_cost: null };
      if (editId) {
        const { error } = await supabase.from("packs").update(payload).eq("id", editId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("packs").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-starter-packs"] });
      setDialogOpen(false);
      toast.success("Saved");
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from("pack_players").delete().eq("pack_id", id);
      const { error } = await supabase.from("packs").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-starter-packs"] });
      setDeleteId(null);
      toast.success("Deleted");
    },
    onError: (e) => toast.error(e.message),
  });

  const addPlayerMut = useMutation({
    mutationFn: async (playerCardId: string) => {
      // Auto-assign next slot number from DB
      const { data: existing } = await supabase
        .from("pack_players")
        .select("slot_number")
        .eq("pack_id", managingPack!.id)
        .order("slot_number", { ascending: false })
        .limit(1);
      const nextSlot = existing && existing.length > 0 ? existing[0].slot_number + 1 : 1;
      const { error } = await supabase.from("pack_players").insert({
        pack_id: managingPack!.id,
        player_card_id: playerCardId,
        slot_number: nextSlot,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      refetchPlayers();
      setSlotPlayer("");
    },
    onError: (e) => toast.error(e.message),
  });

  const removePlayerMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("pack_players").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => refetchPlayers(),
  });

  const assignedIds = new Set(packPlayers.map((pp) => pp.player_card_id));
  const availablePlayers = playerCards.filter((p) => !assignedIds.has(p.id) && !evoTargetIds.has(p.id));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2">
            <Gift className="h-5 w-5 text-gem-gold" />
            Starter Packs Manager
          </CardTitle>
          <CardDescription>
            Create starter packs that new players choose from when they first log in. Each pack contains a fixed set of player cards.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            onClick={() => {
              setPackName("");
              setEditId(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-1" /> Add Starter Pack
          </Button>

          {isLoading ? (
            <p className="text-muted-foreground text-sm">Loading...</p>
          ) : starterPacks.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No starter packs created yet. New players won't see a starter selection.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {starterPacks.map((pack) => (
                <StarterPackCard
                  key={pack.id}
                  pack={pack}
                  onEdit={() => {
                    setPackName(pack.name);
                    setEditId(pack.id);
                    setDialogOpen(true);
                  }}
                  onDelete={() => setDeleteId(pack.id)}
                  onManage={() => setManagingPack({ id: pack.id, name: pack.name })}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editId ? "Edit Starter Pack" : "Create Starter Pack"}
        onSave={() => saveMut.mutate()}
        saving={saveMut.isPending}
      >
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Pack Name</Label>
            <Input
              value={packName}
              onChange={(e) => setPackName(e.target.value)}
              placeholder="e.g. East Conference Starter"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Starter packs are always free and one-time-claim. Add players after creating.
          </p>
        </div>
      </FormDialog>

      {/* Manage Players Dialog */}
      <FormDialog
        open={!!managingPack}
        onOpenChange={(o) => !o && setManagingPack(null)}
        title={`Players in: ${managingPack?.name ?? ""}`}
        onSave={() => setManagingPack(null)}
        className="max-w-2xl"
      >
        <div className="space-y-4">
          <div className="flex gap-2 items-end">
            <div className="space-y-1 flex-1">
              <Label>Add Player</Label>
              <Select value={slotPlayer} onValueChange={setSlotPlayer}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a player card..." />
                </SelectTrigger>
                <SelectContent>
                  {availablePlayers.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} ({computeOVR(p)} OVR)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              disabled={!slotPlayer || addPlayerMut.isPending}
              onClick={() => addPlayerMut.mutate(slotPlayer)}
            >
              <Plus className="h-4 w-4 mr-1" /> Add
            </Button>
          </div>

          {packPlayers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No players assigned yet.</p>
          ) : (
            <div className="space-y-2">
              {packPlayers.map((pp) => {
                const card = playerCards.find((c) => c.id === pp.player_card_id);
                return (
                  <div
                    key={pp.id}
                    className="flex items-center gap-3 bg-secondary/30 border border-border/50 rounded-md p-2"
                  >
                    <span className="text-sm font-mono bg-muted px-2 py-1 rounded w-8 text-center">
                      {pp.slot_number}
                    </span>
                    <span className="flex-1 font-medium text-sm">
                      {card?.name ?? "Unknown"}
                    </span>
                    <div className="flex items-center gap-2">
                      {card?.position1 && (
                        <Badge variant="outline" className="text-xs">
                          {card.position1}
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {card ? computeOVR(card) : "?"} OVR
                      </span>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => removePlayerMut.mutate(pp.id)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </FormDialog>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(o) => !o && setDeleteId(null)}
        title="Delete Starter Pack"
        description="This will delete the pack and remove all player assignments."
        onConfirm={() => deleteId && deleteMut.mutate(deleteId)}
        loading={deleteMut.isPending}
      />
    </div>
  );
}

function StarterPackCard({
  pack,
  onEdit,
  onDelete,
  onManage,
}: {
  pack: { id: string; name: string };
  onEdit: () => void;
  onDelete: () => void;
  onManage: () => void;
}) {
  const { data: players = [] } = useQuery({
    queryKey: ["starter-pack-player-count", pack.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("pack_players")
        .select("id, player_card_id")
        .eq("pack_id", pack.id);
      return data ?? [];
    },
  });

  return (
    <Card className="border-border/50 bg-secondary/20">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-display font-bold">{pack.name}</h3>
            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
              <Users className="h-3 w-3" /> {players.length} players assigned
            </p>
          </div>
          <Badge className="bg-gem-gold/20 text-gem-gold border-gem-gold/30">
            FREE
          </Badge>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="flex-1" onClick={onManage}>
            <Users className="h-3 w-3 mr-1" /> Players
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onEdit}>
            <Pencil className="h-3 w-3" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 text-destructive"
            onClick={onDelete}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
