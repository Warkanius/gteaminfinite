
-- 1. Schema additions -------------------------------------------------------
ALTER TABLE public.challenges ADD COLUMN IF NOT EXISTS target_value integer;
ALTER TABLE public.evo_paths ADD COLUMN IF NOT EXISTS evolves_to_version_id uuid
  REFERENCES public.evo_card_versions(id) ON DELETE SET NULL;

-- 2. Diff support for the newly mutable tables ------------------------------
CREATE OR REPLACE FUNCTION public.admin_diff_fields(p_table text, p_id uuid, p_fields jsonb)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_row jsonb; v_out jsonb := '[]'::jsonb; v_k text;
BEGIN
  IF p_fields IS NULL OR jsonb_typeof(p_fields) <> 'object' THEN RETURN v_out; END IF;
  IF p_id IS NULL THEN
    FOR v_k IN SELECT jsonb_object_keys(p_fields) LOOP
      v_out := v_out || jsonb_build_object('field', v_k, 'before', NULL, 'after', p_fields->v_k);
    END LOOP;
    RETURN v_out;
  END IF;
  IF p_table NOT IN ('player_cards','teams','runs','domination_games','packs','locker_codes','challenges',
                     'dynamic_duos','evo_paths','storylines','evo_card_versions') THEN
    RETURN v_out;
  END IF;
  EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE t.id = $1', p_table) INTO v_row USING p_id;
  FOR v_k IN SELECT jsonb_object_keys(p_fields) LOOP
    IF coalesce(v_row->v_k, 'null'::jsonb)::text IS DISTINCT FROM coalesce(p_fields->v_k, 'null'::jsonb)::text THEN
      v_out := v_out || jsonb_build_object('field', v_k, 'before', v_row->v_k, 'after', p_fields->v_k);
    END IF;
  END LOOP;
  RETURN v_out;
END $function$;

