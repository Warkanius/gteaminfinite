import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DataTable, Column } from "@/components/admin/DataTable";
import { FormDialog } from "@/components/admin/FormDialog";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";

type Team = Tables<"teams">;
type DomGame = Tables<"domination_games">;
type Run = Tables<"runs">;

export default function AdminTeams() {
  const qc = useQueryClient();

  // Teams
  const [teamForm, setTeamForm] = useState({ name: "", category: "domination", unlock_cost: 0 });
  const [teamEditId, setTeamEditId] = useState<string | null>(null);
  const [teamDialog, setTeamDialog] = useState(false);
  const [teamDeleteId, setTeamDeleteId] = useState<string | null>(null);

  const { data: teams = [], isLoading: teamsLoading } = useQuery({
    queryKey: ["admin-teams"], queryFn: async () => { const { data, error } = await supabase.from("teams").select("*").order("name"); if (error) throw error; return data; },
  });

  const teamSave = useMutation({
    mutationFn: async () => {
      if (teamEditId) { const { error } = await supabase.from("teams").update(teamForm).eq("id", teamEditId); if (error) throw error; }
      else { const { error } = await supabase.from("teams").insert(teamForm); if (error) throw error; }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-teams"] }); setTeamDialog(false); toast.success("Saved"); },
    onError: (e) => toast.error(e.message),
  });

  const teamDelete = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("teams").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-teams"] }); setTeamDeleteId(null); toast.success("Deleted"); },
    onError: (e) => toast.error(e.message),
  });

  // Domination
  const [domForm, setDomForm] = useState({ road_name: "", opponent_name: "", game_order: 1, difficulty_stars: 1, coin_reward: 0, pack_reward: "" });
  const [domEditId, setDomEditId] = useState<string | null>(null);
  const [domDialog, setDomDialog] = useState(false);
  const [domDeleteId, setDomDeleteId] = useState<string | null>(null);

  const { data: domGames = [], isLoading: domLoading } = useQuery({
    queryKey: ["admin-dom"], queryFn: async () => { const { data, error } = await supabase.from("domination_games").select("*").order("road_name").order("game_order"); if (error) throw error; return data; },
  });

  const domSave = useMutation({
    mutationFn: async () => {
      const payload = { ...domForm, pack_reward: domForm.pack_reward || null };
      if (domEditId) { const { error } = await supabase.from("domination_games").update(payload).eq("id", domEditId); if (error) throw error; }
      else { const { error } = await supabase.from("domination_games").insert(payload); if (error) throw error; }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-dom"] }); setDomDialog(false); toast.success("Saved"); },
    onError: (e) => toast.error(e.message),
  });

  const domDelete = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("domination_games").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-dom"] }); setDomDeleteId(null); toast.success("Deleted"); },
    onError: (e) => toast.error(e.message),
  });

  // Runs
  const [runForm, setRunForm] = useState({ name: "" });
  const [runEditId, setRunEditId] = useState<string | null>(null);
  const [runDialog, setRunDialog] = useState(false);
  const [runDeleteId, setRunDeleteId] = useState<string | null>(null);

  const { data: runs = [], isLoading: runsLoading } = useQuery({
    queryKey: ["admin-runs"], queryFn: async () => { const { data, error } = await supabase.from("runs").select("*").order("name"); if (error) throw error; return data; },
  });

  const runSave = useMutation({
    mutationFn: async () => {
      if (runEditId) { const { error } = await supabase.from("runs").update(runForm).eq("id", runEditId); if (error) throw error; }
      else { const { error } = await supabase.from("runs").insert(runForm); if (error) throw error; }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-runs"] }); setRunDialog(false); toast.success("Saved"); },
    onError: (e) => toast.error(e.message),
  });

  const runDelete = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("runs").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-runs"] }); setRunDeleteId(null); toast.success("Deleted"); },
    onError: (e) => toast.error(e.message),
  });

  const teamCols: Column<Team>[] = [
    { key: "name", label: "Name", sortable: true },
    { key: "category", label: "Category", sortable: true },
    { key: "unlock_cost", label: "Unlock Cost", sortable: true },
  ];

  const domCols: Column<DomGame>[] = [
    { key: "road_name", label: "Road", sortable: true },
    { key: "opponent_name", label: "Opponent", sortable: true },
    { key: "game_order", label: "Order", sortable: true },
    { key: "difficulty_stars", label: "Stars" },
    { key: "coin_reward", label: "Coins" },
    { key: "pack_reward", label: "Pack Reward", render: (r) => r.pack_reward ?? "—" },
  ];

  const runCols: Column<Run>[] = [{ key: "name", label: "Name", sortable: true }];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Teams, Domination & Runs</h1>
      <Tabs defaultValue="teams">
        <TabsList><TabsTrigger value="teams">Teams</TabsTrigger><TabsTrigger value="domination">Domination</TabsTrigger><TabsTrigger value="runs">Runs</TabsTrigger></TabsList>

        <TabsContent value="teams">
          <DataTable data={teams} columns={teamCols} isLoading={teamsLoading} searchKeys={["name"]} onAdd={() => { setTeamForm({ name: "", category: "domination", unlock_cost: 0 }); setTeamEditId(null); setTeamDialog(true); }} addLabel="Add Team"
            actions={(r) => (<div className="flex gap-1"><Button size="icon" variant="ghost" onClick={() => { setTeamForm({ name: r.name, category: r.category, unlock_cost: r.unlock_cost }); setTeamEditId(r.id); setTeamDialog(true); }}><Pencil className="h-4 w-4" /></Button><Button size="icon" variant="ghost" onClick={() => setTeamDeleteId(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></div>)} />
        </TabsContent>

        <TabsContent value="domination">
          <DataTable data={domGames} columns={domCols} isLoading={domLoading} searchKeys={["road_name", "opponent_name"]} onAdd={() => { setDomForm({ road_name: "", opponent_name: "", game_order: 1, difficulty_stars: 1, coin_reward: 0, pack_reward: "" }); setDomEditId(null); setDomDialog(true); }} addLabel="Add Game"
            actions={(r) => (<div className="flex gap-1"><Button size="icon" variant="ghost" onClick={() => { setDomForm({ road_name: r.road_name, opponent_name: r.opponent_name, game_order: r.game_order, difficulty_stars: r.difficulty_stars, coin_reward: r.coin_reward, pack_reward: r.pack_reward ?? "" }); setDomEditId(r.id); setDomDialog(true); }}><Pencil className="h-4 w-4" /></Button><Button size="icon" variant="ghost" onClick={() => setDomDeleteId(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></div>)} />
        </TabsContent>

        <TabsContent value="runs">
          <DataTable data={runs} columns={runCols} isLoading={runsLoading} searchKeys={["name"]} onAdd={() => { setRunForm({ name: "" }); setRunEditId(null); setRunDialog(true); }} addLabel="Add Run"
            actions={(r) => (<div className="flex gap-1"><Button size="icon" variant="ghost" onClick={() => { setRunForm({ name: r.name }); setRunEditId(r.id); setRunDialog(true); }}><Pencil className="h-4 w-4" /></Button><Button size="icon" variant="ghost" onClick={() => setRunDeleteId(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></div>)} />
        </TabsContent>
      </Tabs>

      {/* Team dialog */}
      <FormDialog open={teamDialog} onOpenChange={setTeamDialog} title={teamEditId ? "Edit Team" : "Add Team"} onSave={() => teamSave.mutate()} saving={teamSave.isPending}>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1"><Label>Name</Label><Input value={teamForm.name} onChange={(e) => setTeamForm((f) => ({ ...f, name: e.target.value }))} /></div>
          <div className="space-y-1"><Label>Category</Label><Input value={teamForm.category} onChange={(e) => setTeamForm((f) => ({ ...f, category: e.target.value }))} /></div>
          <div className="space-y-1"><Label>Unlock Cost</Label><Input type="number" value={teamForm.unlock_cost} onChange={(e) => setTeamForm((f) => ({ ...f, unlock_cost: Number(e.target.value) }))} /></div>
        </div>
      </FormDialog>

      {/* Dom dialog */}
      <FormDialog open={domDialog} onOpenChange={setDomDialog} title={domEditId ? "Edit Game" : "Add Game"} onSave={() => domSave.mutate()} saving={domSave.isPending}>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1"><Label>Road Name</Label><Input value={domForm.road_name} onChange={(e) => setDomForm((f) => ({ ...f, road_name: e.target.value }))} /></div>
          <div className="space-y-1"><Label>Opponent</Label><Input value={domForm.opponent_name} onChange={(e) => setDomForm((f) => ({ ...f, opponent_name: e.target.value }))} /></div>
          <div className="space-y-1"><Label>Order</Label><Input type="number" value={domForm.game_order} onChange={(e) => setDomForm((f) => ({ ...f, game_order: Number(e.target.value) }))} /></div>
          <div className="space-y-1"><Label>Stars</Label><Input type="number" min={1} max={5} value={domForm.difficulty_stars} onChange={(e) => setDomForm((f) => ({ ...f, difficulty_stars: Number(e.target.value) }))} /></div>
          <div className="space-y-1"><Label>Coin Reward</Label><Input type="number" value={domForm.coin_reward} onChange={(e) => setDomForm((f) => ({ ...f, coin_reward: Number(e.target.value) }))} /></div>
          <div className="space-y-1"><Label>Pack Reward</Label><Input value={domForm.pack_reward} onChange={(e) => setDomForm((f) => ({ ...f, pack_reward: e.target.value }))} placeholder="Optional" /></div>
        </div>
      </FormDialog>

      {/* Run dialog */}
      <FormDialog open={runDialog} onOpenChange={setRunDialog} title={runEditId ? "Edit Run" : "Add Run"} onSave={() => runSave.mutate()} saving={runSave.isPending}>
        <div className="space-y-1"><Label>Name</Label><Input value={runForm.name} onChange={(e) => setRunForm((f) => ({ ...f, name: e.target.value }))} /></div>
      </FormDialog>

      <ConfirmDialog open={!!teamDeleteId} onOpenChange={(o) => !o && setTeamDeleteId(null)} title="Delete Team" description="This will permanently delete this team." onConfirm={() => teamDeleteId && teamDelete.mutate(teamDeleteId)} loading={teamDelete.isPending} />
      <ConfirmDialog open={!!domDeleteId} onOpenChange={(o) => !o && setDomDeleteId(null)} title="Delete Game" description="This will permanently delete this domination game." onConfirm={() => domDeleteId && domDelete.mutate(domDeleteId)} loading={domDelete.isPending} />
      <ConfirmDialog open={!!runDeleteId} onOpenChange={(o) => !o && setRunDeleteId(null)} title="Delete Run" description="This will permanently delete this run." onConfirm={() => runDeleteId && runDelete.mutate(runDeleteId)} loading={runDelete.isPending} />
    </div>
  );
}
