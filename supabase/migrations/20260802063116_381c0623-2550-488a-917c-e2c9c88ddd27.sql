-- ---------- typed generic writer ----------
CREATE OR REPLACE FUNCTION public.admin_col_type(p_table text, p_column text)
RETURNS text LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT format_type(a.atttypid, a.atttypmod)
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname='public' AND c.relname=p_table AND a.attname=p_column AND a.attnum > 0 AND NOT a.attisdropped;
$$;

CREATE OR REPLACE FUNCTION public.admin_upsert_row(
  p_table text, p_id uuid, p_fields jsonb, p_match text, p_commit boolean, p_action text DEFAULT 'upsert')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  k text; v_type text; v_expr text; v_cols text[] := '{}'; v_vals text[] := '{}'; v_sets text[] := '{}';
  v_id uuid := p_id; v_changes jsonb := '[]'::jsonb; v_is_insert boolean;
BEGIN
  IF p_fields IS NULL OR jsonb_typeof(p_fields) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_PAYLOAD: fields for % must be an object', p_table;
  END IF;
  v_is_insert := p_id IS NULL;
  IF v_is_insert AND p_action = 'update' THEN
    RAISE EXCEPTION 'NOT_FOUND: action=update but no existing % matched "%"', p_table, coalesce(p_match,'?');
  END IF;

  FOR k IN SELECT jsonb_object_keys(p_fields) LOOP
    v_type := public.admin_col_type(p_table, k);
    IF v_type IS NULL THEN RAISE EXCEPTION 'UNKNOWN_FIELD: "%" is not a column of %', k, p_table; END IF;
    IF v_type IN ('jsonb','json') THEN
      v_expr := format('($1->%L)', k);
    ELSIF v_type LIKE '%[]' THEN
      v_expr := format('(CASE WHEN jsonb_typeof($1->%L) = ''array'' THEN (SELECT array_agg(e::%s) FROM jsonb_array_elements_text($1->%L) e) ELSE NULL END)',
                       k, rtrim(v_type,'[]'), k);
    ELSE
      v_expr := format('(($1->>%L)::%s)', k, v_type);
    END IF;
    v_cols := v_cols || quote_ident(k);
    v_vals := v_vals || v_expr;
    v_sets := v_sets || format('%s = %s', quote_ident(k), v_expr);
  END LOOP;

  IF array_length(v_cols,1) IS NULL THEN
    RETURN jsonb_build_object('id', v_id, 'action', CASE WHEN v_is_insert THEN 'insert' ELSE 'noop' END,
                              'operations', '[]'::jsonb);
  END IF;

  IF NOT v_is_insert THEN
    v_changes := public.admin_diff_fields(p_table, p_id, p_fields);
  END IF;

  IF p_commit THEN
    IF v_is_insert THEN
      EXECUTE format('INSERT INTO public.%I (%s) VALUES (%s) RETURNING id', p_table,
                     array_to_string(v_cols, ', '), array_to_string(v_vals, ', ')) INTO v_id USING p_fields;
    ELSE
      EXECUTE format('UPDATE public.%I SET %s WHERE id = $2 RETURNING id', p_table, array_to_string(v_sets, ', '))
        INTO v_id USING p_fields, p_id;
      IF v_id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND: % row % disappeared', p_table, p_id; END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object('id', v_id, 'action', CASE WHEN v_is_insert THEN 'insert' ELSE 'update' END,
    'operations', jsonb_build_array(jsonb_build_object(
      'action', CASE WHEN v_is_insert THEN 'insert' ELSE 'update' END,
      'table', p_table, 'id', v_id, 'match', p_match, 'fields', p_fields,
      'field_changes', v_changes)));
END $$;

-- ---------- stat keys + card resolution with distinguishing fields ----------
CREATE OR REPLACE FUNCTION public.admin_stat_keys()
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT ARRAY['stat_3pt','stat_mid','stat_fin','stat_dnk','stat_ast','stat_stl','stat_reb','stat_blk','stat_int',
               'run_stat_3pt','run_stat_mid','run_stat_fin','run_stat_dnk','run_stat_ast','run_stat_stl',
               'run_stat_reb','run_stat_blk','run_stat_int','points','games_played','games_won'];
