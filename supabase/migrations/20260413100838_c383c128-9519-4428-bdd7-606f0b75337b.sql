
-- Admin can SELECT all user_collections
CREATE POLICY "Admins can view all collections"
ON public.user_collections
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Admin can INSERT into any user's collection
CREATE POLICY "Admins can add to collections"
ON public.user_collections
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Admin can DELETE from any user's collection
CREATE POLICY "Admins can remove from collections"
ON public.user_collections
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- Admin can UPDATE any user's collection
CREATE POLICY "Admins can update collections"
ON public.user_collections
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));
