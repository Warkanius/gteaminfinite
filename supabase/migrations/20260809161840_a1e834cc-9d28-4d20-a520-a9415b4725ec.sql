CREATE OR REPLACE FUNCTION public.admin_resolve_player(p_ref jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ref jsonb := p_ref;
  v_id uuid;
  v_key text;
  v_name text;
  v_n int;
  v_raw text;
BEGIN
  IF v_ref IS NULL OR v_ref = 'null'::jsonb THEN RETURN NULL; END IF;
  IF jsonb_typeof(v_ref) = 'string' THEN
    IF v_ref #>> '{}' ~ '^[0-9a-fA-F-]{36}$' THEN
      v_ref := jsonb_build_object('player_id', v_ref #>> '{}');
    ELSE
      v_ref := jsonb_build_object('player_name', v_ref #>> '{}');
    END IF;
  END IF;
  IF jsonb_typeof(v_ref) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_PLAYER_REF: expected uuid, name, or object {player_card_id|card_key|player_name}';
  END IF;

  -- player_card_id is the canonical field emitted by the admin API; player_id,
  -- card_id and id remain accepted v1 aliases.
  v_raw := coalesce(v_ref->>'player_card_id', v_ref->>'player_id', v_ref->>'card_id', v_ref->>'id');
  IF v_raw IS NOT NULL AND btrim(v_raw) <> '' THEN
    SELECT id INTO v_id FROM player_cards WHERE id = btrim(v_raw)::uuid;
    IF v_id IS NULL THEN RAISE EXCEPTION 'UNKNOWN_PLAYER_ID: no player card with id %', v_raw; END IF;
    RETURN v_id;
  END IF;

  v_key := nullif(btrim(coalesce(v_ref->>'card_key','')), '');
  IF v_key IS NOT NULL THEN
    SELECT id INTO v_id FROM player_cards WHERE lower(card_key) = lower(v_key);
    IF v_id IS NULL THEN RAISE EXCEPTION 'UNKNOWN_CARD_KEY: no player card with card_key "%"', v_key; END IF;
    RETURN v_id;
  END IF;

  v_name := nullif(btrim(coalesce(v_ref->>'player_name', v_ref->>'name','')), '');
  IF v_name IS NULL THEN RAISE EXCEPTION 'INVALID_PLAYER_REF: supply player_card_id, card_key, or player_name'; END IF;

  SELECT count(*) INTO v_n FROM player_cards WHERE lower(name) = lower(v_name);
  IF v_n = 0 THEN RAISE EXCEPTION 'UNKNOWN_PLAYER: no player card named "%"', v_name; END IF;
  IF v_n > 1 THEN
    RAISE EXCEPTION 'AMBIGUOUS_PLAYER_NAME: "%" matches % cards. Target one with player_card_id or card_key. matches=%',
      v_name, v_n, public.admin_player_matches(v_name)::text;
  END IF;
  SELECT id INTO v_id FROM player_cards WHERE lower(name) = lower(v_name);
  RETURN v_id;
END $function$;