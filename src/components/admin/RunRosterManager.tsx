import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Search, Users, Loader2, Upload, Check, X, Wand2, Plus, Pencil, ChevronDown, Trash2 } from "lucide-react";
import { PlayerQuickEdit } from "@/components/admin/PlayerQuickEdit";
import { toast } from "sonner";
import { RUN_TEMPLATES, generateRandomName, type TemplateSlot } from "@/lib/teamTemplates";
import { generateFromProfile, ARCHETYPE_LIST, type WizardProfile } from "@/lib/archetypeEngine";

interface Props {
  runId: string;
}

const STAT_KEYS = ["stat_3pt", "stat_mid", "stat_fin", "stat_dnk", "stat_stl", "stat_blk", "stat_ast", "stat_reb", "stat_int"] as const;
const RUN_STAT_KEYS = ["run_stat_3pt", "run_stat_mid", "run_stat_fin", "run_stat_dnk", "run_stat_stl", "run_stat_blk", "run_stat_ast", "run_stat_reb", "run_stat_int"] as const;
const STAT_LABELS: Record<string, string> = {
  stat_3pt: "3PT", stat_mid: "MID", stat_fin: "FIN", stat_dnk: "DNK",
  stat_stl: "STL", stat_blk: "BLK", stat_ast: "AST", stat_reb: "REB", stat_int: "INT",
};

function randomizeFromStar(stars: number, statKey?: string): number {
  const base = stars * 20;
  if (base === 0) {
    // STL and BLK should never be 0 — floor at 10-19
    if (statKey === "stat_stl" || statKey === "stat_blk" || statKey === "run_stat_stl" || statKey === "run_stat_blk") {
      return 10 + Math.floor(Math.random() * 10);
    }
    return 0;
  }
  const variance = Math.floor(Math.random() * 31) - 15;
  return Math.max(0, Math.min(120, base + variance));
}

interface PendingPlayer {
  id: string;
  name: string;
  rating: number;
  position1: string | null;
  position2: string | null;
  gem_name: string | null;
  badges: { name: string; tier: string }[];
  run_rating: number;
  run_stat_3pt: number;
  run_stat_mid: number;
  run_stat_fin: number;
  run_stat_dnk: number;
  run_stat_stl: number;
  run_stat_blk: number;
  run_stat_ast: number;
  run_stat_reb: number;
  run_stat_int: number;
}

