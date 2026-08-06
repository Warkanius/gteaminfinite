CREATE OR REPLACE FUNCTION public.admin_apply_evo_core(p_item jsonb, p_commit boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_planned jsonb := '[]'::jsonb; v_inserted jsonb := '[]'::jsonb; v_obj_ops jsonb := '[]'::jsonb;
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
        'table','evo_objectives','parent_table','evo_paths','parent_id',v_id,'match',v_match,
        'message', format('the objective list is replaced with %s objective(s)', v_idx),
        'before', coalesce(v_before,'[]'::jsonb), 'after', v_rows);
      IF p_commit THEN DELETE FROM evo_objectives WHERE evo_path_id = v_id; END IF;
    END IF;

    IF p_commit AND v_idx > 0 THEN
      -- Immutable objective ids are generated exactly once here, supplied explicitly to
      -- the INSERT, and read back from the database so commit results, API responses and
      -- verification all reference the very same rows.
      SELECT coalesce(jsonb_agg(e || jsonb_build_object('id', gen_random_uuid())
                                ORDER BY (e->>'sort_order')::int), '[]'::jsonb)
        INTO v_planned FROM jsonb_array_elements(v_rows) e;

      WITH ins AS (
        INSERT INTO evo_objectives (id, evo_path_id, group_key, objective_type, stat_key, scope, target, description, sort_order)
        SELECT (e->>'id')::uuid, v_id, e->>'group_key', e->>'objective_type', e->>'stat_key', e->>'scope',
               (e->>'target')::numeric, e->>'description', (e->>'sort_order')::int
        FROM jsonb_array_elements(v_planned) e
        RETURNING id, evo_path_id, group_key, objective_type, stat_key, scope, target, sort_order
      )
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'id', i.id, 'evo_path_id', i.evo_path_id, 'group_key', i.group_key,
               'objective_type', i.objective_type, 'stat_key', i.stat_key, 'scope', i.scope,
               'target', i.target, 'sort_order', i.sort_order) ORDER BY i.sort_order), '[]'::jsonb)
        INTO v_inserted FROM ins i;

      -- Validate what the database actually returned, before anything is verified elsewhere.
      IF jsonb_array_length(v_inserted) <> v_idx THEN
        RAISE EXCEPTION 'EVO_OBJECTIVE_INSERT_FAILED: expected % objective row(s), the database returned % detail=%',
          v_idx, jsonb_array_length(v_inserted),
          jsonb_build_object('stage','insert','table','evo_objectives','parent_table','evo_paths',
            'parent_id', v_id, 'expected_ids', (SELECT jsonb_agg(e->'id') FROM jsonb_array_elements(v_planned) e),
            'returned_ids', (SELECT jsonb_agg(e->'id') FROM jsonb_array_elements(v_inserted) e))::text;
      END IF;
      IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_planned) p
         WHERE NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(v_inserted) i
            WHERE i->>'id' = p->>'id'
              AND i->>'evo_path_id' = v_id::text
              AND i->>'objective_type' = p->>'objective_type'
              AND (i->>'target')::numeric = (p->>'target')::numeric
              AND (i->>'sort_order')::int = (p->>'sort_order')::int)) THEN
        RAISE EXCEPTION 'EVO_OBJECTIVE_INSERT_MISMATCH: inserted objective rows do not match the planned rows detail=%',
          jsonb_build_object('stage','insert_readback','table','evo_objectives','parent_table','evo_paths',
            'columns', jsonb_build_array('id','evo_path_id','objective_type','target','sort_order'),
            'expected_parent_id', v_id, 'planned', v_planned, 'inserted', v_inserted)::text;
      END IF;

      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'action','insert','table','evo_objectives','id', i->>'id',
               'parent_table','evo_paths','parent_id', v_id, 'match', v_match,
               'expected_count', v_idx,
               'fields', jsonb_build_object(
                 'evo_path_id', v_id, 'group_key', i->>'group_key', 'objective_type', i->>'objective_type',
                 'stat_key', i->>'stat_key', 'scope', i->>'scope',
                 'target', (i->>'target')::numeric, 'sort_order', (i->>'sort_order')::int))), '[]'::jsonb)
        INTO v_obj_ops FROM jsonb_array_elements(v_inserted) i;
      v_ops := v_ops || v_obj_ops;
    ELSIF v_idx > 0 THEN
      -- Preview: zero writes, and no fabricated ids. Ids only exist after the insert.
      v_ops := v_ops || jsonb_build_array(jsonb_build_object(
        'action','planned_replace','table','evo_objectives','parent_table','evo_paths',
        'parent_id', v_id, 'match', v_match, 'expected_count', v_idx,
        'fields', jsonb_build_object('objectives', v_rows)));
    END IF;
  END IF;

  RETURN jsonb_build_object('kind','evo_path','id', v_id, 'match', v_match, 'action', v_res->>'action',
    'applied', p_commit, 'operations', v_ops, 'destructive', v_destr, 'warnings', v_warn,
    'evo_objectives', CASE WHEN p_commit THEN v_inserted ELSE v_rows END,
    'resolved_references', jsonb_build_object('player_card_id', v_src, 'evolves_to_card_id', v_dst),
    'normalized_fields', v_fields);