-- 3. Targeted evo version PATCH ---------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_patch_evo_version(p_item jsonb, p_commit boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid; v_row public.evo_card_versions%ROWTYPE;
  v_fields jsonb := '{}'::jsonb; v_key text; v_num numeric; v_tier uuid; v_status text;
  v_match text; v_res jsonb; v_ops jsonb := '[]'::jsonb; v_destr jsonb := '[]'::jsonb;
  v_badges jsonb := '[]'::jsonb; v_traits jsonb := '[]'::jsonb; v_before jsonb;
  v_b jsonb; v_bid uuid; v_needs boolean; v_stats jsonb; v_run jsonb; v_k text;
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
    IF NOT (v_key = ANY(v_allowed))
       AND NOT (v_key = ANY(public.admin_stat_keys()))
       AND NOT (v_key = ANY(public.admin_run_stat_keys())) THEN
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

  -- base stats: nested object and/or flat stat_* keys
  v_stats := coalesce(p_item->'stats', '{}'::jsonb);
  FOR v_k IN SELECT unnest(public.admin_stat_keys()) LOOP
    IF p_item ? v_k THEN v_stats := v_stats || jsonb_build_object(v_k, p_item->v_k); END IF;
  END LOOP;
  FOR v_k IN SELECT jsonb_object_keys(v_stats) LOOP
    IF NOT (v_k = ANY(public.admin_stat_keys())) THEN
      RAISE EXCEPTION 'UNKNOWN_STAT_KEY: "%" detail=%', v_k, jsonb_build_object('supported', public.admin_stat_keys())::text;
    END IF;
    v_num := (v_stats->>v_k)::numeric;
    IF v_num < 0 OR v_num > 99 THEN RAISE EXCEPTION 'STAT_OUT_OF_RANGE: % = % must be 0..99', v_k, v_num; END IF;
    v_fields := v_fields || jsonb_build_object(v_k, v_stats->v_k);
  END LOOP;

  -- runs stats: nested run_stats (bare or run_ prefixed keys) and/or flat run_stat_* keys
  v_run := '{}'::jsonb;
  FOR v_k IN SELECT jsonb_object_keys(coalesce(p_item->'run_stats','{}'::jsonb)) LOOP
    IF v_k LIKE 'run\_stat\_%' THEN
      v_run := v_run || jsonb_build_object(v_k, p_item->'run_stats'->v_k);
    ELSIF v_k LIKE 'stat\_%' THEN
      v_run := v_run || jsonb_build_object('run_' || v_k, p_item->'run_stats'->v_k);
    ELSE
      RAISE EXCEPTION 'UNKNOWN_RUN_STAT_KEY: "%" detail=%', v_k,
        jsonb_build_object('supported', public.admin_run_stat_keys())::text;
    END IF;
  END LOOP;
  FOR v_k IN SELECT unnest(public.admin_run_stat_keys()) LOOP
    IF p_item ? v_k THEN v_run := v_run || jsonb_build_object(v_k, p_item->v_k); END IF;
  END LOOP;
  FOR v_k IN SELECT jsonb_object_keys(v_run) LOOP
    IF NOT (v_k = ANY(public.admin_run_stat_keys())) THEN
      RAISE EXCEPTION 'UNKNOWN_RUN_STAT_KEY: "%" detail=%', v_k,
        jsonb_build_object('supported', public.admin_run_stat_keys())::text;
    END IF;
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

  -- badges: replaced ONLY when the key is present (PATCH semantics)
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

  -- traits: replaced ONLY when the key is present
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

-- 4. Targeted evo step link PATCH -------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_patch_evo_step(p_item jsonb, p_commit boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid; v_row public.evo_paths%ROWTYPE; v_fields jsonb := '{}'::jsonb;
  v_key text; v_target uuid; v_status text; v_match text; v_res jsonb; v_ops jsonb := '[]'::jsonb;
  v_allowed text[] := ARRAY['evo_step_id','evo_path_id','id','evolves_to_card_id','evolves_to_version_id',
    'status','step_order','sort_order'];
BEGIN
  v_id := nullif(coalesce(p_item->>'evo_step_id', p_item->>'evo_path_id', p_item->>'id'), '')::uuid;
  IF v_id IS NULL THEN RAISE EXCEPTION 'EVO_STEP_ID_REQUIRED: evo_step_id is required for a targeted evo step update'; END IF;
  SELECT * INTO v_row FROM public.evo_paths WHERE id = v_id;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'UNKNOWN_EVO_STEP_ID: %', v_id; END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_item) LOOP
    IF NOT (v_key = ANY(v_allowed)) THEN
      RAISE EXCEPTION 'UNSUPPORTED_FIELD: "%" cannot be set on an evo step detail=%', v_key,
        jsonb_build_object('mutable_fields', to_jsonb(v_allowed))::text;
    END IF;
  END LOOP;

  -- Canonical link: evolves_to_version_id -> evo_card_versions.
  -- evolves_to_card_id is accepted and auto-routed when the id is a version id.
  IF p_item ? 'evolves_to_version_id' THEN
    v_target := nullif(p_item->>'evolves_to_version_id','')::uuid;
    IF v_target IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.evo_card_versions WHERE id = v_target) THEN
      RAISE EXCEPTION 'UNKNOWN_EVO_VERSION_ID: %', v_target;
    END IF;
    v_fields := v_fields || jsonb_build_object('evolves_to_version_id', v_target);
  END IF;
  IF p_item ? 'evolves_to_card_id' THEN
    v_target := nullif(p_item->>'evolves_to_card_id','')::uuid;
    IF v_target IS NULL THEN
      v_fields := v_fields || jsonb_build_object('evolves_to_card_id', NULL);
    ELSIF EXISTS (SELECT 1 FROM public.evo_card_versions WHERE id = v_target) THEN
      v_fields := v_fields || jsonb_build_object('evolves_to_version_id', v_target);
    ELSIF EXISTS (SELECT 1 FROM public.player_cards WHERE id = v_target) THEN
      v_fields := v_fields || jsonb_build_object('evolves_to_card_id', v_target);
    ELSE
      RAISE EXCEPTION 'UNKNOWN_EVO_TARGET: % is neither an evo_card_version nor a player_card', v_target;
    END IF;
  END IF;
  IF p_item ? 'status' THEN
    v_status := lower(btrim(p_item->>'status'));
    IF v_status = 'published' THEN v_status := 'active'; END IF;
    IF v_status NOT IN ('draft','scheduled','active','disabled','archived') THEN
      RAISE EXCEPTION 'INVALID_STATUS: "%" is not a content status', p_item->>'status';
    END IF;
    v_fields := v_fields || jsonb_build_object('status', v_status);
  END IF;
  IF p_item ? 'step_order' THEN v_fields := v_fields || jsonb_build_object('step_order', (p_item->>'step_order')::int); END IF;
  IF p_item ? 'sort_order' THEN v_fields := v_fields || jsonb_build_object('sort_order', (p_item->>'sort_order')::int); END IF;

  IF v_fields = '{}'::jsonb THEN
    RAISE EXCEPTION 'EMPTY_UPDATE: supply at least one mutable field for evo step %', v_id;
  END IF;

  v_match := format('%s step %s',
    (SELECT name FROM public.player_cards WHERE id = v_row.player_card_id), v_row.step_order);
  v_res := public.admin_upsert_row('evo_paths', v_id, v_fields, v_match, p_commit, 'update');
  v_ops := coalesce(v_res->'operations','[]'::jsonb);

  RETURN jsonb_build_object('kind','evo_step','entity','evo_step','id', v_id, 'match', v_match,
    'applied', p_commit, 'operations', v_ops, 'destructive', '[]'::jsonb, 'fields', v_fields);
