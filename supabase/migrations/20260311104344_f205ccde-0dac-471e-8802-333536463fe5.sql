
CREATE TABLE public.run_players (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.runs(id) ON DELETE CASCADE,
  player_card_id uuid NOT NULL REFERENCES public.player_cards(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, player_card_id)
);

ALTER TABLE public.run_players ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage run players" ON public.run_players FOR ALL TO authenticated USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Run players readable" ON public.run_players FOR SELECT TO authenticated USING (true);
