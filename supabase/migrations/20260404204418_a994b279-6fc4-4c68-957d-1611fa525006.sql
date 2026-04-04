
-- Add creator_id column to social_posts
ALTER TABLE public.social_posts ADD COLUMN creator_id uuid DEFAULT NULL;

-- Create social_creators table
CREATE TABLE public.social_creators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  handle text NOT NULL,
  accent_color text DEFAULT 'hsl(0, 70%, 50%)',
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.social_creators ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage creators" ON public.social_creators FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Creators readable" ON public.social_creators FOR SELECT TO authenticated
  USING (true);

-- Add FK from social_posts to social_creators
ALTER TABLE public.social_posts
  ADD CONSTRAINT social_posts_creator_id_fkey
  FOREIGN KEY (creator_id) REFERENCES public.social_creators(id) ON DELETE SET NULL;
