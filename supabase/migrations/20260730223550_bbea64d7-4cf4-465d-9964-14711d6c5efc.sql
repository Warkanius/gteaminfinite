CREATE OR REPLACE FUNCTION public.admin_apply_player(p_payload jsonb, p_commit boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ops jsonb := '[]'::jsonb;
  v_destr jsonb := '[]'::jsonb;
  v_id uuid;
  v_name text;
  v_new_name text;
  v_tier uuid;
  v_team uuid;
  v_coll uuid;
  v_sub uuid;
  v_n int;
  v_el jsonb;
  v_ref uuid;
  v_badges jsonb := '[]'::jsonb;
  v_traits jsonb := '[]'::jsonb;
  v_fields jsonb;
  v_tiers text[] := ARRAY['base','gold','hof','diamond','actolytrene'];
  v_stat_keys text[] := ARRAY['stat_3pt','stat_mid','stat_fin','stat_dnk','stat_ast','stat_stl','stat_reb','stat_blk','stat_int',
                              'run_stat_3pt','run_stat_mid','run_stat_fin','run_stat_dnk','run_stat_ast','run_stat_stl','run_stat_reb','run_stat_blk','run_stat_int'];
  v_k text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN RAISE EXCEPTION 'Admin role required'; END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN RAISE EXCEPTION 'Payload must be an object'; END IF;

  v_name := btrim(coalesce(p_payload->>'name',''));
  IF v_name = '' THEN RAISE EXCEPTION 'name is required'; END IF;

  SELECT count(*) INTO v_n FROM player_cards WHERE lower(name) = lower(v_name);
  IF v_n > 1 THEN RAISE EXCEPTION 'Ambiguous player card name: "%" matches % rows', v_name, v_n; END IF;
  SELECT id INTO v_id FROM player_cards WHERE lower(name) = lower(v_name);

  v_new_name := nullif(btrim(coalesce(p_payload->>'new_name','')), '');
  IF v_new_name IS NOT NULL THEN
    SELECT count(*) INTO v_n FROM player_cards WHERE lower(name) = lower(v_new_name) AND (v_id IS NULL OR id <> v_id);
    IF v_n > 0 THEN RAISE EXCEPTION 'Another player card is already named "%"', v_new_name; END IF;
  END IF;

  IF p_payload ? 'gem_tier' AND p_payload->>'gem_tier' IS NOT NULL THEN
    SELECT id INTO v_tier FROM gem_tiers WHERE lower(name) = lower(btrim(p_payload->>'gem_tier'));
    IF v_tier IS NULL THEN RAISE EXCEPTION 'Unknown gem tier: "%"', p_payload->>'gem_tier'; END IF;
  END IF;
  IF p_payload ? 'team' AND p_payload->>'team' IS NOT NULL THEN
    SELECT id INTO v_team FROM teams WHERE lower(name) = lower(btrim(p_payload->>'team'));
    IF v_team IS NULL THEN RAISE EXCEPTION 'Unknown team: "%"', p_payload->>'team'; END IF;
  END IF;
  IF p_payload ? 'collection' AND p_payload->>'collection' IS NOT NULL THEN
    SELECT id INTO v_coll FROM collections WHERE lower(name) = lower(btrim(p_payload->>'collection'));
    IF v_coll IS NULL THEN RAISE EXCEPTION 'Unknown collection: "%"', p_payload->>'collection'; END IF;
  END IF;
  IF p_payload ? 'sub_collection' AND p_payload->>'sub_collection' IS NOT NULL THEN
    SELECT id INTO v_sub FROM sub_collections WHERE lower(name) = lower(btrim(p_payload->>'sub_collection'));
    IF v_sub IS NULL THEN RAISE EXCEPTION 'Unknown sub collection: "%"', p_payload->>'sub_collection'; END IF;
  END IF;

  -- validate numeric stats
  FOREACH v_k IN ARRAY v_stat_keys LOOP
    IF p_payload ? v_k AND jsonb_typeof(p_payload->v_k) NOT IN ('number','null') THEN
      RAISE EXCEPTION '% must be a number', v_k;
    END IF;
  END LOOP;

  -- badges
  IF p_payload ? 'badges' THEN
    IF jsonb_typeof(p_payload->'badges') <> 'array' THEN RAISE EXCEPTION 'badges must be an array'; END IF;
    FOR v_el IN SELECT * FROM jsonb_array_elements(p_payload->'badges') LOOP
      SELECT id INTO v_ref FROM badges WHERE lower(name) = lower(btrim(v_el->>'badge')) OR lower(abbreviation) = lower(btrim(v_el->>'badge'));
      IF v_ref IS NULL THEN RAISE EXCEPTION 'Unknown badge: "%"', v_el->>'badge'; END IF;
      IF NOT (coalesce(v_el->>'tier','base') = ANY(v_tiers)) THEN
        RAISE EXCEPTION 'Invalid badge tier "%" (use base/gold/hof/diamond/actolytrene)', v_el->>'tier';
      END IF;
      v_badges := v_badges || jsonb_build_object('badge_id', v_ref, 'tier', coalesce(v_el->>'tier','base'), 'name', v_el->>'badge');
    END LOOP;
  END IF;

  -- traits
  IF p_payload ? 'traits' THEN
    IF jsonb_typeof(p_payload->'traits') <> 'array' THEN RAISE EXCEPTION 'traits must be an array'; END IF;
    FOR v_el IN SELECT * FROM jsonb_array_elements(p_payload->'traits') LOOP
      SELECT id INTO v_ref FROM signature_traits WHERE lower(name) = lower(btrim(v_el->>'trait')) OR lower(abbreviation) = lower(btrim(v_el->>'trait'));
      IF v_ref IS NULL THEN RAISE EXCEPTION 'Unknown signature trait: "%"', v_el->>'trait'; END IF;
      IF NOT (coalesce(v_el->>'tier','base') = ANY(v_tiers)) THEN
        RAISE EXCEPTION 'Invalid trait tier "%" (use base/gold/hof/diamond/actolytrene)', v_el->>'tier';
      END IF;
      IF v_el ? 'target_stat' AND v_el->>'target_stat' IS NOT NULL
         AND NOT (v_el->>'target_stat' = ANY(ARRAY['stat_3pt','stat_mid','stat_fin','stat_dnk','stat_ast','stat_stl','stat_reb','stat_blk','stat_int'])) THEN
        RAISE EXCEPTION 'Invalid target_stat "%"', v_el->>'target_stat';
      END IF;
      v_traits := v_traits || jsonb_build_object('trait_id', v_ref, 'tier', coalesce(v_el->>'tier','base'), 'target_stat', v_el->>'target_stat', 'name', v_el->>'trait');
    END LOOP;
  END IF;

  v_fields := jsonb_strip_nulls(jsonb_build_object(
    'name', v_new_name,
    'gem_tier_id', v_tier,
    'gem_name', p_payload->'gem_name',
    'team_id', v_team,
    'collection_id', v_coll,
    'sub_collection_id', v_sub,
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
    'match', v_name,
    'fields', v_fields);

  IF p_payload ? 'badges' THEN
    SELECT count(*) INTO v_n FROM player_card_badges WHERE player_card_id = v_id;
    v_destr := v_destr || jsonb_build_object('table','player_card_badges','action','replace',
      'replaces_rows', coalesce(v_n,0), 'new_rows', jsonb_array_length(v_badges), 'new_assignments', v_badges);
  END IF;
  IF p_payload ? 'traits' THEN
    SELECT count(*) INTO v_n FROM player_card_traits WHERE player_card_id = v_id;
    v_destr := v_destr || jsonb_build_object('table','player_card_traits','action','replace',
      'replaces_rows', coalesce(v_n,0), 'new_rows', jsonb_array_length(v_traits), 'new_assignments', v_traits);
  END IF;

  IF p_commit THEN
    IF v_id IS NULL THEN
      INSERT INTO player_cards(name) VALUES (coalesce(v_new_name, v_name)) RETURNING id INTO v_id;
      IF v_new_name IS NOT NULL THEN v_fields := v_fields - 'name'; END IF;
    END IF;

    UPDATE player_cards SET
      name = coalesce(v_fields->>'name', name),
      gem_tier_id = coalesce(v_tier, gem_tier_id),
      gem_name = CASE WHEN p_payload ? 'gem_name' THEN p_payload->>'gem_name' ELSE gem_name END,
      team_id = coalesce(v_team, team_id),
      collection_id = coalesce(v_coll, collection_id),
      sub_collection_id = coalesce(v_sub, sub_collection_id),
      position1 = CASE WHEN p_payload ? 'position1' THEN p_payload->>'position1' ELSE position1 END,
      position2 = CASE WHEN p_payload ? 'position2' THEN p_payload->>'position2' ELSE position2 END,
      rating = coalesce((v_fields->>'rating')::numeric, rating),
      run_rating = CASE WHEN p_payload ? 'run_rating' THEN (p_payload->>'run_rating')::int ELSE run_rating END,
      market_value = coalesce((v_fields->>'market_value')::int, market_value),
      social_handle = CASE WHEN p_payload ? 'social_handle' THEN p_payload->>'social_handle' ELSE social_handle END,
      avatar_url = CASE WHEN p_payload ? 'avatar_url' THEN p_payload->>'avatar_url' ELSE avatar_url END,
      is_collection_reward = coalesce((v_fields->>'is_collection_reward')::boolean, is_collection_reward),
      card_color_primary = CASE WHEN p_payload ? 'card_color_primary' THEN p_payload->>'card_color_primary' ELSE card_color_primary END,
      card_color_secondary = CASE WHEN p_payload ? 'card_color_secondary' THEN p_payload->>'card_color_secondary' ELSE card_color_secondary END,
      card_glow_color = CASE WHEN p_payload ? 'card_glow_color' THEN p_payload->>'card_glow_color' ELSE card_glow_color END,
      card_animation = CASE WHEN p_payload ? 'card_animation' THEN p_payload->>'card_animation' ELSE card_animation END,
      stat_3pt = coalesce((v_fields->>'stat_3pt')::int, stat_3pt),
      stat_mid = coalesce((v_fields->>'stat_mid')::int, stat_mid),
      stat_fin = coalesce((v_fields->>'stat_fin')::int, stat_fin),
      stat_dnk = coalesce((v_fields->>'stat_dnk')::int, stat_dnk),
      stat_ast = coalesce((v_fields->>'stat_ast')::int, stat_ast),
      stat_stl = coalesce((v_fields->>'stat_stl')::int, stat_stl),
      stat_reb = coalesce((v_fields->>'stat_reb')::int, stat_reb),
      stat_blk = coalesce((v_fields->>'stat_blk')::int, stat_blk),
      stat_int = coalesce((v_fields->>'stat_int')::int, stat_int),
      run_stat_3pt = coalesce((v_fields->>'run_stat_3pt')::int, run_stat_3pt),
      run_stat_mid = coalesce((v_fields->>'run_stat_mid')::int, run_stat_mid),
      run_stat_fin = coalesce((v_fields->>'run_stat_fin')::int, run_stat_fin),
      run_stat_dnk = coalesce((v_fields->>'run_stat_dnk')::int, run_stat_dnk),
      run_stat_ast = coalesce((v_fields->>'run_stat_ast')::int, run_stat_ast),
      run_stat_stl = coalesce((v_fields->>'run_stat_stl')::int, run_stat_stl),
      run_stat_reb = coalesce((v_fields->>'run_stat_reb')::int, run_stat_reb),
      run_stat_blk = coalesce((v_fields->>'run_stat_blk')::int, run_stat_blk),
      run_stat_int = coalesce((v_fields->>'run_stat_int')::int, run_stat_int),
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
    'kind','player',
    'mode', CASE WHEN p_commit THEN 'commit' ELSE 'preview' END,
    'applied', p_commit,
    'player_id', v_id,
    'operations', v_ops,
    'destructive_operations', v_destr);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_apply_player(jsonb, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.admin_apply_player(jsonb, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_apply_player(jsonb, boolean) TO service_role;