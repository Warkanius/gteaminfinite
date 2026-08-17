-- Bulk player fixes: numeric stats sent as canonical text, and intentional duplicate names.

CREATE OR REPLACE FUNCTION public.admin_assert_castable(p_table text, p_fields jsonb)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      -- whole-number text such as "5.0" is accepted; the writer rounds it.
      CONTINUE;
    END IF;

    BEGIN
      EXECUTE format('SELECT (($1->>%L)::%s)', k, v_type) USING p_fields;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'INVALID_FIELD_TYPE: %.% (%) cannot accept "%"', p_table, k, v_type, v_txt;
    END;
  END LOOP;
END $function$;

CREATE OR REPLACE FUNCTION public.admin_apply_player(p_payload jsonb, p_commit boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_allow_dup boolean := coalesce((p_payload->>'allow_duplicate_name')::boolean, false);
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
    IF v_action = 'create' OR v_allow_dup THEN
      -- explicit create (or an evo variant intentionally sharing a name):
      -- never resolve onto an existing card by name.
      v_id := NULL;
    ELSE
      SELECT count(*) INTO v_n FROM player_cards WHERE lower(name) = lower(v_name);
      IF v_n > 1 THEN
        RAISE EXCEPTION 'AMBIGUOUS_PLAYER_NAME: "%" matches % cards. Target one with player_card_id or card_key, or send action="create" / allow_duplicate_name=true to create a new card. matches=%',
          v_name, v_n, public.admin_player_matches(v_name)::text;
      END IF;
      IF v_n = 1 THEN
        SELECT id INTO v_id FROM player_cards WHERE lower(name) = lower(v_name);
      END IF;
    END IF;
  END IF;

  IF v_action = 'update' AND v_id IS NULL THEN
    RAISE EXCEPTION 'UNKNOWN_PLAYER: no existing card matched for action="update"';
  END IF;
  IF v_action = 'create' AND v_id IS NOT NULL THEN
    RAISE EXCEPTION 'ALREADY_EXISTS: action="create" but card % was targeted by id or card_key', v_id;
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

  -- Stats may arrive as JSON numbers or as canonical numeric text (the preview
  -- hashing layer renders every number as fixed-precision text), so validate the
  -- VALUE, not the JSON type.
  FOREACH v_k IN ARRAY v_stat_keys LOOP
    IF p_payload ? v_k AND jsonb_typeof(p_payload->v_k) NOT IN ('number','null') THEN
      IF jsonb_typeof(p_payload->v_k) <> 'string'
         OR btrim(coalesce(p_payload->>v_k,'')) !~ '^-?[0-9]+(\.[0-9]+)?$' THEN
        RAISE EXCEPTION 'INVALID_STAT: % must be a number, got %', v_k, coalesce(p_payload->>v_k, 'null');
      END IF;
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
      evo_stage = coalesce(round((nullif(btrim(p_payload->>'evo_stage'),''))::numeric)::int, evo_stage),
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
      market_value = coalesce(round((nullif(btrim(p_payload->>'market_value'),''))::numeric)::int, market_value),
      social_handle = CASE WHEN p_payload ? 'social_handle' THEN p_payload->>'social_handle' ELSE social_handle END,
      avatar_url = CASE WHEN p_payload ? 'avatar_url' THEN p_payload->>'avatar_url' ELSE avatar_url END,
      is_collection_reward = coalesce((p_payload->>'is_collection_reward')::boolean, is_collection_reward),
      card_color_primary = CASE WHEN p_payload ? 'card_color_primary' THEN p_payload->>'card_color_primary' ELSE card_color_primary END,
      card_color_secondary = CASE WHEN p_payload ? 'card_color_secondary' THEN p_payload->>'card_color_secondary' ELSE card_color_secondary END,
      card_glow_color = CASE WHEN p_payload ? 'card_glow_color' THEN p_payload->>'card_glow_color' ELSE card_glow_color END,
      card_animation = CASE WHEN p_payload ? 'card_animation' THEN p_payload->>'card_animation' ELSE card_animation END,
      stat_3pt = coalesce(round((nullif(btrim(p_payload->>'stat_3pt'),''))::numeric)::int, stat_3pt),
      stat_mid = coalesce(round((nullif(btrim(p_payload->>'stat_mid'),''))::numeric)::int, stat_mid),
      stat_fin = coalesce(round((nullif(btrim(p_payload->>'stat_fin'),''))::numeric)::int, stat_fin),
      stat_dnk = coalesce(round((nullif(btrim(p_payload->>'stat_dnk'),''))::numeric)::int, stat_dnk),
      stat_ast = coalesce(round((nullif(btrim(p_payload->>'stat_ast'),''))::numeric)::int, stat_ast),
      stat_stl = coalesce(round((nullif(btrim(p_payload->>'stat_stl'),''))::numeric)::int, stat_stl),
      stat_reb = coalesce(round((nullif(btrim(p_payload->>'stat_reb'),''))::numeric)::int, stat_reb),
      stat_blk = coalesce(round((nullif(btrim(p_payload->>'stat_blk'),''))::numeric)::int, stat_blk),
      stat_int = coalesce(round((nullif(btrim(p_payload->>'stat_int'),''))::numeric)::int, stat_int),
      run_stat_3pt = coalesce(round((nullif(btrim(p_payload->>'run_stat_3pt'),''))::numeric)::int, run_stat_3pt),
      run_stat_mid = coalesce(round((nullif(btrim(p_payload->>'run_stat_mid'),''))::numeric)::int, run_stat_mid),
      run_stat_fin = coalesce(round((nullif(btrim(p_payload->>'run_stat_fin'),''))::numeric)::int, run_stat_fin),
      run_stat_dnk = coalesce(round((nullif(btrim(p_payload->>'run_stat_dnk'),''))::numeric)::int, run_stat_dnk),
      run_stat_ast = coalesce(round((nullif(btrim(p_payload->>'run_stat_ast'),''))::numeric)::int, run_stat_ast),
      run_stat_stl = coalesce(round((nullif(btrim(p_payload->>'run_stat_stl'),''))::numeric)::int, run_stat_stl),
      run_stat_reb = coalesce(round((nullif(btrim(p_payload->>'run_stat_reb'),''))::numeric)::int, run_stat_reb),
      run_stat_blk = coalesce(round((nullif(btrim(p_payload->>'run_stat_blk'),''))::numeric)::int, run_stat_blk),
      run_stat_int = coalesce(round((nullif(btrim(p_payload->>'run_stat_int'),''))::numeric)::int, run_stat_int),
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
END $function$;