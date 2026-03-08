import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DataTable, Column } from "@/components/admin/DataTable";
import { FormDialog } from "@/components/admin/FormDialog";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { StatInput } from "@/components/admin/StatInput";
import { HslColorPicker } from "@/components/admin/HslColorPicker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Pencil, Trash2, X, Copy, Zap, Import, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";
import { resolveCardVisuals } from "@/lib/cardVisuals";
import { generatePlayer } from "@/lib/archetypeEngine";

type PlayerCard = Tables<"player_cards"> & {
  card_color_primary?: string | null;
  card_color_secondary?: string | null;
  card_glow_color?: string | null;
  card_animation?: string | null;
};

const STAT_KEYS = ["stat_3pt", "stat_mid", "stat_fin", "stat_dnk", "stat_ast", "stat_stl", "stat_reb", "stat_blk", "stat_int"] as const;
const STAT_LABELS: Record<string, string> = {
  stat_3pt: "3PT", stat_mid: "MID", stat_fin: "FIN", stat_dnk: "DNK",
  stat_ast: "AST", stat_stl: "STL", stat_reb: "REB", stat_blk: "BLK", stat_int: "INT",
};
const BADGE_TIERS = ["base", "gold", "diamond", "hof", "actolytrene"];
const POSITIONS = ["PG", "SG", "SF", "PF", "C"];
const ANIMATIONS = ["shimmer", "pulse", "holographic"];

/* ── (Playstyle templates removed — replaced by archetype generator) ── */

type FormState = Partial<PlayerCard> & { badges: { badge_id: string; tier: string }[]; traits: { trait_id: string; tier: string; target_stat: string | null }[] };

const emptyForm = (): FormState => ({
  name: "", position1: null, position2: null,
  stat_3pt: 0, stat_mid: 0, stat_fin: 0, stat_dnk: 0, stat_ast: 0, stat_stl: 0, stat_reb: 0, stat_blk: 0, stat_int: 0,
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
  const [bulkBadgeText, setBulkBadgeText] = useState("");
  const [generatorText, setGeneratorText] = useState("");

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
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-players"] });
      setDialogOpen(false);
      toast.success(editId ? "Player updated" : "Player created");
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

  function importBulkBadges() {
    if (!bulkBadgeText.trim()) return;
    const entries = bulkBadgeText.split(",").map((s) => s.trim()).filter(Boolean);
    const added: { badge_id: string; tier: string }[] = [];
    const notFound: string[] = [];

    for (const entry of entries) {
      const [abbr, tierRaw] = entry.split(":").map((s) => s.trim());
      const tier = tierRaw && BADGE_TIERS.includes(tierRaw.toLowerCase()) ? tierRaw.toLowerCase() : "base";
      const badge = allBadges.find((b) => b.abbreviation.toLowerCase() === abbr.toLowerCase());
      if (badge) {
        if (!form.badges.some((fb) => fb.badge_id === badge.id)) {
          added.push({ badge_id: badge.id, tier });
        }
      } else {
        notFound.push(abbr);
      }
    }

    if (added.length > 0) {
      setForm((f) => ({ ...f, badges: [...f.badges, ...added] }));
    }
    if (notFound.length > 0) {
      toast.error(`Unknown abbreviations: ${notFound.join(", ")}`);
    }
    if (added.length > 0) {
      toast.success(`Imported ${added.length} badge(s)`);
    }
    setBulkBadgeText("");
  }

  const overallRating = Math.round(STAT_KEYS.reduce((s, k) => s + (Number((form as any)[k]) || 0), 0) / STAT_KEYS.length);
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
      <h1 className="text-2xl font-bold">Player Card Manager</h1>
      <DataTable
        data={players}
        columns={columns}
        isLoading={isLoading}
        searchKeys={["name"]}
        searchPlaceholder="Search players…"
        onAdd={() => { setForm(emptyForm()); setEditId(null); setBulkBadgeText(""); setDialogOpen(true); }}
        addLabel="Add Player"
        actions={(row) => (
          <div className="flex gap-1">
            <Button size="icon" variant="ghost" onClick={() => openEdit(row)}><Pencil className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" onClick={() => setDeleteId(row.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
          </div>
        )}
      />

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
          {!editId && (
            <div className="space-y-3 p-3 rounded-lg border border-border/50 bg-muted/30">
              <div className="space-y-1">
                <Label className="text-xs flex items-center gap-1"><Zap className="h-3 w-3" /> Archetype Generator</Label>
                <p className="text-xs text-muted-foreground">Describe the player (e.g. "badge heavy two-way slasher with elite finishing"). Select gem tier first.</p>
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
            </div>
          )}

          {/* Basic info */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input value={form.name ?? ""} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Gem Name</Label>
              <Input value={form.gem_name ?? ""} onChange={(e) => setForm((f) => ({ ...f, gem_name: e.target.value || null }))} />
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
              <Label>Gem Tier</Label>
              <Select value={form.gem_tier_id ?? ""} onValueChange={(v) => setForm((f) => ({ ...f, gem_tier_id: v || null }))}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{gemTiers.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Team</Label>
              <Select value={form.team_id ?? ""} onValueChange={(v) => setForm((f) => ({ ...f, team_id: v || null }))}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>{teams.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          {/* Stats */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-base">Stats</Label>
              <Badge variant="secondary" className="text-lg font-mono">OVR {overallRating}</Badge>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
              {STAT_KEYS.map((k) => (
                <StatInput key={k} label={STAT_LABELS[k]} value={(form as any)[k] ?? 0} onChange={(v) => setForm((f) => ({ ...f, [k]: v }))} max={99} />
              ))}
            </div>
          </div>

          {/* Collection reward */}
          <div className="flex items-center gap-3">
            <Switch checked={form.is_collection_reward ?? false} onCheckedChange={(v) => setForm((f) => ({ ...f, is_collection_reward: v }))} />
            <Label>Collection Reward</Label>
          </div>

          {/* Card Appearance */}
          <div>
            <Label className="text-base mb-2 block">Card Appearance</Label>
            <p className="text-xs text-muted-foreground mb-3">Leave blank to auto-infer from gem name / tier.</p>
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
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-base">Badges</Label>
              <Select onValueChange={(badgeId) => setForm((f) => ({ ...f, badges: [...f.badges, { badge_id: badgeId, tier: "base" }] }))}>
                <SelectTrigger className="w-48"><SelectValue placeholder="Add badge…" /></SelectTrigger>
                <SelectContent>{allBadges.filter((b) => !form.badges.some((fb) => fb.badge_id === b.id)).map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            {/* Bulk import */}
            <div className="flex gap-2 mb-3">
              <Textarea
                placeholder="Bulk import: HG:gold, DS:hof, QFS:base"
                value={bulkBadgeText}
                onChange={(e) => setBulkBadgeText(e.target.value)}
                className="min-h-[40px] h-10 text-xs resize-none"
              />
              <Button variant="outline" size="sm" onClick={importBulkBadges} className="shrink-0 gap-1">
                <Import className="h-3 w-3" /> Import
              </Button>
            </div>
            <div className="space-y-2">
              {form.badges.map((fb, i) => {
                const badge = allBadges.find((b) => b.id === fb.badge_id);
                return (
                  <div key={i} className="flex items-center gap-2 bg-muted/50 rounded p-2">
                    <span className="flex-1 text-sm">{badge?.name ?? fb.badge_id}</span>
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
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-base">Signature Traits</Label>
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
    </div>
  );
}
