// /admin-api/v1 router: one canonical pipeline for every GPT-facing mutation.
//
//   resolve aliases -> validate -> plan -> normalize -> hash
//   -> single-use preview token -> approval -> byte-identical atomic commit
//
// Preview and commit share this file end to end; single-entity routes wrap their
// body into the same bulk document, so no schema can drift between them.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { API_VERSION, apiError, apiWarning, failure, fromDbError, type AdminApiWarning } from "./errors.ts";
import { canonicalize, payloadHash, byteSize } from "./canonical.ts";
import { normalizeDocument, documentForEntity, ENTITY_TO_GROUP } from "./normalize.ts";
import { capabilities, LIMITS } from "./capabilities.ts";
import { runDiagnostics } from "./diagnostics.ts";
import {
  savePreview,
  loadPreview,
  consumePreview,
  idempotentReplay,
  recordIdempotency,
  scheduleJob,
  shouldPaginate,
  pageOf,
  type Client,
} from "./store.ts";

const J = { ...corsHeaders, "Content-Type": "application/json" };
const send = (body: unknown, status = 200) => new Response(JSON.stringify(body, null, 2), { status, headers: J });

export interface Ctx {
  client: Client;
  adminId: string;
  base: string;
}

/** Handles any /admin-api/v1/* path. Returns null when the path is not ours. */
export async function handleAdminApi(
  path: string,
  req: Request,
  ctx: Ctx,
): Promise<Response | null> {
  if (!path.startsWith("/admin-api/")) return null;
  const rest = path.slice("/admin-api/".length);
  const [version, ...segments] = rest.split("/").filter(Boolean);
  if (version !== API_VERSION) {
    return send(
      failure("validation", [
        apiError("UNSUPPORTED_API_VERSION", `Unknown API version "${version}".`, {
          expected: API_VERSION,
          received: version,
          remediation: `Use /admin-api/${API_VERSION}/…`,
        }),
      ]),
      400,
    );
  }

  const head = segments[0] ?? "";
  const tail = segments[1] ?? "";

  if (head === "capabilities" && req.method === "GET") return send(capabilities(ctx.base));
  if (head === "diagnostics" && req.method === "GET") {
    const url = new URL(req.url);
    const list = (key: string) =>
      (url.searchParams.get(key) ?? "")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
    const result = await runDiagnostics(ctx.client, {
      scope: url.searchParams.get("scope") ?? undefined,
      player_card_ids: list("player_card_ids"),
      codes: list("codes"),
      entity_types: list("entity_types"),
      release_slug: url.searchParams.get("release_slug") ?? undefined,
      label: url.searchParams.get("label") ?? undefined,
      limit: Number(url.searchParams.get("limit") ?? "") || undefined,
      cursor: url.searchParams.get("cursor") ?? undefined,
    });
    return send({ api_version: API_VERSION, ...result });
  }


  if (head === "previews" && req.method === "GET") {
    const { preview, error } = await loadPreview(ctx.client, { preview_id: tail });
    if (error || !preview) {
      return send(failure("preview", [apiError("UNKNOWN_PREVIEW", `No preview ${tail} for this admin.`, { remediation: "Run a fresh preview." })]), 404);
    }
    const url = new URL(req.url);
    const section = url.searchParams.get("section") ?? "";
    const page = Number(url.searchParams.get("page") ?? "1") || 1;
    const plan = preview.plan as Record<string, unknown>;
    if (!section) {
      return send({
        api_version: API_VERSION,
        preview_id: preview.id,
        operation: preview.operation,
        payload_hash: preview.payload_hash,
        expires_at: preview.expires_at,
        consumed: Boolean(preview.consumed_at),
        summary: preview.summary,
        sections: Object.keys(plan),
        detail_url: `${ctx.base}/admin-api/${API_VERSION}/previews/${preview.id}?section=<section>&page=1`,
      });
    }
    const items = plan[section];
    if (!Array.isArray(items)) {
      return send(failure("preview", [apiError("UNKNOWN_PREVIEW_SECTION", `Section "${section}" is not a list.`, { expected: Object.keys(plan) })]), 400);
    }
    return send({ api_version: API_VERSION, preview_id: preview.id, section, ...pageOf(items, page) });
  }

  // ----------------------------------------------------------------- schedule
  if (head === "schedule") {
    if (req.method === "GET") {
      const { data, error } = await ctx.client
        .from("admin_api_scheduled_jobs")
        .select("id,label,operation,run_at,timezone,status,attempts,payload_hash,executed_at,cancelled_at,last_error")
        .order("run_at", { ascending: true });
      if (error) return send(failure("schedule", [apiError("SCHEDULE_READ_FAILED", error.message)]), 400);
      return send({ api_version: API_VERSION, jobs: data ?? [] });
    }
    if (req.method === "POST" && !tail) return await createSchedule(req, ctx);
    if (req.method === "POST" && tail) return await mutateSchedule(req, ctx, tail, segments[2] ?? "");
  }

  // ------------------------------------------------- preview / commit routes
  const mode = tail === "preview" ? "preview" : tail === "commit" ? "commit" : null;
  if (mode && req.method === "POST") {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    if (head === "bulk-players" || head === "bulk_players") {
      const foreign = Object.keys(body).filter(
        (k) => !["players", "preview_token", "idempotency_key", "notes"].includes(k),
      );
      if (foreign.length) {
        return send(
          failure("validation", [
            apiError("PLAYERS_ONLY_SCOPE", "bulk-players updates player cards only.", {
              received: foreign,
              expected: ["players", "preview_token", "idempotency_key", "notes"],
              remediation: "Move releases, collections, packs, teams, evo paths and every other group to /admin-api/v1/bulk or /content-release.",
            }),
          ], "bulk_players"),
          400,
        );
      }
      if (!Array.isArray(body.players) || body.players.length === 0) {
        return send(
          failure("validation", [
            apiError("EMPTY_PAYLOAD", "players must be a non-empty array of player-card creates or updates.", { path: "players" }),
          ], "bulk_players"),
          400,
        );
      }
      return await runPipeline(mode, "bulk-players", body, ctx);
    }
    if (head === "bulk" || head === "release") return await runPipeline(mode, "bulk", body, ctx);
    if (ENTITY_TO_GROUP[head]) return await runPipeline(mode, head, body, ctx);
    return send(
      failure("validation", [
        apiError("UNKNOWN_ENTITY", `"${head}" is not a known entity.`, {
          expected: Object.keys(ENTITY_TO_GROUP).sort(),
          remediation: "Use GET /admin-api/v1/capabilities for supported entities.",
        }),
      ]),
      404,
    );
  }

  return send(
    failure("validation", [
      apiError("UNKNOWN_OPERATION", `Unknown operation ${req.method} ${path}.`, {
        remediation: `See GET ${ctx.base}/admin-api/${API_VERSION}/capabilities.`,
      }),
    ]),
    404,
  );
}

