import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { applyContent } from "../db";

const mode = z
  .enum(["preview", "commit"])
  .default("preview")
  .describe("`preview` validates and returns the exact plan without writing. `commit` applies it.");

export default defineTool({
  name: "upsert_domination_game",
  title: "Create or update a Domination game",
  description:
    "Admin only. Create or update a Domination game, matched on road_name + opponent_name: game order, difficulty stars, coin/pack rewards, and optionally its ordered roster (full replacement). Always call with mode='preview' first.",
  inputSchema: {
    mode,
    road_name: z.string().min(1).describe("Road / path the game belongs to."),
    opponent_name: z.string().min(1).describe("Opponent name (match key together with road_name)."),
    game_order: z.number().int().min(1).optional().describe("Position of the game on the road."),
    difficulty_stars: z.number().int().min(1).max(5).optional().describe("Difficulty in stars."),
    coin_reward: z.number().int().min(0).optional().describe("Coins awarded for winning."),
    pack_reward: z.string().nullable().optional().describe("Pack reward identifier, or null to clear it."),
    roster: z
      .array(z.string())
      .optional()
      .describe("DESTRUCTIVE: replaces the opponent roster with these player card names, in slot order."),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  handler: async ({ mode: m, ...payload }, ctx) => applyContent(ctx, "domination_game", payload, m),
});
