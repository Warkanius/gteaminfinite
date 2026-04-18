import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { FormDialog } from "@/components/admin/FormDialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatInput } from "@/components/admin/StatInput";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { X, Plus, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { computeOVR } from "@/lib/ovrUtils";
import { EvoPathEditor } from "@/components/admin/EvoPathEditor";
import type { EvoStep } from "@/lib/evoGenerator";

const POSITIONS = ["PG", "SG", "SF", "PF", "C"];
const STAT_KEYS = [
  { key: "stat_3pt", label: "3PT" },
  { key: "stat_mid", label: "MID" },
  { key: "stat_fin", label: "FIN" },
  { key: "stat_dnk", label: "DNK" },
  { key: "stat_ast", label: "AST" },
  { key: "stat_stl", label: "STL" },
  { key: "stat_reb", label: "REB" },
  { key: "stat_blk", label: "BLK" },
  { key: "stat_int", label: "INT" },
] as const;

const BADGE_TIERS = ["base", "gold", "hof", "diamond", "actolytrene"];
const TRAIT_TIERS = ["base", "gold", "hof", "diamond", "actolytrene"];

const tierColor: Record<string, string> = {
  base: "bg-muted text-muted-foreground",
  gold: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  hof: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  diamond: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  actolytrene: "bg-purple-500/20 text-purple-400 border-purple-500/30",
};

interface PlayerQuickEditProps {
  playerId: string | null;
  onClose: () => void;
  onSwitchPlayer?: (id: string) => void;
}

interface PlayerData {
  name: string;
  rating: number;
  position1: string;
  position2: string;
  gem_tier_id: string | null;
  stat_3pt: number;
  stat_mid: number;
  stat_fin: number;
  stat_dnk: number;
  stat_ast: number;
  stat_stl: number;
  stat_reb: number;
  stat_blk: number;
  stat_int: number;
}

interface CardBadge {
  id: string;
  badge_id: string;
  tier: string;
  badge_name: string;
}

interface CardTrait {
  id: string;
  trait_id: string;
  tier: string;
  trait_name: string;
  target_stat: string | null;
}

