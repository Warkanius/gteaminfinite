import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DataTable, Column } from "@/components/admin/DataTable";
import { FormDialog } from "@/components/admin/FormDialog";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { StatInput } from "@/components/admin/StatInput";
import { HslColorPicker } from "@/components/admin/HslColorPicker";
import { PlayerWizard } from "@/components/admin/PlayerWizard";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Pencil, Trash2, X, Copy, Zap, RefreshCw, Wand2, Search, GitBranch } from "lucide-react";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";
import { resolveCardVisuals } from "@/lib/cardVisuals";
import { generatePlayer } from "@/lib/archetypeEngine";
import { cn } from "@/lib/utils";
import { EvoPathEditor } from "@/components/admin/EvoPathEditor";
import { BASE_BADGE_SLOTS } from "@/lib/badgeEngine";

type PlayerCard = Tables<"player_cards"> & {
  card_color_primary?: string | null;
  card_color_secondary?: string | null;
  card_glow_color?: string | null;
  card_animation?: string | null;
};

const STAT_KEYS = ["stat_3pt", "stat_mid", "stat_fin", "stat_dnk", "stat_ast", "stat_stl", "stat_reb", "stat_blk", "stat_int"] as const;
const RUN_STAT_KEYS = ["run_stat_3pt", "run_stat_mid", "run_stat_fin", "run_stat_dnk", "run_stat_stl", "run_stat_blk", "run_stat_ast", "run_stat_reb", "run_stat_int"] as const;
const RUN_STAT_LABELS: Record<string, string> = {
  run_stat_3pt: "3PT", run_stat_mid: "MID", run_stat_fin: "FIN", run_stat_dnk: "DNK",
  run_stat_stl: "STL", run_stat_blk: "BLK", run_stat_ast: "AST", run_stat_reb: "REB", run_stat_int: "INT",
};
const STAT_LABELS: Record<string, string> = {
  stat_3pt: "3PT", stat_mid: "MID", stat_fin: "FIN", stat_dnk: "DNK",
  stat_ast: "AST", stat_stl: "STL", stat_reb: "REB", stat_blk: "BLK", stat_int: "INT",
};
const BADGE_TIERS = ["base", "gold", "hof", "diamond", "actolytrene"];
const POSITIONS = ["PG", "SG", "SF", "PF", "C"];
const ANIMATIONS = ["shimmer", "pulse", "holographic"];

/* ── (Playstyle templates removed — replaced by archetype generator) ── */

type FormState = Partial<PlayerCard> & { badges: { badge_id: string; tier: string }[]; traits: { trait_id: string; tier: string; target_stat: string | null }[] };

const emptyForm = (): FormState => ({
  name: "", position1: null, position2: null,
  stat_3pt: 0, stat_mid: 0, stat_fin: 0, stat_dnk: 0, stat_ast: 0, stat_stl: 0, stat_reb: 0, stat_blk: 0, stat_int: 0,
  run_rating: null, run_stat_3pt: null, run_stat_mid: null, run_stat_fin: null, run_stat_dnk: null,
  run_stat_stl: null, run_stat_blk: null, run_stat_ast: null, run_stat_reb: null, run_stat_int: null,
  gem_tier_id: null, team_id: null, is_collection_reward: false, gem_name: null,
  card_color_primary: null, card_color_secondary: null, card_glow_color: null, card_animation: null,
  badges: [], traits: [],
});

