
-- Headline columns for social posts
ALTER TABLE public.social_posts
  ADD COLUMN IF NOT EXISTS is_headline boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS headline_rank integer,
  ADD COLUMN IF NOT EXISTS headline_image_url text;

CREATE INDEX IF NOT EXISTS idx_social_posts_headline
  ON public.social_posts (headline_rank)
  WHERE is_headline = true;

-- Storylines table
CREATE TABLE IF NOT EXISTS public.storylines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  summary text,
  arc_image_url text,
  status text NOT NULL DEFAULT 'draft',
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.storylines TO authenticated;
GRANT ALL ON public.storylines TO service_role;

ALTER TABLE public.storylines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Storylines readable by authenticated"
  ON public.storylines FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage storylines"
  ON public.storylines FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER update_storylines_updated_at
  BEFORE UPDATE ON public.storylines
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Storyline entity links
CREATE TABLE IF NOT EXISTS public.storyline_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storyline_id uuid NOT NULL REFERENCES public.storylines(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_storyline_entities_storyline
  ON public.storyline_entities (storyline_id);
CREATE INDEX IF NOT EXISTS idx_storyline_entities_entity
  ON public.storyline_entities (entity_type, entity_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.storyline_entities TO authenticated;
GRANT ALL ON public.storyline_entities TO service_role;

ALTER TABLE public.storyline_entities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Storyline entities readable by authenticated"
  ON public.storyline_entities FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage storyline entities"
  ON public.storyline_entities FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
