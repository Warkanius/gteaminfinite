import { defineTool } from "@lovable.dev/mcp-js";
import { ok, userClient } from "../db";

export default defineTool({
  name: "get_diagnostics",
  title: "Get content diagnostics",
  description:
    "Reports incomplete or broken content: unrated players, teams with fewer than 3 cards, Runs with no opponent roster, Domination games with no roster, packs with no pool or no odds or odds that do not total 100, locker codes with malformed reward payloads, and storylines whose linked entities no longer exist. Call this first when asked to fill gaps.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    const { client, error } = await userClient(ctx);
    if (error) return error;

    const [
      players,
      teams,
      teamPlayers,
      runs,
      runPlayers,
      doms,
      domPlayers,
      packs,
      packPlayers,
      packOdds,
      codes,
      storylines,
      links,
      roads,
    ] = await Promise.all([
      client.from("player_cards").select("id, name, rating, stat_3pt, stat_fin, stat_mid"),
      client.from("teams").select("id, name"),
      client.from("team_players").select("team_id"),
      client.from("runs").select("id, name"),
      client.from("run_players").select("run_id"),
      client.from("domination_games").select("id, road_id, road_name, opponent_name, game_order, pack_reward_id"),
      client.from("domination_game_players").select("domination_game_id"),
      client.from("packs").select("id, name, pack_type"),
      client.from("pack_players").select("pack_id, slot_number"),
      client.from("pack_odds").select("pack_id, pack_type, result_slot, percentage"),
      client.from("locker_codes").select("id, code, reward_type, reward_value"),
      client.from("storylines").select("id, title"),
      client.from("storyline_entities").select("storyline_id, entity_type, entity_id"),
      client.from("domination_roads").select("id, name, is_active, sort_order"),
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

    // ---- packs ----
    const poolSlots = new Map<string, Set<number>>();
    (packPlayers.data ?? []).forEach((r: any) => {
      if (!poolSlots.has(r.pack_id)) poolSlots.set(r.pack_id, new Set());
      poolSlots.get(r.pack_id)!.add(r.slot_number);
    });
    const oddsByPack = new Map<string, any[]>();
    const oddsByType = new Map<string, any[]>();
    (packOdds.data ?? []).forEach((r: any) => {
      if (r.pack_id) {
        if (!oddsByPack.has(r.pack_id)) oddsByPack.set(r.pack_id, []);
        oddsByPack.get(r.pack_id)!.push(r);
      } else if (r.pack_type) {
        if (!oddsByType.has(r.pack_type)) oddsByType.set(r.pack_type, []);
        oddsByType.get(r.pack_type)!.push(r);
      }
    });

    const brokenPacks = (packs.data ?? [])
      .map((p: any) => {
        const slots = poolSlots.get(p.id) ?? new Set<number>();
        const odds = oddsByPack.get(p.id) ?? oddsByType.get(p.pack_type) ?? [];
        const issues: string[] = [];
        if (slots.size === 0) issues.push("no player pool");
        if (odds.length === 0) issues.push("no odds rows");
        if (odds.length) {
          const total = odds.reduce((s: number, o: any) => s + Number(o.percentage ?? 0), 0);
          if (Math.abs(total - 100) > 0.01) issues.push(`odds total ${total} instead of 100`);
          odds.forEach((o: any) => {
            const slot = String(o.result_slot ?? "");
            if (slot !== "player_choice" && /^[0-9]+$/.test(slot) && slots.size && !slots.has(Number(slot))) {
              issues.push(`odds slot ${slot} has no cards`);
            }
            if (slot !== "player_choice" && !/^[0-9]+$/.test(slot)) issues.push(`invalid result_slot "${slot}"`);
          });
        }
        return { name: p.name, issues };
      })
      .filter((p) => p.issues.length);

    // ---- locker codes ----
    const malformedCodes = (codes.data ?? [])
      .map((c: any) => {
        const v = c.reward_value ?? {};
        const issues: string[] = [];
        if (!["coins", "gems", "pack", "card"].includes(c.reward_type)) issues.push(`unknown reward_type "${c.reward_type}"`);
        if (["coins", "gems"].includes(c.reward_type) && !(Number(v.amount) > 0)) issues.push("missing reward_value.amount");
        if (c.reward_type === "pack" && !v.pack_id) issues.push("missing reward_value.pack_id");
        if (c.reward_type === "card" && !v.player_card_id) issues.push("missing reward_value.player_card_id");
        return { code: c.code, issues };
      })
      .filter((c) => c.issues.length);

    // ---- storyline links ----
    const known: Record<string, Set<string>> = {
      player: new Set((players.data ?? []).map((p: any) => p.id)),
      locker_code: new Set((codes.data ?? []).map((c: any) => c.id)),
    };
    const storyNames = new Map((storylines.data ?? []).map((s: any) => [s.id, s.title]));
    const brokenLinks: { storyline: string; entity_type: string; entity_id: string }[] = [];
    (links.data ?? []).forEach((l: any) => {
      const set = known[l.entity_type];
      if (set && !set.has(l.entity_id)) {
        brokenLinks.push({
          storyline: storyNames.get(l.storyline_id) ?? l.storyline_id,
          entity_type: l.entity_type,
          entity_id: l.entity_id,
        });
      }
    });

    // ---- domination roads ----
    const brokenRoads = (roads.data ?? [])
      .map((r: any) => {
        const mine = (doms.data ?? []).filter((g: any) => g.road_id === r.id);
        const orders = mine.map((g: any) => g.game_order).sort((a: number, b: number) => a - b);
        const issues: string[] = [];
        if (!orders.length) issues.push("road has no games");
        else {
          if (orders[0] !== 1) issues.push(`game_order starts at ${orders[0]} instead of 1`);
          const gaps: number[] = [];
          for (let i = orders[0]; i <= orders[orders.length - 1]; i++) if (!orders.includes(i)) gaps.push(i);
          if (gaps.length) issues.push(`missing game_order ${gaps.join(", ")}`);
          const dupes = orders.filter((o: number, i: number) => orders.indexOf(o) !== i);
          if (dupes.length) issues.push(`duplicate game_order ${Array.from(new Set(dupes)).join(", ")}`);
          const noPack = mine.filter((g: any) => !g.pack_reward_id).map((g: any) => g.game_order);
          if (noPack.length) issues.push(`no pack_reward_id on game_order ${noPack.sort((a, b) => a - b).join(", ")}`);
          const emptyRosters = mine.filter((g: any) => (domCounts.get(g.id) ?? 0) === 0).map((g: any) => g.game_order);
          if (emptyRosters.length) issues.push(`empty roster on game_order ${emptyRosters.sort((a, b) => a - b).join(", ")}`);
        }
        return { road_id: r.id, road_name: r.name, games: orders.length, is_active: r.is_active, issues };
      })
      .filter((r) => r.issues.length);

    const orphanGames = (doms.data ?? [])
      .filter((g: any) => !(roads.data ?? []).some((r: any) => r.id === g.road_id))
      .map((g: any) => ({ domination_game_id: g.id, road_name: g.road_name, game_order: g.game_order }));

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
      broken_domination_roads: brokenRoads,
      orphaned_domination_games: orphanGames,
      broken_packs: brokenPacks,
      malformed_locker_codes: malformedCodes,
      broken_storyline_links: brokenLinks,
    };

    return ok({
      ...payload,
      summary: {
        unrated_players: payload.unrated_players.length,
        incomplete_team_rosters: payload.incomplete_team_rosters.length,
        incomplete_runs: payload.incomplete_runs.length,
        incomplete_domination_paths: payload.incomplete_domination_paths.length,
        broken_domination_roads: payload.broken_domination_roads.length,
        orphaned_domination_games: payload.orphaned_domination_games.length,
        broken_packs: payload.broken_packs.length,
        malformed_locker_codes: payload.malformed_locker_codes.length,
        broken_storyline_links: payload.broken_storyline_links.length,
      },
    });
  },
});
