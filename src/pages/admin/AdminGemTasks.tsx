import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DataTable, Column } from "@/components/admin/DataTable";
import { FormDialog } from "@/components/admin/FormDialog";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Pencil, Trash2, Copy } from "lucide-react";
import { toast } from "sonner";
import { ChatGPTExchange } from "@/components/admin/ChatGPTExchange";
import { GemTasksExchange } from "@/lib/exchangeEntities";

type GemTask = {
  id: string;
  title: string;
  description: string | null;
  gem_reward: number;
  cooldown_hours: number;
  category: string;
  is_active: boolean;
  created_at: string;
};

const CATEGORIES = ["daily", "weekly", "fitness", "academic", "creative"];

export default function AdminGemTasks() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ title: "", description: "", gem_reward: 5, cooldown_hours: 24, category: "daily", is_active: true });
  const [editId, setEditId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["admin-gem-tasks"],
    queryFn: async () => {
      const { data, error } = await supabase.from("gem_tasks").select("*").order("category").order("title");
      if (error) throw error;
      return data as GemTask[];
    },
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = {
        title: form.title,
        description: form.description || null,
        gem_reward: form.gem_reward,
        cooldown_hours: form.cooldown_hours,
        category: form.category,
        is_active: form.is_active,
      };
      if (editId) {
        const { error } = await supabase.from("gem_tasks").update(payload).eq("id", editId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("gem_tasks").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-gem-tasks"] }); setDialogOpen(false); toast.success("Saved"); },
    onError: (e) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("gem_tasks").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-gem-tasks"] }); setDeleteId(null); toast.success("Deleted"); },
    onError: (e) => toast.error(e.message),
  });

  const columns: Column<GemTask>[] = [
    { key: "title", label: "Title", sortable: true },
    { key: "category", label: "Category", render: (r) => <Badge variant="secondary" className="capitalize">{r.category}</Badge> },
    { key: "gem_reward", label: "Gems", sortable: true, render: (r) => `💎 ${r.gem_reward}` },
    { key: "cooldown_hours", label: "Cooldown", render: (r) => `${r.cooldown_hours}h` },
    { key: "is_active", label: "Active", render: (r) => r.is_active ? <Badge className="bg-primary/20 text-primary">Active</Badge> : <Badge variant="outline">Inactive</Badge> },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Gem Tasks</h1>
        <ChatGPTExchange title="Gem Tasks · AI Import / Export" entity={GemTasksExchange} onCommitted={() => qc.invalidateQueries({ queryKey: ["admin-gem-tasks"] })} />
      </div>
      <DataTable
        data={tasks}
        columns={columns}
        isLoading={isLoading}
        searchKeys={["title", "category"]}
        searchPlaceholder="Search tasks…"
        onAdd={() => { setForm({ title: "", description: "", gem_reward: 5, cooldown_hours: 24, category: "daily", is_active: true }); setEditId(null); setDialogOpen(true); }}
        addLabel="Add Task"
        actions={(r) => (
          <div className="flex gap-1">
            <Button size="icon" variant="ghost" onClick={() => { setForm({ title: r.title, description: r.description ?? "", gem_reward: r.gem_reward, cooldown_hours: r.cooldown_hours, category: r.category, is_active: r.is_active }); setEditId(r.id); setDialogOpen(true); }}><Pencil className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" title="Duplicate" onClick={() => { setForm({ title: `${r.title} (Copy)`, description: r.description ?? "", gem_reward: r.gem_reward, cooldown_hours: r.cooldown_hours, category: r.category, is_active: r.is_active }); setEditId(null); setDialogOpen(true); }}><Copy className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" onClick={() => setDeleteId(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
          </div>
        )}
      />

      <FormDialog open={dialogOpen} onOpenChange={setDialogOpen} title={editId ? "Edit Task" : "Add Task"} onSave={() => saveMut.mutate()} saving={saveMut.isPending}>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Title</Label>
            <Input value={form.title} onChange={(e) => setForm(f => ({ ...f, title: e.target.value }))} placeholder="e.g. Practice dribbling for 10 minutes" />
          </div>
          <div className="space-y-1">
            <Label>Description (optional)</Label>
            <Input value={form.description} onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Extra details about the task…" />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1">
              <Label>Gem Reward</Label>
              <Input type="number" value={form.gem_reward} onChange={(e) => setForm(f => ({ ...f, gem_reward: Number(e.target.value) }))} min={1} />
            </div>
            <div className="space-y-1">
              <Label>Cooldown (hours)</Label>
              <Input type="number" value={form.cooldown_hours} onChange={(e) => setForm(f => ({ ...f, cooldown_hours: Number(e.target.value) }))} min={1} />
            </div>
            <div className="space-y-1">
              <Label>Category</Label>
              <Select value={form.category} onValueChange={(v) => setForm(f => ({ ...f, category: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map(c => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Switch checked={form.is_active} onCheckedChange={(v) => setForm(f => ({ ...f, is_active: v }))} />
            <Label>Active</Label>
          </div>
        </div>
      </FormDialog>

      <ConfirmDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)} title="Delete Task" description="Permanently delete this gem task?" onConfirm={() => deleteId && deleteMut.mutate(deleteId)} loading={deleteMut.isPending} />
    </div>
  );
}
