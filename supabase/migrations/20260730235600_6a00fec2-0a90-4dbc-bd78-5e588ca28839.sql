CREATE TABLE public.oauth_bridge_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  state text NOT NULL UNIQUE,
  code_verifier text NOT NULL,
  client_redirect_uri text NOT NULL,
  auth_code text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.oauth_bridge_sessions TO service_role;
ALTER TABLE public.oauth_bridge_sessions ENABLE ROW LEVEL SECURITY;
CREATE INDEX oauth_bridge_sessions_created_at_idx ON public.oauth_bridge_sessions (created_at);