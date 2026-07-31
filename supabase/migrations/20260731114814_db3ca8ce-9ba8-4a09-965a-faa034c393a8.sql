-- ===================================================== player upsert (id-aware)
CREATE OR REPLACE FUNCTION public.admin_apply_player(p_payload jsonb, p_commit boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ops jsonb := '[]'::jsonb;
  v_destr jsonb := '[]'::jsonb;
  v_id uuid; v_name text; v_new_name text; v_key text;
  v_tier uuid; v_team uuid; v_coll uuid; v_sub uuid; v_base uuid;
  v_n int; v_el jsonb; v_ref uuid;
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
  IF p_payload ? 'player_id' THEN
    SELECT id, name INTO v_id, v_name FROM player_cards WHERE id = (p_payload->>'player_id')::uuid;
    IF v_id IS NULL THEN RAISE EXCEPTION 'UNKNOWN_PLAYER_ID: %', p_payload->>'player_id'; END IF;
  ELSIF nullif(btrim(coalesce(p_payload->>'card_key','')),'') IS NOT NULL THEN
    v_key := btrim(p_payload->>'card_key');
    SELECT id, name INTO v_id, v_name FROM player_cards WHERE lower(card_key) = lower(v_key);
    IF v_id IS NULL AND v_action = 'update' THEN RAISE EXCEPTION 'UNKNOWN_CARD_KEY: %', v_key; END IF;
    v_name := coalesce(v_name, btrim(coalesce(p_payload->>'name','')));
  ELSE
    v_name := btrim(coalesce(p_payload->>'name',''));
    IF v_name = '' THEN RAISE EXCEPTION 'MISSING_PLAYER_REF: supply player_id, card_key, or name'; END IF;
    SELECT count(*) INTO v_n FROM player_cards WHERE lower(name) = lower(v_name);
    IF v_n > 1 THEN
      RAISE EXCEPTION 'AMBIGUOUS_PLAYER_NAME: "%" matches % cards. Target one with player_id or card_key. matches=%',
        v_name, v_n, public.admin_player_matches(v_name)::text;
    END IF;
    IF v_n = 1 AND v_action <> 'create' THEN
      SELECT id INTO v_id FROM player_cards WHERE lower(name) = lower(v_name);
    END IF;
  END IF;

  IF v_action = 'update' AND v_id IS NULL THEN
    RAISE EXCEPTION 'UNKNOWN_PLAYER: no existing card matched for action="update"';
  END IF;
  IF v_id IS NULL AND coalesce(v_name,'') = '' THEN RAISE EXCEPTION 'MISSING_NAME: new cards require a name'; END IF;

  v_new_name := nullif(btrim(coalesce(p_payload->>'new_name','')), '');
  IF v_key IS NOT NULL AND v_id IS NULL THEN
    -- creating with an explicit card_key: make sure it is free
    IF EXISTS (SELECT 1 FROM player_cards WHERE lower(card_key) = lower(v_key)) THEN
      RAISE EXCEPTION 'DUPLICATE_CARD_KEY: card_key "%" already exists', v_key;
    END IF;
  ELSIF v_key IS NOT NULL AND v_id IS NOT NULL AND p_payload ? 'new_card_key' THEN
    IF EXISTS (SELECT 1 FROM player_cards WHERE lower(card_key) = lower(btrim(p_payload->>'new_card_key')) AND id <> v_id) THEN
      RAISE EXCEPTION 'DUPLICATE_CARD_KEY: card_key "%" already exists', p_payload->>'new_card_key';
    END IF;
  END IF;

  ------------------------------------------------------------ resolve relations
  IF p_payload ? 'gem_tier_id' THEN
    SELECT id INTO v_tier FROM gem_tiers WHERE id = (p_payload->>'gem_tier_id')::uuid;
    IF v_tier IS NULL THEN RAISE EXCEPTION 'UNKNOWN_GEM_TIER_ID: %', p_payload->>'gem_tier_id'; END IF;
  ELSIF p_payload ? 'gem_tier' AND p_payload->>'gem_tier' IS NOT NULL THEN
    SELECT id INTO v_tier FROM gem_tiers WHERE lower(name) = lower(btrim(p_payload->>'gem_tier'));
    IF v_tier IS NULL THEN RAISE EXCEPTION 'UNKNOWN_GEM_TIER: "%"', p_payload->>'gem_tier'; END IF;
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
      run_rating = CASE WHEN p_payload ? 'run_rating' THEN (p_payload->>'run_rating')::int ELSE run_rating END,
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
END $$;

-- ============================================================= ref substitution
CREATE OR REPLACE FUNCTION public.admin_substitute_refs(p_item jsonb, p_refs jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  v_out jsonb := '{}'::jsonb;
  v_k text; v_v jsonb; v_target text; v_val text; v_arr jsonb; v_el jsonb;
BEGIN
  IF p_item IS NULL OR jsonb_typeof(p_item) <> 'object' THEN RETURN p_item; END IF;
  FOR v_k, v_v IN SELECT key, value FROM jsonb_each(p_item) LOOP
    v_target := CASE WHEN v_k ~ '_ref$' THEN regexp_replace(v_k, '_ref$', '_id') ELSE v_k END;
    IF jsonb_typeof(v_v) = 'string' AND (v_v #>> '{}') LIKE 'ref:%' THEN
      v_val := p_refs->>(v_v #>> '{}');
      IF v_val IS NULL THEN
        RAISE EXCEPTION 'UNKNOWN_TEMP_REF: "%" was never declared as a temp_ref in this batch', v_v #>> '{}';
      END IF;
      IF v_val <> 'pending' THEN v_out := v_out || jsonb_build_object(v_target, v_val); END IF;
    ELSIF jsonb_typeof(v_v) = 'array' THEN
      v_arr := '[]'::jsonb;
      FOR v_el IN SELECT * FROM jsonb_array_elements(v_v) LOOP
        IF jsonb_typeof(v_el) = 'string' AND (v_el #>> '{}') LIKE 'ref:%' THEN
          v_val := p_refs->>(v_el #>> '{}');
          IF v_val IS NULL THEN
            RAISE EXCEPTION 'UNKNOWN_TEMP_REF: "%" was never declared as a temp_ref in this batch', v_el #>> '{}';
          END IF;
          IF v_val <> 'pending' THEN v_arr := v_arr || jsonb_build_array(jsonb_build_object('player_id', v_val)); END IF;
        ELSIF jsonb_typeof(v_el) = 'object' AND (v_el->>'player_ref') IS NOT NULL THEN
          v_val := p_refs->>(v_el->>'player_ref');
          IF v_val IS NULL THEN
            RAISE EXCEPTION 'UNKNOWN_TEMP_REF: "%"', v_el->>'player_ref';
          END IF;
          IF v_val <> 'pending' THEN v_arr := v_arr || jsonb_build_array(jsonb_build_object('player_id', v_val)); END IF;
        ELSE
          v_arr := v_arr || jsonb_build_array(v_el);
        END IF;
      END LOOP;
      v_out := v_out || jsonb_build_object(v_target, v_arr);
    ELSE
      v_out := v_out || jsonb_build_object(v_target, v_v);
    END IF;
  END LOOP;
  RETURN v_out;
END $$;

-- ================================================================ batch engine
CREATE OR REPLACE FUNCTION public.admin_apply_batch(
  p_payload jsonb,
  p_commit boolean DEFAULT false,
  p_preview_token text DEFAULT NULL,
  p_kind text DEFAULT 'batch')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_groups text[] := ARRAY['players','teams','runs','domination_roads','domination_games','packs','locker_codes','challenges','dynamic_duos','evo_paths','storylines'];
  v_group text; v_item jsonb; v_items jsonb; v_res jsonb; v_op jsonb;
  v_refs jsonb := '{}'::jsonb;
  v_creates jsonb := '[]'::jsonb;
  v_updates jsonb := '[]'::jsonb;
  v_deletes jsonb := '[]'::jsonb;
  v_repl jsonb := '[]'::jsonb;
  v_warn jsonb := '[]'::jsonb;
  v_resolved jsonb := '[]'::jsonb;
  v_results jsonb := '[]'::jsonb;
  v_ids jsonb := '{}'::jsonb;
  v_hash text; v_token text; v_row public.admin_preview_tokens;
  v_kind text; v_idx int; v_action text; v_tmp text; v_name text; v_count int := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED: sign in first'; END IF;
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN RAISE EXCEPTION 'FORBIDDEN: admin role required'; END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN RAISE EXCEPTION 'INVALID_PAYLOAD: payload must be an object'; END IF;

  v_hash := md5(p_payload::text);

  IF p_commit THEN
    IF p_preview_token IS NULL THEN
      RAISE EXCEPTION 'PREVIEW_REQUIRED: commit needs the preview_token returned by the matching preview';
    END IF;
    SELECT * INTO v_row FROM admin_preview_tokens
    WHERE token = p_preview_token AND user_id = auth.uid();
    IF v_row.id IS NULL THEN RAISE EXCEPTION 'UNKNOWN_PREVIEW_TOKEN: run a preview again'; END IF;
    IF v_row.consumed_at IS NOT NULL THEN RAISE EXCEPTION 'PREVIEW_ALREADY_COMMITTED: run a new preview'; END IF;
    IF v_row.expires_at < now() THEN RAISE EXCEPTION 'PREVIEW_EXPIRED: run a new preview'; END IF;
    IF v_row.payload_hash <> v_hash THEN
      RAISE EXCEPTION 'PREVIEW_MISMATCH: payload does not match the approved preview (expected hash %, got %)', v_row.payload_hash, v_hash;
    END IF;
  END IF;

  ------------------------------------------------- declare temp refs up front
  FOREACH v_group IN ARRAY v_groups LOOP
    v_items := p_payload->v_group;
    IF v_items IS NULL THEN CONTINUE; END IF;
    IF jsonb_typeof(v_items) <> 'array' THEN RAISE EXCEPTION 'INVALID_GROUP: "%" must be an array', v_group; END IF;
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_items) LOOP
      v_tmp := v_item->>'temp_ref';
      IF v_tmp IS NOT NULL THEN
        IF v_refs ? v_tmp THEN RAISE EXCEPTION 'DUPLICATE_TEMP_REF: "%"', v_tmp; END IF;
        v_refs := v_refs || jsonb_build_object(v_tmp, 'pending');
      END IF;
    END LOOP;
  END LOOP;

  ------------------------------------------------------------------- execution
  FOREACH v_group IN ARRAY v_groups LOOP
    v_items := p_payload->v_group;
    IF v_items IS NULL THEN CONTINUE; END IF;
    v_idx := 0;
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_items) LOOP
      v_idx := v_idx + 1;
      v_count := v_count + 1;
      v_tmp := v_item->>'temp_ref';
      v_action := lower(coalesce(v_item->>'action','upsert'));
      IF v_action NOT IN ('create','update','upsert','replace') THEN
        RAISE EXCEPTION 'INVALID_ACTION: "%" in %[%] (use create|update|upsert|replace)', v_action, v_group, v_idx;
      END IF;
      v_item := public.admin_substitute_refs(v_item - 'temp_ref', v_refs);

      -- id -> canonical name for the legacy name-matched kinds
      IF v_group IN ('teams') AND v_item ? 'team_id' AND NOT (v_item ? 'name') THEN
        SELECT name INTO v_name FROM teams WHERE id = (v_item->>'team_id')::uuid;
        IF v_name IS NULL THEN RAISE EXCEPTION 'UNKNOWN_TEAM_ID: %', v_item->>'team_id'; END IF;
        v_item := v_item || jsonb_build_object('name', v_name);
      ELSIF v_group = 'runs' AND v_item ? 'run_id' AND NOT (v_item ? 'name') THEN
        SELECT name INTO v_name FROM runs WHERE id = (v_item->>'run_id')::uuid;
        IF v_name IS NULL THEN RAISE EXCEPTION 'UNKNOWN_RUN_ID: %', v_item->>'run_id'; END IF;
        v_item := v_item || jsonb_build_object('name', v_name);
      ELSIF v_group = 'packs' AND v_item ? 'pack_id' AND NOT (v_item ? 'name') THEN
        SELECT name INTO v_name FROM packs WHERE id = (v_item->>'pack_id')::uuid;
        IF v_name IS NULL THEN RAISE EXCEPTION 'UNKNOWN_PACK_ID: %', v_item->>'pack_id'; END IF;
        v_item := v_item || jsonb_build_object('name', v_name);
      ELSIF v_group = 'challenges' AND v_item ? 'challenge_id' AND NOT (v_item ? 'name') THEN
        SELECT name INTO v_name FROM challenges WHERE id = (v_item->>'challenge_id')::uuid;
        IF v_name IS NULL THEN RAISE EXCEPTION 'UNKNOWN_CHALLENGE_ID: %', v_item->>'challenge_id'; END IF;
        v_item := v_item || jsonb_build_object('name', v_name);
      ELSIF v_group = 'domination_games' AND v_item ? 'domination_game_id' AND NOT (v_item ? 'opponent_name') THEN
        SELECT road_name, opponent_name INTO v_tmp, v_name FROM domination_games WHERE id = (v_item->>'domination_game_id')::uuid;
        IF v_name IS NULL THEN RAISE EXCEPTION 'UNKNOWN_DOMINATION_GAME_ID: %', v_item->>'domination_game_id'; END IF;
        v_item := v_item || jsonb_build_object('road_name', v_tmp, 'opponent_name', v_name);
        v_tmp := (jsonb_array_elements(v_items)->>'temp_ref');
      END IF;

      -- rosters only replace when explicitly asked
      IF v_group IN ('teams','runs') AND v_item ? 'roster'
         AND NOT coalesce((v_item->>'replace_roster')::boolean, v_action = 'replace') THEN
        v_warn := v_warn || jsonb_build_object('group', v_group, 'index', v_idx,
          'code','ROSTER_IGNORED',
          'message','roster was ignored because replace_roster was not true (a supplied roster always replaces the whole roster)');
        v_item := v_item - 'roster';
      END IF;
      v_item := v_item - 'replace_roster' - 'action';

      IF v_group = 'players' THEN
        v_res := public.admin_apply_player(v_item || jsonb_build_object('action', v_action), p_commit);
      ELSIF v_group IN ('domination_roads','evo_paths','storylines') THEN
        v_kind := CASE v_group WHEN 'domination_roads' THEN 'domination_road' WHEN 'evo_paths' THEN 'evo_path' ELSE 'storyline' END;
        v_res := public.admin_apply_extra(v_kind, v_item, p_commit);
      ELSE
        v_kind := CASE v_group
          WHEN 'teams' THEN 'team' WHEN 'runs' THEN 'run' WHEN 'domination_games' THEN 'domination_game'
          WHEN 'packs' THEN 'pack' WHEN 'locker_codes' THEN 'locker_code' WHEN 'challenges' THEN 'challenge'
          ELSE 'dynamic_duo' END;
        v_res := public.admin_apply_content(v_kind, v_item, p_commit);
      END IF;

      IF (v_item ? 'temp_ref') IS NOT TRUE AND (v_items->(v_idx-1)->>'temp_ref') IS NOT NULL THEN
        v_refs := v_refs || jsonb_build_object(v_items->(v_idx-1)->>'temp_ref',
          coalesce(v_res->>'id', v_res->>'player_id', 'pending'));
      END IF;

      v_results := v_results || jsonb_build_object('group', v_group, 'index', v_idx, 'result', v_res);
      IF coalesce(v_res->>'id', v_res->>'player_id') IS NOT NULL THEN
        v_ids := v_ids || jsonb_build_object(v_group || '[' || v_idx || ']', coalesce(v_res->>'id', v_res->>'player_id'));
      END IF;

      FOR v_op IN SELECT * FROM jsonb_array_elements(coalesce(v_res->'operations','[]'::jsonb)) LOOP
        IF v_op->>'action' = 'insert' THEN
          v_creates := v_creates || jsonb_build_object('group', v_group, 'index', v_idx,
            'table', v_op->>'table', 'match', v_op->>'match', 'fields', v_op->'fields');
        ELSE
          v_updates := v_updates || jsonb_build_object('group', v_group, 'index', v_idx,
            'table', v_op->>'table', 'id', v_op->>'id', 'match', v_op->>'match',
            'field_changes', coalesce(v_op->'field_changes','[]'::jsonb), 'fields', v_op->'fields');
        END IF;
      END LOOP;
      FOR v_op IN SELECT * FROM jsonb_array_elements(coalesce(v_res->'destructive', v_res->'destructive_operations', '[]'::jsonb)) LOOP
        IF v_op->>'action' = 'delete' THEN
          v_deletes := v_deletes || (v_op || jsonb_build_object('group', v_group, 'index', v_idx));
        ELSE
          v_repl := v_repl || (v_op || jsonb_build_object('group', v_group, 'index', v_idx));
        END IF;
      END LOOP;
      IF v_res ? 'resolved_references' THEN
        v_resolved := v_resolved || jsonb_build_object('group', v_group, 'index', v_idx, 'references', v_res->'resolved_references');
      END IF;
      IF v_res ? 'warnings' AND jsonb_typeof(v_res->'warnings') = 'array' THEN
        v_warn := v_warn || (v_res->'warnings');
      END IF;
    END LOOP;
  END LOOP;

  IF v_count = 0 THEN RAISE EXCEPTION 'EMPTY_BATCH: supply at least one item in one of %', array_to_string(v_groups, ', '); END IF;

  IF NOT p_commit THEN
    -- a new preview invalidates any earlier unconsumed preview for this admin
    DELETE FROM admin_preview_tokens WHERE user_id = auth.uid() AND consumed_at IS NULL;
    v_token := encode(gen_random_bytes(18), 'hex');
    INSERT INTO admin_preview_tokens(user_id, kind, token, payload_hash, normalized_payload)
    VALUES (auth.uid(), p_kind, v_token, v_hash, p_payload);
  ELSE
    UPDATE admin_preview_tokens SET consumed_at = now() WHERE token = p_preview_token;
    v_token := NULL;
  END IF;

  RETURN jsonb_build_object(
    'kind', p_kind,
    'mode', CASE WHEN p_commit THEN 'commit' ELSE 'preview' END,
    'applied', p_commit,
    'item_count', v_count,
    'creates', v_creates,
    'updates', v_updates,
    'deletes', v_deletes,
    'replacements', v_repl,
    'warnings', v_warn,
    'resolved_references', v_resolved,
    'created_ids', v_ids,
    'temp_refs', v_refs,
    'results', v_results,
    'normalized_payload', p_payload,
    'payload_hash', v_hash,
    'preview_token', v_token);
END $$;

REVOKE ALL ON FUNCTION public.admin_apply_batch(jsonb, boolean, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.admin_apply_extra(text, jsonb, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.admin_resolve_player(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.admin_player_matches(text) FROM anon;
REVOKE ALL ON FUNCTION public.admin_diff_fields(text, uuid, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.admin_substitute_refs(jsonb, jsonb) FROM anon;