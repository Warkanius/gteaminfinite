
-- Add lineup_restrictions to challenges
ALTER TABLE public.challenges ADD COLUMN lineup_restrictions jsonb DEFAULT NULL;

-- Create collections table
CREATE TABLE public.collections (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  description text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.collections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage collections" ON public.collections FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Collections readable" ON public.collections FOR SELECT TO authenticated
  USING (true);

-- Create sub_collections table
CREATE TABLE public.sub_collections (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  collection_id uuid NOT NULL REFERENCES public.collections(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.sub_collections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage sub_collections" ON public.sub_collections FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Sub collections readable" ON public.sub_collections FOR SELECT TO authenticated
  USING (true);

-- Add collection fields to player_cards
ALTER TABLE public.player_cards ADD COLUMN collection_id uuid REFERENCES public.collections(id) ON DELETE SET NULL DEFAULT NULL;
ALTER TABLE public.player_cards ADD COLUMN sub_collection_id uuid REFERENCES public.sub_collections(id) ON DELETE SET NULL DEFAULT NULL;
