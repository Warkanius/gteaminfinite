import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { applyContent } from "../db";

const mode = z
  .enum(["preview", "commit"])
  .default("preview")
  .describe("`preview` validates and returns the exact plan without writing. `commit` applies it.");

export default defineTool({
  name: "upsert_challenge",
  title: "Create or update a challenge",
  description:
    "Admin only. Create or update a challenge by name: opponent team, win condition and series setup, stat limits, lineup restrictions, timing, prerequisite, and coin / gem / pack / card rewards. Team, player and prerequisite names are resolved to ids and an unknown name fails without writing. Always call with mode='preview' first.",
  inputSchema: {
    mode,
    name: z.string().min(1).describe("Challenge name (match key)."),
    description: z.string().nullable().optional(),
    challenge_type: z.string().optional().describe("e.g. single / series / stat_limit / spotlight."),
    opponent_team: z.string().optional().describe("Team name to face."),
    win_condition: z.string().optional().describe("e.g. win / win_by / stat_limit."),
    win_by_amount: z.number().int().nullable().optional(),
    series_length: z.number().int().nullable().optional(),
    series_win_coins: z.number().int().min(0).optional(),
    series_loss_coins: z.number().int().min(0).optional(),
    stat_limit_player: z.string().nullable().optional().describe("Player card name the stat limit applies to."),
    stat_limit_stat: z.string().nullable().optional().describe("Stat key, e.g. stat_3pt."),
    stat_limit_value: z.number().int().nullable().optional(),
    coin_reward: z.number().int().min(0).optional(),
    gem_reward: z.number().int().min(0).optional(),
    pack_reward: z.string().nullable().optional().describe("Pack name (resolved to its id) or an existing literal value."),
    card_reward: z.string().nullable().optional().describe("Player card name granted on completion."),
    prerequisite: z.string().nullable().optional().describe("Name of the challenge that must be completed first."),
    spotlight_group: z.string().nullable().optional(),
    sort_order: z.number().int().optional(),
    lineup_restrictions: z
      .record(z.string(), z.any())
      .nullable()
      .optional()
      .describe("Restrictions object as used by the admin UI (positions, badge_ids, trait_ids, gem_tier_ids, team_ids, collection_ids, sub_collection_ids, card_colors)."),
    is_repeatable: z.boolean().optional(),
    expires_at: z.string().nullable().optional().describe("ISO timestamp, or null for no expiry."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ mode: m, ...payload }, ctx) => applyContent(ctx, "challenge", payload, m),
});