export function RunRosterManager({ runId }: Props) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [importTeamId, setImportTeamId] = useState<string>("");
  const [pendingPlayers, setPendingPlayers] = useState<PendingPlayer[]>([]);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [displayLimit, setDisplayLimit] = useState(50);
  const [addPlayersOpen, setAddPlayersOpen] = useState(false);

  // Quick add state
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddArchetype, setQuickAddArchetype] = useState("");
  const [quickAddStars, setQuickAddStars] = useState(3);
  const [quickEditPlayerId, setQuickEditPlayerId] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setDisplayLimit(50);
  }, [debouncedSearch]);

  // Current roster
  const { data: rosterEntries = [], isLoading: rosterLoading } = useQuery({
    queryKey: ["run-roster", runId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("run_players")
        .select("id, player_card_id, run_rating, run_stat_3pt, run_stat_mid, run_stat_fin, run_stat_dnk, run_stat_stl, run_stat_blk, run_stat_ast, run_stat_reb, run_stat_int")
        .eq("run_id", runId);
      if (error) throw error;
      return data;
    },
  });

  const rosterCardIds = useMemo(() => new Set(rosterEntries.map((r) => r.player_card_id)), [rosterEntries]);

  const { data: allPlayers = [], isLoading: playersLoading } = useQuery({
    queryKey: ["admin-all-players-lite"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("player_cards")
        .select("id, name, rating, position1, position2, team_id, gem_name, stat_3pt, stat_mid, stat_fin, stat_dnk, stat_stl, stat_blk, stat_ast, stat_reb, stat_int, run_rating, run_stat_3pt, run_stat_mid, run_stat_fin, run_stat_dnk, run_stat_stl, run_stat_blk, run_stat_ast, run_stat_reb, run_stat_int")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: allBadgesData = [] } = useQuery({
    queryKey: ["admin-all-player-badges"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("player_card_badges")
        .select("player_card_id, tier, badges(name)");
      if (error) throw error;
      return data;
    },
  });

  const { data: badgesForGen = [] } = useQuery({
    queryKey: ["admin-badges-for-gen"],
    queryFn: async () => {
      const { data, error } = await supabase.from("badges").select("id, abbreviation, affected_stat, effect_type");
      if (error) throw error;
      return data;
    },
  });

  const { data: gemTiers = [] } = useQuery({
    queryKey: ["admin-gem-tiers-for-gen"],
    queryFn: async () => {
      const { data, error } = await supabase.from("gem_tiers").select("id, stars, name").order("stars");
      if (error) throw error;
      return data;
    },
  });

  const badgesByPlayer = useMemo(() => {
    const map = new Map<string, { name: string; tier: string }[]>();
    for (const b of allBadgesData) {
      const list = map.get(b.player_card_id) || [];
      list.push({ name: (b as any).badges?.name ?? "?", tier: b.tier });
      map.set(b.player_card_id, list);
    }
    return map;
  }, [allBadgesData]);

  const { data: teams = [] } = useQuery({
    queryKey: ["admin-teams"],
    queryFn: async () => {
      const { data, error } = await supabase.from("teams").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
  });

  const teamPlayersForImport = useMemo(() => {
    if (!importTeamId) return [];
    return allPlayers.filter((p) => p.team_id === importTeamId);
  }, [importTeamId, allPlayers]);

  function toPending(p: typeof allPlayers[0]): PendingPlayer {
    const hasRunRatings = p.run_rating != null;
    return {
      id: p.id,
      name: p.name,
      rating: p.rating,
      position1: p.position1,
      position2: p.position2,
      gem_name: p.gem_name,
      badges: badgesByPlayer.get(p.id) || [],
      run_rating: hasRunRatings ? p.run_rating! : randomizeFromStar(p.rating),
      run_stat_3pt: hasRunRatings ? p.run_stat_3pt! : randomizeFromStar(p.stat_3pt, "stat_3pt"),
      run_stat_mid: hasRunRatings ? p.run_stat_mid! : randomizeFromStar(p.stat_mid, "stat_mid"),
      run_stat_fin: hasRunRatings ? p.run_stat_fin! : randomizeFromStar(p.stat_fin, "stat_fin"),
      run_stat_dnk: hasRunRatings ? p.run_stat_dnk! : randomizeFromStar(p.stat_dnk, "stat_dnk"),
      run_stat_stl: hasRunRatings ? p.run_stat_stl! : randomizeFromStar(p.stat_stl, "stat_stl"),
      run_stat_blk: hasRunRatings ? p.run_stat_blk! : randomizeFromStar(p.stat_blk, "stat_blk"),
      run_stat_ast: hasRunRatings ? p.run_stat_ast! : randomizeFromStar(p.stat_ast, "stat_ast"),
      run_stat_reb: hasRunRatings ? p.run_stat_reb! : randomizeFromStar(p.stat_reb, "stat_reb"),
      run_stat_int: hasRunRatings ? p.run_stat_int! : randomizeFromStar(p.stat_int, "stat_int"),
    };
  }

  function addToPending(playerIds: string[]) {
    const existingPendingIds = new Set(pendingPlayers.map((p) => p.id));
    const newPlayers = playerIds
      .filter((id) => !rosterCardIds.has(id) && !existingPendingIds.has(id))
      .map((id) => allPlayers.find((p) => p.id === id))
      .filter(Boolean)
      .map((p) => toPending(p!));

    if (newPlayers.length === 0) {
      toast.info("All selected players are already in the roster or pending.");
      return;
    }
    setPendingPlayers((prev) => [...prev, ...newPlayers]);
    toast.success(`${newPlayers.length} player(s) added to review.`);
  }

  function updatePendingStat(playerId: string, key: string, value: number) {
    setPendingPlayers((prev) =>
      prev.map((p) => (p.id === playerId ? { ...p, [key]: Math.max(0, Math.min(200, value)) } : p))
    );
  }

  function updatePendingStarRating(playerId: string, newStars: number) {
    setPendingPlayers((prev) =>
      prev.map((p) => {
        if (p.id !== playerId) return p;
        return {
          ...p,
          rating: newStars,
          run_rating: randomizeFromStar(newStars),
          run_stat_3pt: randomizeFromStar(newStars, "stat_3pt"),
          run_stat_mid: randomizeFromStar(newStars, "stat_mid"),
          run_stat_fin: randomizeFromStar(newStars, "stat_fin"),
          run_stat_dnk: randomizeFromStar(newStars, "stat_dnk"),
          run_stat_stl: randomizeFromStar(newStars, "stat_stl"),
          run_stat_blk: randomizeFromStar(newStars, "stat_blk"),
          run_stat_ast: randomizeFromStar(newStars, "stat_ast"),
          run_stat_reb: randomizeFromStar(newStars, "stat_reb"),
          run_stat_int: randomizeFromStar(newStars, "stat_int"),
        };
      })
    );
  }

  const confirmPending = useMutation({
    mutationFn: async () => {
      const rows = pendingPlayers.map((p) => ({
        run_id: runId,
        player_card_id: p.id,
        run_rating: Math.round(p.run_rating),
        run_stat_3pt: Math.round(p.run_stat_3pt),
        run_stat_mid: Math.round(p.run_stat_mid),
        run_stat_fin: Math.round(p.run_stat_fin),
        run_stat_dnk: Math.round(p.run_stat_dnk),
        run_stat_stl: Math.round(p.run_stat_stl),
        run_stat_blk: Math.round(p.run_stat_blk),
        run_stat_ast: Math.round(p.run_stat_ast),
        run_stat_reb: Math.round(p.run_stat_reb),
        run_stat_int: Math.round(p.run_stat_int),
      }));
      const { error } = await supabase.from("run_players").insert(rows);
      if (error) throw error;

      for (const p of pendingPlayers) {
        const { error: updateErr } = await supabase.from("player_cards").update({
          run_rating: Math.round(p.run_rating),
          run_stat_3pt: Math.round(p.run_stat_3pt),
          run_stat_mid: Math.round(p.run_stat_mid),
          run_stat_fin: Math.round(p.run_stat_fin),
          run_stat_dnk: Math.round(p.run_stat_dnk),
          run_stat_stl: Math.round(p.run_stat_stl),
          run_stat_blk: Math.round(p.run_stat_blk),
          run_stat_ast: Math.round(p.run_stat_ast),
          run_stat_reb: Math.round(p.run_stat_reb),
          run_stat_int: Math.round(p.run_stat_int),
        }).eq("id", p.id);
        if (updateErr) console.error("Failed to save run ratings for", p.name, updateErr);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["run-roster", runId] });
      qc.invalidateQueries({ queryKey: ["admin-all-players-lite"] });
      toast.success(`${pendingPlayers.length} player(s) confirmed.`);
      setPendingPlayers([]);
    },
    onError: (e) => toast.error(e.message),
  });

  const removeFromRoster = useMutation({
    mutationFn: async (cardId: string) => {
      const { error } = await supabase.from("run_players").delete().eq("run_id", runId).eq("player_card_id", cardId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["run-roster", runId] }),
    onError: (e) => toast.error(e.message),
  });

  const clearRoster = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("run_players").delete().eq("run_id", runId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["run-roster", runId] });
      toast.success("Roster cleared.");
    },
    onError: (e) => toast.error(e.message),
  });

  // Autofill from template
  const autofillRoster = useMutation({
    mutationFn: async (templateName: string) => {
      const template = RUN_TEMPLATES.find(t => t.name === templateName);
      if (!template) throw new Error("Template not found");

      // Only fill remaining slots
      const existingCount = rosterCardIds.size;
      const remainingSlots = template.slots.slice(existingCount);

      if (remainingSlots.length === 0) {
        toast.info("Roster is already full for this template.");
        return [];
      }

      const cards = [];
      for (const slot of remainingSlots) {
        const stars = slot.starRange[0] + Math.floor(Math.random() * (slot.starRange[1] - slot.starRange[0] + 1));
        const tier = gemTiers.find(g => g.stars === stars) ?? gemTiers[0];

        const profile: WizardProfile = {
          archetype: slot.archetype.toLowerCase(),
          modifiers: slot.modifiers ?? [],
          strengthStats: [],
          weakStats: [],
          secondaryArchetype: slot.secondaryArchetype,
          blendRatio: slot.blendRatio,
        };

        const gen = generateFromProfile(profile, stars, badgesForGen, stars);
        const name = generateRandomName();

        const { data: card, error } = await supabase.from("player_cards").insert({
          name,
          rating: stars,
          gem_tier_id: tier?.id ?? null,
          position1: gen.positions[0],
          position2: gen.positions[1],
          ...gen.stats,
        }).select("id, name, rating, stat_3pt, stat_mid, stat_fin, stat_dnk, stat_stl, stat_blk, stat_ast, stat_reb, stat_int").single();
        if (error) throw error;

        if (gen.badges.length > 0) {
          const badgeRows = gen.badges
            .map(rb => {
              const badge = badgesForGen.find(b => b.abbreviation.toLowerCase() === rb.abbreviation.toLowerCase());
              return badge ? { player_card_id: card.id, badge_id: badge.id, tier: rb.tier } : null;
            })
            .filter(Boolean);
          if (badgeRows.length > 0) {
            await supabase.from("player_card_badges").insert(badgeRows);
          }
        }

        await supabase.from("run_players").insert({
          run_id: runId,
          player_card_id: card.id,
          run_rating: randomizeFromStar(stars),
          run_stat_3pt: randomizeFromStar(card.stat_3pt, "stat_3pt"),
          run_stat_mid: randomizeFromStar(card.stat_mid, "stat_mid"),
          run_stat_fin: randomizeFromStar(card.stat_fin, "stat_fin"),
          run_stat_dnk: randomizeFromStar(card.stat_dnk, "stat_dnk"),
          run_stat_stl: randomizeFromStar(card.stat_stl, "stat_stl"),
          run_stat_blk: randomizeFromStar(card.stat_blk, "stat_blk"),
          run_stat_ast: randomizeFromStar(card.stat_ast, "stat_ast"),
          run_stat_reb: randomizeFromStar(card.stat_reb, "stat_reb"),
          run_stat_int: randomizeFromStar(card.stat_int, "stat_int"),
        });

        cards.push(card);
      }

      return cards;
    },
    onSuccess: (cards) => {
      qc.invalidateQueries({ queryKey: ["run-roster", runId] });
      qc.invalidateQueries({ queryKey: ["admin-all-players-lite"] });
      if (cards.length > 0) toast.success(`${cards.length} players generated for run`);
    },
    onError: (e) => toast.error(e.message),
  });

  // Quick add single archetype
  const quickAddMutation = useMutation({
    mutationFn: async ({ archetype, stars }: { archetype: string; stars: number }) => {
      const tier = gemTiers.find(g => g.stars === stars) ?? gemTiers[0];
      const profile: WizardProfile = {
        archetype: archetype.toLowerCase(),
        modifiers: [],
        strengthStats: [],
        weakStats: [],
      };

      const gen = generateFromProfile(profile, stars, badgesForGen, stars);
      const name = generateRandomName();

      const { data: card, error } = await supabase.from("player_cards").insert({
        name,
        rating: stars,
        gem_tier_id: tier?.id ?? null,
        position1: gen.positions[0],
        position2: gen.positions[1],
        ...gen.stats,
      }).select("id, name, rating, stat_3pt, stat_mid, stat_fin, stat_dnk, stat_stl, stat_blk, stat_ast, stat_reb, stat_int").single();
      if (error) throw error;

      if (gen.badges.length > 0) {
        const badgeRows = gen.badges
          .map(rb => {
            const badge = badgesForGen.find(b => b.abbreviation.toLowerCase() === rb.abbreviation.toLowerCase());
            return badge ? { player_card_id: card.id, badge_id: badge.id, tier: rb.tier } : null;
          })
          .filter(Boolean);
        if (badgeRows.length > 0) {
          await supabase.from("player_card_badges").insert(badgeRows);
        }
      }

      await supabase.from("run_players").insert({
        run_id: runId,
        player_card_id: card.id,
        run_rating: randomizeFromStar(stars),
        run_stat_3pt: randomizeFromStar(card.stat_3pt, "stat_3pt"),
        run_stat_mid: randomizeFromStar(card.stat_mid, "stat_mid"),
        run_stat_fin: randomizeFromStar(card.stat_fin, "stat_fin"),
        run_stat_dnk: randomizeFromStar(card.stat_dnk, "stat_dnk"),
        run_stat_stl: randomizeFromStar(card.stat_stl, "stat_stl"),
        run_stat_blk: randomizeFromStar(card.stat_blk, "stat_blk"),
        run_stat_ast: randomizeFromStar(card.stat_ast, "stat_ast"),
        run_stat_reb: randomizeFromStar(card.stat_reb, "stat_reb"),
        run_stat_int: randomizeFromStar(card.stat_int, "stat_int"),
      });

      return card;
    },
    onSuccess: (card) => {
      qc.invalidateQueries({ queryKey: ["run-roster", runId] });
      qc.invalidateQueries({ queryKey: ["admin-all-players-lite"] });
      toast.success(`Added ${card.name} to run roster`);
      setQuickAddOpen(false);
    },
    onError: (e) => toast.error(e.message),
  });

  const pendingIds = useMemo(() => new Set(pendingPlayers.map((p) => p.id)), [pendingPlayers]);

  // Roster players with card details
  const rosterPlayers = useMemo(() => {
    return rosterEntries.map((entry) => {
      const card = allPlayers.find((p) => p.id === entry.player_card_id);
      return { ...entry, card };
    }).filter((r) => r.card);
  }, [rosterEntries, allPlayers]);

  // Available players = not in roster and not pending
  const availablePlayers = useMemo(() => {
    if (!debouncedSearch) return allPlayers.filter((p) => !rosterCardIds.has(p.id) && !pendingIds.has(p.id));
    const q = debouncedSearch.toLowerCase();
    return allPlayers.filter(
      (p) =>
        !rosterCardIds.has(p.id) &&
        !pendingIds.has(p.id) &&
        (p.name.toLowerCase().includes(q) ||
          (p.position1 ?? "").toLowerCase().includes(q) ||
          (p.gem_name ?? "").toLowerCase().includes(q))
    );
  }, [debouncedSearch, allPlayers, rosterCardIds, pendingIds]);

  const isLoading = rosterLoading || playersLoading;

  const tierColor: Record<string, string> = {
    base: "bg-muted text-muted-foreground",
    gold: "bg-gem-gold/20 text-gem-gold border-gem-gold/30",
    hof: "bg-gem-hof/20 text-gem-hof border-gem-hof/30",
    diamond: "bg-gem-diamond/20 text-gem-diamond border-gem-diamond/30",
    actolytrene: "bg-gem-actolytrene/20 text-gem-actolytrene border-gem-actolytrene/30",
  };

  return (
    <div className="space-y-4">
      {/* ── SECTION 1: Current Roster ── */}
      <div className="border rounded-lg bg-muted/20 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-foreground flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            Current Roster
            <Badge variant="secondary" className="text-xs ml-1">{rosterCardIds.size}</Badge>
          </h3>
          {rosterCardIds.size > 0 && (
            <Button variant="ghost" size="sm" className="text-destructive text-xs h-7" onClick={() => clearRoster.mutate()} disabled={clearRoster.isPending}>
              <Trash2 className="h-3 w-3 mr-1" /> Clear All
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
          </div>
        ) : rosterPlayers.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No players in roster yet. Use the tools below to add players.
          </div>
        ) : (
          <ScrollArea className="max-h-[50vh]">
            <div className="divide-y divide-border/30">
              {rosterPlayers.map(({ id, player_card_id, run_rating, card }) => (
                <div
                  key={id}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors group"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <button
                        className="font-medium text-sm truncate hover:underline hover:text-primary transition-colors text-left"
                        onClick={() => setQuickEditPlayerId(player_card_id)}
                        title="Click to edit player"
                      >
                        {card!.name}
                      </button>
                      <button
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => setQuickEditPlayerId(player_card_id)}
                        title="Edit player"
                      >
                        <Pencil className="h-3 w-3 text-muted-foreground hover:text-primary" />
                      </button>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">{card!.rating}★</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground flex gap-2 mt-0.5">
                      {card!.position1 && <span>{card!.position1}{card!.position2 ? ` / ${card!.position2}` : ""}</span>}
                      {card!.gem_name && <span>· {card!.gem_name}</span>}
                      <span className="text-muted-foreground/60">Run: {run_rating}</span>
                    </div>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive"
                    onClick={() => removeFromRoster.mutate(player_card_id)}
                    title="Remove from roster"
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>

      {/* ── Pending Review Section ── */}
      {pendingPlayers.length > 0 && (
        <div className="border-2 border-primary/50 rounded-lg bg-primary/5 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold uppercase tracking-wider text-primary flex items-center gap-2">
              <Check className="h-4 w-4" /> Review Converted Ratings ({pendingPlayers.length})
            </h4>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" className="text-destructive text-xs" onClick={async () => {
                // Delete orphan player_cards that were auto-generated
                const idsToDelete = pendingPlayers.map(p => p.id);
                setPendingPlayers([]);
                // Best-effort cleanup — delete cards that have no references elsewhere
                for (const id of idsToDelete) {
                  await supabase.from("player_cards").delete().eq("id", id).then(() => {});
                }
                qc.invalidateQueries({ queryKey: ["admin-all-players-lite"] });
              }}>
                <X className="h-3 w-3 mr-1" /> Discard All
              </Button>
              <Button size="sm" onClick={() => confirmPending.mutate()} disabled={confirmPending.isPending}>
                {confirmPending.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Check className="h-4 w-4 mr-1" />}
                Confirm All
              </Button>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Key: 1★=20 · 2★=40 · 3★=60 · 4★=80 · 5★=100 · 6★=120. Adjust values before confirming.
          </p>

          <ScrollArea className="max-h-[50vh]">
            <div className="space-y-1">
              <div className="grid grid-cols-[1fr_repeat(6,48px)_auto] gap-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground sticky top-0 bg-primary/5 z-10">
                <span>Player</span>
                <span className="text-center">3PT</span>
                <span className="text-center">MID</span>
                <span className="text-center">FIN</span>
                <span className="text-center">DNK</span>
                <span className="text-center">STL</span>
                <span className="text-center">BLK</span>
                <span className="text-center">×</span>
              </div>

              {pendingPlayers.map((p) => (
                <div key={p.id} className="space-y-1 px-2 py-2 border-b border-border/30">
                  <div className="grid grid-cols-[1fr_repeat(6,48px)_auto] gap-1 items-center">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <button
                          className="font-medium text-xs truncate hover:underline hover:text-primary transition-colors"
                          onClick={() => setQuickEditPlayerId(p.id)}
                          title="Click to edit player"
                        >
                          {p.name}
                        </button>
                        <Pencil className="h-3 w-3 text-muted-foreground hover:text-primary cursor-pointer shrink-0" onClick={() => setQuickEditPlayerId(p.id)} />
                      </div>
                      <div className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5 flex-wrap">
                        {p.position1 && <span>{p.position1}{p.position2 ? `/${p.position2}` : ""}</span>}
                        {p.badges.length > 0 && p.badges.map((b, i) => (
                          <Badge key={i} variant="outline" className={`text-[8px] px-1 py-0 ${tierColor[b.tier] || ""}`}>
                            {b.name}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    {(["run_stat_3pt", "run_stat_mid", "run_stat_fin", "run_stat_dnk", "run_stat_stl", "run_stat_blk"] as const).map((key) => (
                      <Input
                        key={key}
                        type="number"
                        min={0}
                        max={200}
                        value={(p as any)[key]}
                        onChange={(e) => updatePendingStat(p.id, key, Number(e.target.value) || 0)}
                        className="h-7 text-[11px] text-center font-mono px-1"
                      />
                    ))}
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={async () => {
                      const removedId = p.id;
                      setPendingPlayers((prev) => prev.filter((x) => x.id !== removedId));
                      // Delete orphan card
                      await supabase.from("player_cards").delete().eq("id", removedId);
                      qc.invalidateQueries({ queryKey: ["admin-all-players-lite"] });
                    }}>
                      <X className="h-3 w-3 text-destructive" />
                    </Button>
                  </div>
                  <div className="flex items-center gap-2 pl-1">
                    <span className="text-[10px] text-muted-foreground w-12 shrink-0">{p.rating}★ OVR</span>
                    <Slider min={0} max={6} step={1} value={[p.rating]} onValueChange={([v]) => updatePendingStarRating(p.id, v)} className="flex-1 max-w-[160px]" />
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      )}

      {/* ── SECTION 2: Add Players (Collapsible) ── */}
      <Collapsible open={addPlayersOpen} onOpenChange={setAddPlayersOpen}>
        <CollapsibleTrigger asChild>
          <button className="w-full flex items-center justify-between px-4 py-3 border rounded-lg bg-muted/20 hover:bg-muted/40 transition-colors">
            <span className="text-sm font-semibold uppercase tracking-wider text-foreground flex items-center gap-2">
              <Plus className="h-4 w-4 text-primary" />
              Add Players
            </span>
            <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${addPlayersOpen ? "rotate-180" : ""}`} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 pt-3">
          {/* Autofill & Quick Add Toolbar */}
          <div className="flex flex-wrap gap-2 items-center">
            <Select onValueChange={(tpl) => autofillRoster.mutate(tpl)}>
              <SelectTrigger className="w-auto gap-2">
                <Wand2 className="h-4 w-4" />
                <SelectValue placeholder="Autofill Template…" />
              </SelectTrigger>
              <SelectContent>
                {RUN_TEMPLATES.map(t => (
                  <SelectItem key={t.name} value={t.name}>
                    <span className="font-medium">{t.name}</span>
                    <span className="text-xs text-muted-foreground ml-2">— {t.description}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => setQuickAddOpen(!quickAddOpen)}>
              <Plus className="h-4 w-4 mr-1" /> Quick Add
            </Button>
          </div>

          {/* Quick Add Panel */}
          {quickAddOpen && (
            <div className="p-3 border rounded-lg bg-muted/30 space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Quick Add by Archetype</h4>
              <div className="flex gap-2 items-end">
                <div className="flex-1 space-y-1">
                  <Label className="text-xs">Archetype</Label>
                  <Select value={quickAddArchetype} onValueChange={setQuickAddArchetype}>
                    <SelectTrigger><SelectValue placeholder="Pick archetype…" /></SelectTrigger>
                    <SelectContent>
                      {ARCHETYPE_LIST.map(a => (
                        <SelectItem key={a.name} value={a.name.toLowerCase()}>{a.name} ({a.positions.filter(Boolean).join("/")})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-24 space-y-1">
                  <Label className="text-xs">{quickAddStars}★</Label>
                  <Slider min={0} max={6} step={1} value={[quickAddStars]} onValueChange={([v]) => setQuickAddStars(v)} />
                </div>
                <Button size="sm" disabled={!quickAddArchetype || quickAddMutation.isPending} onClick={() => quickAddMutation.mutate({ archetype: quickAddArchetype, stars: quickAddStars })}>
                  {quickAddMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
                </Button>
              </div>
            </div>
          )}

          {/* Mass Import Section */}
          <div className="p-3 border rounded-lg bg-muted/30 space-y-3">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
              <Upload className="h-3.5 w-3.5" /> Mass Import from Team
            </h4>
            <div className="flex gap-2">
              <Select value={importTeamId || "pick"} onValueChange={(v) => setImportTeamId(v === "pick" ? "" : v)}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Select a team..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pick" disabled>Select a team…</SelectItem>
                  {teams.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                disabled={!importTeamId}
                onClick={() => {
                  const ids = teamPlayersForImport.map((p) => p.id);
                  addToPending(ids);
                }}
              >
                Import to Review
              </Button>
            </div>
            {importTeamId && (
              <p className="text-xs text-muted-foreground">
                {teamPlayersForImport.length} players · {teamPlayersForImport.filter((p) => rosterCardIds.has(p.id)).length} already in roster
              </p>
            )}
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search available players by name, position, gem…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
          </div>

          {/* Available Player List */}
          <ScrollArea className="h-[280px] border rounded-md">
            {isLoading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
              </div>
            ) : availablePlayers.length === 0 ? (
              <div className="py-12 text-center text-sm text-muted-foreground">
                {debouncedSearch ? "No matching players found." : "All players are already in the roster."}
              </div>
            ) : (
              <div className="divide-y divide-border">
                {availablePlayers.slice(0, displayLimit).map((player) => (
                  <div
                    key={player.id}
                    className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50 transition-colors group"
                  >
                    <Checkbox
                      checked={false}
                      onCheckedChange={() => addToPending([player.id])}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <button
                          className="font-medium text-sm truncate hover:underline hover:text-primary transition-colors text-left"
                          onClick={() => setQuickEditPlayerId(player.id)}
                          title="Click to edit player"
                        >
                          {player.name}
                        </button>
                        <button
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => setQuickEditPlayerId(player.id)}
                          title="Edit player"
                        >
                          <Pencil className="h-3 w-3 text-muted-foreground hover:text-primary" />
                        </button>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">{player.rating}★</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground flex gap-2">
                        {player.position1 && <span>{player.position1}{player.position2 ? ` / ${player.position2}` : ""}</span>}
                        {player.gem_name && <span>· {player.gem_name}</span>}
                      </div>
                    </div>
                  </div>
                ))}
                {availablePlayers.length > displayLimit && (
                  <div className="px-3 py-3 text-center">
                    <p className="text-xs text-muted-foreground mb-2">Showing {displayLimit} of {availablePlayers.length} players</p>
                    <Button variant="outline" size="sm" onClick={() => setDisplayLimit((l) => l + 50)}>
                      Show More
                    </Button>
                  </div>
                )}
              </div>
            )}
          </ScrollArea>
        </CollapsibleContent>
      </Collapsible>

      <PlayerQuickEdit playerId={quickEditPlayerId} onClose={() => setQuickEditPlayerId(null)} />
    </div>
  );
}