END $function$;

-- 5. Challenge writer: every submitted field is planned or rejected ---------
CREATE OR REPLACE FUNCTION public.admin_apply_challenge(p_payload jsonb, p_commit boolean DEFAULT false)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid; v_name text; v_key text; v_fields jsonb := '{}'::jsonb; v_rw jsonb;
  v_team uuid; v_card uuid; v_pack text; v_prereq uuid; v_stat_player uuid;
  v_status text; v_games jsonb; v_g jsonb; v_cond jsonb; v_res jsonb; v_ids uuid[];
  v_match text; v_row public.challenges%ROWTYPE; v_r uuid;
  v_allowed text[] := ARRAY['challenge_id','id','name','description','challenge_type','status',
    'target_value','win_by','win_condition','win_by_amount','repeatable','is_repeatable','sort_order',
    'series_length','series_win_coins','series_loss_coins','coin_reward','gem_reward','pack_reward',
    'pack_reward_id','card_reward','card_reward_id','rewards','reward_payload','prerequisite',
    'opponent_team','opponent_team_id','stat_limit_player','stat_limit_stat','stat_limit_value',
    'lineup_restrictions','spotlight_group','expires_at','games','conditions'];
BEGIN
  FOR v_key IN SELECT jsonb_object_keys(p_payload) LOOP
    IF NOT (v_key = ANY(v_allowed)) THEN
      RAISE EXCEPTION 'UNSUPPORTED_FIELD: "%" is not a challenge field detail=%', v_key,
        jsonb_build_object('mutable_fields', to_jsonb(v_allowed))::text;
    END IF;
  END LOOP;

  v_id := nullif(coalesce(p_payload->>'challenge_id', p_payload->>'id'), '')::uuid;
  IF v_id IS NOT NULL THEN
    SELECT * INTO v_row FROM public.challenges WHERE id = v_id;
    IF v_row.id IS NULL THEN RAISE EXCEPTION 'UNKNOWN_CHALLENGE_ID: %', v_id; END IF;
    v_name := coalesce(nullif(btrim(coalesce(p_payload->>'name','')),''), v_row.name);
  ELSE
    v_name := btrim(coalesce(p_payload->>'name',''));
    IF v_name = '' THEN RAISE EXCEPTION 'CHALLENGE_NAME_REQUIRED: name or challenge_id is required'; END IF;
    SELECT id INTO v_id FROM public.challenges WHERE lower(name) = lower(v_name);
  END IF;
  v_match := v_name;

  IF p_payload ? 'name' THEN v_fields := v_fields || jsonb_build_object('name', v_name); END IF;
  IF p_payload ? 'description' THEN v_fields := v_fields || jsonb_build_object('description', p_payload->>'description'); END IF;
  IF p_payload ? 'challenge_type' THEN v_fields := v_fields || jsonb_build_object('challenge_type', p_payload->>'challenge_type'); END IF;
  IF p_payload ? 'status' THEN
    v_status := lower(btrim(p_payload->>'status'));
    IF v_status = 'published' THEN v_status := 'active'; END IF;
    IF v_status NOT IN ('draft','scheduled','active','disabled','archived') THEN
      RAISE EXCEPTION 'INVALID_STATUS: "%" is not a content status', p_payload->>'status';
    END IF;
    v_fields := v_fields || jsonb_build_object('status', v_status);
  END IF;
  IF p_payload ? 'target_value' THEN v_fields := v_fields || jsonb_build_object('target_value', p_payload->'target_value'); END IF;
  IF p_payload ? 'win_condition' THEN v_fields := v_fields || jsonb_build_object('win_condition', p_payload->>'win_condition');
  ELSIF p_payload ? 'win_by' THEN v_fields := v_fields || jsonb_build_object('win_condition', p_payload->>'win_by'); END IF;
  IF p_payload ? 'win_by_amount' THEN v_fields := v_fields || jsonb_build_object('win_by_amount', p_payload->'win_by_amount'); END IF;
  IF p_payload ? 'is_repeatable' THEN v_fields := v_fields || jsonb_build_object('is_repeatable', p_payload->'is_repeatable');
  ELSIF p_payload ? 'repeatable' THEN v_fields := v_fields || jsonb_build_object('is_repeatable', p_payload->'repeatable'); END IF;
  IF p_payload ? 'sort_order' THEN v_fields := v_fields || jsonb_build_object('sort_order', p_payload->'sort_order'); END IF;
  IF p_payload ? 'series_length' THEN v_fields := v_fields || jsonb_build_object('series_length', p_payload->'series_length'); END IF;
  IF p_payload ? 'series_win_coins' THEN v_fields := v_fields || jsonb_build_object('series_win_coins', p_payload->'series_win_coins'); END IF;
  IF p_payload ? 'series_loss_coins' THEN v_fields := v_fields || jsonb_build_object('series_loss_coins', p_payload->'series_loss_coins'); END IF;
  IF p_payload ? 'spotlight_group' THEN v_fields := v_fields || jsonb_build_object('spotlight_group', p_payload->>'spotlight_group'); END IF;
  IF p_payload ? 'expires_at' THEN v_fields := v_fields || jsonb_build_object('expires_at', p_payload->>'expires_at'); END IF;
  IF p_payload ? 'lineup_restrictions' THEN v_fields := v_fields || jsonb_build_object('lineup_restrictions', p_payload->'lineup_restrictions'); END IF;
  IF p_payload ? 'stat_limit_stat' THEN v_fields := v_fields || jsonb_build_object('stat_limit_stat', p_payload->>'stat_limit_stat'); END IF;
  IF p_payload ? 'stat_limit_value' THEN v_fields := v_fields || jsonb_build_object('stat_limit_value', p_payload->'stat_limit_value'); END IF;
  IF p_payload ? 'stat_limit_player' THEN
    IF p_payload->>'stat_limit_player' IS NULL THEN
      v_fields := v_fields || jsonb_build_object('stat_limit_player_id', NULL);
    ELSE
      v_ids := public.admin_resolve_player_ids(jsonb_build_array(p_payload->>'stat_limit_player'));
      v_fields := v_fields || jsonb_build_object('stat_limit_player_id', v_ids[1]);
    END IF;
  END IF;
  IF p_payload ? 'prerequisite' THEN
    IF p_payload->>'prerequisite' IS NULL THEN
      v_fields := v_fields || jsonb_build_object('prerequisite_id', NULL);
    ELSE
      SELECT id INTO v_prereq FROM public.challenges WHERE lower(name) = lower(btrim(p_payload->>'prerequisite'));
      IF v_prereq IS NULL THEN RAISE EXCEPTION 'UNKNOWN_PREREQUISITE: "%"', p_payload->>'prerequisite'; END IF;
      v_fields := v_fields || jsonb_build_object('prerequisite_id', v_prereq);
    END IF;
  END IF;

  -- opponent
  IF p_payload ? 'opponent_team_id' THEN
    v_team := nullif(p_payload->>'opponent_team_id','')::uuid;
    IF v_team IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.teams WHERE id = v_team) THEN
      RAISE EXCEPTION 'UNKNOWN_TEAM_ID: %', v_team;
    END IF;
    v_fields := v_fields || jsonb_build_object('opponent_team_id', v_team);
  ELSIF p_payload ? 'opponent_team' THEN
    IF p_payload->>'opponent_team' IS NULL THEN
      v_fields := v_fields || jsonb_build_object('opponent_team_id', NULL);
    ELSE
      SELECT id INTO v_team FROM public.teams WHERE lower(name) = lower(btrim(p_payload->>'opponent_team'));
      IF v_team IS NULL THEN RAISE EXCEPTION 'UNKNOWN_TEAM: "%"', p_payload->>'opponent_team'; END IF;
      v_fields := v_fields || jsonb_build_object('opponent_team_id', v_team);
    END IF;
  END IF;

  -- rewards (object form) mapped onto the real columns
  v_rw := coalesce(p_payload->'rewards','{}'::jsonb);
  IF jsonb_typeof(v_rw) <> 'object' THEN RAISE EXCEPTION 'INVALID_REWARDS: rewards must be an object'; END IF;
  FOR v_key IN SELECT jsonb_object_keys(v_rw) LOOP
    IF NOT (v_key = ANY(ARRAY['coins','coin_reward','gems','gem_reward','player_card_id','card_reward_id',
                              'player_card','card_reward','pack_reward','pack_reward_id','payload','reward_payload'])) THEN
      RAISE EXCEPTION 'UNSUPPORTED_FIELD: rewards."%" is not a reward field', v_key;
    END IF;
  END LOOP;
  IF v_rw ? 'coins' THEN v_fields := v_fields || jsonb_build_object('coin_reward', v_rw->'coins'); END IF;
  IF v_rw ? 'coin_reward' THEN v_fields := v_fields || jsonb_build_object('coin_reward', v_rw->'coin_reward'); END IF;
  IF p_payload ? 'coin_reward' THEN v_fields := v_fields || jsonb_build_object('coin_reward', p_payload->'coin_reward'); END IF;
  IF v_rw ? 'gems' THEN v_fields := v_fields || jsonb_build_object('gem_reward', v_rw->'gems'); END IF;
  IF v_rw ? 'gem_reward' THEN v_fields := v_fields || jsonb_build_object('gem_reward', v_rw->'gem_reward'); END IF;
  IF p_payload ? 'gem_reward' THEN v_fields := v_fields || jsonb_build_object('gem_reward', p_payload->'gem_reward'); END IF;
  IF v_rw ? 'payload' THEN v_fields := v_fields || jsonb_build_object('reward_payload', v_rw->'payload'); END IF;
  IF v_rw ? 'reward_payload' THEN v_fields := v_fields || jsonb_build_object('reward_payload', v_rw->'reward_payload'); END IF;
  IF p_payload ? 'reward_payload' THEN v_fields := v_fields || jsonb_build_object('reward_payload', p_payload->'reward_payload'); END IF;

  IF (v_rw ? 'player_card_id') OR (v_rw ? 'card_reward_id') OR (p_payload ? 'card_reward_id') THEN
    v_card := nullif(coalesce(v_rw->>'player_card_id', v_rw->>'card_reward_id', p_payload->>'card_reward_id'),'')::uuid;
    IF v_card IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.player_cards WHERE id = v_card) THEN
      RAISE EXCEPTION 'UNKNOWN_PLAYER_CARD_ID: %', v_card;
    END IF;
    v_fields := v_fields || jsonb_build_object('card_reward_id', v_card);
  ELSIF (v_rw ? 'player_card') OR (v_rw ? 'card_reward') OR (p_payload ? 'card_reward') THEN
    IF coalesce(v_rw->>'player_card', v_rw->>'card_reward', p_payload->>'card_reward') IS NULL THEN
      v_fields := v_fields || jsonb_build_object('card_reward_id', NULL);
    ELSE
      v_ids := public.admin_resolve_player_ids(jsonb_build_array(
        coalesce(v_rw->>'player_card', v_rw->>'card_reward', p_payload->>'card_reward')));
      v_fields := v_fields || jsonb_build_object('card_reward_id', v_ids[1]);
    END IF;
  END IF;

  IF (v_rw ? 'pack_reward_id') OR (p_payload ? 'pack_reward_id') THEN
    v_pack := nullif(coalesce(v_rw->>'pack_reward_id', p_payload->>'pack_reward_id'),'');
    IF v_pack IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.packs WHERE id = v_pack::uuid) THEN
      RAISE EXCEPTION 'UNKNOWN_PACK_ID: %', v_pack;
    END IF;
    v_fields := v_fields || jsonb_build_object('pack_reward', v_pack);
  ELSIF (v_rw ? 'pack_reward') OR (p_payload ? 'pack_reward') THEN
    IF coalesce(v_rw->>'pack_reward', p_payload->>'pack_reward') IS NULL THEN
      v_fields := v_fields || jsonb_build_object('pack_reward', NULL);
    ELSE
      SELECT id::text INTO v_pack FROM public.packs
       WHERE lower(name) = lower(btrim(coalesce(v_rw->>'pack_reward', p_payload->>'pack_reward')));
      IF v_pack IS NULL THEN v_pack := coalesce(v_rw->>'pack_reward', p_payload->>'pack_reward'); END IF;
      v_fields := v_fields || jsonb_build_object('pack_reward', v_pack);
    END IF;
  END IF;

  -- game configuration lives in conditions.games
  IF p_payload ? 'conditions' THEN v_cond := p_payload->'conditions'; ELSE v_cond := coalesce(v_row.conditions, '{}'::jsonb); END IF;
  IF p_payload ? 'games' THEN
    v_games := coalesce(p_payload->'games','[]'::jsonb);
    IF jsonb_typeof(v_games) <> 'array' THEN RAISE EXCEPTION 'INVALID_GAMES: games must be an array'; END IF;
    FOR v_g IN SELECT * FROM jsonb_array_elements(v_games) LOOP
      IF NOT (v_g ? 'game_order') THEN RAISE EXCEPTION 'GAME_ORDER_REQUIRED: every challenge game needs game_order'; END IF;
      FOR v_r IN SELECT (e #>> '{}')::uuid FROM jsonb_array_elements(coalesce(v_g->'roster','[]'::jsonb)) e LOOP
        IF NOT EXISTS (SELECT 1 FROM public.player_cards WHERE id = v_r) THEN
          RAISE EXCEPTION 'UNKNOWN_PLAYER_CARD_ID: % in challenge game roster', v_r;
        END IF;
      END LOOP;
    END LOOP;
    v_cond := coalesce(v_cond,'{}'::jsonb) || jsonb_build_object('games', v_games);
  END IF;
  IF (p_payload ? 'games') OR (p_payload ? 'conditions') THEN
    v_fields := v_fields || jsonb_build_object('conditions', v_cond);
  END IF;

  IF v_fields = '{}'::jsonb THEN
    RAISE EXCEPTION 'EMPTY_UPDATE: no challenge fields were supplied for "%"', v_name;
  END IF;
  IF v_id IS NULL AND NOT (v_fields ? 'name') THEN
    v_fields := v_fields || jsonb_build_object('name', v_name);
  END IF;

  v_res := public.admin_upsert_row('challenges', v_id, v_fields, v_match, p_commit,
    CASE WHEN v_id IS NULL THEN 'create' ELSE 'update' END);
  v_id := coalesce((v_res->>'id')::uuid, v_id);

  RETURN jsonb_build_object('kind','challenge','entity','challenge','id', v_id, 'match', v_match,
    'applied', p_commit, 'operations', coalesce(v_res->'operations','[]'::jsonb),
    'destructive', '[]'::jsonb, 'fields', v_fields,
    'verification', CASE WHEN p_commit THEN (
      SELECT jsonb_build_object('challenge_id', c.id, 'name', c.name, 'challenge_type', c.challenge_type,
        'status', c.status, 'target_value', c.target_value, 'win_condition', c.win_condition,
        'is_repeatable', c.is_repeatable, 'coin_reward', c.coin_reward, 'gem_reward', c.gem_reward,
        'card_reward_id', c.card_reward_id, 'pack_reward', c.pack_reward,
        'opponent_team_id', c.opponent_team_id)
      FROM public.challenges c WHERE c.id = v_id) ELSE NULL END);
END $function$;

-- 6. Reads -------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_evo_version_get(p_id uuid)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'entity','evo_version',
    'version', to_jsonb(v),
    'player_card', (SELECT jsonb_build_object('id', pc.id, 'name', pc.name) FROM player_cards pc WHERE pc.id = v.base_player_card_id),
    'evo_step', (SELECT jsonb_build_object('id', ep.id, 'step_order', ep.step_order, 'status', ep.status,
                        'evolves_to_version_id', ep.evolves_to_version_id, 'evolves_to_card_id', ep.evolves_to_card_id)
                 FROM evo_paths ep WHERE ep.id = v.evo_path_id),
    'badges', (SELECT coalesce(jsonb_agg(jsonb_build_object('badge_id', b.badge_id, 'name', bg.name, 'tier', b.tier)),'[]'::jsonb)
               FROM evo_card_version_badges b JOIN badges bg ON bg.id = b.badge_id WHERE b.evo_card_version_id = v.id),
    'traits', (SELECT coalesce(jsonb_agg(jsonb_build_object('trait_id', t.trait_id, 'name', st.name, 'tier', t.tier, 'target_stat', t.target_stat)),'[]'::jsonb)
               FROM evo_card_version_traits t JOIN signature_traits st ON st.id = t.trait_id WHERE t.evo_card_version_id = v.id))
  FROM evo_card_versions v WHERE v.id = p_id;
