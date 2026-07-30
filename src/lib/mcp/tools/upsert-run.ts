import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { applyContent } from "../db";

const mode = z
  .enum(["preview", "commit"])
  .default("preview")
  .describe("`preview` validates and returns the exact plan without writing. `commit` applies it.");

export default defineTool({
  name: "upsert_run",
  title: "Create or update a Run",
  description:
    "Admin only. Create or update a 3v3 Run: target score, milestone ladder, the Run's opponent roster, and optionally the global rank-reward ladder. Roster and rank rewards are full replacements. Always call with mode='preview' first.",
  inputSchema: {
    mode,
    name: z.string().min(1).describe("Run name (match key)."),
    target_score: z.number().int().min(1).optional().describe("Score the Run races to (default 21)."),
    team: z.string().optional().describe("Optional team name to link the Run to."),
    milestones: z
      .array(z.record(z.string(), z.any()))
      .optional()
      .describe("Milestone ladder as stored in runs.milestones (e.g. { wins_required, coin_reward, gem_reward, pack_reward }). Replaces the whole array."),
    roster: z
      .array(z.string())
      .optional()
      .describe("DESTRUCTIVE: replaces the Run's opponent roster with these player card names. Run stats are copied from each card's run_* values (falling back to base stats)."),
    rank_rewards: z
      .array(
        z.object({
          rank_name: z.string(),
          wins_required: z.number().int().min(0),
          coin_reward: z.number().int().min(0).optional(),
          gem_reward: z.number().int().min(0).optional(),
          pack_reward: z.string().optional(),
          sort_order: z.number().int().optional(),
        }),
      )
      .optional()
      .describe("DESTRUCTIVE and GLOBAL: run_rank_rewards is one ladder shared by every Run. Sending this replaces the entire ladder."),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  handler: async ({ mode: m, ...payload }, ctx) => applyContent(ctx, "run", payload, m),
});
