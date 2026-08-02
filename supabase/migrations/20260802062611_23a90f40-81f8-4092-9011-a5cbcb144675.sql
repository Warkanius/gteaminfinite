-- ---------- small utilities ----------
CREATE OR REPLACE FUNCTION public.admin_has_column(p_table text, p_column text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name=p_table AND column_name=p_column);
$$;

CREATE OR REPLACE FUNCTION public.admin_require_admin()
RETURNS void LANGUAGE plpgsql STABLE SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED: sign in first'; END IF;
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN RAISE EXCEPTION 'FORBIDDEN: admin role required'; END IF;
END $$;

-- entity_type -> { table, name_column, key_column, lifecycle }
CREATE OR REPLACE FUNCTION public.admin_entity_meta(p_type text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  v := (jsonb_build_object(
    'player_card',      jsonb_build_object('table','player_cards','name_column','name','key_column','card_key'),
    'pack',             jsonb_build_object('table','packs','name_column','name'),
    'collection',       jsonb_build_object('table','collections','name_column','name'),
    'sub_collection',   jsonb_build_object('table','sub_collections','name_column','name'),
    'team',             jsonb_build_object('table','teams','name_column','name'),
    'run',              jsonb_build_object('table','runs','name_column','name'),
    'challenge',        jsonb_build_object('table','challenges','name_column','name'),
    'storyline',        jsonb_build_object('table','storylines','name_column','title'),
    'domination_road',  jsonb_build_object('table','domination_roads','name_column','name','key_column','slug'),
    'domination_game',  jsonb_build_object('table','domination_games','name_column','opponent_name'),
    'evo_path',         jsonb_build_object('table','evo_paths'),
    'gem_task',         jsonb_build_object('table','gem_tasks','name_column','title'),
    'badge',            jsonb_build_object('table','badges','name_column','name'),
    'signature_trait',  jsonb_build_object('table','signature_traits','name_column','name'),
    'gem_tier',         jsonb_build_object('table','gem_tiers','name_column','name'),
    'social_post',      jsonb_build_object('table','social_posts'),
    'location_account', jsonb_build_object('table','location_accounts','name_column','name'),
    'release_bundle',   jsonb_build_object('table','release_bundles','name_column','name','key_column','slug'),
    'locker_code',      jsonb_build_object('table','locker_codes','name_column','code'),
    'dynamic_duo',      jsonb_build_object('table','dynamic_duos','name_column','name'),
    'gem_market_listing', jsonb_build_object('table','gem_market_listings')
  ))->p_type;
  IF v IS NULL THEN RAISE EXCEPTION 'UNKNOWN_ENTITY_TYPE: %', p_type; END IF;
  RETURN v || jsonb_build_object('lifecycle', public.admin_has_column(v->>'table','status'));
END $$;

-- ---------- usage audit ----------
CREATE OR REPLACE FUNCTION public.admin_usage(p_entity_type text, p_entity_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record; v_sql text; v_rows jsonb; v_out jsonb := '[]'::jsonb;
  v_label text; v_status text; v_parent text; v_where text;
BEGIN
  PERFORM public.admin_require_admin();
  FOR r IN SELECT * FROM content_reference_registry
           WHERE target_entity_type = p_entity_type AND is_active ORDER BY reference_type LOOP
    IF NOT public.admin_has_column(r.source_table, r.source_column) THEN CONTINUE; END IF;
    v_label  := CASE WHEN r.label_column IS NOT NULL AND public.admin_has_column(r.source_table, r.label_column)
                     THEN format('left(t.%I::text, 120)', r.label_column) ELSE 'NULL::text' END;
    v_status := CASE WHEN public.admin_has_column(r.source_table,'status') THEN 't.status::text' ELSE 'NULL::text' END;
    v_parent := CASE WHEN r.parent_column IS NOT NULL AND public.admin_has_column(r.source_table, r.parent_column)
                     THEN format('t.%I::text', r.parent_column) ELSE 'NULL::text' END;
    v_where  := CASE WHEN r.column_kind = 'uuid_array'
                     THEN format('$1 = ANY(t.%I)', r.source_column)
                     ELSE format('t.%I = $1', r.source_column) END;
    v_sql := format(
      'SELECT coalesce(jsonb_agg(jsonb_build_object(
          ''reference_type'', %L, ''source_table'', %L, ''is_protected'', %L::boolean,
          ''referencing_entity_id'', t.id, ''referencing_entity_name'', %s,
          ''parent_id'', %s, ''status'', %s)), ''[]''::jsonb)
       FROM public.%I t WHERE %s',
      r.reference_type, r.source_table, r.is_protected, v_label, v_parent, v_status, r.source_table, v_where);
    EXECUTE v_sql INTO v_rows USING p_entity_id;
    v_out := v_out || v_rows;
  END LOOP;
  RETURN v_out;