$function$;

CREATE OR REPLACE FUNCTION public.admin_evo_version_list(p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'entity','evo_version',
    'filters', coalesce(p_filters,'{}'::jsonb),
    'total', (SELECT count(*) FROM evo_card_versions v
               WHERE (p_filters->>'player_card_id' IS NULL OR v.base_player_card_id = (p_filters->>'player_card_id')::uuid)
                 AND (p_filters->>'evo_stage' IS NULL OR v.version_order = (p_filters->>'evo_stage')::int)
                 AND (p_filters->>'gem_tier_id' IS NULL OR v.gem_tier_id = (p_filters->>'gem_tier_id')::uuid)
                 AND (p_filters->>'status' IS NULL OR v.status::text = p_filters->>'status')),
    'items', coalesce((
      SELECT jsonb_agg(x ORDER BY x->>'version_order')
      FROM (
        SELECT jsonb_build_object('id', v.id, 'evo_path_id', v.evo_path_id,
          'base_player_card_id', v.base_player_card_id, 'player_name', pc.name,
          'version_order', v.version_order, 'gem_name', v.gem_name, 'gem_tier_id', v.gem_tier_id,
          'rating', v.rating, 'run_rating', v.run_rating, 'status', v.status,
          'linked_step_id', (SELECT ep.id FROM evo_paths ep WHERE ep.evolves_to_version_id = v.id LIMIT 1)) AS x
        FROM evo_card_versions v LEFT JOIN player_cards pc ON pc.id = v.base_player_card_id
        WHERE (p_filters->>'player_card_id' IS NULL OR v.base_player_card_id = (p_filters->>'player_card_id')::uuid)
          AND (p_filters->>'evo_stage' IS NULL OR v.version_order = (p_filters->>'evo_stage')::int)
          AND (p_filters->>'gem_tier_id' IS NULL OR v.gem_tier_id = (p_filters->>'gem_tier_id')::uuid)
          AND (p_filters->>'status' IS NULL OR v.status::text = p_filters->>'status')
        LIMIT coalesce((p_filters->>'limit')::int, 200)
        OFFSET coalesce((p_filters->>'offset')::int, 0)
      ) s), '[]'::jsonb));
$function$;

-- 7. Wire the new groups into the batch engine ------------------------------
DO $do$
DECLARE v_src text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='admin_apply_batch';

  IF position('evo_version_updates' in v_src) = 0 THEN
    v_src := replace(v_src,
      $a$'gem_tasks','runs','domination_roads'$a$,
      $a$'evo_version_updates','evo_step_updates','gem_tasks','runs','domination_roads'$a$);
    v_src := replace(v_src,
      $b$      ELSE
        v_kind := CASE v_group
          WHEN 'teams' THEN 'team'$b$,
      $c$      ELSIF v_group = 'evo_version_updates' THEN
        v_res := public.admin_patch_evo_version(v_item, p_commit);
      ELSIF v_group = 'evo_step_updates' THEN
        v_res := public.admin_patch_evo_step(v_item, p_commit);
      ELSIF v_group = 'challenges' THEN
        v_res := public.admin_apply_challenge(v_item, p_commit);
      ELSE
        v_kind := CASE v_group
          WHEN 'teams' THEN 'team'$c$);
    EXECUTE v_src;
  END IF;
END $do$;
