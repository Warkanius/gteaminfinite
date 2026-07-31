-- ============================================================ 1. card identity
ALTER TABLE public.player_cards
  ADD COLUMN IF NOT EXISTS card_key text,
  ADD COLUMN IF NOT EXISTS card_variant text,
  ADD COLUMN IF NOT EXISTS evo_stage integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS base_card_id uuid REFERENCES public.player_cards(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.admin_slugify(p_text text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT trim(both '-' from regexp_replace(lower(coalesce(p_text,'')), '[^a-z0-9]+', '-', 'g'))
$$;

-- backfill unique card_key values
WITH numbered AS (
  SELECT id, public.admin_slugify(name) AS base,
         row_number() OVER (PARTITION BY public.admin_slugify(name) ORDER BY created_at, id) AS rn
  FROM public.player_cards WHERE card_key IS NULL
)
UPDATE public.player_cards pc
SET card_key = CASE WHEN n.rn = 1 THEN n.base ELSE n.base || '-' || n.rn END
FROM numbered n WHERE n.id = pc.id;

UPDATE public.player_cards SET card_key = 'card-' || left(id::text, 8) WHERE card_key IS NULL OR card_key = '';
ALTER TABLE public.player_cards ALTER COLUMN card_key SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS player_cards_card_key_uidx ON public.player_cards (lower(card_key));
CREATE INDEX IF NOT EXISTS player_cards_name_lower_idx ON public.player_cards (lower(name));

ALTER TABLE public.evo_paths ADD COLUMN IF NOT EXISTS new_traits jsonb NOT NULL DEFAULT '[]'::jsonb;

-- ============================================================ 2. preview tokens
CREATE TABLE IF NOT EXISTS public.admin_preview_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL,
  token text NOT NULL UNIQUE,
  payload_hash text NOT NULL,
  normalized_payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 minutes',
  consumed_at timestamptz
);
GRANT SELECT ON public.admin_preview_tokens TO authenticated;
GRANT ALL ON public.admin_preview_tokens TO service_role;
ALTER TABLE public.admin_preview_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read own preview tokens" ON public.admin_preview_tokens;
CREATE POLICY "Admins read own preview tokens" ON public.admin_preview_tokens
  FOR SELECT TO authenticated USING (user_id = auth.uid() AND public.has_role(auth.uid(), 'admin'::app_role));

-- ============================================================ 3. player resolution
CREATE OR REPLACE FUNCTION public.admin_player_matches(p_name text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', pc.id, 'name', pc.name, 'card_key', pc.card_key, 'card_variant', pc.card_variant,
    'gem_tier', gt.name, 'team', t.name, 'rating', pc.rating, 'evo_stage', pc.evo_stage
  ) ORDER BY pc.card_key), '[]'::jsonb)
  FROM player_cards pc
  LEFT JOIN gem_tiers gt ON gt.id = pc.gem_tier_id
  LEFT JOIN teams t ON t.id = pc.team_id
  WHERE lower(pc.name) = lower(btrim(p_name))
$$;

CREATE OR REPLACE FUNCTION public.admin_resolve_player(p_ref jsonb)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
END $$;