/** Builds the canonical document, hash and plan for a request body. */
function prepare(entity: string, body: Record<string, unknown>) {
  const { preview_token, preview_id, idempotency_key, schedule, ...doc } = body as Record<string, unknown> & {
    preview_token?: string;
    preview_id?: string;
    idempotency_key?: string;
  };
  const passthrough = entity === "bulk" || entity === "bulk-players";
  const document = passthrough ? doc : documentForEntity(entity, doc as Record<string, unknown>) ?? {};
  const normalized = normalizeDocument(document);
  return { normalized, preview_token, preview_id, idempotency_key, schedule };
}

async function runPipeline(mode: "preview" | "commit", entity: string, body: Record<string, unknown>, ctx: Ctx): Promise<Response> {
  const operation = entity === "bulk" ? "bulk" : entity === "bulk-players" ? "bulk_players" : `entity:${entity}`;
  if (byteSize(body) > LIMITS.max_request_bytes) {
    return send(
      failure("validation", [
        apiError("PAYLOAD_TOO_LARGE", "Request exceeds the maximum payload size.", {
          expected: `${LIMITS.max_request_bytes} bytes`,
          received: byteSize(body),
          remediation: "Split the operation into several bulk documents.",
        }),
      ], operation),
      413,
    );
  }

  let prepared: ReturnType<typeof prepare>;
  try {
    prepared = prepare(entity, body);
  } catch (e) {
    return send(failure("validation", [apiError("INVALID_PAYLOAD", (e as Error).message)], operation), 400);
  }
  const { normalized, preview_token, idempotency_key } = prepared;

  if (normalized.plan.entity_count > LIMITS.max_entities_per_request) {
    return send(
      failure("validation", [
        apiError("PAYLOAD_TOO_LARGE", "Too many entities in one request.", {
          expected: `${LIMITS.max_entities_per_request} entities`,
          received: normalized.plan.entity_count,
          remediation: "Split into several bulk documents; each commit stays atomic within its own scope.",
        }),
      ], operation),
      413,
    );
  }
  if (normalized.errors.length) {
    return send({ ...failure("validation", normalized.errors, operation, normalized.warnings) }, 400);
  }
  if (!normalized.plan.entity_count) {
    return send(
      failure("validation", [
        apiError("EMPTY_PAYLOAD", "No content groups were supplied.", { remediation: "Include at least one supported group." }),
      ], operation),
      400,
    );
  }

  const canonical = normalized.canonical;
  const hash = await payloadHash(canonical);

  if (mode === "commit" && idempotency_key) {
    const { replay, conflict } = await idempotentReplay(ctx.client, ctx.adminId, operation, idempotency_key, hash);
    if (conflict) {
      return send(
        failure("commit", [
          apiError("IDEMPOTENCY_MISMATCH", "This idempotency key was already used with a different payload.", {
            remediation: "Use a new idempotency_key for a different payload.",
          }),
        ], operation),
        409,
      );
    }
    if (replay) return send(replay);
  }

  if (mode === "commit") {
    if (!preview_token) {
      return send(
        failure("commit", [
          apiError("PREVIEW_REQUIRED", "Commit requires the preview_token from the approved preview.", {
            remediation: "Preview the identical document, get approval, then commit with its token.",
          }),
        ], operation),
        400,
      );
    }
    const { preview } = await loadPreview(ctx.client, { preview_token });
    if (!preview) {
      return send(failure("commit", [apiError("UNKNOWN_PREVIEW_TOKEN", "No stored preview matches this token.", { remediation: "Run a fresh preview." })], operation), 400);
    }
    if (preview.consumed_at) {
      return send(failure("commit", [apiError("PREVIEW_ALREADY_COMMITTED", "Preview tokens are single use.", { remediation: "Run a fresh preview." })], operation), 409);
    }
    if (new Date(preview.expires_at) < new Date()) {
      return send(failure("commit", [apiError("PREVIEW_EXPIRED", "The approved preview expired.", { remediation: "Run a fresh preview." })], operation), 410);
    }
    if (preview.admin_id !== ctx.adminId) {
      return send(failure("commit", [apiError("PREVIEW_OWNER_MISMATCH", "This preview belongs to a different admin.")], operation), 403);
    }
    if (preview.operation !== operation || preview.api_version !== API_VERSION) {
      return send(
        failure("commit", [
          apiError("PREVIEW_OPERATION_MISMATCH", "The token was issued for a different operation or API version.", {
            expected: { operation: preview.operation, api_version: preview.api_version },
            received: { operation, api_version: API_VERSION },
          }),
        ], operation),
        409,
      );
    }
    if (preview.payload_hash !== hash) {
      return send(
        failure("commit", [
          apiError("PREVIEW_MISMATCH", "Payload does not match the approved preview.", {
            expected: preview.payload_hash,
            received: hash,
            remediation: "Commit the exact canonical_payload returned by the preview.",
          }),
        ], operation),
        409,
      );
    }
  }

  // ---- engine call: one transaction, preview writes nothing -----------------
  const { data, error } = await ctx.client.rpc("admin_apply_batch", {
    p_payload: canonical,
    p_commit: mode === "commit",
    p_preview_token: mode === "commit" ? preview_token : null,
    p_kind: operation === "bulk" ? "content_release" : operation === "bulk_players" ? "player_bulk" : operation,
  });
  if (error) {
    const body = fromDbError(error.message, mode === "commit" ? "commit" : "preview", operation);
    const status = /FORBIDDEN|admin role/i.test(error.message) ? 403 : /NOT_AUTHENTICATED/i.test(error.message) ? 401 : 400;
    return send(body, status);
  }

  const engine = (data ?? {}) as Record<string, unknown>;
  const warnings: AdminApiWarning[] = [
    ...normalized.warnings,
    ...normalized.plan.destructive,
    ...toWarnings(engine.warnings),
  ];

  if (mode === "preview") {
    const bySeverity = (severity: string) => warnings.filter((w) => w.severity === severity);
    const withCode = (code: string) => warnings.filter((w) => w.code === code);
    const plan = {
      creates: engine.creates ?? [],
      updates: engine.updates ?? [],
      deletes: engine.deletes ?? [],
      replacements: engine.replacements ?? engine.destructive_operations ?? [],
      destructive_operations: bySeverity("destructive"),
      resolved_references: engine.resolved_references ?? [],
      existing_links: engine.existing_links ?? [],
      cross_release_contamination: engine.cross_release_contamination ?? withCode("CROSS_RELEASE_LINK"),
      ambiguous_matches: withCode("AMBIGUOUS_MATCH"),
      unsupported_fields: withCode("UNSUPPORTED_FIELD"),
      ovr_checks: withCode("OVR_REPORT"),
      operations: engine.operations ?? [],
      warnings,
      errors: [],
    };
    const token = (engine.preview_token as string) ?? null;
    const summary = {
      groups: normalized.plan.groups,
      entity_count: normalized.plan.entity_count,
      creates: countOf(plan.creates),
      updates: countOf(plan.updates),
      deletes: countOf(plan.deletes),
      replacements: countOf(plan.replacements),
      destructive: plan.destructive_operations.length,
      unsupported_fields: plan.unsupported_fields.length,
      warnings: warnings.length,
      errors: 0,
      validation_status: "valid" as const,
    };
    const { preview, error: storeError } = await savePreview(ctx.client, {
      operation,
      admin_id: ctx.adminId,
      payload_hash: hash,
      preview_token: token,
      canonical_payload: canonical,
      plan,
      summary,
      warnings,
    });
    if (storeError) {
      return send(failure("preview", [apiError("PREVIEW_STORE_FAILED", storeError)], operation), 400);
    }
    const paginate = shouldPaginate(plan);
    return send({
      ok: true,
      api_version: API_VERSION,
      operation,
      mode: "preview",
      wrote_anything: false,
      preview_id: preview!.id,
      preview_token: token,
      payload_hash: hash,
      issued_at: new Date().toISOString(),
      expires_at: preview!.expires_at,
      preview_token_lifetime_minutes: LIMITS.preview_token_ttl_minutes,
      atomic_transaction_scope:
        operation === "bulk_players"
          ? "every listed player card, its badge and trait replacements, in one transaction; no other entity is touched"
          : operation === "bulk"
            ? "one bulk document = one transaction across every included group"
            : `one ${operation} scope = one transaction`,
      summary: preview!.summary,
      warnings,
      requires_approval: true,
      approval_prompt: "Show creates, updates, deletes, replacements and warnings, then commit the identical canonical_payload with this preview_token.",
      plan_sections: Object.keys(plan),
      detail_url: `${ctx.base}/admin-api/${API_VERSION}/previews/${preview!.id}?section=<section>&page=1`,
      ...(paginate
        ? { plan_paginated: true }
        : { plan_paginated: false, plan }),
      canonical_payload: canonical,
    });
  }

  // ---- commit report -------------------------------------------------------
  const { preview } = await loadPreview(ctx.client, { preview_token });
  if (preview) await consumePreview(ctx.client, preview.id);
  const result = {
    ok: true,
    api_version: API_VERSION,
    operation,
    mode: "commit",
    wrote_anything: true,
    payload_hash: hash,
    preview_id: preview?.id,
    audit_id: engine.audit_operation_id ?? null,
    created_ids: engine.created_ids ?? [],
    updated_ids: engine.updated_ids ?? [],
    deleted_ids: engine.deleted_ids ?? [],
    row_counts: {
      creates: countOf(engine.creates),
      updates: countOf(engine.updates),
      deletes: countOf(engine.deletes),
      replacements: countOf(engine.replacements ?? engine.destructive_operations),
    },
    warnings,
    engine_result: engine.results ?? engine.operations ?? null,
    committed_at: new Date().toISOString(),
  };
  if (idempotency_key) {
    await recordIdempotency(ctx.client, {
      admin_id: ctx.adminId,
      operation,
      idempotency_key,
      payload_hash: hash,
      result,
    });
  }
  return send(result);
}

