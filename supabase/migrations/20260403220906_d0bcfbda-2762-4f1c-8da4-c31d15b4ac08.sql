
-- Locker Codes table
CREATE TABLE public.locker_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  reward_type text NOT NULL DEFAULT 'coins',
  reward_value jsonb NOT NULL DEFAULT '{}',
  max_redemptions integer,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.locker_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage locker codes" ON public.locker_codes
FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Locker codes readable" ON public.locker_codes
FOR SELECT TO authenticated USING (true);

-- Locker Code Redemptions table
CREATE TABLE public.locker_code_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  locker_code_id uuid NOT NULL REFERENCES public.locker_codes(id) ON DELETE CASCADE,
  redeemed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, locker_code_id)
);

ALTER TABLE public.locker_code_redemptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own redemptions" ON public.locker_code_redemptions
FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users insert own redemptions" ON public.locker_code_redemptions
FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- Evo Paths table
CREATE TABLE public.evo_paths (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_card_id uuid NOT NULL REFERENCES public.player_cards(id) ON DELETE CASCADE,
  from_tier_id uuid REFERENCES public.gem_tiers(id),
  to_tier_id uuid REFERENCES public.gem_tiers(id),
  step_order integer NOT NULL DEFAULT 1,
  challenge_description text NOT NULL DEFAULT '',
  challenge_type text NOT NULL DEFAULT 'points_scored',
  challenge_target integer NOT NULL DEFAULT 100,
  stat_boosts jsonb NOT NULL DEFAULT '{}',
  new_badges jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.evo_paths ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage evo paths" ON public.evo_paths
FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Evo paths readable" ON public.evo_paths
FOR SELECT TO authenticated USING (true);

-- User Evo Progress table
CREATE TABLE public.user_evo_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  player_card_id uuid NOT NULL REFERENCES public.player_cards(id) ON DELETE CASCADE,
  evo_path_id uuid NOT NULL REFERENCES public.evo_paths(id) ON DELETE CASCADE,
  current_value integer NOT NULL DEFAULT 0,
  completed boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.user_evo_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own evo progress" ON public.user_evo_progress
FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Users insert own evo progress" ON public.user_evo_progress
FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own evo progress" ON public.user_evo_progress
FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- Auction Listings table
CREATE TABLE public.auction_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_card_id uuid NOT NULL REFERENCES public.player_cards(id) ON DELETE CASCADE,
  seller_type text NOT NULL DEFAULT 'bot',
  price integer NOT NULL DEFAULT 0,
  listed_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '1 hour'),
  bought_by uuid REFERENCES auth.users(id),
  bought_at timestamptz,
  is_active boolean NOT NULL DEFAULT true
);

ALTER TABLE public.auction_listings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Auction listings readable" ON public.auction_listings
FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage auction listings" ON public.auction_listings
FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));
