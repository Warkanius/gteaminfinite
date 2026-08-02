CREATE OR REPLACE FUNCTION public.admin_apply_evo(p_item jsonb, p_commit boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_item jsonb := p_item;
  v_id uuid; v_action text := lower(coalesce(p_item->>'action','upsert'));
  v_src uuid; v_dst uuid; v_step int; v_fields jsonb := '{}'::jsonb;
  v_from uuid; v_to uuid; v_from_stars int; v_to_stars int; v_from_name text; v_to_name text;
  v_ops jsonb := '[]'::jsonb; v_destr jsonb := '[]'::jsonb; v_warn jsonb := '[]'::jsonb;
  v_res jsonb; v_match text; v_n int; v_cursor uuid; v_hops int := 0;
  v_obj jsonb; v_rows jsonb := '[]'::jsonb; v_groups text[] := '{}'; v_idx int := 0;
  v_b jsonb; v_bid uuid; v_needs boolean; v_badges jsonb := '[]'::jsonb; v_traits jsonb := '[]'::jsonb;
  v_status text; v_key text; v_before jsonb;
BEGIN
  PERFORM public.admin_require_admin();

  v_id := nullif(coalesce(v_item->>'evo_path_id', v_item->>'id'), '')::uuid;
  IF v_id IS NOT NULL THEN
    SELECT player_card_id, step_order INTO v_src, v_step FROM evo_paths WHERE id = v_id;
    IF v_src IS NULL THEN RAISE EXCEPTION 'UNKNOWN_EVO_PATH_ID: %', v_id; END IF;
  END IF;

  -- source card
  IF v_item ? 'source' OR v_item ? 'player' OR v_item ? 'player_card_id' OR v_item ? 'player_name' THEN
    v_src := public.admin_resolve_card(coalesce(v_item->'source', v_item->'player',
      CASE WHEN v_item ? 'player_card_id' THEN jsonb_build_object('player_card_id', v_item->>'player_card_id')
           ELSE jsonb_build_object('name', v_item->>'player_name') END));
  END IF;
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'MISSING_SOURCE_CARD: supply source (player_card_id, card_key, or name + distinguishing fields)';
  END IF;

  -- destination card
  IF v_item ? 'destination' OR v_item ? 'evolves_to_card_id' OR v_item ? 'destination_player_ref' THEN
    v_dst := public.admin_resolve_card(coalesce(v_item->'destination', v_item->'destination_player_ref',
      jsonb_build_object('player_card_id', v_item->>'evolves_to_card_id')));
  ELSIF v_id IS NOT NULL THEN
    SELECT evolves_to_card_id INTO v_dst FROM evo_paths WHERE id = v_id;
  END IF;

  IF v_dst IS NOT NULL THEN
    IF v_dst = v_src THEN RAISE EXCEPTION 'SELF_EVOLUTION: a card cannot evolve into itself'; END IF;
    -- cycle detection: walk the destination chain
    v_cursor := v_dst;
    WHILE v_cursor IS NOT NULL AND v_hops < 50 LOOP
      IF v_cursor = v_src THEN
        RAISE EXCEPTION 'CIRCULAR_EVOLUTION: this path would create a loop back to the source card';
      END IF;
      SELECT evolves_to_card_id INTO v_cursor FROM evo_paths
       WHERE player_card_id = v_cursor AND evolves_to_card_id IS NOT NULL
         AND (v_id IS NULL OR id <> v_id) ORDER BY step_order LIMIT 1;
      v_hops := v_hops + 1;
    END LOOP;
    SELECT status::text INTO v_status FROM player_cards WHERE id = v_dst;
    IF v_status IN ('draft','archived') THEN
      RAISE EXCEPTION 'EVO_TARGET_UNAVAILABLE: the destination card is % detail=%', v_status,
        jsonb_build_object('destination_card_id', v_dst, 'destination_status', v_status)::text;
    END IF;
    v_fields := v_fields || jsonb_build_object('evolves_to_card_id', v_dst);
  END IF;

  -- gem tiers
  IF v_item ? 'from_tier' THEN
    SELECT id, stars, name INTO v_from, v_from_stars, v_from_name FROM gem_tiers WHERE lower(name) = lower(v_item->>'from_tier');
    IF v_from IS NULL THEN RAISE EXCEPTION 'UNKNOWN_GEM_TIER: "%"', v_item->>'from_tier'; END IF;
    v_fields := v_fields || jsonb_build_object('from_tier_id', v_from);
  ELSIF v_item ? 'from_tier_id' THEN
    v_fields := v_fields || jsonb_build_object('from_tier_id', v_item->>'from_tier_id');
    SELECT stars, name INTO v_from_stars, v_from_name FROM gem_tiers WHERE id = (v_item->>'from_tier_id')::uuid;
  END IF;
  IF v_item ? 'to_tier' THEN
    SELECT id, stars, name INTO v_to, v_to_stars, v_to_name FROM gem_tiers WHERE lower(name) = lower(v_item->>'to_tier');
    IF v_to IS NULL THEN RAISE EXCEPTION 'UNKNOWN_GEM_TIER: "%"', v_item->>'to_tier'; END IF;
    v_fields := v_fields || jsonb_build_object('to_tier_id', v_to);
  ELSIF v_item ? 'to_tier_id' THEN
    v_fields := v_fields || jsonb_build_object('to_tier_id', v_item->>'to_tier_id');
    SELECT stars, name INTO v_to_stars, v_to_name FROM gem_tiers WHERE id = (v_item->>'to_tier_id')::uuid;
  END IF;
  IF v_from_stars IS NOT NULL AND v_to_stars IS NOT NULL AND v_to_stars <= v_from_stars
     AND NOT coalesce((v_item->>'tier_progression_override')::boolean, false) THEN
    RAISE EXCEPTION 'INVALID_TIER_PROGRESSION: % (% stars) does not progress to % (% stars); set tier_progression_override: true to allow it',
      v_from_name, v_from_stars, v_to_name, v_to_stars;
  END IF;

  -- step order / duplicate guard
  v_step := coalesce((v_item->>'step_order')::int, v_step);
  IF v_step IS NULL THEN
    SELECT coalesce(max(step_order), 0) + 1 INTO v_step FROM evo_paths WHERE player_card_id = v_src;
  END IF;
  SELECT count(*) INTO v_n FROM evo_paths
   WHERE player_card_id = v_src AND step_order = v_step AND (v_id IS NULL OR id <> v_id);
  IF v_n > 0 THEN
    IF v_id IS NULL AND v_action <> 'create' THEN
      SELECT id INTO v_id FROM evo_paths WHERE player_card_id = v_src AND step_order = v_step;
    ELSE
      RAISE EXCEPTION 'DUPLICATE_EVO_STEP: this card already has a step % detail=%', v_step,
        jsonb_build_object('player_card_id', v_src, 'step_order', v_step)::text;
    END IF;
  END IF;
  IF v_id IS NOT NULL AND v_action = 'create' THEN
    RAISE EXCEPTION 'ALREADY_EXISTS: an evo path already exists for this card and step; use action=update';
  END IF;
  IF v_id IS NULL AND v_action = 'update' THEN
    RAISE EXCEPTION 'NOT_FOUND: no evo path matches this card and step to update';
  END IF;
  v_fields := v_fields || jsonb_build_object('player_card_id', v_src, 'step_order', v_step);

  -- objective mode
  IF v_item ? 'objective_mode' THEN
    IF lower(v_item->>'objective_mode') NOT IN ('all','any') THEN
      RAISE EXCEPTION 'INVALID_OBJECTIVE_MODE: use "all" (every objective required) or "any" (one group is enough)';
    END IF;
    v_fields := v_fields || jsonb_build_object('objective_mode', lower(v_item->>'objective_mode'));
  END IF;

  -- stats validation
  IF v_item ? 'challenge_stat' AND v_item->>'challenge_stat' IS NOT NULL
     AND NOT (v_item->>'challenge_stat' = ANY(public.admin_stat_keys())) THEN
    RAISE EXCEPTION 'UNKNOWN_STAT_KEY: "%" detail=%', v_item->>'challenge_stat',
      jsonb_build_object('supported', public.admin_stat_keys())::text;
  END IF;
  IF v_item ? 'final_stats' THEN
    FOR v_key IN SELECT jsonb_object_keys(v_item->'final_stats') LOOP
      IF NOT (v_key = ANY(public.admin_stat_keys())) THEN
        RAISE EXCEPTION 'UNKNOWN_STAT_KEY: final_stats."%" is not a stat detail=%', v_key,
          jsonb_build_object('supported', public.admin_stat_keys())::text;
      END IF;
    END LOOP;
  END IF;
  IF v_item ? 'stat_boosts' THEN
    FOR v_key IN SELECT jsonb_object_keys(v_item->'stat_boosts') LOOP
      IF NOT (v_key = ANY(public.admin_stat_keys())) THEN
        RAISE EXCEPTION 'UNKNOWN_STAT_KEY: stat_boosts."%" is not a stat', v_key;
      END IF;
    END LOOP;
  END IF;

  -- badges / traits payloads
  IF v_item ? 'badges' THEN
    FOR v_b IN SELECT * FROM jsonb_array_elements(v_item->'badges') LOOP
      IF jsonb_typeof(v_b) = 'string' THEN v_b := jsonb_build_object('badge', v_b #>> '{}'); END IF;
      SELECT id INTO v_bid FROM badges WHERE lower(name) = lower(coalesce(v_b->>'badge', v_b->>'name'))
         OR lower(abbreviation) = lower(coalesce(v_b->>'badge', v_b->>'name'));
      IF v_bid IS NULL THEN RAISE EXCEPTION 'UNKNOWN_BADGE: "%"', coalesce(v_b->>'badge', v_b->>'name'); END IF;
      v_badges := v_badges || jsonb_build_array(jsonb_build_object('badge_id', v_bid,
        'name', coalesce(v_b->>'badge', v_b->>'name'), 'tier', coalesce(v_b->>'tier','base')));
    END LOOP;
    v_fields := v_fields || jsonb_build_object('new_badges', v_badges);
  END IF;
  IF v_item ? 'traits' THEN
    FOR v_b IN SELECT * FROM jsonb_array_elements(v_item->'traits') LOOP
      IF jsonb_typeof(v_b) = 'string' THEN v_b := jsonb_build_object('trait', v_b #>> '{}'); END IF;
      SELECT id, coalesce(requires_target_stat, false) INTO v_bid, v_needs FROM signature_traits
       WHERE lower(name) = lower(coalesce(v_b->>'trait', v_b->>'name'))
          OR lower(abbreviation) = lower(coalesce(v_b->>'trait', v_b->>'name'));
      IF v_bid IS NULL THEN RAISE EXCEPTION 'UNKNOWN_TRAIT: "%"', coalesce(v_b->>'trait', v_b->>'name'); END IF;
      IF v_needs AND nullif(btrim(coalesce(v_b->>'target_stat','')),'') IS NULL THEN
        RAISE EXCEPTION 'TRAIT_TARGET_STAT_REQUIRED: trait "%" needs target_stat', coalesce(v_b->>'trait', v_b->>'name');
      END IF;
      IF v_b ? 'target_stat' AND NOT (v_b->>'target_stat' = ANY(public.admin_stat_keys())) THEN
        RAISE EXCEPTION 'UNKNOWN_STAT_KEY: trait target_stat "%"', v_b->>'target_stat';
      END IF;
      v_traits := v_traits || jsonb_build_array(jsonb_build_object('trait_id', v_bid,
        'name', coalesce(v_b->>'trait', v_b->>'name'), 'tier', coalesce(v_b->>'tier','base'),
        'target_stat', v_b->>'target_stat'));
    END LOOP;
    v_fields := v_fields || jsonb_build_object('new_traits', v_traits);
  END IF;

  -- plain passthrough columns
  FOR v_key IN SELECT jsonb_object_keys(v_item) LOOP
    CONTINUE WHEN v_key = ANY(ARRAY['action','id','evo_path_id','source','destination','destination_player_ref',
      'player','player_name','player_card_id','from_tier','to_tier','badges','traits','objectives',
      'replace_objectives','temp_ref','step_order','objective_mode','evolves_to_card_id']);
    IF public.admin_has_column('evo_paths', v_key) THEN
      v_fields := v_fields || jsonb_build_object(v_key, v_item->v_key);
    ELSE
      v_warn := v_warn || jsonb_build_object('code','FIELD_IGNORED',
        'message', format('"%s" is not a field of evo_paths and was ignored', v_key));
    END IF;
  END LOOP;

  v_match := format('%s step %s', (SELECT name FROM player_cards WHERE id = v_src), v_step);
  v_res := public.admin_upsert_row('evo_paths', v_id, v_fields, v_match, p_commit, v_action);
  v_id := coalesce((v_res->>'id')::uuid, v_id);
  v_ops := v_ops || coalesce(v_res->'operations','[]'::jsonb);

  -- structured objectives
  IF v_item ? 'objectives' THEN
    IF jsonb_typeof(v_item->'objectives') <> 'array' THEN RAISE EXCEPTION 'INVALID_PAYLOAD: objectives must be an array'; END IF;
    FOR v_obj IN SELECT * FROM jsonb_array_elements(v_item->'objectives') LOOP
      v_idx := v_idx + 1;
      IF v_obj->>'objective_type' IS NULL THEN RAISE EXCEPTION 'INVALID_OBJECTIVE: objective_type is required'; END IF;
      IF (v_obj->>'target') IS NULL OR (v_obj->>'target')::numeric <= 0 THEN
        RAISE EXCEPTION 'INVALID_OBJECTIVE: target must be greater than 0 (objective %)', v_idx;
      END IF;
      IF v_obj ? 'stat_key' AND v_obj->>'stat_key' IS NOT NULL
         AND NOT (v_obj->>'stat_key' = ANY(public.admin_stat_keys())) THEN
        RAISE EXCEPTION 'UNKNOWN_STAT_KEY: objective % uses "%" detail=%', v_idx, v_obj->>'stat_key',
          jsonb_build_object('supported', public.admin_stat_keys())::text;
      END IF;
      IF coalesce(v_obj->>'scope','cumulative') NOT IN ('cumulative','single_game','per_season') THEN
        RAISE EXCEPTION 'INVALID_OBJECTIVE_SCOPE: use cumulative, single_game, or per_season';
      END IF;
      v_groups := v_groups || coalesce(v_obj->>'group_key','default');
      v_rows := v_rows || jsonb_build_array(jsonb_build_object(
        'group_key', coalesce(v_obj->>'group_key','default'), 'objective_type', v_obj->>'objective_type',
        'stat_key', v_obj->>'stat_key', 'scope', coalesce(v_obj->>'scope','cumulative'),
        'target', (v_obj->>'target')::numeric, 'description', v_obj->>'description',
        'sort_order', coalesce((v_obj->>'sort_order')::int, v_idx)));
    END LOOP;
    IF v_idx = 0 THEN
      v_warn := v_warn || jsonb_build_object('code','EVO_NO_OBJECTIVES',
        'message','objectives is empty: this evolution can never be completed');
    END IF;
    IF lower(coalesce(v_item->>'objective_mode','all')) = 'any'
       AND (SELECT count(DISTINCT g) FROM unnest(v_groups) g) < 2 THEN
      v_warn := v_warn || jsonb_build_object('code','ANY_MODE_SINGLE_GROUP',
        'message','objective_mode is "any" but every objective shares one group_key, so all of them are required');
    END IF;

    IF coalesce((v_item->>'replace_objectives')::boolean, true) THEN
      SELECT coalesce(jsonb_agg(jsonb_build_object('objective_type',objective_type,'stat_key',stat_key,
               'scope',scope,'target',target,'group_key',group_key) ORDER BY sort_order), '[]'::jsonb)
        INTO v_before FROM evo_objectives WHERE evo_path_id = v_id;
      v_destr := v_destr || jsonb_build_object('action','replace','label','DESTRUCTIVE_REPLACEMENT',
        'table','evo_objectives','id',v_id,'match',v_match,
        'message', format('the objective list is replaced with %s objective(s)', v_idx),
        'before', coalesce(v_before,'[]'::jsonb), 'after', v_rows);
      IF p_commit THEN DELETE FROM evo_objectives WHERE evo_path_id = v_id; END IF;
    END IF;
    IF p_commit THEN
      INSERT INTO evo_objectives (evo_path_id, group_key, objective_type, stat_key, scope, target, description, sort_order)
      SELECT v_id, e->>'group_key', e->>'objective_type', e->>'stat_key', e->>'scope',
             (e->>'target')::numeric, e->>'description', (e->>'sort_order')::int
      FROM jsonb_array_elements(v_rows) e;
    END IF;
    v_ops := v_ops || jsonb_build_array(jsonb_build_object('action','update','table','evo_objectives',
      'id', v_id, 'match', v_match, 'fields', jsonb_build_object('objectives', v_rows)));
  END IF;

  RETURN jsonb_build_object('kind','evo_path','id', v_id, 'match', v_match, 'action', v_res->>'action',
    'applied', p_commit, 'operations', v_ops, 'destructive', v_destr, 'warnings', v_warn,
    'resolved_references', jsonb_build_object('player_card_id', v_src, 'evolves_to_card_id', v_dst),
    'normalized_fields', v_fields);
END $$;

REVOKE EXECUTE ON FUNCTION public.admin_apply_evo(jsonb,boolean) FROM anon;