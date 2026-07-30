import { defineTool } from "@lovable.dev/mcp-js";
import { ok, userClient } from "../db";

export default defineTool({
  name: "get_references",
  title: "Get reference names",
  description:
    "Returns the exact names/handles the write tools accept: gem tiers, teams, packs, collections and sub-collections, badges, signature traits, media (location) accounts, storylines, challenges, runs, domination roads, and rule_config keys, plus the full player card name list. Call this before writing so every reference resolves.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    const { client, error } = await userClient(ctx);
    if (error) return error;

    const [tiers, teams, packs, collections, subs, badges, traits, accounts, storylines, challenges, runs, doms, rules, players] =
      await Promise.all([
        client.from("gem_tiers").select("name, stars, gem_value, sort_order").order("sort_order"),
        client.from("teams").select("name, category, unlock_cost").order("name"),
        client.from("packs").select("name, pack_type, cost, ten_box_cost").order("name"),
        client.from("collections").select("name, reward_type").order("name"),
        client.from("sub_collections").select("name, collection_id").order("name"),
        client.from("badges").select("name, abbreviation, effect_type").order("name"),
        client.from("signature_traits").select("name, abbreviation, condition_type").order("name"),
        client.from("location_accounts").select("name, handle, personality, location_type, is_active").order("name"),
        client.from("storylines").select("title, status").order("title"),
        client.from("challenges").select("name, challenge_type").order("name"),
        client.from("runs").select("name, target_score").order("name"),
        client.from("domination_games").select("road_name, opponent_name, game_order").order("road_name"),
        client.from("rule_config").select("key, description").order("key"),
        client.from("player_cards").select("name, rating, gem_name").order("name").limit(2000),
      ]);

    return ok({
      gem_tiers: tiers.data ?? [],
      teams: teams.data ?? [],
      packs: packs.data ?? [],
      collections: collections.data ?? [],
      sub_collections: subs.data ?? [],
      badges: badges.data ?? [],
      signature_traits: traits.data ?? [],
      media_accounts: accounts.data ?? [],
      storylines: storylines.data ?? [],
      challenges: challenges.data ?? [],
      runs: runs.data ?? [],
      domination_games: doms.data ?? [],
      rule_config_keys: rules.data ?? [],
      player_cards: players.data ?? [],
      counts: {
        player_cards: players.data?.length ?? 0,
        teams: teams.data?.length ?? 0,
        packs: packs.data?.length ?? 0,
      },
    });
  },
});
