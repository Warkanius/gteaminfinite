import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DataTable, Column } from "@/components/admin/DataTable";
import { FormDialog } from "@/components/admin/FormDialog";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { PlayerCombobox } from "@/components/admin/PlayerCombobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Pencil, Trash2, Plus, X, Search, ChevronDown, Users } from "lucide-react";
import { toast } from "sonner";

type RewardType = "card" | "coins" | "gems" | "pack";

interface RewardForm {
  reward_type: RewardType;
  reward_card_id: string;
  reward_coins: number;
  reward_gems: number;
  reward_pack_id: string;
}

const EMPTY_REWARD: RewardForm = {
  reward_type: "card",
  reward_card_id: "",
  reward_coins: 0,
  reward_gems: 0,
  reward_pack_id: "",
};

export default function AdminCollectionSets() {
  const qc = useQueryClient();

  // ── Collections ──
  const [collForm, setCollForm] = useState<{ name: string; description: string } & RewardForm>({
    name: "",
    description: "",
    ...EMPTY_REWARD,
  });
  const [collEditId, setCollEditId] = useState<string | null>(null);
  const [collDialogOpen, setCollDialogOpen] = useState(false);
  const [collDeleteId, setCollDeleteId] = useState<string | null>(null);

  // ── Sub-Collections ──
  const [subForm, setSubForm] = useState<{ name: string; collection_id: string } & RewardForm>({
    name: "",
    collection_id: "",
    ...EMPTY_REWARD,
  });
  const [subEditId, setSubEditId] = useState<string | null>(null);
  const [subDialogOpen, setSubDialogOpen] = useState(false);
  const [subDeleteId, setSubDeleteId] = useState<string | null>(null);

  // ── Roster viewer state ──
  const [rosterTarget, setRosterTarget] = useState<
    | { type: "collection" | "sub_collection"; id: string; name: string }
    | null
  >(null);

  const { data: collections = [], isLoading: collLoading } = useQuery({
    queryKey: ["admin-collection-sets"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("collections")
        .select("*")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: subCollections = [], isLoading: subLoading } = useQuery({
    queryKey: ["admin-sub-collection-sets"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sub_collections")
        .select("*, collections(name)")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  // Roster of players in the currently-viewed collection or sub-collection
  const { data: rosterPlayers = [], isLoading: rosterLoading } = useQuery({
    queryKey: ["collection-roster", rosterTarget?.type, rosterTarget?.id],
    enabled: !!rosterTarget,
    queryFn: async () => {
      if (!rosterTarget) return [];
      const col = rosterTarget.type === "collection" ? "collection_id" : "sub_collection_id";
      const { data, error } = await supabase
        .from("player_cards")
        .select("id, name, rating, position1, is_collection_reward, gem_tier_id, gem_tiers(name, color)")
        .eq(col, rosterTarget.id)
        .order("rating", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const removeFromCollectionMut = useMutation({
    mutationFn: async (cardId: string) => {
      if (!rosterTarget) return;
      const update: any = rosterTarget.type === "collection"
        ? { collection_id: null, sub_collection_id: null, is_collection_reward: false }
        : { sub_collection_id: null };
      const { error } = await supabase.from("player_cards").update(update).eq("id", cardId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["collection-roster"] });
      qc.invalidateQueries({ queryKey: ["admin-all-cards-lite"] });
      toast.success("Removed");
    },
    onError: (e: any) => toast.error(e.message),
  });


  // Build payload helper for reward fields
  const buildRewardPayload = (f: RewardForm) => ({
    reward_type: f.reward_type,
    reward_card_id: f.reward_type === "card" && f.reward_card_id ? f.reward_card_id : null,
    reward_coins: f.reward_type === "coins" ? Number(f.reward_coins) || 0 : 0,
    reward_gems: f.reward_type === "gems" ? Number(f.reward_gems) || 0 : 0,
    reward_pack_id: f.reward_type === "pack" && f.reward_pack_id ? f.reward_pack_id : null,
  });

  // Collection mutations
  const saveCollMut = useMutation({
    mutationFn: async () => {
      const reward = buildRewardPayload(collForm);
      const payload: any = {
        name: collForm.name,
        description: collForm.description || null,
        reward_type: reward.reward_type,
        reward_coins: reward.reward_coins,
        reward_gems: reward.reward_gems,
        reward_pack_id: reward.reward_pack_id,
      };
      if (collEditId) {
        const { error } = await supabase.from("collections").update(payload).eq("id", collEditId);
        if (error) throw error;
        // Card reward is stored on player_cards.is_collection_reward + collection_id, handled separately
        if (reward.reward_type === "card" && reward.reward_card_id) {
          // Clear any prior card reward for this collection
          await supabase.from("player_cards").update({ is_collection_reward: false }).eq("collection_id", collEditId).eq("is_collection_reward", true);
          await supabase.from("player_cards").update({ collection_id: collEditId, sub_collection_id: null, is_collection_reward: true }).eq("id", reward.reward_card_id);
        } else if (reward.reward_type !== "card") {
          await supabase.from("player_cards").update({ is_collection_reward: false }).eq("collection_id", collEditId).eq("is_collection_reward", true);
        }
      } else {
        const { data, error } = await supabase.from("collections").insert(payload).select("id").single();
        if (error) throw error;
        if (reward.reward_type === "card" && reward.reward_card_id && data) {
          await supabase.from("player_cards").update({ collection_id: data.id, sub_collection_id: null, is_collection_reward: true }).eq("id", reward.reward_card_id);
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-collection-sets"] });
      qc.invalidateQueries({ queryKey: ["admin-all-cards-lite"] });
      setCollDialogOpen(false);
      toast.success("Saved");
    },
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
      const reward = buildRewardPayload(subForm);
      const payload: any = {
        name: subForm.name,
        collection_id: subForm.collection_id,
        reward_type: reward.reward_type,
        reward_coins: reward.reward_coins,
        reward_gems: reward.reward_gems,
        reward_pack_id: reward.reward_pack_id,
      };
      if (subEditId) {
        const { error } = await supabase.from("sub_collections").update(payload).eq("id", subEditId);
        if (error) throw error;
        if (reward.reward_type === "card" && reward.reward_card_id) {
          await supabase.from("player_cards").update({ is_collection_reward: false }).eq("sub_collection_id", subEditId).eq("is_collection_reward", true);
          await supabase.from("player_cards").update({ collection_id: subForm.collection_id, sub_collection_id: subEditId, is_collection_reward: true }).eq("id", reward.reward_card_id);
        } else if (reward.reward_type !== "card") {
          await supabase.from("player_cards").update({ is_collection_reward: false }).eq("sub_collection_id", subEditId).eq("is_collection_reward", true);
        }
      } else {
        const { data, error } = await supabase.from("sub_collections").insert(payload).select("id").single();
        if (error) throw error;
        if (reward.reward_type === "card" && reward.reward_card_id && data) {
          await supabase.from("player_cards").update({ collection_id: subForm.collection_id, sub_collection_id: data.id, is_collection_reward: true }).eq("id", reward.reward_card_id);
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-sub-collection-sets"] });
      qc.invalidateQueries({ queryKey: ["admin-all-cards-lite"] });
      setSubDialogOpen(false);
      toast.success("Saved");
    },
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

      {/* Bulk Assign Players */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            Bulk Assign Players
            <Badge variant="secondary">{selectedPlayerIds.size} selected</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Target Collection *</Label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={targetCollId}
                onChange={e => { setTargetCollId(e.target.value); setTargetSubId(""); }}
              >
                <option value="">— Select collection —</option>
                {collections.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label>Target Sub-Collection (optional)</Label>
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={targetSubId}
                onChange={e => handleSubChange(e.target.value)}
              >
                <option value="">— None (collection only) —</option>
                {(subCollections as any[])
                  .filter((s: any) => !targetCollId || s.collection_id === targetCollId)
                  .map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>

          <Tabs value={sourceTab} onValueChange={setSourceTab}>
            <TabsList className="grid grid-cols-4 w-full">
              <TabsTrigger value="search">Search</TabsTrigger>
              <TabsTrigger value="pack">From Pack</TabsTrigger>
              <TabsTrigger value="run">From Run</TabsTrigger>
              <TabsTrigger value="team">From Team</TabsTrigger>
            </TabsList>

            <TabsContent value="search" className="space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Search player by name…"
                  value={playerSearch}
                  onChange={e => setPlayerSearch(e.target.value)}
                />
              </div>
              <div className="max-h-64 overflow-y-auto rounded-md border border-border divide-y divide-border">
                {filteredSearchPlayers.length === 0 && (
                  <div className="p-3 text-sm text-muted-foreground">No players found.</div>
                )}
                {filteredSearchPlayers.map((p: any) => (
                  <label key={p.id} className="flex items-center gap-2 px-3 py-2 hover:bg-muted/40 cursor-pointer">
                    <Checkbox checked={selectedPlayerIds.has(p.id)} onCheckedChange={() => toggleSelected(p.id)} />
                    <span className="text-sm flex-1">{p.name}</span>
                    <Badge variant="outline" className="text-xs">{p.rating}</Badge>
                  </label>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="pack" className="space-y-2">
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={sourcePackId}
                onChange={e => setSourcePackId(e.target.value)}
              >
                <option value="">— Select pack —</option>
                {packs.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {sourcePackId && (
                <>
                  <Button size="sm" variant="secondary" onClick={() => addAll(packSourcePlayers as any[])} disabled={!packSourcePlayers.length}>
                    <Plus className="h-3 w-3 mr-1" /> Add all {packSourcePlayers.length}
                  </Button>
                  <div className="max-h-48 overflow-y-auto rounded-md border border-border divide-y divide-border">
                    {(packSourcePlayers as any[]).map((p: any) => (
                      <label key={p.id} className="flex items-center gap-2 px-3 py-2 hover:bg-muted/40 cursor-pointer">
                        <Checkbox checked={selectedPlayerIds.has(p.id)} onCheckedChange={() => toggleSelected(p.id)} />
                        <span className="text-sm flex-1">{p.name}</span>
                        <Badge variant="outline" className="text-xs">{p.rating}</Badge>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </TabsContent>

            <TabsContent value="run" className="space-y-2">
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={sourceRunId}
                onChange={e => setSourceRunId(e.target.value)}
              >
                <option value="">— Select run —</option>
                {runs.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              {sourceRunId && (
                <>
                  <Button size="sm" variant="secondary" onClick={() => addAll(runSourcePlayers as any[])} disabled={!runSourcePlayers.length}>
                    <Plus className="h-3 w-3 mr-1" /> Add all {runSourcePlayers.length}
                  </Button>
                  <div className="max-h-48 overflow-y-auto rounded-md border border-border divide-y divide-border">
                    {(runSourcePlayers as any[]).map((p: any) => (
                      <label key={p.id} className="flex items-center gap-2 px-3 py-2 hover:bg-muted/40 cursor-pointer">
                        <Checkbox checked={selectedPlayerIds.has(p.id)} onCheckedChange={() => toggleSelected(p.id)} />
                        <span className="text-sm flex-1">{p.name}</span>
                        <Badge variant="outline" className="text-xs">{p.rating}</Badge>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </TabsContent>

            <TabsContent value="team" className="space-y-2">
              <select
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={sourceTeamId}
                onChange={e => setSourceTeamId(e.target.value)}
              >
                <option value="">— Select team —</option>
                {teams.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              {sourceTeamId && (
                <>
                  <Button size="sm" variant="secondary" onClick={() => addAll(teamSourcePlayers as any[])} disabled={!teamSourcePlayers.length}>
                    <Plus className="h-3 w-3 mr-1" /> Add all {teamSourcePlayers.length}
                  </Button>
                  <div className="max-h-48 overflow-y-auto rounded-md border border-border divide-y divide-border">
                    {(teamSourcePlayers as any[]).map((p: any) => (
                      <label key={p.id} className="flex items-center gap-2 px-3 py-2 hover:bg-muted/40 cursor-pointer">
                        <Checkbox checked={selectedPlayerIds.has(p.id)} onCheckedChange={() => toggleSelected(p.id)} />
                        <span className="text-sm flex-1">{p.name}</span>
                        <Badge variant="outline" className="text-xs">{p.rating}</Badge>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </TabsContent>
          </Tabs>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Staged players ({selectedPlayerIds.size})</Label>
              {selectedPlayerIds.size > 0 && (
                <Button size="sm" variant="ghost" onClick={() => setSelectedPlayerIds(new Set())}>
                  Clear all
                </Button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5 min-h-[44px] p-2 rounded-md border border-dashed border-border">
              {selectedPlayerIds.size === 0 && (
                <span className="text-sm text-muted-foreground">No players staged. Use search or import above.</span>
              )}
              {Array.from(selectedPlayerIds).map(id => {
                const p = playerById.get(id);
                return (
                  <Badge key={id} variant="secondary" className="gap-1 pr-1">
                    {p?.name ?? id.slice(0, 6)}
                    <button onClick={() => toggleSelected(id)} className="hover:bg-destructive/20 rounded p-0.5">
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                );
              })}
            </div>
          </div>

          <Button
            className="w-full"
            disabled={!targetCollId || selectedPlayerIds.size === 0 || bulkAssignMut.isPending}
            onClick={() => bulkAssignMut.mutate()}
          >
            {bulkAssignMut.isPending ? "Assigning…" : `Assign ${selectedPlayerIds.size} players`}
          </Button>
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
