import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { adminClient, clean, ok, fail } from "../db";
import { structuredError } from "../batch";

const mode = z
  .enum(["preview", "commit"])
  .default("preview")
  .describe("`preview` validates and returns the exact plan without writing. `commit` applies it.");

export default defineTool({
  name: "upsert_domination_game",
  title: "Create or update one Domination game",
  description:
    "Admin only. Create or update a SINGLE Domination game, targeted by domination_game_id (preferred) or by road_name + game_order. Opponent name is never a target, so rematches (the same opponent at several game_orders on one road) are fully supported and never overwrite each other. Sets game order, opponent, opponent_team_id, difficulty stars, coin reward, pack_reward_id, and optionally the ordered roster (destructive full replacement for this game only). Always call with mode='preview' first and show the plan. For whole roads use previewDominationRoad instead.",
  inputSchema: {
    mode,
    domination_game_id: z.string().uuid().optional().describe("Immutable id of an existing game."),
    road_name: z.string().min(1).describe("Road the game belongs to."),
    game_order: z
      .number()
      .int()
      .min(1)
      .describe("Position on the road; required, and used as the target when no id is given."),
    opponent_name: z.string().optional().describe("Opponent display name; duplicates on a road are allowed."),
    opponent_team_id: z.string().uuid().optional().describe("Optional link to a teams row."),
    difficulty_stars: z.number().int().min(1).max(5).optional().describe("Difficulty in stars."),
    coin_reward: z.number().int().min(0).optional().describe("Coins awarded for winning."),
    pack_reward_id: z.string().uuid().nullable().optional().describe("Pack reward by immutable id; null clears it."),
    pack_reward: z
      .string()
      .nullable()
      .optional()
      .describe("Legacy: pack id or exact unique pack name. Ambiguous names are rejected with AMBIGUOUS_PACK."),
    roster: z
      .array(z.any())
      .optional()
      .describe(
        "DESTRUCTIVE: replaces this game's roster, in slot order. Entries may be { player_id } | { card_key } | { player_name }.",
      ),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  handler: async ({ mode: m, road_name, ...game }, ctx) => {
    const { client, error } = await adminClient(ctx);
    if (error) return error;
    const { data, error: dbError } = await client.rpc("admin_apply_extra", {
      p_kind: "domination_road",
      p_payload: { road_name, games: [clean(game)] } as never,
      p_commit: m === "commit",
    });
    if (dbError) return fail(structuredError(dbError.message, m));
    return ok(data);
  },
});
