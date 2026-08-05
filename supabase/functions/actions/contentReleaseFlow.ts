// Content-release preview/commit flow, kept out of index.ts so it is unit-testable.
//
// Contract:
//   preview  -> validates the full release document with ZERO game-content writes,
//               persists the canonical payload + plan server-side and returns
//               preview_id / payload_hash / expires_at / summary / plan.
//   commit   -> takes ONLY preview_id + approved hash. The server loads the stored
//               canonical payload and applies it in one transaction. The GPT never
//               has to keep the release document in conversation state.

import { prepareRelease, type ContentReleaseInput } from "./contentRelease.ts";

// deno-lint-ignore no-explicit-any
export type Client = any;
export interface FlowResult { status: number; body: Record<string, unknown> }

/** Caps a plan array so the connector never receives an over-sized body. */
export function cap(value: unknown, limit = 60) {
  if (!Array.isArray(value)) return value ?? [];
  return value.length > limit ? { total: value.length, showing: limit, items: value.slice(0, limit) } : value;
}

export function countOf(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

/** Preview record without the canonical payload and with capped plan arrays. */
export function slimPreview(record: Record<string, any> | null) {
  const r = record ?? {};
  return {
    preview_id: r.preview_id,
    payload_hash: r.payload_hash,
    status: r.status,
    created_at: r.created_at,
    expires_at: r.expires_at,
    approved_at: r.approved_at,
    committed_at: r.committed_at,
    summary: r.summary,
    creates: cap(r.creates),
    updates: cap(r.updates),
    replacements: cap(r.replacements),
    deletes: cap(r.deletes),
    warnings: cap(r.warnings),
    destructive_operations: cap(r.destructive_operations),
    resolved_references: cap(r.resolved_references),
    verification: r.verification_result ?? null,
    last_error: r.last_error ?? null,
  };
}

export function commitView(record: Record<string, any> | null) {
  const r = record ?? {};
  return {
    preview_id: r.preview_id,
    payload_hash: r.payload_hash,
    status: r.status,
    committed_at: r.committed_at,
    verification: r.verification_result ?? null,
    summary: r.summary ?? null,
    created_ids: r.commit_result?.results ? cap(r.commit_result.results) : undefined,
  };
}

/** Maps admin_error / preview lifecycle codes to HTTP statuses. */
export function rpcErrorResult(error: { message: string }): FlowResult {
  const msg = error.message || "";
  const e = (message: string, status: number) => ({ status, body: { error: message } });
  if (/Admin role required/i.test(msg)) return e("Admin role required for this operation.", 403);
  if (/Not authenticated/i.test(msg) || /UNAUTHORIZED/.test(msg)) return e(`Unauthorized: ${msg}`, 401);
  if (/PREVIEW_NOT_FOUND/.test(msg)) return e(msg, 404);
  if (/PREVIEW_ALREADY_COMMITTED/.test(msg)) return e(msg, 409);
  if (/PAYLOAD_HASH_MISMATCH/.test(msg)) return e(msg, 409);
  if (/PREVIEW_EXPIRED|PREVIEW_CANCELLED|PREVIEW_TOKEN_INVALID/.test(msg)) return e(msg, 410);
  return e(`Rejected, nothing was written: ${msg}`, 400);
}

/** Zero game-content writes: validate, plan, persist the canonical payload. */
export async function previewRelease(client: Client, raw: Record<string, unknown>): Promise<FlowResult> {
  const { preview_token: _ignored, preview_ttl_minutes, ...doc } = raw;
  const { validations, valid, payload } = prepareRelease(doc as unknown as ContentReleaseInput);
  if (!valid) {
    return {
      status: 400,
      body: { ok: false, stage: "validation", error_code: "VALIDATION_FAILED", wrote_anything: false, validations },
    };
  }

  const { data, error } = await client.rpc("admin_apply_batch", {
    p_payload: payload,
    p_commit: false,
    p_preview_token: null,
    p_kind: "content_release",
  });
  if (error) return rpcErrorResult(error);
  const result = (data ?? {}) as Record<string, any>;

  const { data: stored, error: storeErr } = await client.rpc("content_release_preview_store", {
    p_payload_hash: result.payload_hash,
    p_canonical_payload: result.normalized_payload ?? payload,
    p_preview_token: result.preview_token ?? null,
    p_summary: {
      release_name: (doc as any)?.release?.name ?? null,
      release_status: (doc as any)?.release?.status ?? "draft",
      item_count: result.item_count ?? 0,
      creates: countOf(result.creates),
      updates: countOf(result.updates),
      replacements: countOf(result.replacements),
      deletes: countOf(result.deletes),
      warnings: countOf(result.warnings),
    },
    p_plan: {
      creates: result.creates ?? [],
      updates: result.updates ?? [],
      replacements: result.replacements ?? [],
      deletes: result.deletes ?? [],
      warnings: result.warnings ?? [],
      destructive_operations: result.replacements ?? [],
      resolved_references: result.resolved_references ?? [],
      results: result.results ?? [],
    },
    p_ttl_minutes: Number(preview_ttl_minutes) || 30,
  });
  if (storeErr) return rpcErrorResult(storeErr);

  return {
    status: 200,
    body: {
      ok: true,
      wrote_anything: false,
      wrote_game_content: false,
      ...slimPreview(stored as Record<string, any>),
      next_step:
        "Show this plan, get explicit approval, then call commitContentRelease with ONLY preview_id + approved_payload_hash. Never resend the release payload. If the commit answers status 'committing', poll getContentReleasePreview instead of re-committing.",
    },
  };
}

/**
 * Commit by stored preview only. Accepts the approval hash under
 * approved_payload_hash / approval_hash / payload_hash.
 */
export async function commitStoredRelease(
  client: Client,
  raw: Record<string, unknown>,
  hooks: { waitUntil?: (p: Promise<unknown>) => void } = {},
): Promise<FlowResult> {
  const preview_id = raw.preview_id as string | undefined;
  const approved_payload_hash =
    (raw.approved_payload_hash ?? raw.approval_hash ?? raw.payload_hash) as string | undefined;
  const idempotency_key = (raw.idempotency_key as string | undefined) ?? null;

  if (!preview_id) {
    return {
      status: 400,
      body: {
        error:
          "preview_id is required: commit accepts only the stored preview_id plus the approved hash. Run previewContentRelease first, then commit with preview_id + approved_payload_hash — never the full release payload.",
      },
    };
  }
  if (!approved_payload_hash) {
    return { status: 400, body: { error: "approved_payload_hash is required: echo back the hash you showed the user for approval." } };
  }

  // 1) Claim: ownership, hash, status and expiry guards all run synchronously.
  const { data: claimData, error: claimErr } = await client.rpc("content_release_preview_claim", {
    p_preview_id: preview_id,
    p_approved_payload_hash: approved_payload_hash,
    p_idempotency_key: idempotency_key,
  });
  if (claimErr) return rpcErrorResult(claimErr);
  const claim = (claimData ?? {}) as Record<string, any>;

  if (claim.idempotent_replay) {
    return { status: 200, body: { ok: true, applied: true, idempotent_replay: true, ...commitView(claim) } };
  }
  if (claim.claimed === false && claim.already_running) {
    return {
      status: 202,
      body: {
        ok: true, applied: false, status: "committing", preview_id: claim.preview_id, payload_hash: claim.payload_hash,
        message: "This release is already being published. Poll getContentReleasePreview with the same preview_id.",
      },
    };
  }

  // 2) Commit in the background so the connector never waits on a long transaction.
  const commitPromise = client
    .rpc("content_release_preview_commit", {
      p_preview_id: preview_id,
      p_approved_payload_hash: approved_payload_hash,
      p_idempotency_key: idempotency_key,
    })
    .then(async ({ data, error }: { data: unknown; error: { message: string } | null }) => {
      if (error) {
        await client.rpc("content_release_preview_fail", { p_preview_id: preview_id, p_error: error.message });
        return { failed: true, message: error.message };
      }
      return { failed: false, record: (data ?? {}) as Record<string, any> };
    })
    .catch(async (e: Error) => {
      await client.rpc("content_release_preview_fail", { p_preview_id: preview_id, p_error: e.message });
      return { failed: true, message: e.message };
    });

  hooks.waitUntil?.(commitPromise);

  // 3) Answer fast: inline result when the commit is quick, otherwise a poll handle.
  const waitMs = Math.min(Math.max(Number(raw.wait_seconds) || 20, 5), 40) * 1000;
  const raced = (await Promise.race([
    commitPromise,
    new Promise((resolve) => setTimeout(() => resolve({ pending: true }), waitMs)),
  ])) as Record<string, any>;

  if (raced.pending) {
    return {
      status: 202,
      body: {
        ok: true,
        applied: false,
        status: "committing",
        preview_id: claim.preview_id,
        payload_hash: claim.payload_hash,
        message:
          "Commit is running server-side and will finish on its own. Poll getContentReleasePreview with this preview_id until status is 'committed' (success) or 'failed' (nothing written). Do NOT re-send the commit.",
        poll_after_seconds: 15,
      },
    };
  }
  if (raced.failed) {
    return { status: 400, body: { error: `Commit failed, the release was rolled back: ${raced.message}` } };
  }
  return { status: 200, body: { ok: true, applied: true, idempotent_replay: false, ...commitView(raced.record) } };
}