END $$;

CREATE OR REPLACE FUNCTION public.admin_player_usage(p_card_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_card jsonb; v_refs jsonb; v_versions jsonb;
BEGIN
  PERFORM public.admin_require_admin();
  SELECT jsonb_build_object('player_card_id',pc.id,'card_key',pc.card_key,'name',pc.name,'rating',pc.rating,
           'gem_tier', gt.name, 'team', tm.name, 'collection', c.name, 'sub_collection', sc.name,
           'card_variant', pc.card_variant, 'evo_stage', pc.evo_stage, 'status', pc.status)
    INTO v_card
  FROM player_cards pc
  LEFT JOIN gem_tiers gt ON gt.id = pc.gem_tier_id
  LEFT JOIN teams tm ON tm.id = pc.team_id
  LEFT JOIN collections c ON c.id = pc.collection_id
  LEFT JOIN sub_collections sc ON sc.id = pc.sub_collection_id
  WHERE pc.id = p_card_id;
  IF v_card IS NULL THEN RAISE EXCEPTION 'UNKNOWN_PLAYER_CARD_ID: %', p_card_id; END IF;

  v_refs := public.admin_usage('player_card', p_card_id);
  SELECT coalesce(jsonb_agg(jsonb_build_object('player_card_id',pc.id,'card_key',pc.card_key,'name',pc.name,
           'rating',pc.rating,'gem_tier',gt.name,'card_variant',pc.card_variant,'evo_stage',pc.evo_stage,
           'status',pc.status) ORDER BY pc.evo_stage, pc.rating), '[]'::jsonb)
    INTO v_versions
  FROM player_cards pc LEFT JOIN gem_tiers gt ON gt.id = pc.gem_tier_id
  WHERE lower(btrim(pc.name)) = lower(btrim(v_card->>'name'));

  RETURN jsonb_build_object('card', v_card, 'all_versions_of_name', v_versions,
    'reference_count', jsonb_array_length(v_refs), 'references', v_refs,
    'is_unused', jsonb_array_length(v_refs) = 0);
END $$;

CREATE OR REPLACE FUNCTION public.admin_unused_players(p_by_name boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_used uuid[]; v_out jsonb;
BEGIN
  PERFORM public.admin_require_admin();
  SELECT coalesce(array_agg(DISTINCT pc.id), '{}') INTO v_used
  FROM player_cards pc
  WHERE jsonb_array_length(public.admin_usage('player_card', pc.id)) > 0;

  IF p_by_name THEN
    SELECT coalesce(jsonb_agg(x), '[]'::jsonb) INTO v_out FROM (
      SELECT jsonb_build_object('normalized_name', lower(btrim(name)), 'versions', count(*),
               'player_card_ids', jsonb_agg(id)) AS x
      FROM player_cards GROUP BY lower(btrim(name))
      HAVING bool_and(NOT (id = ANY(v_used)))
      ORDER BY 1) s;
  ELSE
    SELECT coalesce(jsonb_agg(jsonb_build_object('player_card_id',pc.id,'card_key',pc.card_key,'name',pc.name,
             'rating',pc.rating,'gem_tier',gt.name,'status',pc.status) ORDER BY pc.name), '[]'::jsonb) INTO v_out
    FROM player_cards pc LEFT JOIN gem_tiers gt ON gt.id = pc.gem_tier_id
    WHERE NOT (pc.id = ANY(v_used));
  END IF;
  RETURN jsonb_build_object('mode', CASE WHEN p_by_name THEN 'normalized_name' ELSE 'card_record' END,
                            'count', jsonb_array_length(v_out), 'items', v_out);
END $$;

CREATE OR REPLACE FUNCTION public.admin_duplicate_player_names()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  PERFORM public.admin_require_admin();
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'normalized_name'), '[]'::jsonb) INTO v FROM (
    SELECT jsonb_build_object('normalized_name', lower(btrim(pc.name)), 'count', count(*),
      'versions', jsonb_agg(jsonb_build_object('player_card_id',pc.id,'card_key',pc.card_key,'name',pc.name,
        'rating',pc.rating,'gem_tier',gt.name,'team',tm.name,'collection',c.name,'sub_collection',sc.name,
        'card_variant',pc.card_variant,'evo_stage',pc.evo_stage,'status',pc.status) ORDER BY pc.evo_stage, pc.rating DESC)) AS x
    FROM player_cards pc
    LEFT JOIN gem_tiers gt ON gt.id = pc.gem_tier_id
    LEFT JOIN teams tm ON tm.id = pc.team_id
    LEFT JOIN collections c ON c.id = pc.collection_id
    LEFT JOIN sub_collections sc ON sc.id = pc.sub_collection_id
    GROUP BY lower(btrim(pc.name)) HAVING count(*) > 1) s;
  RETURN jsonb_build_object('count', jsonb_array_length(v), 'groups', v);
