-- 1. decimal Runs rating on cards
ALTER TABLE public.player_cards ALTER COLUMN run_rating TYPE numeric USING run_rating::numeric;

-- 2. Runs data on playable evo versions
ALTER TABLE public.evo_card_versions
  ADD COLUMN IF NOT EXISTS run_rating numeric,
  ADD COLUMN IF NOT EXISTS run_stat_3pt integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS run_stat_mid integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS run_stat_fin integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS run_stat_dnk integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS run_stat_ast integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS run_stat_stl integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS run_stat_reb integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS run_stat_blk integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS run_stat_int integer NOT NULL DEFAULT 0;

-- 3. preview-time type contract: every field must be castable to its column type
CREATE OR REPLACE FUNCTION public.admin_assert_castable(p_table text, p_fields jsonb)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE k text; v_type text; v_txt text; v_num numeric;
BEGIN
  IF p_fields IS NULL OR jsonb_typeof(p_fields) <> 'object' THEN RETURN; END IF;
  FOR k IN SELECT jsonb_object_keys(p_fields) LOOP
    v_type := public.admin_col_type(p_table, k);
    IF v_type IS NULL THEN
      RAISE EXCEPTION 'UNKNOWN_FIELD: "%" is not a column of %', k, p_table;
    END IF;
    CONTINUE WHEN v_type IN ('jsonb','json') OR v_type LIKE '%[]';
    CONTINUE WHEN jsonb_typeof(p_fields->k) = 'null';
    v_txt := p_fields->>k;
    CONTINUE WHEN v_txt IS NULL;

    IF v_type IN ('integer','bigint','smallint') THEN
      BEGIN
        v_num := v_txt::numeric;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'INVALID_FIELD_TYPE: %.% expects a whole number, got "%"', p_table, k, v_txt;
      END;
      IF v_num <> trunc(v_num) THEN
        RAISE EXCEPTION 'INVALID_FIELD_TYPE: %.% is a whole-number column but received %. Send a whole number (this column cannot store decimals).', p_table, k, v_txt;
      END IF;
    END IF;

    BEGIN
      EXECUTE format('SELECT (($1->>%L)::%s)', k, v_type) USING p_fields;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'INVALID_FIELD_TYPE: %.% (%) cannot accept "%"', p_table, k, v_type, v_txt;
    END;
  END LOOP;
END $fn$;

