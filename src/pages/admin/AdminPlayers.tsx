import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DataTable, Column } from "@/components/admin/DataTable";
import { FormDialog } from "@/components/admin/FormDialog";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { StatInput } from "@/components/admin/StatInput";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Pencil, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";
import { resolveCardVisuals } from "@/lib/cardVisuals";

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

const emptyForm = (): Partial<PlayerCard> & { badges: { badge_id: string; tier: string }[]; traits: { trait_id: string; tier: string; target_stat: string | null }[] } => ({
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

      // Sync badges
      await supabase.from("player_card_badges").delete().eq("player_card_id", cardId!);
      if (badges.length > 0) {
        await supabase.from("player_card_badges").insert(
          badges.map((b) => ({ player_card_id: cardId!, badge_id: b.badge_id, tier: b.tier }))
        );
      }

      // Sync traits
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

  async function openEdit(player: PlayerCard) {
    const [{ data: pBadges }, { data: pTraits }] = await Promise.all([
      supabase.from("player_card_badges").select("badge_id, tier").eq("player_card_id", player.id),
      supabase.from("player_card_traits").select("trait_id, tier, target_stat").eq("player_card_id", player.id),
    ]);
    setForm({
      ...player,
      badges: pBadges ?? [],
      traits: (pTraits ?? []).map((t) => ({ trait_id: t.trait_id, tier: t.tier, target_stat: t.target_stat ?? null })),
    });
    setEditId(player.id);
    setDialogOpen(true);
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
        onAdd={() => { setForm(emptyForm()); setEditId(null); setDialogOpen(true); }}
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
                    <div className="space-y-1">
                      <Label className="text-xs">Primary (HSL)</Label>
                      <Input placeholder="e.g. 220 75% 50%" value={form.card_color_primary ?? ""} onChange={(e) => setForm(f => ({ ...f, card_color_primary: e.target.value || null }))} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Secondary (HSL)</Label>
                      <Input placeholder="e.g. 220 60% 35%" value={form.card_color_secondary ?? ""} onChange={(e) => setForm(f => ({ ...f, card_color_secondary: e.target.value || null }))} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Glow (HSL)</Label>
                      <Input placeholder="e.g. 220 85% 60%" value={form.card_glow_color ?? ""} onChange={(e) => setForm(f => ({ ...f, card_glow_color: e.target.value || null }))} />
                    </div>
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
