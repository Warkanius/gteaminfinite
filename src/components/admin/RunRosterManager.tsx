import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Search, Users, Loader2, Upload, Check, X } from "lucide-react";
import { toast } from "sonner";

interface Props {
  runId: string;
}

const STAT_KEYS = ["stat_3pt", "stat_mid", "stat_fin", "stat_dnk", "stat_stl", "stat_blk", "stat_ast", "stat_reb", "stat_int"] as const;
const RUN_STAT_KEYS = ["run_stat_3pt", "run_stat_mid", "run_stat_fin", "run_stat_dnk", "run_stat_stl", "run_stat_blk", "run_stat_ast", "run_stat_reb", "run_stat_int"] as const;
const STAT_LABELS: Record<string, string> = {
  stat_3pt: "3PT", stat_mid: "MID", stat_fin: "FIN", stat_dnk: "DNK",
  stat_stl: "STL", stat_blk: "BLK", stat_ast: "AST", stat_reb: "REB", stat_int: "INT",
};

/** Convert star rating (0-6) to a randomized numerical value (0-120).
 *  Base = stars * 20, then add random variance of ±15, clamped to [0, 120]. */
function randomizeFromStar(stars: number): number {
  const base = stars * 20;
  if (base === 0) return 0;
  const variance = Math.floor(Math.random() * 31) - 15; // -15 to +15
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
  // Converted stats the admin can edit
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

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Reset display limit when search changes
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

  // All player cards
  const { data: allPlayers = [], isLoading: playersLoading } = useQuery({
    queryKey: ["admin-all-players-lite"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("player_cards")
        .select("id, name, rating, position1, position2, team_id, gem_name, stat_3pt, stat_mid, stat_fin, stat_dnk, stat_stl, stat_blk, stat_ast, stat_reb, stat_int")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  // All badges for players (fetch once)
  const { data: allBadges = [] } = useQuery({
    queryKey: ["admin-all-player-badges"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("player_card_badges")
        .select("player_card_id, tier, badges(name)");
      if (error) throw error;
      return data;
    },
  });

  const badgesByPlayer = useMemo(() => {
    const map = new Map<string, { name: string; tier: string }[]>();
    for (const b of allBadges) {
      const list = map.get(b.player_card_id) || [];
      list.push({ name: (b as any).badges?.name ?? "?", tier: b.tier });
      map.set(b.player_card_id, list);
    }
    return map;
  }, [allBadges]);

  // Teams
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

  // Convert a player card to a PendingPlayer with numerical ratings
  function toPending(p: typeof allPlayers[0]): PendingPlayer {
    return {
      id: p.id,
      name: p.name,
      rating: p.rating,
      position1: p.position1,
      position2: p.position2,
      gem_name: p.gem_name,
      badges: badgesByPlayer.get(p.id) || [],
      run_rating: starToNumerical(p.rating),
      run_stat_3pt: starToNumerical(p.stat_3pt),
      run_stat_mid: starToNumerical(p.stat_mid),
      run_stat_fin: starToNumerical(p.stat_fin),
      run_stat_dnk: starToNumerical(p.stat_dnk),
      run_stat_stl: starToNumerical(p.stat_stl),
      run_stat_blk: starToNumerical(p.stat_blk),
      run_stat_ast: starToNumerical(p.stat_ast),
      run_stat_reb: starToNumerical(p.stat_reb),
      run_stat_int: starToNumerical(p.stat_int),
    };
  }

  // Add players to pending review
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

  // Toggle single player in/out of pending or roster
  function handleToggle(cardId: string, checked: boolean) {
    if (checked) {
      addToPending([cardId]);
    } else {
      // If in pending, remove from pending
      if (pendingPlayers.some((p) => p.id === cardId)) {
        setPendingPlayers((prev) => prev.filter((p) => p.id !== cardId));
      } else {
        // Remove from roster
        removeFromRoster.mutate(cardId);
      }
    }
  }

  // Update a pending player's stat
  function updatePendingStat(playerId: string, key: string, value: number) {
    setPendingPlayers((prev) =>
      prev.map((p) => (p.id === playerId ? { ...p, [key]: Math.max(0, Math.min(200, value)) } : p))
    );
  }

  // Confirm all pending players → insert into run_players
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
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["run-roster", runId] });
      toast.success(`${pendingPlayers.length} player(s) confirmed and added.`);
      setPendingPlayers([]);
    },
    onError: (e) => toast.error(e.message),
  });

  // Remove from roster
  const removeFromRoster = useMutation({
    mutationFn: async (cardId: string) => {
      const { error } = await supabase.from("run_players").delete().eq("run_id", runId).eq("player_card_id", cardId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["run-roster", runId] }),
    onError: (e) => toast.error(e.message),
  });

  // Clear entire roster
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

  const pendingIds = useMemo(() => new Set(pendingPlayers.map((p) => p.id)), [pendingPlayers]);

  const filtered = useMemo(() => {
    if (!debouncedSearch) return allPlayers;
    const q = debouncedSearch.toLowerCase();
    return allPlayers.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.position1 ?? "").toLowerCase().includes(q) ||
        (p.gem_name ?? "").toLowerCase().includes(q)
    );
  }, [debouncedSearch, allPlayers]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const aIn = rosterCardIds.has(a.id) ? 0 : pendingIds.has(a.id) ? 1 : 2;
      const bIn = rosterCardIds.has(b.id) ? 0 : pendingIds.has(b.id) ? 1 : 2;
      if (aIn !== bIn) return aIn - bIn;
      return a.name.localeCompare(b.name);
    });
  }, [filtered, rosterCardIds, pendingIds]);

  const isLoading = rosterLoading || playersLoading;

  const tierColor: Record<string, string> = {
    base: "bg-muted text-muted-foreground",
    gold: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    hof: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    diamond: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
    actolytrene: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  };

  return (
    <div className="space-y-4">
      {/* Pending Review Section */}
      {pendingPlayers.length > 0 && (
        <div className="border-2 border-primary/50 rounded-lg bg-primary/5 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold uppercase tracking-wider text-primary flex items-center gap-2">
              <Check className="h-4 w-4" /> Review Converted Ratings ({pendingPlayers.length})
            </h4>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" className="text-destructive text-xs" onClick={() => setPendingPlayers([])}>
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

          <ScrollArea className="max-h-[400px]">
            <div className="space-y-1">
              {/* Header */}
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
                <div key={p.id} className="grid grid-cols-[1fr_repeat(6,48px)_auto] gap-1 px-2 py-1.5 items-center border-b border-border/30">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-xs truncate">{p.name}</span>
                      <Badge variant="outline" className="text-[9px] px-1 py-0 shrink-0">{p.rating}★</Badge>
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
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setPendingPlayers((prev) => prev.filter((x) => x.id !== p.id))}>
                    <X className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
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

      {/* Roster Stats */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Users className="h-4 w-4" />
          <span className="font-medium text-foreground">{rosterCardIds.size}</span> in roster
          {pendingPlayers.length > 0 && (
            <span className="text-primary font-medium">· {pendingPlayers.length} pending review</span>
          )}
        </div>
        {rosterCardIds.size > 0 && (
          <Button variant="ghost" size="sm" className="text-destructive text-xs" onClick={() => clearRoster.mutate()} disabled={clearRoster.isPending}>
            Clear All
          </Button>
        )}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search players by name, position, gem…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      {/* Player List */}
      <ScrollArea className="h-[340px] border rounded-md">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
          </div>
        ) : sorted.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">No players found.</div>
        ) : (
          <div className="divide-y divide-border">
            {sorted.slice(0, displayLimit).map((player) => {
              const inRoster = rosterCardIds.has(player.id);
              const inPending = pendingIds.has(player.id);
              return (
                <label
                  key={player.id}
                  className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted/50 transition-colors ${
                    inRoster ? "bg-primary/5" : inPending ? "bg-yellow-500/5" : ""
                  }`}
                >
                  <Checkbox
                    checked={inRoster || inPending}
                    onCheckedChange={(checked) => handleToggle(player.id, !!checked)}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{player.name}</span>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">{player.rating}★</Badge>
                      {inRoster && <Badge className="text-[9px] px-1 py-0 bg-primary/20 text-primary border-primary/30">Roster</Badge>}
                      {inPending && <Badge className="text-[9px] px-1 py-0 bg-yellow-500/20 text-yellow-400 border-yellow-500/30">Pending</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground flex gap-2">
                      {player.position1 && <span>{player.position1}{player.position2 ? ` / ${player.position2}` : ""}</span>}
                      {player.gem_name && <span>· {player.gem_name}</span>}
                    </div>
                  </div>
                </label>
              );
            })}
            {sorted.length > displayLimit && (
              <div className="px-3 py-3 text-center">
                <p className="text-xs text-muted-foreground mb-2">Showing {displayLimit} of {sorted.length} players</p>
                <Button variant="outline" size="sm" onClick={() => setDisplayLimit((l) => l + 50)}>
                  Show More
                </Button>
              </div>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
