import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DataTable, Column } from "@/components/admin/DataTable";
import { FormDialog } from "@/components/admin/FormDialog";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";

type BadgeRow = Tables<"badges">;
type TraitRow = Tables<"signature_traits">;

const TIERS = ["base", "gold", "diamond", "hof", "actolytrene"] as const;

export default function AdminBadgesTraits() {
  const qc = useQueryClient();

  // Badges
  const [badgeForm, setBadgeForm] = useState<Partial<BadgeRow>>({});
  const [badgeEditId, setBadgeEditId] = useState<string | null>(null);
  const [badgeDialog, setBadgeDialog] = useState(false);
  const [badgeDeleteId, setBadgeDeleteId] = useState<string | null>(null);

  const { data: badges = [], isLoading: badgesLoading } = useQuery({
    queryKey: ["admin-badges"], queryFn: async () => { const { data, error } = await supabase.from("badges").select("*").order("name"); if (error) throw error; return data; },
  });

  const badgeSave = useMutation({
    mutationFn: async () => {
      const { id, created_at, ...payload } = badgeForm as any;
      if (badgeEditId) { const { error } = await supabase.from("badges").update(payload).eq("id", badgeEditId); if (error) throw error; }
      else { const { error } = await supabase.from("badges").insert(payload); if (error) throw error; }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-badges"] }); setBadgeDialog(false); toast.success("Saved"); },
    onError: (e) => toast.error(e.message),
  });

  const badgeDelete = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("badges").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-badges"] }); setBadgeDeleteId(null); toast.success("Deleted"); },
    onError: (e) => toast.error(e.message),
  });

  // Traits
  const [traitForm, setTraitForm] = useState<Partial<TraitRow>>({});
  const [traitEditId, setTraitEditId] = useState<string | null>(null);
  const [traitDialog, setTraitDialog] = useState(false);
  const [traitDeleteId, setTraitDeleteId] = useState<string | null>(null);

  const { data: traits = [], isLoading: traitsLoading } = useQuery({
    queryKey: ["admin-traits"], queryFn: async () => { const { data, error } = await supabase.from("signature_traits").select("*").order("name"); if (error) throw error; return data; },
  });

  const traitSave = useMutation({
    mutationFn: async () => {
      const { id, created_at, ...payload } = traitForm as any;
      if (traitEditId) { const { error } = await supabase.from("signature_traits").update(payload).eq("id", traitEditId); if (error) throw error; }
      else { const { error } = await supabase.from("signature_traits").insert(payload); if (error) throw error; }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-traits"] }); setTraitDialog(false); toast.success("Saved"); },
    onError: (e) => toast.error(e.message),
  });

  const traitDelete = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("signature_traits").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-traits"] }); setTraitDeleteId(null); toast.success("Deleted"); },
    onError: (e) => toast.error(e.message),
  });

  const badgeCols: Column<BadgeRow>[] = [
    { key: "name", label: "Name", sortable: true },
    { key: "abbreviation", label: "Abbr" },
    { key: "effect_type", label: "Effect" },
    { key: "affected_stat", label: "Stat", render: (r) => r.affected_stat ?? "—" },
  ];

  const traitCols: Column<TraitRow>[] = [
    { key: "name", label: "Name", sortable: true },
    { key: "abbreviation", label: "Abbr" },
    { key: "condition_type", label: "Condition", render: (r) => r.condition_type ?? "—" },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Badges & Signature Traits</h1>
      <Tabs defaultValue="badges">
        <TabsList><TabsTrigger value="badges">Badges</TabsTrigger><TabsTrigger value="traits">Signature Traits</TabsTrigger></TabsList>

        <TabsContent value="badges">
          <DataTable data={badges} columns={badgeCols} isLoading={badgesLoading} searchKeys={["name"]} onAdd={() => { setBadgeForm({ name: "", abbreviation: "", effect_type: "reroll", affected_stat: null }); setBadgeEditId(null); setBadgeDialog(true); }} addLabel="Add Badge"
            actions={(r) => (<div className="flex gap-1"><Button size="icon" variant="ghost" onClick={() => { setBadgeForm(r); setBadgeEditId(r.id); setBadgeDialog(true); }}><Pencil className="h-4 w-4" /></Button><Button size="icon" variant="ghost" onClick={() => setBadgeDeleteId(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></div>)} />
        </TabsContent>

        <TabsContent value="traits">
          <DataTable data={traits} columns={traitCols} isLoading={traitsLoading} searchKeys={["name"]} onAdd={() => { setTraitForm({ name: "", abbreviation: "", condition_type: null }); setTraitEditId(null); setTraitDialog(true); }} addLabel="Add Trait"
            actions={(r) => (<div className="flex gap-1"><Button size="icon" variant="ghost" onClick={() => { setTraitForm(r); setTraitEditId(r.id); setTraitDialog(true); }}><Pencil className="h-4 w-4" /></Button><Button size="icon" variant="ghost" onClick={() => setTraitDeleteId(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></div>)} />
        </TabsContent>
      </Tabs>

      {/* Badge dialog */}
      <FormDialog open={badgeDialog} onOpenChange={setBadgeDialog} title={badgeEditId ? "Edit Badge" : "Add Badge"} onSave={() => badgeSave.mutate()} saving={badgeSave.isPending} className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1"><Label>Name</Label><Input value={badgeForm.name ?? ""} onChange={(e) => setBadgeForm((f) => ({ ...f, name: e.target.value }))} /></div>
            <div className="space-y-1"><Label>Abbreviation</Label><Input value={badgeForm.abbreviation ?? ""} onChange={(e) => setBadgeForm((f) => ({ ...f, abbreviation: e.target.value }))} /></div>
            <div className="space-y-1"><Label>Effect Type</Label><Input value={badgeForm.effect_type ?? ""} onChange={(e) => setBadgeForm((f) => ({ ...f, effect_type: e.target.value }))} /></div>
            <div className="space-y-1"><Label>Affected Stat</Label><Input value={badgeForm.affected_stat ?? ""} onChange={(e) => setBadgeForm((f) => ({ ...f, affected_stat: e.target.value || null }))} /></div>
          </div>
          <div className="space-y-3">
            <Label className="text-base">Tier Descriptions</Label>
            {TIERS.map((t) => (
              <div key={t} className="space-y-1">
                <Label className="capitalize text-xs">{t}</Label>
                <Textarea value={(badgeForm as any)?.[`description_${t}`] ?? ""} onChange={(e) => setBadgeForm((f) => ({ ...f, [`description_${t}`]: e.target.value || null }))} rows={2} />
              </div>
            ))}
          </div>
        </div>
      </FormDialog>

      {/* Trait dialog */}
      <FormDialog open={traitDialog} onOpenChange={setTraitDialog} title={traitEditId ? "Edit Trait" : "Add Trait"} onSave={() => traitSave.mutate()} saving={traitSave.isPending} className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1"><Label>Name</Label><Input value={traitForm.name ?? ""} onChange={(e) => setTraitForm((f) => ({ ...f, name: e.target.value }))} /></div>
            <div className="space-y-1"><Label>Abbreviation</Label><Input value={traitForm.abbreviation ?? ""} onChange={(e) => setTraitForm((f) => ({ ...f, abbreviation: e.target.value }))} /></div>
            <div className="space-y-1"><Label>Condition Type</Label><Input value={traitForm.condition_type ?? ""} onChange={(e) => setTraitForm((f) => ({ ...f, condition_type: e.target.value || null }))} /></div>
          </div>
          <div className="space-y-3">
            <Label className="text-base">Tier Descriptions</Label>
            {TIERS.map((t) => (
              <div key={t} className="space-y-1">
                <Label className="capitalize text-xs">{t}</Label>
                <Textarea value={(traitForm as any)?.[`description_${t}`] ?? ""} onChange={(e) => setTraitForm((f) => ({ ...f, [`description_${t}`]: e.target.value || null }))} rows={2} />
              </div>
            ))}
          </div>
        </div>
      </FormDialog>

      <ConfirmDialog open={!!badgeDeleteId} onOpenChange={(o) => !o && setBadgeDeleteId(null)} title="Delete Badge" description="This will permanently delete this badge." onConfirm={() => badgeDeleteId && badgeDelete.mutate(badgeDeleteId)} loading={badgeDelete.isPending} />
      <ConfirmDialog open={!!traitDeleteId} onOpenChange={(o) => !o && setTraitDeleteId(null)} title="Delete Trait" description="This will permanently delete this trait." onConfirm={() => traitDeleteId && traitDelete.mutate(traitDeleteId)} loading={traitDelete.isPending} />
    </div>
  );
}