END $function$;

CREATE OR REPLACE FUNCTION public.content_release_verify(p_result jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tables text[] := ARRAY['release_bundles','player_cards','collections','collection_requirements','sub_collections',
    'teams','team_players','packs','pack_players','pack_odds','evo_paths','evo_objectives','evo_card_versions',
    'evo_card_version_badges','evo_card_version_traits','player_card_badges','player_card_traits','locker_codes',
    'challenges','gem_tasks','dynamic_duos','release_bundle_entities'];
  v_rec record; v_exists boolean; v_errors jsonb := '[]'::jsonb; v_seen jsonb := '{}'::jsonb;
  v_players jsonb := '[]'::jsonb; v_paths jsonb := '[]'::jsonb; v_versions jsonb := '[]'::jsonb;
  v_objectives jsonb := '[]'::jsonb;
  v_release uuid; v_collection uuid; v_pack uuid; v_code uuid; v_key text;
  v_row record; v_found int;
BEGIN
  FOR v_rec IN
    SELECT DISTINCT op->>'table' AS tbl, op->>'id' AS id, op->>'parent_id' AS parent_id,
           op->'fields' AS fields, (op->>'expected_count')::int AS expected_count
      FROM jsonb_array_elements(coalesce(p_result->'results','[]'::jsonb)) r,
           jsonb_array_elements(coalesce(r.value->'result'->'operations','[]'::jsonb)) op
     WHERE op->>'id' IS NOT NULL AND op->>'table' IS NOT NULL
  LOOP
    v_key := v_rec.tbl || ':' || v_rec.id;
    IF v_seen ? v_key THEN CONTINUE; END IF;
    v_seen := v_seen || jsonb_build_object(v_key, true);

    IF NOT (v_rec.tbl = ANY (v_tables)) THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'code','VERIFICATION_FAILED','stage','table_allowlist','table', v_rec.tbl, 'id', v_rec.id,
        'message','unexpected table in release result; cannot verify'));
      CONTINUE;
    END IF;

    -- Evo objectives are verified by their exact immutable id plus parent and field values.
    IF v_rec.tbl = 'evo_objectives' THEN
      SELECT * INTO v_row FROM public.evo_objectives WHERE id = v_rec.id::uuid;
      IF NOT FOUND THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'code','VERIFICATION_ROW_MISSING','stage','verification_query',
          'table','evo_objectives','columns', jsonb_build_array('id','evo_path_id'),
          'expected_id', v_rec.id, 'inserted_id', v_rec.id, 'found_id', NULL,
          'expected_parent_id', v_rec.parent_id, 'found_parent_id', NULL,
          'message','evo objective row is missing after commit'));
        CONTINUE;
      END IF;
      IF v_rec.parent_id IS NOT NULL AND v_row.evo_path_id <> v_rec.parent_id::uuid THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'code','VERIFICATION_PARENT_MISMATCH','stage','verification_compare',
          'table','evo_objectives','columns', jsonb_build_array('evo_path_id'),
          'expected_id', v_rec.id, 'found_id', v_row.id,
          'expected_parent_id', v_rec.parent_id, 'found_parent_id', v_row.evo_path_id,
          'message','evo objective is attached to a different evo path than the commit reported'));
        CONTINUE;
      END IF;
      IF v_rec.fields IS NOT NULL AND (
           v_row.objective_type <> (v_rec.fields->>'objective_type')
        OR v_row.target <> (v_rec.fields->>'target')::numeric
        OR v_row.sort_order <> (v_rec.fields->>'sort_order')::int) THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'code','VERIFICATION_MISMATCH','stage','verification_compare',
          'table','evo_objectives','columns', jsonb_build_array('objective_type','target','sort_order'),
          'expected_id', v_rec.id, 'found_id', v_row.id,
          'expected_parent_id', v_rec.parent_id, 'found_parent_id', v_row.evo_path_id,
          'expected', jsonb_build_object('objective_type', v_rec.fields->>'objective_type',
            'target', v_rec.fields->'target', 'sort_order', v_rec.fields->'sort_order'),
          'found', jsonb_build_object('objective_type', v_row.objective_type,
            'target', v_row.target, 'sort_order', v_row.sort_order),
          'message','evo objective values differ from the committed plan'));
        CONTINUE;
      END IF;
      IF v_rec.expected_count IS NOT NULL AND v_rec.parent_id IS NOT NULL THEN
        SELECT count(*) INTO v_found FROM public.evo_objectives WHERE evo_path_id = v_rec.parent_id::uuid;
        IF v_found <> v_rec.expected_count THEN
          v_errors := v_errors || jsonb_build_array(jsonb_build_object(
            'code','VERIFICATION_COUNT_MISMATCH','stage','verification_count',
            'table','evo_objectives','columns', jsonb_build_array('evo_path_id'),
            'expected_parent_id', v_rec.parent_id, 'found_parent_id', v_rec.parent_id,
            'expected_count', v_rec.expected_count, 'found_count', v_found,
            'message','evo path has a different number of objectives than the commit reported'));
          CONTINUE;
        END IF;
      END IF;
      v_objectives := v_objectives || to_jsonb(v_rec.id);
      CONTINUE;
    END IF;

    EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE id = $1)', v_rec.tbl)
      INTO v_exists USING v_rec.id::uuid;
    IF NOT v_exists THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'code','VERIFICATION_ROW_MISSING','stage','verification_query','table', v_rec.tbl,
        'columns', jsonb_build_array('id'), 'expected_id', v_rec.id, 'found_id', NULL,
        'id', v_rec.id, 'message','row is missing after commit'));
      CONTINUE;
    END IF;

    CASE v_rec.tbl
      WHEN 'release_bundles' THEN v_release := coalesce(v_release, v_rec.id::uuid);
      WHEN 'collections' THEN v_collection := coalesce(v_collection, v_rec.id::uuid);
      WHEN 'packs' THEN v_pack := coalesce(v_pack, v_rec.id::uuid);
      WHEN 'locker_codes' THEN v_code := coalesce(v_code, v_rec.id::uuid);
      WHEN 'player_cards' THEN v_players := v_players || to_jsonb(v_rec.id);
      WHEN 'evo_paths' THEN v_paths := v_paths || to_jsonb(v_rec.id);
      WHEN 'evo_card_versions' THEN v_versions := v_versions || to_jsonb(v_rec.id);
      ELSE NULL;
    END CASE;
  END LOOP;

  -- The collection reward must point at a real card when a reward was requested.
  IF v_collection IS NOT NULL THEN
    PERFORM 1 FROM public.collections c
      WHERE c.id = v_collection
        AND c.reward_card_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.player_cards pc WHERE pc.id = c.reward_card_id);
    IF FOUND THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'code','VERIFICATION_FAILED','stage','verification_compare','table','collections','id', v_collection,
        'message','collection reward card is missing'));
    END IF;
  END IF;

  -- Pack odds must still total exactly 100.00 for a pack written in this release.
  IF v_pack IS NOT NULL THEN
    PERFORM 1 FROM public.pack_odds o WHERE o.pack_id = v_pack
      HAVING round(sum(o.percentage)::numeric, 2) <> 100.00;
    IF FOUND THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'code','VERIFICATION_FAILED','stage','verification_compare','table','pack_odds','id', v_pack,
        'message','pack odds do not total 100.00 after commit'));
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'verified', jsonb_array_length(v_errors) = 0,
    'release_id', v_release,
    'collection_id', v_collection,
    'player_card_ids', v_players,
    'pack_id', v_pack,
    'evo_path_ids', v_paths,
    'evo_version_ids', v_versions,
    'evo_objective_ids', v_objectives,
    'locker_code_id', v_code,
    'verification_errors', v_errors);
END $function$;