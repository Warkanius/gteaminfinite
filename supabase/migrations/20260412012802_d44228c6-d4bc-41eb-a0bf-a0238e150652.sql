
-- 1. Create gem_market_listings table
CREATE TABLE public.gem_market_listings (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  player_card_id uuid NOT NULL REFERENCES public.player_cards(id) ON DELETE CASCADE,
  gem_tier_id uuid NOT NULL REFERENCES public.gem_tiers(id) ON DELETE CASCADE,
  gem_value integer NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(player_card_id)
);

ALTER TABLE public.gem_market_listings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage gem market listings"
  ON public.gem_market_listings FOR ALL
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Gem market listings readable by authenticated"
  ON public.gem_market_listings FOR SELECT
  TO authenticated
  USING (true);

-- 2. Seed gem_market_listings from current player_cards with gem_tier_id
INSERT INTO public.gem_market_listings (player_card_id, gem_tier_id, gem_value, sort_order)
SELECT pc.id, pc.gem_tier_id, COALESCE(gt.gem_value, 0), ROW_NUMBER() OVER (PARTITION BY pc.gem_tier_id ORDER BY pc.name)
FROM public.player_cards pc
JOIN public.gem_tiers gt ON gt.id = pc.gem_tier_id
WHERE pc.gem_tier_id IS NOT NULL;

-- 3. Add pack_id column to pack_odds for per-pack odds
ALTER TABLE public.pack_odds ADD COLUMN pack_id uuid REFERENCES public.packs(id) ON DELETE CASCADE;

-- 4. Fix Shutoku I bad pack_reward text value
UPDATE public.domination_games
SET pack_reward = '19865154-d575-4ad7-8d0a-f20986cea6f7'
WHERE id = 'b2978bd7-0e03-4c55-a424-d3c1e44739d4' AND pack_reward = 'reward';
