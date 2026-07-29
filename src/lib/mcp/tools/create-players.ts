import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { ok, fail, adminClient } from "../db";

const StatSchema = z.number().min(0).max(150);

export default defineTool({
  name: "create_players",
  title: "Create players",
  description:
    "Admin only. Create player cards. Gem tier and team are resolved by name, so you can say `gem_tier: \"Diamond\"` instead of an id. Ratings accept decimals.",
  inputSchema: {
    players: z
      .array(
        z.object({
          name: z.string().describe("Card name (must be unique-ish; existing names are reported back)."),
          gem_tier: z.string().optional().describe("Gem tier name, e.g. Emerald / Diamond."),
          team: z.string().optional().describe("Team name to attach the card to."),
          position1: z.string().optional(),
          position2: z.string().optional(),
          rating: z.number().optional().describe("Overall rating, decimals allowed (e.g. 87.4)."),
          stat_3pt: StatSchema.optional(),
          stat_mid: StatSchema.optional(),
          stat_fin: StatSchema.optional(),
          stat_dnk: StatSchema.optional(),
          stat_ast: StatSchema.optional(),
          stat_stl: StatSchema.optional(),
          stat_reb: StatSchema.optional(),
          stat_blk: StatSchema.optional(),
          stat_int: StatSchema.optional(),
          market_value: z.number().optional(),
          social_handle: z.string().optional(),
          card_animation: z.string().optional().describe("e.g. none / pulse / shimmer / glow."),
        }),
      )
      .describe("Players to create."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ players }, ctx) => {
    const { client, error } = await adminClient(ctx);
    if (error) return error;
    if (!players.length) return fail("No players supplied.");

    const [{ data: tiers }, { data: teams }] = await Promise.all([
      client.from("gem_tiers").select("id, name"),
      client.from("teams").select("id, name"),
    ]);
    const tierByName = new Map((tiers ?? []).map((t: any) => [String(t.name).toLowerCase(), t.id]));
    const teamByName = new Map((teams ?? []).map((t: any) => [String(t.name).toLowerCase(), t.id]));

    const unresolved: string[] = [];
    const rows = players.map((p) => {
      const { gem_tier, team, ...rest } = p;
      const gem_tier_id = gem_tier ? tierByName.get(gem_tier.toLowerCase()) : undefined;
      const team_id = team ? teamByName.get(team.toLowerCase()) : undefined;
      if (gem_tier && !gem_tier_id) unresolved.push(`gem tier "${gem_tier}" (${p.name})`);
      if (team && !team_id) unresolved.push(`team "${team}" (${p.name})`);
      return { ...rest, gem_tier_id: gem_tier_id ?? null, team_id: team_id ?? null };
    });

    const { data, error: dbError } = await client.from("player_cards").insert(rows).select("id, name, rating");
    if (dbError) return fail(dbError.message);
    return ok({ created: data?.length ?? 0, players: data ?? [], unresolved_references: unresolved });
  },
});
