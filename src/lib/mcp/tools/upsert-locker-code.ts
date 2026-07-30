import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { applyContent } from "../db";

const mode = z
  .enum(["preview", "commit"])
  .default("preview")
  .describe("`preview` validates and returns the exact plan without writing. `commit` applies it.");

export default defineTool({
  name: "upsert_locker_code",
  title: "Create or update a locker code",
  description:
    "Admin only. Create or update a locker code (matched on the code, case-insensitive): reward payload, redemption limit and expiry. Reward payloads are validated and normalised to the shape the redeem flow expects — pass `pack_name` or `card_name` and they are resolved to ids. Always call with mode='preview' first.",
  inputSchema: {
    mode,
    code: z.string().min(1).describe("The code itself (stored uppercase)."),
    reward_type: z.enum(["coins", "gems", "pack", "card"]).describe("What the code grants."),
    reward_value: z
      .object({
        amount: z.number().int().positive().optional().describe("For coins / gems."),
        pack_name: z.string().optional().describe("For a pack reward; resolved to pack_id."),
        card_name: z.string().optional().describe("For a card reward; resolved to player_card_id."),
      })
      .describe("Reward payload matching reward_type."),
    max_redemptions: z.number().int().min(1).nullable().optional().describe("Redemption cap, or null for unlimited."),
    expires_at: z.string().nullable().optional().describe("ISO timestamp, or null for no expiry."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ mode: m, ...payload }, ctx) => applyContent(ctx, "locker_code", payload, m),
});
