DO $mig$
DECLARE
  v_src text;
  v_old text;
  v_new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'admin_apply_content';

  v_old := $old$    v_other := NULL;
    IF p_payload->>'opponent_team' IS NOT NULL THEN
      SELECT id INTO v_other FROM teams WHERE lower(name) = lower(btrim(p_payload->>'opponent_team'));
      IF v_other IS NULL THEN RAISE EXCEPTION 'Unknown team: "%"', p_payload->>'opponent_team'; END IF;
    END IF;

    v_card := NULL;$old$;

  v_new := $new$    v_other := NULL;
    IF p_payload->>'opponent_team_id' IS NOT NULL THEN
      SELECT id INTO v_other FROM teams WHERE id = (p_payload->>'opponent_team_id')::uuid;
      IF v_other IS NULL THEN
        RAISE EXCEPTION 'UNKNOWN_TEAM_ID: opponent_team_id % does not exist', p_payload->>'opponent_team_id';
      END IF;
    ELSIF p_payload->>'opponent_team' IS NOT NULL THEN
      SELECT id INTO v_other FROM teams WHERE lower(name) = lower(btrim(p_payload->>'opponent_team'));
      IF v_other IS NULL THEN RAISE EXCEPTION 'Unknown team: "%"', p_payload->>'opponent_team'; END IF;
    END IF;

    v_card := NULL;$new$;

  IF position(v_old in v_src) = 0 THEN
    IF position('opponent_team_id' in v_src) > 0 THEN
      RAISE NOTICE 'admin_apply_content already supports opponent_team_id';
      RETURN;
    END IF;
    RAISE EXCEPTION 'PATCH_TARGET_NOT_FOUND: challenge opponent_team block not found in admin_apply_content';
  END IF;

  EXECUTE replace(v_src, v_old, v_new);
END
$mig$;