$$;

CREATE OR REPLACE FUNCTION public.admin_resolve_card(p_ref jsonb)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ref jsonb := p_ref; v_name text; v_ids uuid[]; v_matches jsonb;
BEGIN
  IF v_ref IS NULL OR v_ref = 'null'::jsonb THEN RETURN NULL; END IF;
  IF jsonb_typeof(v_ref) <> 'object' THEN RETURN public.admin_resolve_player(v_ref); END IF;
  IF coalesce(v_ref->>'player_card_id', v_ref->>'player_id', v_ref->>'id', v_ref->>'card_key') IS NOT NULL THEN
    RETURN public.admin_resolve_player(v_ref || jsonb_build_object('player_id',
      coalesce(v_ref->>'player_card_id', v_ref->>'player_id', v_ref->>'id')));
  END IF;

  v_name := nullif(btrim(coalesce(v_ref->>'player_name', v_ref->>'name','')), '');
  IF v_name IS NULL THEN RAISE EXCEPTION 'INVALID_PLAYER_REF: supply player_card_id, card_key, or name (+ distinguishing fields)'; END IF;

  SELECT array_agg(pc.id) INTO v_ids
  FROM player_cards pc
  LEFT JOIN gem_tiers gt ON gt.id = pc.gem_tier_id
  LEFT JOIN teams tm ON tm.id = pc.team_id
  LEFT JOIN collections c ON c.id = pc.collection_id
  LEFT JOIN sub_collections sc ON sc.id = pc.sub_collection_id
  WHERE lower(pc.name) = lower(v_name)
    AND (v_ref->>'rating' IS NULL OR pc.rating = (v_ref->>'rating')::numeric)
    AND (v_ref->>'gem_tier' IS NULL OR lower(coalesce(gt.name,'')) = lower(v_ref->>'gem_tier'))
    AND (v_ref->>'team' IS NULL OR lower(coalesce(tm.name,'')) = lower(v_ref->>'team'))
    AND (v_ref->>'collection' IS NULL OR lower(coalesce(c.name,'')) = lower(v_ref->>'collection'))
    AND (v_ref->>'sub_collection' IS NULL OR lower(coalesce(sc.name,'')) = lower(v_ref->>'sub_collection'))
    AND (v_ref->>'card_variant' IS NULL OR lower(coalesce(pc.card_variant,'')) = lower(v_ref->>'card_variant'))
    AND (v_ref->>'evo_stage' IS NULL OR pc.evo_stage = (v_ref->>'evo_stage')::int);

  IF v_ids IS NULL THEN RAISE EXCEPTION 'UNKNOWN_PLAYER: no player card matches %', v_ref::text; END IF;
  IF array_length(v_ids,1) > 1 THEN
    SELECT jsonb_agg(jsonb_build_object('player_card_id',pc.id,'card_key',pc.card_key,'name',pc.name,'rating',pc.rating,
             'gem_tier',gt.name,'team',tm.name,'collection',c.name,'sub_collection',sc.name,
             'card_variant',pc.card_variant,'evo_stage',pc.evo_stage))
      INTO v_matches
    FROM player_cards pc
    LEFT JOIN gem_tiers gt ON gt.id = pc.gem_tier_id
    LEFT JOIN teams tm ON tm.id = pc.team_id
    LEFT JOIN collections c ON c.id = pc.collection_id
    LEFT JOIN sub_collections sc ON sc.id = pc.sub_collection_id
    WHERE pc.id = ANY(v_ids);
    RAISE EXCEPTION 'AMBIGUOUS_PLAYER_NAME: "%" matches % cards; target one with player_card_id or card_key. matches=%',
      v_name, array_length(v_ids,1), v_matches::text;
  END IF;
  RETURN v_ids[1];
END $$;