-- accepts an array of names, uuids, or {player_id|card_key|player_name} objects
CREATE OR REPLACE FUNCTION public.admin_resolve_player_ids(p_names jsonb)
RETURNS uuid[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ids uuid[] := '{}'; v_el jsonb;
BEGIN
  IF p_names IS NULL OR jsonb_typeof(p_names) <> 'array' THEN RETURN v_ids; END IF;
  FOR v_el IN SELECT * FROM jsonb_array_elements(p_names) LOOP
    v_ids := v_ids || public.admin_resolve_player(v_el);
  END LOOP;
  RETURN v_ids;
END $$;

-- ============================================================ 4. field diffs
CREATE OR REPLACE FUNCTION public.admin_diff_fields(p_table text, p_id uuid, p_fields jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
END $$;

-- ============================================================ 5. extra kinds
CREATE OR REPLACE FUNCTION public.admin_apply_extra(p_kind text, p_payload jsonb, p_commit boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ops jsonb := '[]'::jsonb;
  v_destr jsonb := '[]'::jsonb;
  v_warn jsonb := '[]'::jsonb;
  v_refs jsonb := '[]'::jsonb;
  v_id uuid; v_src uuid; v_dst uuid; v_from uuid; v_to uuid;
  v_step int; v_type text; v_stat text; v_road text; v_n int; v_cur uuid; v_depth int;
  v_game jsonb; v_gid uuid; v_orders int[] := '{}'; v_keep uuid[] := '{}'; v_ids uuid[];
  v_fields jsonb; v_title text;
  v_types text[] := ARRAY['points_scored','games_won','total_stat','single_game_stat','multi_condition'];
  v_stats text[] := ARRAY['stat_3pt','stat_mid','stat_fin','stat_dnk','stat_ast','stat_stl','stat_reb','stat_blk','stat_int'];
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED: sign in first'; END IF;
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN RAISE EXCEPTION 'FORBIDDEN: admin role required'; END IF;

  ------------------------------------------------------------------ EVO PATH
  IF p_kind = 'evo_path' THEN
    IF p_payload ? 'evo_path_id' THEN
      SELECT id INTO v_id FROM evo_paths WHERE id = (p_payload->>'evo_path_id')::uuid;
      IF v_id IS NULL THEN RAISE EXCEPTION 'UNKNOWN_EVO_PATH_ID: %', p_payload->>'evo_path_id'; END IF;
    END IF;

    IF p_payload ? 'source_player_id' OR p_payload ? 'source_player' OR p_payload ? 'source_card_key' THEN
      v_src := public.admin_resolve_player(coalesce(
        p_payload->'source_player_id', p_payload->'source_player',
        jsonb_build_object('card_key', p_payload->>'source_card_key')));
    ELSIF v_id IS NOT NULL THEN
      SELECT player_card_id INTO v_src FROM evo_paths WHERE id = v_id;
    END IF;
    IF v_src IS NULL THEN RAISE EXCEPTION 'MISSING_SOURCE_PLAYER: supply source_player_id'; END IF;

    IF p_payload ? 'destination_player_id' OR p_payload ? 'destination_player' OR p_payload ? 'destination_card_key' THEN
      v_dst := public.admin_resolve_player(coalesce(
        p_payload->'destination_player_id', p_payload->'destination_player',
        jsonb_build_object('card_key', p_payload->>'destination_card_key')));
    ELSIF v_id IS NOT NULL THEN
      SELECT evolves_to_card_id INTO v_dst FROM evo_paths WHERE id = v_id;
    END IF;
    IF v_dst IS NOT NULL AND v_dst = v_src THEN
      RAISE EXCEPTION 'INVALID_EVO_DESTINATION: source and destination must be different cards';
    END IF;

    -- circular chain guard
    IF v_dst IS NOT NULL THEN
      v_cur := v_dst; v_depth := 0;
      WHILE v_cur IS NOT NULL AND v_depth < 25 LOOP
        SELECT evolves_to_card_id INTO v_cur FROM evo_paths
        WHERE player_card_id = v_cur AND (v_id IS NULL OR id <> v_id) ORDER BY step_order LIMIT 1;
        IF v_cur = v_src THEN RAISE EXCEPTION 'CIRCULAR_EVO_CHAIN: destination chain leads back to the source card'; END IF;
        v_depth := v_depth + 1;
      END LOOP;
    END IF;

    IF p_payload ? 'from_gem_tier_id' THEN v_from := (p_payload->>'from_gem_tier_id')::uuid;
    ELSIF p_payload ? 'from_gem_tier' THEN
      SELECT id INTO v_from FROM gem_tiers WHERE lower(name) = lower(btrim(p_payload->>'from_gem_tier'));
      IF v_from IS NULL THEN RAISE EXCEPTION 'UNKNOWN_GEM_TIER: "%"', p_payload->>'from_gem_tier'; END IF;
    END IF;
    IF p_payload ? 'to_gem_tier_id' THEN v_to := (p_payload->>'to_gem_tier_id')::uuid;
    ELSIF p_payload ? 'to_gem_tier' THEN
      SELECT id INTO v_to FROM gem_tiers WHERE lower(name) = lower(btrim(p_payload->>'to_gem_tier'));
      IF v_to IS NULL THEN RAISE EXCEPTION 'UNKNOWN_GEM_TIER: "%"', p_payload->>'to_gem_tier'; END IF;
    END IF;
    IF v_from IS NOT NULL AND v_to IS NOT NULL THEN
      SELECT count(*) INTO v_n FROM gem_tiers a, gem_tiers b
      WHERE a.id = v_from AND b.id = v_to AND b.sort_order > a.sort_order;
      IF v_n = 0 THEN RAISE EXCEPTION 'INVALID_TIER_PROGRESSION: to_gem_tier must rank above from_gem_tier'; END IF;
    END IF;

    v_type := coalesce(p_payload->>'challenge_type', (SELECT challenge_type FROM evo_paths WHERE id = v_id), 'points_scored');
    IF NOT (v_type = ANY(v_types)) THEN
      RAISE EXCEPTION 'INVALID_CHALLENGE_TYPE: "%" (allowed: %)', v_type, array_to_string(v_types, ', ');
    END IF;
    v_stat := coalesce(p_payload->>'challenge_stat', (SELECT challenge_stat FROM evo_paths WHERE id = v_id));
    IF v_type IN ('total_stat','single_game_stat') THEN
      IF v_stat IS NULL OR NOT (v_stat = ANY(v_stats)) THEN
        RAISE EXCEPTION 'MISSING_CHALLENGE_STAT: % requires challenge_stat one of %', v_type, array_to_string(v_stats, ', ');
      END IF;
    END IF;
    IF v_type = 'multi_condition' THEN
      IF jsonb_typeof(coalesce(p_payload->'compound_challenges', (SELECT compound_challenges FROM evo_paths WHERE id = v_id), '[]'::jsonb)) <> 'array'
         OR jsonb_array_length(coalesce(p_payload->'compound_challenges', (SELECT compound_challenges FROM evo_paths WHERE id = v_id), '[]'::jsonb)) = 0 THEN
        RAISE EXCEPTION 'MISSING_COMPOUND_CHALLENGES: multi_condition requires a non-empty compound_challenges array';
      END IF;
    END IF;

    v_step := coalesce((p_payload->>'step_order')::int, (SELECT step_order FROM evo_paths WHERE id = v_id), 1);
    IF v_step < 1 THEN RAISE EXCEPTION 'INVALID_STEP_ORDER: step_order must be >= 1'; END IF;
    SELECT count(*) INTO v_n FROM evo_paths
    WHERE player_card_id = v_src AND step_order = v_step AND (v_id IS NULL OR id <> v_id);
    IF v_n > 0 THEN RAISE EXCEPTION 'CONFLICTING_STEP_ORDER: card already has an evo path at step %', v_step; END IF;

    v_fields := jsonb_strip_nulls(jsonb_build_object(
      'player_card_id', v_src, 'evolves_to_card_id', v_dst,
      'from_tier_id', v_from, 'to_tier_id', v_to, 'step_order', v_step,
      'challenge_description', coalesce(p_payload->>'challenge_description', 'Evolution step ' || v_step),
      'challenge_type', v_type, 'challenge_stat', v_stat,
      'challenge_target', coalesce((p_payload->>'challenge_target')::int, 1),
      'stat_boosts', p_payload->'stat_boosts', 'new_badges', p_payload->'new_badges',
      'new_traits', p_payload->'new_traits', 'compound_challenges', p_payload->'compound_challenges'));

    v_ops := v_ops || jsonb_build_object('table','evo_paths',
      'action', CASE WHEN v_id IS NULL THEN 'insert' ELSE 'update' END,
      'id', v_id, 'match', v_src::text || ' step ' || v_step,
      'fields', v_fields, 'field_changes', public.admin_diff_fields('evo_paths', v_id, v_fields));
    v_refs := v_refs || jsonb_build_object('source_player_id', v_src, 'destination_player_id', v_dst);

    IF p_commit THEN
      IF v_id IS NULL THEN
        INSERT INTO evo_paths(player_card_id, evolves_to_card_id, from_tier_id, to_tier_id, step_order,
          challenge_description, challenge_type, challenge_stat, challenge_target,
          stat_boosts, new_badges, new_traits, compound_challenges)
        VALUES (v_src, v_dst, v_from, v_to, v_step,
          v_fields->>'challenge_description', v_type, v_stat, (v_fields->>'challenge_target')::int,
          coalesce(p_payload->'stat_boosts','{}'::jsonb), coalesce(p_payload->'new_badges','[]'::jsonb),
          coalesce(p_payload->'new_traits','[]'::jsonb), coalesce(p_payload->'compound_challenges','[]'::jsonb))
        RETURNING id INTO v_id;
      ELSE
        UPDATE evo_paths SET
          player_card_id = v_src,
          evolves_to_card_id = coalesce(v_dst, evolves_to_card_id),
          from_tier_id = coalesce(v_from, from_tier_id),
          to_tier_id = coalesce(v_to, to_tier_id),
          step_order = v_step,
          challenge_description = coalesce(p_payload->>'challenge_description', challenge_description),
          challenge_type = v_type,
          challenge_stat = v_stat,
          challenge_target = coalesce((p_payload->>'challenge_target')::int, challenge_target),
          stat_boosts = coalesce(p_payload->'stat_boosts', stat_boosts),
          new_badges = coalesce(p_payload->'new_badges', new_badges),
          new_traits = coalesce(p_payload->'new_traits', new_traits),
          compound_challenges = coalesce(p_payload->'compound_challenges', compound_challenges)
        WHERE id = v_id;
      END IF;
      IF v_dst IS NOT NULL THEN
        UPDATE player_cards SET base_card_id = coalesce(base_card_id, v_src),
          evo_stage = GREATEST(evo_stage, v_step)
        WHERE id = v_dst;
      END IF;
    END IF;

  ------------------------------------------------------------ DOMINATION ROAD
  ELSIF p_kind = 'domination_road' THEN
    v_road := btrim(coalesce(p_payload->>'road_name',''));
    IF v_road = '' THEN RAISE EXCEPTION 'MISSING_ROAD_NAME: road_name is required'; END IF;
    IF jsonb_typeof(coalesce(p_payload->'games','[]'::jsonb)) <> 'array' THEN
      RAISE EXCEPTION 'INVALID_GAMES: games must be an array';
    END IF;

    FOR v_game IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'games','[]'::jsonb)) LOOP
      v_gid := NULL;
      IF v_game ? 'domination_game_id' THEN
        SELECT id INTO v_gid FROM domination_games WHERE id = (v_game->>'domination_game_id')::uuid;
        IF v_gid IS NULL THEN RAISE EXCEPTION 'UNKNOWN_DOMINATION_GAME_ID: %', v_game->>'domination_game_id'; END IF;
      ELSIF v_game ? 'opponent_name' THEN
        SELECT id INTO v_gid FROM domination_games
        WHERE lower(road_name) = lower(v_road) AND lower(opponent_name) = lower(btrim(v_game->>'opponent_name'));
      ELSE
        RAISE EXCEPTION 'MISSING_OPPONENT: each game needs opponent_name or domination_game_id';
      END IF;

      v_step := coalesce((v_game->>'game_order')::int, 0);
      IF v_step < 1 THEN RAISE EXCEPTION 'INVALID_GAME_ORDER: game_order must be >= 1 (opponent %)', v_game->>'opponent_name'; END IF;
      IF v_step = ANY(v_orders) THEN RAISE EXCEPTION 'DUPLICATE_GAME_ORDER: game_order % appears twice on road %', v_step, v_road; END IF;
      v_orders := v_orders || v_step;
      IF coalesce((v_game->>'difficulty_stars')::int, 1) NOT BETWEEN 1 AND 5 THEN
        RAISE EXCEPTION 'INVALID_DIFFICULTY: difficulty_stars must be 1-5 (game %)', v_step;
      END IF;
      IF coalesce((v_game->>'coin_reward')::int, 0) < 0 THEN RAISE EXCEPTION 'INVALID_COIN_REWARD: must be >= 0 (game %)', v_step; END IF;
      IF v_game ? 'opponent_team_id' THEN
        SELECT count(*) INTO v_n FROM teams WHERE id = (v_game->>'opponent_team_id')::uuid;
        IF v_n = 0 THEN RAISE EXCEPTION 'UNKNOWN_TEAM_ID: %', v_game->>'opponent_team_id'; END IF;
      END IF;

      v_ids := CASE WHEN v_game ? 'roster' THEN public.admin_resolve_player_ids(v_game->'roster') ELSE NULL END;
      IF v_ids IS NOT NULL AND coalesce(array_length(v_ids,1),0) = 0 THEN
        RAISE EXCEPTION 'EMPTY_ROSTER: game % supplied an empty roster', v_step;
      END IF;

      v_fields := jsonb_strip_nulls(jsonb_build_object(
        'road_name', v_road, 'opponent_name', v_game->>'opponent_name',
        'game_order', v_step, 'difficulty_stars', coalesce((v_game->>'difficulty_stars')::int, 1),
        'coin_reward', coalesce((v_game->>'coin_reward')::int, 0), 'pack_reward', v_game->'pack_reward'));

      v_ops := v_ops || jsonb_build_object('table','domination_games',
        'action', CASE WHEN v_gid IS NULL THEN 'insert' ELSE 'update' END,
        'id', v_gid, 'match', v_road || ' / ' || coalesce(v_game->>'opponent_name','(by id)'),
        'fields', v_fields, 'field_changes', public.admin_diff_fields('domination_games', v_gid, v_fields));

      IF v_ids IS NOT NULL THEN
        SELECT count(*) INTO v_n FROM domination_game_players WHERE domination_game_id = v_gid;
        v_destr := v_destr || jsonb_build_object('table','domination_game_players','action','replace',
          'game', v_road || ' / ' || coalesce(v_game->>'opponent_name',''),
          'replaces_rows', coalesce(v_n,0), 'new_rows', array_length(v_ids,1), 'new_player_ids', to_jsonb(v_ids));
      END IF;

      IF p_commit THEN
        IF v_gid IS NULL THEN
          INSERT INTO domination_games(road_name, opponent_name, difficulty_stars, game_order, coin_reward, pack_reward)
          VALUES (v_road, v_game->>'opponent_name', coalesce((v_game->>'difficulty_stars')::int,1), v_step,
                  coalesce((v_game->>'coin_reward')::int,0), v_game->>'pack_reward')
          RETURNING id INTO v_gid;
        ELSE
          UPDATE domination_games SET
            road_name = v_road,
            opponent_name = coalesce(v_game->>'opponent_name', opponent_name),
            difficulty_stars = coalesce((v_game->>'difficulty_stars')::int, difficulty_stars),
            game_order = v_step,
            coin_reward = coalesce((v_game->>'coin_reward')::int, coin_reward),
            pack_reward = CASE WHEN v_game ? 'pack_reward' THEN v_game->>'pack_reward' ELSE pack_reward END
          WHERE id = v_gid;
        END IF;
        IF v_ids IS NOT NULL THEN
          DELETE FROM domination_game_players WHERE domination_game_id = v_gid;
          INSERT INTO domination_game_players(domination_game_id, player_card_id, slot)
          SELECT v_gid, v_ids[i], i FROM generate_subscripts(v_ids,1) AS i;
        END IF;
      END IF;
      v_keep := v_keep || v_gid;
    END LOOP;

    IF coalesce((p_payload->>'replace_road')::boolean, false) THEN
      SELECT count(*) INTO v_n FROM domination_games
      WHERE lower(road_name) = lower(v_road) AND NOT (id = ANY(coalesce(v_keep, '{}'::uuid[])));
      v_destr := v_destr || jsonb_build_object('table','domination_games','action','delete',
        'note','replace_road removes games on this road that are absent from the payload',
        'road', v_road, 'deletes_rows', coalesce(v_n,0));
      IF p_commit THEN
        DELETE FROM domination_game_players WHERE domination_game_id IN (
          SELECT id FROM domination_games WHERE lower(road_name) = lower(v_road) AND NOT (id = ANY(coalesce(v_keep,'{}'::uuid[]))));
        DELETE FROM domination_games WHERE lower(road_name) = lower(v_road) AND NOT (id = ANY(coalesce(v_keep,'{}'::uuid[])));
      END IF;
    END IF;
    v_id := v_keep[1];

  ------------------------------------------------------------------ STORYLINE
  ELSIF p_kind = 'storyline' THEN
    IF p_payload ? 'storyline_id' THEN
      SELECT id INTO v_id FROM storylines WHERE id = (p_payload->>'storyline_id')::uuid;
      IF v_id IS NULL THEN RAISE EXCEPTION 'UNKNOWN_STORYLINE_ID: %', p_payload->>'storyline_id'; END IF;
    ELSE
      v_title := btrim(coalesce(p_payload->>'title',''));
      IF v_title = '' THEN RAISE EXCEPTION 'MISSING_TITLE: title or storyline_id is required'; END IF;
      SELECT id INTO v_id FROM storylines WHERE lower(title) = lower(v_title);
    END IF;
    v_fields := jsonb_strip_nulls(jsonb_build_object(
      'title', p_payload->'title', 'summary', p_payload->'summary',
      'arc_image_url', p_payload->'arc_image_url', 'status', p_payload->'status',
      'starts_at', p_payload->'starts_at', 'ends_at', p_payload->'ends_at'));
    v_ops := v_ops || jsonb_build_object('table','storylines',
      'action', CASE WHEN v_id IS NULL THEN 'insert' ELSE 'update' END, 'id', v_id,
      'match', coalesce(p_payload->>'title', v_id::text), 'fields', v_fields,
      'field_changes', public.admin_diff_fields('storylines', v_id, v_fields));
    IF p_commit THEN
      IF v_id IS NULL THEN
        INSERT INTO storylines(title, summary, arc_image_url, status, starts_at, ends_at)
        VALUES (p_payload->>'title', p_payload->>'summary', p_payload->>'arc_image_url',
                coalesce(p_payload->>'status','active'),
                (p_payload->>'starts_at')::timestamptz, (p_payload->>'ends_at')::timestamptz)
        RETURNING id INTO v_id;
      ELSE
        UPDATE storylines SET
          title = coalesce(p_payload->>'title', title),
          summary = CASE WHEN p_payload ? 'summary' THEN p_payload->>'summary' ELSE summary END,
          arc_image_url = CASE WHEN p_payload ? 'arc_image_url' THEN p_payload->>'arc_image_url' ELSE arc_image_url END,
          status = coalesce(p_payload->>'status', status),
          starts_at = CASE WHEN p_payload ? 'starts_at' THEN (p_payload->>'starts_at')::timestamptz ELSE starts_at END,
          ends_at = CASE WHEN p_payload ? 'ends_at' THEN (p_payload->>'ends_at')::timestamptz ELSE ends_at END,
          updated_at = now()
        WHERE id = v_id;
      END IF;
    END IF;
  ELSE
    RAISE EXCEPTION 'UNKNOWN_KIND: %', p_kind;
  END IF;

  RETURN jsonb_build_object('kind', p_kind, 'mode', CASE WHEN p_commit THEN 'commit' ELSE 'preview' END,
    'applied', p_commit, 'id', v_id, 'operations', v_ops, 'destructive', v_destr,
    'warnings', v_warn, 'resolved_references', v_refs);
END $$;
