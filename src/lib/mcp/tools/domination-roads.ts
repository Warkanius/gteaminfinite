import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { adminClient, clean, ok, fail, userClient } from "../db";
import { structuredError } from "../batch";

/**
 * Road-level tools. A Domination road is now a real row in `domination_roads`;
 * every game carries `road_id`, so roads can be renamed, reordered, bulk
 * imported, replaced wholesale and deleted without touching game identities.
 */

const rosterEntry = z
  .any()
  .describe("{ player_id } | { card_key } | { player_name } (exact, unique) | 'ref:player:...' from the same batch.");

const gameSchema = z.object({
  domination_game_id: z
    .string()
    .uuid()
    .optional()
    .describe("Immutable id of an existing game on this road — the only fully unambiguous target."),
  game_order: z.number().int().min(1).describe("Position on the road. Unique per road; the fallback target."),
  opponent_name: z.string().optional().describe("Display name only. The same opponent may repeat (rematches)."),
  opponent_team_id: z.string().uuid().optional().describe("Optional link to a teams row."),
  difficulty_stars: z.number().int().min(1).max(5).optional(),
  coin_reward: z.number().int().min(0).optional(),
  pack_reward_id: z.string().uuid().nullable().optional().describe("Preferred pack reward target. null clears it."),
  pack_reward: z.string().nullable().optional().describe("Legacy: pack id or exact unique pack name."),
  roster: z
    .array(rosterEntry)
    .optional()
    .describe("Ordered opponent roster. DESTRUCTIVE full replacement for THIS game only."),
});

const bulkFields = {
  road_id: z.string().uuid().optional().describe("Preferred target: the immutable road id (see listDominationRoads)."),
  road_name: z
    .string()
    .optional()
    .describe("Road name (case-insensitive exact). Used to target an existing road, or to create a new one."),
  new_road_name: z.string().optional().describe("Rename the road. Every game on it follows automatically."),
  description: z.string().nullable().optional(),
  sort_order: z.number().int().optional().describe("Display order among roads."),
  is_active: z.boolean().optional(),
  mode: z
    .enum(["merge", "replace"])
    .default("merge")
    .describe(
      "'merge' only touches the game_orders present in `games`. 'replace' DESTRUCTIVELY makes the road match the payload exactly: games on this road whose game_order is absent are deleted, matched games keep their ids.",
    ),
  expected_game_count: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(
      "Safety check for mode='replace': the number of games the road must end up with. The preview is rejected if the payload carries a different count, and the commit is rolled back if the road does not verify to exactly this many games.",
    ),
  restored_from: z
    .string()
    .uuid()
    .optional()
    .describe("Set when replaying a payload from getContentOperations/getRoadRestorePayload, so history records the rollback."),
  games: z.array(gameSchema).default([]).describe("Every game to create or update, in any order."),
};

const bulkSafety =
  " Nothing is written until the byte-identical payload is re-sent with mode='commit' plus the preview_token; the whole road import is one transaction, protected by an advisory lock, a stale-scope check (CONCURRENT_MODIFICATION) and post-commit verification (game count, contiguous orders, duplicate orders, roster sizes, total coin reward, and proof no other road changed). Show road_creates / road_updates / game_operations / destructive_operations / warnings to the user and get explicit approval before committing.";


async function runBulk(
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
        message: "Run previewDominationRoadImport with the same payload first, then commit with its preview_token.",
      }),
    );
  }
  const { data, error: dbError } = await client.rpc("admin_road_bulk", {
    p_payload: clean(input) as never,
    p_commit: commit,
    p_preview_token: previewToken ?? null,
  });
  if (dbError) return fail(structuredError(dbError.message, commit ? "commit" : "preview"));
  return ok(data);
}

const listDominationRoads = defineTool({
  name: "listDominationRoads",
  title: "List Domination roads",
  description:
    "Read-only. Every Domination road with its immutable road_id, name, slug, description, sort order, active flag and game count. Start here before any road-level edit.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    const { client, error } = await userClient(ctx);
    if (error) return error;
    const { data: roads, error: dbError } = await client
      .from("domination_roads")
      .select("id,name,slug,description,sort_order,is_active")
      .order("sort_order");
    if (dbError) return fail(dbError.message);
    const { data: games } = await client.from("domination_games").select("road_id,game_order");
    return ok({
      roads: (roads ?? []).map((r) => {
        const mine = (games ?? []).filter((g: any) => g.road_id === r.id);
        return {
          road_id: r.id,
          road_name: r.name,
          slug: r.slug,
          description: r.description,
          sort_order: r.sort_order,
          is_active: r.is_active,
          game_count: mine.length,
          game_orders: mine.map((g: any) => g.game_order).sort((a, b) => a - b),
        };
      }),
    });
  },
});

