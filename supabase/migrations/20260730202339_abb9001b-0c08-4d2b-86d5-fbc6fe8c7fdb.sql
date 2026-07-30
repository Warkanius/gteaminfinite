CREATE OR REPLACE FUNCTION public.admin_resolve_player_ids(p_names jsonb)
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_ids uuid[] := '{}';
  v_name text;
  v_id uuid;
  v_count int;
BEGIN
  IF p_names IS NULL OR jsonb_typeof(p_names) <> 'array' THEN
    RETURN v_ids;
  END IF;
  FOR v_name IN SELECT jsonb_array_elements_text(p_names) LOOP
    SELECT count(*) INTO v_count FROM player_cards WHERE lower(name) = lower(btrim(v_name));
    IF v_count = 0 THEN
      RAISE EXCEPTION 'Unknown player card: "%"', v_name;
    END IF;
    IF v_count > 1 THEN
      RAISE EXCEPTION 'Ambiguous player card name "%" matches % cards', v_name, v_count;
    END IF;
    SELECT id INTO v_id FROM player_cards WHERE lower(name) = lower(btrim(v_name)) LIMIT 1;
    v_ids := v_ids || v_id;
  END LOOP;
  RETURN v_ids;
END
$fn$;

REVOKE ALL ON FUNCTION public.admin_resolve_player_ids(jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_resolve_player_ids(jsonb) TO authenticated, service_role;