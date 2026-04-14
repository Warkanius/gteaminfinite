import { useState } from "react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Pencil, Trash2, Copy } from "lucide-react";
import { toast } from "sonner";
import { COLOR_BUCKET_NAMES } from "@/lib/colorBucket";

interface LineupRestrictions {
  positions?: string[];
  badge_ids?: string[];
  trait_ids?: string[];
  gem_tier_ids?: string[];
  team_ids?: string[];
  collection_ids?: string[];
  sub_collection_ids?: string[];
  card_colors?: string[];
}

interface ChallengeForm {
  name: string;
  description: string;
  challenge_type: string;
  opponent_team_id: string;
  win_condition: string;
  win_by_amount: number;
  series_length: number;
  series_win_coins: number;
  series_loss_coins: number;
  stat_limit_player_id: string;
  stat_limit_stat: string;
  stat_limit_value: number;
  coin_reward: number;
  gem_reward: number;
  pack_reward: string;
  card_reward_id: string;
  prerequisite_id: string;
  spotlight_group: string;
  sort_order: number;
  lineup_restrictions: LineupRestrictions;
}

const POSITIONS = ["PG", "SG", "SF", "PF", "C"];

const empty = (): ChallengeForm => ({
  name: "", description: "", challenge_type: "single",
  opponent_team_id: "", win_condition: "win",
  win_by_amount: 0, series_length: 7,
  series_win_coins: 0, series_loss_coins: 0,
  stat_limit_player_id: "", stat_limit_stat: "", stat_limit_value: 0,
  coin_reward: 0, gem_reward: 0, pack_reward: "", card_reward_id: "",
  prerequisite_id: "", spotlight_group: "", sort_order: 0,
  lineup_restrictions: {},
});

const STATS = ["3pt", "mid", "fin", "dnk", "ast", "stl", "reb", "blk", "int"];

