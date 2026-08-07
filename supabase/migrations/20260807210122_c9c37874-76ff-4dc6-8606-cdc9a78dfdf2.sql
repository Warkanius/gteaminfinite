ALTER TABLE public.evo_card_versions
  ADD COLUMN IF NOT EXISTS position1 text,
  ADD COLUMN IF NOT EXISTS position2 text;

CREATE OR REPLACE FUNCTION public.admin_run_stat_keys()
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT ARRAY['run_stat_3pt','run_stat_mid','run_stat_fin','run_stat_dnk','run_stat_ast',
               'run_stat_stl','run_stat_reb','run_stat_blk','run_stat_int'];
$$;

CREATE OR REPLACE FUNCTION public.admin_base_stat_keys()
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT ARRAY['stat_3pt','stat_mid','stat_fin','stat_dnk','stat_ast',
               'stat_stl','stat_reb','stat_blk','stat_int'];
$$;

-- Runs point scale: one star of a base stat is worth 20 Runs points.
CREATE OR REPLACE FUNCTION public.admin_run_band(p_base numeric)
RETURNS int[] LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT ARRAY[s * 20, s * 20 + 19]
  FROM (SELECT least(greatest(floor(coalesce(p_base, 0))::int, 0), 6) AS s) q;
$$;

-- Deterministic fallback derivation used when a caller omits Runs values and the
-- shared TypeScript derivation did not already fill them in.
CREATE OR REPLACE FUNCTION public.admin_derive_run_stat(p_base numeric, p_seed text)
RETURNS int LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT b[1] + least(greatest(round(centre + jitter)::int, 0), 19)
  FROM (
    SELECT public.admin_run_band(p_base) AS b,
           (least(greatest((coalesce(p_base, 0) - floor(coalesce(p_base, 0))) * 100, 0), 99) / 99.0) * 19 AS centre,
           ((((('x' || substr(md5(coalesce(p_seed, '')), 1, 8))::bit(32)::bigint) % 1201)::numeric) / 100.0) - 6 AS jitter
  ) q;
$$;

CREATE OR REPLACE FUNCTION public.admin_run_rating(p_run jsonb)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path TO 'public' AS $$
DECLARE k text; v_total numeric := 0;
BEGIN
  FOREACH k IN ARRAY public.admin_run_stat_keys() LOOP
    IF NOT (p_run ? k) OR p_run->>k IS NULL THEN RETURN NULL; END IF;
    v_total := v_total + (p_run->>k)::numeric;
  END LOOP;
  RETURN round(v_total / 9.0, 2);
END $$;

