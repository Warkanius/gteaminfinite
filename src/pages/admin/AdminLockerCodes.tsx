import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DataTable, Column } from "@/components/admin/DataTable";
import { FormDialog } from "@/components/admin/FormDialog";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";

type LockerCode = {
  id: string;
  code: string;
  reward_type: string;
  reward_value: any;
  max_redemptions: number | null;
  expires_at: string | null;
  created_at: string;
};

const REWARD_TYPES = ["coins", "gems", "card", "pack"];

export default function AdminLockerCodes() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ code: "", reward_type: "coins", reward_value: { amount: 100 } as any, max_redemptions: null as number | null, expires_at: "" });
  const [editId, setEditId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: codes = [], isLoading } = useQuery({
    queryKey: ["admin-locker-codes"],
    queryFn: async () => {
      const { data, error } = await supabase.from("locker_codes").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data as LockerCode[];
    },
  });

  const { data: players = [] } = useQuery({
    queryKey: ["admin-players-list"],
    queryFn: async () => {
      const { data } = await supabase.from("player_cards").select("id, name, rating").order("name");
      return data ?? [];
    },
  });

  const { data: packs = [] } = useQuery({
    queryKey: ["admin-packs-list"],
    queryFn: async () => {
      const { data } = await supabase.from("packs").select("id, name").order("name");
      return data ?? [];
    },
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = {
        code: form.code.trim().toUpperCase(),
        reward_type: form.reward_type,
        reward_value: form.reward_value,
        max_redemptions: form.max_redemptions || null,
        expires_at: form.expires_at || null,
      };
      if (editId) {
        const { error } = await supabase.from("locker_codes").update(payload).eq("id", editId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("locker_codes").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-locker-codes"] }); setDialogOpen(false); toast.success("Saved"); },
    onError: (e) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("locker_codes").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-locker-codes"] }); setDeleteId(null); toast.success("Deleted"); },
    onError: (e) => toast.error(e.message),
  });

  const columns: Column<LockerCode>[] = [
    { key: "code", label: "Code", sortable: true, render: (r) => <code className="font-mono text-sm">{r.code}</code> },
    { key: "reward_type", label: "Reward", render: (r) => <Badge variant="secondary" className="capitalize">{r.reward_type}</Badge> },
    { key: "reward_value", label: "Value", render: (r) => <span className="text-xs">{JSON.stringify(r.reward_value)}</span> },
    { key: "max_redemptions", label: "Max Uses", render: (r) => r.max_redemptions ?? "∞" },
    { key: "expires_at", label: "Expires", render: (r) => r.expires_at ? new Date(r.expires_at).toLocaleDateString() : "Never" },
  ];

  function openNew() {
    setForm({ code: "", reward_type: "coins", reward_value: { amount: 100 }, max_redemptions: null, expires_at: "" });
    setEditId(null);
    setDialogOpen(true);
  }

  function openEdit(r: LockerCode) {
    setForm({
      code: r.code,
      reward_type: r.reward_type,
      reward_value: r.reward_value,
      max_redemptions: r.max_redemptions,
      expires_at: r.expires_at ?? "",
    });
    setEditId(r.id);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Locker Codes</h1>
      <DataTable
        data={codes}
        columns={columns}
        isLoading={isLoading}
        searchKeys={["code"]}
        searchPlaceholder="Search codes…"
        onAdd={openNew}
        addLabel="Add Code"
        actions={(r) => (
          <div className="flex gap-1">
            <Button size="icon" variant="ghost" onClick={() => openEdit(r)}><Pencil className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" onClick={() => setDeleteId(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
          </div>
        )}
      />

      <FormDialog open={dialogOpen} onOpenChange={setDialogOpen} title={editId ? "Edit Code" : "Add Code"} onSave={() => saveMut.mutate()} saving={saveMut.isPending}>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Code</Label>
            <Input value={form.code} onChange={(e) => setForm(f => ({ ...f, code: e.target.value.toUpperCase() }))} placeholder="GTEAM-2024" className="font-mono uppercase" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Reward Type</Label>
              <Select value={form.reward_type} onValueChange={(v) => {
                const defaults: Record<string, any> = { coins: { amount: 100 }, gems: { amount: 10 }, card: { player_card_id: "" }, pack: { pack_id: "" } };
                setForm(f => ({ ...f, reward_type: v, reward_value: defaults[v] ?? {} }));
              }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{REWARD_TYPES.map(t => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Max Redemptions</Label>
              <Input type="number" value={form.max_redemptions ?? ""} onChange={(e) => setForm(f => ({ ...f, max_redemptions: e.target.value ? Number(e.target.value) : null }))} placeholder="Unlimited" />
            </div>
          </div>

          {/* Dynamic reward value fields */}
          {(form.reward_type === "coins" || form.reward_type === "gems") && (
            <div className="space-y-1">
              <Label>Amount</Label>
              <Input type="number" value={form.reward_value.amount ?? 0} onChange={(e) => setForm(f => ({ ...f, reward_value: { amount: Number(e.target.value) } }))} />
            </div>
          )}
          {form.reward_type === "card" && (
            <div className="space-y-1">
              <Label>Player Card</Label>
              <Select value={form.reward_value.player_card_id ?? ""} onValueChange={(v) => setForm(f => ({ ...f, reward_value: { player_card_id: v } }))}>
                <SelectTrigger><SelectValue placeholder="Select card…" /></SelectTrigger>
                <SelectContent>{players.map(p => <SelectItem key={p.id} value={p.id}>{p.name} ({p.rating})</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          {form.reward_type === "pack" && (
            <div className="space-y-1">
              <Label>Pack</Label>
              <Select value={form.reward_value.pack_id ?? ""} onValueChange={(v) => setForm(f => ({ ...f, reward_value: { pack_id: v } }))}>
                <SelectTrigger><SelectValue placeholder="Select pack…" /></SelectTrigger>
                <SelectContent>{packs.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1">
            <Label>Expires At (optional)</Label>
            <Input type="datetime-local" value={form.expires_at ?? ""} onChange={(e) => setForm(f => ({ ...f, expires_at: e.target.value }))} />
          </div>
        </div>
      </FormDialog>

      <ConfirmDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)} title="Delete Code" description="Permanently delete this locker code?" onConfirm={() => deleteId && deleteMut.mutate(deleteId)} loading={deleteMut.isPending} />
    </div>
  );
}
