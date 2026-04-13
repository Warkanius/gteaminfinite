
-- Create run_rank_rewards table
CREATE TABLE public.run_rank_rewards (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  rank_name TEXT NOT NULL UNIQUE,
  wins_required INTEGER NOT NULL,
  coin_reward INTEGER NOT NULL DEFAULT 0,
  gem_reward INTEGER NOT NULL DEFAULT 0,
  pack_reward TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE public.run_rank_rewards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage rank rewards" ON public.run_rank_rewards FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Rank rewards readable" ON public.run_rank_rewards FOR SELECT TO authenticated USING (true);

-- Create user_rank_claims table
CREATE TABLE public.user_rank_claims (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  rank_name TEXT NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, rank_name)
);

ALTER TABLE public.user_rank_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users insert own rank claims" ON public.user_rank_claims FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users read own rank claims" ON public.user_rank_claims FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- Seed 25 rank tiers
INSERT INTO public.run_rank_rewards (rank_name, wins_required, coin_reward, gem_reward, pack_reward, sort_order) VALUES
  ('Nobody I',    1,    100,   0,  '',                  1),
  ('Nobody II',   5,    250,   0,  '',                  2),
  ('Nobody III',  10,   500,   0,  '',                  3),
  ('Nobody IV',   15,   1000,  0,  '',                  4),
  ('Nobody V',    20,   2000,  0,  '',                  5),
  ('Regular I',   25,   2500,  0,  'random_standard',   6),
  ('Regular II',  35,   3000,  0,  '',                  7),
  ('Regular III', 45,   3500,  0,  '',                  8),
  ('Regular IV',  55,   4000,  0,  '',                  9),
  ('Regular V',   65,   5000,  5,  'random_standard',   10),
  ('Hooper I',    75,   6000,  0,  '',                  11),
  ('Hooper II',   90,   7000,  0,  '',                  12),
  ('Hooper III',  105,  8000,  0,  'random_standard',   13),
  ('Hooper IV',   120,  9000,  0,  '',                  14),
  ('Hooper V',    135,  10000, 10, 'random_standard',   15),
  ('Top Pick I',  150,  12000, 0,  'random_standard_box', 16),
  ('Top Pick II', 170,  14000, 0,  '',                  17),
  ('Top Pick III',190,  16000, 0,  'random_standard',   18),
  ('Top Pick IV', 210,  18000, 0,  '',                  19),
  ('Top Pick V',  230,  20000, 15, 'random_standard_box', 20),
  ('Legend I',    250,  25000, 0,  'random_standard_box', 21),
  ('Legend II',   350,  30000, 0,  'random_standard',   22),
  ('Legend III',  500,  40000, 20, 'random_standard_box', 23),
  ('Legend IV',   725,  50000, 0,  'random_standard_box', 24),
  ('Legend V',    1000, 75000, 25, 'random_standard_box', 25);