CREATE OR REPLACE FUNCTION public.admin_apply_evo_version(p_evo_path_id uuid, p_version jsonb, p_commit boolean, p_step jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_card uuid; v_to uuid; v_to_name text; v_order int; v_id uuid;
  v_stats jsonb := coalesce(p_version->'stats', '{}'::jsonb);
  v_run jsonb := '{}'::jsonb;
  v_key text; v_run_key text; v_val numeric; v_base numeric; v_band int[];
  v_rating numeric; v_expected numeric;
  v_badges jsonb := '[]'::jsonb; v_traits jsonb := '[]'::jsonb;
  v_b jsonb; v_bid uuid; v_needs boolean;
  v_before jsonb; v_ops jsonb := '[]'::jsonb; v_destr jsonb := '[]'::jsonb; v_warn jsonb := '[]'::jsonb;
  v_fields jsonb; v_res jsonb; v_match text; v_action text;
BEGIN
  IF p_evo_path_id IS NOT NULL THEN
    SELECT player_card_id, to_tier_id, step_order INTO v_card, v_to, v_order
      FROM public.evo_paths WHERE id = p_evo_path_id;
  END IF;
  IF v_card IS NULL THEN
    v_card := nullif(p_step->>'player_card_id','')::uuid;
    v_order := coalesce((p_step->>'step_order')::int, 1);
    IF p_step ? 'to_tier' THEN
      SELECT id, name INTO v_to, v_to_name FROM public.gem_tiers WHERE lower(name) = lower(p_step->>'to_tier');
    END IF;
  ELSE
    SELECT name INTO v_to_name FROM public.gem_tiers WHERE id = v_to;
  END IF;

  -- Runs stats: accepted nested (run_stats) or flat (run_stat_*), including
  -- run_stat_* keys mistakenly nested inside stats.
  v_run := coalesce(p_version->'run_stats', '{}'::jsonb);
  IF jsonb_typeof(v_run) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_PAYLOAD: resulting_version.run_stats must be an object';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_version) LOOP
    IF v_key LIKE 'run_stat_%' THEN v_run := v_run || jsonb_build_object(v_key, p_version->v_key); END IF;
  END LOOP;
  FOR v_key IN SELECT jsonb_object_keys(v_stats) LOOP
    IF v_key LIKE 'run_stat_%' THEN
      v_run := v_run || jsonb_build_object(v_key, v_stats->v_key);
      v_stats := v_stats - v_key;
    END IF;
  END LOOP;

  -- base stats
  FOR v_key IN SELECT jsonb_object_keys(v_stats) LOOP
    IF NOT (v_key = ANY(public.admin_base_stat_keys())) THEN
      RAISE EXCEPTION 'UNKNOWN_STAT_KEY: resulting_version.stats."%" is not a base stat detail=%', v_key,
        jsonb_build_object('supported', public.admin_base_stat_keys())::text;
    END IF;
    v_val := (v_stats->>v_key)::numeric;
    IF v_val < 0 OR v_val > 99 THEN
      RAISE EXCEPTION 'STAT_OUT_OF_RANGE: resulting_version.stats.% = % must be between 0 and 99', v_key, v_val;
    END IF;
  END LOOP;

  -- supplied Runs stats are validated, never silently dropped
  FOR v_key IN SELECT jsonb_object_keys(v_run) LOOP
    IF NOT (v_key = ANY(public.admin_run_stat_keys())) THEN
      RAISE EXCEPTION 'UNKNOWN_RUN_STAT_KEY: resulting_version."%" is not a Runs stat detail=%', v_key,
        jsonb_build_object('supported', public.admin_run_stat_keys())::text;
    END IF;
    IF v_run->>v_key IS NULL THEN v_run := v_run - v_key; CONTINUE; END IF;
    v_val := (v_run->>v_key)::numeric;
    IF v_val < 0 OR v_val > 139 THEN
      RAISE EXCEPTION 'STAT_OUT_OF_RANGE: resulting_version.% = % must be between 0 and 139 on the Runs point scale (20 points per star)', v_key, v_val;
    END IF;
    v_base := nullif(v_stats->>replace(v_key, 'run_', ''), '')::numeric;
    IF v_base IS NOT NULL THEN
      v_band := public.admin_run_band(v_base);
      IF v_val < v_band[1] OR v_val > v_band[2] THEN
        RAISE EXCEPTION 'RUN_STAT_SCALE_MISMATCH: resulting_version.% = % must sit inside %-% (star %) for a base value of %',
          v_key, v_val, v_band[1], v_band[2], (v_band[1] / 20), v_base;
      END IF;
    END IF;
  END LOOP;

  -- derive omitted Runs stats from the base stats (same 20-points-per-star rule)
  FOREACH v_key IN ARRAY public.admin_base_stat_keys() LOOP
    v_run_key := replace(v_key, 'stat_', 'run_stat_');
    IF (v_run ? v_run_key) THEN CONTINUE; END IF;
    v_base := nullif(v_stats->>v_key, '')::numeric;
    IF v_base IS NULL THEN CONTINUE; END IF;
    v_run := v_run || jsonb_build_object(v_run_key,
      public.admin_derive_run_stat(v_base, format('%s|step%s|%s', coalesce(v_card::text,'?'), coalesce(v_order,1), v_key)));
  END LOOP;

  v_expected := public.admin_run_rating(v_run);
  IF p_version ? 'run_rating' AND p_version->>'run_rating' IS NOT NULL THEN
    v_rating := (p_version->>'run_rating')::numeric;
    IF v_rating < 0 OR v_rating > 139 THEN
      RAISE EXCEPTION 'STAT_OUT_OF_RANGE: resulting_version.run_rating = % must be between 0 and 139', v_rating;
    END IF;
    IF v_expected IS NOT NULL AND abs(v_rating - v_expected) > 1 THEN
      RAISE EXCEPTION 'RUN_RATING_MISMATCH: resulting_version.run_rating = % must be the mean of the nine Runs stats (%)', v_rating, v_expected;
    END IF;
  ELSE
    v_rating := v_expected;
  END IF;

  -- badges (full replacement)
  FOR v_b IN SELECT * FROM jsonb_array_elements(coalesce(p_version->'badges','[]'::jsonb)) LOOP
    IF jsonb_typeof(v_b) = 'string' THEN v_b := jsonb_build_object('badge', v_b #>> '{}'); END IF;
    IF v_b ? 'badge_id' THEN
      SELECT id INTO v_bid FROM public.badges WHERE id = (v_b->>'badge_id')::uuid;
    ELSE
      SELECT id INTO v_bid FROM public.badges
       WHERE lower(name) = lower(coalesce(v_b->>'badge', v_b->>'name'))
          OR lower(abbreviation) = lower(coalesce(v_b->>'badge', v_b->>'name'));
    END IF;
    IF v_bid IS NULL THEN RAISE EXCEPTION 'UNKNOWN_BADGE: "%"', coalesce(v_b->>'badge', v_b->>'name', v_b->>'badge_id'); END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_badges) e WHERE (e->>'badge_id')::uuid = v_bid) THEN
      RAISE EXCEPTION 'DUPLICATE_BADGE_ASSIGNMENT: badge "%" listed twice for one evo version', coalesce(v_b->>'badge', v_b->>'name');
    END IF;
    v_badges := v_badges || jsonb_build_array(jsonb_build_object(
      'badge_id', v_bid, 'name', coalesce(v_b->>'badge', v_b->>'name'),
      'tier', coalesce(v_b->>'tier','base')));
  END LOOP;

  -- traits (full replacement)
  FOR v_b IN SELECT * FROM jsonb_array_elements(coalesce(p_version->'traits','[]'::jsonb)) LOOP
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
    IF v_b ? 'target_stat' AND v_b->>'target_stat' IS NOT NULL
       AND NOT (v_b->>'target_stat' = ANY(public.admin_stat_keys())) THEN
      RAISE EXCEPTION 'UNKNOWN_STAT_KEY: trait target_stat "%" detail=%', v_b->>'target_stat',
        jsonb_build_object('supported', public.admin_stat_keys())::text;
    END IF;
    IF v_needs AND nullif(btrim(coalesce(v_b->>'target_stat','')),'') IS NULL THEN
      RAISE EXCEPTION 'TRAIT_TARGET_STAT_REQUIRED: trait "%" needs target_stat', coalesce(v_b->>'trait', v_b->>'name');
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_traits) e WHERE (e->>'trait_id')::uuid = v_bid) THEN
      RAISE EXCEPTION 'DUPLICATE_TRAIT_ASSIGNMENT: trait "%" listed twice for one evo version', coalesce(v_b->>'trait', v_b->>'name');
    END IF;
    v_traits := v_traits || jsonb_build_array(jsonb_build_object(
      'trait_id', v_bid, 'name', coalesce(v_b->>'trait', v_b->>'name'),
      'tier', coalesce(v_b->>'tier','base'), 'target_stat', v_b->>'target_stat'));
  END LOOP;

  IF p_evo_path_id IS NOT NULL THEN
    SELECT id INTO v_id FROM public.evo_card_versions WHERE evo_path_id = p_evo_path_id;
  END IF;
  v_action := CASE WHEN v_id IS NULL THEN 'create' ELSE 'update' END;
  v_match := format('%s v%s (%s)', (SELECT name FROM public.player_cards WHERE id = v_card), v_order, coalesce(v_to_name,'?'));

  v_fields := jsonb_build_object(
    'evo_path_id', p_evo_path_id, 'base_player_card_id', v_card,
    'version_order', v_order, 'gem_tier_id', v_to,
    'gem_name', coalesce(p_version->>'gem_name', v_to_name),
    'rating', p_version->'rating',
    'run_rating', to_jsonb(v_rating),
    'status', coalesce(p_version->>'status','draft')
  ) || v_stats || v_run;

  IF p_version ? 'position1' THEN v_fields := v_fields || jsonb_build_object('position1', p_version->>'position1'); END IF;
  IF p_version ? 'position2' THEN v_fields := v_fields || jsonb_build_object('position2', p_version->>'position2'); END IF;

  IF p_evo_path_id IS NOT NULL THEN
    v_res := public.admin_upsert_row('evo_card_versions', v_id, v_fields, v_match, p_commit, v_action);
    v_id := coalesce((v_res->>'id')::uuid, v_id);
    v_ops := v_ops || coalesce(v_res->'operations','[]'::jsonb);
  ELSE
    v_ops := v_ops || jsonb_build_array(jsonb_build_object(
      'action','create','table','evo_card_versions','match',v_match,'fields',v_fields));
  END IF;

  -- badge replacement
  SELECT coalesce(jsonb_agg(jsonb_build_object('badge_id', b.badge_id, 'name', bg.name, 'tier', b.tier)), '[]'::jsonb)
    INTO v_before FROM public.evo_card_version_badges b
    JOIN public.badges bg ON bg.id = b.badge_id WHERE b.evo_card_version_id = v_id;
  IF coalesce(v_before,'[]'::jsonb) <> '[]'::jsonb OR v_badges <> '[]'::jsonb THEN
    v_destr := v_destr || jsonb_build_object('action','replace','label','DESTRUCTIVE_REPLACEMENT',
      'table','evo_card_version_badges','id',v_id,'match',v_match,
      'message','this evo version badge list is fully replaced',
      'before', coalesce(v_before,'[]'::jsonb), 'after', v_badges);
  END IF;
  IF p_commit AND v_id IS NOT NULL THEN
    DELETE FROM public.evo_card_version_badges WHERE evo_card_version_id = v_id;
    INSERT INTO public.evo_card_version_badges (evo_card_version_id, badge_id, tier)
      SELECT v_id, (e->>'badge_id')::uuid, e->>'tier' FROM jsonb_array_elements(v_badges) e;
  END IF;

  -- trait replacement
  SELECT coalesce(jsonb_agg(jsonb_build_object('trait_id', t.trait_id, 'name', st.name, 'tier', t.tier, 'target_stat', t.target_stat)), '[]'::jsonb)
    INTO v_before FROM public.evo_card_version_traits t
    JOIN public.signature_traits st ON st.id = t.trait_id WHERE t.evo_card_version_id = v_id;
  IF coalesce(v_before,'[]'::jsonb) <> '[]'::jsonb OR v_traits <> '[]'::jsonb THEN
    v_destr := v_destr || jsonb_build_object('action','replace','label','DESTRUCTIVE_REPLACEMENT',
      'table','evo_card_version_traits','id',v_id,'match',v_match,
      'message','this evo version trait list is fully replaced',
      'before', coalesce(v_before,'[]'::jsonb), 'after', v_traits);
  END IF;
  IF p_commit AND v_id IS NOT NULL THEN
    DELETE FROM public.evo_card_version_traits WHERE evo_card_version_id = v_id;
    INSERT INTO public.evo_card_version_traits (evo_card_version_id, trait_id, tier, target_stat)
      SELECT v_id, (e->>'trait_id')::uuid, e->>'tier', e->>'target_stat' FROM jsonb_array_elements(v_traits) e;
  END IF;

  IF v_stats = '{}'::jsonb THEN
    v_warn := v_warn || jsonb_build_object('code','EVO_VERSION_NO_STATS',
      'message', format('%s has no resulting stats: the version inherits zeros', v_match));
  END IF;
  IF v_rating IS NULL THEN
    v_warn := v_warn || jsonb_build_object('code','EVO_VERSION_NO_RUN_STATS',
      'message', format('%s has no complete Runs stat line, so run_rating stays null', v_match));
  END IF;

  RETURN jsonb_build_object('kind','evo_card_version','id', v_id, 'match', v_match,
    'version_order', v_order, 'to_tier', v_to_name, 'base_player_card_id', v_card,
    'badges', v_badges, 'traits', v_traits, 'run_stats', v_run, 'run_rating', v_rating,
    'applied', p_commit, 'operations', v_ops, 'destructive', v_destr, 'warnings', v_warn);
