
INSERT INTO storage.buckets (id, name, public)
VALUES ('social-images', 'social-images', true);

CREATE POLICY "Anyone can view social images"
ON storage.objects FOR SELECT
USING (bucket_id = 'social-images');

CREATE POLICY "Authenticated users can upload social images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'social-images');

CREATE POLICY "Authenticated users can delete social images"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'social-images');
