
ALTER TABLE public.challenges
  ADD COLUMN opponent_team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  ADD COLUMN win_condition text NOT NULL DEFAULT 'win',
  ADD COLUMN win_by_amount integer,
  ADD COLUMN series_length integer,
  ADD COLUMN series_win_coins integer NOT NULL DEFAULT 0,
  ADD COLUMN series_loss_coins integer NOT NULL DEFAULT 0,
  ADD COLUMN stat_limit_player_id uuid REFERENCES public.player_cards(id) ON DELETE SET NULL,
  ADD COLUMN stat_limit_stat text,
  ADD COLUMN stat_limit_value integer,
  ADD COLUMN pack_reward text,
  ADD COLUMN card_reward_id uuid REFERENCES public.player_cards(id) ON DELETE SET NULL,
  ADD COLUMN prerequisite_id uuid REFERENCES public.challenges(id) ON DELETE SET NULL,
  ADD COLUMN spotlight_group text,
  ADD COLUMN sort_order integer NOT NULL DEFAULT 0;
