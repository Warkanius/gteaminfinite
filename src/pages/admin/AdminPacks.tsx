import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DataTable, Column } from "@/components/admin/DataTable";
import { FormDialog } from "@/components/admin/FormDialog";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PlayerCombobox } from "@/components/admin/PlayerCombobox";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Pencil, Trash2, X, Plus } from "lucide-react";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";

type Pack = Tables<"packs">;

const emptyPack = () => ({ name: "", pack_type: "standard", cost: 0, ten_box_cost: null as number | null });

export default function AdminPacks() {
  const qc = useQueryClient();
  const [form, setForm] = useState(emptyPack());
  const [editId, setEditId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [detailPack, setDetailPack] = useState<Pack | null>(null);

  const { data: packs = [], isLoading } = useQuery({
    queryKey: ["admin-packs"],
    queryFn: async () => { const { data, error } = await supabase.from("packs").select("*").order("name"); if (error) throw error; return data; },
  });

  const { data: playerCards = [] } = useQuery({
    queryKey: ["player-cards-list"],
    queryFn: async () => { const { data } = await supabase.from("player_cards").select("id, name").order("name"); return data ?? []; },
  });

  const { data: packPlayers = [] } = useQuery({
    queryKey: ["pack-players", detailPack?.id],
    enabled: !!detailPack,
    queryFn: async () => { const { data } = await supabase.from("pack_players").select("*").eq("pack_id", detailPack!.id).order("slot_number"); return data ?? []; },
  });

  const { data: packOdds = [] } = useQuery({
    queryKey: ["pack-odds", detailPack?.pack_type],
    enabled: !!detailPack,
    queryFn: async () => { const { data } = await supabase.from("pack_odds").select("*").eq("pack_type", detailPack!.pack_type); return data ?? []; },
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = { name: form.name, pack_type: form.pack_type, cost: form.cost, ten_box_cost: form.ten_box_cost };
      if (editId) {
        const { error } = await supabase.from("packs").update(payload).eq("id", editId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("packs").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-packs"] }); setDialogOpen(false); toast.success("Saved"); },
    onError: (e) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("packs").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-packs"] }); setDeleteId(null); toast.success("Deleted"); },
    onError: (e) => toast.error(e.message),
  });

  // Pack players mutations
  const addSlotMut = useMutation({
    mutationFn: async ({ packId, playerCardId, slot }: { packId: string; playerCardId: string; slot: number }) => {
      const { error } = await supabase.from("pack_players").insert({ pack_id: packId, player_card_id: playerCardId, slot_number: slot });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pack-players"] }),
    onError: (e) => toast.error(e.message),
  });

  const removeSlotMut = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("pack_players").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pack-players"] }),
  });

  // Pack odds mutations
  const [oddsForm, setOddsForm] = useState({ dice_roll: "", result_slot: "", description: "" });
  const addOddsMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("pack_odds").insert({ pack_type: detailPack!.pack_type, ...oddsForm, description: oddsForm.description || null });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["pack-odds"] }); setOddsForm({ dice_roll: "", result_slot: "", description: "" }); toast.success("Added"); },
    onError: (e) => toast.error(e.message),
  });
  const deleteOddsMut = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("pack_odds").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pack-odds"] }),
  });

  const [slotPlayer, setSlotPlayer] = useState("");
  const [slotNum, setSlotNum] = useState(1);

  const columns: Column<Pack>[] = [
    { key: "name", label: "Name", sortable: true },
    { key: "pack_type", label: "Type", sortable: true },
    { key: "cost", label: "Cost", sortable: true },
    { key: "ten_box_cost", label: "10-Box Cost", render: (r) => r.ten_box_cost != null ? String(r.ten_box_cost) : "—" },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Packs & Odds Manager</CardTitle>
          <CardDescription>Manage pack pricing, odds, and player contents for the pack market.</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            data={packs}
            columns={columns}
            isLoading={isLoading}
            searchKeys={["name", "pack_type"]}
            searchPlaceholder="Search packs…"
            onAdd={() => { setForm(emptyPack()); setEditId(null); setDialogOpen(true); }}
            addLabel="Add Pack"
            actions={(row) => (
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" onClick={() => { setForm({ name: row.name, pack_type: row.pack_type, cost: row.cost, ten_box_cost: row.ten_box_cost }); setEditId(row.id); setDialogOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                <Button size="sm" variant="outline" onClick={() => setDetailPack(row)}>Manage</Button>
                <Button size="icon" variant="ghost" onClick={() => setDeleteId(row.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </div>
            )}
          />
        </CardContent>
      </Card>

      {/* Add/Edit pack form */}
      <FormDialog open={dialogOpen} onOpenChange={setDialogOpen} title={editId ? "Edit Pack" : "Add Pack"} onSave={() => saveMut.mutate()} saving={saveMut.isPending}>
        <div className="space-y-4">
          <div className="bg-muted/30 p-4 rounded-lg border space-y-4">
            <h3 className="font-semibold text-sm">Basic Details</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
              <div className="space-y-1"><Label>Pack Type</Label>
                <Select value={form.pack_type} onValueChange={(v) => setForm((f) => ({ ...f, pack_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="standard">Standard</SelectItem>
                    <SelectItem value="reward">Reward</SelectItem>
                    <SelectItem value="starter">Starter</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <div className="bg-muted/30 p-4 rounded-lg border space-y-4">
            <h3 className="font-semibold text-sm">Store Pricing</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1"><Label>Cost (Coins/Gems)</Label><Input type="number" value={form.cost} onChange={(e) => setForm((f) => ({ ...f, cost: Number(e.target.value) }))} /></div>
              <div className="space-y-1"><Label>10-Box Cost</Label><Input type="number" value={form.ten_box_cost ?? ""} onChange={(e) => setForm((f) => ({ ...f, ten_box_cost: e.target.value ? Number(e.target.value) : null }))} placeholder="Optional" /></div>
            </div>
          </div>
        </div>
      </FormDialog>

      {/* Detail panel */}
      <FormDialog open={!!detailPack} onOpenChange={(o) => !o && setDetailPack(null)} title={`Manage: ${detailPack?.name ?? ""}`} onSave={() => setDetailPack(null)} className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <Tabs defaultValue="players">
          <TabsList>
            <TabsTrigger value="players">Pack Players</TabsTrigger>
            {detailPack?.pack_type !== "rttr" && detailPack?.pack_type !== "dom" && (
              <TabsTrigger value="odds">Odds Table</TabsTrigger>
            )}
          </TabsList>
          <TabsContent value="players" className="space-y-4 pt-4">
            <div className="bg-muted/30 p-4 rounded-lg border space-y-4">
              <div className="flex gap-2 items-end">
                <div className="space-y-1 flex-1">
                  <Label>Player</Label>
                  <PlayerCombobox
                    players={playerCards}
                    value={slotPlayer}
                    onValueChange={setSlotPlayer}
                    placeholder="Search players…"
                  />
                </div>
                <div className="space-y-1 w-24"><Label>Slot</Label><Input type="number" min={1} value={slotNum} onChange={(e) => setSlotNum(Number(e.target.value))} /></div>
                <Button disabled={!slotPlayer} onClick={() => { addSlotMut.mutate({ packId: detailPack!.id, playerCardId: slotPlayer, slot: slotNum }); setSlotPlayer(""); }}><Plus className="h-4 w-4 mr-1" /> Add Player</Button>
              </div>
              <div className="space-y-2">
                {packPlayers.map((pp) => (
                  <div key={pp.id} className="flex items-center gap-3 bg-background border rounded-md p-2">
                    <span className="text-sm font-mono bg-muted px-2 py-1 rounded w-10 text-center">#{pp.slot_number}</span>
                    <span className="flex-1 font-medium">{playerCards.find((p) => p.id === pp.player_card_id)?.name ?? pp.player_card_id}</span>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => removeSlotMut.mutate(pp.id)}><X className="h-4 w-4" /></Button>
                  </div>
                ))}
              </div>
            </div>
          </TabsContent>
          <TabsContent value="odds" className="space-y-4 pt-4">
            <div className="bg-muted/30 p-4 rounded-lg border space-y-4">
              <div className="flex gap-2 items-end">
                <div className="space-y-1 flex-1"><Label>Dice Roll</Label><Input value={oddsForm.dice_roll} onChange={(e) => setOddsForm((f) => ({ ...f, dice_roll: e.target.value }))} placeholder="e.g. 1-3" /></div>
                <div className="space-y-1 flex-1"><Label>Result Slot</Label><Input value={oddsForm.result_slot} onChange={(e) => setOddsForm((f) => ({ ...f, result_slot: e.target.value }))} /></div>
                <div className="space-y-1 flex-[2]"><Label>Description</Label><Input value={oddsForm.description} onChange={(e) => setOddsForm((f) => ({ ...f, description: e.target.value }))} placeholder="Optional" /></div>
                <Button onClick={() => addOddsMut.mutate()} disabled={!oddsForm.dice_roll || !oddsForm.result_slot}><Plus className="h-4 w-4 mr-1" /> Add Rule</Button>
              </div>
              <div className="space-y-2">
                {packOdds.map((o) => (
                  <div key={o.id} className="flex items-center gap-3 bg-background border rounded-md p-2">
                    <span className="text-sm font-mono bg-muted px-2 py-1 rounded w-16 text-center">{o.dice_roll}</span>
                    <span className="text-sm font-medium w-24">Slot: {o.result_slot}</span>
                    <span className="text-sm text-muted-foreground flex-1">{o.description ?? ""}</span>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => deleteOddsMut.mutate(o.id)}><X className="h-4 w-4" /></Button>
                  </div>
                ))}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </FormDialog>

      <ConfirmDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)} title="Delete Pack" description="This will delete the pack and all associated player slots." onConfirm={() => deleteId && deleteMut.mutate(deleteId)} loading={deleteMut.isPending} />
    </div>
  );
}
