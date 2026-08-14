import { useEffect, useMemo, useState } from "react";
import { Star, Plus, Trash2, Copy, Check, ShieldCheck, ShieldAlert, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { insider, type InsiderCard, type InsiderLineup, type InsiderLegality } from "@/lib/insider";

const MODES = [
  { key: "5v5", label: "5v5", slots: 5 },
  { key: "runs", label: "The Runs", slots: 3 },
];

export default function Lineups() {
  const { toast } = useToast();
  const [mode, setMode] = useState("5v5");
  const [lineups, setLineups] = useState<InsiderLineup[]>([]);
  const [cards, setCards] = useState<InsiderCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<InsiderLineup | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftSlots, setDraftSlots] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [legality, setLegality] = useState<Record<string, InsiderLegality>>({});

  const slotsRequired = MODES.find((m) => m.key === mode)?.slots ?? 5;

  async function refresh() {
    setLoading(true);
    try {
      const [l, c] = await Promise.all([insider.lineups(), insider.collection({ limit: 200 })]);
      setLineups(l.lineups);
      setCards(c.cards);
    } catch (e) {
      toast({ title: "Could not load lineups", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const modeLineups = useMemo(() => lineups.filter((l) => l.mode === mode), [lineups, mode]);

  const cardById = useMemo(() => new Map(cards.map((c) => [c.owned_card_id, c])), [cards]);

  const filteredCards = useMemo(() => {
    const q = search.trim().toLowerCase();
    return cards.filter((c) => !q || c.name.toLowerCase().includes(q) || (c.gem_tier ?? "").toLowerCase().includes(q));
  }, [cards, search]);

  function openNew() {
    setEditing({
      lineup_id: "",
      name: `New ${mode === "runs" ? "Runs" : "5v5"} Lineup`,
      mode,
      is_default: false,
      notes: null,
      slot_count: 0,
      slots_required: slotsRequired,
      slots: [],
    });
    setDraftName(`New ${mode === "runs" ? "Runs" : "5v5"} Lineup`);
    setDraftSlots([]);
    setSearch("");
  }

  function openEdit(l: InsiderLineup) {
    setEditing(l);
    setDraftName(l.name);
    setDraftSlots(l.slots.map((s) => s.owned_card_id ?? "").filter(Boolean));
    setSearch("");
  }

  function toggleCard(ownedId: string) {
    setDraftSlots((prev) => {
      if (prev.includes(ownedId)) return prev.filter((id) => id !== ownedId);
      const required = editing?.mode === "runs" ? 3 : 5;
      if (prev.length >= required) return prev;
      return [...prev, ownedId];
    });
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

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="font-heading text-3xl uppercase tracking-wide">Saved Lineups</h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Build and store lineups here or let the GTeam Insider assistant create them for you — both write to the same saved
          lineups, so anything the Insider builds shows up on this page instantly.
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
                          {" "}
                          · {leg.legal ? "legal" : "not legal"}
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
                        {s.name ?? "Unknown card"}
                      </span>
                      <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                        {s.gem_tier ?? "—"} ·{" "}
                        {l.mode === "runs" ? `${s.run_rating ?? "—"} RUN` : `${s.rating ?? "—"} OVR`}
                      </span>
                    </button>
                  ))}
                  <Button variant="outline" size="sm" className="w-full" onClick={() => openEdit(l)}>
                    Edit cards
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing?.lineup_id ? "Edit lineup" : "New lineup"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Input value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="Lineup name" />
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: editing?.mode === "runs" ? 3 : 5 }).map((_, i) => {
                const id = draftSlots[i];
                const card = id ? cardById.get(id) : undefined;
                return (
                  <Badge
                    key={i}
                    variant={card ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => id && toggleCard(id)}
                  >
                    {card ? card.name : `Slot ${i + 1}`}
                  </Badge>
                );
              })}
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search your collection"
                className="pl-9"
              />
            </div>
            <ScrollArea className="h-72 rounded-md border border-border/50">
              <div className="divide-y divide-border/40">
                {filteredCards.map((c) => {
                  const selected = draftSlots.includes(c.owned_card_id);
                  return (
                    <button
                      key={c.owned_card_id}
                      onClick={() => toggleCard(c.owned_card_id)}
                      className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-muted/40 ${
                        selected ? "bg-primary/10" : ""
                      }`}
                    >
                      <span className="flex items-center gap-2 truncate">
                        {selected && <Check className="h-4 w-4 text-primary" />}
                        <span className="truncate">{c.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {c.position1}
                          {c.position2 ? `/${c.position2}` : ""}
                        </span>
                      </span>
                      <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                        {c.gem_tier ?? "—"} ·{" "}
                        {editing?.mode === "runs" ? `${c.run_rating ?? "—"} RUN` : `${c.rating ?? "—"} OVR`}
                      </span>
                    </button>
                  );
                })}
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
