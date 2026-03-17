import { useState, useMemo, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { Wand2, ChevronRight, ChevronLeft, RefreshCw, Check, Sparkles, Search, User, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { NBA_LEGENDS, ARCHETYPE_LIST, MODIFIER_LIST, generateFromProfile, type WizardProfile, type LegendProfile } from "@/lib/archetypeEngine";
import type { Tables } from "@/integrations/supabase/types";

const STAT_KEYS = ["stat_3pt", "stat_mid", "stat_fin", "stat_dnk", "stat_ast", "stat_stl", "stat_reb", "stat_blk", "stat_int"] as const;
const STAT_LABELS: Record<string, string> = {
  stat_3pt: "3PT", stat_mid: "MID", stat_fin: "FIN", stat_dnk: "DNK",
  stat_ast: "AST", stat_stl: "STL", stat_reb: "REB", stat_blk: "BLK", stat_int: "INT",
};

const MODIFIER_CHIPS = [
  { label: "Elite Shooter", kw: "elite shooter" },
  { label: "Elite Finisher", kw: "elite finisher" },
  { label: "Elite Defender", kw: "elite defense" },
  { label: "Elite Playmaker", kw: "elite playmaker" },
  { label: "Athletic", kw: "athletic" },
  { label: "High IQ", kw: "high iq" },
  { label: "Badge Heavy", kw: "badge heavy" },
  { label: "Hidden Gem", kw: "hidden gem" },
  { label: "Raw / Project", kw: "raw" },
  { label: "Balanced", kw: "balanced" },
];

const STEPS = ["Identity", "Playstyle", "Strengths", "Review"];
const BADGE_TIERS = ["base", "gold", "hof", "diamond", "actolytrene"];

type GemTier = Tables<"gem_tiers">;
type PlayerCard = Tables<"player_cards">;
type BadgeRow = Tables<"badges">;
type TraitRow = Tables<"signature_traits">;

interface WizardResult {
  stats: Record<string, number>;
  badges: { badge_id: string; tier: string }[];
  traits: { trait_id: string; tier: string; target_stat: string | null }[];
  positions: [string, string | null];
  summary: string;
}

interface PlayerWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAccept: (result: WizardResult) => void;
  gemTiers: GemTier[];
  players: PlayerCard[];
  allBadges: BadgeRow[];
  allTraits?: TraitRow[];
  /** If editing, pre-fill name & gem tier */
  editingPlayer?: PlayerCard | null;
}

export function PlayerWizard({ open, onOpenChange, onAccept, gemTiers, players, allBadges, allTraits = [], editingPlayer }: PlayerWizardProps) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [gemTierId, setGemTierId] = useState<string>("");
  const [inspireSearch, setInspireSearch] = useState("");
  const [inspireSource, setInspireSource] = useState<{ type: "legend"; profile: LegendProfile } | { type: "player"; player: PlayerCard } | null>(null);
  const [selectedArchetype, setSelectedArchetype] = useState<string>("");
  const [selectedModifiers, setSelectedModifiers] = useState<string[]>([]);
  const [strengthStats, setStrengthStats] = useState<string[]>([]);
  const [weakStats, setWeakStats] = useState<string[]>([]);
  const [result, setResult] = useState<WizardResult | null>(null);

  // Badge/trait add UI
  const [badgeSearch, setBadgeSearch] = useState("");
  const [traitSearch, setTraitSearch] = useState("");
  const [pendingBadgeId, setPendingBadgeId] = useState<string | null>(null);
  const [pendingTraitId, setPendingTraitId] = useState<string | null>(null);
  const [pendingTraitTier, setPendingTraitTier] = useState<string>("base");

  // Reset state when dialog opens
  function resetWizard() {
    setStep(0);
    setInspireSearch("");
    setInspireSource(null);
    setSelectedArchetype("");
    setSelectedModifiers([]);
    setStrengthStats([]);
    setWeakStats([]);
    setResult(null);
    setBadgeSearch("");
    setTraitSearch("");
    setPendingBadgeId(null);
    setPendingTraitId(null);
    if (editingPlayer) {
      setName(editingPlayer.name);
      setGemTierId(editingPlayer.gem_tier_id ?? "");
    } else {
      setName("");
      setGemTierId("");
    }
  }

  // Reset wizard on every open or editingPlayer change
  useEffect(() => {
    if (open) resetWizard();
  }, [open, editingPlayer?.id]);

  // ── Mr. Versatile badge cap logic ──
  const hasMrVersatile = useMemo(() => {
    if (!result) return false;
    return result.traits.some(t => {
      const trait = allTraits.find(at => at.id === t.trait_id);
      return trait && trait.condition_type === "passive" && trait.abbreviation === "MV";
    });
  }, [result?.traits, allTraits]);

  const mrVersatileSlots = useMemo(() => {
    if (!result || !hasMrVersatile) return 0;
    const mvTrait = result.traits.find(t => {
      const trait = allTraits.find(at => at.id === t.trait_id);
      return trait && trait.condition_type === "passive" && trait.abbreviation === "MV";
    });
    if (!mvTrait) return 0;
    const tierMap: Record<string, number> = { base: 1, gold: 2, hof: 3, diamond: 4, actolytrene: 5 };
    return tierMap[mvTrait.tier] ?? 0;
  }, [result?.traits, allTraits, hasMrVersatile]);

  const maxBadges = 5 + (hasMrVersatile ? mrVersatileSlots : 0);
  const maxTraits = 1 + (hasMrVersatile ? mrVersatileSlots : 0);

  // Inspiration search results
  const inspireResults = useMemo(() => {
    if (!inspireSearch.trim()) return [];
    const q = inspireSearch.toLowerCase();
    const legendResults = Object.entries(NBA_LEGENDS)
      .filter(([key]) => key.includes(q))
      .slice(0, 5)
      .map(([, profile]) => ({ type: "legend" as const, profile, label: profile.name }));
    const playerResults = players
      .filter(p => p.name.toLowerCase().includes(q))
      .slice(0, 5)
      .map(p => ({ type: "player" as const, player: p, label: `${p.name} (${p.rating} OVR)` }));
    return [...legendResults, ...playerResults];
  }, [inspireSearch, players]);

  // Badge search results for adding
  const filteredBadges = useMemo(() => {
    if (!badgeSearch.trim()) return [];
    const q = badgeSearch.toLowerCase();
    const existingIds = result?.badges.map(b => b.badge_id) ?? [];
    return allBadges
      .filter(b => !existingIds.includes(b.id) && (b.name.toLowerCase().includes(q) || b.abbreviation.toLowerCase().includes(q)))
      .slice(0, 8);
  }, [badgeSearch, allBadges, result?.badges]);

  // Trait search results for adding
  const filteredTraits = useMemo(() => {
    if (!traitSearch.trim()) return [];
    const q = traitSearch.toLowerCase();
    const existingIds = result?.traits.map(t => t.trait_id) ?? [];
    return allTraits
      .filter(t => !existingIds.includes(t.id) && (t.name.toLowerCase().includes(q) || t.abbreviation.toLowerCase().includes(q)))
      .slice(0, 8);
  }, [traitSearch, allTraits, result?.traits]);

  function selectInspiration(item: typeof inspireResults[0]) {
    if (item.type === "legend") {
      setInspireSource({ type: "legend", profile: item.profile });
      setSelectedArchetype(item.profile.archetype);
      setSelectedModifiers(item.profile.modifiers.map(m => {
        const chip = MODIFIER_CHIPS.find(c => c.kw.includes(m.toLowerCase()) || m.toLowerCase().includes(c.kw));
        return chip?.kw ?? m;
      }).filter(Boolean));
      setStrengthStats(item.profile.strengthStats);
      setWeakStats(item.profile.weakStats);
    } else {
      setInspireSource({ type: "player", player: item.player });
      setSelectedArchetype("");
      setSelectedModifiers([]);
      setStrengthStats([]);
      setWeakStats([]);
    }
    setInspireSearch("");
  }

  function generateResult() {
    const selectedTier = gemTiers.find(g => g.id === gemTierId);
    if (!selectedTier) return null;

    const inspiredByStats = inspireSource?.type === "player"
      ? STAT_KEYS.reduce((acc, k) => ({ ...acc, [k]: (inspireSource.player as any)[k] ?? 0 }), {} as Record<string, number>)
      : null;

    const profile: WizardProfile = {
      archetype: selectedArchetype || "combo guard",
      modifiers: selectedModifiers,
      strengthStats: strengthStats as any,
      weakStats: weakStats as any,
      inspiredByStats,
    };

    const gen = generateFromProfile(
      profile,
      selectedTier.stars,
      allBadges.map(b => ({ id: b.id, abbreviation: b.abbreviation, affected_stat: b.affected_stat, effect_type: b.effect_type })),
    );

    const mappedBadges = gen.badges
      .map(rb => {
        const badge = allBadges.find(b => b.abbreviation.toLowerCase() === rb.abbreviation.toLowerCase());
        return badge ? { badge_id: badge.id, tier: rb.tier } : null;
      })
      .filter(Boolean) as { badge_id: string; tier: string }[];

    return { stats: gen.stats, badges: mappedBadges, traits: [] as { trait_id: string; tier: string; target_stat: string | null }[], positions: gen.positions, summary: gen.summary };
  }

  function handleNext() {
    if (step === 2) {
      const r = generateResult();
      setResult(r);
      setStep(3);
    } else {
      setStep(s => Math.min(s + 1, 3));
    }
  }

  function handleReroll() {
    const r = generateResult();
    setResult(r);
  }

  function handleAccept() {
    if (!result) return;
    onAccept(result);
    onOpenChange(false);
  }

  // ── Review step editing functions ──

  function updateStat(key: string, value: number) {
    if (!result) return;
    setResult({ ...result, stats: { ...result.stats, [key]: value } });
  }

  function removeBadge(index: number) {
    if (!result) return;
    setResult({ ...result, badges: result.badges.filter((_, i) => i !== index) });
  }

  function addBadge(badgeId: string, tier: string) {
    if (!result) return;
    if (result.badges.length >= maxBadges) return;
    setResult({ ...result, badges: [...result.badges, { badge_id: badgeId, tier }] });
    setBadgeSearch("");
    setPendingBadgeId(null);
  }

  function updateBadgeTier(index: number, tier: string) {
    if (!result) return;
    const badges = [...result.badges];
    badges[index] = { ...badges[index], tier };
    setResult({ ...result, badges });
  }

  function removeTrait(index: number) {
    if (!result) return;
    setResult({ ...result, traits: result.traits.filter((_, i) => i !== index) });
  }

  function addTrait(traitId: string, tier: string, targetStat: string | null) {
    if (!result) return;
    if (result.traits.length >= maxTraits) return;
    setResult({ ...result, traits: [...result.traits, { trait_id: traitId, tier, target_stat: targetStat }] });
    setTraitSearch("");
    setPendingTraitId(null);
  }

  function updateTraitTier(index: number, tier: string) {
    if (!result) return;
    const traits = [...result.traits];
    traits[index] = { ...traits[index], tier };
    setResult({ ...result, traits });
  }

  const canNext = () => {
    if (step === 0) return !!gemTierId;
    if (step === 1) return !!selectedArchetype;
    return true;
  };

  const ovrStars = result ? Math.round(STAT_KEYS.reduce((s, k) => s + (result.stats[k] ?? 0), 0) / STAT_KEYS.length) : 0;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (o) resetWizard(); onOpenChange(o); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-primary" />
            {editingPlayer ? `Wizard: ${editingPlayer.name}` : "Player Creation Wizard"}
          </DialogTitle>
          <DialogDescription>
            {editingPlayer ? "Regenerate stats and badges for this player." : "Build a player through a guided quiz."}
          </DialogDescription>
        </DialogHeader>

        {/* Step progress */}
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            {STEPS.map((s, i) => (
              <span key={s} className={cn("transition-colors", i === step ? "text-primary font-semibold" : i < step ? "text-foreground" : "")}>
                {i + 1}. {s}
              </span>
            ))}
          </div>
          <Progress value={((step + 1) / STEPS.length) * 100} className="h-1.5" />
        </div>

        {/* Step 0: Identity */}
        {step === 0 && (
          <div className="space-y-5 py-2">
            {!editingPlayer && (
              <div className="space-y-1">
                <Label>Player Name</Label>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Marcus Thompson" />
              </div>
            )}
            <div className="space-y-1">
              <Label>Gem Tier (Star Rating)</Label>
              <Select value={gemTierId} onValueChange={setGemTierId}>
                <SelectTrigger><SelectValue placeholder="Select tier…" /></SelectTrigger>
                <SelectContent>
                  {gemTiers.map(g => (
                    <SelectItem key={g.id} value={g.id}>{"⭐".repeat(g.stars)} {g.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Inspired by */}
            <div className="space-y-2">
              <Label className="flex items-center gap-1"><Sparkles className="h-3 w-3" /> Inspired By (Optional)</Label>
              <p className="text-xs text-muted-foreground">Search NBA legends or existing players to pre-seed playstyle.</p>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="Search legends or players…"
                  value={inspireSearch}
                  onChange={e => setInspireSearch(e.target.value)}
                />
                {inspireResults.length > 0 && (
                  <div className="absolute z-50 top-full mt-1 w-full rounded-md border bg-popover shadow-lg max-h-48 overflow-y-auto">
                    {inspireResults.map((item, i) => (
                      <button
                        key={i}
                        onClick={() => selectInspiration(item)}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-accent/50 flex items-center gap-2"
                      >
                        {item.type === "legend" ? <Sparkles className="h-3 w-3 text-primary" /> : <User className="h-3 w-3 text-muted-foreground" />}
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {inspireSource && (
                <Badge variant="secondary" className="gap-1">
                  {inspireSource.type === "legend" ? inspireSource.profile.name : inspireSource.player.name}
                  <button onClick={() => setInspireSource(null)} className="ml-1 hover:text-destructive">×</button>
                </Badge>
              )}
            </div>
          </div>
        )}

        {/* Step 1: Playstyle */}
        {step === 1 && (
          <div className="space-y-5 py-2">
            <div className="space-y-2">
              <Label>Archetype</Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {ARCHETYPE_LIST.map(arch => (
                  <button
                    key={arch.name}
                    onClick={() => setSelectedArchetype(arch.name.toLowerCase())}
                    className={cn(
                      "p-3 rounded-lg border text-left transition-all hover:border-primary/50",
                      selectedArchetype === arch.name.toLowerCase()
                        ? "border-primary bg-primary/10 ring-1 ring-primary/30"
                        : "border-border bg-card"
                    )}
                  >
                    <div className="font-semibold text-sm">{arch.name}</div>
                    <div className="text-xs text-muted-foreground">{arch.positions.filter(Boolean).join("/")}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Modifiers</Label>
              <div className="flex flex-wrap gap-2">
                {MODIFIER_CHIPS.map(chip => {
                  const active = selectedModifiers.includes(chip.kw);
                  return (
                    <button
                      key={chip.kw}
                      onClick={() => setSelectedModifiers(prev =>
                        active ? prev.filter(m => m !== chip.kw) : [...prev, chip.kw]
                      )}
                      className={cn(
                        "px-3 py-1.5 rounded-full text-xs font-medium border transition-all",
                        active
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border bg-card text-muted-foreground hover:border-primary/40"
                      )}
                    >
                      {chip.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Step 2: Strengths & Weaknesses */}
        {step === 2 && (
          <div className="space-y-5 py-2">
            <div className="space-y-2">
              <Label>Elite Stats (pick 2-3)</Label>
              <p className="text-xs text-muted-foreground">These stats get a significant boost.</p>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {STAT_KEYS.map(k => {
                  const active = strengthStats.includes(k);
                  const isWeak = weakStats.includes(k);
                  return (
                    <button
                      key={k}
                      disabled={isWeak}
                      onClick={() => setStrengthStats(prev =>
                        active ? prev.filter(s => s !== k) : prev.length < 3 ? [...prev, k] : prev
                      )}
                      className={cn(
                        "p-2 rounded-lg border text-center font-mono text-sm transition-all",
                        active ? "border-green-500 bg-green-500/15 text-green-400" : "border-border bg-card",
                        isWeak && "opacity-30 cursor-not-allowed"
                      )}
                    >
                      {STAT_LABELS[k]}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Weak Stats (pick 1-2)</Label>
              <p className="text-xs text-muted-foreground">These stats get a noticeable penalty.</p>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                {STAT_KEYS.map(k => {
                  const active = weakStats.includes(k);
                  const isStrong = strengthStats.includes(k);
                  return (
                    <button
                      key={k}
                      disabled={isStrong}
                      onClick={() => setWeakStats(prev =>
                        active ? prev.filter(s => s !== k) : prev.length < 2 ? [...prev, k] : prev
                      )}
                      className={cn(
                        "p-2 rounded-lg border text-center font-mono text-sm transition-all",
                        active ? "border-destructive bg-destructive/15 text-destructive" : "border-border bg-card",
                        isStrong && "opacity-30 cursor-not-allowed"
                      )}
                    >
                      {STAT_LABELS[k]}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Review — fully interactive */}
        {step === 3 && result && (
          <div className="space-y-5 py-2">
            <div className="text-center">
              <Badge variant="secondary" className="text-base gap-1 mb-2">
                <Sparkles className="h-3 w-3" /> {result.summary}
              </Badge>
              <div className="text-sm text-muted-foreground">
                Position: {result.positions.filter(Boolean).join(" / ")}
              </div>
            </div>

            {/* Stat sliders (0-12, scalebreaking allowed) */}
            <div className="space-y-1">
              <Label className="text-xs flex items-center justify-between">
                <span>Stats</span>
                <span className="text-muted-foreground font-normal">Drag to adjust · 7+ = scalebreaker</span>
              </Label>
              <div className="grid gap-3">
                {STAT_KEYS.map(k => {
                  const val = result.stats[k] ?? 0;
                  const isScaleBreaker = val >= 7;
                  return (
                    <div key={k} className="flex items-center gap-3">
                      <span className="text-xs font-mono uppercase w-8 text-muted-foreground">{STAT_LABELS[k]}</span>
                      <Slider
                        value={[val]}
                        min={0}
                        max={12}
                        step={1}
                        onValueChange={([v]) => updateStat(k, v)}
                        className="flex-1"
                      />
                      <span className={cn(
                        "text-sm font-mono font-semibold w-8 text-right",
                        isScaleBreaker ? "text-red-400 animate-pulse" : val >= 6 ? "text-amber-400" : ""
                      )}>
                        {val}
                        {isScaleBreaker && <span className="text-[9px] ml-0.5">🔥</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="text-center text-2xl font-mono font-bold">
              OVR {"⭐".repeat(Math.min(ovrStars, 6))}{ovrStars > 6 ? ` +${ovrStars - 6}🔥` : ""}
            </div>

            {/* Badges — editable */}
            <div className="space-y-2">
              <Label className="text-xs flex items-center justify-between">
                <span>Badges ({result.badges.length}/{maxBadges})</span>
                {hasMrVersatile && <span className="text-amber-400 font-normal">Mr. Versatile: +{mrVersatileSlots} slots</span>}
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {result.badges.map((b, i) => {
                  const badge = allBadges.find(ab => ab.id === b.badge_id);
                  return (
                    <div key={i} className="flex items-center gap-0.5">
                      <Badge variant="outline" className="text-xs capitalize gap-1 pr-1">
                        {badge?.abbreviation ?? "?"} ·
                        <select
                          value={b.tier}
                          onChange={(e) => updateBadgeTier(i, e.target.value)}
                          className="bg-transparent border-none text-xs cursor-pointer outline-none capitalize"
                        >
                          {BADGE_TIERS.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                        <button onClick={() => removeBadge(i)} className="ml-0.5 hover:text-destructive">
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    </div>
                  );
                })}
              </div>
              {/* Add badge */}
              {result.badges.length < maxBadges && (
                <div className="relative">
                  <div className="flex items-center gap-2">
                    <Search className="h-3 w-3 text-muted-foreground" />
                    <Input
                      className="h-8 text-xs"
                      placeholder="Search badges to add…"
                      value={badgeSearch}
                      onChange={e => { setBadgeSearch(e.target.value); setPendingBadgeId(null); }}
                    />
                  </div>
                  {filteredBadges.length > 0 && !pendingBadgeId && (
                    <div className="absolute z-50 top-full mt-1 w-full rounded-md border bg-popover shadow-lg max-h-36 overflow-y-auto">
                      {filteredBadges.map(b => (
                        <button
                          key={b.id}
                          onClick={() => setPendingBadgeId(b.id)}
                          className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent/50"
                        >
                          <span className="font-semibold">{b.abbreviation}</span> — {b.name}
                          <span className="text-muted-foreground ml-1">({b.effect_type})</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {pendingBadgeId && (
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-muted-foreground">Tier:</span>
                      {BADGE_TIERS.map(t => (
                        <button
                          key={t}
                          onClick={() => addBadge(pendingBadgeId, t)}
                          className="px-2 py-0.5 rounded border text-xs capitalize hover:bg-accent/50 border-border"
                        >
                          {t}
                        </button>
                      ))}
                      <button onClick={() => setPendingBadgeId(null)} className="text-xs text-muted-foreground hover:text-destructive ml-1">Cancel</button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Signature Traits — editable */}
            <div className="space-y-2">
              <Label className="text-xs flex items-center justify-between">
                <span>Signature Traits ({result.traits.length}/{maxTraits})</span>
                {hasMrVersatile && <span className="text-amber-400 font-normal">Mr. Versatile: +{mrVersatileSlots} slots</span>}
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {result.traits.map((t, i) => {
                  const trait = allTraits.find(at => at.id === t.trait_id);
                  return (
                    <div key={i} className="flex items-center gap-0.5">
                      <Badge variant="outline" className="text-xs capitalize gap-1 pr-1 border-amber-500/50">
                        {trait?.abbreviation ?? "?"} ·
                        <select
                          value={t.tier}
                          onChange={(e) => updateTraitTier(i, e.target.value)}
                          className="bg-transparent border-none text-xs cursor-pointer outline-none capitalize"
                        >
                          {BADGE_TIERS.map(tier => <option key={tier} value={tier}>{tier}</option>)}
                        </select>
                        {t.target_stat && <span className="text-muted-foreground">({STAT_LABELS[t.target_stat] ?? t.target_stat})</span>}
                        <button onClick={() => removeTrait(i)} className="ml-0.5 hover:text-destructive">
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    </div>
                  );
                })}
              </div>
              {/* Add trait */}
              <div className="relative">
                <div className="flex items-center gap-2">
                  <Search className="h-3 w-3 text-muted-foreground" />
                  <Input
                    className="h-8 text-xs"
                    placeholder="Search traits to add…"
                    value={traitSearch}
                    onChange={e => { setTraitSearch(e.target.value); setPendingTraitId(null); }}
                  />
                </div>
                {filteredTraits.length > 0 && !pendingTraitId && (
                  <div className="absolute z-50 top-full mt-1 w-full rounded-md border bg-popover shadow-lg max-h-36 overflow-y-auto">
                    {filteredTraits.map(t => (
                      <button
                        key={t.id}
                        onClick={() => setPendingTraitId(t.id)}
                        className="w-full text-left px-3 py-1.5 text-xs hover:bg-accent/50"
                      >
                        <span className="font-semibold">{t.abbreviation}</span> — {t.name}
                        {t.condition_type && <span className="text-muted-foreground ml-1">({t.condition_type})</span>}
                      </button>
                    ))}
                  </div>
                )}
                {pendingTraitId && (() => {
                  const pendingTrait = allTraits.find(t => t.id === pendingTraitId);
                  const needsStat = pendingTrait && pendingTrait.condition_type !== "passive";
                  return (
                    <div className="flex flex-col gap-1 mt-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">Tier:</span>
                        {BADGE_TIERS.map(t => (
                          <button
                            key={t}
                            onClick={() => {
                              if (!needsStat) {
                                addTrait(pendingTraitId, t, null);
                              } else {
                                setPendingTraitTier(t);
                              }
                            }}
                            className={cn(
                              "px-2 py-0.5 rounded border text-xs capitalize hover:bg-accent/50 border-border",
                              pendingTraitTier === t && needsStat ? "border-primary bg-primary/15" : ""
                            )}
                          >
                            {t}
                          </button>
                        ))}
                        <button onClick={() => { setPendingTraitId(null); setPendingTraitTier("base"); }} className="text-xs text-muted-foreground hover:text-destructive ml-1">Cancel</button>
                      </div>
                      {needsStat && (
                        <div className="flex items-center gap-1 flex-wrap">
                          <span className="text-xs text-muted-foreground">Target stat:</span>
                          {STAT_KEYS.map(s => (
                            <button
                              key={s}
                              onClick={() => addTrait(pendingTraitId, pendingTraitTier, s)}
                              className="px-1.5 py-0.5 rounded border text-xs font-mono hover:bg-accent/50 border-border"
                            >
                              {STAT_LABELS[s]}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex justify-between pt-2">
          <Button variant="ghost" onClick={() => step > 0 ? setStep(s => s - 1) : onOpenChange(false)}>
            <ChevronLeft className="h-4 w-4 mr-1" /> {step > 0 ? "Back" : "Cancel"}
          </Button>
          <div className="flex gap-2">
            {step === 3 && (
              <>
                <Button variant="outline" onClick={handleReroll} className="gap-1">
                  <RefreshCw className="h-3 w-3" /> Re-roll
                </Button>
                <Button onClick={handleAccept} className="gap-1">
                  <Check className="h-3 w-3" /> Accept
                </Button>
              </>
            )}
            {step < 3 && (
              <Button onClick={handleNext} disabled={!canNext()} className="gap-1">
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
