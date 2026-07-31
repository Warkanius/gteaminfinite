import { z } from "zod";
import type { ToolContext } from "@lovable.dev/mcp-js";
import { adminClient, clean, ok, fail } from "./db";

/** Shared mode switch: preview writes nothing, commit needs the preview token. */
export const modeField = z
  .enum(["preview", "commit"])
  .default("preview")
  .describe("`preview` validates everything and writes nothing. `commit` applies the approved plan.");

export const previewTokenField = z
  .string()
  .optional()
  .describe(
    "Required for mode='commit': the preview_token returned by the matching preview. The commit is rejected unless the payload hashes identically to that preview, and each token works only once.",
  );

export const STAT_KEYS = [
  "stat_3pt",
  "stat_mid",
  "stat_fin",
  "stat_dnk",
  "stat_ast",
  "stat_stl",
  "stat_reb",
  "stat_blk",
  "stat_int",
] as const;

export const CHALLENGE_TYPES = [
  "points_scored",
  "games_won",
  "total_stat",
  "single_game_stat",
  "multi_condition",
] as const;

/** Loose item shape — the database engine is the single source of validation truth. */
export const itemArray = (what: string) =>
  z.array(z.record(z.string(), z.any())).min(1).describe(what);

export type BatchPayload = Record<string, unknown>;

/**
 * Calls `public.admin_apply_batch`, the atomic preview/commit engine.
 * Every group in the payload runs inside one transaction in dependency order;
 * any failure rolls the whole batch back.
 */
export async function runBatch(
  ctx: ToolContext,
  payload: BatchPayload,
  mode: "preview" | "commit",
  previewToken: string | undefined,
  kind: string,
) {
  const { client, error } = await adminClient(ctx);
  if (error) return error;
  if (mode === "commit" && !previewToken) {
    return fail(
      JSON.stringify({
        error_code: "PREVIEW_REQUIRED",
        message: "Run the same payload with mode='preview' first, get user approval, then commit with its preview_token.",
      }),
    );
  }
  const { data, error: dbError } = await client.rpc("admin_apply_batch", {
    p_payload: clean(payload) as never,
    p_commit: mode === "commit",
    p_preview_token: previewToken ?? null,
    p_kind: kind,
  });
  if (dbError) return fail(structuredError(dbError.message, mode));
  return ok(data);
}

/**
 * Turns database errors into structured JSON.
 * Recognises `CODE: message detail={"game_order":3,"field":"pack_reward",...}`
 * emitted by admin_road_raise, and the older `matches=[...]` suffix.
 */
export function structuredError(message: string, mode: "preview" | "commit") {
  const codeMatch = message.match(/^([A-Z_]{3,}):\s*([\s\S]*)$/);
  let matches: unknown;
  let detail: Record<string, unknown> | undefined;
  let text = message;
  if (codeMatch) text = codeMatch[2];

  const d = text.match(/\s*detail=(\{[\s\S]*\})\s*$/);
  if (d) {
    try {
      detail = JSON.parse(d[1]);
      text = text.slice(0, d.index).trim();
      if (detail && "matches" in detail) {
        matches = (detail as { matches: unknown }).matches;
        delete (detail as Record<string, unknown>).matches;
      }
    } catch {
      /* leave raw */
    }
  }

  const m = text.match(/matches=(\[[\s\S]*\])\s*$/);
  if (m) {
    try {
      matches = JSON.parse(m[1]);
      text = text.slice(0, m.index).trim();
    } catch {
      /* leave raw */
    }
  }
  return JSON.stringify(
    {
      error_code: codeMatch ? codeMatch[1] : "INVALID_PAYLOAD",
      message: text,
      mode,
      wrote_anything: false,
      ...(detail && Object.keys(detail).length ? detail : {}),
      ...(matches ? { matches } : {}),
    },
    null,
    2,
  );
}


const SAFETY =
  " Nothing is written until you re-send the identical payload with mode='commit' plus the preview_token, and the whole batch is applied or rolled back as one transaction. Show the returned creates / updates / deletes / replacements to the user and get explicit approval before committing.";

export const safetyNote = SAFETY;
