// Scheduled admin-API executor.
// Runs every minute (pg_cron). For each due job it re-previews the approved
// canonical payload as the approving admin, compares the fresh plan with the
// plan that was approved, and only then commits — inside one transaction.
// A changed plan fails the job instead of applying a stale payload.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { payloadHash } from "../actions/admin-api/canonical.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const J = { ...corsHeaders, "Content-Type": "application/json" };

function planFingerprintInput(plan: Record<string, unknown>) {
  return {
    creates: plan.creates ?? [],
    updates: plan.updates ?? [],
    deletes: plan.deletes ?? [],
    replacements: plan.replacements ?? plan.destructive_operations ?? [],
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const now = new Date().toISOString();

  const { data: due, error } = await admin
    .from("admin_api_scheduled_jobs")
    .select("*")
    .eq("status", "scheduled")
    .lte("run_at", now)
    .order("run_at", { ascending: true })
    .limit(10);
  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500, headers: J });
  }

  const report: Array<Record<string, unknown>> = [];

  for (const job of due ?? []) {
    // Claim the job so a retry or a second scheduler tick cannot double-execute it.
    const { data: claimed } = await admin
      .from("admin_api_scheduled_jobs")
      .update({ status: "running", attempts: (job.attempts ?? 0) + 1 })
      .eq("id", job.id)
      .eq("status", "scheduled")
      .select("id");
    if (!claimed?.length) {
      report.push({ job_id: job.id, skipped: "already claimed" });
      continue;
    }

    const fail = async (code: string, message: string, extra: Record<string, unknown> = {}) => {
      await admin
        .from("admin_api_scheduled_jobs")
        .update({ status: "failed", last_error: { code, message, wrote_anything: false, ...extra } })
        .eq("id", job.id);
      report.push({ job_id: job.id, ok: false, code, message });
    };

    // 1. zero-write re-preview as the approving admin
    const { data: previewed, error: previewError } = await admin.rpc("admin_api_job_preview", { p_job_id: job.id });
    if (previewError) {
      await fail("REVALIDATION_FAILED", previewError.message);
      continue;
    }
    const plan = (previewed ?? {}) as Record<string, unknown>;
    const token = plan.preview_token as string | undefined;
    if (!token) {
      await fail("REVALIDATION_FAILED", "Re-preview returned no preview token.");
      continue;
    }

    // 2. drift detection against the approved plan
    const fresh = await payloadHash(planFingerprintInput(plan));
    if (job.plan_fingerprint && job.plan_fingerprint !== fresh) {
      await fail("PREVIEW_STALE", "Underlying records changed after approval; the plan no longer matches.", {
        approved_plan_fingerprint: job.plan_fingerprint,
        current_plan_fingerprint: fresh,
        remediation: "Re-preview, get approval again, and schedule the new preview.",
      });
      continue;
    }

    // 3. atomic commit as the approving admin
    const { data: committed, error: commitError } = await admin.rpc("admin_api_job_commit", {
      p_job_id: job.id,
      p_preview_token: token,
    });
    if (commitError) {
      await fail("COMMIT_FAILED", commitError.message);
      continue;
    }
    await admin
      .from("admin_api_scheduled_jobs")
      .update({ status: "succeeded", executed_at: new Date().toISOString(), result: committed, last_error: null })
      .eq("id", job.id);
    report.push({ job_id: job.id, ok: true, executed_at: new Date().toISOString() });
  }

  return new Response(JSON.stringify({ ok: true, checked_at: now, processed: report.length, report }, null, 2), { headers: J });
});