export function PlayerQuickEdit({ playerId, onClose, onSwitchPlayer }: PlayerQuickEditProps) {
  const qc = useQueryClient();
  const [form, setForm] = useState<PlayerData>({
    name: "", rating: 0, position1: "", position2: "", gem_tier_id: null,
    stat_3pt: 0, stat_mid: 0, stat_fin: 0, stat_dnk: 0,
    stat_ast: 0, stat_stl: 0, stat_reb: 0, stat_blk: 0, stat_int: 0,
  });
  const [loaded, setLoaded] = useState(false);

  // Badge/trait state
  const [cardBadges, setCardBadges] = useState<CardBadge[]>([]);
  const [cardTraits, setCardTraits] = useState<CardTrait[]>([]);
  const [badgesToRemove, setBadgesToRemove] = useState<string[]>([]);
  const [traitsToRemove, setTraitsToRemove] = useState<string[]>([]);
  const [newBadges, setNewBadges] = useState<{ badge_id: string; tier: string; name: string }[]>([]);
  const [newTraits, setNewTraits] = useState<{ trait_id: string; tier: string; name: string; target_stat: string | null }[]>([]);
  const [badgeSearch, setBadgeSearch] = useState("");
  const [traitSearch, setTraitSearch] = useState("");

  // Evo paths
  const [pendingEvoSteps, setPendingEvoSteps] = useState<(EvoStep & { id?: string })[]>([]);
  const [creatingEvo, setCreatingEvo] = useState(false);

  // All badges/traits for lookup
  const { data: allBadges = [] } = useQuery({
    queryKey: ["all-badges"],
    queryFn: async () => {
      const { data } = await supabase.from("badges").select("id, name, abbreviation").order("name");
      return data || [];
    },
  });

  const { data: allTraits = [] } = useQuery({
    queryKey: ["all-traits"],
    queryFn: async () => {
      const { data } = await supabase.from("signature_traits").select("id, name, abbreviation, condition_type").order("name");
      return data || [];
    },
  });

  // Gem tiers for auto-correct + create-evo-version
  const { data: gemTiers = [] } = useQuery({
    queryKey: ["admin-gem-tiers-for-gen"],
    queryFn: async () => {
      const { data } = await supabase.from("gem_tiers").select("id, stars, name, sort_order").order("sort_order");
      return data || [];
    },
  });

  useEffect(() => {
    if (!playerId) { setLoaded(false); return; }
    setLoaded(false);
    setBadgesToRemove([]);
    setTraitsToRemove([]);
    setNewBadges([]);
    setNewTraits([]);
    setBadgeSearch("");
    setTraitSearch("");
    setPendingEvoSteps([]);

    Promise.all([
      supabase.from("player_cards")
        .select("name, rating, position1, position2, gem_tier_id, stat_3pt, stat_mid, stat_fin, stat_dnk, stat_ast, stat_stl, stat_reb, stat_blk, stat_int")
        .eq("id", playerId)
        .single(),
      supabase.from("player_card_badges")
        .select("id, badge_id, tier, badges(name)")
        .eq("player_card_id", playerId),
      supabase.from("player_card_traits")
        .select("id, trait_id, tier, target_stat, signature_traits(name)")
        .eq("player_card_id", playerId),
    ]).then(([playerRes, badgesRes, traitsRes]) => {
      if (playerRes.data) {
        setForm({
          name: playerRes.data.name,
          rating: Number(playerRes.data.rating),
          position1: playerRes.data.position1 ?? "",
          position2: playerRes.data.position2 ?? "",
          gem_tier_id: playerRes.data.gem_tier_id ?? null,
          stat_3pt: Number(playerRes.data.stat_3pt), stat_mid: Number(playerRes.data.stat_mid), stat_fin: Number(playerRes.data.stat_fin),
          stat_dnk: Number(playerRes.data.stat_dnk), stat_ast: Number(playerRes.data.stat_ast), stat_stl: Number(playerRes.data.stat_stl),
          stat_reb: Number(playerRes.data.stat_reb), stat_blk: Number(playerRes.data.stat_blk), stat_int: Number(playerRes.data.stat_int),
        });
      }
      if (badgesRes.data) {
        setCardBadges(badgesRes.data.map((b: any) => ({
          id: b.id,
          badge_id: b.badge_id,
          tier: b.tier,
          badge_name: b.badges?.name ?? "Unknown",
        })));
      }
      if (traitsRes.data) {
        setCardTraits(traitsRes.data.map((t: any) => ({
          id: t.id,
          trait_id: t.trait_id,
          tier: t.tier,
          trait_name: t.signature_traits?.name ?? "Unknown",
          target_stat: t.target_stat,
        })));
      }
      setLoaded(true);
    });
  }, [playerId]);

  const save = useMutation({
    mutationFn: async () => {
      if (!playerId) return;

      const matchingTier = gemTiers.find(g => g.stars === form.rating) ?? null;

      const { error } = await supabase.from("player_cards").update({
        name: form.name,
        rating: form.rating,
        position1: form.position1 || null,
        position2: form.position2 || null,
        gem_tier_id: matchingTier?.id ?? form.gem_tier_id ?? null,
        stat_3pt: form.stat_3pt, stat_mid: form.stat_mid, stat_fin: form.stat_fin,
        stat_dnk: form.stat_dnk, stat_ast: form.stat_ast, stat_stl: form.stat_stl,
        stat_reb: form.stat_reb, stat_blk: form.stat_blk, stat_int: form.stat_int,
      }).eq("id", playerId);
      if (error) throw error;

      if (badgesToRemove.length > 0) {
        const { error: delErr } = await supabase.from("player_card_badges").delete().in("id", badgesToRemove);
        if (delErr) throw delErr;
      }
      if (newBadges.length > 0) {
        const rows = newBadges.map(b => ({ player_card_id: playerId, badge_id: b.badge_id, tier: b.tier }));
        const { error: insErr } = await supabase.from("player_card_badges").insert(rows);
        if (insErr) throw insErr;
      }
      if (traitsToRemove.length > 0) {
        const { error: delErr } = await supabase.from("player_card_traits").delete().in("id", traitsToRemove);
        if (delErr) throw delErr;
      }
      if (newTraits.length > 0) {
        const rows = newTraits.map(t => ({ player_card_id: playerId, trait_id: t.trait_id, tier: t.tier, target_stat: t.target_stat }));
        const { error: insErr } = await supabase.from("player_card_traits").insert(rows);
        if (insErr) throw insErr;
      }

      // Evo paths: full replace
      const { error: evoDelErr } = await supabase.from("evo_paths").delete().eq("player_card_id", playerId);
      if (evoDelErr) throw evoDelErr;
      if (pendingEvoSteps.length > 0) {
        const rows = pendingEvoSteps.map((s, i) => ({
          player_card_id: playerId,
          step_order: i + 1,
          from_tier_id: s.from_tier_id ?? null,
          to_tier_id: s.to_tier_id || null,
          challenge_description: s.challenge_description ?? "",
          challenge_type: s.challenge_type ?? "points_scored",
          challenge_target: Number(s.challenge_target ?? 0),
          challenge_stat: (s as any).challenge_stat ?? null,
          new_badges: (s.new_badges ?? []) as any,
          compound_challenges: (s.compound_challenges ?? []) as any,
          evolves_to_card_id: (s as any).evolves_to_card_id ?? null,
          stat_boosts: {} as any,
        }));
        const { error: evoInsErr } = await supabase.from("evo_paths").insert(rows);
        if (evoInsErr) throw evoInsErr;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-all-players-lite"] });
      qc.invalidateQueries({ queryKey: ["admin-team-players"] });
      qc.invalidateQueries({ queryKey: ["admin-dom-game-players"] });
      qc.invalidateQueries({ queryKey: ["admin-all-player-badges"] });
      qc.invalidateQueries({ queryKey: ["pack-players"] });
      qc.invalidateQueries({ queryKey: ["player-cards-list"] });
      qc.invalidateQueries({ queryKey: ["evo-paths", playerId] });
      qc.invalidateQueries({ queryKey: ["evo-target-ids"] });
      toast.success("Player updated");
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  // ---------- Create Evo Version ----------
  async function handleCreateEvoVersion() {
    if (!playerId) return;
    const sortedTiers = [...gemTiers].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const currentTier = sortedTiers.find(t => t.id === form.gem_tier_id);
    const currentIdx = currentTier ? sortedTiers.indexOf(currentTier) : -1;
    const nextTier = currentIdx >= 0 ? sortedTiers[currentIdx + 1] : sortedTiers[0];
    if (!nextTier) {
      toast.error("No higher gem tier available");
      return;
    }

    setCreatingEvo(true);
    try {
      // Fetch full source row to clone all visual fields
      const { data: src, error: srcErr } = await supabase
        .from("player_cards")
        .select("*")
        .eq("id", playerId)
        .single();
      if (srcErr || !src) throw srcErr || new Error("Source card not found");

      const { id: _omitId, created_at: _c, updated_at: _u, ...srcRest } = src as any;
      const insertRow = {
        ...srcRest,
        name: `${src.name} (${nextTier.name})`,
        gem_tier_id: nextTier.id,
        rating: nextTier.stars ?? src.rating,
      };

      const { data: newCard, error: insErr } = await supabase
        .from("player_cards")
        .insert(insertRow)
        .select("id")
        .single();
      if (insErr || !newCard) throw insErr || new Error("Insert failed");

      // Clone badges + traits
      const [badgeRows, traitRows] = await Promise.all([
        supabase.from("player_card_badges").select("badge_id, tier").eq("player_card_id", playerId),
        supabase.from("player_card_traits").select("trait_id, tier, target_stat").eq("player_card_id", playerId),
      ]);
      if (badgeRows.data && badgeRows.data.length > 0) {
        await supabase.from("player_card_badges").insert(
          badgeRows.data.map((b: any) => ({ player_card_id: newCard.id, badge_id: b.badge_id, tier: b.tier }))
        );
      }
      if (traitRows.data && traitRows.data.length > 0) {
        await supabase.from("player_card_traits").insert(
          traitRows.data.map((t: any) => ({ player_card_id: newCard.id, trait_id: t.trait_id, tier: t.tier, target_stat: t.target_stat }))
        );
      }

      // Auto-link: lowest step_order with NULL evolves_to_card_id
      const { data: openStep } = await supabase
        .from("evo_paths")
        .select("id")
        .eq("player_card_id", playerId)
        .is("evolves_to_card_id", null)
        .order("step_order", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (openStep?.id) {
        await supabase.from("evo_paths").update({ evolves_to_card_id: newCard.id }).eq("id", openStep.id);
      }

      qc.invalidateQueries({ queryKey: ["admin-all-players-lite"] });
      qc.invalidateQueries({ queryKey: ["player-cards-list"] });
      qc.invalidateQueries({ queryKey: ["evo-paths", playerId] });
      qc.invalidateQueries({ queryKey: ["evo-target-ids"] });

      toast.success(`Created ${nextTier.name} version`);

      if (onSwitchPlayer) {
        onSwitchPlayer(newCard.id);
      } else {
        onClose();
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to create evo version");
    } finally {
      setCreatingEvo(false);
    }
  }

  // Filtered badge/trait search results
  const filteredBadges = allBadges.filter(b => {
    if (!badgeSearch) return false;
    const q = badgeSearch.toLowerCase();
    const alreadyHas = cardBadges.some(cb => cb.badge_id === b.id && !badgesToRemove.includes(cb.id));
    const alreadyNew = newBadges.some(nb => nb.badge_id === b.id);
    return !alreadyHas && !alreadyNew && (b.name.toLowerCase().includes(q) || b.abbreviation.toLowerCase().includes(q));
  });

  const filteredTraits = allTraits.filter(t => {
    if (!traitSearch) return false;
    const q = traitSearch.toLowerCase();
    const alreadyHas = cardTraits.some(ct => ct.trait_id === t.id && !traitsToRemove.includes(ct.id));
    const alreadyNew = newTraits.some(nt => nt.trait_id === t.id);
    return !alreadyHas && !alreadyNew && (t.name.toLowerCase().includes(q) || t.abbreviation.toLowerCase().includes(q));
  });

  const activeBadges = cardBadges.filter(b => !badgesToRemove.includes(b.id));
  const activeTraits = cardTraits.filter(t => !traitsToRemove.includes(t.id));

  // Combined badges (active existing + pending new) for evo generator hints
  const combinedBadgesForEvo = [
    ...activeBadges.map(b => ({ badge_id: b.badge_id, tier: b.tier })),
    ...newBadges.map(b => ({ badge_id: b.badge_id, tier: b.tier })),
  ];

  const playerStatsForEvo = {
    stat_3pt: form.stat_3pt, stat_mid: form.stat_mid, stat_fin: form.stat_fin,
    stat_dnk: form.stat_dnk, stat_ast: form.stat_ast, stat_stl: form.stat_stl,
    stat_reb: form.stat_reb, stat_blk: form.stat_blk, stat_int: form.stat_int,
  };

  return (
    <FormDialog
      open={!!playerId}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title="Quick Edit Player"
      onSave={() => save.mutate()}
      saving={save.isPending}
    >
      {!loaded ? (
        <div className="py-8 text-center text-muted-foreground">Loading…</div>
      ) : (
        <div className="space-y-5 px-1">
          {/* Basic Info */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1 col-span-2">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Position 1</Label>
              <Select value={form.position1} onValueChange={(v) => setForm(f => ({ ...f, position1: v }))}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  {POSITIONS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Position 2</Label>
              <Select value={form.position2 || "none"} onValueChange={(v) => setForm(f => ({ ...f, position2: v === "none" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {POSITIONS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Star Rating */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs uppercase tracking-wider text-muted-foreground">Overall Star Rating</Label>
              <span className="font-bold text-sm">{form.rating}★ <span className="text-muted-foreground font-normal">({computeOVR(form)} OVR)</span></span>
            </div>
            <Slider
              min={0}
              max={6}
              step={1}
              value={[form.rating]}
              onValueChange={([v]) => setForm(f => ({ ...f, rating: v }))}
            />
          </div>

          {/* Stats */}
          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">Stats (0–6 stars)</Label>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
              {STAT_KEYS.map(({ key, label }) => (
                <StatInput
                  key={key}
                  label={label}
                  value={(form as any)[key]}
                  onChange={(v) => setForm(f => ({ ...f, [key]: v }))}
                  min={0}
                  max={6}
                />
              ))}
            </div>
          </div>

          {/* Badges */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground block">Badges</Label>
            {activeBadges.length > 0 || newBadges.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {activeBadges.map(b => (
                  <Badge key={b.id} variant="outline" className={`text-xs gap-1 ${tierColor[b.tier] || ""}`}>
                    {b.badge_name}
                    <span className="text-[9px] opacity-60">({b.tier})</span>
                    <button onClick={() => setBadgesToRemove(prev => [...prev, b.id])} className="ml-0.5 hover:text-destructive">
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                {newBadges.map((b, i) => (
                  <Badge key={`new-${i}`} variant="outline" className={`text-xs gap-1 border-dashed ${tierColor[b.tier] || ""}`}>
                    {b.name}
                    <Select value={b.tier} onValueChange={(v) => setNewBadges(prev => prev.map((nb, j) => j === i ? { ...nb, tier: v } : nb))}>
                      <SelectTrigger className="h-4 w-auto border-0 p-0 text-[9px] opacity-60 gap-0.5 bg-transparent">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {BADGE_TIERS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <button onClick={() => setNewBadges(prev => prev.filter((_, j) => j !== i))} className="ml-0.5 hover:text-destructive">
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No badges</p>
            )}
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search badges to add…"
                value={badgeSearch}
                onChange={(e) => setBadgeSearch(e.target.value)}
                className="pl-7 h-8 text-xs"
              />
            </div>
            {filteredBadges.length > 0 && (
              <div className="border rounded-md max-h-[120px] overflow-y-auto divide-y divide-border/30">
                {filteredBadges.slice(0, 10).map(b => (
                  <button
                    key={b.id}
                    className="w-full flex items-center justify-between px-2 py-1.5 text-xs hover:bg-muted/50 transition-colors"
                    onClick={() => {
                      setNewBadges(prev => [...prev, { badge_id: b.id, tier: "base", name: b.name }]);
                      setBadgeSearch("");
                    }}
                  >
                    <span>{b.name} <span className="text-muted-foreground">({b.abbreviation})</span></span>
                    <Plus className="h-3 w-3 text-primary" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Traits */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wider text-muted-foreground block">Signature Traits</Label>
            {activeTraits.length > 0 || newTraits.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {activeTraits.map(t => (
                  <Badge key={t.id} variant="outline" className={`text-xs gap-1 ${tierColor[t.tier] || ""}`}>
                    {t.trait_name}
                    <span className="text-[9px] opacity-60">({t.tier})</span>
                    <button onClick={() => setTraitsToRemove(prev => [...prev, t.id])} className="ml-0.5 hover:text-destructive">
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
                {newTraits.map((t, i) => (
                  <Badge key={`new-${i}`} variant="outline" className={`text-xs gap-1 border-dashed ${tierColor[t.tier] || ""}`}>
                    {t.name}
                    <Select value={t.tier} onValueChange={(v) => setNewTraits(prev => prev.map((nt, j) => j === i ? { ...nt, tier: v } : nt))}>
                      <SelectTrigger className="h-4 w-auto border-0 p-0 text-[9px] opacity-60 gap-0.5 bg-transparent">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TRAIT_TIERS.map(tr => <SelectItem key={tr} value={tr}>{tr}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <button onClick={() => setNewTraits(prev => prev.filter((_, j) => j !== i))} className="ml-0.5 hover:text-destructive">
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No traits</p>
            )}
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search traits to add…"
                value={traitSearch}
                onChange={(e) => setTraitSearch(e.target.value)}
                className="pl-7 h-8 text-xs"
              />
            </div>
            {filteredTraits.length > 0 && (
              <div className="border rounded-md max-h-[120px] overflow-y-auto divide-y divide-border/30">
                {filteredTraits.slice(0, 10).map(t => (
                  <button
                    key={t.id}
                    className="w-full flex items-center justify-between px-2 py-1.5 text-xs hover:bg-muted/50 transition-colors"
                    onClick={() => {
                      setNewTraits(prev => [...prev, { trait_id: t.id, tier: "base", name: t.name, target_stat: null }]);
                      setTraitSearch("");
                    }}
                  >
                    <span>{t.name} <span className="text-muted-foreground">({t.abbreviation})</span></span>
                    <Plus className="h-3 w-3 text-primary" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Evolution Paths */}
          {playerId && (
            <EvoPathEditor
              playerId={playerId}
              playerGemTierId={form.gem_tier_id}
              playerStats={playerStatsForEvo}
              playerBadges={combinedBadgesForEvo}
              onStepsChange={setPendingEvoSteps}
            />
          )}

          {/* Create Evo Version */}
          <div className="rounded-lg border border-dashed border-primary/30 bg-primary/5 p-3 flex items-center justify-between gap-3">
            <div className="text-xs">
              <p className="font-semibold flex items-center gap-1.5"><Sparkles className="h-3.5 w-3.5 text-primary" /> Create Evo Version</p>
              <p className="text-muted-foreground mt-0.5">Clones this card into the next gem tier and auto-links it to an open evo step.</p>
            </div>
            <Button size="sm" variant="secondary" disabled={creatingEvo} onClick={handleCreateEvoVersion}>
              {creatingEvo ? "Creating…" : "Create"}
            </Button>
          </div>
        </div>
      )}
    </FormDialog>
  );
}
