import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { userClient, ok, fail } from "../db";

/** Resolve a player by id, card_key or exact name via the database engine. */
async function resolvePlayer(client: any, input: { player_id?: string; card_key?: string; name?: string }) {
  const { data, error } = await client.rpc("admin_resolve_player", {
    p_target: {
      player_id: input.player_id ?? null,
      card_key: input.card_key ?? null,
      player_name: input.name ?? null,
    } as never,
  });
  if (error) return { error: fail(error.message) };
  return { id: data as string };
}

const targetFields = {
  player_id: z.string().uuid().optional(),
  card_key: z.string().optional(),
  name: z.string().optional().describe("Exact display name. Rejected if several cards share it."),
};

const getEvoChain = defineTool({
  name: "getEvoChain",
  title: "Get a card's full evolution chain",
  description:
    "Read-only. Returns the complete evolution sequence a card belongs to — every step in order with its source card, destination card, gem tiers, challenge type/stat/target, stat boosts and new badges — so you can extend or edit the chain without guessing ids.",
  inputSchema: targetFields,
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    const { client, error } = await userClient(ctx);
    if (error) return error;
    const resolved = await resolvePlayer(client, input);
    if ("error" in resolved) return resolved.error;

    const seen = new Set<string>();
    const chain: any[] = [];
    // Walk backwards to the root of the chain.
    let rootId = resolved.id;
    for (let i = 0; i < 25; i++) {
      const { data } = await client.from("evo_paths").select("player_card_id").eq("evolves_to_card_id", rootId).maybeSingle();
      if (!data?.player_card_id || seen.has(data.player_card_id)) break;
      seen.add(data.player_card_id);
      rootId = data.player_card_id;
    }
    // Walk forwards collecting every step.
    let cursor: string | null = rootId;
    const visited = new Set<string>();
    while (cursor && !visited.has(cursor)) {
      visited.add(cursor);
      const { data: steps } = await client
        .from("evo_paths")
        .select(
          "id,step_order,challenge_description,challenge_type,challenge_stat,challenge_target,stat_boosts,new_badges,compound_challenges,from_tier_id,to_tier_id,evolves_to_card_id,player_card_id",
        )
        .eq("player_card_id", cursor)
        .order("step_order");
      if (!steps?.length) break;
      chain.push(...steps);
      cursor = steps[steps.length - 1].evolves_to_card_id;
    }
    const ids = Array.from(new Set([rootId, ...chain.flatMap((s) => [s.player_card_id, s.evolves_to_card_id]).filter(Boolean)]));
    const { data: cards } = await client
      .from("player_cards")
      .select("id,name,card_key,card_variant,evo_stage,rating,gem_tier_id,base_card_id")
      .in("id", ids);
    return ok({ requested_player_id: resolved.id, root_player_id: rootId, steps: chain, cards: cards ?? [] });
  },
});

const getPlayerVersions = defineTool({
  name: "getPlayerVersions",
  title: "List every card sharing a display name",
  description:
    "Read-only. Duplicate display names are legal, so use this before targeting a player by name: it returns every card with that name plus its player_id, card_key, card_variant, evo_stage, rating, gem tier and team, letting you pick the exact card to edit.",
  inputSchema: { name: z.string().min(1).describe("Display name to look up (case-insensitive, exact).") },
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async ({ name }, ctx) => {
    const { client, error } = await userClient(ctx);
    if (error) return error;
    const { data, error: dbError } = await client
      .from("player_cards")
      .select("id,name,card_key,card_variant,evo_stage,base_card_id,rating,gem_tier_id,team_id,position1,position2")
      .ilike("name", name)
      .order("evo_stage");
    if (dbError) return fail(dbError.message);
    return ok({ name, count: data?.length ?? 0, versions: data ?? [] });
  },
});

const getTeamRoster = defineTool({
  name: "getTeamRoster",
  title: "Get a team's roster in slot order",
  description:
    "Read-only. Returns the team plus its roster in slot order with each card's player_id, card_key, name, rating and gem tier — the exact input shape previewTeamBatch expects for a roster replacement.",
  inputSchema: {
    team_id: z.string().uuid().optional(),
    name: z.string().optional().describe("Exact team name."),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    const { client, error } = await userClient(ctx);
    if (error) return error;
    let q = client.from("teams").select("id,name,category,unlock_cost");
    q = input.team_id ? q.eq("id", input.team_id) : q.ilike("name", input.name ?? "");
    const { data: teams } = await q;
    if (!teams?.length) return fail("UNKNOWN_TEAM: no team matched that id or name.");
    if (teams.length > 1) return fail(`AMBIGUOUS_TEAM: matches=${JSON.stringify(teams)}`);
    const team = teams[0];
    const { data: roster } = await client
      .from("team_players")
      .select("slot,player_card_id,player_cards(id,name,card_key,rating,gem_tier_id,position1,position2)")
      .eq("team_id", team.id)
      .order("slot");
    return ok({ team, roster: roster ?? [], roster_size: roster?.length ?? 0 });
  },
});

