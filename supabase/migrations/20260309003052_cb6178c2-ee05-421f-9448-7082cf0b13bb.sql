ALTER TABLE public.runs 
ADD COLUMN target_score integer NOT NULL DEFAULT 21,
ADD COLUMN team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,
ADD COLUMN milestones jsonb NOT NULL DEFAULT '[]'::jsonb;