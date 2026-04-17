CREATE TABLE IF NOT EXISTS public.user_collection_claims (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  collection_id UUID REFERENCES public.collections(id) ON DELETE CASCADE,
  sub_collection_id UUID REFERENCES public.sub_collections(id) ON DELETE CASCADE,
  reward_type TEXT NOT NULL,
  claimed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT user_collection_claims_target_chk CHECK (
    (collection_id IS NOT NULL) OR (sub_collection_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS user_collection_claims_unique
  ON public.user_collection_claims (
    user_id,
    COALESCE(collection_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(sub_collection_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

ALTER TABLE public.user_collection_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own collection claims"
  ON public.user_collection_claims
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own collection claims"
  ON public.user_collection_claims
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins manage collection claims"
  ON public.user_collection_claims
  FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));