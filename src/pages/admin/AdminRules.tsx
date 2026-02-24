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
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";

type RuleConfig = Tables<"rule_config">;

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
    { key: "description", label: "Description", render: (r) => r.description ?? "—" },
    { key: "value", label: "Value", render: (r) => <code className="text-xs bg-muted px-1 py-0.5 rounded">{JSON.stringify(r.value).slice(0, 60)}{JSON.stringify(r.value).length > 60 ? "…" : ""}</code> },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Rules Configuration</h1>
      <DataTable data={rules} columns={columns} isLoading={isLoading} searchKeys={["key", "description"]} searchPlaceholder="Search rules…" onAdd={() => { setForm({ key: "", value: {}, description: "" }); setEditId(null); setDialogOpen(true); }} addLabel="Add Rule"
        actions={(r) => (<div className="flex gap-1"><Button size="icon" variant="ghost" onClick={() => { setForm({ key: r.key, value: r.value, description: r.description ?? "" }); setEditId(r.id); setDialogOpen(true); }}><Pencil className="h-4 w-4" /></Button><Button size="icon" variant="ghost" onClick={() => setDeleteId(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></div>)} />

      <FormDialog open={dialogOpen} onOpenChange={setDialogOpen} title={editId ? "Edit Rule" : "Add Rule"} onSave={() => saveMut.mutate()} saving={saveMut.isPending}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1"><Label>Key</Label><Input value={form.key} onChange={(e) => setForm((f) => ({ ...f, key: e.target.value }))} /></div>
            <div className="space-y-1"><Label>Description</Label><Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></div>
          </div>
          <JsonEditor label="Value (JSON)" value={form.value} onChange={(v) => setForm((f) => ({ ...f, value: v }))} />
        </div>
      </FormDialog>

      <ConfirmDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)} title="Delete Rule" description="Permanently delete this rule config?" onConfirm={() => deleteId && deleteMut.mutate(deleteId)} loading={deleteMut.isPending} />
    </div>
  );
}