-- 4. generic upsert now validates types during preview, not only at commit
CREATE OR REPLACE FUNCTION public.admin_upsert_row(p_table text, p_id uuid, p_fields jsonb, p_match text, p_commit boolean, p_action text DEFAULT 'upsert'::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
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

  PERFORM public.admin_assert_castable(p_table, p_fields);

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
END $fn$;

-- 5. player apply: id aliases, gem resolution, decimal Runs rating, preview type contract
CREATE OR REPLACE FUNCTION public.admin_apply_player(p_payload jsonb, p_commit boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  v_ops jsonb := '[]'::jsonb;
  v_destr jsonb := '[]'::jsonb;
  v_id uuid; v_name text; v_new_name text; v_key text; v_ref_txt text;
  v_tier uuid; v_team uuid; v_coll uuid; v_sub uuid; v_base uuid;
  v_gem_name text; v_rating numeric; v_band int; v_n int; v_el jsonb; v_ref uuid;
  v_badges jsonb := '[]'::jsonb;
  v_traits jsonb := '[]'::jsonb;
  v_fields jsonb;
  v_action text := lower(coalesce(p_payload->>'action','upsert'));
  v_tiers text[] := ARRAY['base','gold','hof','diamond','actolytrene'];
  v_stat_keys text[] := ARRAY['stat_3pt','stat_mid','stat_fin','stat_dnk','stat_ast','stat_stl','stat_reb','stat_blk','stat_int',
                              'run_stat_3pt','run_stat_mid','run_stat_fin','run_stat_dnk','run_stat_ast','run_stat_stl','run_stat_reb','run_stat_blk','run_stat_int'];
  v_k text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED: sign in first'; END IF;
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN RAISE EXCEPTION 'FORBIDDEN: admin role required'; END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN RAISE EXCEPTION 'INVALID_PAYLOAD: payload must be an object'; END IF;

  ----------------------------------------------------------------- resolve card
  v_ref_txt := coalesce(nullif(btrim(coalesce(p_payload->>'player_card_id','')),''),
                        nullif(btrim(coalesce(p_payload->>'player_id','')),''),
                        nullif(btrim(coalesce(p_payload->>'card_id','')),''),
                        nullif(btrim(coalesce(p_payload->>'id','')),''));
  IF v_ref_txt IS NOT NULL THEN
    IF v_ref_txt !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'INVALID_PLAYER_ID: "%" is not a uuid', v_ref_txt;
    END IF;
    SELECT id, name INTO v_id, v_name FROM player_cards WHERE id = v_ref_txt::uuid;
    IF v_id IS NULL THEN RAISE EXCEPTION 'UNKNOWN_PLAYER_ID: %', v_ref_txt; END IF;
  ELSIF nullif(btrim(coalesce(p_payload->>'card_key','')),'') IS NOT NULL THEN
    v_key := btrim(p_payload->>'card_key');
    SELECT id, name INTO v_id, v_name FROM player_cards WHERE lower(card_key) = lower(v_key);
    IF v_id IS NULL AND v_action = 'update' THEN RAISE EXCEPTION 'UNKNOWN_CARD_KEY: %', v_key; END IF;
    v_name := coalesce(v_name, btrim(coalesce(p_payload->>'name','')));
  ELSE
    v_name := btrim(coalesce(p_payload->>'name',''));
    IF v_name = '' THEN RAISE EXCEPTION 'MISSING_PLAYER_REF: supply player_card_id, card_key, or name'; END IF;
    SELECT count(*) INTO v_n FROM player_cards WHERE lower(name) = lower(v_name);
    IF v_n > 1 THEN
      RAISE EXCEPTION 'AMBIGUOUS_PLAYER_NAME: "%" matches % cards. Target one with player_card_id or card_key. matches=%',
        v_name, v_n, public.admin_player_matches(v_name)::text;
    END IF;
    IF v_n = 1 AND v_action <> 'create' THEN
      SELECT id INTO v_id FROM player_cards WHERE lower(name) = lower(v_name);
    END IF;
  END IF;

  IF v_action = 'update' AND v_id IS NULL THEN
    RAISE EXCEPTION 'UNKNOWN_PLAYER: no existing card matched for action="update"';
  END IF;
  IF v_action = 'create' AND v_id IS NOT NULL THEN
    RAISE EXCEPTION 'ALREADY_EXISTS: action="create" but card % already exists', v_id;
  END IF;
  IF v_id IS NULL AND coalesce(v_name,'') = '' THEN RAISE EXCEPTION 'MISSING_NAME: new cards require a name'; END IF;

  v_new_name := nullif(btrim(coalesce(p_payload->>'new_name','')), '');
  IF v_key IS NOT NULL AND v_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM player_cards WHERE lower(card_key) = lower(v_key)) THEN
      RAISE EXCEPTION 'DUPLICATE_CARD_KEY: card_key "%" already exists', v_key;
    END IF;
  ELSIF v_key IS NOT NULL AND v_id IS NOT NULL AND p_payload ? 'new_card_key' THEN
    IF EXISTS (SELECT 1 FROM player_cards WHERE lower(card_key) = lower(btrim(p_payload->>'new_card_key')) AND id <> v_id) THEN
      RAISE EXCEPTION 'DUPLICATE_CARD_KEY: card_key "%" already exists', p_payload->>'new_card_key';
    END IF;
  END IF;

  ------------------------------------------------------------ resolve relations
  IF p_payload ? 'gem_tier_id' AND p_payload->>'gem_tier_id' IS NOT NULL THEN
    SELECT id INTO v_tier FROM gem_tiers WHERE id = (p_payload->>'gem_tier_id')::uuid;
    IF v_tier IS NULL THEN RAISE EXCEPTION 'UNKNOWN_GEM_TIER_ID: %', p_payload->>'gem_tier_id'; END IF;
  ELSIF p_payload ? 'gem_tier' AND p_payload->>'gem_tier' IS NOT NULL THEN
    SELECT id INTO v_tier FROM gem_tiers WHERE lower(name) = lower(btrim(p_payload->>'gem_tier'));
    IF v_tier IS NULL THEN
      RAISE EXCEPTION 'UNKNOWN_GEM_TIER: "%". Known tiers: %', p_payload->>'gem_tier',
        (SELECT string_agg(name, ', ' ORDER BY sort_order) FROM gem_tiers);
    END IF;
  END IF;

  -- gem_name is a display label; it must never be persisted without a real tier.
  v_gem_name := nullif(btrim(coalesce(p_payload->>'gem_name','')),'');
  v_rating := nullif(p_payload->>'rating','')::numeric;
  IF v_tier IS NULL AND v_gem_name IS NOT NULL THEN
    SELECT id INTO v_tier FROM gem_tiers WHERE lower(name) = lower(v_gem_name);
    IF v_tier IS NULL AND v_rating IS NOT NULL THEN
      v_band := floor(v_rating)::int;
      SELECT id INTO v_tier FROM gem_tiers WHERE stars = least(v_band, (SELECT max(stars) FROM gem_tiers));
    END IF;
    IF v_tier IS NULL AND v_id IS NOT NULL THEN
      SELECT gem_tier_id INTO v_tier FROM player_cards WHERE id = v_id;
    END IF;
    IF v_tier IS NULL THEN
      RAISE EXCEPTION 'GEM_TIER_UNRESOLVED: gem_name "%" does not match a gem tier and no rating was supplied to infer one. Send gem_tier (one of: %) or a rating.',
        v_gem_name, (SELECT string_agg(name, ', ' ORDER BY sort_order) FROM gem_tiers);
    END IF;
  END IF;

  IF p_payload ? 'team_id' THEN
    SELECT id INTO v_team FROM teams WHERE id = (p_payload->>'team_id')::uuid;
    IF v_team IS NULL THEN RAISE EXCEPTION 'UNKNOWN_TEAM_ID: %', p_payload->>'team_id'; END IF;
  ELSIF p_payload ? 'team' AND p_payload->>'team' IS NOT NULL THEN
    SELECT id INTO v_team FROM teams WHERE lower(name) = lower(btrim(p_payload->>'team'));
    IF v_team IS NULL THEN RAISE EXCEPTION 'UNKNOWN_TEAM: "%"', p_payload->>'team'; END IF;
  END IF;
  IF p_payload ? 'collection_id' THEN
    SELECT id INTO v_coll FROM collections WHERE id = (p_payload->>'collection_id')::uuid;
    IF v_coll IS NULL THEN RAISE EXCEPTION 'UNKNOWN_COLLECTION_ID: %', p_payload->>'collection_id'; END IF;
  ELSIF p_payload ? 'collection' AND p_payload->>'collection' IS NOT NULL THEN
    SELECT id INTO v_coll FROM collections WHERE lower(name) = lower(btrim(p_payload->>'collection'));
    IF v_coll IS NULL THEN RAISE EXCEPTION 'UNKNOWN_COLLECTION: "%"', p_payload->>'collection'; END IF;
  END IF;
  IF p_payload ? 'sub_collection_id' THEN
    SELECT id INTO v_sub FROM sub_collections WHERE id = (p_payload->>'sub_collection_id')::uuid;
    IF v_sub IS NULL THEN RAISE EXCEPTION 'UNKNOWN_SUB_COLLECTION_ID: %', p_payload->>'sub_collection_id'; END IF;
  ELSIF p_payload ? 'sub_collection' AND p_payload->>'sub_collection' IS NOT NULL THEN
    SELECT id INTO v_sub FROM sub_collections WHERE lower(name) = lower(btrim(p_payload->>'sub_collection'));
    IF v_sub IS NULL THEN RAISE EXCEPTION 'UNKNOWN_SUB_COLLECTION: "%"', p_payload->>'sub_collection'; END IF;
  END IF;
  IF p_payload ? 'base_card_id' THEN
    v_base := public.admin_resolve_player(p_payload->'base_card_id');
  END IF;

  FOREACH v_k IN ARRAY v_stat_keys LOOP
    IF p_payload ? v_k AND jsonb_typeof(p_payload->v_k) NOT IN ('number','null') THEN
      RAISE EXCEPTION 'INVALID_STAT: % must be a number', v_k;
    END IF;
  END LOOP;

  IF p_payload ? 'badges' THEN
    IF jsonb_typeof(p_payload->'badges') <> 'array' THEN RAISE EXCEPTION 'INVALID_BADGES: badges must be an array'; END IF;
    FOR v_el IN SELECT * FROM jsonb_array_elements(p_payload->'badges') LOOP
      IF v_el ? 'badge_id' THEN
        SELECT id INTO v_ref FROM badges WHERE id = (v_el->>'badge_id')::uuid;
        IF v_ref IS NULL THEN RAISE EXCEPTION 'UNKNOWN_BADGE_ID: %', v_el->>'badge_id'; END IF;
      ELSE
        SELECT id INTO v_ref FROM badges WHERE lower(name) = lower(btrim(v_el->>'badge')) OR lower(abbreviation) = lower(btrim(v_el->>'badge'));
        IF v_ref IS NULL THEN RAISE EXCEPTION 'UNKNOWN_BADGE: "%"', v_el->>'badge'; END IF;
      END IF;
      IF NOT (coalesce(v_el->>'tier','base') = ANY(v_tiers)) THEN
        RAISE EXCEPTION 'INVALID_BADGE_TIER: "%" (use base/gold/hof/diamond/actolytrene)', v_el->>'tier';
      END IF;
      v_badges := v_badges || jsonb_build_object('badge_id', v_ref, 'tier', coalesce(v_el->>'tier','base'), 'name', coalesce(v_el->>'badge', (SELECT name FROM badges WHERE id = v_ref)));
    END LOOP;
  END IF;

  IF p_payload ? 'traits' THEN
    IF jsonb_typeof(p_payload->'traits') <> 'array' THEN RAISE EXCEPTION 'INVALID_TRAITS: traits must be an array'; END IF;
    FOR v_el IN SELECT * FROM jsonb_array_elements(p_payload->'traits') LOOP
      IF v_el ? 'trait_id' THEN
        SELECT id INTO v_ref FROM signature_traits WHERE id = (v_el->>'trait_id')::uuid;
        IF v_ref IS NULL THEN RAISE EXCEPTION 'UNKNOWN_TRAIT_ID: %', v_el->>'trait_id'; END IF;
      ELSE
        SELECT id INTO v_ref FROM signature_traits WHERE lower(name) = lower(btrim(v_el->>'trait')) OR lower(abbreviation) = lower(btrim(v_el->>'trait'));
        IF v_ref IS NULL THEN RAISE EXCEPTION 'UNKNOWN_TRAIT: "%"', v_el->>'trait'; END IF;
      END IF;
      IF NOT (coalesce(v_el->>'tier','base') = ANY(v_tiers)) THEN
        RAISE EXCEPTION 'INVALID_TRAIT_TIER: "%"', v_el->>'tier';
      END IF;
      IF v_el ? 'target_stat' AND v_el->>'target_stat' IS NOT NULL
         AND NOT (v_el->>'target_stat' = ANY(ARRAY['stat_3pt','stat_mid','stat_fin','stat_dnk','stat_ast','stat_stl','stat_reb','stat_blk','stat_int'])) THEN
        RAISE EXCEPTION 'INVALID_TARGET_STAT: "%"', v_el->>'target_stat';
      END IF;
      v_traits := v_traits || jsonb_build_object('trait_id', v_ref, 'tier', coalesce(v_el->>'tier','base'), 'target_stat', v_el->>'target_stat', 'name', coalesce(v_el->>'trait', (SELECT name FROM signature_traits WHERE id = v_ref)));
    END LOOP;
  END IF;

  v_fields := jsonb_strip_nulls(jsonb_build_object(
    'name', coalesce(to_jsonb(v_new_name), CASE WHEN v_id IS NULL THEN to_jsonb(v_name) ELSE NULL END),
    'card_key', to_jsonb(coalesce(nullif(btrim(coalesce(p_payload->>'new_card_key','')),''), CASE WHEN v_id IS NULL THEN v_key ELSE NULL END)),
    'card_variant', p_payload->'card_variant',
    'evo_stage', p_payload->'evo_stage',
    'base_card_id', to_jsonb(v_base),
    'gem_tier_id', to_jsonb(v_tier),
    'gem_name', p_payload->'gem_name',
    'team_id', to_jsonb(v_team),
    'collection_id', to_jsonb(v_coll),
    'sub_collection_id', to_jsonb(v_sub),
    'position1', p_payload->'position1',
    'position2', p_payload->'position2',
    'rating', p_payload->'rating',
    'run_rating', p_payload->'run_rating',
    'market_value', p_payload->'market_value',
    'social_handle', p_payload->'social_handle',
    'avatar_url', p_payload->'avatar_url',
    'is_collection_reward', p_payload->'is_collection_reward',
    'card_color_primary', p_payload->'card_color_primary',
    'card_color_secondary', p_payload->'card_color_secondary',
    'card_glow_color', p_payload->'card_glow_color',
    'card_animation', p_payload->'card_animation'
  ));
  FOREACH v_k IN ARRAY v_stat_keys LOOP
    IF p_payload ? v_k THEN v_fields := v_fields || jsonb_build_object(v_k, p_payload->v_k); END IF;
  END LOOP;

  -- zero-write type contract: preview fails here instead of at commit
  PERFORM public.admin_assert_castable('player_cards', v_fields);

  v_ops := v_ops || jsonb_build_object(
    'table','player_cards',
    'action', CASE WHEN v_id IS NULL THEN 'insert' ELSE 'update' END,
    'id', v_id, 'match', coalesce(v_name, v_key),
    'fields', v_fields,
    'field_changes', public.admin_diff_fields('player_cards', v_id, v_fields));

  IF p_payload ? 'badges' THEN
    SELECT count(*) INTO v_n FROM player_card_badges WHERE player_card_id = v_id;
    v_destr := v_destr || jsonb_build_object('table','player_card_badges','action','replace','player', coalesce(v_name, v_key),
      'replaces_rows', coalesce(v_n,0), 'new_rows', jsonb_array_length(v_badges),
      'removed', coalesce((SELECT jsonb_agg(b.name) FROM player_card_badges pb JOIN badges b ON b.id = pb.badge_id
        WHERE pb.player_card_id = v_id AND NOT (pb.badge_id::text IN (SELECT jsonb_array_elements(v_badges)->>'badge_id'))), '[]'::jsonb),
      'new_assignments', v_badges);
  END IF;
  IF p_payload ? 'traits' THEN
    SELECT count(*) INTO v_n FROM player_card_traits WHERE player_card_id = v_id;
    v_destr := v_destr || jsonb_build_object('table','player_card_traits','action','replace','player', coalesce(v_name, v_key),
      'replaces_rows', coalesce(v_n,0), 'new_rows', jsonb_array_length(v_traits),
      'removed', coalesce((SELECT jsonb_agg(t.name) FROM player_card_traits pt JOIN signature_traits t ON t.id = pt.trait_id
        WHERE pt.player_card_id = v_id AND NOT (pt.trait_id::text IN (SELECT jsonb_array_elements(v_traits)->>'trait_id'))), '[]'::jsonb),
      'new_assignments', v_traits);
  END IF;

  IF p_commit THEN
    IF v_id IS NULL THEN
      INSERT INTO player_cards(name, card_key) VALUES (coalesce(v_new_name, v_name), coalesce(v_key, ''))
      RETURNING id INTO v_id;
    END IF;

    UPDATE player_cards SET
      name = coalesce(v_new_name, name),
      card_key = coalesce(nullif(btrim(coalesce(p_payload->>'new_card_key','')),''), card_key),
      card_variant = CASE WHEN p_payload ? 'card_variant' THEN p_payload->>'card_variant' ELSE card_variant END,
      evo_stage = coalesce((p_payload->>'evo_stage')::int, evo_stage),
      base_card_id = coalesce(v_base, base_card_id),
      gem_tier_id = coalesce(v_tier, gem_tier_id),
      gem_name = CASE WHEN p_payload ? 'gem_name' THEN p_payload->>'gem_name' ELSE gem_name END,
      team_id = coalesce(v_team, team_id),
      collection_id = coalesce(v_coll, collection_id),
      sub_collection_id = coalesce(v_sub, sub_collection_id),
      position1 = CASE WHEN p_payload ? 'position1' THEN p_payload->>'position1' ELSE position1 END,
      position2 = CASE WHEN p_payload ? 'position2' THEN p_payload->>'position2' ELSE position2 END,
      rating = coalesce((p_payload->>'rating')::numeric, rating),
      run_rating = CASE WHEN p_payload ? 'run_rating' THEN (p_payload->>'run_rating')::numeric ELSE run_rating END,
      market_value = coalesce((p_payload->>'market_value')::int, market_value),
      social_handle = CASE WHEN p_payload ? 'social_handle' THEN p_payload->>'social_handle' ELSE social_handle END,
      avatar_url = CASE WHEN p_payload ? 'avatar_url' THEN p_payload->>'avatar_url' ELSE avatar_url END,
      is_collection_reward = coalesce((p_payload->>'is_collection_reward')::boolean, is_collection_reward),
      card_color_primary = CASE WHEN p_payload ? 'card_color_primary' THEN p_payload->>'card_color_primary' ELSE card_color_primary END,
      card_color_secondary = CASE WHEN p_payload ? 'card_color_secondary' THEN p_payload->>'card_color_secondary' ELSE card_color_secondary END,
      card_glow_color = CASE WHEN p_payload ? 'card_glow_color' THEN p_payload->>'card_glow_color' ELSE card_glow_color END,
      card_animation = CASE WHEN p_payload ? 'card_animation' THEN p_payload->>'card_animation' ELSE card_animation END,
      stat_3pt = coalesce((p_payload->>'stat_3pt')::int, stat_3pt),
      stat_mid = coalesce((p_payload->>'stat_mid')::int, stat_mid),
      stat_fin = coalesce((p_payload->>'stat_fin')::int, stat_fin),
      stat_dnk = coalesce((p_payload->>'stat_dnk')::int, stat_dnk),
      stat_ast = coalesce((p_payload->>'stat_ast')::int, stat_ast),
      stat_stl = coalesce((p_payload->>'stat_stl')::int, stat_stl),
      stat_reb = coalesce((p_payload->>'stat_reb')::int, stat_reb),
      stat_blk = coalesce((p_payload->>'stat_blk')::int, stat_blk),
      stat_int = coalesce((p_payload->>'stat_int')::int, stat_int),
      run_stat_3pt = coalesce((p_payload->>'run_stat_3pt')::int, run_stat_3pt),
      run_stat_mid = coalesce((p_payload->>'run_stat_mid')::int, run_stat_mid),
      run_stat_fin = coalesce((p_payload->>'run_stat_fin')::int, run_stat_fin),
      run_stat_dnk = coalesce((p_payload->>'run_stat_dnk')::int, run_stat_dnk),
      run_stat_ast = coalesce((p_payload->>'run_stat_ast')::int, run_stat_ast),
      run_stat_stl = coalesce((p_payload->>'run_stat_stl')::int, run_stat_stl),
      run_stat_reb = coalesce((p_payload->>'run_stat_reb')::int, run_stat_reb),
      run_stat_blk = coalesce((p_payload->>'run_stat_blk')::int, run_stat_blk),
      run_stat_int = coalesce((p_payload->>'run_stat_int')::int, run_stat_int),
      updated_at = now()
    WHERE id = v_id;

    IF p_payload ? 'badges' THEN
      DELETE FROM player_card_badges WHERE player_card_id = v_id;
      INSERT INTO player_card_badges(player_card_id, badge_id, tier)
      SELECT v_id, (e->>'badge_id')::uuid, e->>'tier' FROM jsonb_array_elements(v_badges) e;
    END IF;
    IF p_payload ? 'traits' THEN
      DELETE FROM player_card_traits WHERE player_card_id = v_id;
      INSERT INTO player_card_traits(player_card_id, trait_id, tier, target_stat)
      SELECT v_id, (e->>'trait_id')::uuid, e->>'tier', e->>'target_stat' FROM jsonb_array_elements(v_traits) e;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'kind','player', 'mode', CASE WHEN p_commit THEN 'commit' ELSE 'preview' END,
    'applied', p_commit, 'player_id', v_id, 'id', v_id,
    'operations', v_ops, 'destructive', v_destr, 'destructive_operations', v_destr,
    'resolved_references', jsonb_strip_nulls(jsonb_build_object(
      'player_id', to_jsonb(v_id), 'gem_tier_id', to_jsonb(v_tier), 'team_id', to_jsonb(v_team),
      'collection_id', to_jsonb(v_coll), 'sub_collection_id', to_jsonb(v_sub))));
