import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { applyContent } from "../db";

const mode = z
  .enum(["preview", "commit"])
  .default("preview")
  .describe("`preview` validates and returns the exact plan without writing. `commit` applies it.");

const boosts = z
  .record(z.string(), z.number())
  .describe("Stat boosts keyed by stat_3pt, stat_mid, stat_fin, stat_dnk, stat_ast, stat_stl, stat_reb, stat_blk, stat_int.");

export default defineTool({
  name: "upsert_dynamic_duo",
  title: "Create or update a dynamic duo",
  description:
    "Admin only. Create or update a dynamic duo by name: the two player cards (resolved by name), the stat boosts each one receives while both are on the floor, and whether the duo is active. Unknown boost keys or player names fail without writing. Always call with mode='preview' first.",
  inputSchema: {
    mode,
    name: z.string().min(1).describe("Duo name (match key)."),
    description: z.string().nullable().optional(),
    player_a: z.string().optional().describe("First player card name (required when creating)."),
    player_b: z.string().optional().describe("Second player card name (required when creating)."),
    boosts_a: boosts.optional().describe("Boosts applied to player A."),
    boosts_b: boosts.optional().describe("Boosts applied to player B."),
    is_active: z.boolean().optional().describe("Whether the duo is live in games."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ mode: m, ...payload }, ctx) => applyContent(ctx, "dynamic_duo", payload, m),
});