const exportDominationRoad = defineTool({
  name: "exportDominationRoad",
  title: "Export a full Domination road",
  description:
    "Read-only. Returns one road exactly in the shape previewDominationRoadImport accepts: road settings plus every game in game_order with its domination_game_id, opponent (and opponent_team_id), difficulty stars, coin reward, pack_reward_id and full ordered roster, plus a rematch summary and warnings (order gaps, empty rosters, missing pack rewards). Edit the JSON and send it straight back.",
  inputSchema: {
    road_id: z.string().uuid().optional(),
    road_name: z.string().optional().describe("Case-insensitive exact road name."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (input, ctx) => {
    const { client, error } = await userClient(ctx);
    if (error) return error;
    const { data, error: dbError } = await client.rpc("admin_road_export", { p_ref: clean(input) as never });
    if (dbError) return fail(structuredError(dbError.message, "preview"));
    return ok(data);
  },
});

const previewDominationRoadImport = defineTool({
  name: "previewDominationRoadImport",
  title: "Preview a bulk Domination road import",
  description:
    "Bulk-import or replace an entire Domination road in one atomic operation: create or rename the road, set its description/sort order/active flag, and create, update, reorder or delete its games and opponent rosters. Rematch-safe: games are targeted by domination_game_id or game_order only, never by opponent name, so one opponent may legally appear at several game_orders. Validates unique game_order, difficulty range 1-5, non-negative rewards and every opponent_team_id / pack_reward_id / roster reference, reporting the offending game_order and field. With mode='replace' the road ends up matching the payload exactly (omitted game_orders on THAT road are deleted)." +
    bulkSafety,
  inputSchema: bulkFields,
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  handler: (input, ctx) => runBulk(ctx, input, false),
});

const commitDominationRoadImport = defineTool({
  name: "commitDominationRoadImport",
  title: "Commit a bulk Domination road import",
  description:
    "Applies a road import previously returned by previewDominationRoadImport. Send the byte-identical payload plus its preview_token; a differing payload is rejected with PREVIEW_MISMATCH and writes nothing. Tokens are single-use and the whole import runs as one transaction.",
  inputSchema: {
    ...bulkFields,
    preview_token: z.string().describe("The preview_token from the matching preview."),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  handler: ({ preview_token, ...rest }, ctx) => runBulk(ctx, rest, true, preview_token),
});

const roadTarget = {
  road_id: z.string().uuid().optional().describe("Preferred target."),
  road_name: z.string().optional().describe("Case-insensitive exact road name."),
};

async function runDelete(
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
        message: "Run previewDeleteDominationRoad first and commit with its preview_token.",
      }),
    );
  }
  const { data, error: dbError } = await client.rpc("admin_road_delete", {
    p_payload: clean(input) as never,
    p_commit: commit,
    p_preview_token: previewToken ?? null,
  });
  if (dbError) return fail(structuredError(dbError.message, commit ? "commit" : "preview"));
  return ok(data);
}

const previewDeleteDominationRoad = defineTool({
  name: "previewDeleteDominationRoad",
  title: "Preview deleting a whole Domination road",
  description:
    "Reports exactly what deleting an entire road would remove — every game with its id, game_order and opponent, plus the total roster rows — and writes nothing. Player cards themselves are never deleted. Requires explicit user approval before committing.",
  inputSchema: roadTarget,
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  handler: (input, ctx) => runDelete(ctx, input, false),
});

const commitDeleteDominationRoad = defineTool({
  name: "commitDeleteDominationRoad",
  title: "Delete a whole Domination road",
  description:
    "DESTRUCTIVE. Deletes a road together with all of its games and their rosters. Requires the single-use preview_token from previewDeleteDominationRoad for the same road.",
  inputSchema: { ...roadTarget, preview_token: z.string() },
  annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  handler: ({ preview_token, ...rest }, ctx) => runDelete(ctx, rest, true, preview_token),
});


const getContentOperations = defineTool({
  name: "getContentOperations",
  title: "Read the content operation history",
  description:
    "Read-only. Every committed content operation in reverse order: operation id, content type, operation type (merge / replace / delete / restore), scope, who ran it, payload hash, created / updated / deleted ids, warnings and the post-commit verification block. Use the returned id with getRoadRestorePayload to roll a Domination road back to how it looked before that operation.",
  inputSchema: {
    content_type: z.string().optional().describe("Filter, e.g. 'domination_road'."),
    scope_id: z.string().uuid().optional().describe("Filter to one road / entity id."),
    limit: z.number().int().min(1).max(100).default(20),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ content_type, scope_id, limit }, ctx) => {
    const { client, error } = await userClient(ctx);
    if (error) return error;
    let q = client
      .from("content_audit_log")
      .select(
        "id,content_type,operation_type,scope_id,scope_label,payload_hash,created_ids,updated_ids,deleted_ids,warnings,verification,restored_from,created_at",
      )
      .order("created_at", { ascending: false })
      .limit(limit ?? 20);
    if (content_type) q = q.eq("content_type", content_type);
    if (scope_id) q = q.eq("scope_id", scope_id);
    const { data, error: dbError } = await q;
    if (dbError) return fail(dbError.message);
    return ok({ operations: data ?? [] });
  },
});

const getRoadRestorePayload = defineTool({
  name: "getRoadRestorePayload",
  title: "Build a rollback payload for a Domination road",
  description:
    "Read-only. Returns the road exactly as it looked BEFORE the given operation (from getContentOperations), already shaped as a mode='replace' payload with expected_game_count and restored_from set. Feed it straight to previewDominationRoadImport / commitDominationRoadImport to roll the road back. Fails with NO_SNAPSHOT when the operation created the road (delete it instead).",
  inputSchema: { operation_id: z.string().uuid().describe("id from getContentOperations.") },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ operation_id }, ctx) => {
    const { client, error } = await userClient(ctx);
    if (error) return error;
    const { data, error: dbError } = await client.rpc("admin_content_restore_payload", { p_audit_id: operation_id });
    if (dbError) return fail(structuredError(dbError.message, "preview"));
    return ok(data);
  },
});

export const dominationRoadTools = [
  listDominationRoads,
  exportDominationRoad,
  previewDominationRoadImport,
  commitDominationRoadImport,
  previewDeleteDominationRoad,
  commitDeleteDominationRoad,
  getContentOperations,
  getRoadRestorePayload,
];

