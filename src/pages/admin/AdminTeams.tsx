import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { computeOVR } from "@/lib/ovrUtils";
import { DataTable, Column } from "@/components/admin/DataTable";
import { FormDialog } from "@/components/admin/FormDialog";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { RoadBulkImport } from "@/components/admin/RoadBulkImport";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Pencil, Trash2, Plus, Users, Wand2, Package, Zap, Copy, X } from "lucide-react";
import { PlayerQuickEdit } from "@/components/admin/PlayerQuickEdit";
import { toast } from "sonner";
import { ChatGPTExchange } from "@/components/admin/ChatGPTExchange";
import { TeamsExchange, RunsExchange } from "@/lib/exchangeEntities";
import type { Tables } from "@/integrations/supabase/types";
import { RunRosterManager } from "@/components/admin/RunRosterManager";
import { MilestoneEditor, type Milestone } from "@/components/admin/MilestoneEditor";
import { RankRewardEditor } from "@/components/admin/RankRewardEditor";
import { TEAM_TEMPLATES, generateRandomName, type TemplateSlot } from "@/lib/teamTemplates";
import { TemplatePicker } from "@/components/admin/TemplatePicker";
import { generateFromProfile, ARCHETYPE_LIST, type WizardProfile } from "@/lib/archetypeEngine";
import { PlayerCombobox } from "@/components/admin/PlayerCombobox";

type Team = Tables<"teams">;
type DomGame = Tables<"domination_games">;
type Run = Tables<"runs">;

/** Generate a player card from a template slot */
async function createPlayerFromSlot(
  slot: TemplateSlot,
  allBadges: { id: string; abbreviation: string; affected_stat: string | null; effect_type: string }[],
  gemTiers: { id: string; stars: number }[],
) {
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

  const gen = generateFromProfile(profile, stars, allBadges, stars);
  const name = generateRandomName();

  const { data: card, error } = await supabase.from("player_cards").insert({
    name,
    rating: stars,
    gem_tier_id: tier.id,
    position1: gen.positions[0],
    position2: gen.positions[1],
    ...gen.stats,
  }).select("id, name, rating").single();

  if (error) throw error;

  if (gen.badges.length > 0) {
    const badgeRows = gen.badges
      .map(rb => {
        const badge = allBadges.find(b => b.abbreviation.toLowerCase() === rb.abbreviation.toLowerCase());
        return badge ? { player_card_id: card.id, badge_id: badge.id, tier: rb.tier } : null;
      })
      .filter(Boolean);
    if (badgeRows.length > 0) {
      await supabase.from("player_card_badges").insert(badgeRows);
    }
  }

  return card;
}

