import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { applyContent } from "../db";

const mode = z
  .enum(["preview", "commit"])
  .default("preview")
  .describe("`preview` validates and returns the exact plan without writing. `commit` applies it.");

export default defineTool({
  name: "upsert_team",
  title: "Create or update a team",
  description:
    "Admin only. Create or update a team by name and optionally REPLACE its ordered roster with the given player card names. Player names must already exist (create them with create_players first). Always call with mode='preview' first.",
  inputSchema: {
    mode,
    name: z.string().min(1).describe("Team name (match key)."),
    category: z.string().optional().describe("Team category, e.g. domination / run / challenge."),
    unlock_cost: z.number().int().min(0).optional().describe("Coin cost to unlock the team."),
    roster: z
      .array(z.string())
      .optional()
      .describe("DESTRUCTIVE: replaces the whole team roster with these player card names, in slot order. Omit to leave the roster untouched."),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  handler: async ({ mode: m, ...payload }, ctx) => applyContent(ctx, "team", payload, m),
});