-- ---------- entity dispatcher ----------
CREATE OR REPLACE FUNCTION public.admin_apply_entity(p_kind text, p_item jsonb, p_commit boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tbl text; v_meta jsonb; v_id uuid; v_action text; v_match text; v_fields jsonb := '{}'::jsonb;
  v_ctl text[] := ARRAY['action','temp_ref','requirements','replace_requirements','entities','replace_entities',
                        'objectives','replace_objectives','badges','traits','collection','sub_collection',
                        'gem_tier','team','reward_pack','reward_card','prerequisite_collection','prerequisite_task',
                        'source','destination','player','creator','location_account','new_name'];
  k text; v_res jsonb; v_ops jsonb := '[]'::jsonb; v_destr jsonb := '[]'::jsonb; v_warn jsonb := '[]'::jsonb;
  v_resolved jsonb := '{}'::jsonb; v_item jsonb := p_item; v_tmp uuid; v_n int; v_rv jsonb; v_child jsonb;
  v_before jsonb; v_removed jsonb;
BEGIN
  PERFORM public.admin_require_admin();
  v_meta := public.admin_entity_meta(p_kind);
  v_tbl := v_meta->>'table';
  v_action := lower(coalesce(v_item->>'action','upsert'));

  -- ---- target resolution ----
  v_id := nullif(coalesce(v_item->>(p_kind || '_id'), v_item->>'id'), '')::uuid;
  IF v_id IS NOT NULL THEN
    EXECUTE format('SELECT count(*) FROM public.%I WHERE id = $1', v_tbl) INTO v_n USING v_id;
    IF v_n = 0 THEN RAISE EXCEPTION 'UNKNOWN_%_ID: %', upper(p_kind), v_id; END IF;
  ELSIF v_meta ? 'name_column' AND coalesce(v_item->>'name', v_item->>'title', v_item->>'code') IS NOT NULL THEN
    EXECUTE format('SELECT array_agg(id) FROM public.%I WHERE lower(btrim(%I::text)) = lower(btrim($1))',
                   v_tbl, v_meta->>'name_column')
      INTO v_resolved USING coalesce(v_item->>'name', v_item->>'title', v_item->>'code');
    EXECUTE format('SELECT count(*), min(id) FROM public.%I WHERE lower(btrim(%I::text)) = lower(btrim($1))',
                   v_tbl, v_meta->>'name_column')
      INTO v_n, v_id USING coalesce(v_item->>'name', v_item->>'title', v_item->>'code');
    IF v_n > 1 THEN
      RAISE EXCEPTION 'AMBIGUOUS_%_NAME: "%" matches % records; target one by its id',
        upper(p_kind), coalesce(v_item->>'name', v_item->>'title', v_item->>'code'), v_n;
    END IF;
    IF v_n = 0 THEN v_id := NULL; END IF;
    v_resolved := '{}'::jsonb;
  END IF;
  IF v_id IS NOT NULL AND v_action = 'create' THEN
    RAISE EXCEPTION 'ALREADY_EXISTS: a % already exists for this target; use action=update or upsert', p_kind;
  END IF;
  v_match := coalesce(v_item->>'name', v_item->>'title', v_item->>'code', v_id::text, '(new)');

  -- ---- alias normalization ----
  IF v_item ? 'new_name' THEN v_item := v_item || jsonb_build_object('name', v_item->>'new_name'); END IF;
  IF v_item ? 'gem_tier' AND public.admin_has_column(v_tbl,'gem_tier_id') THEN
    SELECT id INTO v_tmp FROM gem_tiers WHERE lower(name) = lower(v_item->>'gem_tier');
    IF v_tmp IS NULL THEN RAISE EXCEPTION 'UNKNOWN_GEM_TIER: "%"', v_item->>'gem_tier'; END IF;
    v_item := v_item || jsonb_build_object('gem_tier_id', v_tmp);
  END IF;
  IF v_item ? 'reward_pack' AND public.admin_has_column(v_tbl,'reward_pack_id') THEN
    v_item := v_item || jsonb_build_object('reward_pack_id', public.admin_resolve_pack(v_item->'reward_pack', NULL));
  END IF;
  IF v_item ? 'reward_card' AND public.admin_has_column(v_tbl,'reward_card_id') THEN
    v_item := v_item || jsonb_build_object('reward_card_id', public.admin_resolve_card(v_item->'reward_card'));
  END IF;
  IF v_item ? 'prerequisite_collection' THEN
    SELECT id INTO v_tmp FROM collections WHERE lower(name) = lower(v_item->>'prerequisite_collection');
    IF v_tmp IS NULL THEN RAISE EXCEPTION 'UNKNOWN_COLLECTION: "%"', v_item->>'prerequisite_collection'; END IF;
    v_item := v_item || jsonb_build_object('prerequisite_collection_id', v_tmp);
  END IF;
  IF v_item ? 'prerequisite_task' THEN
    SELECT id INTO v_tmp FROM gem_tasks WHERE lower(title) = lower(v_item->>'prerequisite_task');
    IF v_tmp IS NULL THEN RAISE EXCEPTION 'UNKNOWN_GEM_TASK: "%"', v_item->>'prerequisite_task'; END IF;
    v_item := v_item || jsonb_build_object('prerequisite_task_id', v_tmp);
  END IF;
  IF v_item ? 'collection' AND public.admin_has_column(v_tbl,'collection_id') THEN
    SELECT id INTO v_tmp FROM collections WHERE lower(name) = lower(v_item->>'collection');
    IF v_tmp IS NULL THEN RAISE EXCEPTION 'UNKNOWN_COLLECTION: "%"', v_item->>'collection'; END IF;
    v_item := v_item || jsonb_build_object('collection_id', v_tmp);
  END IF;
  IF v_item ? 'player' AND public.admin_has_column(v_tbl,'player_card_id') THEN
    v_item := v_item || jsonb_build_object('player_card_id', public.admin_resolve_card(v_item->'player'));
  END IF;

  -- ---- kind-specific validation ----
  IF p_kind IN ('collection','sub_collection') THEN
    IF v_item ? 'reward_payload' THEN
      v_rv := public.admin_reward_validate(v_item->'reward_payload');
      IF NOT (v_rv->>'valid')::boolean THEN
        RAISE EXCEPTION 'INVALID_REWARD_PAYLOAD: % detail=%', (v_rv->'errors'->0->>'message'),
          jsonb_build_object('reward_errors', v_rv->'errors')::text;
      END IF;
      v_warn := v_warn || coalesce(v_rv->'warnings','[]'::jsonb);
    END IF;
    IF p_kind = 'collection' AND v_item ? 'prerequisite_collection_id' AND v_id IS NOT NULL
       AND (v_item->>'prerequisite_collection_id')::uuid = v_id THEN
      RAISE EXCEPTION 'CIRCULAR_COLLECTION_PREREQUISITE: a collection cannot require itself';
    END IF;
    IF p_kind = 'sub_collection' THEN
      IF v_item->>'collection_id' IS NULL AND v_id IS NULL THEN
        RAISE EXCEPTION 'MISSING_PARENT: sub-collections need collection_id (or collection name)';
      END IF;
      IF v_item ? 'collection_id' THEN
        SELECT count(*) INTO v_n FROM collections
         WHERE id = (v_item->>'collection_id')::uuid AND status <> 'archived';
        IF v_n = 0 THEN RAISE EXCEPTION 'PARENT_UNAVAILABLE: parent collection is missing or archived'; END IF;
      END IF;
    END IF;
  ELSIF p_kind = 'gem_task' THEN
    IF v_item ? 'stat_key' AND NOT (v_item->>'stat_key' = ANY(public.admin_stat_keys())) THEN
      RAISE EXCEPTION 'UNKNOWN_STAT_KEY: "%" detail=%', v_item->>'stat_key',
        jsonb_build_object('supported', public.admin_stat_keys())::text;
    END IF;
    IF v_item ? 'prerequisite_task_id' AND v_id IS NOT NULL AND (v_item->>'prerequisite_task_id')::uuid = v_id THEN
      RAISE EXCEPTION 'CIRCULAR_TASK_PREREQUISITE: a task cannot require itself';
    END IF;
    IF v_item ? 'reward_payload' THEN
      v_rv := public.admin_reward_validate(v_item->'reward_payload');
      IF NOT (v_rv->>'valid')::boolean THEN
        RAISE EXCEPTION 'INVALID_REWARD_PAYLOAD: % detail=%', (v_rv->'errors'->0->>'message'),
          jsonb_build_object('reward_errors', v_rv->'errors')::text;
      END IF;
    END IF;
  ELSIF p_kind = 'signature_trait' THEN
    IF coalesce((v_item->>'requires_target_stat')::boolean, false)
       AND coalesce(jsonb_array_length(v_item->'supported_target_stats'), 0) = 0 THEN
      v_warn := v_warn || jsonb_build_object('code','TRAIT_TARGET_STATS_EMPTY',
        'message','requires_target_stat is true but supported_target_stats is empty; any stat will be accepted');
    END IF;
  ELSIF p_kind = 'release_bundle' THEN
    IF v_item->>'slug' IS NULL AND v_id IS NULL THEN
      v_item := v_item || jsonb_build_object('slug', public.admin_slugify(coalesce(v_item->>'name','release')));
    END IF;
  ELSIF p_kind = 'social_post' THEN
    IF v_item ? 'creator' THEN
      SELECT id INTO v_tmp FROM social_creators WHERE lower(name) = lower(v_item->>'creator');
      IF v_tmp IS NULL THEN RAISE EXCEPTION 'UNKNOWN_SOCIAL_CREATOR: "%"', v_item->>'creator'; END IF;
      v_item := v_item || jsonb_build_object('creator_id', v_tmp);
    END IF;
    IF v_item ? 'location_account' THEN
      SELECT id INTO v_tmp FROM location_accounts WHERE lower(name) = lower(v_item->>'location_account');
      IF v_tmp IS NULL THEN RAISE EXCEPTION 'UNKNOWN_LOCATION_ACCOUNT: "%"', v_item->>'location_account'; END IF;
      v_item := v_item || jsonb_build_object('location_account_id', v_tmp);
    END IF;
  END IF;

  -- ---- build the write payload from real columns only ----
  FOR k IN SELECT jsonb_object_keys(v_item) LOOP
    CONTINUE WHEN k = ANY(v_ctl);
    CONTINUE WHEN k = p_kind || '_id' OR k = 'id';
    IF public.admin_has_column(v_tbl, k) THEN
      v_fields := v_fields || jsonb_build_object(k, v_item->k);
    ELSE
      v_warn := v_warn || jsonb_build_object('code','FIELD_IGNORED',
        'message', format('"%s" is not a field of %s and was ignored', k, p_kind));
    END IF;
  END LOOP;

  IF v_id IS NULL AND v_meta ? 'name_column' AND v_fields->>(v_meta->>'name_column') IS NULL THEN
    RAISE EXCEPTION 'MISSING_NAME: a new % needs %', p_kind, v_meta->>'name_column';
  END IF;

  v_res := public.admin_upsert_row(v_tbl, v_id, v_fields, v_match, p_commit, v_action);
  v_id := coalesce((v_res->>'id')::uuid, v_id);
  v_ops := v_ops || coalesce(v_res->'operations','[]'::jsonb);

  -- ---- children: collection / sub-collection requirements ----
  IF p_kind IN ('collection','sub_collection') AND v_item ? 'requirements' THEN
    IF jsonb_typeof(v_item->'requirements') <> 'array' THEN RAISE EXCEPTION 'INVALID_PAYLOAD: requirements must be an array'; END IF;
    DECLARE
      v_req jsonb; v_cards uuid[] := '{}'; v_card uuid; v_reward_cards int := 0; v_idx int := 0;
      v_reqtbl text := CASE WHEN p_kind = 'collection' THEN 'collection_requirements' ELSE 'sub_collection_requirements' END;
      v_parent text := CASE WHEN p_kind = 'collection' THEN 'collection_id' ELSE 'sub_collection_id' END;
      v_rows jsonb := '[]'::jsonb;
    BEGIN
      FOR v_req IN SELECT * FROM jsonb_array_elements(v_item->'requirements') LOOP
        v_idx := v_idx + 1;
        v_card := public.admin_resolve_card(CASE WHEN jsonb_typeof(v_req) = 'object' THEN v_req ELSE v_req END);
        IF v_card = ANY(v_cards) THEN
          RAISE EXCEPTION 'DUPLICATE_REQUIREMENT: card % appears more than once in requirements', v_card;
        END IF;
        v_cards := v_cards || v_card;
        IF coalesce((v_req->>'is_reward_card')::boolean, false) THEN v_reward_cards := v_reward_cards + 1; END IF;
        v_rows := v_rows || jsonb_build_object('player_card_id', v_card,
          'evolved_counts', coalesce((v_req->>'evolved_counts')::boolean, coalesce((v_item->>'evolved_counts')::boolean, true)),
          'any_evo_stage', coalesce((v_req->>'any_evo_stage')::boolean, true),
          'allowed_evo_stages', v_req->'allowed_evo_stages',
          'is_reward_card', coalesce((v_req->>'is_reward_card')::boolean, false),
          'sort_order', coalesce((v_req->>'sort_order')::int, v_idx));
      END LOOP;

      IF v_reward_cards > 1 AND NOT coalesce((v_item->>'allow_multiple_reward_cards')::boolean, false) THEN
        RAISE EXCEPTION 'MULTIPLE_REWARD_CARDS: % requirement rows are flagged is_reward_card; set allow_multiple_reward_cards: true if that is intended', v_reward_cards;
      END IF;
      IF v_item->>'reward_card_id' IS NOT NULL AND (v_item->>'reward_card_id')::uuid = ANY(v_cards) THEN
        SELECT count(*) INTO v_n FROM jsonb_array_elements(v_rows) e
         WHERE (e.value->>'player_card_id')::uuid = (v_item->>'reward_card_id')::uuid
           AND coalesce((e.value->>'is_reward_card')::boolean,false);
        IF v_n = 0 THEN
          RAISE EXCEPTION 'REWARD_CARD_IN_REQUIREMENTS: the completion-reward card is also listed as a required card; remove it or mark that row is_reward_card: true';
        END IF;
      END IF;
      IF array_length(v_cards,1) IS NULL THEN
        v_warn := v_warn || jsonb_build_object('code','COLLECTION_EMPTY','message','requirements is empty: this collection can never be completed');
      END IF;

      EXECUTE format('SELECT coalesce(jsonb_agg(jsonb_build_object(''player_card_id'',r.player_card_id,''name'',pc.name)),''[]''::jsonb)
                      FROM public.%I r JOIN player_cards pc ON pc.id = r.player_card_id WHERE r.%I = $1', v_reqtbl, v_parent)
        INTO v_before USING v_id;
      SELECT coalesce(jsonb_agg(e), '[]'::jsonb) INTO v_removed
      FROM jsonb_array_elements(coalesce(v_before,'[]'::jsonb)) e
      WHERE NOT ((e->>'player_card_id')::uuid = ANY(v_cards));

      IF coalesce((v_item->>'replace_requirements')::boolean, true) THEN
        v_destr := v_destr || jsonb_build_object('action','replace','label','DESTRUCTIVE_REPLACEMENT',
          'table', v_reqtbl, 'id', v_id, 'match', v_match,
          'message', format('the required-card list is replaced with %s card(s)', coalesce(array_length(v_cards,1),0)),
          'before', coalesce(v_before,'[]'::jsonb), 'removed', v_removed, 'after', v_rows);
        IF p_commit THEN
          EXECUTE format('DELETE FROM public.%I WHERE %I = $1', v_reqtbl, v_parent) USING v_id;
        END IF;
      END IF;

      IF p_commit THEN
        FOR v_child IN SELECT * FROM jsonb_array_elements(v_rows) LOOP
          EXECUTE format('INSERT INTO public.%I (%I, player_card_id, evolved_counts, any_evo_stage, allowed_evo_stages, is_reward_card, sort_order)
                          VALUES ($1, ($2->>''player_card_id'')::uuid, ($2->>''evolved_counts'')::boolean,
                                  ($2->>''any_evo_stage'')::boolean,
                                  (CASE WHEN jsonb_typeof($2->''allowed_evo_stages'')=''array''
                                        THEN (SELECT array_agg(e::int) FROM jsonb_array_elements_text($2->''allowed_evo_stages'') e) END),
                                  ($2->>''is_reward_card'')::boolean, ($2->>''sort_order'')::int)
                          ON CONFLICT (%I, player_card_id) DO UPDATE SET
                            evolved_counts = EXCLUDED.evolved_counts, any_evo_stage = EXCLUDED.any_evo_stage,
                            allowed_evo_stages = EXCLUDED.allowed_evo_stages, is_reward_card = EXCLUDED.is_reward_card,
                            sort_order = EXCLUDED.sort_order', v_reqtbl, v_parent, v_parent)
            USING v_id, v_child;
        END LOOP;
      END IF;
      v_ops := v_ops || jsonb_build_array(jsonb_build_object('action', CASE WHEN v_res->>'action' = 'insert' THEN 'insert' ELSE 'update' END,
        'table', v_reqtbl, 'id', v_id, 'match', v_match, 'fields', jsonb_build_object('requirements', v_rows)));
      v_resolved := v_resolved || jsonb_build_object('requirement_card_ids', to_jsonb(v_cards));
    END;
  END IF;

  -- ---- children: release bundle entities ----
  IF p_kind = 'release_bundle' AND v_item ? 'entities' THEN
    DECLARE v_e jsonb; v_seen text[] := '{}'; v_key text;
    BEGIN
      IF coalesce((v_item->>'replace_entities')::boolean, false) THEN
        v_destr := v_destr || jsonb_build_object('action','replace','label','DESTRUCTIVE_REPLACEMENT',
          'table','release_bundle_entities','id',v_id,'match',v_match,
          'message','the release member list is replaced');
        IF p_commit THEN DELETE FROM release_bundle_entities WHERE release_bundle_id = v_id; END IF;
      END IF;
      FOR v_e IN SELECT * FROM jsonb_array_elements(v_item->'entities') LOOP
        IF v_e->>'entity_type' IS NULL OR v_e->>'entity_id' IS NULL THEN
          RAISE EXCEPTION 'INVALID_PAYLOAD: release entities need entity_type and entity_id';
        END IF;
        PERFORM public.admin_entity_meta(v_e->>'entity_type');
        v_key := (v_e->>'entity_type') || ':' || (v_e->>'entity_id');
        IF v_key = ANY(v_seen) THEN RAISE EXCEPTION 'DUPLICATE_RELEASE_ENTITY: %', v_key; END IF;
        v_seen := v_seen || v_key;
        IF p_commit THEN
          INSERT INTO release_bundle_entities(release_bundle_id, entity_type, entity_id, role, sort_order)
          VALUES (v_id, v_e->>'entity_type', (v_e->>'entity_id')::uuid, v_e->>'role',
                  coalesce((v_e->>'sort_order')::int, 0))
          ON CONFLICT (release_bundle_id, entity_type, entity_id)
          DO UPDATE SET role = EXCLUDED.role, sort_order = EXCLUDED.sort_order;
        END IF;
      END LOOP;
      v_ops := v_ops || jsonb_build_array(jsonb_build_object('action','update','table','release_bundle_entities',
        'id', v_id, 'match', v_match, 'fields', jsonb_build_object('entities', v_item->'entities')));
    END;
  END IF;

  RETURN jsonb_build_object('kind', p_kind, 'id', v_id, 'match', v_match,
    'action', v_res->>'action', 'applied', p_commit,
    'operations', v_ops, 'destructive', v_destr, 'warnings', v_warn,
    'resolved_references', v_resolved, 'normalized_fields', v_fields);
END $$;

REVOKE EXECUTE ON FUNCTION public.admin_apply_entity(text,jsonb,boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_upsert_row(text,uuid,jsonb,text,boolean,text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_resolve_card(jsonb) FROM anon;