END $function$;

-- Audit: which evo versions have missing / zeroed / out-of-band Runs data.
CREATE OR REPLACE FUNCTION public.admin_evo_version_audit()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  r record; v_row jsonb; v_issues jsonb; v_out jsonb := '[]'::jsonb;
  v_key text; v_run_key text; v_base numeric; v_val numeric; v_band int[];
  v_present int; v_zero int; v_base_sum numeric; v_mean numeric;
BEGIN
  PERFORM public.admin_require_admin();
  FOR r IN SELECT * FROM public.evo_card_versions ORDER BY base_player_card_id, version_order LOOP
    v_row := to_jsonb(r); v_issues := '[]'::jsonb;
    v_present := 0; v_zero := 0; v_base_sum := 0;
    FOREACH v_key IN ARRAY public.admin_base_stat_keys() LOOP
      v_run_key := replace(v_key, 'stat_', 'run_stat_');
      v_base := coalesce((v_row->>v_key)::numeric, 0);
      v_base_sum := v_base_sum + v_base;
      IF v_row->>v_run_key IS NULL THEN CONTINUE; END IF;
      v_present := v_present + 1;
      v_val := (v_row->>v_run_key)::numeric;
      IF v_val = 0 THEN v_zero := v_zero + 1; END IF;
      v_band := public.admin_run_band(v_base);
      IF v_val < v_band[1] OR v_val > v_band[2] THEN
        v_issues := v_issues || jsonb_build_array(jsonb_build_object(
          'code','RUN_STAT_OUT_OF_BAND','field', v_run_key, 'value', v_val,
          'expected_band', jsonb_build_array(v_band[1], v_band[2]), 'base', v_base));
      END IF;
    END LOOP;
    IF v_present < 9 THEN
      v_issues := v_issues || jsonb_build_array(jsonb_build_object(
        'code','RUN_STATS_INCOMPLETE','present', v_present));
    ELSIF v_zero = 9 AND v_base_sum > 0 THEN
      v_issues := v_issues || jsonb_build_array(jsonb_build_object('code','RUN_STATS_ALL_ZERO'));
    END IF;
    v_mean := public.admin_run_rating(v_row);
    IF r.run_rating IS NULL THEN
      v_issues := v_issues || jsonb_build_array(jsonb_build_object('code','RUN_RATING_NULL'));
    ELSIF v_mean IS NOT NULL AND abs(r.run_rating - v_mean) > 1 THEN
      v_issues := v_issues || jsonb_build_array(jsonb_build_object(
        'code','RUN_RATING_MISMATCH','value', r.run_rating, 'expected', v_mean));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.evo_paths p WHERE p.id = r.evo_path_id) THEN
      v_issues := v_issues || jsonb_build_array(jsonb_build_object('code','EVO_PATH_MISSING'));
    END IF;
    IF v_issues <> '[]'::jsonb THEN
      v_out := v_out || jsonb_build_array(jsonb_build_object(
        'evo_card_version_id', r.id, 'evo_path_id', r.evo_path_id,
        'base_player_card_id', r.base_player_card_id,
        'player_name', (SELECT name FROM public.player_cards WHERE id = r.base_player_card_id),
        'version_order', r.version_order, 'gem_name', r.gem_name,
        'issues', v_issues));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('checked', (SELECT count(*) FROM public.evo_card_versions),
    'flagged', jsonb_array_length(v_out), 'versions', v_out);
