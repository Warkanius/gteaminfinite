CREATE OR REPLACE FUNCTION public.player_cards_autofill_card_key()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_base text; v_key text; v_i int := 1;
BEGIN
  IF NEW.card_key IS NOT NULL AND btrim(NEW.card_key) <> '' THEN
    RETURN NEW;
  END IF;
  v_base := nullif(public.admin_slugify(NEW.name), '');
  IF v_base IS NULL THEN v_base := 'card-' || left(NEW.id::text, 8); END IF;
  v_key := v_base;
  WHILE EXISTS (SELECT 1 FROM public.player_cards WHERE lower(card_key) = lower(v_key)) LOOP
    v_i := v_i + 1;
    v_key := v_base || '-' || v_i;
  END LOOP;
  NEW.card_key := v_key;
  RETURN NEW;
END $$;

ALTER TABLE public.player_cards ALTER COLUMN card_key SET DEFAULT '';

DROP TRIGGER IF EXISTS trg_player_cards_autofill_card_key ON public.player_cards;
CREATE TRIGGER trg_player_cards_autofill_card_key
BEFORE INSERT ON public.player_cards
FOR EACH ROW EXECUTE FUNCTION public.player_cards_autofill_card_key();