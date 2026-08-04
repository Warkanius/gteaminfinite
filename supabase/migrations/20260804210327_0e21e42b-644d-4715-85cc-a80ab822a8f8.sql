ALTER TABLE public.admin_api_scheduled_jobs
  ADD COLUMN IF NOT EXISTS plan_fingerprint text;

-- Zero-write re-preview of a scheduled job, executed as the approving admin.
CREATE OR REPLACE FUNCTION public.admin_api_job_preview(p_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.admin_api_scheduled_jobs;
  v_result jsonb;
BEGIN
  SELECT * INTO v_job FROM public.admin_api_scheduled_jobs WHERE id = p_job_id;
  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'UNKNOWN_SCHEDULED_JOB: no scheduled job %', p_job_id;
  END IF;
  IF NOT public.has_role(v_job.admin_id, 'admin') THEN
    RAISE EXCEPTION 'FORBIDDEN: the approving user is no longer an admin';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_job.admin_id::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_job.admin_id, 'role', 'authenticated')::text, true);

  v_result := public.admin_apply_batch(
    p_payload => v_job.canonical_payload,
    p_commit => false,
    p_preview_token => NULL,
    p_kind => v_job.operation
  );
  RETURN v_result;
END;
$$;

-- Atomic commit of a scheduled job using the token from its re-preview.
CREATE OR REPLACE FUNCTION public.admin_api_job_commit(p_job_id uuid, p_preview_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.admin_api_scheduled_jobs;
  v_result jsonb;
BEGIN
  SELECT * INTO v_job FROM public.admin_api_scheduled_jobs WHERE id = p_job_id FOR UPDATE;
  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'UNKNOWN_SCHEDULED_JOB: no scheduled job %', p_job_id;
  END IF;
  IF v_job.executed_at IS NOT NULL THEN
    RAISE EXCEPTION 'JOB_ALREADY_EXECUTED: job % already executed at %', p_job_id, v_job.executed_at;
  END IF;
  IF NOT public.has_role(v_job.admin_id, 'admin') THEN
    RAISE EXCEPTION 'FORBIDDEN: the approving user is no longer an admin';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_job.admin_id::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_job.admin_id, 'role', 'authenticated')::text, true);

  v_result := public.admin_apply_batch(
    p_payload => v_job.canonical_payload,
    p_commit => true,
    p_preview_token => p_preview_token,
    p_kind => v_job.operation
  );
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_api_job_preview(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_api_job_commit(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_api_job_preview(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_api_job_commit(uuid, text) TO service_role;