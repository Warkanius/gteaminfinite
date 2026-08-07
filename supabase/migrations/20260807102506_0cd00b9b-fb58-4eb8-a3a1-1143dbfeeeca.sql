CREATE OR REPLACE FUNCTION public.admin_apply_evo_path(p_item jsonb, p_commit boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_src uuid; v_steps jsonb; v_step jsonb; v_order int; v_id uuid;
  v_existing jsonb := '[]'::jsonb; v_keep uuid[] := '{}'; v_orders int[] := '{}';
  v_ops jsonb := '[]'::jsonb; v_destr jsonb := '[]'::jsonb; v_warn jsonb := '[]'::jsonb;
  v_results jsonb := '[]'::jsonb; v_res jsonb; v_name text; v_idx int := 0;
  v_stale record; v_new uuid; v_step_ids jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.admin_require_admin();

  IF p_item ? 'player_card_id' OR p_item ? 'source' OR p_item ? 'player' OR p_item ? 'player_name' THEN
    v_src := public.admin_resolve_card(coalesce(p_item->'source', p_item->'player',
      CASE WHEN p_item ? 'player_card_id'
           THEN jsonb_build_object('player_card_id', p_item->>'player_card_id')
           ELSE jsonb_build_object('name', p_item->>'player_name') END));
  END IF;
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'MISSING_SOURCE_CARD: replace_path needs the source card (player_card_id, card_key, or name + distinguishing fields)';
  END IF;
  SELECT name INTO v_name FROM player_cards WHERE id = v_src;

  v_steps := coalesce(p_item->'steps', '[]'::jsonb);
  IF jsonb_typeof(v_steps) <> 'array' THEN
    RAISE EXCEPTION 'INVALID_PAYLOAD: steps must be an array of evolution steps';
  END IF;
  IF jsonb_array_length(v_steps) = 0 THEN
    RAISE EXCEPTION 'EMPTY_EVO_PATH: replace_path with zero steps would delete the whole path; use delete_entity explicitly instead';
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'step_order', step_order,
           'from_tier_id', from_tier_id, 'to_tier_id', to_tier_id,
           'objective_count', (SELECT count(*) FROM evo_objectives o WHERE o.evo_path_id = p.id),
           'version_id', (SELECT v.id FROM evo_card_versions v WHERE v.evo_path_id = p.id))
           ORDER BY step_order), '[]'::jsonb)
    INTO v_existing FROM evo_paths p WHERE player_card_id = v_src;

  FOR v_step IN SELECT * FROM jsonb_array_elements(v_steps) LOOP
    v_idx := v_idx + 1;
    v_order := coalesce((v_step->>'step_order')::int, v_idx);
    IF v_order = ANY(v_orders) THEN
      RAISE EXCEPTION 'DUPLICATE_STEP_ORDER: step_order % appears twice in this path detail=%', v_order,
        jsonb_build_object('player_card_id', v_src, 'step_order', v_order)::text;
    END IF;
    v_orders := v_orders || v_order;

    v_id := nullif(coalesce(v_step->>'evo_path_id', v_step->>'id'), '')::uuid;
    IF v_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM evo_paths WHERE id = v_id AND player_card_id = v_src) THEN
      RAISE EXCEPTION 'UNKNOWN_EVO_STEP_ID: % is not a step of this card detail=%', v_id,
        jsonb_build_object('player_card_id', v_src, 'evo_path_id', v_id)::text;
    END IF;
    IF v_id IS NULL THEN
      SELECT id INTO v_id FROM evo_paths WHERE player_card_id = v_src AND step_order = v_order;
    END IF;
    IF v_id IS NOT NULL THEN v_keep := v_keep || v_id; END IF;

    v_res := public.admin_apply_evo(
      (v_step - 'id' - 'evo_path_id')
        || jsonb_build_object('player_card_id', v_src, 'step_order', v_order,
             'action', CASE WHEN v_id IS NULL THEN 'create' ELSE 'update' END)
        || CASE WHEN v_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('evo_path_id', v_id) END,
      p_commit);

    -- A step created by this replacement is part of the authoritative path and
    -- must survive the stale-step sweep below.
    v_new := nullif(v_res->>'id','')::uuid;
    IF v_id IS NULL AND v_new IS NOT NULL THEN v_keep := v_keep || v_new; END IF;

    v_results := v_results || jsonb_build_array(v_res);
    v_ops := v_ops || coalesce(v_res->'operations','[]'::jsonb);
    v_destr := v_destr || coalesce(v_res->'destructive','[]'::jsonb);
    v_warn := v_warn || coalesce(v_res->'warnings','[]'::jsonb);
    IF v_res->>'id' IS NOT NULL THEN
      v_step_ids := v_step_ids || jsonb_build_array(jsonb_build_object(
        'evo_path_id', v_res->>'id', 'step_order', v_order, 'action', v_res->>'action'));
    END IF;
  END LOOP;

  FOR v_stale IN
    SELECT p.id, p.step_order,
           (SELECT count(*) FROM evo_objectives o WHERE o.evo_path_id = p.id) AS objectives,
           (SELECT count(*) FROM evo_card_versions v WHERE v.evo_path_id = p.id) AS versions
      FROM evo_paths p
     WHERE p.player_card_id = v_src AND NOT (p.id = ANY(v_keep))
     ORDER BY p.step_order
  LOOP
    v_destr := v_destr || jsonb_build_object(
      'action','delete','label','DESTRUCTIVE_DELETE','table','evo_paths','id', v_stale.id,
      'match', format('%s step %s', v_name, v_stale.step_order),
      'message', format('step %s is not part of the replacement path and is removed with its %s objective(s) and %s playable version(s)',
        v_stale.step_order, v_stale.objectives, v_stale.versions),
      'cascades', jsonb_build_object('evo_objectives', v_stale.objectives, 'evo_card_versions', v_stale.versions));
    IF p_commit THEN
      DELETE FROM evo_paths WHERE id = v_stale.id;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM unnest(v_orders) o
     WHERE o <> ALL (SELECT generate_series(1, array_length(v_orders,1)))
  ) THEN
    v_warn := v_warn || jsonb_build_object('code','EVO_STEP_ORDER_GAP',
      'message', format('step orders %s are not 1..%s: the game shows steps in step_order sequence',
        array_to_string(v_orders, ','), array_length(v_orders,1)));
  END IF;

  IF p_commit THEN
    PERFORM 1 FROM evo_paths WHERE player_card_id = v_src
      GROUP BY step_order HAVING count(*) > 1;
    IF FOUND THEN
      RAISE EXCEPTION 'DUPLICATE_EVO_STEP_AFTER_REPLACE: the card ended up with two steps sharing one step_order detail=%',
        jsonb_build_object('player_card_id', v_src)::text;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'kind','evo_path_replacement', 'id', v_src, 'match', format('%s evolution path', v_name),
    'action','replace', 'applied', p_commit,
    'player_card_id', v_src,
    'before', v_existing, 'steps', v_step_ids, 'step_results', v_results,
    'operations', v_ops, 'destructive', v_destr, 'warnings', v_warn,
    'resolved_references', jsonb_build_object('player_card_id', v_src));
END $function$;