END $fn$;

-- 6. one canonical evolution model, mirrored both ways
CREATE OR REPLACE FUNCTION public.evo_sync_legacy_from_objectives(p_path uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE v_objs jsonb; v_first jsonb; v_compound jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'group_key', group_key, 'objective_type', objective_type, 'type', objective_type,
           'stat_key', stat_key, 'stat', stat_key, 'scope', scope, 'target', target,
           'description', coalesce(description,''), 'sort_order', sort_order
         ) ORDER BY sort_order, created_at), '[]'::jsonb)
    INTO v_objs
    FROM evo_objectives WHERE evo_path_id = p_path;

  IF jsonb_array_length(v_objs) = 0 THEN
    UPDATE evo_paths SET objectives = '[]'::jsonb WHERE id = p_path AND objectives <> '[]'::jsonb;
    RETURN;
  END IF;

  v_first := v_objs->0;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'type', e->>'objective_type', 'stat', e->>'stat_key',
           'target', (e->>'target')::numeric, 'description', coalesce(e->>'description','')
         )), '[]'::jsonb)
    INTO v_compound FROM jsonb_array_elements(v_objs) e;

  UPDATE evo_paths SET
    objectives = v_objs,
    challenge_type = v_first->>'objective_type',
    challenge_stat = v_first->>'stat_key',
    challenge_target = greatest(ceil((v_first->>'target')::numeric)::int, 1),
    challenge_description = CASE WHEN coalesce(btrim(challenge_description),'') = ''
                                 THEN coalesce(v_first->>'description','') ELSE challenge_description END,
    compound_challenges = CASE WHEN jsonb_array_length(v_objs) > 1 THEN v_compound ELSE '[]'::jsonb END,
    updated_at = now()
  WHERE id = p_path;
