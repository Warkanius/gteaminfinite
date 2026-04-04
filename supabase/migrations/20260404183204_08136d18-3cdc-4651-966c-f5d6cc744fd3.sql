
-- Add social_handle to player_cards
ALTER TABLE public.player_cards ADD COLUMN social_handle text;

-- Create social_posts table
CREATE TABLE public.social_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_card_id uuid REFERENCES public.player_cards(id) ON DELETE SET NULL,
  content text NOT NULL,
  image_url text,
  likes_count integer NOT NULL DEFAULT 0,
  comments_count integer NOT NULL DEFAULT 0,
  post_type text NOT NULL DEFAULT 'tweet',
  posted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.social_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage social posts" ON public.social_posts FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Social posts readable" ON public.social_posts FOR SELECT TO authenticated USING (true);