const getDominationRoad = defineTool({
  name: "getDominationRoad",
  title: "Get a Domination road template",
  description:
    "Read-only. Returns every game on a Domination road in order with difficulty stars, rewards and full opponent rosters — the exact structure previewDominationRoad accepts, so you can edit and send it straight back. Omit road_name to list all road names with their game counts.",
  inputSchema: { road_name: z.string().optional().describe("Road to fetch. Omit to list all roads.") },
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async ({ road_name }, ctx) => {
    const { client, error } = await userClient(ctx);
    if (error) return error;
    if (!road_name) {
      const { data } = await client.from("domination_games").select("road_name");
      const counts = new Map<string, number>();
      for (const r of data ?? []) counts.set(r.road_name, (counts.get(r.road_name) ?? 0) + 1);
      return ok({ roads: Array.from(counts, ([name, games]) => ({ road_name: name, games })) });
    }
    const { data: games } = await client
      .from("domination_games")
      .select("id,game_order,opponent_name,difficulty_stars,coin_reward,pack_reward")
      .ilike("road_name", road_name)
      .order("game_order");
    if (!games?.length) return fail(`UNKNOWN_ROAD: no games found for road "${road_name}".`);
    const { data: rosters } = await client
      .from("domination_game_players")
      .select("domination_game_id,slot,player_card_id,player_cards(id,name,card_key,rating)")
      .in("domination_game_id", games.map((g) => g.id))
      .order("slot");
    return ok({
      road_name,
      games: games.map((g) => ({
        domination_game_id: g.id,
        game_order: g.game_order,
        opponent_name: g.opponent_name,
        difficulty_stars: g.difficulty_stars,
        coin_reward: g.coin_reward,
        pack_reward: g.pack_reward,
        roster: (rosters ?? [])
          .filter((r) => r.domination_game_id === g.id)
          .map((r) => ({ player_id: r.player_card_id, card_key: (r as any).player_cards?.card_key, name: (r as any).player_cards?.name })),
      })),
    });
  },
});

const getBatchReferences = defineTool({
  name: "getBatchReferences",
  title: "Get ids and keys for batch payloads",
  description:
    "Read-only. Returns the immutable identifiers batch tools accept: gem tiers, teams, collections, sub-collections, badges, signature traits, packs, runs, roads and (optionally) player cards with player_id + card_key. Call this before building a batch so every reference is an id or card_key rather than a fuzzy name.",
  inputSchema: {
    include_players: z.boolean().default(false).describe("Include player cards (id, card_key, name, rating). Large."),
    player_search: z.string().optional().describe("Only players whose name contains this text."),
    limit: z.number().int().min(1).max(500).default(200),
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
  handler: async ({ include_players, player_search, limit }, ctx) => {
    const { client, error } = await userClient(ctx);
    if (error) return error;
    const grab = async (table: string, cols: string) => (await client.from(table).select(cols).limit(500)).data ?? [];
    const payload: Record<string, unknown> = {
      gem_tiers: await grab("gem_tiers", "id,name,stars,gem_value"),
      teams: await grab("teams", "id,name,category"),
      collections: await grab("collections", "id,name"),
      sub_collections: await grab("sub_collections", "id,name,collection_id"),
      badges: await grab("badges", "id,name,abbreviation"),
      signature_traits: await grab("signature_traits", "id,name,abbreviation"),
      packs: await grab("packs", "id,name,pack_type"),
      runs: await grab("runs", "id,name,target_score"),
      challenge_types: ["points_scored", "games_won", "total_stat", "single_game_stat", "multi_condition"],
    };
    if (include_players) {
      let q = client.from("player_cards").select("id,card_key,name,card_variant,evo_stage,rating").order("name").limit(limit);
      if (player_search) q = q.ilike("name", `%${player_search}%`);
      payload.player_cards = (await q).data ?? [];
    }
    return ok(payload);
  },
});

export const planningReadTools = [getEvoChain, getPlayerVersions, getTeamRoster, getDominationRoad, getBatchReferences];
