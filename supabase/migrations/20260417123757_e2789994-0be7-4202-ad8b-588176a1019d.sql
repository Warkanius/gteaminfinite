-- 1) Reward fields on collections + sub_collections
ALTER TABLE public.collections
  ADD COLUMN IF NOT EXISTS reward_type TEXT NOT NULL DEFAULT 'card',
  ADD COLUMN IF NOT EXISTS reward_coins INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reward_gems INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reward_pack_id UUID REFERENCES public.packs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS gem_tier_id UUID REFERENCES public.gem_tiers(id) ON DELETE SET NULL;

ALTER TABLE public.sub_collections
  ADD COLUMN IF NOT EXISTS reward_type TEXT NOT NULL DEFAULT 'card',
  ADD COLUMN IF NOT EXISTS reward_coins INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reward_gems INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reward_pack_id UUID REFERENCES public.packs(id) ON DELETE SET NULL;

-- One auto-collection per gem tier
CREATE UNIQUE INDEX IF NOT EXISTS collections_gem_tier_unique
  ON public.collections (gem_tier_id)
  WHERE gem_tier_id IS NOT NULL;

-- 2) Sync function: ensure tier collection exists, then resync membership for that tier
CREATE OR REPLACE FUNCTION public.sync_gem_tier_collection(p_tier_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tier_name TEXT;
  v_collection_id UUID;
BEGIN
  IF p_tier_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT name INTO v_tier_name FROM public.gem_tiers WHERE id = p_tier_id;
  IF v_tier_name IS NULL THEN
    RETURN NULL;
  END IF;

  -- Ensure a collection exists for this tier
  SELECT id INTO v_collection_id
  FROM public.collections
  WHERE gem_tier_id = p_tier_id;

  IF v_collection_id IS NULL THEN
    INSERT INTO public.collections (name, description, gem_tier_id)
    VALUES (
      'Gem Market: ' || v_tier_name,
      'Auto-managed collection of all ' || v_tier_name || ' gem market cards.',
      p_tier_id
    )
    RETURNING id INTO v_collection_id;
  ELSE
    -- Keep name in sync if the tier was renamed
    UPDATE public.collections
    SET name = 'Gem Market: ' || v_tier_name
    WHERE id = v_collection_id
      AND name <> 'Gem Market: ' || v_tier_name;
  END IF;

  -- Add cards currently in this tier's listings to the collection (top-level, no sub)
  UPDATE public.player_cards pc
  SET collection_id = v_collection_id,
      sub_collection_id = NULL
  WHERE pc.id IN (
    SELECT player_card_id FROM public.gem_market_listings WHERE gem_tier_id = p_tier_id
  )
  AND (pc.collection_id IS DISTINCT FROM v_collection_id OR pc.sub_collection_id IS NOT NULL);

  -- Remove cards from this collection that are NO LONGER listed in this tier
  UPDATE public.player_cards pc
  SET collection_id = NULL
  WHERE pc.collection_id = v_collection_id
    AND pc.id NOT IN (
      SELECT player_card_id FROM public.gem_market_listings WHERE gem_tier_id = p_tier_id
    );

  RETURN v_collection_id;
END;
$$;

-- 3) Trigger function reacting to gem_market_listings changes
CREATE OR REPLACE FUNCTION public.trg_gem_market_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.sync_gem_tier_collection(NEW.gem_tier_id);
  ELSIF TG_OP = 'UPDATE' THEN
    PERFORM public.sync_gem_tier_collection(NEW.gem_tier_id);
    IF OLD.gem_tier_id IS DISTINCT FROM NEW.gem_tier_id THEN
      PERFORM public.sync_gem_tier_collection(OLD.gem_tier_id);
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.sync_gem_tier_collection(OLD.gem_tier_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS gem_market_listings_sync ON public.gem_market_listings;
CREATE TRIGGER gem_market_listings_sync
AFTER INSERT OR UPDATE OR DELETE ON public.gem_market_listings
FOR EACH ROW
EXECUTE FUNCTION public.trg_gem_market_sync();

-- 4) Backfill: create + populate collection for every tier that already has listings
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT DISTINCT gem_tier_id FROM public.gem_market_listings WHERE gem_tier_id IS NOT NULL LOOP
    PERFORM public.sync_gem_tier_collection(r.gem_tier_id);
  END LOOP;
END $$;