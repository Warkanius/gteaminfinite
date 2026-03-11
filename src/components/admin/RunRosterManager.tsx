import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Search, Users, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

interface Props {
  runId: string;
}

export function RunRosterManager({ runId }: Props) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [importTeamId, setImportTeamId] = useState<string>("");

  // Current roster player_card_ids
  const { data: rosterEntries = [], isLoading: rosterLoading } = useQuery({
    queryKey: ["run-roster", runId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("run_players")
        .select("id, player_card_id")
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
        .select("id, name, rating, position1, position2, team_id, gem_name")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  // Teams
  const { data: teams = [] } = useQuery({
    queryKey: ["admin-teams"],
    queryFn: async () => {
      const { data, error } = await supabase.from("teams").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
  });

  // Players in selected team
  const teamPlayersForImport = useMemo(() => {
    if (!importTeamId) return [];
    return allPlayers.filter((p) => p.team_id === importTeamId);
  }, [importTeamId, allPlayers]);

  // Toggle single player
  const togglePlayer = useMutation({
    mutationFn: async ({ cardId, add }: { cardId: string; add: boolean }) => {
      if (add) {
        const { error } = await supabase.from("run_players").insert({ run_id: runId, player_card_id: cardId });
        if (error) throw error;
      } else {
        const { error } = await supabase.from("run_players").delete().eq("run_id", runId).eq("player_card_id", cardId);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["run-roster", runId] }),
    onError: (e) => toast.error(e.message),
  });

  // Mass import from team
  const importTeam = useMutation({
    mutationFn: async (teamId: string) => {
      const teamPlayers = allPlayers.filter((p) => p.team_id === teamId);
      const newPlayers = teamPlayers.filter((p) => !rosterCardIds.has(p.id));
      if (newPlayers.length === 0) {
        toast.info("All players from this team are already in the roster.");
        return;
      }
      const rows = newPlayers.map((p) => ({ run_id: runId, player_card_id: p.id }));
      const { error } = await supabase.from("run_players").insert(rows);
      if (error) throw error;
      toast.success(`Added ${newPlayers.length} players from team.`);
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

  const filtered = useMemo(() => {
    if (!search) return allPlayers;
    const q = search.toLowerCase();
    return allPlayers.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.position1 ?? "").toLowerCase().includes(q) ||
        (p.gem_name ?? "").toLowerCase().includes(q)
    );
  }, [search, allPlayers]);

  // Sort: roster players first, then alphabetical
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const aIn = rosterCardIds.has(a.id) ? 0 : 1;
      const bIn = rosterCardIds.has(b.id) ? 0 : 1;
      if (aIn !== bIn) return aIn - bIn;
      return a.name.localeCompare(b.name);
    });
  }, [filtered, rosterCardIds]);

  const isLoading = rosterLoading || playersLoading;

  return (
    <div className="space-y-4">
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
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            disabled={!importTeamId || importTeam.isPending}
            onClick={() => importTeamId && importTeam.mutate(importTeamId)}
          >
            {importTeam.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Import"}
          </Button>
        </div>
        {importTeamId && (
          <p className="text-xs text-muted-foreground">
            {teamPlayersForImport.length} players in this team
            {" · "}
            {teamPlayersForImport.filter((p) => rosterCardIds.has(p.id)).length} already in roster
          </p>
        )}
      </div>

      {/* Roster Stats */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Users className="h-4 w-4" />
          <span className="font-medium text-foreground">{rosterCardIds.size}</span> players in roster
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
        <Input
          placeholder="Search all players by name, position, gem…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
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
            {sorted.map((player) => {
              const inRoster = rosterCardIds.has(player.id);
              return (
                <label
                  key={player.id}
                  className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted/50 transition-colors ${inRoster ? "bg-primary/5" : ""}`}
                >
                  <Checkbox
                    checked={inRoster}
                    onCheckedChange={(checked) =>
                      togglePlayer.mutate({ cardId: player.id, add: !!checked })
                    }
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{player.name}</span>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
                        {player.rating}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground flex gap-2">
                      {player.position1 && <span>{player.position1}{player.position2 ? ` / ${player.position2}` : ""}</span>}
                      {player.gem_name && <span>· {player.gem_name}</span>}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
