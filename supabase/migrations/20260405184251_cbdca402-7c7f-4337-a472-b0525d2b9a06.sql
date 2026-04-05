ALTER TABLE public.evo_paths ADD COLUMN compound_challenges jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.user_evo_progress ADD COLUMN compound_progress jsonb NOT NULL DEFAULT '{}'::jsonb;