END $fn$;

CREATE OR REPLACE FUNCTION public.trg_evo_objectives_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  PERFORM set_config('gteam.evo_sync', '1', true);
  PERFORM public.evo_sync_legacy_from_objectives(coalesce(NEW.evo_path_id, OLD.evo_path_id));
  PERFORM set_config('gteam.evo_sync', '', true);
  RETURN NULL;
END $fn$;

DROP TRIGGER IF EXISTS evo_objectives_sync ON public.evo_objectives;
CREATE TRIGGER evo_objectives_sync
AFTER INSERT OR UPDATE OR DELETE ON public.evo_objectives
FOR EACH ROW EXECUTE FUNCTION public.trg_evo_objectives_sync();

CREATE OR REPLACE FUNCTION public.evo_seed_objectives_from_legacy(p_path uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE r record; v_el jsonb; v_i int := 0;
BEGIN
  SELECT * INTO r FROM evo_paths WHERE id = p_path;
  IF r.id IS NULL THEN RETURN 0; END IF;
  IF EXISTS (SELECT 1 FROM evo_objectives WHERE evo_path_id = p_path) THEN RETURN 0; END IF;

  IF jsonb_typeof(r.compound_challenges) = 'array' AND jsonb_array_length(r.compound_challenges) > 0 THEN
    FOR v_el IN SELECT * FROM jsonb_array_elements(r.compound_challenges) LOOP
      INSERT INTO evo_objectives(evo_path_id, group_key, objective_type, stat_key, scope, target, description, sort_order)
      VALUES (p_path, 'default',
              coalesce(nullif(v_el->>'type',''), 'points_scored'),
              nullif(v_el->>'stat',''),
              'cumulative',
              coalesce(nullif(v_el->>'target','')::numeric, 1),
              nullif(v_el->>'description',''),
              v_i);
      v_i := v_i + 1;
    END LOOP;
  ELSE
    INSERT INTO evo_objectives(evo_path_id, group_key, objective_type, stat_key, scope, target, description, sort_order)
    VALUES (p_path, 'default', coalesce(nullif(r.challenge_type,''), 'points_scored'), nullif(r.challenge_stat,''),
            'cumulative', greatest(coalesce(r.challenge_target, 1), 1), nullif(r.challenge_description,''), 0);
    v_i := 1;
  END IF;
  RETURN v_i;
END $fn$;

CREATE OR REPLACE FUNCTION public.trg_evo_paths_seed_objectives()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
BEGIN
  IF coalesce(current_setting('gteam.evo_sync', true), '') = '1' THEN RETURN NULL; END IF;
  PERFORM public.evo_seed_objectives_from_legacy(NEW.id);
  RETURN NULL;
END $fn$;

DROP TRIGGER IF EXISTS evo_paths_seed_objectives ON public.evo_paths;
CREATE TRIGGER evo_paths_seed_objectives
AFTER INSERT OR UPDATE OF challenge_type, challenge_stat, challenge_target, compound_challenges
ON public.evo_paths
FOR EACH ROW EXECUTE FUNCTION public.trg_evo_paths_seed_objectives();

-- backfill every existing path so the game and the API read the same objectives
DO $do$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM evo_paths LOOP
    PERFORM public.evo_seed_objectives_from_legacy(r.id);
  END LOOP;
END $do$;