END $function$;

-- Deterministic Runs-only repair. Never touches gameplay stats, badges, traits,
-- gem tiers or objectives.
CREATE OR REPLACE FUNCTION public.admin_repair_evo_version_runs(p_commit boolean DEFAULT false, p_version_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  r record; v_row jsonb; v_run jsonb; v_key text; v_run_key text;
  v_base numeric; v_val numeric; v_band int[]; v_rating numeric;
  v_changed boolean; v_out jsonb := '[]'::jsonb; v_fixed int := 0;
BEGIN
  PERFORM public.admin_require_admin();
  FOR r IN SELECT * FROM public.evo_card_versions
            WHERE (p_version_id IS NULL OR id = p_version_id)
            ORDER BY base_player_card_id, version_order LOOP
    v_row := to_jsonb(r); v_run := '{}'::jsonb; v_changed := false;
    FOREACH v_key IN ARRAY public.admin_base_stat_keys() LOOP
      v_run_key := replace(v_key, 'stat_', 'run_stat_');
      v_base := coalesce((v_row->>v_key)::numeric, 0);
      v_val := nullif(v_row->>v_run_key, '')::numeric;
      v_band := public.admin_run_band(v_base);
      IF v_val IS NULL OR v_val < v_band[1] OR v_val > v_band[2]
         OR (v_val = 0 AND v_base > 0) THEN
        v_run := v_run || jsonb_build_object(v_run_key,
          public.admin_derive_run_stat(v_base, format('%s|step%s|%s', r.base_player_card_id, r.version_order, v_key)));
        v_changed := true;
      ELSE
        v_run := v_run || jsonb_build_object(v_run_key, v_val);
      END IF;
    END LOOP;
    v_rating := public.admin_run_rating(v_run);
    IF r.run_rating IS NULL OR (v_rating IS NOT NULL AND abs(r.run_rating - v_rating) > 1) THEN
      v_changed := true;
    END IF;
    IF NOT v_changed THEN CONTINUE; END IF;
    v_fixed := v_fixed + 1;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'evo_card_version_id', r.id, 'evo_path_id', r.evo_path_id,
      'player_name', (SELECT name FROM public.player_cards WHERE id = r.base_player_card_id),
      'version_order', r.version_order, 'gem_name', r.gem_name,
      'before', jsonb_build_object('run_rating', r.run_rating) ||
        (SELECT coalesce(jsonb_object_agg(k, v_row->k), '{}'::jsonb) FROM unnest(public.admin_run_stat_keys()) k),
      'after', jsonb_build_object('run_rating', v_rating) || v_run));
    IF p_commit THEN
      UPDATE public.evo_card_versions SET
        run_stat_3pt = (v_run->>'run_stat_3pt')::int,
        run_stat_mid = (v_run->>'run_stat_mid')::int,
        run_stat_fin = (v_run->>'run_stat_fin')::int,
        run_stat_dnk = (v_run->>'run_stat_dnk')::int,
        run_stat_ast = (v_run->>'run_stat_ast')::int,
        run_stat_stl = (v_run->>'run_stat_stl')::int,
        run_stat_reb = (v_run->>'run_stat_reb')::int,
        run_stat_blk = (v_run->>'run_stat_blk')::int,
        run_stat_int = (v_run->>'run_stat_int')::int,
        run_rating = v_rating,
        updated_at = now()
      WHERE id = r.id;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('committed', p_commit, 'repaired', v_fixed, 'versions', v_out);
END $function$;