export default function AdminChallenges() {
  const qc = useQueryClient();
  const [form, setForm] = useState(empty());
  const [editId, setEditId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: challenges = [], isLoading } = useQuery({
    queryKey: ["admin-challenges"],
    queryFn: async () => {
      const { data, error } = await supabase.from("challenges").select("*").order("sort_order").order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: teams = [] } = useQuery({
    queryKey: ["admin-teams-list"],
    queryFn: async () => {
      const { data, error } = await supabase.from("teams").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: players = [] } = useQuery({
    queryKey: ["admin-players-list"],
    queryFn: async () => {
      const { data, error } = await supabase.from("player_cards").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: packs = [] } = useQuery({
    queryKey: ["admin-packs-list"],
    queryFn: async () => {
      const { data, error } = await supabase.from("packs").select("id, name, pack_type").order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: badges = [] } = useQuery({
    queryKey: ["admin-badges-list"],
    queryFn: async () => {
      const { data } = await supabase.from("badges").select("id, name").order("name");
      return data ?? [];
    },
  });

  const { data: traits = [] } = useQuery({
    queryKey: ["admin-traits-list"],
    queryFn: async () => {
      const { data } = await supabase.from("signature_traits").select("id, name").order("name");
      return data ?? [];
    },
  });

  const { data: gemTiers = [] } = useQuery({
    queryKey: ["admin-gem-tiers-list"],
    queryFn: async () => {
      const { data } = await supabase.from("gem_tiers").select("id, name").order("sort_order");
      return data ?? [];
    },
  });

  const { data: collections = [] } = useQuery({
    queryKey: ["admin-collections-list"],
    queryFn: async () => {
      const { data } = await supabase.from("collections").select("id, name").order("name");
      return data ?? [];
    },
  });

  const { data: subCollections = [] } = useQuery({
    queryKey: ["admin-sub-collections-list"],
    queryFn: async () => {
      const { data } = await supabase.from("sub_collections").select("id, name, collection_id").order("name");
      return data ?? [];
    },
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      const lr = form.lineup_restrictions;
      const hasRestrictions = lr && Object.values(lr).some((v: any) => Array.isArray(v) && v.length > 0);

      const payload: any = {
        name: form.name,
        description: form.description || null,
        challenge_type: form.challenge_type,
        opponent_team_id: form.opponent_team_id || null,
        win_condition: form.win_condition,
        win_by_amount: form.win_condition === "win_by" ? form.win_by_amount : null,
        series_length: form.win_condition === "series" ? form.series_length : null,
        series_win_coins: form.win_condition === "series" ? form.series_win_coins : 0,
        series_loss_coins: form.win_condition === "series" ? form.series_loss_coins : 0,
        stat_limit_player_id: form.win_condition === "stat_limit" ? (form.stat_limit_player_id || null) : null,
        stat_limit_stat: form.win_condition === "stat_limit" ? (form.stat_limit_stat || null) : null,
        stat_limit_value: form.win_condition === "stat_limit" ? form.stat_limit_value : null,
        coin_reward: form.coin_reward,
        gem_reward: form.gem_reward,
        pack_reward: form.pack_reward || null,
        card_reward_id: form.card_reward_id || null,
        prerequisite_id: form.prerequisite_id || null,
        spotlight_group: form.challenge_type === "spotlight" ? (form.spotlight_group || null) : null,
        sort_order: form.sort_order,
        lineup_restrictions: hasRestrictions ? lr : null,
      };
      if (editId) {
        const { error } = await supabase.from("challenges").update(payload).eq("id", editId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("challenges").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-challenges"] }); setDialogOpen(false); toast.success("Saved"); },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("challenges").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-challenges"] }); setDeleteId(null); toast.success("Deleted"); },
    onError: (e: any) => toast.error(e.message),
  });

  const openEdit = (r: any) => {
    setForm({
      name: r.name,
      description: r.description ?? "",
      challenge_type: r.challenge_type,
      opponent_team_id: r.opponent_team_id ?? "",
      win_condition: r.win_condition ?? "win",
      win_by_amount: r.win_by_amount ?? 0,
      series_length: r.series_length ?? 7,
      series_win_coins: r.series_win_coins ?? 0,
      series_loss_coins: r.series_loss_coins ?? 0,
      stat_limit_player_id: r.stat_limit_player_id ?? "",
      stat_limit_stat: r.stat_limit_stat ?? "",
      stat_limit_value: r.stat_limit_value ?? 0,
      coin_reward: r.coin_reward,
      gem_reward: r.gem_reward,
      pack_reward: r.pack_reward ?? "",
      card_reward_id: r.card_reward_id ?? "",
      prerequisite_id: r.prerequisite_id ?? "",
      spotlight_group: r.spotlight_group ?? "",
      sort_order: r.sort_order ?? 0,
      lineup_restrictions: r.lineup_restrictions ?? {},
    });
    setEditId(r.id);
    setDialogOpen(true);
  };

  const openDuplicate = (r: any) => {
    openEdit({ ...r, name: `${r.name} (Copy)` });
    setEditId(null);
  };

  const teamName = (id: string | null) => teams.find(t => t.id === id)?.name ?? "—";
  const playerName = (id: string | null) => players.find(p => p.id === id)?.name ?? "";
  const challengeName = (id: string | null) => challenges.find(c => c.id === id)?.name ?? "";

  const formatWinCondition = (r: any) => {
    switch (r.win_condition) {
      case "win_by": return `Win by ${r.win_by_amount}+`;
      case "series": return `Best of ${r.series_length}`;
      case "stat_limit": return `Hold ${playerName(r.stat_limit_player_id) || "player"} to ${r.stat_limit_value} ${r.stat_limit_stat?.toUpperCase() ?? ""}`;
      default: return "Win";
    }
  };

  const formatRewards = (r: any) => {
    const parts: string[] = [];
    if (r.coin_reward) parts.push(`${r.coin_reward} coins`);
    if (r.gem_reward) parts.push(`${r.gem_reward} gems`);
    if (r.pack_reward === "random_standard") parts.push("🎲 Random Pack");
    else if (r.pack_reward === "random_standard_box") parts.push("🎲 Random Box");
    else if (r.pack_reward) { const p = packs.find(p => p.id === r.pack_reward); parts.push(`📦 ${p?.name ?? "Pack"}`); }
    if (r.card_reward_id) parts.push(`🃏 ${playerName(r.card_reward_id)}`);
    return parts.join(" + ") || "—";
  };

  // Helpers for multi-select restriction toggles
  const toggleRestrictionItem = (field: keyof LineupRestrictions, id: string) => {
    setForm(prev => {
      const current = (prev.lineup_restrictions[field] as string[]) ?? [];
      const next = current.includes(id) ? current.filter(x => x !== id) : [...current, id];
      return { ...prev, lineup_restrictions: { ...prev.lineup_restrictions, [field]: next } };
    });
  };

  const columns: Column<any>[] = [
    { key: "name", label: "Name", sortable: true },
    { key: "challenge_type", label: "Type", sortable: true },
    { key: "win_condition", label: "Win Condition", render: (r) => formatWinCondition(r) },
    { key: "opponent_team_id", label: "Opponent", render: (r) => teamName(r.opponent_team_id) },
    { key: "coin_reward", label: "Rewards", render: (r) => <span className="text-xs">{formatRewards(r)}</span> },
  ];

  const f = (key: keyof ChallengeForm, value: any) => setForm(prev => ({ ...prev, [key]: value }));

  const lr = form.lineup_restrictions;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Challenges Manager</h1>
      <DataTable
        data={challenges}
        columns={columns}
        isLoading={isLoading}
        searchKeys={["name"]}
        onAdd={() => { setForm(empty()); setEditId(null); setDialogOpen(true); }}
        addLabel="Add Challenge"
        actions={(r) => (
          <div className="flex gap-1">
            <Button size="icon" variant="ghost" onClick={() => openEdit(r)}><Pencil className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" title="Duplicate" onClick={() => openDuplicate(r)}><Copy className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" onClick={() => setDeleteId(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
          </div>
        )}
      />

      <FormDialog open={dialogOpen} onOpenChange={setDialogOpen} title={editId ? "Edit Challenge" : "Add Challenge"} onSave={() => saveMut.mutate()} saving={saveMut.isPending} className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="space-y-5">
          {/* ── Basic Info ── */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Basic Info</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Name</Label><Input value={form.name} onChange={e => f("name", e.target.value)} /></div>
              <div className="space-y-1">
                <Label>Type</Label>
                <Select value={form.challenge_type} onValueChange={v => f("challenge_type", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="single">Single</SelectItem>
                    <SelectItem value="spotlight">Spotlight</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1"><Label>Description</Label><Textarea value={form.description} onChange={e => f("description", e.target.value)} /></div>
            {form.challenge_type === "spotlight" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label>Spotlight Group</Label><Input value={form.spotlight_group} onChange={e => f("spotlight_group", e.target.value)} placeholder="e.g. Road to Glory" /></div>
                <div className="space-y-1"><Label>Sort Order</Label><Input type="number" value={form.sort_order} onChange={e => f("sort_order", Number(e.target.value))} /></div>
              </div>
            )}
          </div>

          {/* ── Opponent ── */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Opponent</h3>
            <div className="space-y-1">
              <Label>Team</Label>
              <Select value={form.opponent_team_id || "__none"} onValueChange={v => f("opponent_team_id", v === "__none" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="Select team…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">— None —</SelectItem>
                  {teams.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* ── Win Condition ── */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Win Condition</h3>
            <Select value={form.win_condition} onValueChange={v => f("win_condition", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="win">Win the game</SelectItem>
                <SelectItem value="win_by">Win by X points</SelectItem>
                <SelectItem value="series">Win a series (best of N)</SelectItem>
                <SelectItem value="stat_limit">Hold player to stat limit + win</SelectItem>
              </SelectContent>
            </Select>

            {form.win_condition === "win_by" && (
              <div className="space-y-1"><Label>Win By (points)</Label><Input type="number" value={form.win_by_amount} onChange={e => f("win_by_amount", Number(e.target.value))} /></div>
            )}

            {form.win_condition === "series" && (
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label>Series Length</Label>
                  <Select value={String(form.series_length)} onValueChange={v => f("series_length", Number(v))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="3">Best of 3</SelectItem>
                      <SelectItem value="5">Best of 5</SelectItem>
                      <SelectItem value="7">Best of 7</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1"><Label>Per-Game Win Coins</Label><Input type="number" value={form.series_win_coins} onChange={e => f("series_win_coins", Number(e.target.value))} /></div>
                <div className="space-y-1"><Label>Per-Game Loss Coins</Label><Input type="number" value={form.series_loss_coins} onChange={e => f("series_loss_coins", Number(e.target.value))} /></div>
              </div>
            )}

            {form.win_condition === "stat_limit" && (
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label>Player</Label>
                  <PlayerCombobox players={players} value={form.stat_limit_player_id} onValueChange={v => f("stat_limit_player_id", v)} placeholder="Select player…" />
                </div>
                <div className="space-y-1">
                  <Label>Stat</Label>
                  <Select value={form.stat_limit_stat || "__none"} onValueChange={v => f("stat_limit_stat", v === "__none" ? "" : v)}>
                    <SelectTrigger><SelectValue placeholder="Select stat…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">—</SelectItem>
                      {STATS.map(s => <SelectItem key={s} value={s}>{s.toUpperCase()}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1"><Label>Max Value</Label><Input type="number" value={form.stat_limit_value} onChange={e => f("stat_limit_value", Number(e.target.value))} /></div>
              </div>
            )}
          </div>

          {/* ── Lineup Restrictions ── */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Lineup Restrictions</h3>
            <p className="text-xs text-muted-foreground">Optional. When set, players can only use cards that match ALL selected restrictions.</p>

            {/* Positions */}
            <div className="space-y-1">
              <Label className="text-xs">Positions</Label>
              <div className="flex gap-2 flex-wrap">
                {POSITIONS.map(pos => (
                  <label key={pos} className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <Checkbox checked={(lr.positions ?? []).includes(pos)} onCheckedChange={() => toggleRestrictionItem("positions", pos)} />
                    {pos}
                  </label>
                ))}
              </div>
            </div>

            {/* Gem Tiers */}
            <div className="space-y-1">
              <Label className="text-xs">Gem Tiers</Label>
              <div className="flex gap-2 flex-wrap">
                {gemTiers.map(gt => (
                  <label key={gt.id} className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <Checkbox checked={(lr.gem_tier_ids ?? []).includes(gt.id)} onCheckedChange={() => toggleRestrictionItem("gem_tier_ids", gt.id)} />
                    {gt.name}
                  </label>
                ))}
              </div>
            </div>

            {/* Card Colors */}
            <div className="space-y-1">
              <Label className="text-xs">Card Colors</Label>
              <div className="flex gap-2 flex-wrap">
                {COLOR_BUCKET_NAMES.map(color => (
                  <label key={color} className="flex items-center gap-1.5 text-xs cursor-pointer capitalize">
                    <Checkbox checked={(lr.card_colors ?? []).includes(color)} onCheckedChange={() => toggleRestrictionItem("card_colors", color)} />
                    {color}
                  </label>
                ))}
              </div>
            </div>

            {/* Teams */}
            <div className="space-y-1">
              <Label className="text-xs">Teams</Label>
              <div className="flex gap-2 flex-wrap max-h-24 overflow-y-auto">
                {teams.map(t => (
                  <label key={t.id} className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <Checkbox checked={(lr.team_ids ?? []).includes(t.id)} onCheckedChange={() => toggleRestrictionItem("team_ids", t.id)} />
                    {t.name}
                  </label>
                ))}
              </div>
            </div>

            {/* Badges */}
            <div className="space-y-1">
              <Label className="text-xs">Badges (has any of)</Label>
              <div className="flex gap-2 flex-wrap max-h-24 overflow-y-auto">
                {badges.map(b => (
                  <label key={b.id} className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <Checkbox checked={(lr.badge_ids ?? []).includes(b.id)} onCheckedChange={() => toggleRestrictionItem("badge_ids", b.id)} />
                    {b.name}
                  </label>
                ))}
              </div>
            </div>

            {/* Traits */}
            <div className="space-y-1">
              <Label className="text-xs">Signature Traits (has any of)</Label>
              <div className="flex gap-2 flex-wrap max-h-24 overflow-y-auto">
                {traits.map(t => (
                  <label key={t.id} className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <Checkbox checked={(lr.trait_ids ?? []).includes(t.id)} onCheckedChange={() => toggleRestrictionItem("trait_ids", t.id)} />
                    {t.name}
                  </label>
                ))}
              </div>
            </div>

            {/* Collections */}
            <div className="space-y-1">
              <Label className="text-xs">Collections</Label>
              <div className="flex gap-2 flex-wrap">
                {collections.map(c => (
                  <label key={c.id} className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <Checkbox checked={(lr.collection_ids ?? []).includes(c.id)} onCheckedChange={() => toggleRestrictionItem("collection_ids", c.id)} />
                    {c.name}
                  </label>
                ))}
              </div>
            </div>

            {/* Sub-Collections */}
            {subCollections.length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs">Sub-Collections</Label>
                <div className="flex gap-2 flex-wrap">
                  {subCollections.map(sc => (
                    <label key={sc.id} className="flex items-center gap-1.5 text-xs cursor-pointer">
                      <Checkbox checked={(lr.sub_collection_ids ?? []).includes(sc.id)} onCheckedChange={() => toggleRestrictionItem("sub_collection_ids", sc.id)} />
                      {sc.name}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Prerequisite ── */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Prerequisite</h3>
            <Select value={form.prerequisite_id || "__none"} onValueChange={v => f("prerequisite_id", v === "__none" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">— None —</SelectItem>
                {challenges.filter(c => c.id !== editId).map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* ── Completion Rewards ── */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Completion Rewards</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label>Coins</Label><Input type="number" value={form.coin_reward} onChange={e => f("coin_reward", Number(e.target.value))} /></div>
              <div className="space-y-1"><Label>Gems</Label><Input type="number" value={form.gem_reward} onChange={e => f("gem_reward", Number(e.target.value))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Pack Reward</Label>
                <Select value={form.pack_reward || "__none"} onValueChange={v => f("pack_reward", v === "__none" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">— None —</SelectItem>
                    <SelectItem value="random_standard">🎲 Random Pack</SelectItem>
                    <SelectItem value="random_standard_box">🎲 Random Box</SelectItem>
                    {packs.map(p => <SelectItem key={p.id} value={p.id}>📦 {p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Card Reward</Label>
                <PlayerCombobox players={players} value={form.card_reward_id} onValueChange={v => f("card_reward_id", v)} placeholder="None" />
              </div>
            </div>
          </div>
        </div>
      </FormDialog>

      <ConfirmDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)} title="Delete Challenge" description="Permanently delete this challenge?" onConfirm={() => deleteId && deleteMut.mutate(deleteId)} loading={deleteMut.isPending} />
    </div>
  );
}
