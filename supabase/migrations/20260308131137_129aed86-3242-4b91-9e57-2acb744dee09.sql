
CREATE TABLE public.pack_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  pack_id uuid REFERENCES public.packs(id) NOT NULL,
  cards_pulled jsonb NOT NULL DEFAULT '[]'::jsonb,
  quantity integer NOT NULL DEFAULT 1,
  coins_spent integer NOT NULL DEFAULT 0,
  purchased_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.pack_purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own purchases"
  ON public.pack_purchases FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