function countOf(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function toWarnings(value: unknown): AdminApiWarning[] {
  if (!Array.isArray(value)) return [];
  return value.map((w) =>
    typeof w === "string"
      ? apiWarning("ENGINE_WARNING", w)
      : apiWarning(String((w as Record<string, unknown>).code ?? "ENGINE_WARNING"), String((w as Record<string, unknown>).message ?? JSON.stringify(w))),
  );
}

// ------------------------------------------------------------------ scheduling
async function createSchedule(req: Request, ctx: Ctx): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const previewToken = body.preview_token as string | undefined;
  const previewId = body.preview_id as string | undefined;
  const runAt = body.run_at as string | undefined;
  if (!previewToken && !previewId) {
    return send(
      failure("schedule", [
        apiError("PREVIEW_REQUIRED", "Scheduling needs the approved preview_token (or preview_id).", {
          remediation: "Preview, get approval, then schedule that exact preview.",
        }),
      ]),
      400,
    );
  }
  if (!runAt || Number.isNaN(Date.parse(runAt))) {
    return send(
      failure("schedule", [
        apiError("INVALID_RUN_AT", "run_at must be an ISO-8601 timestamp.", { received: runAt, expected: "2026-08-10T18:00:00Z" }),
      ]),
      400,
    );
  }
  const { preview } = await loadPreview(ctx.client, { preview_id: previewId, preview_token: previewToken });
  if (!preview) {
    return send(failure("schedule", [apiError("UNKNOWN_PREVIEW_TOKEN", "No stored preview matches.", { remediation: "Run a fresh preview." })]), 400);
  }
  if (preview.consumed_at) {
    return send(failure("schedule", [apiError("PREVIEW_ALREADY_COMMITTED", "That preview was already committed.")]), 409);
  }
  if (preview.admin_id !== ctx.adminId) {
    return send(failure("schedule", [apiError("PREVIEW_OWNER_MISMATCH", "This preview belongs to a different admin.")]), 403);
  }
  const approvedPlan = preview.plan as Record<string, unknown>;
  const planFingerprint = await payloadHash({
    creates: approvedPlan.creates ?? [],
    updates: approvedPlan.updates ?? [],
    deletes: approvedPlan.deletes ?? [],
    replacements: approvedPlan.replacements ?? [],
  });
  const { job, error } = await scheduleJob(ctx.client, {
    admin_id: ctx.adminId,
    operation: preview.operation,
    label: (body.label as string) ?? undefined,
    canonical_payload: preview.canonical_payload,
    payload_hash: preview.payload_hash,
    plan_fingerprint: planFingerprint,
    run_at: new Date(runAt).toISOString(),
    timezone: (body.timezone as string) ?? "UTC",
  });
  if (error) return send(failure("schedule", [apiError("SCHEDULE_FAILED", error)]), 400);
  await consumePreview(ctx.client, preview.id);
  return send({
    ok: true,
    api_version: API_VERSION,
    scheduled_job_id: job.id,
    operation: job.operation,
    run_at_utc: job.run_at,
    timezone: job.timezone,
    run_at_local: new Date(job.run_at).toLocaleString("en-US", { timeZone: safeZone(job.timezone) }),
    payload_hash: job.payload_hash,
    status: job.status,
    revalidation_policy: "The payload is revalidated at execution; if the plan changed the job fails without writing.",
  });
}

