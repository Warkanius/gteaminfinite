
CREATE TABLE public.user_pack_inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  pack_id uuid REFERENCES public.packs(id) ON DELETE CASCADE NOT NULL,
  source text NOT NULL DEFAULT 'locker_code',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_pack_inventory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own pack inventory"
  ON public.user_pack_inventory
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own pack inventory"
  ON public.user_pack_inventory
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins manage pack inventory"
  ON public.user_pack_inventory
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));
