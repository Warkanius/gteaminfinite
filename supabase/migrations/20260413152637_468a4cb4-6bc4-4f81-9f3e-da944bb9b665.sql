
CREATE TABLE public.team_players (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  team_id uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  player_card_id uuid NOT NULL REFERENCES public.player_cards(id) ON DELETE CASCADE,
  slot integer NOT NULL DEFAULT 1,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (team_id, player_card_id)
);

ALTER TABLE public.team_players ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Team players readable" ON public.team_players
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage team players" ON public.team_players
  FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
