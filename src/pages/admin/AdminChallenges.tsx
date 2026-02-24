import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DataTable, Column } from "@/components/admin/DataTable";
import { FormDialog } from "@/components/admin/FormDialog";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { JsonEditor } from "@/components/admin/JsonEditor";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";

type Challenge = Tables<"challenges">;

const empty = () => ({ name: "", description: "", challenge_type: "spotlight", coin_reward: 0, gem_reward: 0, conditions: null as any });

export default function AdminChallenges() {
  const qc = useQueryClient();
  const [form, setForm] = useState(empty());
  const [editId, setEditId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: challenges = [], isLoading } = useQuery({
    queryKey: ["admin-challenges"],
    queryFn: async () => { const { data, error } = await supabase.from("challenges").select("*").order("name"); if (error) throw error; return data; },
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = { name: form.name, description: form.description || null, challenge_type: form.challenge_type, coin_reward: form.coin_reward, gem_reward: form.gem_reward, conditions: form.conditions };
      if (editId) { const { error } = await supabase.from("challenges").update(payload).eq("id", editId); if (error) throw error; }
      else { const { error } = await supabase.from("challenges").insert(payload); if (error) throw error; }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-challenges"] }); setDialogOpen(false); toast.success("Saved"); },
    onError: (e) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("challenges").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-challenges"] }); setDeleteId(null); toast.success("Deleted"); },
    onError: (e) => toast.error(e.message),
  });

  const columns: Column<Challenge>[] = [
    { key: "name", label: "Name", sortable: true },
    { key: "challenge_type", label: "Type", sortable: true },
    { key: "coin_reward", label: "Coins" },
    { key: "gem_reward", label: "Gems" },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Challenges Manager</h1>
      <DataTable data={challenges} columns={columns} isLoading={isLoading} searchKeys={["name"]} onAdd={() => { setForm(empty()); setEditId(null); setDialogOpen(true); }} addLabel="Add Challenge"
        actions={(r) => (<div className="flex gap-1"><Button size="icon" variant="ghost" onClick={() => { setForm({ name: r.name, description: r.description ?? "", challenge_type: r.challenge_type, coin_reward: r.coin_reward, gem_reward: r.gem_reward, conditions: r.conditions }); setEditId(r.id); setDialogOpen(true); }}><Pencil className="h-4 w-4" /></Button><Button size="icon" variant="ghost" onClick={() => setDeleteId(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></div>)} />

      <FormDialog open={dialogOpen} onOpenChange={setDialogOpen} title={editId ? "Edit Challenge" : "Add Challenge"} onSave={() => saveMut.mutate()} saving={saveMut.isPending}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></div>
            <div className="space-y-1"><Label>Type</Label><Input value={form.challenge_type} onChange={(e) => setForm((f) => ({ ...f, challenge_type: e.target.value }))} /></div>
            <div className="space-y-1"><Label>Coin Reward</Label><Input type="number" value={form.coin_reward} onChange={(e) => setForm((f) => ({ ...f, coin_reward: Number(e.target.value) }))} /></div>
            <div className="space-y-1"><Label>Gem Reward</Label><Input type="number" value={form.gem_reward} onChange={(e) => setForm((f) => ({ ...f, gem_reward: Number(e.target.value) }))} /></div>
          </div>
          <div className="space-y-1"><Label>Description</Label><Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></div>
          <JsonEditor label="Conditions (JSON)" value={form.conditions} onChange={(v) => setForm((f) => ({ ...f, conditions: v }))} />
        </div>
      </FormDialog>

      <ConfirmDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)} title="Delete Challenge" description="Permanently delete this challenge?" onConfirm={() => deleteId && deleteMut.mutate(deleteId)} loading={deleteMut.isPending} />
    </div>
  );
}
