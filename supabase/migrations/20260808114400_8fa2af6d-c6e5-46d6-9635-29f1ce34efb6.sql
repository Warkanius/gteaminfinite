
CREATE OR REPLACE FUNCTION public.admin_base_stat_keys()
 RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $function$
  SELECT ARRAY['stat_3pt','stat_mid','stat_fin','stat_dnk','stat_ast','stat_stl','stat_reb','stat_blk','stat_int'];
$function$;

CREATE OR REPLACE FUNCTION public.admin_patch_evo_version(p_item jsonb, p_commit boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid; v_row public.evo_card_versions%ROWTYPE;
  v_fields jsonb := '{}'::jsonb; v_key text; v_num numeric; v_tier uuid; v_status text;
  v_match text; v_res jsonb; v_ops jsonb := '[]'::jsonb; v_destr jsonb := '[]'::jsonb;
  v_badges jsonb := '[]'::jsonb; v_traits jsonb := '[]'::jsonb; v_before jsonb;
  v_b jsonb; v_bid uuid; v_needs boolean; v_stats jsonb; v_run jsonb; v_k text;
  v_base text[] := public.admin_base_stat_keys();
  v_runk text[] := public.admin_run_stat_keys();
  v_allowed text[] := ARRAY['evo_version_id','id','status','gem_name','gem_tier','gem_tier_id','rating',
    'run_rating','version_order','evo_stage','position1','position2','stats','run_stats','badges','traits'];
BEGIN
  v_id := nullif(coalesce(p_item->>'evo_version_id', p_item->>'id'), '')::uuid;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'EVO_VERSION_ID_REQUIRED: evo_version_id is required for a targeted evo version update';
  END IF;
  SELECT * INTO v_row FROM public.evo_card_versions WHERE id = v_id;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'UNKNOWN_EVO_VERSION_ID: %', v_id; END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_item) LOOP
    IF NOT (v_key = ANY(v_allowed)) AND NOT (v_key = ANY(v_base)) AND NOT (v_key = ANY(v_runk)) THEN
      RAISE EXCEPTION 'UNSUPPORTED_FIELD: "%" cannot be set on an evo version detail=%', v_key,
        jsonb_build_object('mutable_fields', to_jsonb(v_allowed))::text;
    END IF;
  END LOOP;

  IF p_item ? 'status' THEN
    v_status := lower(btrim(p_item->>'status'));
    IF v_status = 'published' THEN v_status := 'active'; END IF;
    IF v_status NOT IN ('draft','scheduled','active','disabled','archived') THEN
      RAISE EXCEPTION 'INVALID_STATUS: "%" is not a content status', p_item->>'status';
    END IF;
    v_fields := v_fields || jsonb_build_object('status', v_status);
  END IF;
  IF p_item ? 'gem_name' THEN v_fields := v_fields || jsonb_build_object('gem_name', p_item->>'gem_name'); END IF;
  IF p_item ? 'gem_tier_id' THEN
    SELECT id INTO v_tier FROM public.gem_tiers WHERE id = (p_item->>'gem_tier_id')::uuid;
    IF v_tier IS NULL THEN RAISE EXCEPTION 'UNKNOWN_GEM_TIER_ID: %', p_item->>'gem_tier_id'; END IF;
    v_fields := v_fields || jsonb_build_object('gem_tier_id', v_tier);
  ELSIF p_item ? 'gem_tier' THEN
    SELECT id INTO v_tier FROM public.gem_tiers WHERE lower(name) = lower(btrim(p_item->>'gem_tier'));
    IF v_tier IS NULL THEN RAISE EXCEPTION 'UNKNOWN_GEM_TIER: "%"', p_item->>'gem_tier'; END IF;
    v_fields := v_fields || jsonb_build_object('gem_tier_id', v_tier);
  END IF;
  IF p_item ? 'rating' THEN v_fields := v_fields || jsonb_build_object('rating', p_item->'rating'); END IF;
  IF p_item ? 'run_rating' THEN v_fields := v_fields || jsonb_build_object('run_rating', p_item->'run_rating'); END IF;
  IF p_item ? 'position1' THEN v_fields := v_fields || jsonb_build_object('position1', p_item->>'position1'); END IF;
  IF p_item ? 'position2' THEN v_fields := v_fields || jsonb_build_object('position2', p_item->>'position2'); END IF;
  IF p_item ? 'version_order' OR p_item ? 'evo_stage' THEN
    v_fields := v_fields || jsonb_build_object('version_order',
      coalesce((p_item->>'version_order')::int, (p_item->>'evo_stage')::int));
  END IF;

  -- base stats: nested stats{} and/or flat stat_* keys, star point scale 0..99
  v_stats := coalesce(p_item->'stats', '{}'::jsonb);
  FOREACH v_k IN ARRAY v_base LOOP
    IF p_item ? v_k THEN v_stats := v_stats || jsonb_build_object(v_k, p_item->v_k); END IF;
  END LOOP;
  FOR v_k IN SELECT jsonb_object_keys(v_stats) LOOP
    IF NOT (v_k = ANY(v_base)) THEN
      RAISE EXCEPTION 'UNKNOWN_STAT_KEY: "%" detail=%', v_k, jsonb_build_object('supported', v_base)::text;
    END IF;
    v_num := (v_stats->>v_k)::numeric;
    IF v_num < 0 OR v_num > 99 THEN RAISE EXCEPTION 'STAT_OUT_OF_RANGE: % = % must be 0..99', v_k, v_num; END IF;
    v_fields := v_fields || jsonb_build_object(v_k, v_stats->v_k);
  END LOOP;

  -- Runs stats: nested run_stats{} (bare or prefixed) and/or flat run_stat_* keys, 0..139
  v_run := '{}'::jsonb;
  FOR v_k IN SELECT jsonb_object_keys(coalesce(p_item->'run_stats','{}'::jsonb)) LOOP
    IF v_k = ANY(v_runk) THEN
      v_run := v_run || jsonb_build_object(v_k, p_item->'run_stats'->v_k);
    ELSIF ('run_' || v_k) = ANY(v_runk) THEN
      v_run := v_run || jsonb_build_object('run_' || v_k, p_item->'run_stats'->v_k);
    ELSE
      RAISE EXCEPTION 'UNKNOWN_RUN_STAT_KEY: "%" detail=%', v_k, jsonb_build_object('supported', v_runk)::text;
    END IF;
  END LOOP;
  FOREACH v_k IN ARRAY v_runk LOOP
    IF p_item ? v_k THEN v_run := v_run || jsonb_build_object(v_k, p_item->v_k); END IF;
  END LOOP;
  FOR v_k IN SELECT jsonb_object_keys(v_run) LOOP
    v_num := (v_run->>v_k)::numeric;
    IF v_num < 0 OR v_num > 139 THEN RAISE EXCEPTION 'RUN_STAT_OUT_OF_RANGE: % = % must be 0..139', v_k, v_num; END IF;
    v_fields := v_fields || jsonb_build_object(v_k, v_run->v_k);
  END LOOP;

  v_match := format('%s evo v%s',
    (SELECT name FROM public.player_cards WHERE id = v_row.base_player_card_id), v_row.version_order);

  IF v_fields <> '{}'::jsonb THEN
    v_res := public.admin_upsert_row('evo_card_versions', v_id, v_fields, v_match, p_commit, 'update');
    v_ops := v_ops || coalesce(v_res->'operations','[]'::jsonb);
  END IF;

  IF p_item ? 'badges' THEN
    FOR v_b IN SELECT * FROM jsonb_array_elements(coalesce(p_item->'badges','[]'::jsonb)) LOOP
      IF jsonb_typeof(v_b) = 'string' THEN v_b := jsonb_build_object('badge', v_b #>> '{}'); END IF;
      IF v_b ? 'badge_id' THEN
        SELECT id INTO v_bid FROM public.badges WHERE id = (v_b->>'badge_id')::uuid;
      ELSE
        SELECT id INTO v_bid FROM public.badges
         WHERE lower(name) = lower(coalesce(v_b->>'badge', v_b->>'name'))
            OR lower(abbreviation) = lower(coalesce(v_b->>'badge', v_b->>'name'));
      END IF;
      IF v_bid IS NULL THEN RAISE EXCEPTION 'UNKNOWN_BADGE: "%"', coalesce(v_b->>'badge', v_b->>'name', v_b->>'badge_id'); END IF;
      v_badges := v_badges || jsonb_build_array(jsonb_build_object('badge_id', v_bid,
        'name', coalesce(v_b->>'badge', v_b->>'name'), 'tier', coalesce(v_b->>'tier','base')));
    END LOOP;
    SELECT coalesce(jsonb_agg(jsonb_build_object('badge_id', b.badge_id, 'name', bg.name, 'tier', b.tier)), '[]'::jsonb)
      INTO v_before FROM public.evo_card_version_badges b
      JOIN public.badges bg ON bg.id = b.badge_id WHERE b.evo_card_version_id = v_id;
    IF coalesce(v_before,'[]'::jsonb) <> v_badges THEN
      v_destr := v_destr || jsonb_build_object('action','replace','label','DESTRUCTIVE_REPLACEMENT',
        'table','evo_card_version_badges','id',v_id,'match',v_match,
        'message','this evo version badge list is fully replaced',
        'before', coalesce(v_before,'[]'::jsonb), 'after', v_badges);
    END IF;
    IF p_commit THEN
      DELETE FROM public.evo_card_version_badges WHERE evo_card_version_id = v_id;
      INSERT INTO public.evo_card_version_badges (evo_card_version_id, badge_id, tier)
        SELECT v_id, (e->>'badge_id')::uuid, e->>'tier' FROM jsonb_array_elements(v_badges) e;
    END IF;
  END IF;

  IF p_item ? 'traits' THEN
    FOR v_b IN SELECT * FROM jsonb_array_elements(coalesce(p_item->'traits','[]'::jsonb)) LOOP
      IF jsonb_typeof(v_b) = 'string' THEN v_b := jsonb_build_object('trait', v_b #>> '{}'); END IF;
      IF v_b ? 'trait_id' THEN
        SELECT id, coalesce(requires_target_stat,false) INTO v_bid, v_needs
          FROM public.signature_traits WHERE id = (v_b->>'trait_id')::uuid;
      ELSE
        SELECT id, coalesce(requires_target_stat,false) INTO v_bid, v_needs FROM public.signature_traits
         WHERE lower(name) = lower(coalesce(v_b->>'trait', v_b->>'name'))
            OR lower(abbreviation) = lower(coalesce(v_b->>'trait', v_b->>'name'));
      END IF;
      IF v_bid IS NULL THEN RAISE EXCEPTION 'UNKNOWN_TRAIT: "%"', coalesce(v_b->>'trait', v_b->>'name', v_b->>'trait_id'); END IF;
      IF v_needs AND nullif(btrim(coalesce(v_b->>'target_stat','')),'') IS NULL THEN
        RAISE EXCEPTION 'TRAIT_TARGET_STAT_REQUIRED: trait "%" needs target_stat', coalesce(v_b->>'trait', v_b->>'name');
      END IF;
      v_traits := v_traits || jsonb_build_array(jsonb_build_object('trait_id', v_bid,
        'name', coalesce(v_b->>'trait', v_b->>'name'), 'tier', coalesce(v_b->>'tier','base'),
        'target_stat', v_b->>'target_stat'));
    END LOOP;
    SELECT coalesce(jsonb_agg(jsonb_build_object('trait_id', t.trait_id, 'name', st.name, 'tier', t.tier, 'target_stat', t.target_stat)), '[]'::jsonb)
      INTO v_before FROM public.evo_card_version_traits t
      JOIN public.signature_traits st ON st.id = t.trait_id WHERE t.evo_card_version_id = v_id;
    IF coalesce(v_before,'[]'::jsonb) <> v_traits THEN
      v_destr := v_destr || jsonb_build_object('action','replace','label','DESTRUCTIVE_REPLACEMENT',
        'table','evo_card_version_traits','id',v_id,'match',v_match,
        'message','this evo version trait list is fully replaced',
        'before', coalesce(v_before,'[]'::jsonb), 'after', v_traits);
    END IF;
    IF p_commit THEN
      DELETE FROM public.evo_card_version_traits WHERE evo_card_version_id = v_id;
      INSERT INTO public.evo_card_version_traits (evo_card_version_id, trait_id, tier, target_stat)
        SELECT v_id, (e->>'trait_id')::uuid, e->>'tier', e->>'target_stat' FROM jsonb_array_elements(v_traits) e;
    END IF;
  END IF;

  RETURN jsonb_build_object('kind','evo_version','entity','evo_version','id', v_id, 'match', v_match,
    'applied', p_commit, 'operations', v_ops, 'destructive', v_destr,
    'fields', v_fields, 'warnings', '[]'::jsonb);
END $function$;
