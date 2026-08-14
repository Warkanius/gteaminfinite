-- ============================================================
-- GTeam Insider foundation: saved lineups + card preferences
-- ============================================================

CREATE TABLE public.player_lineups (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  name text NOT NULL,
  mode text NOT NULL DEFAULT '5v5',
  is_default boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT player_lineups_mode_check CHECK (mode IN ('5v5','runs')),
  CONSTRAINT player_lineups_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 60)
);

CREATE INDEX player_lineups_user_idx ON public.player_lineups (user_id, mode);
CREATE UNIQUE INDEX player_lineups_one_default_per_mode
  ON public.player_lineups (user_id, mode) WHERE is_default;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.player_lineups TO authenticated;
GRANT ALL ON public.player_lineups TO service_role;
ALTER TABLE public.player_lineups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Players read own lineups" ON public.player_lineups
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Players create own lineups" ON public.player_lineups
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Players update own lineups" ON public.player_lineups
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Players delete own lineups" ON public.player_lineups
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE TRIGGER player_lineups_updated_at BEFORE UPDATE ON public.player_lineups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


CREATE TABLE public.player_lineup_slots (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  lineup_id uuid NOT NULL REFERENCES public.player_lineups(id) ON DELETE CASCADE,
  slot integer NOT NULL,
  player_card_id uuid NOT NULL REFERENCES public.player_cards(id) ON DELETE CASCADE,
  evo_card_version_id uuid REFERENCES public.evo_card_versions(id) ON DELETE SET NULL,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT player_lineup_slots_slot_range CHECK (slot BETWEEN 1 AND 5)
);

CREATE UNIQUE INDEX player_lineup_slots_unique_slot ON public.player_lineup_slots (lineup_id, slot);
CREATE UNIQUE INDEX player_lineup_slots_no_duplicate_card ON public.player_lineup_slots (lineup_id, player_card_id);
CREATE INDEX player_lineup_slots_lineup_idx ON public.player_lineup_slots (lineup_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.player_lineup_slots TO authenticated;
GRANT ALL ON public.player_lineup_slots TO service_role;
ALTER TABLE public.player_lineup_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Players read own lineup slots" ON public.player_lineup_slots
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.player_lineups l WHERE l.id = lineup_id AND l.user_id = auth.uid()));
CREATE POLICY "Players create own lineup slots" ON public.player_lineup_slots
  FOR INSERT TO authenticated WITH CHECK (EXISTS (
    SELECT 1 FROM public.player_lineups l WHERE l.id = lineup_id AND l.user_id = auth.uid()));
CREATE POLICY "Players update own lineup slots" ON public.player_lineup_slots
  FOR UPDATE TO authenticated USING (EXISTS (
    SELECT 1 FROM public.player_lineups l WHERE l.id = lineup_id AND l.user_id = auth.uid()))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.player_lineups l WHERE l.id = lineup_id AND l.user_id = auth.uid()));
CREATE POLICY "Players delete own lineup slots" ON public.player_lineup_slots
  FOR DELETE TO authenticated USING (EXISTS (
    SELECT 1 FROM public.player_lineups l WHERE l.id = lineup_id AND l.user_id = auth.uid()));

CREATE TRIGGER player_lineup_slots_updated_at BEFORE UPDATE ON public.player_lineup_slots
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- Server-side ownership + playability enforcement. RLS proves the slot belongs
-- to the caller's lineup; this trigger proves the CARD belongs to the caller and
-- that any evo version referenced is a real, playable version of that card.
CREATE OR REPLACE FUNCTION public.player_lineup_slots_validate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
BEGIN
  SELECT user_id INTO v_owner FROM public.player_lineups WHERE id = NEW.lineup_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'LINEUP_NOT_FOUND: lineup % does not exist', NEW.lineup_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_collections uc
    WHERE uc.user_id = v_owner AND uc.player_card_id = NEW.player_card_id
  ) THEN
    RAISE EXCEPTION 'CARD_NOT_OWNED: card % is not in this player''s collection', NEW.player_card_id;
  END IF;

  IF NEW.evo_card_version_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.evo_card_versions v
      JOIN public.evo_paths p ON p.id = v.evo_path_id
      WHERE v.id = NEW.evo_card_version_id
        AND v.status = 'active'
        AND (v.base_player_card_id = NEW.player_card_id OR p.player_card_id = NEW.player_card_id)
    ) THEN
      RAISE EXCEPTION 'INVALID_CARD_VERSION: evo version % is not a playable version of card %',
        NEW.evo_card_version_id, NEW.player_card_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER player_lineup_slots_validate_trg
  BEFORE INSERT OR UPDATE ON public.player_lineup_slots
  FOR EACH ROW EXECUTE FUNCTION public.player_lineup_slots_validate();


CREATE TABLE public.player_card_preferences (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  player_card_id uuid NOT NULL REFERENCES public.player_cards(id) ON DELETE CASCADE,
  favorite boolean NOT NULL DEFAULT false,
  evo_priority integer,
  grinding boolean NOT NULL DEFAULT false,
  core_player boolean NOT NULL DEFAULT false,
  do_not_recommend boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT player_card_preferences_priority_range CHECK (evo_priority IS NULL OR evo_priority BETWEEN 1 AND 99)
);

CREATE UNIQUE INDEX player_card_preferences_unique ON public.player_card_preferences (user_id, player_card_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.player_card_preferences TO authenticated;
GRANT ALL ON public.player_card_preferences TO service_role;
ALTER TABLE public.player_card_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Players read own card preferences" ON public.player_card_preferences
  FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Players create own card preferences" ON public.player_card_preferences
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "Players update own card preferences" ON public.player_card_preferences
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "Players delete own card preferences" ON public.player_card_preferences
  FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE TRIGGER player_card_preferences_updated_at BEFORE UPDATE ON public.player_card_preferences
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- Atomic default switch: clears the previous default for that mode.
CREATE OR REPLACE FUNCTION public.set_default_lineup(p_lineup_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_mode text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED: no authenticated user';
  END IF;

  SELECT mode INTO v_mode FROM public.player_lineups WHERE id = p_lineup_id AND user_id = v_uid;
  IF v_mode IS NULL THEN
    RAISE EXCEPTION 'LINEUP_NOT_FOUND: lineup % not found for this player', p_lineup_id;
  END IF;

  UPDATE public.player_lineups SET is_default = false
    WHERE user_id = v_uid AND mode = v_mode AND id <> p_lineup_id AND is_default;
  UPDATE public.player_lineups SET is_default = true WHERE id = p_lineup_id;

  RETURN jsonb_build_object('lineup_id', p_lineup_id, 'mode', v_mode, 'is_default', true);
END;
$$;

REVOKE ALL ON FUNCTION public.set_default_lineup(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.set_default_lineup(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_default_lineup(uuid) TO service_role;