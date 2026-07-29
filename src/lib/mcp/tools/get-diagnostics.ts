import { defineTool } from "@lovable.dev/mcp-js";
import { ok, userClient } from "../db";

export default defineTool({
  name: "get_diagnostics",
  title: "Get content diagnostics",
  description:
    "Reports incomplete content: unrated players, teams with fewer than 3 cards, runs with no opponent roster, and domination games with no roster. Call this first when asked to fill gaps.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    const { client, error } = await userClient(ctx);
    if (error) return error;

    const [players, teams, teamPlayers, runs, runPlayers, doms, domPlayers] = await Promise.all([
      client.from("player_cards").select("id, name, rating, stat_3pt, stat_fin, stat_mid"),
      client.from("teams").select("id, name"),
      client.from("team_players").select("team_id"),
      client.from("runs").select("id, name"),
      client.from("run_players").select("run_id"),
      client.from("domination_games").select("id, road_name, opponent_name"),
      client.from("domination_game_players").select("domination_game_id"),
    ]);

    const countBy = (rows: any[] | null, key: string) => {
      const map = new Map<string, number>();
      (rows ?? []).forEach((r) => map.set(r[key], (map.get(r[key]) ?? 0) + 1));
      return map;
    };

    const teamCounts = countBy(teamPlayers.data, "team_id");
    const runCounts = countBy(runPlayers.data, "run_id");
    const domCounts = countBy(domPlayers.data, "domination_game_id");

    const unrated = (players.data ?? [])
      .filter((p: any) => !p.rating && !p.stat_3pt && !p.stat_fin && !p.stat_mid)
      .map((p: any) => p.name);

    const payload = {
      unrated_players: unrated,
      incomplete_team_rosters: (teams.data ?? [])
        .map((t: any) => ({ name: t.name, cards: teamCounts.get(t.id) ?? 0 }))
        .filter((t) => t.cards < 3),
      incomplete_runs: (runs.data ?? [])
        .map((r: any) => ({ name: r.name, opponents: runCounts.get(r.id) ?? 0 }))
        .filter((r) => r.opponents < 3),
      incomplete_domination_paths: (doms.data ?? [])
        .map((d: any) => ({
          road: d.road_name,
          opponent: d.opponent_name,
          cards: domCounts.get(d.id) ?? 0,
        }))
        .filter((d) => d.cards < 3),
    };

    return ok({
      ...payload,
      summary: {
        unrated_players: payload.unrated_players.length,
        incomplete_team_rosters: payload.incomplete_team_rosters.length,
        incomplete_runs: payload.incomplete_runs.length,
        incomplete_domination_paths: payload.incomplete_domination_paths.length,
      },
    });
  },
});
