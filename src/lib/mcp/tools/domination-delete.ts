import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { adminClient, clean, ok, fail } from "../db";
import { structuredError } from "../batch";

const targetFields = {
  domination_game_id: z
    .string()
    .uuid()
    .optional()
    .describe("Preferred: the immutable id of the game to delete (see getDominationRoad)."),
  road_name: z.string().optional().describe("Fallback target, together with game_order."),
  game_order: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Fallback target, together with road_name. Opponent name alone is never accepted."),
};

async function run(
  ctx: Parameters<typeof adminClient>[0],
  input: Record<string, unknown>,
  commit: boolean,
  previewToken?: string,
) {
  const { client, error } = await adminClient(ctx);
  if (error) return error;
  if (commit && !previewToken) {
    return fail(
      JSON.stringify({
        error_code: "PREVIEW_REQUIRED",
        message: "Call previewDeleteDominationGame first, get user approval, then commit with its preview_token.",
      }),
    );
  }
  const { data, error: dbError } = await client.rpc("admin_delete_domination_game", {
    p_payload: clean(input) as never,
    p_commit: commit,
    p_preview_token: previewToken ?? null,
  });
  if (dbError) return fail(structuredError(dbError.message, commit ? "commit" : "preview"));
  return ok(data);
}

const previewDeleteDominationGame = defineTool({
  name: "previewDeleteDominationGame",
  title: "Preview: delete one Domination game",
  description:
    "Admin only. ZERO WRITES. Resolves a single Domination game by domination_game_id (preferred) or by exact road_name + game_order, and returns exactly what deleting it would remove: the game's id, road, game_order, opponent and its ordered roster junction rows, plus a one-time preview_token. Deleting by opponent name alone is rejected, because rematches mean one opponent can appear several times on a road. Nothing is removed until commitDeleteDominationGame is called with the identical target and that token.",
  inputSchema: targetFields,
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  handler: async (input, ctx) => run(ctx, input as Record<string, unknown>, false),
});

const commitDeleteDominationGame = defineTool({
  name: "commitDeleteDominationGame",
  title: "Commit: delete one Domination game",
  description:
    "Admin only. DESTRUCTIVE. Deletes the previewed Domination game and its roster junction rows in one transaction. Requires the unexpired, unused preview_token from previewDeleteDominationGame for the same game; any mismatch is rejected with PREVIEW_MISMATCH and nothing is deleted.",
  inputSchema: {
    ...targetFields,
    preview_token: z.string().describe("The preview_token from previewDeleteDominationGame. Single use."),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  handler: async (input, ctx) => {
    const { preview_token, ...rest } = input as Record<string, unknown> & { preview_token: string };
    return run(ctx, rest, true, preview_token);
  },
});

export const dominationDeleteTools = [previewDeleteDominationGame, commitDeleteDominationGame];
