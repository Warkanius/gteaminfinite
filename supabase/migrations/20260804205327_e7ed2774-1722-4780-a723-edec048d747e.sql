CREATE TABLE public.admin_api_previews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_version text NOT NULL DEFAULT 'v1',
  operation text NOT NULL,
  admin_id uuid NOT NULL,
  payload_hash text NOT NULL,
  preview_token text,
  canonical_payload jsonb NOT NULL,
  plan jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 minutes'),
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_api_previews_admin_idx ON public.admin_api_previews (admin_id, created_at DESC);
CREATE INDEX admin_api_previews_hash_idx ON public.admin_api_previews (payload_hash);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_api_previews TO authenticated;
GRANT ALL ON public.admin_api_previews TO service_role;
ALTER TABLE public.admin_api_previews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage api previews" ON public.admin_api_previews
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.admin_api_idempotency (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_version text NOT NULL DEFAULT 'v1',
  admin_id uuid NOT NULL,
  operation text NOT NULL,
  idempotency_key text NOT NULL,
  payload_hash text NOT NULL,
  status text NOT NULL DEFAULT 'succeeded',
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (admin_id, operation, idempotency_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_api_idempotency TO authenticated;
GRANT ALL ON public.admin_api_idempotency TO service_role;
ALTER TABLE public.admin_api_idempotency ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage api idempotency" ON public.admin_api_idempotency
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE public.admin_api_scheduled_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_version text NOT NULL DEFAULT 'v1',
  admin_id uuid NOT NULL,
  operation text NOT NULL,
  label text,
  canonical_payload jsonb NOT NULL,
  payload_hash text NOT NULL,
  run_at timestamptz NOT NULL,
  timezone text NOT NULL DEFAULT 'UTC',
  status text NOT NULL DEFAULT 'scheduled',
  attempts integer NOT NULL DEFAULT 0,
  last_error jsonb,
  result jsonb,
  approved_at timestamptz NOT NULL DEFAULT now(),
  executed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_api_scheduled_jobs_due_idx ON public.admin_api_scheduled_jobs (status, run_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_api_scheduled_jobs TO authenticated;
GRANT ALL ON public.admin_api_scheduled_jobs TO service_role;
ALTER TABLE public.admin_api_scheduled_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage api scheduled jobs" ON public.admin_api_scheduled_jobs
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER admin_api_previews_updated_at BEFORE UPDATE ON public.admin_api_previews
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER admin_api_idempotency_updated_at BEFORE UPDATE ON public.admin_api_idempotency
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER admin_api_scheduled_jobs_updated_at BEFORE UPDATE ON public.admin_api_scheduled_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();