END $$;

-- ---------- reward payload validation ----------
CREATE OR REPLACE FUNCTION public.admin_reward_validate(p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_err jsonb := '[]'::jsonb; v_warn jsonb := '[]'::jsonb;
  v_items jsonb; v_it jsonb; v_type text; v_mode text; v_weight numeric := 0; v_has_weight boolean := false;
  v_resolved jsonb := '[]'::jsonb; v_st text; v_name text;
BEGIN
  IF p_payload IS NULL OR p_payload = 'null'::jsonb THEN
    RETURN jsonb_build_object('valid', true, 'errors','[]'::jsonb,'warnings','[]'::jsonb,'normalized', NULL);
  END IF;
  IF jsonb_typeof(p_payload) <> 'object' THEN
    RETURN jsonb_build_object('valid', false, 'errors', jsonb_build_array(
      jsonb_build_object('code','REWARD_NOT_OBJECT','message','reward payload must be an object with a mode and items')),
      'warnings','[]'::jsonb,'normalized', p_payload);
  END IF;

  v_mode := lower(coalesce(p_payload->>'mode','all'));
  IF v_mode NOT IN ('all','choice','weighted','first_then_repeat') THEN
    v_err := v_err || jsonb_build_object('code','REWARD_MODE_INVALID','message',
      format('mode "%s" is not one of all | choice | weighted | first_then_repeat', v_mode));
  END IF;

  v_items := coalesce(p_payload->'items', p_payload->'rewards', '[]'::jsonb);
  IF v_mode = 'first_then_repeat' THEN
    v_items := coalesce(p_payload->'first', '[]'::jsonb) || coalesce(p_payload->'repeat', '[]'::jsonb);
    IF jsonb_array_length(coalesce(p_payload->'first','[]'::jsonb)) = 0 THEN
      v_err := v_err || jsonb_build_object('code','REWARD_FIRST_EMPTY','message','first_then_repeat needs a non-empty "first" array');
    END IF;
  END IF;

  IF jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
    v_err := v_err || jsonb_build_object('code','REWARD_GROUP_EMPTY','message','reward payload has no items');
  ELSE
    FOR v_it IN SELECT * FROM jsonb_array_elements(v_items) LOOP
      v_type := lower(coalesce(v_it->>'type',''));
      IF v_type NOT IN ('coins','gems','pack','card','nothing') THEN
        v_err := v_err || jsonb_build_object('code','REWARD_TYPE_INVALID','message',
          format('reward item type "%s" is not one of coins | gems | pack | card | nothing', v_type),'item',v_it);
        CONTINUE;
      END IF;
      IF v_type IN ('coins','gems') THEN
        IF coalesce((v_it->>'amount')::numeric, -1) < 0 THEN
          v_err := v_err || jsonb_build_object('code','REWARD_AMOUNT_INVALID','message','coins/gems need amount >= 0','item',v_it);
        END IF;
      ELSIF v_type = 'pack' THEN
        IF v_it->>'pack_id' IS NULL THEN
          v_err := v_err || jsonb_build_object('code','REWARD_TARGET_MISSING','message','pack rewards need pack_id (names are often duplicated)','item',v_it);
        ELSE
          SELECT status::text, name INTO v_st, v_name FROM packs WHERE id = (v_it->>'pack_id')::uuid;
          IF v_name IS NULL THEN
            v_err := v_err || jsonb_build_object('code','REWARD_TARGET_MISSING','message',format('pack %s does not exist', v_it->>'pack_id'),'item',v_it);
          ELSE
            v_resolved := v_resolved || jsonb_build_object('type','pack','id',v_it->>'pack_id','name',v_name,'status',v_st);
            IF v_st IN ('draft','archived') THEN
              v_err := v_err || jsonb_build_object('code','REWARD_TARGET_NOT_PUBLISHABLE','message',
                format('pack "%s" is %s and cannot back an active reward', v_name, v_st),'item',v_it);
            END IF;
          END IF;
        END IF;
      ELSIF v_type = 'card' THEN
        IF v_it->>'player_card_id' IS NULL THEN
          v_err := v_err || jsonb_build_object('code','REWARD_TARGET_MISSING','message','card rewards need player_card_id or card_key resolved to an id','item',v_it);
        ELSE
          SELECT status::text, name INTO v_st, v_name FROM player_cards WHERE id = (v_it->>'player_card_id')::uuid;
          IF v_name IS NULL THEN
            v_err := v_err || jsonb_build_object('code','REWARD_TARGET_MISSING','message',format('player card %s does not exist', v_it->>'player_card_id'),'item',v_it);
          ELSE
            v_resolved := v_resolved || jsonb_build_object('type','card','id',v_it->>'player_card_id','name',v_name,'status',v_st);
            IF v_st IN ('draft','archived') THEN
              v_err := v_err || jsonb_build_object('code','REWARD_TARGET_NOT_PUBLISHABLE','message',
                format('card "%s" is %s and cannot back an active reward', v_name, v_st),'item',v_it);
            END IF;
          END IF;
        END IF;
      END IF;
      IF v_it ? 'weight' THEN
        v_has_weight := true;
        IF (v_it->>'weight')::numeric <= 0 THEN
          v_err := v_err || jsonb_build_object('code','REWARD_WEIGHT_INVALID','message','weights must be > 0','item',v_it);
        END IF;
        v_weight := v_weight + (v_it->>'weight')::numeric;
      END IF;
    END LOOP;
  END IF;

  IF v_mode = 'weighted' AND NOT v_has_weight THEN
    v_err := v_err || jsonb_build_object('code','REWARD_WEIGHTS_MISSING','message','mode=weighted requires a weight on every item');
  END IF;
  IF v_has_weight AND v_mode <> 'weighted' THEN
    v_warn := v_warn || jsonb_build_object('code','REWARD_WEIGHT_IGNORED','message',
      format('weights are only used when mode=weighted (mode is %s)', v_mode));
  END IF;
  IF v_mode = 'weighted' AND v_has_weight AND v_weight <> 100 THEN
    v_warn := v_warn || jsonb_build_object('code','REWARD_WEIGHT_TOTAL','message',
      format('weights total %s (they are treated as relative shares, not percentages)', v_weight));
  END IF;

  RETURN jsonb_build_object('valid', jsonb_array_length(v_err) = 0, 'errors', v_err, 'warnings', v_warn,
    'mode', v_mode, 'item_count', jsonb_array_length(coalesce(v_items,'[]'::jsonb)),
    'resolved_targets', v_resolved, 'normalized', p_payload);
END $$;

-- ---------- lifecycle ----------
CREATE OR REPLACE FUNCTION public.admin_lifecycle_apply(
  p_entity_type text, p_entity_id uuid, p_status text, p_dates jsonb DEFAULT '{}'::jsonb,
  p_commit boolean DEFAULT false, p_override boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_meta jsonb; v_tbl text; v_from text; v_name text; v_sets text[] := '{}'; v_warn jsonb := '[]'::jsonb;
  v_draft_deps jsonb := '[]'::jsonb; r record;
BEGIN
  PERFORM public.admin_require_admin();
  v_meta := public.admin_entity_meta(p_entity_type);
  v_tbl := v_meta->>'table';
  IF NOT (v_meta->>'lifecycle')::boolean THEN RAISE EXCEPTION 'NO_LIFECYCLE: % has no lifecycle fields', p_entity_type; END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('draft','scheduled','active','disabled','archived') THEN
    RAISE EXCEPTION 'INVALID_STATUS: %', p_status;
  END IF;

  EXECUTE format('SELECT status::text, %s FROM public.%I WHERE id = $1',
    CASE WHEN v_meta ? 'name_column' THEN format('%I::text', v_meta->>'name_column') ELSE 'id::text' END, v_tbl)
    INTO v_from, v_name USING p_entity_id;
  IF v_from IS NULL THEN RAISE EXCEPTION 'UNKNOWN_ENTITY: % %', p_entity_type, p_entity_id; END IF;

  IF p_status IN ('active','scheduled') THEN
    FOR r IN SELECT * FROM jsonb_array_elements(public.admin_usage(p_entity_type, p_entity_id)) e(v) LOOP
      IF (r.v->>'status') IN ('draft','archived') THEN
        v_draft_deps := v_draft_deps || r.v;
      END IF;
    END LOOP;
    IF jsonb_array_length(v_draft_deps) > 0 AND NOT p_override THEN
      v_warn := v_warn || jsonb_build_object('code','DEPENDENCY_NOT_PUBLISHABLE',
        'message','related records are draft or archived; pass override: true to publish anyway',
        'dependencies', v_draft_deps);
    END IF;
  END IF;

  IF p_status IS NOT NULL THEN v_sets := v_sets || format('status = %L::public.content_status', p_status); END IF;
  IF p_status = 'archived' THEN v_sets := v_sets || 'archived_at = now()';
  ELSIF p_status = 'disabled' THEN v_sets := v_sets || 'disabled_at = now()';
  ELSIF p_status = 'active' THEN v_sets := v_sets || 'archived_at = NULL, disabled_at = NULL';
  END IF;
  IF p_dates ? 'publish_at' THEN v_sets := v_sets || format('publish_at = %L::timestamptz', p_dates->>'publish_at'); END IF;
  IF p_dates ? 'starts_at' THEN v_sets := v_sets || format('starts_at = %L::timestamptz', p_dates->>'starts_at'); END IF;
  IF p_dates ? 'ends_at' THEN v_sets := v_sets || format('ends_at = %L::timestamptz', p_dates->>'ends_at'); END IF;

  IF p_commit AND array_length(v_sets,1) > 0 THEN
    EXECUTE format('UPDATE public.%I SET %s WHERE id = $1', v_tbl, array_to_string(v_sets, ', ')) USING p_entity_id;
    INSERT INTO lifecycle_history(entity_type, entity_id, from_status, to_status, changed_by)
    VALUES (p_entity_type, p_entity_id, v_from, coalesce(p_status, v_from), auth.uid());
  END IF;

  RETURN jsonb_build_object('entity_type', p_entity_type, 'entity_id', p_entity_id, 'entity_name', v_name,
    'from_status', v_from, 'to_status', coalesce(p_status, v_from), 'dates', p_dates,
    'applied', p_commit, 'warnings', v_warn,
    'operations', jsonb_build_array(jsonb_build_object('action','update','table',v_tbl,'id',p_entity_id,
      'match', v_name, 'fields', jsonb_build_object('status', coalesce(p_status, v_from)) || coalesce(p_dates,'{}'::jsonb))));
END $$;

-- ---------- rename ----------
CREATE OR REPLACE FUNCTION public.admin_rename_apply(
  p_entity_type text, p_entity_id uuid, p_new_name text, p_new_key text DEFAULT NULL,
  p_commit boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_meta jsonb; v_tbl text; v_ncol text; v_kcol text; v_old text; v_oldkey text;
  v_dupes int := 0; v_refs jsonb; v_sets text[] := '{}'; v_warn jsonb := '[]'::jsonb; v_extra jsonb := '{}'::jsonb;
BEGIN
  PERFORM public.admin_require_admin();
  IF p_new_name IS NULL AND p_new_key IS NULL THEN RAISE EXCEPTION 'NOTHING_TO_RENAME: supply new_name and/or new_key'; END IF;
  v_meta := public.admin_entity_meta(p_entity_type);
  v_tbl := v_meta->>'table'; v_ncol := v_meta->>'name_column'; v_kcol := v_meta->>'key_column';
  IF v_ncol IS NULL AND p_new_name IS NOT NULL THEN RAISE EXCEPTION 'NOT_RENAMEABLE: % has no display name column', p_entity_type; END IF;

  EXECUTE format('SELECT %s, %s FROM public.%I WHERE id = $1',
    coalesce(format('%I::text', v_ncol), 'NULL::text'),
    coalesce(format('%I::text', v_kcol), 'NULL::text'), v_tbl) INTO v_old, v_oldkey USING p_entity_id;
  IF v_old IS NULL AND v_oldkey IS NULL THEN RAISE EXCEPTION 'UNKNOWN_ENTITY: % %', p_entity_type, p_entity_id; END IF;

  IF p_new_name IS NOT NULL THEN
    EXECUTE format('SELECT count(*) FROM public.%I WHERE lower(btrim(%I::text)) = lower(btrim($1)) AND id <> $2',
      v_tbl, v_ncol) INTO v_dupes USING p_new_name, p_entity_id;
    IF v_dupes > 0 THEN
      IF p_entity_type = 'player_card' THEN
        v_warn := v_warn || jsonb_build_object('code','DUPLICATE_DISPLAY_NAME','message',
          format('%s other card(s) already use the name "%s" — legal for cards, but future name-only targeting of this card will be rejected as ambiguous', v_dupes, p_new_name));
      ELSE
        RAISE EXCEPTION 'NAME_TAKEN: % other %s record(s) already use "%s"', v_dupes, p_entity_type, p_new_name;
      END IF;
    END IF;
    v_sets := v_sets || format('%I = %L', v_ncol, p_new_name);
  END IF;

  IF p_new_key IS NOT NULL THEN
    IF v_kcol IS NULL THEN RAISE EXCEPTION 'NO_KEY_COLUMN: % has no canonical key', p_entity_type; END IF;
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I = $1 AND id <> $2', v_tbl, v_kcol)
      INTO v_dupes USING p_new_key, p_entity_id;
    IF v_dupes > 0 THEN RAISE EXCEPTION 'KEY_TAKEN: %s "%s" is already used', v_kcol, p_new_key; END IF;
    v_sets := v_sets || format('%I = %L', v_kcol, p_new_key);
  END IF;

  v_refs := public.admin_usage(p_entity_type, p_entity_id);

  IF p_commit THEN
    EXECUTE format('UPDATE public.%I SET %s WHERE id = $1', v_tbl, array_to_string(v_sets, ', ')) USING p_entity_id;
    -- refresh intentionally denormalized display-name caches
    IF p_entity_type = 'domination_road' AND p_new_name IS NOT NULL THEN
      UPDATE domination_games SET road_name = p_new_name WHERE road_id = p_entity_id;
      v_extra := v_extra || jsonb_build_object('domination_games_road_name_refreshed',
        (SELECT count(*) FROM domination_games WHERE road_id = p_entity_id));
    END IF;
    IF p_entity_type = 'player_card' AND p_new_name IS NOT NULL THEN
      UPDATE player_cards SET gem_name = gem_name WHERE id = p_entity_id;
    END IF;
  END IF;

  RETURN jsonb_build_object('entity_type', p_entity_type, 'entity_id', p_entity_id,
    'old_name', v_old, 'new_name', coalesce(p_new_name, v_old),
    'old_key', v_oldkey, 'new_key', coalesce(p_new_key, v_oldkey),
    'applied', p_commit, 'warnings', v_warn, 'side_effects', v_extra,
    'dependent_records', v_refs, 'dependent_count', jsonb_array_length(v_refs),
    'operations', jsonb_build_array(jsonb_build_object('action','update','table',v_tbl,'id',p_entity_id,
      'match', v_old, 'fields', jsonb_strip_nulls(jsonb_build_object('name', p_new_name, 'key', p_new_key)))));
END $$;

CREATE OR REPLACE FUNCTION public.admin_rename_domination_opponent(
  p_game_id uuid, p_road_id uuid, p_game_order int, p_new_name text, p_commit boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_old text; v_road text; v_order int;
BEGIN
  PERFORM public.admin_require_admin();
  IF p_new_name IS NULL OR btrim(p_new_name) = '' THEN RAISE EXCEPTION 'INVALID_PAYLOAD: new_opponent_name required'; END IF;
  IF p_game_id IS NOT NULL THEN
    SELECT id, opponent_name, road_name, game_order INTO v_id, v_old, v_road, v_order FROM domination_games WHERE id = p_game_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'UNKNOWN_DOMINATION_GAME_ID: %', p_game_id; END IF;
  ELSIF p_road_id IS NOT NULL AND p_game_order IS NOT NULL THEN
    SELECT id, opponent_name, road_name, game_order INTO v_id, v_old, v_road, v_order
    FROM domination_games WHERE road_id = p_road_id AND game_order = p_game_order;
    IF v_id IS NULL THEN RAISE EXCEPTION 'UNKNOWN_DOMINATION_GAME: road % order %', p_road_id, p_game_order; END IF;
  ELSE
    RAISE EXCEPTION 'AMBIGUOUS_TARGET: supply domination_game_id, or road_id + game_order. Opponent names repeat across rematches and are never a valid key.';
  END IF;
  IF p_commit THEN UPDATE domination_games SET opponent_name = p_new_name WHERE id = v_id; END IF;
  RETURN jsonb_build_object('domination_game_id', v_id, 'road_name', v_road, 'game_order', v_order,
    'old_opponent_name', v_old, 'new_opponent_name', p_new_name, 'applied', p_commit, 'scope','single_game',
    'operations', jsonb_build_array(jsonb_build_object('action','update','table','domination_games','id',v_id,
      'match', format('%s game %s', v_road, v_order), 'fields', jsonb_build_object('opponent_name', p_new_name))));
END $$;

-- ---------- dependency-aware delete ----------
CREATE OR REPLACE FUNCTION public.admin_delete_entity(
  p_entity_type text, p_entity_id uuid, p_force boolean DEFAULT false, p_commit boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_meta jsonb; v_tbl text; v_name text; v_refs jsonb; v_protected jsonb := '[]'::jsonb; r record;
BEGIN
  PERFORM public.admin_require_admin();
  v_meta := public.admin_entity_meta(p_entity_type);
  v_tbl := v_meta->>'table';
  EXECUTE format('SELECT %s FROM public.%I WHERE id = $1',
    CASE WHEN v_meta ? 'name_column' THEN format('%I::text', v_meta->>'name_column') ELSE 'id::text' END, v_tbl)
    INTO v_name USING p_entity_id;
  IF v_name IS NULL THEN RAISE EXCEPTION 'UNKNOWN_ENTITY: % %', p_entity_type, p_entity_id; END IF;

  v_refs := public.admin_usage(p_entity_type, p_entity_id);
  FOR r IN SELECT * FROM jsonb_array_elements(v_refs) e(v) LOOP
    IF coalesce((r.v->>'is_protected')::boolean, true) THEN v_protected := v_protected || r.v; END IF;
  END LOOP;

  IF p_commit THEN
    IF jsonb_array_length(v_protected) > 0 AND NOT p_force THEN
      RAISE EXCEPTION 'PROTECTED_DEPENDENCIES: % reference(s) still point at this % — resolve them or commit with force: true',
        jsonb_array_length(v_protected), p_entity_type;
    END IF;
    EXECUTE format('DELETE FROM public.%I WHERE id = $1', v_tbl) USING p_entity_id;
  END IF;

  RETURN jsonb_build_object('entity_type', p_entity_type, 'entity_id', p_entity_id, 'entity_name', v_name,
    'applied', p_commit, 'force', p_force,
    'dependency_count', jsonb_array_length(v_refs), 'dependencies', v_refs,
    'protected_dependencies', v_protected,
    'recommendation', CASE WHEN jsonb_array_length(v_protected) > 0
      THEN 'Prefer archiving: this record is still referenced by live content.'
      ELSE 'Safe to hard delete; nothing references it.' END,
    'destructive', jsonb_build_array(jsonb_build_object('action','delete','table',v_tbl,'id',p_entity_id,
      'match', v_name, 'label','DESTRUCTIVE_REPLACEMENT')));
END $$;

REVOKE EXECUTE ON FUNCTION public.admin_usage(text,uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_player_usage(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_unused_players(boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_duplicate_player_names() FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_reward_validate(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_lifecycle_apply(text,uuid,text,jsonb,boolean,boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_rename_apply(text,uuid,text,text,boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_rename_domination_opponent(uuid,uuid,int,text,boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_delete_entity(text,uuid,boolean,boolean) FROM anon;