import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Star, Plus, Trash2, Copy, Check, ShieldCheck, ShieldAlert, Loader2, Search, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { insider, type InsiderCard, type InsiderLineup, type InsiderLegality } from "@/lib/insider";

const MODES = [
  { key: "5v5", label: "5v5", slots: 5 },
  { key: "runs", label: "The Runs", slots: 3 },
];

const NONE = "__none";

interface Filters {
  name: string;
  position: string;
  gem_tier: string;
  badge: string;
  trait: string;
  collection: string;
  min_rating: string;
  max_rating: string;
  min_run_rating: string;
  evo_active: boolean;
  evo_completed: boolean;
  favorite: boolean;
  challenge_id: string;
}

const EMPTY_FILTERS: Filters = {
  name: "",
  position: NONE,
  gem_tier: NONE,
  badge: NONE,
  trait: NONE,
  collection: NONE,
  min_rating: "",
  max_rating: "",
  min_run_rating: "",
  evo_active: false,
  evo_completed: false,
  favorite: false,
  challenge_id: NONE,
};

export default function Lineups() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [mode, setMode] = useState("5v5");
  const [lineups, setLineups] = useState<InsiderLineup[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<InsiderLineup | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftSlots, setDraftSlots] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [legality, setLegality] = useState<Record<string, InsiderLegality>>({});

  // Card pool + filters
  const [pool, setPool] = useState<InsiderCard[]>([]);
  const [poolTotal, setPoolTotal] = useState(0);
  const [poolLoading, setPoolLoading] = useState(false);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [refs, setRefs] = useState<Awaited<ReturnType<typeof insider.references>> | null>(null);
  const [challenges, setChallenges] = useState<Array<{ challenge_id: string; name: string; completed: boolean }>>([]);
  const [selectedCards, setSelectedCards] = useState<Record<string, InsiderCard>>({});

  const slotsRequired = MODES.find((m) => m.key === mode)?.slots ?? 5;
  const editingSlots = editing?.mode === "runs" ? 3 : 5;

  async function refresh() {
    setLoading(true);
    try {
      const l = await insider.lineups();
      setLineups(l.lineups);
    } catch (e) {
      toast({ title: "Could not load lineups", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    insider
      .references()
      .then(setRefs)
      .catch(() => undefined);
    insider
      .challenges()
      .then((r) => setChallenges(r.challenges as never))
      .catch(() => undefined);
  }, []);

  // Load the card pool whenever the builder is open and filters change.
  useEffect(() => {
    if (!editing) return;
    let cancelled = false;
    setPoolLoading(true);
    (async () => {
      try {
        if (filters.challenge_id !== NONE) {
          const res = await insider.eligibleCards({ challenge_id: filters.challenge_id });
          if (cancelled) return;
          setPool(res.eligible);
          setPoolTotal(res.eligible_count);
          return;
        }
        const res = await insider.collection({
          limit: 200,
          name: filters.name || undefined,
          position: filters.position !== NONE ? filters.position : undefined,
          gem_tier: filters.gem_tier !== NONE ? filters.gem_tier : undefined,
          badge: filters.badge !== NONE ? filters.badge : undefined,
          trait: filters.trait !== NONE ? filters.trait : undefined,
          collection: filters.collection !== NONE ? filters.collection : undefined,
          min_rating: filters.min_rating || undefined,
          max_rating: filters.max_rating || undefined,
          min_run_rating: filters.min_run_rating || undefined,
          evo_active: filters.evo_active || undefined,
          evo_completed: filters.evo_completed || undefined,
          favorite: filters.favorite || undefined,
        });
        if (cancelled) return;
        setPool(res.cards);
        setPoolTotal(res.total);
      } catch (e) {
        if (!cancelled) toast({ title: "Could not load cards", description: (e as Error).message, variant: "destructive" });
      } finally {
        if (!cancelled) setPoolLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.lineup_id, editing?.mode, JSON.stringify(filters)]);

  const modeLineups = useMemo(() => lineups.filter((l) => l.mode === mode), [lineups, mode]);

  function openNew() {
    const label = mode === "runs" ? "Runs" : "5v5";
    setEditing({
      lineup_id: "",
      name: `New ${label} Lineup`,
      mode,
      is_default: false,
      notes: null,
      slot_count: 0,
      slots_required: slotsRequired,
      slots: [],
    });
    setDraftName(`New ${label} Lineup`);
    setDraftSlots([]);
    setSelectedCards({});
    setFilters(EMPTY_FILTERS);
  }

  async function openEdit(l: InsiderLineup) {
    setEditing(l);
    setDraftName(l.name);
    setFilters(EMPTY_FILTERS);
    const ids = l.slots.map((s) => s.owned_card_id ?? "").filter(Boolean);
    setDraftSlots(ids);
    // Keep the selected cards resolvable even when filters hide them.
    try {
      const res = await insider.collection({ limit: 200 });
      const map: Record<string, InsiderCard> = {};
      for (const c of res.cards) if (ids.includes(c.owned_card_id)) map[c.owned_card_id] = c;
      setSelectedCards(map);
    } catch {
      setSelectedCards({});
    }
  }

  function toggleCard(card: InsiderCard) {
    const id = card.owned_card_id;
    setDraftSlots((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= editingSlots) {
        toast({ title: "Lineup full", description: `This mode uses ${editingSlots} cards.` });
        return prev;
      }
      return [...prev, id];
    });
    setSelectedCards((prev) => ({ ...prev, [id]: card }));
  }

  async function save() {
    if (!editing) return;
    setSaving(true);
    try {
      const slots = draftSlots.map((owned_card_id, i) => ({ slot: i + 1, owned_card_id }));
      const res = editing.lineup_id
        ? await insider.updateLineup({ lineup_id: editing.lineup_id, name: draftName, slots })
        : await insider.createLineup({ name: draftName, mode: editing.mode, slots });
      setLegality((prev) => ({ ...prev, [res.lineup.lineup_id]: res.legality }));
      toast({
        title: editing.lineup_id ? "Lineup updated" : "Lineup created",
        description: res.legality?.legal ? "This lineup is legal." : "Saved, but not currently legal.",
      });
      setEditing(null);
      await refresh();
    } catch (e) {
      toast({ title: "Save failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function act(fn: () => Promise<unknown>, message: string) {
    try {
      await fn();
      toast({ title: message });
      await refresh();
    } catch (e) {
      toast({ title: "Action failed", description: (e as Error).message, variant: "destructive" });
    }
  }

  async function check(l: InsiderLineup) {
    try {
      const res = await insider.validateLineup({ lineup_id: l.lineup_id });
      setLegality((prev) => ({ ...prev, [l.lineup_id]: res }));
      toast({
        title: res.legal ? "Lineup is legal" : "Lineup is not legal",
        description: res.legal ? `${res.cards_provided}/${res.slots_required} cards ready.` : res.reasons[0]?.message,
        variant: res.legal ? undefined : "destructive",
      });
    } catch (e) {
      toast({ title: "Validation failed", description: (e as Error).message, variant: "destructive" });
    }
  }

  function playLineup(l: InsiderLineup) {
    if (l.slot_count < l.slots_required) {
      toast({ title: "Lineup incomplete", description: `Add ${l.slots_required - l.slot_count} more card(s) first.`, variant: "destructive" });
      return;
    }
    if (l.mode === "runs") {
      navigate("/runs", { state: { savedLineupId: l.lineup_id } });
    } else {
      navigate("/play/match", { state: { savedLineupId: l.lineup_id } });
    }
  }

  const activeFilterCount = useMemo(
    () =>
      Object.entries(filters).filter(([k, v]) => {
        const empty = EMPTY_FILTERS[k as keyof Filters];
        return v !== empty;
      }).length,
    [filters],
  );

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="font-heading text-3xl uppercase tracking-wide">Saved Lineups</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Build lineups here or let the GTeam Insider assistant build them — both write to the same records. Load any saved
          lineup straight into a game, or filter your collection down to exactly what a challenge allows.
        </p>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={mode} onValueChange={setMode}>
          <TabsList>
            {MODES.map((m) => (
              <TabsTrigger key={m.key} value={m.key}>
                {m.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Button onClick={openNew} className="gap-2">
          <Plus className="h-4 w-4" /> New lineup
        </Button>
      </div>

      {loading ? (
        <div className="flex min-h-[30vh] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : modeLineups.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No {mode === "runs" ? "Runs" : "5v5"} lineups saved yet.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {modeLineups.map((l) => {
            const leg = legality[l.lineup_id];
            return (
              <Card key={l.lineup_id} className="border-border/60">
                <CardHeader className="flex flex-row items-start justify-between gap-3 pb-3">
                  <div className="space-y-1">
                    <CardTitle className="flex items-center gap-2 text-lg">
                      {l.name}
                      {l.is_default && (
                        <Badge variant="secondary" className="gap-1">
                          <Star className="h-3 w-3" /> Default
                        </Badge>
                      )}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                      {l.slot_count}/{l.slots_required} cards
                      {leg && (
                        <span className={leg.legal ? " text-primary" : " text-destructive"}>
                          {" "}· {leg.legal ? "legal" : "not legal"}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" title="Validate" onClick={() => check(l)}>
                      {leg ? (
                        leg.legal ? (
                          <ShieldCheck className="h-4 w-4 text-primary" />
                        ) : (
                          <ShieldAlert className="h-4 w-4 text-destructive" />
                        )
                      ) : (
                        <ShieldCheck className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      title="Set default"
                      onClick={() => act(() => insider.setDefaultLineup(l.lineup_id), "Default lineup set")}
                    >
                      <Star className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      title="Duplicate"
                      onClick={() => act(() => insider.duplicateLineup(l.lineup_id), "Lineup duplicated")}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      title="Delete"
                      onClick={() => act(() => insider.deleteLineup(l.lineup_id), "Lineup deleted")}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {l.slots.map((s) => (
                    <button
                      key={`${l.lineup_id}-${s.slot}`}
                      onClick={() => openEdit(l)}
                      className="flex w-full items-center justify-between rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-left text-sm transition-colors hover:border-primary/50"
                    >
                      <span className="truncate">
                        <span className="mr-2 text-xs text-muted-foreground">{s.slot}</span>
                        {s.name ?? "No longer in your collection"}
                      </span>
                      <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                        {s.gem_tier ?? "—"} ·{" "}
                        {l.mode === "runs" ? `${s.run_rating ?? "—"} RUN` : `${s.rating ?? "—"} OVR`}
                      </span>
                    </button>
                  ))}
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => openEdit(l)}>
                      Edit cards
                    </Button>
                    <Button size="sm" className="flex-1 gap-2" onClick={() => playLineup(l)}>
                      <Play className="h-4 w-4" /> Play
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.lineup_id ? "Edit lineup" : "New lineup"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Input value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="Lineup name" />

            {/* Slots */}
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: editingSlots }).map((_, i) => {
                const id = draftSlots[i];
                const card = id ? selectedCards[id] : undefined;
                return (
                  <Badge
                    key={i}
                    variant={card ? "default" : "outline"}
                    className={card ? "cursor-pointer" : ""}
                    onClick={() => card && toggleCard(card)}
                  >
                    {card ? `${i + 1}. ${card.name}` : `Slot ${i + 1}`}
                  </Badge>
                );
              })}
            </div>

            {/* Filters */}
            <div className="space-y-3 rounded-lg border border-border/50 bg-muted/20 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Filters{activeFilterCount ? ` (${activeFilterCount})` : ""}
                </span>
                <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => setFilters(EMPTY_FILTERS)}>
                  <RotateCcw className="h-3 w-3" /> Reset
                </Button>
              </div>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={filters.name}
                  onChange={(e) => setFilters((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Search by player name"
                  className="pl-9"
                />
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                <Select
                  value={filters.challenge_id}
                  onValueChange={(v) => setFilters((f) => ({ ...f, challenge_id: v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Challenge legal" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Any challenge</SelectItem>
                    {challenges.map((c) => (
                      <SelectItem key={c.challenge_id} value={c.challenge_id}>
                        {c.name}
                        {c.completed ? " ✓" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={filters.position} onValueChange={(v) => setFilters((f) => ({ ...f, position: v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Position" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Any position</SelectItem>
                    {(refs?.positions ?? []).map((p) => (
                      <SelectItem key={p} value={p}>
                        {p}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={filters.gem_tier} onValueChange={(v) => setFilters((f) => ({ ...f, gem_tier: v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Gem tier" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Any tier</SelectItem>
                    {(refs?.gem_tiers ?? []).map((t) => (
                      <SelectItem key={t.gem_tier_id} value={t.name}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={filters.badge} onValueChange={(v) => setFilters((f) => ({ ...f, badge: v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Badge" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Any badge</SelectItem>
                    {(refs?.badges ?? []).map((b) => (
                      <SelectItem key={b.badge_id} value={b.name}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={filters.trait} onValueChange={(v) => setFilters((f) => ({ ...f, trait: v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Signature trait" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Any trait</SelectItem>
                    {(refs?.traits ?? []).map((t) => (
                      <SelectItem key={t.trait_id} value={t.name}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select value={filters.collection} onValueChange={(v) => setFilters((f) => ({ ...f, collection: v }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Collection" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>Any collection</SelectItem>
                    {(refs?.collections ?? []).map((c) => (
                      <SelectItem key={c.collection_id} value={c.name}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Min OVR</Label>
                  <Input
                    inputMode="decimal"
                    value={filters.min_rating}
                    onChange={(e) => setFilters((f) => ({ ...f, min_rating: e.target.value }))}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Max OVR</Label>
                  <Input
                    inputMode="decimal"
                    value={filters.max_rating}
                    onChange={(e) => setFilters((f) => ({ ...f, max_rating: e.target.value }))}
                    placeholder="6.99"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Min RUN</Label>
                  <Input
                    inputMode="numeric"
                    value={filters.min_run_rating}
                    onChange={(e) => setFilters((f) => ({ ...f, min_run_rating: e.target.value }))}
                    placeholder="0"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-xs">
                  <Switch
                    checked={filters.evo_active}
                    onCheckedChange={(v) => setFilters((f) => ({ ...f, evo_active: v }))}
                  />
                  Evolving now
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <Switch
                    checked={filters.evo_completed}
                    onCheckedChange={(v) => setFilters((f) => ({ ...f, evo_completed: v }))}
                  />
                  Fully evolved
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <Switch
                    checked={filters.favorite}
                    onCheckedChange={(v) => setFilters((f) => ({ ...f, favorite: v }))}
                  />
                  Favorites
                </label>
              </div>
            </div>

            {/* Pool */}
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {poolLoading ? "Loading cards…" : `${pool.length} of ${poolTotal} card${poolTotal === 1 ? "" : "s"}`}
              </span>
              <span>
                {draftSlots.length}/{editingSlots} selected
              </span>
            </div>
            <ScrollArea className="h-72 rounded-md border border-border/50">
              <div className="divide-y divide-border/40">
                {pool.map((c) => {
                  const selected = draftSlots.includes(c.owned_card_id);
                  return (
                    <button
                      key={c.owned_card_id}
                      onClick={() => toggleCard(c)}
                      className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-muted/40 ${
                        selected ? "bg-primary/10" : ""
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        {selected && <Check className="h-4 w-4 shrink-0 text-primary" />}
                        <span className="truncate">{c.name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {c.position1}
                          {c.position2 ? `/${c.position2}` : ""}
                        </span>
                        {c.badges?.slice(0, 2).map((b) => (
                          <Badge key={b.abbreviation} variant="outline" className="hidden shrink-0 text-[10px] sm:inline-flex">
                            {b.abbreviation}
                          </Badge>
                        ))}
                      </span>
                      <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                        {c.gem_tier ?? "—"} ·{" "}
                        {editing?.mode === "runs" ? `${c.run_rating ?? "—"} RUN` : `${c.rating ?? "—"} OVR`}
                      </span>
                    </button>
                  );
                })}
                {!poolLoading && pool.length === 0 && (
                  <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                    No cards match these filters.
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || !draftName.trim()}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save lineup
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
