import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { Wand2, ChevronRight, ChevronLeft, RefreshCw, Check, Sparkles, Search, User } from "lucide-react";
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

type GemTier = Tables<"gem_tiers">;
type PlayerCard = Tables<"player_cards">;
type BadgeRow = Tables<"badges">;

interface WizardResult {
  stats: Record<string, number>;
  badges: { badge_id: string; tier: string }[];
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
  /** If editing, pre-fill name & gem tier */
  editingPlayer?: PlayerCard | null;
}

export function PlayerWizard({ open, onOpenChange, onAccept, gemTiers, players, allBadges, editingPlayer }: PlayerWizardProps) {
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
    if (editingPlayer) {
      setName(editingPlayer.name);
      setGemTierId(editingPlayer.gem_tier_id ?? "");
    } else {
      setName("");
      setGemTierId("");
    }
  }

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

  // When inspiration is selected, pre-fill archetype + modifiers
  function selectInspiration(item: typeof inspireResults[0]) {
    if (item.type === "legend") {
      setInspireSource({ type: "legend", profile: item.profile });
      // Pre-seed archetype & modifiers from legend
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

    // Map badge abbreviations to IDs
    const mappedBadges = gen.badges
      .map(rb => {
        const badge = allBadges.find(b => b.abbreviation.toLowerCase() === rb.abbreviation.toLowerCase());
        return badge ? { badge_id: badge.id, tier: rb.tier } : null;
      })
      .filter(Boolean) as { badge_id: string; tier: string }[];

    return { stats: gen.stats, badges: mappedBadges, positions: gen.positions, summary: gen.summary };
  }

  function handleNext() {
    if (step === 2) {
      // Generate on entering Review
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

  const canNext = () => {
    if (step === 0) return !!gemTierId;
    if (step === 1) return !!selectedArchetype;
    return true;
  };

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

        {/* Step 3: Review */}
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

            {/* Stat bars */}
            <div className="grid grid-cols-3 gap-3">
              {STAT_KEYS.map(k => {
                const val = result.stats[k] ?? 0;
                return (
                  <div key={k} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground uppercase">{STAT_LABELS[k]}</span>
                      <span className="font-mono font-semibold">{val}</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-500"
                        style={{ width: `${val}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="text-center text-2xl font-mono font-bold">
              OVR {Math.round(STAT_KEYS.reduce((s, k) => s + (result.stats[k] ?? 0), 0) / STAT_KEYS.length)}
            </div>

            {/* Badges */}
            <div className="space-y-2">
              <Label className="text-xs">Badges ({result.badges.length})</Label>
              <div className="flex flex-wrap gap-1.5">
                {result.badges.map((b, i) => {
                  const badge = allBadges.find(ab => ab.id === b.badge_id);
                  return (
                    <Badge key={i} variant="outline" className="text-xs capitalize">
                      {badge?.abbreviation ?? "?"} · {b.tier}
                    </Badge>
                  );
                })}
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