export default function AdminTeams() {
  const qc = useQueryClient();

  // Fetch Packs for Rewards
  const { data: packs = [] } = useQuery({
    queryKey: ["admin-packs-lite"],
    queryFn: async () => {
      const { data, error } = await supabase.from("packs").select("id, name, pack_type").order("name");
      if (error) throw error;
      return data;
    },
  });

  // Fetch badges for autofill
  const { data: allBadges = [] } = useQuery({
    queryKey: ["admin-badges-for-gen"],
    queryFn: async () => {
      const { data, error } = await supabase.from("badges").select("id, abbreviation, affected_stat, effect_type");
      if (error) throw error;
      return data;
    },
  });

  // Fetch gem tiers for autofill
  const { data: gemTiers = [] } = useQuery({
    queryKey: ["admin-gem-tiers-for-gen"],
    queryFn: async () => {
      const { data, error } = await supabase.from("gem_tiers").select("id, stars, name").order("stars");
      if (error) throw error;
      return data;
    },
  });

  // All players for search/add
  const { data: allPlayersLite = [] } = useQuery({
    queryKey: ["admin-all-players-lite"],
    queryFn: async () => {
      const { data, error } = await supabase.from("player_cards").select("id, name, rating, stat_3pt, stat_mid, stat_fin, stat_dnk, stat_stl, stat_blk, stat_ast, stat_reb, stat_int").order("name");
      if (error) throw error;
      return data;
    },
  });

  // Domination game players
  const { data: domGamePlayers = [] } = useQuery({
    queryKey: ["admin-dom-game-players"],
    queryFn: async () => {
      const { data, error } = await supabase.from("domination_game_players").select("*, player_cards(id, name, rating, stat_3pt, stat_mid, stat_fin, stat_dnk, stat_stl, stat_blk, stat_ast, stat_reb, stat_int)");
      if (error) throw error;
      return data;
    },
  });

  // Team players (roster)
  const { data: teamPlayers = [], refetch: refetchTeamPlayers } = useQuery({
    queryKey: ["admin-team-players"],
    queryFn: async () => {
      const { data, error } = await supabase.from("team_players").select("*, player_cards(id, name, rating, stat_3pt, stat_mid, stat_fin, stat_dnk, stat_stl, stat_blk, stat_ast, stat_reb, stat_int)").order("slot");
      if (error) throw error;
      return data;
    },
  });

  // Teams
  const [teamForm, setTeamForm] = useState({ name: "", category: "domination" });
  const [teamEditId, setTeamEditId] = useState<string | null>(null);
  const [teamDialog, setTeamDialog] = useState(false);
  const [teamDeleteId, setTeamDeleteId] = useState<string | null>(null);
  const [duplicateSourceTeamId, setDuplicateSourceTeamId] = useState<string | null>(null);

  // Team roster quick-add state
  const [teamQuickAddArchetype, setTeamQuickAddArchetype] = useState("");
  const [teamQuickAddStars, setTeamQuickAddStars] = useState(3);
  const [teamQuickAddOpen, setTeamQuickAddOpen] = useState(false);
  const [teamSearchPlayerId, setTeamSearchPlayerId] = useState("");
  const [quickEditPlayerId, setQuickEditPlayerId] = useState<string | null>(null);

  const { data: teams = [], isLoading: teamsLoading } = useQuery({
    queryKey: ["admin-teams"], queryFn: async () => { const { data, error } = await supabase.from("teams").select("*").order("name"); if (error) throw error; return data; },
  });

  const teamSave = useMutation({
    mutationFn: async () => {
      const payload = { name: teamForm.name, category: teamForm.category };
      if (teamEditId) { const { error } = await supabase.from("teams").update(payload).eq("id", teamEditId); if (error) throw error; }
      else {
        const { data, error } = await supabase.from("teams").insert(payload).select("id").single();
        if (error) throw error;
        if (duplicateSourceTeamId) {
          const sourceRoster = teamPlayers
            .filter((tp) => tp.team_id === duplicateSourceTeamId)
            .map((tp) => ({ team_id: data.id, player_card_id: tp.player_card_id, slot: tp.slot }));
          if (sourceRoster.length > 0) {
            const { error: rosterError } = await supabase.from("team_players").insert(sourceRoster);
            if (rosterError) throw rosterError;
          }
        }
        setTeamEditId(data.id);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-teams"] });
      qc.invalidateQueries({ queryKey: ["admin-team-players"] });
      setDuplicateSourceTeamId(null);
      toast.success("Saved");
    },
    onError: (e) => toast.error(e.message),
  });

  const teamDelete = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("teams").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-teams"] }); setTeamDeleteId(null); toast.success("Deleted"); },
    onError: (e) => toast.error(e.message),
  });

  // --- Team Roster Mutations ---
  const addPlayerToTeam = useMutation({
    mutationFn: async ({ teamId, playerCardId }: { teamId: string; playerCardId: string }) => {
      const existing = teamPlayers.filter(tp => tp.team_id === teamId);
      const nextSlot = existing.length + 1;
      const { error } = await supabase.from("team_players").insert({ team_id: teamId, player_card_id: playerCardId, slot: nextSlot });
      if (error) throw error;
    },
    onSuccess: () => { refetchTeamPlayers(); toast.success("Player added to team"); },
    onError: (e) => toast.error(e.message),
  });

  const removePlayerFromTeam = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("team_players").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { refetchTeamPlayers(); toast.success("Removed"); },
    onError: (e) => toast.error(e.message),
  });

  const autofillTeamRoster = useMutation({
    mutationFn: async ({ teamId, templateName }: { teamId: string; templateName: string }) => {
      const template = TEAM_TEMPLATES.find(t => t.name === templateName);
      if (!template) throw new Error("Template not found");

      // Only fill remaining slots
      const existingRoster = teamPlayers.filter(tp => tp.team_id === teamId);
      const existingCount = existingRoster.length;
      const remainingSlots = template.slots.slice(existingCount);

      if (remainingSlots.length === 0) {
        toast.info("Roster is already full for this template.");
        return [];
      }

      const cards = [];
      for (let i = 0; i < remainingSlots.length; i++) {
        const card = await createPlayerFromSlot(remainingSlots[i], allBadges, gemTiers);
        cards.push(card);
      }

      const rows = cards.map((c, i) => ({ team_id: teamId, player_card_id: c.id, slot: existingCount + i + 1 }));
      const { error } = await supabase.from("team_players").insert(rows);
      if (error) throw error;
      return cards;
    },
    onSuccess: (cards) => {
      refetchTeamPlayers();
      qc.invalidateQueries({ queryKey: ["admin-all-players-lite"] });
      if (cards.length > 0) toast.success(`${cards.length} players generated`);
    },
    onError: (e) => toast.error(e.message),
  });

  const quickAddToTeam = useMutation({
    mutationFn: async ({ teamId, archetype, stars }: { teamId: string; archetype: string; stars: number }) => {
      const slot: TemplateSlot = { archetype, starRange: [stars, stars] };
      const card = await createPlayerFromSlot(slot, allBadges, gemTiers);
      const existing = teamPlayers.filter(tp => tp.team_id === teamId);
      await supabase.from("team_players").insert({ team_id: teamId, player_card_id: card.id, slot: existing.length + 1 });
      return card;
    },
    onSuccess: (card) => {
      refetchTeamPlayers();
      qc.invalidateQueries({ queryKey: ["admin-all-players-lite"] });
      setTeamQuickAddOpen(false);
      toast.success(`Added ${card.name}`);
    },
    onError: (e) => toast.error(e.message),
  });

  // Domination
  const [domForm, setDomForm] = useState({ road_name: "", opponent_name: "", game_order: 1, difficulty_stars: 1, coin_reward: 0, pack_reward: "" });
  const [domEditId, setDomEditId] = useState<string | null>(null);
  const [domDialog, setDomDialog] = useState(false);
  const [domDeleteId, setDomDeleteId] = useState<string | null>(null);

  const { data: domGames = [], isLoading: domLoading } = useQuery({
    queryKey: ["admin-dom"], queryFn: async () => { const { data, error } = await supabase.from("domination_games").select("*").order("game_order"); if (error) throw error; return data; },
  });

  const { data: domRoads = [] } = useQuery({
    queryKey: ["admin-dom-roads"],
    queryFn: async () => {
      const { data, error } = await supabase.from("domination_roads").select("*").order("sort_order");
      if (error) throw error;
      return data;
    },
  });

  const domSave = useMutation({
    mutationFn: async () => {
      const roadName = domForm.road_name.trim();
      if (!roadName) throw new Error("Road name is required");
      const road = domRoads.find((r) => r.name.toLowerCase() === roadName.toLowerCase());
      const payload = {
        ...domForm,
        road_name: roadName,
        road_id: road?.id,
        pack_reward: domForm.pack_reward || null,
      };
      // road_id is resolved (or the road auto-created) by the database trigger.
      if (domEditId) { const { error } = await supabase.from("domination_games").update(payload as never).eq("id", domEditId); if (error) throw error; }
      else { const { error } = await supabase.from("domination_games").insert(payload as never); if (error) throw error; }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-dom"] });
      qc.invalidateQueries({ queryKey: ["admin-dom-roads"] });
      setDomDialog(false);
      toast.success("Saved");
    },
    onError: (e) => toast.error(e.message),
  });

  const [roadDeleteName, setRoadDeleteName] = useState<string | null>(null);

  // Whole-road deletion goes through the preview -> commit token protocol so the
  // server validates the plan before anything is removed.
  const roadDelete = useMutation({
    mutationFn: async (roadName: string) => {
      const road = domRoads.find((r) => r.name === roadName);
      const ref = road ? { road_id: road.id } : { road_name: roadName };
      const { data: preview, error: pErr } = await supabase.rpc("admin_road_delete", { p_payload: ref as never, p_commit: false });
      if (pErr) throw pErr;
      const token = (preview as any)?.preview_token;
      if (!token) throw new Error("No preview token returned");
      const { error } = await supabase.rpc("admin_road_delete", { p_payload: ref as never, p_commit: true, p_preview_token: token });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-dom"] });
      qc.invalidateQueries({ queryKey: ["admin-dom-roads"] });
      setRoadDeleteName(null);
      toast.success("Road deleted");
    },
    onError: (e) => toast.error(e.message),
  });

  const domDelete = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("domination_games").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-dom"] }); setDomDeleteId(null); toast.success("Deleted"); },
    onError: (e) => toast.error(e.message),
  });

  // Auto-create Reward Pack
  const createRewardPack = useMutation({
    mutationFn: async ({ gameId, isRTTR }: { gameId: string; isRTTR: boolean }) => {
      const game = domGames.find(g => g.id === gameId);
      if (!game) throw new Error("Game not found");

      const players = domGamePlayers.filter(p => p.domination_game_id === gameId);
      if (players.length === 0) throw new Error("No players assigned to this game");

      const sorted = [...players].sort((a, b) => (b.player_cards?.rating ?? 0) - (a.player_cards?.rating ?? 0));

      const packName = isRTTR ? `RTTR: ${game.opponent_name}` : `vs ${game.opponent_name} Reward`;
      const { data: pack, error: packErr } = await supabase.from("packs").insert({
        name: packName,
        pack_type: isRTTR ? "rttr" : "domination_reward",
        cost: 0,
      }).select("id").single();
      if (packErr) throw packErr;

      const packPlayerRows = sorted.map((p, i) => ({
        pack_id: pack.id,
        player_card_id: p.player_card_id,
        slot_number: i + 1,
      }));
      await supabase.from("pack_players").insert(packPlayerRows);

      const numPlayers = sorted.length;
      let oddsRows: any[];

      if (isRTTR) {
        const totalPlayerPct = 83;
        const weights = sorted.map((_, i) => numPlayers - i);
        const totalWeight = weights.reduce((s, w) => s + w, 0);
        oddsRows = sorted.map((p, i) => ({
          pack_id: pack.id,
          pack_type: "rttr",
          result_slot: String(i + 1),
          percentage: Math.round((weights[i] / totalWeight) * totalPlayerPct),
          description: p.player_cards?.name ?? `Slot ${i + 1}`,
        }));
        oddsRows.push({
          pack_id: pack.id,
          pack_type: "rttr",
          result_slot: "player_choice",
          percentage: 17,
          description: "Player's Choice",
        });
      } else {
        const weights = sorted.map((_, i) => i + 1);
        const totalWeight = weights.reduce((s, w) => s + w, 0);
        oddsRows = sorted.map((p, i) => ({
          pack_id: pack.id,
          pack_type: "domination_reward",
          result_slot: String(i + 1),
          percentage: Math.round((weights[i] / totalWeight) * 100),
          description: p.player_cards?.name ?? `Slot ${i + 1}`,
        }));
      }

      await supabase.from("pack_odds").insert(oddsRows);
      await supabase.from("domination_games").update({ pack_reward: pack.id }).eq("id", gameId);

      return pack;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ["admin-dom"] });
      qc.invalidateQueries({ queryKey: ["admin-packs-lite"] });
      toast.success(vars.isRTTR ? "RTTR Pack created" : "Reward Pack created");
    },
    onError: (e) => toast.error(e.message),
  });

  // Autofill domination roster
  const autofillRoster = useMutation({
    mutationFn: async ({ gameId, templateName }: { gameId: string; templateName: string }) => {
      const template = TEAM_TEMPLATES.find(t => t.name === templateName);
      if (!template) throw new Error("Template not found");

      await supabase.from("domination_game_players").delete().eq("domination_game_id", gameId);

      const cards = [];
      for (let i = 0; i < template.slots.length; i++) {
        const card = await createPlayerFromSlot(template.slots[i], allBadges, gemTiers);
        cards.push(card);
      }

      const rows = cards.map((c, i) => ({
        domination_game_id: gameId,
        player_card_id: c.id,
        slot: i + 1,
      }));
      const { error } = await supabase.from("domination_game_players").insert(rows);
      if (error) throw error;

      return cards;
    },
    onSuccess: (cards) => {
      qc.invalidateQueries({ queryKey: ["admin-dom-game-players"] });
      qc.invalidateQueries({ queryKey: ["admin-all-players-lite"] });
      toast.success(`${cards.length} players generated and added to roster`);
    },
    onError: (e) => toast.error(e.message),
  });

  // Import team roster into domination game
  const importTeamRoster = useMutation({
    mutationFn: async ({ gameId, teamId }: { gameId: string; teamId: string }) => {
      const roster = teamPlayers.filter(tp => tp.team_id === teamId);
      if (roster.length === 0) throw new Error("Team has no players");

      // Clear existing dom players
      await supabase.from("domination_game_players").delete().eq("domination_game_id", gameId);

      const rows = roster.map(tp => ({
        domination_game_id: gameId,
        player_card_id: tp.player_card_id,
        slot: tp.slot,
      }));
      const { error } = await supabase.from("domination_game_players").insert(rows);
      if (error) throw error;
      return roster.length;
    },
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: ["admin-dom-game-players"] });
      toast.success(`Imported ${count} players from team roster`);
    },
    onError: (e) => toast.error(e.message),
  });

  // Quick Add single archetype to domination game
  const quickAddPlayer = useMutation({
    mutationFn: async ({ gameId, archetype, stars }: { gameId: string; archetype: string; stars: number }) => {
      const slot: TemplateSlot = { archetype, starRange: [stars, stars] };
      const card = await createPlayerFromSlot(slot, allBadges, gemTiers);

      const existingPlayers = domGamePlayers.filter(p => p.domination_game_id === gameId);
      const nextSlot = existingPlayers.length + 1;

      await supabase.from("domination_game_players").insert({
        domination_game_id: gameId,
        player_card_id: card.id,
        slot: nextSlot,
      });

      return card;
    },
    onSuccess: (card) => {
      qc.invalidateQueries({ queryKey: ["admin-dom-game-players"] });
      toast.success(`Added ${card.name} to roster`);
    },
    onError: (e) => toast.error(e.message),
  });

  // Runs
  const [runForm, setRunForm] = useState<{name: string; target_score: number; team_id: string | null; milestones: any[] | string}>({ name: "", target_score: 21, team_id: null, milestones: [] });
  const [runEditId, setRunEditId] = useState<string | null>(null);
  const [runDialog, setRunDialog] = useState(false);
  const [runDeleteId, setRunDeleteId] = useState<string | null>(null);

  const { data: runs = [], isLoading: runsLoading } = useQuery({
    queryKey: ["admin-runs"], queryFn: async () => { const { data, error } = await supabase.from("runs").select("*").order("name"); if (error) throw error; return data; },
  });

  const runSave = useMutation({
    mutationFn: async () => {
      let parsedMilestones: any;
      try {
        parsedMilestones = typeof runForm.milestones === 'string' ? JSON.parse(runForm.milestones) : runForm.milestones;
      } catch {
        throw new Error("Milestones JSON is invalid.");
      }
      const payload = {
        name: runForm.name,
        target_score: runForm.target_score,
        team_id: runForm.team_id || null,
        milestones: parsedMilestones,
      };
      if (runEditId) { const { error } = await supabase.from("runs").update(payload).eq("id", runEditId); if (error) throw error; }
      else { const { error } = await supabase.from("runs").insert(payload); if (error) throw error; }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-runs"] }); setRunDialog(false); toast.success("Saved"); },
    onError: (e) => toast.error(e.message),
  });

  const runDelete = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from("runs").delete().eq("id", id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-runs"] }); setRunDeleteId(null); toast.success("Deleted"); },
    onError: (e) => toast.error(e.message),
  });

  // Quick add state for domination
  const [quickAddGameId, setQuickAddGameId] = useState<string | null>(null);
  const [quickAddArchetype, setQuickAddArchetype] = useState("");
  const [quickAddStars, setQuickAddStars] = useState(3);

  const teamCols: Column<Team>[] = [
    { key: "name", label: "Name", sortable: true },
    { key: "category", label: "Category", sortable: true },
    { key: "id", label: "Roster", render: (r) => {
      const count = teamPlayers.filter(tp => tp.team_id === r.id).length;
      return <span className="text-muted-foreground">{count} players</span>;
    }},
  ];

  const domCols: Column<DomGame>[] = [
    { key: "game_order", label: "Order", sortable: true },
    { key: "opponent_name", label: "Opponent" },
    { key: "difficulty_stars", label: "Stars" },
    { key: "coin_reward", label: "Coins" },
    { key: "pack_reward", label: "Pack Reward", render: (r) => {
      if (!r.pack_reward) return "—";
      const p = packs.find(pk => pk.id === r.pack_reward);
      return p ? p.name : r.pack_reward;
    }},
  ];

  const runCols: Column<Run>[] = [
    { key: "name", label: "Name", sortable: true },
    { key: "target_score" as any, label: "Score", render: (r: any) => r.target_score },
    { key: "milestones" as any, label: "Milestones", render: (r: any) => `${Array.isArray(r.milestones) ? r.milestones.length : 0} Ranks` }
  ];

  // Group Domination Games by Road
  const groupedDomGames = domGames.reduce((acc, game) => {
    if (!acc[game.road_name]) acc[game.road_name] = [];
    acc[game.road_name].push(game);
    return acc;
  }, {} as Record<string, DomGame[]>);

  // Current team roster for editing
  const currentTeamRoster = teamEditId ? teamPlayers.filter(tp => tp.team_id === teamEditId) : [];

  // Helper: when selecting a team in domination, auto-import its roster
  const handleDomTeamSelect = async (teamName: string) => {
    setDomForm(f => ({ ...f, opponent_name: teamName }));

    // If editing an existing game and a matching team has players, offer to import
    if (domEditId) {
      const team = teams.find(t => t.name === teamName);
      if (team) {
        const roster = teamPlayers.filter(tp => tp.team_id === team.id);
        if (roster.length > 0) {
          importTeamRoster.mutate({ gameId: domEditId, teamId: team.id });
        }
      }
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Match Configurations</h1>
          <p className="text-muted-foreground mt-2">Manage teams, domination roads, and endless run settings.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ChatGPTExchange title="Teams · AI Import / Export" entity={TeamsExchange} onCommitted={() => qc.invalidateQueries({ queryKey: ["admin-teams"] })} />
          <ChatGPTExchange title="Runs · AI Import / Export" entity={RunsExchange} onCommitted={() => qc.invalidateQueries({ queryKey: ["admin-runs"] })} />
          <RoadBulkImport
            roads={domRoads.map((r) => ({ id: r.id, name: r.name }))}
            onCommitted={() => {
              qc.invalidateQueries({ queryKey: ["admin-dom"] });
              qc.invalidateQueries({ queryKey: ["admin-dom-roads"] });
              qc.invalidateQueries({ queryKey: ["admin-dom-players"] });
            }}
          />
        </div>
      </div>

      <Tabs defaultValue="domination" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="domination">Domination</TabsTrigger>
          <TabsTrigger value="teams">Teams</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="rank-rewards">Rank Rewards</TabsTrigger>
        </TabsList>

        <TabsContent value="domination" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div>
                <CardTitle>Domination Roads</CardTitle>
                <CardDescription>Grouped sequences of challenges and rewards</CardDescription>
              </div>
              <Button onClick={() => { 
                setDomForm({ road_name: "", opponent_name: "", game_order: 1, difficulty_stars: 1, coin_reward: 0, pack_reward: "" }); 
                setDomEditId(null); 
                setDomDialog(true); 
              }}>
                <Plus className="h-4 w-4 mr-2" /> Add Game
              </Button>
            </CardHeader>
            <CardContent>
              {domLoading ? (
                <div className="py-8 text-center text-muted-foreground">Loading games...</div>
              ) : Object.keys(groupedDomGames).length === 0 ? (
                <div className="py-8 text-center text-muted-foreground">No domination games found.</div>
              ) : (
                <Accordion type="multiple" defaultValue={Object.keys(groupedDomGames)} className="w-full">
                  {Object.entries(groupedDomGames).map(([road, games]) => (
                    <AccordionItem key={road} value={road} className="border bg-card mb-4 rounded-lg overflow-hidden">
                      <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/50 data-[state=open]:border-b">
                        <div className="flex items-center justify-between w-full pr-4">
                          <span className="font-semibold text-lg">{road}</span>
                          <span className="flex items-center gap-2 text-sm text-muted-foreground font-normal">
                            {games.length} Games
                            <span
                              role="button"
                              tabIndex={0}
                              title="Delete entire road"
                              className="p-1 rounded hover:bg-destructive/10"
                              onClick={(e) => { e.stopPropagation(); setRoadDeleteName(road); }}
                              onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); setRoadDeleteName(road); } }}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </span>
                          </span>
                        </div>
                      </AccordionTrigger>
                      <AccordionContent className="p-0">
                        <DataTable 
                          data={games} 
                          columns={domCols} 
                          searchKeys={["opponent_name"]} 
                          actions={(r) => (
                            <div className="flex gap-1 justify-end flex-wrap">
                              <TemplatePicker
                                mode="team"
                                triggerLabel="Autofill"
                                onPick={(tpl) => autofillRoster.mutate({ gameId: r.id, templateName: tpl })}
                              />
                              <Button size="icon" variant="ghost" className="h-8 w-8" title="Quick Add Player" onClick={() => {
                                setQuickAddGameId(r.id);
                                setQuickAddArchetype("");
                                setQuickAddStars(r.difficulty_stars);
                              }}>
                                <Plus className="h-4 w-4 text-green-500" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-8 w-8" title="Create Reward Pack" onClick={() => createRewardPack.mutate({ gameId: r.id, isRTTR: false })} disabled={createRewardPack.isPending}>
                                <Package className="h-4 w-4 text-amber-500" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-8 w-8" title="Create RTTR Pack" onClick={() => createRewardPack.mutate({ gameId: r.id, isRTTR: true })} disabled={createRewardPack.isPending}>
                                <Zap className="h-4 w-4 text-purple-500" />
                              </Button>
                              <Button size="icon" variant="ghost" onClick={() => { 
                                setDomForm({ 
                                  road_name: r.road_name, 
                                  opponent_name: r.opponent_name, 
                                  game_order: r.game_order, 
                                  difficulty_stars: r.difficulty_stars, 
                                  coin_reward: r.coin_reward, 
                                  pack_reward: r.pack_reward ?? "" 
                                }); 
                                setDomEditId(r.id); 
                                setDomDialog(true); 
                              }}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button size="icon" variant="ghost" onClick={() => setDomDeleteId(r.id)}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          )} 
                        />
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="teams">
          <Card>
            <CardHeader>
              <CardTitle>Opponent Teams</CardTitle>
              <CardDescription>Manage CPU opponents and their rosters.</CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable data={teams} columns={teamCols} isLoading={teamsLoading} searchKeys={["name"]} onAdd={() => { setTeamForm({ name: "", category: "domination" }); setTeamEditId(null); setDuplicateSourceTeamId(null); setTeamDialog(true); }} addLabel="Add Team"
                actions={(r) => (<div className="flex gap-1"><Button size="icon" variant="ghost" onClick={() => { setTeamForm({ name: r.name, category: r.category }); setTeamEditId(r.id); setDuplicateSourceTeamId(null); setTeamDialog(true); }}><Pencil className="h-4 w-4" /></Button><Button size="icon" variant="ghost" title="Duplicate" onClick={() => { setTeamForm({ name: `${r.name} (Copy)`, category: r.category }); setTeamEditId(null); setDuplicateSourceTeamId(r.id); setTeamDialog(true); }}><Copy className="h-4 w-4" /></Button><Button size="icon" variant="ghost" onClick={() => setTeamDeleteId(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></div>)} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="runs">
          <Card>
            <CardHeader>
              <CardTitle>Endless Runs</CardTitle>
              <CardDescription>Configure distinct continuous gauntlets.</CardDescription>
            </CardHeader>
            <CardContent>
              <DataTable data={runs} columns={runCols} isLoading={runsLoading} searchKeys={["name"]} onAdd={() => { setRunForm({ name: "", target_score: 21, team_id: null, milestones: [] }); setRunEditId(null); setRunDialog(true); }} addLabel="Add Run"
                actions={(r: any) => (<div className="flex gap-1"><Button size="icon" variant="ghost" onClick={() => { setRunForm({ name: r.name, target_score: r.target_score || 21, team_id: r.team_id, milestones: r.milestones || [] }); setRunEditId(r.id); setRunDialog(true); }}><Pencil className="h-4 w-4" /></Button><Button size="icon" variant="ghost" title="Duplicate" onClick={() => { setRunForm({ name: `${r.name} (Copy)`, target_score: r.target_score || 21, team_id: r.team_id, milestones: r.milestones || [] }); setRunEditId(null); setRunDialog(true); }}><Copy className="h-4 w-4" /></Button><Button size="icon" variant="ghost" onClick={() => setRunDeleteId(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></div>)} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rank-rewards">
          <Card>
            <CardHeader>
              <CardTitle>Rank Reward Ladder</CardTitle>
              <CardDescription>Configure rewards for each of the 25 rank tiers across all Runs.</CardDescription>
            </CardHeader>
            <CardContent>
              <RankRewardEditor packs={packs} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Quick Add Dialog (domination) */}
      <FormDialog
        open={!!quickAddGameId}
        onOpenChange={(o) => { if (!o) setQuickAddGameId(null); }}
        title="Quick Add Player"
        onSave={() => {
          if (quickAddArchetype && quickAddGameId) {
            quickAddPlayer.mutate({ gameId: quickAddGameId, archetype: quickAddArchetype, stars: quickAddStars });
            setQuickAddGameId(null);
          }
        }}
        saving={quickAddPlayer.isPending}
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Archetype</Label>
            <Select value={quickAddArchetype} onValueChange={setQuickAddArchetype}>
              <SelectTrigger><SelectValue placeholder="Select archetype…" /></SelectTrigger>
              <SelectContent>
                {ARCHETYPE_LIST.map(a => (
                  <SelectItem key={a.name} value={a.name.toLowerCase()}>{a.name} ({a.positions.filter(Boolean).join("/")})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label>Star Rating</Label>
              <span className="font-bold">{quickAddStars}★</span>
            </div>
            <Slider min={0} max={6} step={1} value={[quickAddStars]} onValueChange={([v]) => setQuickAddStars(v)} />
          </div>
        </div>
      </FormDialog>

      {/* Team dialog */}
      <FormDialog open={teamDialog} onOpenChange={setTeamDialog} title={teamEditId ? "Edit Team" : "Add Team"} onSave={() => teamSave.mutate()} saving={teamSave.isPending}>
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1"><Label>Name</Label><Input value={teamForm.name} onChange={(e) => setTeamForm((f) => ({ ...f, name: e.target.value }))} /></div>
            <div className="space-y-1"><Label>Category</Label><Input value={teamForm.category} onChange={(e) => setTeamForm((f) => ({ ...f, category: e.target.value }))} /></div>
          </div>

          {teamEditId ? (
            <div className="space-y-4 p-4 border rounded-lg bg-card">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold flex items-center gap-2 text-sm uppercase tracking-wider text-muted-foreground">
                  <Users className="h-3.5 w-3.5" /> Roster ({currentTeamRoster.length} players)
                </h3>
                <div className="flex gap-2">
                  <TemplatePicker
                    mode="team"
                    triggerLabel="Autofill"
                    onPick={(tpl) => autofillTeamRoster.mutate({ teamId: teamEditId, templateName: tpl })}
                  />
                  <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => { setTeamQuickAddOpen(true); setTeamQuickAddArchetype(""); setTeamQuickAddStars(3); }}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Quick Add
                  </Button>
                </div>
              </div>

              {/* Current players */}
              {currentTeamRoster.length > 0 ? (
                <div className="space-y-1">
                  {currentTeamRoster.map((tp) => (
                    <div key={tp.id} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/50 text-sm">
                      <button
                        className="text-left hover:underline hover:text-primary transition-colors"
                        onClick={() => setQuickEditPlayerId(tp.player_card_id)}
                        title="Click to edit player"
                      >
                        {tp.player_cards?.name ?? "Unknown"} <span className="text-muted-foreground">({tp.player_cards ? computeOVR(tp.player_cards) : 0}★)</span>
                      </button>
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setQuickEditPlayerId(tp.player_card_id)} title="Edit Player">
                          <Pencil className="h-3 w-3 text-muted-foreground" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removePlayerFromTeam.mutate(tp.id)}>
                          <X className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">No players yet. Use Autofill or Quick Add above.</p>
              )}

              {/* Search & Add existing player */}
              <div className="space-y-1 pt-2 border-t">
                <Label className="text-xs text-muted-foreground">Search & Add Existing Player</Label>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <PlayerCombobox
                      players={allPlayersLite.filter(p => !currentTeamRoster.some(tp => tp.player_card_id === p.id)).map(p => ({ id: p.id, name: `${p.name} (${computeOVR(p)}★)` }))}
                      value={teamSearchPlayerId}
                      onValueChange={setTeamSearchPlayerId}
                      placeholder="Search players…"
                    />
                  </div>
                  <Button size="sm" className="h-10" disabled={!teamSearchPlayerId || addPlayerToTeam.isPending} onClick={() => {
                    if (teamSearchPlayerId && teamEditId) {
                      addPlayerToTeam.mutate({ teamId: teamEditId, playerCardId: teamSearchPlayerId });
                      setTeamSearchPlayerId("");
                    }
                  }}>Add</Button>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground border rounded-md p-3 bg-muted/30">
              💡 Save the team first, then edit it to manage the roster.
            </p>
          )}
        </div>
      </FormDialog>

      {/* Team Quick Add Dialog */}
      <FormDialog
        open={teamQuickAddOpen}
        onOpenChange={setTeamQuickAddOpen}
        title="Quick Add Player to Team"
        onSave={() => {
          if (teamQuickAddArchetype && teamEditId) {
            quickAddToTeam.mutate({ teamId: teamEditId, archetype: teamQuickAddArchetype, stars: teamQuickAddStars });
          }
        }}
        saving={quickAddToTeam.isPending}
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Archetype</Label>
            <Select value={teamQuickAddArchetype} onValueChange={setTeamQuickAddArchetype}>
              <SelectTrigger><SelectValue placeholder="Select archetype…" /></SelectTrigger>
              <SelectContent>
                {ARCHETYPE_LIST.map(a => (
                  <SelectItem key={a.name} value={a.name.toLowerCase()}>{a.name} ({a.positions.filter(Boolean).join("/")})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label>Star Rating</Label>
              <span className="font-bold">{teamQuickAddStars}★</span>
            </div>
            <Slider min={0} max={6} step={1} value={[teamQuickAddStars]} onValueChange={([v]) => setTeamQuickAddStars(v)} />
          </div>
        </div>
      </FormDialog>

      {/* Dom dialog */}
      <FormDialog open={domDialog} onOpenChange={setDomDialog} title={domEditId ? "Edit Domination Game" : "Add Domination Game"} onSave={() => domSave.mutate()} saving={domSave.isPending}>
        <div className="space-y-6">
          <div className="space-y-4 p-4 border rounded-lg bg-card">
            <h3 className="font-semibold flex items-center text-sm uppercase tracking-wider text-muted-foreground">Match Setup</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Road Name</Label>
                <Input value={domForm.road_name} onChange={(e) => setDomForm((f) => ({ ...f, road_name: e.target.value }))} placeholder="e.g. Seirin High" />
              </div>
              <div className="space-y-2">
                <Label>Opponent Team</Label>
                <Select
                  value={domForm.opponent_name || "custom"}
                  onValueChange={(val) => {
                    if (val === "custom") {
                      setDomForm(f => ({ ...f, opponent_name: "" }));
                    } else {
                      handleDomTeamSelect(val);
                    }
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Select team…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="custom">Custom name…</SelectItem>
                    {teams.map(t => {
                      const count = teamPlayers.filter(tp => tp.team_id === t.id).length;
                      return <SelectItem key={t.id} value={t.name}>{t.name} ({count} players)</SelectItem>;
                    })}
                  </SelectContent>
                </Select>
                {(!teams.some(t => t.name === domForm.opponent_name) || domForm.opponent_name === "") && (
                  <Input 
                    value={domForm.opponent_name} 
                    onChange={(e) => setDomForm((f) => ({ ...f, opponent_name: e.target.value }))} 
                    placeholder="Type custom name..."
                    className="mt-1"
                  />
                )}
              </div>
              <div className="space-y-2">
                <Label>Game Order</Label>
                <Input type="number" min={1} value={domForm.game_order} onChange={(e) => setDomForm((f) => ({ ...f, game_order: Number(e.target.value) }))} />
              </div>
            </div>
          </div>

          <div className="space-y-4 p-4 border rounded-lg bg-card">
            <div className="flex justify-between items-center">
              <h3 className="font-semibold flex items-center text-sm uppercase tracking-wider text-muted-foreground">Difficulty</h3>
              <span className="font-bold text-lg">{domForm.difficulty_stars} {domForm.difficulty_stars === 1 ? 'Star' : 'Stars'}</span>
            </div>
            <div className="pt-2 pb-4 px-2">
              <Slider 
                min={1} max={5} step={1} 
                value={[domForm.difficulty_stars]} 
                onValueChange={([val]) => setDomForm((f) => ({ ...f, difficulty_stars: val }))} 
              />
            </div>
          </div>

          <div className="space-y-4 p-4 border rounded-lg bg-card">
            <h3 className="font-semibold flex items-center text-sm uppercase tracking-wider text-muted-foreground">Rewards</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Coin Reward</Label>
                <Input type="number" min={0} value={domForm.coin_reward} onChange={(e) => setDomForm((f) => ({ ...f, coin_reward: Number(e.target.value) }))} />
              </div>
              <div className="space-y-2">
                <Label>Pack Reward</Label>
                <Select value={domForm.pack_reward || "none"} onValueChange={(val) => setDomForm(f => ({ ...f, pack_reward: val === "none" ? "" : val }))}>
                  <SelectTrigger><SelectValue placeholder="No Pack Reward" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No Pack</SelectItem>
                    {packs.map(p => (
                      <SelectItem key={p.id} value={p.id}>{p.name} ({p.pack_type})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>
      </FormDialog>

      {/* Run dialog */}
      <FormDialog open={runDialog} onOpenChange={setRunDialog} title={runEditId ? "Edit Run" : "Add Run"} onSave={() => runSave.mutate()} saving={runSave.isPending}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2"><Label>Name</Label><Input value={runForm.name} onChange={(e) => setRunForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. 3v3 Endless" /></div>
            <div className="space-y-2"><Label>Target Score</Label><Input type="number" value={runForm.target_score} onChange={(e) => setRunForm((f) => ({ ...f, target_score: Number(e.target.value) }))} /></div>
          </div>

          {runEditId && (
            <div className="space-y-2 p-4 border rounded-lg bg-card">
              <h3 className="font-semibold flex items-center gap-2 text-sm uppercase tracking-wider text-muted-foreground">
                <Users className="h-3.5 w-3.5" /> Opponent Roster
              </h3>
              <RunRosterManager runId={runEditId} />
            </div>
          )}

          {!runEditId && (
            <p className="text-xs text-muted-foreground border rounded-md p-3 bg-muted/30">
              💡 Save the run first, then edit it to manage the opponent roster.
            </p>
          )}

          <MilestoneEditor
            milestones={Array.isArray(runForm.milestones) ? runForm.milestones as Milestone[] : []}
            onChange={(ms) => setRunForm(f => ({ ...f, milestones: ms }))}
            packs={packs}
          />
        </div>
      </FormDialog>

      <ConfirmDialog open={!!teamDeleteId} onOpenChange={(o) => !o && setTeamDeleteId(null)} title="Delete Team" description="This will permanently delete this team and its roster." onConfirm={() => teamDeleteId && teamDelete.mutate(teamDeleteId)} loading={teamDelete.isPending} />
      <ConfirmDialog open={!!domDeleteId} onOpenChange={(o) => !o && setDomDeleteId(null)} title="Delete Game" description="This will permanently delete this domination game." onConfirm={() => domDeleteId && domDelete.mutate(domDeleteId)} loading={domDelete.isPending} />
      <ConfirmDialog open={!!roadDeleteName} onOpenChange={(o) => !o && setRoadDeleteName(null)} title="Delete Road" description={`This permanently deletes the road "${roadDeleteName ?? ""}" with all of its games and rosters. Player cards are not affected.`} onConfirm={() => roadDeleteName && roadDelete.mutate(roadDeleteName)} loading={roadDelete.isPending} />
      <ConfirmDialog open={!!runDeleteId} onOpenChange={(o) => !o && setRunDeleteId(null)} title="Delete Run" description="This will permanently delete this run." onConfirm={() => runDeleteId && runDelete.mutate(runDeleteId)} loading={runDelete.isPending} />

      <PlayerQuickEdit playerId={quickEditPlayerId} onClose={() => setQuickEditPlayerId(null)} onSwitchPlayer={setQuickEditPlayerId} />
    </div>
  );
}
