import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { applyContent } from "../db";

const mode = z
  .enum(["preview", "commit"])
  .default("preview")
  .describe("`preview` validates and returns the exact plan without writing. `commit` applies it.");

export default defineTool({
  name: "upsert_pack",
  title: "Create or update a pack",
  description:
    "Admin only. Create or update a pack: cost, ten-box cost, pack type, its player pool (one slot per listed card) and its odds table. Odds are validated the way the pack-opening flow reads them: percentages must total 100, every entry must be above 0, and each result_slot must be `player_choice` or an existing pool slot number. Pool and odds are full replacements. Always call with mode='preview' first.",
  inputSchema: {
    mode,
    name: z.string().min(1).describe("Pack name (match key)."),
    pack_type: z.string().optional().describe("Pack type, e.g. standard / premium / promo."),
    cost: z.number().int().min(0).optional().describe("Coin cost for a single open."),
    ten_box_cost: z.number().int().min(0).nullable().optional().describe("Coin cost for a ten-box, or null."),
    players: z
      .array(z.string())
      .optional()
      .describe("DESTRUCTIVE: replaces the pack pool. Player card names; the first name becomes slot 1, the second slot 2, and so on."),
    odds: z
      .array(
        z.object({
          result_slot: z.string().describe("Pool slot number as a string, or `player_choice`."),
          percentage: z.number().positive().describe("Chance for this slot; all entries must sum to 100."),
          description: z.string().optional().describe("Label shown in the odds table."),
        }),
      )
      .optional()
      .describe("DESTRUCTIVE: replaces the pack's odds rows."),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  handler: async ({ mode: m, ...payload }, ctx) => applyContent(ctx, "pack", payload, m),
});