function safeZone(zone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return "UTC";
  }
}

async function mutateSchedule(req: Request, ctx: Ctx, jobId: string, action: string): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const { data } = await ctx.client.from("admin_api_scheduled_jobs").select("*").eq("id", jobId).limit(1);
  const job = data?.[0];
  if (!job) return send(failure("schedule", [apiError("UNKNOWN_SCHEDULED_JOB", `No scheduled job ${jobId}.`)]), 404);
  if (job.status !== "scheduled") {
    return send(
      failure("schedule", [
        apiError("JOB_NOT_EDITABLE", `Job status is "${job.status}".`, { remediation: "Only scheduled jobs can be edited or cancelled." }),
      ]),
      409,
    );
  }
  if (action === "cancel") {
    const { error } = await ctx.client
      .from("admin_api_scheduled_jobs")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("id", jobId);
    if (error) return send(failure("schedule", [apiError("SCHEDULE_CANCEL_FAILED", error.message)]), 400);
    return send({ ok: true, api_version: API_VERSION, scheduled_job_id: jobId, status: "cancelled" });
  }
  const runAt = body.run_at as string | undefined;
  if (!runAt || Number.isNaN(Date.parse(runAt))) {
    return send(failure("schedule", [apiError("INVALID_RUN_AT", "run_at must be an ISO-8601 timestamp.", { received: runAt })]), 400);
  }
  const { error } = await ctx.client
    .from("admin_api_scheduled_jobs")
    .update({ run_at: new Date(runAt).toISOString(), timezone: (body.timezone as string) ?? job.timezone, label: (body.label as string) ?? job.label })
    .eq("id", jobId);
  if (error) return send(failure("schedule", [apiError("SCHEDULE_UPDATE_FAILED", error.message)]), 400);
  return send({ ok: true, api_version: API_VERSION, scheduled_job_id: jobId, run_at_utc: new Date(runAt).toISOString(), status: "scheduled" });
}

export { canonicalize };
