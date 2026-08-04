// Preview storage, idempotency, scheduling and audit persistence for the v1 API.
// Deliberately client-agnostic: any object with a supabase-js compatible
// .from()/.rpc() surface works, so the same code runs in the edge function.

import { API_VERSION } from "./errors.ts";
import { LIMITS } from "./capabilities.ts";
import { byteSize } from "./canonical.ts";

// deno-lint-ignore no-explicit-any
export type Client = any;

export interface StoredPreview {
  id: string;
  operation: string;
  admin_id: string;
  payload_hash: string;
  preview_token: string | null;
  canonical_payload: Record<string, unknown>;
  plan: Record<string, unknown>;
  summary: Record<string, unknown>;
  warnings: unknown[];
  expires_at: string;
  consumed_at: string | null;
  api_version: string;
}

export async function savePreview(
  client: Client,
  row: {
    operation: string;
    admin_id: string;
    payload_hash: string;
    preview_token: string | null;
    canonical_payload: Record<string, unknown>;
    plan: Record<string, unknown>;
    summary: Record<string, unknown>;
    warnings: unknown[];
  },
): Promise<{ preview?: StoredPreview; error?: string }> {
  const expires = new Date(Date.now() + LIMITS.preview_token_ttl_minutes * 60_000).toISOString();
  const { data, error } = await client
    .from("admin_api_previews")
    .insert({ ...row, api_version: API_VERSION, expires_at: expires })
    .select("*")
    .single();
  if (error) return { error: error.message };
  return { preview: data as StoredPreview };
}

export async function loadPreview(
  client: Client,
  by: { preview_id?: string; preview_token?: string },
): Promise<{ preview?: StoredPreview; error?: string }> {
  let q = client.from("admin_api_previews").select("*").limit(1);
  if (by.preview_id) q = q.eq("id", by.preview_id);
  else if (by.preview_token) q = q.eq("preview_token", by.preview_token);
  else return { error: "preview_id or preview_token is required" };
  const { data, error } = await q;
  if (error) return { error: error.message };
  if (!data?.length) return { error: "not_found" };
  return { preview: data[0] as StoredPreview };
}

export async function consumePreview(client: Client, id: string) {
  await client.from("admin_api_previews").update({ consumed_at: new Date().toISOString() }).eq("id", id);
}

/** Returns the stored result when this idempotency key already committed. */
export async function idempotentReplay(
  client: Client,
  admin_id: string,
  operation: string,
  key: string,
  payload_hash: string,
): Promise<{ replay?: Record<string, unknown>; conflict?: boolean }> {
  const { data } = await client
    .from("admin_api_idempotency")
    .select("*")
    .eq("admin_id", admin_id)
    .eq("operation", operation)
    .eq("idempotency_key", key)
    .limit(1);
  const row = data?.[0];
  if (!row) return {};
  if (row.payload_hash !== payload_hash) return { conflict: true };
  return { replay: { ...(row.result as Record<string, unknown>), idempotent_replay: true } };
}

export async function recordIdempotency(
  client: Client,
  row: { admin_id: string; operation: string; idempotency_key: string; payload_hash: string; result: unknown },
) {
  await client.from("admin_api_idempotency").upsert(
    { ...row, api_version: API_VERSION, status: "succeeded" },
    { onConflict: "admin_id,operation,idempotency_key" },
  );
}

export interface ScheduleInput {
  admin_id: string;
  operation: string;
  label?: string;
  canonical_payload: Record<string, unknown>;
  payload_hash: string;
  /** Hash of the approved plan; execution fails if the fresh plan differs. */
  plan_fingerprint?: string;
  run_at: string;
  timezone?: string;
}

export async function scheduleJob(client: Client, input: ScheduleInput) {
  const { data, error } = await client
    .from("admin_api_scheduled_jobs")
    .insert({ ...input, api_version: API_VERSION, timezone: input.timezone ?? "UTC", status: "scheduled" })
    .select("*")
    .single();
  if (error) return { error: error.message };
  return { job: data };
}

/** Inline plans over the size budget are paged through the preview detail route. */
export function shouldPaginate(plan: unknown) {
  return byteSize(plan) > LIMITS.max_inline_preview_bytes;
}

export function pageOf<T>(items: T[], page: number, size = LIMITS.preview_detail_page_size) {
  const start = Math.max(0, (page - 1) * size);
  return {
    page,
    page_size: size,
    total: items.length,
    total_pages: Math.max(1, Math.ceil(items.length / size)),
    items: items.slice(start, start + size),
  };
}
