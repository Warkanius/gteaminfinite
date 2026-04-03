
ALTER TABLE public.user_collections ADD COLUMN is_locked boolean NOT NULL DEFAULT false;

CREATE POLICY "Users delete own collection"
ON public.user_collections
FOR DELETE
TO authenticated
USING (auth.uid() = user_id);
