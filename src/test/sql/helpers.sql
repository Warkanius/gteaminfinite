CREATE OR REPLACE FUNCTION public.admin_apply_evo_version(p_evo_path_id uuid, p_version jsonb, p_commit boolean, p_step jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_card uuid; v_to uuid; v_to_name text; v_order int; v_id uuid;
  v_stats jsonb := coalesce(p_version->'stats', '{}'::jsonb);
  v_key text; v_val numeric;
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

  -- stats
  FOR v_key IN SELECT jsonb_object_keys(v_stats) LOOP
    IF NOT (v_key = ANY(public.admin_stat_keys())) THEN
      RAISE EXCEPTION 'UNKNOWN_STAT_KEY: resulting_version.stats."%" is not a stat detail=%', v_key,
        jsonb_build_object('supported', public.admin_stat_keys())::text;
    END IF;
    v_val := (v_stats->>v_key)::numeric;
    IF v_val < 0 OR v_val > 99 THEN
      RAISE EXCEPTION 'STAT_OUT_OF_RANGE: resulting_version.stats.% = % must be between 0 and 99', v_key, v_val;
    END IF;
  END LOOP;

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
    'status', coalesce(p_version->>'status','draft')
  ) || v_stats;

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

  RETURN jsonb_build_object('kind','evo_card_version','id', v_id, 'match', v_match,
    'version_order', v_order, 'to_tier', v_to_name, 'base_player_card_id', v_card,
    'badges', v_badges, 'traits', v_traits,
    'applied', p_commit, 'operations', v_ops, 'destructive', v_destr, 'warnings', v_warn);
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_col_type(p_table text, p_column text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT format_type(a.atttypid, a.atttypmod)
  FROM pg_attribute a
  JOIN pg_class c ON c.oid = a.attrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname='public' AND c.relname=p_table AND a.attname=p_column AND a.attnum > 0 AND NOT a.attisdropped;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_diff_fields(p_table text, p_id uuid, p_fields jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
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
  IF p_table NOT IN ('player_cards','teams','runs','domination_games','packs','locker_codes','challenges','dynamic_duos','evo_paths','storylines') THEN
    RETURN v_out;
  END IF;
  EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE t.id = $1', p_table) INTO v_row USING p_id;
  FOR v_k IN SELECT jsonb_object_keys(p_fields) LOOP
    IF coalesce(v_row->v_k, 'null'::jsonb)::text IS DISTINCT FROM coalesce(p_fields->v_k, 'null'::jsonb)::text THEN
      v_out := v_out || jsonb_build_object('field', v_k, 'before', v_row->v_k, 'after', p_fields->v_k);
    END IF;
  END LOOP;
  RETURN v_out;
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_entity_lookup(p_table text, p_name_column text, p_name text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  EXECUTE format('SELECT jsonb_build_object(''n'', count(*), ''id'', min(id::text))
                  FROM public.%I WHERE lower(btrim(%I::text)) = lower(btrim($1))', p_table, p_name_column)
    INTO v USING p_name;
  RETURN coalesce(v, jsonb_build_object('n', 0));
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_error(p_code text, p_message text, p_extra jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION '%: % detail=%', p_code, p_message, coalesce(p_extra, '{}'::jsonb)::text;
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_has_column(p_table text, p_column text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name=p_table AND column_name=p_column);
$function$
;

CREATE OR REPLACE FUNCTION public.admin_player_matches(p_name text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', pc.id, 'name', pc.name, 'card_key', pc.card_key, 'card_variant', pc.card_variant,
    'gem_tier', gt.name, 'team', t.name, 'rating', pc.rating, 'evo_stage', pc.evo_stage
  ) ORDER BY pc.card_key), '[]'::jsonb)
  FROM player_cards pc
  LEFT JOIN gem_tiers gt ON gt.id = pc.gem_tier_id
  LEFT JOIN teams t ON t.id = pc.team_id
  WHERE lower(pc.name) = lower(btrim(p_name))
$function$
;

CREATE OR REPLACE FUNCTION public.admin_require_admin()
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED: sign in first'; END IF;
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN RAISE EXCEPTION 'FORBIDDEN: admin role required'; END IF;
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_resolve_card(p_ref jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_resolve_player(p_ref jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ref jsonb := p_ref;
  v_id uuid;
  v_key text;
  v_name text;
  v_n int;
BEGIN
  IF v_ref IS NULL OR v_ref = 'null'::jsonb THEN RETURN NULL; END IF;
  IF jsonb_typeof(v_ref) = 'string' THEN
    IF v_ref #>> '{}' ~ '^[0-9a-fA-F-]{36}$' THEN
      v_ref := jsonb_build_object('player_id', v_ref #>> '{}');
    ELSE
      v_ref := jsonb_build_object('player_name', v_ref #>> '{}');
    END IF;
  END IF;
  IF jsonb_typeof(v_ref) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_PLAYER_REF: expected uuid, name, or object {player_id|card_key|player_name}';
  END IF;

  IF coalesce(v_ref->>'player_id', v_ref->>'id') IS NOT NULL THEN
    SELECT id INTO v_id FROM player_cards WHERE id = (coalesce(v_ref->>'player_id', v_ref->>'id'))::uuid;
    IF v_id IS NULL THEN RAISE EXCEPTION 'UNKNOWN_PLAYER_ID: no player card with id %', coalesce(v_ref->>'player_id', v_ref->>'id'); END IF;
    RETURN v_id;
  END IF;

  v_key := nullif(btrim(coalesce(v_ref->>'card_key','')), '');
  IF v_key IS NOT NULL THEN
    SELECT id INTO v_id FROM player_cards WHERE lower(card_key) = lower(v_key);
    IF v_id IS NULL THEN RAISE EXCEPTION 'UNKNOWN_CARD_KEY: no player card with card_key "%"', v_key; END IF;
    RETURN v_id;
  END IF;

  v_name := nullif(btrim(coalesce(v_ref->>'player_name', v_ref->>'name','')), '');
  IF v_name IS NULL THEN RAISE EXCEPTION 'INVALID_PLAYER_REF: supply player_id, card_key, or player_name'; END IF;

  SELECT count(*) INTO v_n FROM player_cards WHERE lower(name) = lower(v_name);
  IF v_n = 0 THEN RAISE EXCEPTION 'UNKNOWN_PLAYER: no player card named "%"', v_name; END IF;
  IF v_n > 1 THEN
    RAISE EXCEPTION 'AMBIGUOUS_PLAYER_NAME: "%" matches % cards. Target one with player_id or card_key. matches=%',
      v_name, v_n, public.admin_player_matches(v_name)::text;
  END IF;
  SELECT id INTO v_id FROM player_cards WHERE lower(name) = lower(v_name);
  RETURN v_id;
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_slugify(p_text text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT trim(both '-' from regexp_replace(lower(coalesce(p_text,'')), '[^a-z0-9]+', '-', 'g'))
$function$
;

CREATE OR REPLACE FUNCTION public.admin_stat_keys()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT ARRAY['stat_3pt','stat_mid','stat_fin','stat_dnk','stat_ast','stat_stl','stat_reb','stat_blk','stat_int',
               'run_stat_3pt','run_stat_mid','run_stat_fin','run_stat_dnk','run_stat_ast','run_stat_stl',
               'run_stat_reb','run_stat_blk','run_stat_int','points','games_played','games_won'];
$function$
;

CREATE OR REPLACE FUNCTION public.admin_upsert_row(p_table text, p_id uuid, p_fields jsonb, p_match text, p_commit boolean, p_action text DEFAULT 'upsert'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$
;
