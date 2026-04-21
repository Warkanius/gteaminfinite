
-- 1. location_accounts
CREATE TABLE public.location_accounts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  handle TEXT NOT NULL UNIQUE,
  avatar_url TEXT,
  accent_color TEXT DEFAULT 'hsl(280, 70%, 50%)',
  personality TEXT NOT NULL DEFAULT 'hype',
  location_type TEXT NOT NULL DEFAULT 'league',
  road_name TEXT,
  run_id UUID REFERENCES public.runs(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.location_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage location accounts"
ON public.location_accounts FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated read location accounts"
ON public.location_accounts FOR SELECT TO authenticated
USING (true);

CREATE TRIGGER update_location_accounts_updated_at
BEFORE UPDATE ON public.location_accounts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_location_accounts_road ON public.location_accounts(road_name) WHERE road_name IS NOT NULL;
CREATE INDEX idx_location_accounts_run ON public.location_accounts(run_id) WHERE run_id IS NOT NULL;
CREATE INDEX idx_location_accounts_type ON public.location_accounts(location_type);

-- 2. location_records
CREATE TABLE public.location_records (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  location_account_id UUID NOT NULL REFERENCES public.location_accounts(id) ON DELETE CASCADE,
  games_played INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  current_streak INTEGER NOT NULL DEFAULT 0,
  longest_win_streak INTEGER NOT NULL DEFAULT 0,
  high_score INTEGER NOT NULL DEFAULT 0,
  biggest_blowout INTEGER NOT NULL DEFAULT 0,
  last_played_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, location_account_id)
);

ALTER TABLE public.location_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own location records"
ON public.location_records FOR SELECT TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Users insert own location records"
ON public.location_records FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own location records"
ON public.location_records FOR UPDATE TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "Admins read all location records"
ON public.location_records FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_location_records_updated_at
BEFORE UPDATE ON public.location_records
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. location_post_templates
CREATE TABLE public.location_post_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  personality TEXT NOT NULL,
  event_type TEXT NOT NULL,
  template_text TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.location_post_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage post templates"
ON public.location_post_templates FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Authenticated read post templates"
ON public.location_post_templates FOR SELECT TO authenticated
USING (true);

CREATE TRIGGER update_location_post_templates_updated_at
BEFORE UPDATE ON public.location_post_templates
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_post_templates_lookup ON public.location_post_templates(personality, event_type, is_active);

-- 4. Extend social_posts
ALTER TABLE public.social_posts
  ADD COLUMN IF NOT EXISTS location_account_id UUID REFERENCES public.location_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS event_type TEXT;

CREATE INDEX IF NOT EXISTS idx_social_posts_location ON public.social_posts(location_account_id) WHERE location_account_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_social_posts_event_type ON public.social_posts(event_type) WHERE event_type IS NOT NULL;

-- 5. Seed rule_config keys (only insert if not present)
INSERT INTO public.rule_config (key, value, description)
VALUES
  ('signing_min_gem_tier', '"Diamond"'::jsonb, 'Minimum gem tier name required for a card entering a user collection to trigger a signing post.'),
  ('runs_appearance_min_gem_tier', '"Pink Diamond"'::jsonb, 'Minimum gem tier name required for a card appearing in a Runs lineup to trigger an appearance post.'),
  ('notable_performance_thresholds', '{"points":25,"assists":10,"rebounds":10,"stocks":6,"double_double":true}'::jsonb, 'Stat thresholds that mark a Domination performance as "notable" in the post copy.'),
  ('signing_post_cooldown_minutes', '5'::jsonb, 'Per-user cooldown between signing posts, in minutes.'),
  ('appearance_cooldown_hours', '24'::jsonb, 'Per-card-per-run cooldown between appearance posts, in hours.'),
  ('league_signings_account_id', 'null'::jsonb, 'UUID (string) of the league-wide location_accounts row used for signings and orphan events. Set in admin once an account is created.'),
  ('personalities_enum', '["hype","analyst","trash_talker","historian","meme"]'::jsonb, 'Allowed personality keys for location accounts and post templates.')
ON CONFLICT (key) DO NOTHING;
