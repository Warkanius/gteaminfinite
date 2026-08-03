ALTER TABLE public.release_bundles
  ADD COLUMN IF NOT EXISTS version_label text,
  ADD COLUMN IF NOT EXISTS version_number integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS parent_release_id uuid REFERENCES public.release_bundles(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS release_bundles_name_version_idx
  ON public.release_bundles (lower(name), version_number);

CREATE INDEX IF NOT EXISTS release_bundles_parent_idx
  ON public.release_bundles (parent_release_id);