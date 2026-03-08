
-- Table: card_game_stats
CREATE TABLE public.card_game_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_log_id uuid NOT NULL REFERENCES public.game_logs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  player_card_id uuid NOT NULL REFERENCES public.player_cards(id) ON DELETE CASCADE,
  side text NOT NULL DEFAULT 'user',
  stat_3pt numeric NOT NULL DEFAULT 0,
  stat_mid numeric NOT NULL DEFAULT 0,
  stat_fin numeric NOT NULL DEFAULT 0,
  stat_dnk numeric NOT NULL DEFAULT 0,
  stat_ast numeric NOT NULL DEFAULT 0,
  stat_stl numeric NOT NULL DEFAULT 0,
  stat_reb numeric NOT NULL DEFAULT 0,
  stat_blk numeric NOT NULL DEFAULT 0,
  stat_int numeric NOT NULL DEFAULT 0,
  points_scored numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.card_game_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own card game stats"
  ON public.card_game_stats FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own card game stats"
  ON public.card_game_stats FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Table: domination_game_players
CREATE TABLE public.domination_game_players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domination_game_id uuid NOT NULL REFERENCES public.domination_games(id) ON DELETE CASCADE,
  player_card_id uuid NOT NULL REFERENCES public.player_cards(id) ON DELETE CASCADE,
  slot integer NOT NULL DEFAULT 1
);

ALTER TABLE public.domination_game_players ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage dom game players"
  ON public.domination_game_players FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Dom game players readable"
  ON public.domination_game_players FOR SELECT
  TO authenticated
  USING (true);
