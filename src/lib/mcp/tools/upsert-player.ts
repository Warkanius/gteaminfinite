import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { adminClient, clean, ok, fail } from "../db";

const TIERS = ["base", "gold", "hof", "diamond", "actolytrene"] as const;
const STATS = [
  "stat_3pt", "stat_mid", "stat_fin", "stat_dnk", "stat_ast", "stat_stl", "stat_reb", "stat_blk", "stat_int",
] as const;

const statFields = Object.fromEntries(STATS.map((s) => [s, z.number().min(0).max(150).optional()])) as Record<
  (typeof STATS)[number],
  z.ZodOptional<z.ZodNumber>
>;
const runStatFields = Object.fromEntries(
  STATS.map((s) => [s.replace("stat_", "run_stat_"), z.number().int().min(0).max(150).optional()]),
) as Record<string, z.ZodOptional<z.ZodNumber>>;

export default defineTool({
  name: "upsert_player",
  title: "Create or update a player card",
  description:
    "Admin only. Create or update one player card atomically, matched on `name`. Gem tier, team, collection, sub-collection, badges and signature traits are resolved by exact name; an unknown or ambiguous reference fails with zero writes. Sending `badges` or `traits` REPLACES all of that card's assignments. Always call with mode='preview' first.",
  inputSchema: {
    mode: z
      .enum(["preview", "commit"])
      .default("preview")
      .describe("`preview` validates and returns the exact plan without writing. `commit` applies it."),
    name: z.string().min(1).describe("Existing card name to edit, or the name of the new card."),
    new_name: z.string().optional().describe("Rename the card."),
    gem_tier: z.string().optional(),
    gem_name: z.string().nullable().optional(),
    team: z.string().optional(),
    collection: z.string().optional(),
    sub_collection: z.string().optional(),
    position1: z.string().nullable().optional(),
    position2: z.string().nullable().optional(),
    rating: z.number().optional().describe("Decimals preserved, e.g. 87.4."),
    run_rating: z.number().int().nullable().optional(),
    ...statFields,
    ...runStatFields,
    market_value: z.number().int().optional(),
    social_handle: z.string().nullable().optional(),
    avatar_url: z.string().nullable().optional(),
    is_collection_reward: z.boolean().optional(),
    card_color_primary: z.string().nullable().optional(),
    card_color_secondary: z.string().nullable().optional(),
    card_glow_color: z.string().nullable().optional(),
    card_animation: z.string().nullable().optional(),
    badges: z
      .array(z.object({ badge: z.string(), tier: z.enum(TIERS).optional() }))
      .optional()
      .describe("DESTRUCTIVE: replaces every badge assignment on this card."),
    traits: z
      .array(z.object({ trait: z.string(), tier: z.enum(TIERS).optional(), target_stat: z.enum(STATS).nullable().optional() }))
      .optional()
      .describe("DESTRUCTIVE: replaces every signature-trait assignment on this card."),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  handler: async ({ mode, ...payload }, ctx) => {
    const { client, error } = await adminClient(ctx);
    if (error) return error;
    const { data, error: dbError } = await client.rpc("admin_apply_player", {
      p_payload: clean(payload),
      p_commit: mode === "commit",
    });
    if (dbError) return fail(`${mode === "commit" ? "Commit" : "Preview"} failed (nothing was written): ${dbError.message}`);
    return ok(data);
  },
});
