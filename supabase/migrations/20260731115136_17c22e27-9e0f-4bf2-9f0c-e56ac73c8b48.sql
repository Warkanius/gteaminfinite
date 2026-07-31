CREATE OR REPLACE FUNCTION public.admin_substitute_refs(p_item jsonb, p_refs jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  v_out jsonb := '{}'::jsonb;
  v_k text; v_v jsonb; v_target text; v_val text; v_arr jsonb; v_el jsonb; v_pending int;
BEGIN
  IF p_item IS NULL OR jsonb_typeof(p_item) <> 'object' THEN RETURN p_item; END IF;
  FOR v_k, v_v IN SELECT key, value FROM jsonb_each(p_item) LOOP
    v_target := CASE WHEN v_k ~ '_ref$' THEN regexp_replace(v_k, '_ref$', '_id') ELSE v_k END;
    IF jsonb_typeof(v_v) = 'string' AND (v_v #>> '{}') LIKE 'ref:%' THEN
      v_val := p_refs->>(v_v #>> '{}');
      IF v_val IS NULL THEN
        RAISE EXCEPTION 'UNKNOWN_TEMP_REF: "%" was never declared as a temp_ref in this batch', v_v #>> '{}';
      END IF;
      IF v_val = 'pending' THEN
        v_out := v_out || jsonb_build_object(v_target || '_pending', v_v #>> '{}');
      ELSE
        v_out := v_out || jsonb_build_object(v_target, v_val);
      END IF;
    ELSIF jsonb_typeof(v_v) = 'array' THEN
      v_arr := '[]'::jsonb; v_pending := 0;
      FOR v_el IN SELECT * FROM jsonb_array_elements(v_v) LOOP
        v_val := NULL;
        IF jsonb_typeof(v_el) = 'string' AND (v_el #>> '{}') LIKE 'ref:%' THEN
          v_val := p_refs->>(v_el #>> '{}');
          IF v_val IS NULL THEN RAISE EXCEPTION 'UNKNOWN_TEMP_REF: "%"', v_el #>> '{}'; END IF;
        ELSIF jsonb_typeof(v_el) = 'object' AND (v_el->>'player_ref') IS NOT NULL THEN
          v_val := p_refs->>(v_el->>'player_ref');
          IF v_val IS NULL THEN RAISE EXCEPTION 'UNKNOWN_TEMP_REF: "%"', v_el->>'player_ref'; END IF;
        END IF;
        IF v_val IS NULL THEN
          v_arr := v_arr || jsonb_build_array(v_el);
        ELSIF v_val = 'pending' THEN
          v_pending := v_pending + 1;
        ELSE
          v_arr := v_arr || jsonb_build_array(jsonb_build_object('player_id', v_val));
        END IF;
      END LOOP;
      v_out := v_out || jsonb_build_object(v_target, v_arr);
      IF v_pending > 0 THEN v_out := v_out || jsonb_build_object(v_target || '_pending', v_pending); END IF;
    ELSE
      v_out := v_out || jsonb_build_object(v_target, v_v);
    END IF;
  END LOOP;
  RETURN v_out;
END $$;

CREATE OR REPLACE FUNCTION public.admin_apply_extra(p_kind text, p_payload jsonb, p_commit boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_ops jsonb := '[]'::jsonb;
  v_destr jsonb := '[]'::jsonb;
  v_warn jsonb := '[]'::jsonb;
  v_refs jsonb := '{}'::jsonb;
  v_id uuid; v_src uuid; v_dst uuid; v_from uuid; v_to uuid;
  v_step int; v_type text; v_stat text; v_road text; v_n int; v_cur uuid; v_depth int;
  v_game jsonb; v_gid uuid; v_orders int[] := '{}'; v_keep uuid[] := '{}'; v_ids uuid[];
  v_fields jsonb; v_title text; v_pending boolean := false;
  v_types text[] := ARRAY['points_scored','games_won','total_stat','single_game_stat','multi_condition'];
  v_stats text[] := ARRAY['stat_3pt','stat_mid','stat_fin','stat_dnk','stat_ast','stat_stl','stat_reb','stat_blk','stat_int'];
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED: sign in first'; END IF;
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN RAISE EXCEPTION 'FORBIDDEN: admin role required'; END IF;

  IF p_kind = 'evo_path' THEN
    v_pending := (p_payload ? 'source_player_id_pending') OR (p_payload ? 'destination_player_id_pending');
    IF v_pending AND p_commit THEN
      RAISE EXCEPTION 'PENDING_REF_AT_COMMIT: a temp_ref used by this evo path was not created earlier in the batch';
    END IF;
    IF v_pending THEN
      v_warn := v_warn || jsonb_build_object('code','PENDING_TEMP_REF','kind','evo_path',
        'message','source/destination card is created earlier in this batch; its id is assigned at commit time');
    END IF;

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
    IF v_src IS NULL AND NOT v_pending THEN RAISE EXCEPTION 'MISSING_SOURCE_PLAYER: supply source_player_id, source_card_key, or source_player_ref'; END IF;

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

    IF v_dst IS NOT NULL AND v_src IS NOT NULL THEN
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
    IF v_src IS NOT NULL THEN
      SELECT count(*) INTO v_n FROM evo_paths
      WHERE player_card_id = v_src AND step_order = v_step AND (v_id IS NULL OR id <> v_id);
      IF v_n > 0 THEN RAISE EXCEPTION 'CONFLICTING_STEP_ORDER: card already has an evo path at step %', v_step; END IF;
    END IF;

    v_fields := jsonb_strip_nulls(jsonb_build_object(
      'player_card_id', to_jsonb(v_src), 'evolves_to_card_id', to_jsonb(v_dst),
      'from_tier_id', to_jsonb(v_from), 'to_tier_id', to_jsonb(v_to), 'step_order', v_step,
      'challenge_description', coalesce(p_payload->>'challenge_description', 'Evolution step ' || v_step),
      'challenge_type', v_type, 'challenge_stat', v_stat,
      'challenge_target', coalesce((p_payload->>'challenge_target')::int, 1),
      'stat_boosts', p_payload->'stat_boosts', 'new_badges', p_payload->'new_badges',
      'new_traits', p_payload->'new_traits', 'compound_challenges', p_payload->'compound_challenges'));

    v_ops := v_ops || jsonb_build_object('table','evo_paths',
      'action', CASE WHEN v_id IS NULL THEN 'insert' ELSE 'update' END,
      'id', v_id, 'match', coalesce(v_src::text, p_payload->>'source_player_id_pending') || ' step ' || v_step,
      'fields', v_fields, 'field_changes', public.admin_diff_fields('evo_paths', v_id, v_fields));
    v_refs := jsonb_strip_nulls(jsonb_build_object('source_player_id', to_jsonb(v_src), 'destination_player_id', to_jsonb(v_dst)));

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
          player_card_id = coalesce(v_src, player_card_id),
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
        UPDATE player_cards SET base_card_id = coalesce(base_card_id, v_src), evo_stage = GREATEST(evo_stage, v_step)
        WHERE id = v_dst;
      END IF;
    END IF;

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
        'road_name', v_road, 'opponent_name', v_game->'opponent_name',
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
          'replaces_rows', coalesce(v_n,0), 'new_rows', array_length(v_ids,1), 'new_player_ids', to_jsonb(v_ids),
          'removed_player_ids', coalesce((SELECT jsonb_agg(player_card_id) FROM domination_game_players
             WHERE domination_game_id = v_gid AND NOT (player_card_id = ANY(v_ids))), '[]'::jsonb));
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
        v_keep := v_keep || v_gid;
      ELSIF v_gid IS NOT NULL THEN
        v_keep := v_keep || v_gid;
      END IF;
    END LOOP;

    IF coalesce((p_payload->>'replace_road')::boolean, false) THEN
      SELECT count(*) INTO v_n FROM domination_games
      WHERE lower(road_name) = lower(v_road) AND NOT (id = ANY(coalesce(v_keep, '{}'::uuid[])));
      v_destr := v_destr || jsonb_build_object('table','domination_games','action','delete',
        'note','replace_road removes games on this road that are absent from the payload',
        'road', v_road, 'deletes_rows', coalesce(v_n,0),
        'deletes', coalesce((SELECT jsonb_agg(jsonb_build_object('id', id, 'opponent_name', opponent_name, 'game_order', game_order))
          FROM domination_games WHERE lower(road_name) = lower(v_road) AND NOT (id = ANY(coalesce(v_keep,'{}'::uuid[])))), '[]'::jsonb));
      IF p_commit THEN
        DELETE FROM domination_game_players WHERE domination_game_id IN (
          SELECT id FROM domination_games WHERE lower(road_name) = lower(v_road) AND NOT (id = ANY(coalesce(v_keep,'{}'::uuid[]))));
        DELETE FROM domination_games WHERE lower(road_name) = lower(v_road) AND NOT (id = ANY(coalesce(v_keep,'{}'::uuid[])));
      END IF;
    END IF;
    v_id := v_keep[1];

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

REVOKE ALL ON FUNCTION public.admin_apply_extra(text, jsonb, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.admin_substitute_refs(jsonb, jsonb) FROM anon;