import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DataTable, Column } from "@/components/admin/DataTable";
import { FormDialog } from "@/components/admin/FormDialog";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Pencil, Trash2, Plus, X, Search } from "lucide-react";
import { toast } from "sonner";

export default function AdminCollectionSets() {
  const qc = useQueryClient();

  // ── Collections ──
  const [collForm, setCollForm] = useState({ name: "", description: "" });
  const [collEditId, setCollEditId] = useState<string | null>(null);
  const [collDialogOpen, setCollDialogOpen] = useState(false);
  const [collDeleteId, setCollDeleteId] = useState<string | null>(null);

  // ── Sub-Collections ──
  const [subForm, setSubForm] = useState({ name: "", collection_id: "" });
  const [subEditId, setSubEditId] = useState<string | null>(null);
  const [subDialogOpen, setSubDialogOpen] = useState(false);
  const [subDeleteId, setSubDeleteId] = useState<string | null>(null);

  const { data: collections = [], isLoading: collLoading } = useQuery({
    queryKey: ["admin-collection-sets"],
    queryFn: async () => {
      const { data, error } = await supabase.from("collections").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: subCollections = [], isLoading: subLoading } = useQuery({
    queryKey: ["admin-sub-collection-sets"],
    queryFn: async () => {
      const { data, error } = await supabase.from("sub_collections").select("*, collections(name)").order("name");
      if (error) throw error;
      return data;
    },
  });

  // Collection mutations
  const saveCollMut = useMutation({
    mutationFn: async () => {
      const payload = { name: collForm.name, description: collForm.description || null };
      if (collEditId) {
        const { error } = await supabase.from("collections").update(payload).eq("id", collEditId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("collections").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-collection-sets"] }); setCollDialogOpen(false); toast.success("Saved"); },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteCollMut = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("collections").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-collection-sets"] }); qc.invalidateQueries({ queryKey: ["admin-sub-collection-sets"] }); setCollDeleteId(null); toast.success("Deleted"); },
    onError: (e: any) => toast.error(e.message),
  });

  // Sub-collection mutations
  const saveSubMut = useMutation({
    mutationFn: async () => {
      const payload = { name: subForm.name, collection_id: subForm.collection_id };
      if (subEditId) {
        const { error } = await supabase.from("sub_collections").update(payload).eq("id", subEditId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("sub_collections").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-sub-collection-sets"] }); setSubDialogOpen(false); toast.success("Saved"); },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteSubMut = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("sub_collections").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-sub-collection-sets"] }); setSubDeleteId(null); toast.success("Deleted"); },
    onError: (e: any) => toast.error(e.message),
  });

  // ── Bulk Assign ──
  const [targetCollId, setTargetCollId] = useState<string>("");
  const [targetSubId, setTargetSubId] = useState<string>("");
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<Set<string>>(new Set());
  const [playerSearch, setPlayerSearch] = useState("");
  const [sourceTab, setSourceTab] = useState("search");
  const [sourcePackId, setSourcePackId] = useState<string>("");
  const [sourceRunId, setSourceRunId] = useState<string>("");
  const [sourceTeamId, setSourceTeamId] = useState<string>("");

  const { data: allPlayers = [] } = useQuery({
    queryKey: ["admin-all-cards-lite"],
    queryFn: async () => {
      const { data, error } = await supabase.from("player_cards").select("id, name, rating, collection_id, sub_collection_id").order("name").limit(1000);
      if (error) throw error;
      return data;
    },
  });

  const { data: packs = [] } = useQuery({
    queryKey: ["packs-lite"],
    queryFn: async () => {
      const { data, error } = await supabase.from("packs").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: runs = [] } = useQuery({
    queryKey: ["runs-lite"],
    queryFn: async () => {
      const { data, error } = await supabase.from("runs").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: teams = [] } = useQuery({
    queryKey: ["teams-lite"],
    queryFn: async () => {
      const { data, error } = await supabase.from("teams").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: packSourcePlayers = [] } = useQuery({
    queryKey: ["pack-players-source", sourcePackId],
    enabled: !!sourcePackId,
    queryFn: async () => {
      const { data, error } = await supabase.from("pack_players").select("player_card_id, player_cards(id, name, rating)").eq("pack_id", sourcePackId);
      if (error) throw error;
      return (data || []).map((r: any) => r.player_cards).filter(Boolean);
    },
  });

  const { data: runSourcePlayers = [] } = useQuery({
    queryKey: ["run-players-source", sourceRunId],
    enabled: !!sourceRunId,
    queryFn: async () => {
      const { data, error } = await supabase.from("run_players").select("player_card_id, player_cards(id, name, rating)").eq("run_id", sourceRunId);
      if (error) throw error;
      return (data || []).map((r: any) => r.player_cards).filter(Boolean);
    },
  });

  const { data: teamSourcePlayers = [] } = useQuery({
    queryKey: ["team-players-source", sourceTeamId],
    enabled: !!sourceTeamId,
    queryFn: async () => {
      const { data, error } = await supabase.from("team_players").select("player_card_id, player_cards(id, name, rating)").eq("team_id", sourceTeamId);
      if (error) throw error;
      return (data || []).map((r: any) => r.player_cards).filter(Boolean);
    },
  });

  const playerById = useMemo(() => {
    const m = new Map<string, any>();
    allPlayers.forEach((p: any) => m.set(p.id, p));
    [...packSourcePlayers, ...runSourcePlayers, ...teamSourcePlayers].forEach((p: any) => p && m.set(p.id, p));
    return m;
  }, [allPlayers, packSourcePlayers, runSourcePlayers, teamSourcePlayers]);

  const filteredSearchPlayers = useMemo(() => {
    if (!playerSearch.trim()) return allPlayers.slice(0, 50);
    const q = playerSearch.toLowerCase();
    return allPlayers.filter((p: any) => p.name.toLowerCase().includes(q)).slice(0, 100);
  }, [allPlayers, playerSearch]);

  const toggleSelected = (id: string) => {
    setSelectedPlayerIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const addAll = (players: any[]) => {
    setSelectedPlayerIds(prev => {
      const next = new Set(prev);
      players.forEach(p => p?.id && next.add(p.id));
      return next;
    });
    toast.success(`Added ${players.length} players`);
  };

  const handleSubChange = (subId: string) => {
    setTargetSubId(subId);
    if (subId) {
      const sub = (subCollections as any[]).find((s: any) => s.id === subId);
      if (sub?.collection_id) setTargetCollId(sub.collection_id);
    }
  };

  const bulkAssignMut = useMutation({
    mutationFn: async () => {
      if (!targetCollId) throw new Error("Pick a target collection");
      if (selectedPlayerIds.size === 0) throw new Error("No players selected");
      const ids = Array.from(selectedPlayerIds);
      const payload: any = { collection_id: targetCollId, sub_collection_id: targetSubId || null };
      const { error } = await supabase.from("player_cards").update(payload).in("id", ids);
      if (error) throw error;
      return ids.length;
    },
    onSuccess: (count) => {
      const collName = (collections as any[]).find((c: any) => c.id === targetCollId)?.name ?? "collection";
      const subName = (subCollections as any[]).find((s: any) => s.id === targetSubId)?.name;
      toast.success(`Added ${count} players to ${collName}${subName ? ` → ${subName}` : ""}`);
      qc.invalidateQueries({ queryKey: ["admin-all-cards-lite"] });
      qc.invalidateQueries({ queryKey: ["admin-collection-sets"] });
      qc.invalidateQueries({ queryKey: ["admin-sub-collection-sets"] });
      setSelectedPlayerIds(new Set());
    },
    onError: (e: any) => toast.error(e.message),
  });

  const collColumns: Column<any>[] = [
    { key: "name", label: "Name", sortable: true },
    { key: "description", label: "Description", render: (r) => r.description || "—" },
  ];

  const subColumns: Column<any>[] = [
    { key: "name", label: "Name", sortable: true },
    { key: "collection_id", label: "Parent Collection", render: (r) => (r as any).collections?.name ?? "—" },
  ];

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Collection Sets</h1>

      {/* Collections */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Collections</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            data={collections}
            columns={collColumns}
            isLoading={collLoading}
            searchKeys={["name"]}
            onAdd={() => { setCollForm({ name: "", description: "" }); setCollEditId(null); setCollDialogOpen(true); }}
            addLabel="Add Collection"
            actions={(r) => (
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" onClick={() => { setCollForm({ name: r.name, description: r.description ?? "" }); setCollEditId(r.id); setCollDialogOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" onClick={() => setCollDeleteId(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </div>
            )}
          />
        </CardContent>
      </Card>

      {/* Sub-Collections */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Sub-Collections</CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            data={subCollections}
            columns={subColumns}
            isLoading={subLoading}
            searchKeys={["name"]}
            onAdd={() => { setSubForm({ name: "", collection_id: collections[0]?.id ?? "" }); setSubEditId(null); setSubDialogOpen(true); }}
            addLabel="Add Sub-Collection"
            actions={(r) => (
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" onClick={() => { setSubForm({ name: r.name, collection_id: r.collection_id }); setSubEditId(r.id); setSubDialogOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" onClick={() => setSubDeleteId(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </div>
            )}
          />
        </CardContent>
      </Card>

      {/* Collection Dialog */}
      <FormDialog open={collDialogOpen} onOpenChange={setCollDialogOpen} title={collEditId ? "Edit Collection" : "Add Collection"} onSave={() => saveCollMut.mutate()} saving={saveCollMut.isPending}>
        <div className="space-y-3">
          <div className="space-y-1"><Label>Name</Label><Input value={collForm.name} onChange={e => setCollForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Kuroko no Basuke" /></div>
          <div className="space-y-1"><Label>Description</Label><Textarea value={collForm.description} onChange={e => setCollForm(f => ({ ...f, description: e.target.value }))} /></div>
        </div>
      </FormDialog>

      {/* Sub-Collection Dialog */}
      <FormDialog open={subDialogOpen} onOpenChange={setSubDialogOpen} title={subEditId ? "Edit Sub-Collection" : "Add Sub-Collection"} onSave={() => saveSubMut.mutate()} saving={saveSubMut.isPending}>
        <div className="space-y-3">
          <div className="space-y-1"><Label>Name</Label><Input value={subForm.name} onChange={e => setSubForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Kaijo High" /></div>
          <div className="space-y-1">
            <Label>Parent Collection</Label>
            <select className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={subForm.collection_id} onChange={e => setSubForm(f => ({ ...f, collection_id: e.target.value }))}>
              {collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
      </FormDialog>

      <ConfirmDialog open={!!collDeleteId} onOpenChange={(o) => !o && setCollDeleteId(null)} title="Delete Collection" description="This will also delete all sub-collections within it." onConfirm={() => collDeleteId && deleteCollMut.mutate(collDeleteId)} loading={deleteCollMut.isPending} />
      <ConfirmDialog open={!!subDeleteId} onOpenChange={(o) => !o && setSubDeleteId(null)} title="Delete Sub-Collection" description="Permanently delete this sub-collection?" onConfirm={() => subDeleteId && deleteSubMut.mutate(subDeleteId)} loading={deleteSubMut.isPending} />
    </div>
  );
}
