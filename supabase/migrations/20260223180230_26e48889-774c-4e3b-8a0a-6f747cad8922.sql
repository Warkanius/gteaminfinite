
-- ============================================
-- GTeam Infinite - Full Database Schema
-- ============================================

-- Role enum and user_roles table
CREATE TYPE public.app_role AS ENUM ('admin', 'player');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL DEFAULT 'player',
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer function for role checks
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- RLS: users can read their own roles, admins can read all
CREATE POLICY "Users can read own roles" ON public.user_roles
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can manage roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Auto-assign player role on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'player');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  display_name TEXT,
  avatar_url TEXT,
  coins INTEGER NOT NULL DEFAULT 0,
  gems INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles viewable by authenticated" ON public.profiles
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users update own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own profile" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user_profile()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email));
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_profile();

-- Gem tiers
CREATE TABLE public.gem_tiers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  stars INTEGER NOT NULL DEFAULT 0,
  roll_modifier NUMERIC NOT NULL DEFAULT 0,
  doubles_modifier NUMERIC,
  color TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  gem_value INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE public.gem_tiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Gem tiers readable by all authenticated" ON public.gem_tiers
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage gem tiers" ON public.gem_tiers
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Badges
CREATE TABLE public.badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  abbreviation TEXT NOT NULL,
  description_base TEXT,
  description_gold TEXT,
  description_hof TEXT,
  description_diamond TEXT,
  description_actolytrene TEXT,
  affected_stat TEXT,
  effect_type TEXT NOT NULL DEFAULT 'reroll',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.badges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Badges readable by authenticated" ON public.badges
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage badges" ON public.badges
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Signature traits
CREATE TABLE public.signature_traits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  abbreviation TEXT NOT NULL,
  description_base TEXT,
  description_gold TEXT,
  description_hof TEXT,
  description_diamond TEXT,
  description_actolytrene TEXT,
  condition_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.signature_traits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Traits readable by authenticated" ON public.signature_traits
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage traits" ON public.signature_traits
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Teams
CREATE TABLE public.teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'domination',
  unlock_cost INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Teams readable by authenticated" ON public.teams
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage teams" ON public.teams
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Player cards (the core entity)
CREATE TABLE public.player_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  gem_tier_id UUID REFERENCES public.gem_tiers(id),
  gem_name TEXT,
  team_id UUID REFERENCES public.teams(id),
  position1 TEXT,
  position2 TEXT,
  rating NUMERIC NOT NULL DEFAULT 0,
  stat_3pt INTEGER NOT NULL DEFAULT 0,
  stat_mid INTEGER NOT NULL DEFAULT 0,
  stat_fin INTEGER NOT NULL DEFAULT 0,
  stat_dnk INTEGER NOT NULL DEFAULT 0,
  stat_ast INTEGER NOT NULL DEFAULT 0,
  stat_stl INTEGER NOT NULL DEFAULT 0,
  stat_reb INTEGER NOT NULL DEFAULT 0,
  stat_blk INTEGER NOT NULL DEFAULT 0,
  stat_int INTEGER NOT NULL DEFAULT 0,
  is_collection_reward BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.player_cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Player cards readable by authenticated" ON public.player_cards
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage player cards" ON public.player_cards
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Player card badges (junction)
CREATE TABLE public.player_card_badges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_card_id UUID REFERENCES public.player_cards(id) ON DELETE CASCADE NOT NULL,
  badge_id UUID REFERENCES public.badges(id) ON DELETE CASCADE NOT NULL,
  tier TEXT NOT NULL DEFAULT 'base'
);
ALTER TABLE public.player_card_badges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Card badges readable" ON public.player_card_badges
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage card badges" ON public.player_card_badges
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Player card signature traits (junction)
CREATE TABLE public.player_card_traits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_card_id UUID REFERENCES public.player_cards(id) ON DELETE CASCADE NOT NULL,
  trait_id UUID REFERENCES public.signature_traits(id) ON DELETE CASCADE NOT NULL,
  tier TEXT NOT NULL DEFAULT 'base',
  target_stat TEXT
);
ALTER TABLE public.player_card_traits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Card traits readable" ON public.player_card_traits
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage card traits" ON public.player_card_traits
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Packs
CREATE TABLE public.packs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  cost INTEGER NOT NULL DEFAULT 0,
  pack_type TEXT NOT NULL DEFAULT 'standard',
  ten_box_cost INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.packs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Packs readable" ON public.packs
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage packs" ON public.packs
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Pack players (which players are in which pack)
CREATE TABLE public.pack_players (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id UUID REFERENCES public.packs(id) ON DELETE CASCADE NOT NULL,
  player_card_id UUID REFERENCES public.player_cards(id) ON DELETE CASCADE NOT NULL,
  slot_number INTEGER NOT NULL DEFAULT 1
);
ALTER TABLE public.pack_players ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Pack players readable" ON public.pack_players
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage pack players" ON public.pack_players
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Pack odds
CREATE TABLE public.pack_odds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_type TEXT NOT NULL,
  dice_roll TEXT NOT NULL,
  result_slot TEXT NOT NULL,
  description TEXT
);
ALTER TABLE public.pack_odds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Odds readable" ON public.pack_odds
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage odds" ON public.pack_odds
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Domination road map
CREATE TABLE public.domination_games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  road_name TEXT NOT NULL,
  opponent_name TEXT NOT NULL,
  difficulty_stars INTEGER NOT NULL DEFAULT 1,
  game_order INTEGER NOT NULL,
  coin_reward INTEGER NOT NULL DEFAULT 0,
  pack_reward TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.domination_games ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Dom games readable" ON public.domination_games
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage dom games" ON public.domination_games
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Runs (3v3 locations)
CREATE TABLE public.runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Runs readable" ON public.runs
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage runs" ON public.runs
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Challenges
CREATE TABLE public.challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  challenge_type TEXT NOT NULL DEFAULT 'spotlight',
  conditions JSONB,
  coin_reward INTEGER NOT NULL DEFAULT 0,
  gem_reward INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.challenges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Challenges readable" ON public.challenges
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage challenges" ON public.challenges
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Rule config (key-value for game rules)
CREATE TABLE public.rule_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT NOT NULL UNIQUE,
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.rule_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Rules readable" ON public.rule_config
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage rules" ON public.rule_config
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Player collection (which user owns which cards)
CREATE TABLE public.user_collections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  player_card_id UUID REFERENCES public.player_cards(id) ON DELETE CASCADE NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  evolution_progress JSONB DEFAULT '{}',
  UNIQUE (user_id, player_card_id)
);
ALTER TABLE public.user_collections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own collection" ON public.user_collections
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own collection" ON public.user_collections
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own collection" ON public.user_collections
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- Game logs
CREATE TABLE public.game_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  mode TEXT NOT NULL DEFAULT '5v5',
  opponent_name TEXT,
  user_score NUMERIC NOT NULL DEFAULT 0,
  cpu_score NUMERIC NOT NULL DEFAULT 0,
  won BOOLEAN NOT NULL DEFAULT false,
  player_stats JSONB DEFAULT '[]',
  played_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.game_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own game logs" ON public.game_logs
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own game logs" ON public.game_logs
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_player_cards_updated_at BEFORE UPDATE ON public.player_cards FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_rule_config_updated_at BEFORE UPDATE ON public.rule_config FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