export default function AdminPlayers() {
  const qc = useQueryClient();
  const [form, setForm] = useState(emptyForm());
  const [editId, setEditId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [generatorText, setGeneratorText] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardEditPlayer, setWizardEditPlayer] = useState<PlayerCard | null>(null);
  const [badgeSearch, setBadgeSearch] = useState("");
  const [pendingBadgeId, setPendingBadgeId] = useState<string | null>(null);
  const [evoSourceId, setEvoSourceId] = useState<string | null>(null);

  const { data: players = [], isLoading } = useQuery({
    queryKey: ["admin-players"],
    queryFn: async () => {
      const { data, error } = await supabase.from("player_cards").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: gemTiers = [] } = useQuery({
    queryKey: ["gem-tiers"],
    queryFn: async () => {
      const { data } = await supabase.from("gem_tiers").select("*").order("sort_order");
      return data ?? [];
    },
  });

  const { data: teams = [] } = useQuery({
    queryKey: ["teams"],
    queryFn: async () => {
      const { data } = await supabase.from("teams").select("*").order("name");
      return data ?? [];
    },
  });

  const { data: allBadges = [] } = useQuery({
    queryKey: ["badges"],
    queryFn: async () => {
      const { data } = await supabase.from("badges").select("*").order("name");
      return data ?? [];
    },
  });

  const { data: allTraits = [] } = useQuery({
    queryKey: ["traits"],
    queryFn: async () => {
      const { data } = await supabase.from("signature_traits").select("*").order("name");
      return data ?? [];
    },
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      const { badges, traits, ...cardData } = form;
      const rating = Math.round(STAT_KEYS.reduce((s, k) => s + (Number((cardData as any)[k]) || 0), 0) / STAT_KEYS.length);
      const payload = { ...cardData, rating } as any;
      delete payload.id; delete payload.created_at; delete payload.updated_at;

      let cardId = editId;
      if (editId) {
        const { error } = await supabase.from("player_cards").update(payload).eq("id", editId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("player_cards").insert(payload).select("id").single();
        if (error) throw error;
        cardId = data.id;
      }

      await supabase.from("player_card_badges").delete().eq("player_card_id", cardId!);
      if (badges.length > 0) {
        await supabase.from("player_card_badges").insert(
          badges.map((b) => ({ player_card_id: cardId!, badge_id: b.badge_id, tier: b.tier }))
        );
      }

      await supabase.from("player_card_traits").delete().eq("player_card_id", cardId!);
      if (traits.length > 0) {
        await supabase.from("player_card_traits").insert(
          traits.map((t) => ({ player_card_id: cardId!, trait_id: t.trait_id, tier: t.tier, target_stat: t.target_stat }))
        );
      }

      // Auto-link evo path if creating an evo form
      if (!editId && evoSourceId && cardId) {
        const { data: evoStep } = await supabase
          .from("evo_paths")
          .select("id")
          .eq("player_card_id", evoSourceId)
          .is("evolves_to_card_id", null)
          .order("step_order", { ascending: true })
          .limit(1)
          .single();

        if (evoStep) {
          await supabase.from("evo_paths").update({ evolves_to_card_id: cardId }).eq("id", evoStep.id);
        }
      }

      return { cardId, wasInsert: !editId };
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["admin-players"] });
      setDialogOpen(false);
      if (evoSourceId && result?.wasInsert) {
        const sourceName = players.find(p => p.id === evoSourceId)?.name ?? "source";
        toast.success(`Evo form created and linked to ${sourceName}`);
      } else {
        toast.success(editId ? "Player updated" : "Player created");
      }
      setEvoSourceId(null);
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("player_cards").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-players"] });
      setDeleteId(null);
      toast.success("Player deleted");
    },
    onError: (e) => toast.error(e.message),
  });

  async function loadPlayerData(player: PlayerCard): Promise<FormState> {
    const [{ data: pBadges }, { data: pTraits }] = await Promise.all([
      supabase.from("player_card_badges").select("badge_id, tier").eq("player_card_id", player.id),
      supabase.from("player_card_traits").select("trait_id, tier, target_stat").eq("player_card_id", player.id),
    ]);
    return {
      ...player,
      badges: pBadges ?? [],
      traits: (pTraits ?? []).map((t) => ({ trait_id: t.trait_id, tier: t.tier, target_stat: t.target_stat ?? null })),
    };
  }

  async function openEdit(player: PlayerCard) {
    const data = await loadPlayerData(player);
    setForm(data);
    setEditId(player.id);
    setDialogOpen(true);
  }

  async function createEvoForm(player: PlayerCard) {
    const data = await loadPlayerData(player);
    setForm({ ...data, name: `${player.name} Evo`, id: undefined });
    setEditId(null);
    setEvoSourceId(player.id);
    setGeneratorText("");
    setDialogOpen(true);
  }

  async function copyFromPlayer(playerId: string) {
    const player = players.find((p) => p.id === playerId);
    if (!player) return;
    const data = await loadPlayerData(player as PlayerCard);
    setForm({ ...data, name: "", id: undefined });
    // keep editId null so it creates a new record
  }

  function runGenerator() {
    const selectedTier = gemTiers.find((g) => g.id === form.gem_tier_id);
    if (!selectedTier) {
      toast.error("Select a gem tier first — the generator needs it for stat scaling");
      return;
    }
    if (!generatorText.trim()) {
      toast.error("Describe the player archetype (e.g. 'badge heavy two-way slasher')");
      return;
    }
    const result = generatePlayer(
      generatorText,
      selectedTier.stars,
      allBadges.map((b) => ({ id: b.id, abbreviation: b.abbreviation, affected_stat: b.affected_stat, effect_type: b.effect_type })),
    );
    setForm((f) => ({
      ...f,
      ...result.stats,
      position1: result.positions[0],
      position2: result.positions[1],
      badges: result.badges
        .map((rb) => {
          const badge = allBadges.find((b) => b.abbreviation.toLowerCase() === rb.abbreviation.toLowerCase());
          return badge ? { badge_id: badge.id, tier: rb.tier } : null;
        })
        .filter(Boolean) as { badge_id: string; tier: string }[],
    }));
    toast.success(result.summary);
  }

  // Badge search filtering
  const filteredBadgesForSearch = useMemo(() => {
    if (!badgeSearch.trim()) return [];
    const q = badgeSearch.toLowerCase();
    return allBadges
      .filter(b => !form.badges.some(fb => fb.badge_id === b.id))
      .filter(b => b.name.toLowerCase().includes(q) || b.abbreviation.toLowerCase().includes(q))
      .slice(0, 8);
  }, [badgeSearch, allBadges, form.badges]);

  function addBadgeWithTier(badgeId: string, tier: string) {
    setForm(f => {
      if (f.badges.length >= maxBadgeSlots) {
        toast.error(`Badge slots full (${maxBadgeSlots} max)`);
        return f;
      }
      return { ...f, badges: [...f.badges, { badge_id: badgeId, tier }] };
    });
    setPendingBadgeId(null);
    setBadgeSearch("");
  }

  function openWizardForNew() {
    setWizardEditPlayer(null);
    setWizardOpen(true);
  }

  function openWizardForEdit(player: PlayerCard) {
    setWizardEditPlayer(player);
    setWizardOpen(true);
  }

  async function handleWizardAccept(result: { stats: Record<string, number>; badges: { badge_id: string; tier: string }[]; traits: { trait_id: string; tier: string; target_stat: string | null }[]; positions: [string, string | null]; gemTierId: string; summary: string }) {
    if (wizardEditPlayer) {
      const playerData = await loadPlayerData(wizardEditPlayer);
      setForm({
        ...playerData,
        ...result.stats,
        position1: result.positions[0],
        position2: result.positions[1],
        gem_tier_id: result.gemTierId,
        badges: result.badges,
        traits: result.traits,
      });
      setEditId(wizardEditPlayer.id);
      setDialogOpen(true);
      toast.success(`Wizard applied: ${result.summary}`);
    } else {
      setForm({
        ...emptyForm(),
        ...result.stats,
        position1: result.positions[0],
        position2: result.positions[1],
        gem_tier_id: result.gemTierId,
        badges: result.badges,
        traits: result.traits,
      });
      setEditId(null);
      setDialogOpen(true);
      toast.success(`Wizard generated: ${result.summary}`);
    }
  }

  const overallRating = Math.round(STAT_KEYS.reduce((s, k) => s + (Number((form as any)[k]) || 0), 0) / STAT_KEYS.length);

  // Mr. Versatile is a Signature Trait — check form.traits for it
  const mrVersatileExtra = useMemo(() => {
    const mvTrait = form.traits.find(ft => {
      const trait = allTraits.find(t => t.id === ft.trait_id);
      return trait && trait.condition_type === "passive" && trait.abbreviation === "MV";
    });
    if (!mvTrait) return 0;
    const tierMap: Record<string, number> = { base: 1, gold: 2, hof: 3, diamond: 4, actolytrene: 5 };
    return tierMap[mvTrait.tier] ?? 0;
  }, [form.traits, allTraits]);
  const maxBadgeSlots = BASE_BADGE_SLOTS + mrVersatileExtra;
  const badgeSlotsRemaining = maxBadgeSlots - form.badges.length;

  const gemTierMap = Object.fromEntries(gemTiers.map((g) => [g.id, g.name]));
  const teamMap = Object.fromEntries(teams.map((t) => [t.id, t.name]));

  const columns: Column<PlayerCard>[] = [
    { key: "name", label: "Name", sortable: true },
    { key: "rating", label: "OVR", sortable: true, render: (r) => String(r.rating) },
    { key: "gem_tier_id", label: "Gem Tier", render: (r) => gemTierMap[r.gem_tier_id ?? ""] ?? "—" },
    { key: "position1", label: "Pos", render: (r) => [r.position1, r.position2].filter(Boolean).join("/") || "—" },
    { key: "team_id", label: "Team", render: (r) => teamMap[r.team_id ?? ""] ?? "—" },
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Player Card Manager</CardTitle>
          <CardDescription>Manage the roster of players, their attributes, badges, and card visuals.</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            data={players}
            columns={columns}
            isLoading={isLoading}
            searchKeys={["name"]}
            searchPlaceholder="Search players…"
            onAdd={() => { setForm(emptyForm()); setEditId(null); setGeneratorText(""); setDialogOpen(true); }}
            addLabel="Add Player"
            actions={(row) => (
              <div className="flex gap-1">
                <Button size="icon" variant="ghost" onClick={() => openEdit(row)} title="Edit"><Pencil className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" onClick={() => openWizardForEdit(row as PlayerCard)} title="Wizard"><Wand2 className="h-4 w-4 text-primary" /></Button>
                <Button size="icon" variant="ghost" onClick={() => createEvoForm(row as PlayerCard)} title="Create Evo Form"><GitBranch className="h-4 w-4 text-accent-foreground" /></Button>
                <Button size="icon" variant="ghost" onClick={() => setDeleteId(row.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </div>
            )}
          />
          <div className="flex justify-end mt-3">
            <Button variant="outline" size="sm" onClick={openWizardForNew} className="gap-1">
              <Wand2 className="h-3.5 w-3.5" /> Create with Wizard
            </Button>
          </div>
        </CardContent>
      </Card>

      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={editId ? "Edit Player" : "Add Player"}
        onSave={() => saveMut.mutate()}
        saving={saveMut.isPending}
        className="max-w-3xl max-h-[90vh] overflow-y-auto"
      >
        <div className="space-y-6">
          {/* Quick Actions: Generator & Copy */}
          <div className="space-y-3 p-3 rounded-lg border border-border/50 bg-muted/30">
            <div className="space-y-1">
              <Label className="text-xs flex items-center gap-1"><Zap className="h-3 w-3" /> Archetype Generator</Label>
              <p className="text-xs text-muted-foreground">
                {editId ? "Regenerate stats/badges based on a new archetype description." : "Describe the player (e.g. \"badge heavy two-way slasher with elite finishing\"). Select gem tier first."}
              </p>
              <div className="flex gap-2">
                <Textarea
                  placeholder="e.g. athletic slasher, lights out, badge heavy"
                  value={generatorText}
                  onChange={(e) => setGeneratorText(e.target.value)}
                  className="min-h-[40px] h-10 text-xs resize-none flex-1"
                />
                <Button variant="default" size="sm" onClick={runGenerator} className="shrink-0 gap-1">
                  <Zap className="h-3 w-3" /> Generate
                </Button>
                <Button variant="outline" size="sm" onClick={runGenerator} className="shrink-0 gap-1" title="Re-roll with same description">
                  <RefreshCw className="h-3 w-3" />
                </Button>
              </div>
            </div>
            {!editId && (
              <div className="space-y-1">
                <Label className="text-xs flex items-center gap-1"><Copy className="h-3 w-3" /> Copy from Player</Label>
                <Select onValueChange={copyFromPlayer}>
                  <SelectTrigger><SelectValue placeholder="Select player…" /></SelectTrigger>
                  <SelectContent>
                    {players.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name} ({p.rating})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* Basic info */}
          <div className="bg-muted/30 p-4 rounded-lg border space-y-4">
            <h3 className="font-semibold text-sm">General Info</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Name</Label>
                <Input value={form.name ?? ""} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>Position 1</Label>
                <Select value={form.position1 ?? ""} onValueChange={(v) => setForm((f) => ({ ...f, position1: v || null }))}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{POSITIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Position 2</Label>
                <Select value={form.position2 ?? ""} onValueChange={(v) => setForm((f) => ({ ...f, position2: v || null }))}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{POSITIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Team</Label>
                <Select value={form.team_id ?? ""} onValueChange={(v) => setForm((f) => ({ ...f, team_id: v || null }))}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{teams.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Gem Tier</Label>
                <Select value={form.gem_tier_id ?? ""} onValueChange={(v) => setForm((f) => ({ ...f, gem_tier_id: v || null }))}>
                  <SelectTrigger><SelectValue placeholder="Select tier…" /></SelectTrigger>
                  <SelectContent>
                    {gemTiers.map((g) => (
                      <SelectItem key={g.id} value={g.id}>{"⭐".repeat(g.stars)} {g.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Determines card color and base rating scaling for the generator.</p>
              </div>
              <div className="space-y-1">
                <Label>Gem Name</Label>
                <Input
                  value={(form as any).gem_name ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, gem_name: e.target.value || null }))}
                  placeholder="e.g. Fire Opal, Blood Ruby"
                />
                <p className="text-xs text-muted-foreground">Used to auto-infer card colors. See Card Appearance preview below.</p>
              </div>
            </div>
            {/* Social Handle */}
            <div className="space-y-1">
              <Label>Social Handle</Label>
              <Input
                value={(form as any).social_handle ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, social_handle: e.target.value || null }))}
                placeholder="@KingJames"
              />
              <p className="text-xs text-muted-foreground">Fictional social media handle shown on the feed.</p>
            </div>
            {/* Market Value & Collection reward */}
            <div className="space-y-1">
              <Label>Market Value (coins)</Label>
              <Input
                type="number"
                min={0}
                value={(form as any).market_value ?? 500}
                onChange={(e) => setForm((f) => ({ ...f, market_value: Number(e.target.value) || 0 }))}
                placeholder="500"
              />
              <p className="text-xs text-muted-foreground">Base price when this card appears in the Auction House.</p>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <Switch checked={form.is_collection_reward ?? false} onCheckedChange={(v) => setForm((f) => ({ ...f, is_collection_reward: v }))} />
              <Label>Collection Reward</Label>
            </div>
          </div>

          {/* Stats */}
          <div className="bg-muted/30 p-4 rounded-lg border space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">Attributes</h3>
              <Badge variant="secondary" className="text-lg font-mono">OVR {overallRating}</Badge>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
              {STAT_KEYS.map((k) => (
                <StatInput key={k} label={STAT_LABELS[k]} value={(form as any)[k] ?? 0} onChange={(v) => setForm((f) => ({ ...f, [k]: v }))} max={99} />
              ))}
            </div>
          </div>

          {/* Run Ratings */}
          <div className="bg-muted/30 p-4 rounded-lg border space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">Run Ratings (Numerical)</h3>
              {form.run_rating != null && (
                <Badge variant="secondary" className="text-lg font-mono">RUN OVR {form.run_rating}</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              These are the persistent numerical ratings used in The Runs mode (0–120). Leave empty to auto-randomize when adding to a run roster.
            </p>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">OVR</Label>
                <Input
                  type="number" min={0} max={120}
                  value={form.run_rating ?? ""}
                  onChange={(e) => setForm((f) => ({ ...f, run_rating: e.target.value ? Number(e.target.value) : null }))}
                  placeholder="—"
                  className="h-9 text-center font-mono"
                />
              </div>
              {RUN_STAT_KEYS.map((k) => (
                <div key={k} className="space-y-1">
                  <Label className="text-xs">{RUN_STAT_LABELS[k]}</Label>
                  <Input
                    type="number" min={0} max={200}
                    value={(form as any)[k] ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value ? Number(e.target.value) : null }))}
                    placeholder="—"
                    className="h-9 text-center font-mono"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Card Appearance */}
          <div className="bg-muted/30 p-4 rounded-lg border space-y-4">
            <div>
              <h3 className="font-semibold text-sm block">Card Appearance</h3>
              <p className="text-xs text-muted-foreground mt-1">Leave blank to auto-infer from gem name / tier.</p>
            </div>
            {(() => {
              const preview = resolveCardVisuals(form as any, gemTiers.find(g => g.id === form.gem_tier_id));
              const isHsl = (c: string) => /^\d+\s/.test(c);
              const bg = (c: string) => isHsl(c) ? `hsl(${c})` : c;
              return (
                <div className="flex items-start gap-4 mb-3">
                  <div className="w-20 h-28 rounded-lg border border-border/50 flex-shrink-0" style={{
                    background: `linear-gradient(135deg, ${bg(preview.primary)}, ${bg(preview.secondary)})`,
                    boxShadow: `0 0 14px 2px ${bg(preview.glow)}40`,
                  }}>
                    <div className="w-full h-full flex items-center justify-center text-[10px] text-foreground/60">Preview</div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 flex-1">
                    <HslColorPicker label="Primary" value={form.card_color_primary ?? null} onChange={(v) => setForm(f => ({ ...f, card_color_primary: v }))} />
                    <HslColorPicker label="Secondary" value={form.card_color_secondary ?? null} onChange={(v) => setForm(f => ({ ...f, card_color_secondary: v }))} />
                    <HslColorPicker label="Glow" value={form.card_glow_color ?? null} onChange={(v) => setForm(f => ({ ...f, card_glow_color: v }))} />
                    <div className="space-y-1">
                      <Label className="text-xs">Animation</Label>
                      <Select value={form.card_animation ?? "none"} onValueChange={(v) => setForm(f => ({ ...f, card_animation: v === "none" ? null : v }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {ANIMATIONS.map(a => <SelectItem key={a} value={a} className="capitalize">{a}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Badges */}
          <div className="bg-muted/30 p-4 rounded-lg border space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">Badges ({form.badges.length}/{maxBadgeSlots})</h3>
              {mrVersatileExtra > 0 && <span className="text-xs text-amber-400">Mr. Versatile: +{mrVersatileExtra} slots</span>}
            </div>
            {/* Search to add */}
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder={badgeSlotsRemaining <= 0 ? "All badge slots filled" : "Search badges by name or abbreviation…"}
                value={badgeSearch}
                disabled={badgeSlotsRemaining <= 0}
                onChange={(e) => { setBadgeSearch(e.target.value); setPendingBadgeId(null); }}
              />
              {filteredBadgesForSearch.length > 0 && !pendingBadgeId && (
                <div className="absolute z-50 top-full mt-1 w-full rounded-md border bg-popover shadow-lg max-h-48 overflow-y-auto">
                  {filteredBadgesForSearch.map(b => (
                    <button
                      key={b.id}
                      onClick={() => setPendingBadgeId(b.id)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-accent/50 flex items-center justify-between"
                    >
                      <span>{b.name}</span>
                      <Badge variant="outline" className="text-[10px] font-mono">{b.abbreviation}</Badge>
                    </button>
                  ))}
                </div>
              )}
              {/* Tier selector popover inline */}
              {pendingBadgeId && (
                <div className="absolute z-50 top-full mt-1 w-full rounded-md border bg-popover shadow-lg p-3">
                  <p className="text-xs text-muted-foreground mb-2">Choose tier for <span className="font-semibold text-foreground">{allBadges.find(b => b.id === pendingBadgeId)?.name}</span>:</p>
                  <div className="flex gap-1.5">
                    {BADGE_TIERS.map(t => (
                      <button
                        key={t}
                        onClick={() => addBadgeWithTier(pendingBadgeId, t)}
                        className={cn(
                          "flex-1 px-2 py-1.5 rounded text-xs font-medium border transition-all capitalize hover:border-primary hover:bg-primary/10",
                          "border-border bg-card"
                        )}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="space-y-2">
              {form.badges.map((fb, i) => {
                const badge = allBadges.find((b) => b.id === fb.badge_id);
                return (
                  <div key={i} className="flex items-center gap-2 bg-muted/50 rounded p-2">
                    <span className="flex-1 text-sm">{badge?.name ?? fb.badge_id} <span className="text-xs text-muted-foreground font-mono">({badge?.abbreviation})</span></span>
                    <Select value={fb.tier} onValueChange={(t) => setForm((f) => ({ ...f, badges: f.badges.map((b, j) => j === i ? { ...b, tier: t } : b) }))}>
                      <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>{BADGE_TIERS.map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
                    </Select>
                    <Button size="icon" variant="ghost" onClick={() => setForm((f) => ({ ...f, badges: f.badges.filter((_, j) => j !== i) }))}><X className="h-3 w-3" /></Button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Traits */}
          <div className="bg-muted/30 p-4 rounded-lg border space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">Signature Traits</h3>
              <Select onValueChange={(traitId) => setForm((f) => ({ ...f, traits: [...f.traits, { trait_id: traitId, tier: "base", target_stat: null }] }))}>
                <SelectTrigger className="w-48"><SelectValue placeholder="Add trait…" /></SelectTrigger>
                <SelectContent>{allTraits.filter((t) => !form.traits.some((ft) => ft.trait_id === t.id)).map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              {form.traits.map((ft, i) => {
                const trait = allTraits.find((t) => t.id === ft.trait_id);
                return (
                  <div key={i} className="flex items-center gap-2 bg-muted/50 rounded p-2">
                    <span className="flex-1 text-sm">{trait?.name ?? ft.trait_id}</span>
                    <Select value={ft.tier} onValueChange={(t) => setForm((f) => ({ ...f, traits: f.traits.map((tr, j) => j === i ? { ...tr, tier: t } : tr) }))}>
                      <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>{BADGE_TIERS.map((t) => <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>)}</SelectContent>
                    </Select>
                    <Input placeholder="Target stat" className="w-24" value={ft.target_stat ?? ""} onChange={(e) => setForm((f) => ({ ...f, traits: f.traits.map((tr, j) => j === i ? { ...tr, target_stat: e.target.value || null } : tr) }))} />
                    <Button size="icon" variant="ghost" onClick={() => setForm((f) => ({ ...f, traits: f.traits.filter((_, j) => j !== i) }))}><X className="h-3 w-3" /></Button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Evo Path Editor — only when editing an existing player */}
          {editId && (
            <EvoPathEditor
              playerId={editId}
              playerGemTierId={form.gem_tier_id ?? null}
              playerStats={Object.fromEntries(STAT_KEYS.map(k => [k, Number((form as any)[k]) || 0]))}
              playerBadges={form.badges}
            />
          )}
        </div>
      </FormDialog>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(o) => !o && setDeleteId(null)}
        title="Delete Player"
        description="This will permanently delete this player card and all associated badges/traits."
        onConfirm={() => deleteId && deleteMut.mutate(deleteId)}
        loading={deleteMut.isPending}
      />

      <PlayerWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onAccept={handleWizardAccept}
        gemTiers={gemTiers}
        players={players as PlayerCard[]}
        allBadges={allBadges}
        allTraits={allTraits}
        editingPlayer={wizardEditPlayer}
      />
    </div>
  );
}
