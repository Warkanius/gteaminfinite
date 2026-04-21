import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DataTable, Column } from "@/components/admin/DataTable";
import { FormDialog } from "@/components/admin/FormDialog";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { JsonEditor } from "@/components/admin/JsonEditor";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pencil, Trash2, Copy } from "lucide-react";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";

type RuleConfig = Tables<"rule_config">;

// Keys that store a single gem-tier name string — render a tier dropdown for these.
const TIER_KEYS = new Set(["signing_min_gem_tier", "runs_appearance_min_gem_tier"]);
// Keys that should render an Account picker (location_accounts).
const ACCOUNT_KEYS = new Set(["league_signings_account_id"]);
// Keys that store a plain number — show a number input for cleaner editing.
const NUMBER_KEYS = new Set(["signing_post_cooldown_minutes", "appearance_cooldown_hours"]);

const KEY_DESCRIPTIONS: Record<string, string> = {
  signing_min_gem_tier: "Minimum gem tier required for a signing post when a card enters a user's collection.",
  runs_appearance_min_gem_tier: "Minimum gem tier required for a Runs appearance post.",
  notable_performance_thresholds: "Stat thresholds (points, assists, rebounds, stocks, double_double) used to flag notable lines in Domination posts.",
  signing_post_cooldown_minutes: "Per-account cooldown between signing posts, in minutes.",
  appearance_cooldown_hours: "Per-card-per-run cooldown between appearance posts, in hours.",
  league_signings_account_id: "Location account used as the league fallback for signings/orphan events.",
  personalities_enum: "Allowed personality keys for location accounts and post templates.",
};

export default function AdminRules() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ key: "", value: {} as any, description: "" });
  const [editId, setEditId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ["admin-rules"],
    queryFn: async () => { const { data, error } = await supabase.from("rule_config").select("*").order("key"); if (error) throw error; return data; },
  });

  const { data: tiers = [] } = useQuery({
    queryKey: ["admin-rules-tiers"],
    queryFn: async () => {
      const { data } = await supabase.from("gem_tiers").select("name").order("sort_order");
      return data ?? [];
    },
  });

  const { data: locationAccounts = [] } = useQuery({
    queryKey: ["admin-rules-location-accounts"],
    queryFn: async () => {
      const { data } = await supabase.from("location_accounts").select("id, name, handle, location_type").order("name");
      return data ?? [];
    },
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = { key: form.key, value: form.value, description: form.description || null };
      if (editId) { const { error } = await supabase.from("rule_config").update(payload).eq("id", editId); if (error) throw error; }
      else { const { error } = await supabase.from("rule_config").insert(payload); if (error) throw error; }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-rules"] }); setDialogOpen(false); toast.success("Saved"); },
    onError: (e) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("rule_config").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-rules"] }); setDeleteId(null); toast.success("Deleted"); },
    onError: (e) => toast.error(e.message),
  });

  const columns: Column<RuleConfig>[] = [
    { key: "key", label: "Key", sortable: true },
    { key: "description", label: "Description", render: (r) => r.description ?? KEY_DESCRIPTIONS[r.key] ?? "—" },
    { key: "value", label: "Value", render: (r) => <code className="text-xs bg-muted px-1 py-0.5 rounded">{JSON.stringify(r.value).slice(0, 60)}{JSON.stringify(r.value).length > 60 ? "…" : ""}</code> },
  ];

  const isTierKey = TIER_KEYS.has(form.key);
  const isAccountKey = ACCOUNT_KEYS.has(form.key);
  const isNumberKey = NUMBER_KEYS.has(form.key);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Rules Configuration</h1>
      <DataTable data={rules} columns={columns} isLoading={isLoading} searchKeys={["key", "description"]} searchPlaceholder="Search rules…" onAdd={() => { setForm({ key: "", value: {}, description: "" }); setEditId(null); setDialogOpen(true); }} addLabel="Add Rule"
        actions={(r) => (<div className="flex gap-1"><Button size="icon" variant="ghost" onClick={() => { setForm({ key: r.key, value: r.value, description: r.description ?? "" }); setEditId(r.id); setDialogOpen(true); }}><Pencil className="h-4 w-4" /></Button><Button size="icon" variant="ghost" title="Duplicate" onClick={() => { setForm({ key: `${r.key}_copy`, value: r.value, description: r.description ?? "" }); setEditId(null); setDialogOpen(true); }}><Copy className="h-4 w-4" /></Button><Button size="icon" variant="ghost" onClick={() => setDeleteId(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></div>)} />

      <FormDialog open={dialogOpen} onOpenChange={setDialogOpen} title={editId ? "Edit Rule" : "Add Rule"} onSave={() => saveMut.mutate()} saving={saveMut.isPending}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1"><Label>Key</Label><Input value={form.key} onChange={(e) => setForm((f) => ({ ...f, key: e.target.value }))} /></div>
            <div className="space-y-1"><Label>Description</Label><Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></div>
          </div>

          {KEY_DESCRIPTIONS[form.key] && (
            <p className="text-xs text-muted-foreground bg-muted/40 rounded p-2">{KEY_DESCRIPTIONS[form.key]}</p>
          )}

          {isTierKey ? (
            <div className="space-y-1">
              <Label>Gem Tier</Label>
              <Select value={typeof form.value === "string" ? form.value : ""} onValueChange={(v) => setForm((f) => ({ ...f, value: v }))}>
                <SelectTrigger><SelectValue placeholder="Pick a tier" /></SelectTrigger>
                <SelectContent>
                  {tiers.map((t: any) => <SelectItem key={t.name} value={t.name}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ) : isAccountKey ? (
            <div className="space-y-1">
              <Label>Location Account</Label>
              <Select value={typeof form.value === "string" ? form.value : ""} onValueChange={(v) => setForm((f) => ({ ...f, value: v }))}>
                <SelectTrigger><SelectValue placeholder="Pick an account (create one in Social Feed admin first)" /></SelectTrigger>
                <SelectContent>
                  {locationAccounts.map((a: any) => (
                    <SelectItem key={a.id} value={a.id}>{a.name} · {a.handle} · {a.location_type}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : isNumberKey ? (
            <div className="space-y-1">
              <Label>Number</Label>
              <Input type="number" min={0} value={typeof form.value === "number" ? form.value : ""} onChange={(e) => setForm((f) => ({ ...f, value: Number(e.target.value) || 0 }))} />
            </div>
          ) : (
            <JsonEditor label="Value (JSON)" value={form.value} onChange={(v) => setForm((f) => ({ ...f, value: v }))} />
          )}
        </div>
      </FormDialog>

      <ConfirmDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)} title="Delete Rule" description="Permanently delete this rule config?" onConfirm={() => deleteId && deleteMut.mutate(deleteId)} loading={deleteMut.isPending} />
    </div>
  );
}
