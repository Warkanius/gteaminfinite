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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pencil, Trash2, Plus, Users } from "lucide-react";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";
import { RunRosterManager } from "@/components/admin/RunRosterManager";

type Team = Tables<"teams">;
type DomGame = Tables<"domination_games">;
type Run = Tables<"runs">;

export default function AdminTeams() {
  const qc = useQueryClient();

  // Fetch Packs for Rewards
  const { data: packs = [] } = useQuery({
    queryKey: ["admin-packs-lite"],
    queryFn: async () => {
      const { data, error } = await supabase.from("packs").select("id, name, pack_type").order("name");
      if (error) throw error;
      return data;
    },
  });

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
    queryKey: ["admin-dom"], queryFn: async () => { const { data, error } = await supabase.from("domination_games").select("*").order("game_order"); if (error) throw error; return data; },
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
  const [runForm, setRunForm] = useState<{name: string; target_score: number; team_id: string | null; milestones: any[] | string}>({ name: "", target_score: 21, team_id: null, milestones: [] });
  const [runEditId, setRunEditId] = useState<string | null>(null);
  const [runDialog, setRunDialog] = useState(false);
  const [runDeleteId, setRunDeleteId] = useState<string | null>(null);

  const { data: runs = [], isLoading: runsLoading } = useQuery({
    queryKey: ["admin-runs"], queryFn: async () => { const { data, error } = await supabase.from("runs").select("*").order("name"); if (error) throw error; return data; },
  });

  const runSave = useMutation({
    mutationFn: async () => {
      let parsedMilestones: any;
      try {
        parsedMilestones = typeof runForm.milestones === 'string' ? JSON.parse(runForm.milestones) : runForm.milestones;
      } catch {
        throw new Error("Milestones JSON is invalid. Please fix the JSON before saving.");
      }
      const payload = {
        name: runForm.name,
        target_score: runForm.target_score,
        team_id: runForm.team_id || null,
        milestones: parsedMilestones,
      };
      if (runEditId) { const { error } = await supabase.from("runs").update(payload).eq("id", runEditId); if (error) throw error; }
      else { const { error } = await supabase.from("runs").insert(payload); if (error) throw error; }
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
    { key: "game_order", label: "Order", sortable: true },
    { key: "opponent_name", label: "Opponent" },
    { key: "difficulty_stars", label: "Stars" },
    { key: "coin_reward", label: "Coins" },
    { key: "pack_reward", label: "Pack Reward", render: (r) => r.pack_reward ?? "—" },
  ];

  const runCols: Column<Run>[] = [
    { key: "name", label: "Name", sortable: true },
    { key: "target_score" as any, label: "Score", render: (r: any) => r.target_score },
    { key: "milestones" as any, label: "Milestones", render: (r: any) => `${Array.isArray(r.milestones) ? r.milestones.length : 0} Ranks` }
  ];

  // Group Domination Games by Road
  const groupedDomGames = domGames.reduce((acc, game) => {
    if (!acc[game.road_name]) acc[game.road_name] = [];
    acc[game.road_name].push(game);
    return acc;
  }, {} as Record<string, DomGame[]>);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Match Configurations</h1>
        <p className="text-muted-foreground mt-2">Manage teams, domination roads, and endless run settings.</p>
      </div>

      <Tabs defaultValue="domination" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="domination">Domination</TabsTrigger>
          <TabsTrigger value="teams">Teams</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
        </TabsList>

        <TabsContent value="domination" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div>
                <CardTitle>Domination Roads</CardTitle>
                <CardDescription>Grouped sequences of challenges and rewards</CardDescription>
              </div>
              <Button onClick={() => { 
                setDomForm({ road_name: "", opponent_name: "", game_order: 1, difficulty_stars: 1, coin_reward: 0, pack_reward: "" }); 
                setDomEditId(null); 
                setDomDialog(true); 
              }}>
                <Plus className="h-4 w-4 mr-2" /> Add Game
              </Button>
            </CardHeader>
            <CardContent>
              {domLoading ? (
                <div className="py-8 text-center text-muted-foreground">Loading games...</div>
              ) : Object.keys(groupedDomGames).length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">No domination games found.</div>
              ) : (
                <Accordion type="multiple" defaultValue={Object.keys(groupedDomGames)} className="w-full">
                  {Object.entries(groupedDomGames).map(([road, games]) => (
                    <AccordionItem key={road} value={road} className="border bg-card mb-4 rounded-lg overflow-hidden">
                      <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/50 data-[state=open]:border-b">
                        <div className="flex items-center justify-between w-full pr-4">
                          <span className="font-semibold text-lg">{road}</span>
                          <span className="text-sm text-muted-foreground font-normal">{games.length} Games</span>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="p-0">
                        <DataTable 
                          data={games} 
                          columns={domCols} 
                          searchKeys={["opponent_name"]} 
                          actions={(r) => (
                            <div className="flex gap-1 justify-end">
                              <Button size="icon" variant="ghost" onClick={() => { 
                                setDomForm({ 
                                  road_name: r.road_name, 
                                  opponent_name: r.opponent_name, 
                                  game_order: r.game_order, 
                                  difficulty_stars: r.difficulty_stars, 
                                  coin_reward: r.coin_reward, 
                                  pack_reward: r.pack_reward ?? "" 
                                }); 
                                setDomEditId(r.id); 
                                setDomDialog(true); 
                              }}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button size="icon" variant="ghost" onClick={() => setDomDeleteId(r.id)}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          )} 
                        />
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="teams">
          <Card>
            <CardHeader>
              <CardTitle>Opponent Teams</CardTitle>
              <CardDescription>Manage CPU opponents and unlockable rosters.</CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable data={teams} columns={teamCols} isLoading={teamsLoading} searchKeys={["name"]} onAdd={() => { setTeamForm({ name: "", category: "domination", unlock_cost: 0 }); setTeamEditId(null); setTeamDialog(true); }} addLabel="Add Team"
                actions={(r) => (<div className="flex gap-1"><Button size="icon" variant="ghost" onClick={() => { setTeamForm({ name: r.name, category: r.category, unlock_cost: r.unlock_cost }); setTeamEditId(r.id); setTeamDialog(true); }}><Pencil className="h-4 w-4" /></Button><Button size="icon" variant="ghost" onClick={() => setTeamDeleteId(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></div>)} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="runs">
          <Card>
            <CardHeader>
              <CardTitle>Endless Runs</CardTitle>
              <CardDescription>Configure distinct continuous gauntlets.</CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable data={runs} columns={runCols} isLoading={runsLoading} searchKeys={["name"]} onAdd={() => { setRunForm({ name: "", target_score: 21, team_id: null, milestones: [] }); setRunEditId(null); setRunDialog(true); }} addLabel="Add Run"
                actions={(r: any) => (<div className="flex gap-1"><Button size="icon" variant="ghost" onClick={() => { setRunForm({ name: r.name, target_score: r.target_score || 21, team_id: r.team_id, milestones: r.milestones || [] }); setRunEditId(r.id); setRunDialog(true); }}><Pencil className="h-4 w-4" /></Button><Button size="icon" variant="ghost" onClick={() => setRunDeleteId(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></div>)} />
            </CardContent>
          </Card>
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
      <FormDialog open={domDialog} onOpenChange={setDomDialog} title={domEditId ? "Edit Domination Game" : "Add Domination Game"} onSave={() => domSave.mutate()} saving={domSave.isPending}>
        <div className="space-y-6">
          <div className="space-y-4 p-4 border rounded-lg bg-card">
            <h3 className="font-semibold flex items-center text-sm uppercase tracking-wider text-muted-foreground">Match Setup</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Road Name</Label>
                <Input value={domForm.road_name} onChange={(e) => setDomForm((f) => ({ ...f, road_name: e.target.value }))} placeholder="e.g. Seirin High" />
              </div>
              <div className="space-y-2">
                <Label>Opponent Team</Label>
                <Input 
                  list="team-names" 
                  value={domForm.opponent_name} 
                  onChange={(e) => setDomForm((f) => ({ ...f, opponent_name: e.target.value }))} 
                  placeholder="Type or select team..."
                />
                <datalist id="team-names">
                  {teams.map(t => <option key={t.id} value={t.name} />)}
                </datalist>
              </div>
              <div className="space-y-2">
                <Label>Game Order</Label>
                <Input type="number" min={1} value={domForm.game_order} onChange={(e) => setDomForm((f) => ({ ...f, game_order: Number(e.target.value) }))} />
              </div>
            </div>
          </div>

          <div className="space-y-4 p-4 border rounded-lg bg-card">
            <div className="flex justify-between items-center">
              <h3 className="font-semibold flex items-center text-sm uppercase tracking-wider text-muted-foreground">Difficulty</h3>
              <span className="font-bold text-lg">{domForm.difficulty_stars} {domForm.difficulty_stars === 1 ? 'Star' : 'Stars'}</span>
            </div>
            <div className="pt-2 pb-4 px-2">
              <Slider 
                min={1} max={5} step={1} 
                value={[domForm.difficulty_stars]} 
                onValueChange={([val]) => setDomForm((f) => ({ ...f, difficulty_stars: val }))} 
              />
            </div>
          </div>

          <div className="space-y-4 p-4 border rounded-lg bg-card">
            <h3 className="font-semibold flex items-center text-sm uppercase tracking-wider text-muted-foreground">Rewards</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Coin Reward</Label>
                <Input type="number" min={0} value={domForm.coin_reward} onChange={(e) => setDomForm((f) => ({ ...f, coin_reward: Number(e.target.value) }))} />
              </div>
              <div className="space-y-2">
                <Label>Pack Reward</Label>
                <Select value={domForm.pack_reward || "none"} onValueChange={(val) => setDomForm(f => ({ ...f, pack_reward: val === "none" ? "" : val }))}>
                  <SelectTrigger><SelectValue placeholder="No Pack Reward" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Pack</SelectItem>
                    {packs.map(p => (
                      <SelectItem key={p.id} value={p.pack_type || p.name}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>
      </FormDialog>

      {/* Run dialog */}
      <FormDialog open={runDialog} onOpenChange={setRunDialog} title={runEditId ? "Edit Run" : "Add Run"} onSave={() => runSave.mutate()} saving={runSave.isPending}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2"><Label>Name</Label><Input value={runForm.name} onChange={(e) => setRunForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. 3v3 Endless" /></div>
            <div className="space-y-2"><Label>Target Score</Label><Input type="number" value={runForm.target_score} onChange={(e) => setRunForm((f) => ({ ...f, target_score: Number(e.target.value) }))} /></div>
          </div>

          {runEditId && (
            <div className="space-y-2 p-4 border rounded-lg bg-card">
              <h3 className="font-semibold flex items-center gap-2 text-sm uppercase tracking-wider text-muted-foreground">
                <Users className="h-3.5 w-3.5" /> Opponent Roster
              </h3>
              <RunRosterManager runId={runEditId} />
            </div>
          )}

          {!runEditId && (
            <p className="text-xs text-muted-foreground border rounded-md p-3 bg-muted/30">
              💡 Save the run first, then edit it to manage the opponent roster.
            </p>
          )}

          <div className="space-y-2">
            <Label>Milestone Rewards (JSON)</Label>
            <textarea 
              className="flex min-h-[150px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 font-mono"
              value={typeof runForm.milestones === 'string' ? runForm.milestones : JSON.stringify(runForm.milestones, null, 2)}
              onChange={(e) => {
                setRunForm(f => ({...f, milestones: e.target.value}));
              }}
              onBlur={(e) => {
                try {
                  const parsed = JSON.parse(e.target.value);
                  setRunForm(f => ({...f, milestones: parsed}));
                } catch {
                  // Ignore on blur if it's invalid
                }
              }}
              placeholder='[
  {
    "wins_required": 3,
    "coin_reward": 500,
    "gem_reward": 50,
    "pack_reward": "basic"
  }
]'
            />
            <p className="text-xs text-muted-foreground">Define scaling rewards as an array of objects.</p>
          </div>
        </div>
      </FormDialog>

      <ConfirmDialog open={!!teamDeleteId} onOpenChange={(o) => !o && setTeamDeleteId(null)} title="Delete Team" description="This will permanently delete this team." onConfirm={() => teamDeleteId && teamDelete.mutate(teamDeleteId)} loading={teamDelete.isPending} />
      <ConfirmDialog open={!!domDeleteId} onOpenChange={(o) => !o && setDomDeleteId(null)} title="Delete Game" description="This will permanently delete this domination game." onConfirm={() => domDeleteId && domDelete.mutate(domDeleteId)} loading={domDelete.isPending} />
      <ConfirmDialog open={!!runDeleteId} onOpenChange={(o) => !o && setRunDeleteId(null)} title="Delete Run" description="This will permanently delete this run." onConfirm={() => runDeleteId && runDelete.mutate(runDeleteId)} loading={runDelete.isPending} />
    </div>
  );
}
