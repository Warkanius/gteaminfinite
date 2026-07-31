-- 1. Schema: stable identity extras --------------------------------------
ALTER TABLE public.domination_games
  ADD COLUMN IF NOT EXISTS opponent_team_id uuid REFERENCES public.teams(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pack_reward_id uuid REFERENCES public.packs(id) ON DELETE SET NULL;

-- Backfill pack_reward_id from legacy text (uuid form first, then exact unique name)
UPDATE public.domination_games g
SET pack_reward_id = p.id
FROM public.packs p
WHERE g.pack_reward_id IS NULL
  AND g.pack_reward IS NOT NULL
  AND g.pack_reward ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND p.id = g.pack_reward::uuid;

UPDATE public.domination_games g
SET pack_reward_id = sub.id
FROM (
  SELECT lower(btrim(name)) AS n, (array_agg(id))[1] AS id
  FROM public.packs GROUP BY 1 HAVING count(*) = 1
) sub
WHERE g.pack_reward_id IS NULL
  AND g.pack_reward IS NOT NULL
  AND btrim(g.pack_reward) <> ''
  AND lower(btrim(g.pack_reward)) = sub.n;

-- 2. Unique (road_name, game_order) -- deferrable so a commit may reorder games
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'domination_games_road_game_order_key'
      AND conrelid = 'public.domination_games'::regclass
  ) THEN
    -- Safety: nudge any pre-existing duplicates to free trailing orders instead of deleting data
    WITH d AS (
      SELECT id, road_name,
             row_number() OVER (PARTITION BY road_name, game_order ORDER BY created_at, id) AS rn,
             game_order
      FROM public.domination_games
    ), mx AS (
      SELECT road_name, max(game_order) AS m FROM public.domination_games GROUP BY 1
    )
    UPDATE public.domination_games t
    SET game_order = mx.m + d.rn - 1
    FROM d JOIN mx ON mx.road_name = d.road_name
    WHERE t.id = d.id AND d.rn > 1;

    ALTER TABLE public.domination_games
      ADD CONSTRAINT domination_games_road_game_order_key
      UNIQUE (road_name, game_order) DEFERRABLE INITIALLY IMMEDIATE;
  END IF;
END $$;

-- 3. Structured error helper ---------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_road_raise(
  p_code text, p_message text, p_game_order int DEFAULT NULL,
  p_field text DEFAULT NULL, p_value text DEFAULT NULL, p_extra jsonb DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  RAISE EXCEPTION '%: % detail=%', p_code, p_message,
    (jsonb_strip_nulls(jsonb_build_object(
      'game_order', p_game_order, 'field', p_field, 'value', p_value)) || coalesce(p_extra,'{}'::jsonb))::text;
END $$;

REVOKE ALL ON FUNCTION public.admin_road_raise(text,text,int,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_road_raise(text,text,int,text,text,jsonb) TO authenticated, service_role;

-- Pack resolution by id, then exact unique name -------------------------
CREATE OR REPLACE FUNCTION public.admin_resolve_pack(p_ref jsonb, p_game_order int DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_txt text; v_id uuid; v_n int; v_matches jsonb;
BEGIN
  IF p_ref IS NULL OR p_ref = 'null'::jsonb THEN RETURN NULL; END IF;
  v_txt := btrim(coalesce(p_ref #>> '{}', ''));
  IF v_txt = '' THEN RETURN NULL; END IF;

  IF v_txt ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT id INTO v_id FROM packs WHERE id = v_txt::uuid;
    IF v_id IS NULL THEN
      PERFORM public.admin_road_raise('UNKNOWN_PACK_ID', format('no pack with id %s', v_txt), p_game_order, 'pack_reward_id', v_txt);
    END IF;
    RETURN v_id;
  END IF;

  SELECT count(*) INTO v_n FROM packs WHERE lower(btrim(name)) = lower(v_txt);
  IF v_n = 0 THEN
    PERFORM public.admin_road_raise('UNKNOWN_PACK', format('no pack named "%s"', v_txt), p_game_order, 'pack_reward', v_txt);
  ELSIF v_n > 1 THEN
    SELECT jsonb_agg(jsonb_build_object('id', id, 'name', name, 'pack_type', pack_type))
      INTO v_matches FROM packs WHERE lower(btrim(name)) = lower(v_txt);
    PERFORM public.admin_road_raise('AMBIGUOUS_PACK',
      format('%s packs are named "%s"; use pack_reward_id', v_n, v_txt),
      p_game_order, 'pack_reward', v_txt, jsonb_build_object('matches', v_matches));
  END IF;
  SELECT id INTO v_id FROM packs WHERE lower(btrim(name)) = lower(v_txt);
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.admin_resolve_pack(jsonb,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_resolve_pack(jsonb,int) TO authenticated, service_role;

-- 4. Move the old extra engine aside and wrap it -------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'admin_apply_extra')
     AND NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'admin_apply_extra_legacy') THEN
    ALTER FUNCTION public.admin_apply_extra(text, jsonb, boolean) RENAME TO admin_apply_extra_legacy;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.admin_apply_extra(p_kind text, p_payload jsonb, p_commit boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_ops jsonb := '[]'::jsonb;
  v_destr jsonb := '[]'::jsonb;
  v_warn jsonb := '[]'::jsonb;
  v_refs jsonb := '[]'::jsonb;
  v_road text; v_game jsonb; v_gid uuid; v_orders int[] := '{}'; v_seen_ids uuid[] := '{}';
  v_keep uuid[] := '{}'; v_ids uuid[]; v_before uuid[]; v_step int; v_n int;
  v_fields jsonb; v_team uuid; v_pack uuid; v_opp text; v_row public.domination_games;
  v_added jsonb; v_removed jsonb; v_reordered boolean;
BEGIN
  IF p_kind <> 'domination_road' THEN
    RETURN public.admin_apply_extra_legacy(p_kind, p_payload, p_commit);
  END IF;

  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED: sign in first'; END IF;
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN RAISE EXCEPTION 'FORBIDDEN: admin role required'; END IF;

  v_road := btrim(coalesce(p_payload->>'road_name',''));
  IF v_road = '' THEN
    PERFORM public.admin_road_raise('MISSING_ROAD_NAME', 'road_name is required', NULL, 'road_name', NULL);
  END IF;
  IF jsonb_typeof(coalesce(p_payload->'games','[]'::jsonb)) <> 'array'
     OR jsonb_array_length(coalesce(p_payload->'games','[]'::jsonb)) = 0 THEN
    PERFORM public.admin_road_raise('INVALID_GAMES', 'games must be a non-empty array', NULL, 'games', NULL);
  END IF;

  FOR v_game IN SELECT * FROM jsonb_array_elements(p_payload->'games') LOOP
    ----------------------------------------------------------------- order
    IF NOT (v_game ? 'game_order') OR (v_game->>'game_order') IS NULL THEN
      PERFORM public.admin_road_raise('MISSING_GAME_ORDER', 'every game needs a game_order', NULL, 'game_order', NULL);
    END IF;
    v_step := (v_game->>'game_order')::int;
    IF v_step < 1 THEN
      PERFORM public.admin_road_raise('INVALID_GAME_ORDER', 'game_order must be >= 1', v_step, 'game_order', v_step::text);
    END IF;
    IF v_step = ANY(v_orders) THEN
      PERFORM public.admin_road_raise('DUPLICATE_GAME_ORDER',
        format('game_order %s appears more than once on road %s', v_step, v_road), v_step, 'game_order', v_step::text);
    END IF;
    v_orders := v_orders || v_step;

    --------------------------------------------------------------- identity
    v_gid := NULL; v_row := NULL;
    IF v_game ? 'domination_game_id' AND (v_game->>'domination_game_id') IS NOT NULL THEN
      SELECT * INTO v_row FROM domination_games WHERE id = (v_game->>'domination_game_id')::uuid;
      IF v_row.id IS NULL THEN
        PERFORM public.admin_road_raise('UNKNOWN_DOMINATION_GAME_ID',
          format('no domination game with id %s', v_game->>'domination_game_id'),
          v_step, 'domination_game_id', v_game->>'domination_game_id');
      END IF;
      IF lower(v_row.road_name) <> lower(v_road) THEN
        PERFORM public.admin_road_raise('GAME_ON_OTHER_ROAD',
          format('game %s belongs to road "%s", not "%s"', v_row.id, v_row.road_name, v_road),
          v_step, 'domination_game_id', v_game->>'domination_game_id');
      END IF;
      IF v_row.id = ANY(v_seen_ids) THEN
        PERFORM public.admin_road_raise('DUPLICATE_GAME_ID',
          format('domination_game_id %s is targeted by two payload entries', v_row.id),
          v_step, 'domination_game_id', v_row.id::text);
      END IF;
      -- conflict: another game already holds this road + game_order
      PERFORM 1 FROM domination_games
        WHERE lower(road_name) = lower(v_road) AND game_order = v_step AND id <> v_row.id;
      IF FOUND AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(p_payload->'games') e
        WHERE (e->>'domination_game_id') IS NOT NULL
          AND (e->>'domination_game_id')::uuid = (
            SELECT id FROM domination_games
            WHERE lower(road_name) = lower(v_road) AND game_order = v_step AND id <> v_row.id LIMIT 1)
      ) AND NOT coalesce((p_payload->>'replace_road')::boolean, false) THEN
        PERFORM public.admin_road_raise('GAME_ORDER_CONFLICT',
          format('another game already occupies %s / order %s; include or remove it', v_road, v_step),
          v_step, 'game_order', v_step::text);
      END IF;
      v_gid := v_row.id;
      v_seen_ids := v_seen_ids || v_gid;
    ELSE
      SELECT * INTO v_row FROM domination_games
      WHERE lower(road_name) = lower(v_road) AND game_order = v_step;
      IF v_row.id IS NOT NULL THEN
        IF v_row.id = ANY(v_seen_ids) THEN
          PERFORM public.admin_road_raise('DUPLICATE_GAME_ID',
            format('game %s is targeted by two payload entries', v_row.id), v_step, 'game_order', v_step::text);
        END IF;
        v_gid := v_row.id;
        v_seen_ids := v_seen_ids || v_gid;
      END IF;
    END IF;

    --------------------------------------------------------------- opponent
    v_opp := nullif(btrim(coalesce(v_game->>'opponent_name','')), '');
    v_team := NULL;
    IF v_game ? 'opponent_team_id' AND (v_game->>'opponent_team_id') IS NOT NULL THEN
      SELECT id INTO v_team FROM teams WHERE id = (v_game->>'opponent_team_id')::uuid;
      IF v_team IS NULL THEN
        PERFORM public.admin_road_raise('UNKNOWN_TEAM_ID', format('no team with id %s', v_game->>'opponent_team_id'),
          v_step, 'opponent_team_id', v_game->>'opponent_team_id');
      END IF;
    ELSIF v_game ? 'opponent_team' AND (v_game->>'opponent_team') IS NOT NULL THEN
      SELECT count(*) INTO v_n FROM teams WHERE lower(name) = lower(btrim(v_game->>'opponent_team'));
      IF v_n = 0 THEN
        PERFORM public.admin_road_raise('UNKNOWN_TEAM', format('no team named "%s"', v_game->>'opponent_team'),
          v_step, 'opponent_team', v_game->>'opponent_team');
      ELSIF v_n > 1 THEN
        PERFORM public.admin_road_raise('AMBIGUOUS_TEAM', format('%s teams named "%s"; use opponent_team_id', v_n, v_game->>'opponent_team'),
          v_step, 'opponent_team', v_game->>'opponent_team',
          jsonb_build_object('matches', (SELECT jsonb_agg(jsonb_build_object('id',id,'name',name))
             FROM teams WHERE lower(name) = lower(btrim(v_game->>'opponent_team')))));
      END IF;
      SELECT id INTO v_team FROM teams WHERE lower(name) = lower(btrim(v_game->>'opponent_team'));
    END IF;
    IF v_opp IS NULL AND v_team IS NOT NULL THEN
      SELECT name INTO v_opp FROM teams WHERE id = v_team;
    END IF;
    IF v_opp IS NULL AND v_gid IS NULL THEN
      PERFORM public.admin_road_raise('MISSING_OPPONENT',
        'a new game needs opponent_name or opponent_team_id', v_step, 'opponent_name', NULL);
    END IF;

    ------------------------------------------------------ difficulty/rewards
    IF v_game ? 'difficulty_stars' AND coalesce((v_game->>'difficulty_stars')::int, 1) NOT BETWEEN 1 AND 5 THEN
      PERFORM public.admin_road_raise('INVALID_DIFFICULTY', 'difficulty_stars must be 1-5',
        v_step, 'difficulty_stars', v_game->>'difficulty_stars');
    END IF;
    IF v_game ? 'coin_reward' AND coalesce((v_game->>'coin_reward')::int, 0) < 0 THEN
      PERFORM public.admin_road_raise('INVALID_COIN_REWARD', 'coin_reward must be >= 0',
        v_step, 'coin_reward', v_game->>'coin_reward');
    END IF;
    v_pack := NULL;
    IF v_game ? 'pack_reward_id' THEN
      v_pack := public.admin_resolve_pack(v_game->'pack_reward_id', v_step);
    ELSIF v_game ? 'pack_reward' THEN
      v_pack := public.admin_resolve_pack(v_game->'pack_reward', v_step);
    ELSIF v_gid IS NOT NULL THEN
      v_pack := v_row.pack_reward_id;
    END IF;

    ----------------------------------------------------------------- roster
    v_ids := NULL;
    IF v_game ? 'roster' THEN
      IF jsonb_typeof(v_game->'roster') <> 'array' THEN
        PERFORM public.admin_road_raise('INVALID_ROSTER', 'roster must be an array', v_step, 'roster', NULL);
      END IF;
      v_ids := public.admin_resolve_player_ids(v_game->'roster');
      IF coalesce(array_length(v_ids,1),0) = 0 THEN
        PERFORM public.admin_road_raise('EMPTY_ROSTER', 'roster was supplied but empty', v_step, 'roster', NULL);
      END IF;
      SELECT count(*) INTO v_n FROM (SELECT DISTINCT u FROM unnest(v_ids) u) s;
      IF v_n <> array_length(v_ids,1) THEN
        PERFORM public.admin_road_raise('DUPLICATE_ROSTER_CARD',
          'the same player card appears twice in one roster', v_step, 'roster', NULL);
      END IF;
      IF array_length(v_ids,1) <> 5 THEN
        v_warn := v_warn || jsonb_build_object('code','ROSTER_SIZE','game_order', v_step,
          'message', format('roster has %s cards; Domination games normally use 5', array_length(v_ids,1)));
      END IF;
    END IF;

    ------------------------------------------------------------------ plan
    v_fields := jsonb_build_object(
      'road_name', to_jsonb(v_road),
      'game_order', to_jsonb(v_step),
      'opponent_name', to_jsonb(coalesce(v_opp, v_row.opponent_name)),
      'opponent_team_id', to_jsonb(coalesce(v_team, v_row.opponent_team_id)),
      'difficulty_stars', to_jsonb(coalesce((v_game->>'difficulty_stars')::int, v_row.difficulty_stars, 1)),
      'coin_reward', to_jsonb(coalesce((v_game->>'coin_reward')::int, v_row.coin_reward, 0)),
      'pack_reward_id', to_jsonb(v_pack));

    v_ops := v_ops || jsonb_build_object('table','domination_games',
      'action', CASE WHEN v_gid IS NULL THEN 'insert' ELSE 'update' END,
      'domination_game_id', v_gid, 'road_name', v_road, 'game_order', v_step,
      'match', v_road || ' / order ' || v_step,
      'fields', v_fields,
      'field_changes', public.admin_diff_fields('domination_games', v_gid, v_fields));

    v_refs := v_refs || jsonb_strip_nulls(jsonb_build_object(
      'game_order', v_step, 'domination_game_id', to_jsonb(v_gid),
      'opponent_team_id', to_jsonb(v_team), 'pack_reward_id', to_jsonb(v_pack),
      'roster_player_ids', to_jsonb(v_ids)));

    IF v_ids IS NOT NULL THEN
      v_before := coalesce((SELECT array_agg(player_card_id ORDER BY slot)
        FROM domination_game_players WHERE domination_game_id = v_gid), '{}'::uuid[]);
      v_added := coalesce((SELECT jsonb_agg(u) FROM unnest(v_ids) u WHERE NOT (u = ANY(v_before))), '[]'::jsonb);
      v_removed := coalesce((SELECT jsonb_agg(u) FROM unnest(v_before) u WHERE NOT (u = ANY(v_ids))), '[]'::jsonb);
      v_reordered := (v_before <> v_ids) AND v_added = '[]'::jsonb AND v_removed = '[]'::jsonb;
      v_destr := v_destr || jsonb_build_object('table','domination_game_players','action','replace',
        'domination_game_id', v_gid, 'game_order', v_step, 'opponent_name', coalesce(v_opp, v_row.opponent_name),
        'before_slots', coalesce((SELECT jsonb_agg(jsonb_build_object('slot', i, 'player_card_id', v_before[i]))
           FROM generate_subscripts(v_before,1) i), '[]'::jsonb),
        'after_slots', (SELECT jsonb_agg(jsonb_build_object('slot', i, 'player_card_id', v_ids[i]))
           FROM generate_subscripts(v_ids,1) i),
        'replaces_rows', coalesce(array_length(v_before,1),0), 'new_rows', array_length(v_ids,1),
        'added_player_ids', v_added, 'removed_player_ids', v_removed, 'reordered', v_reordered);
    END IF;

    ---------------------------------------------------------------- commit
    IF p_commit THEN
      IF v_gid IS NULL THEN
        INSERT INTO domination_games(road_name, opponent_name, opponent_team_id, difficulty_stars,
                                     game_order, coin_reward, pack_reward, pack_reward_id)
        VALUES (v_road, v_opp, v_team,
                coalesce((v_game->>'difficulty_stars')::int, 1), v_step,
                coalesce((v_game->>'coin_reward')::int, 0),
                CASE WHEN v_pack IS NULL THEN NULL ELSE (SELECT name FROM packs WHERE id = v_pack) END,
                v_pack)
        RETURNING id INTO v_gid;
      ELSE
        UPDATE domination_games SET
          road_name = v_road,
          game_order = v_step,
          opponent_name = coalesce(v_opp, opponent_name),
          opponent_team_id = coalesce(v_team, opponent_team_id),
          difficulty_stars = coalesce((v_game->>'difficulty_stars')::int, difficulty_stars),
          coin_reward = coalesce((v_game->>'coin_reward')::int, coin_reward),
          pack_reward_id = v_pack,
          pack_reward = CASE WHEN v_pack IS NULL THEN NULL ELSE (SELECT name FROM packs WHERE id = v_pack) END
        WHERE id = v_gid;
      END IF;

      IF v_ids IS NOT NULL THEN
        DELETE FROM domination_game_players WHERE domination_game_id = v_gid;
        INSERT INTO domination_game_players(domination_game_id, player_card_id, slot)
        SELECT v_gid, v_ids[i], i FROM generate_subscripts(v_ids,1) AS i;
      END IF;
    END IF;

    IF v_gid IS NOT NULL THEN v_keep := v_keep || v_gid; END IF;
  END LOOP;

  ------------------------------------------------------------ replace_road
  IF coalesce((p_payload->>'replace_road')::boolean, false) THEN
    v_destr := v_destr || jsonb_build_object('table','domination_games','action','delete',
      'road_name', v_road,
      'note','replace_road deletes games on THIS road only that are absent from the payload, plus their roster rows',
      'deletes_rows', (SELECT count(*) FROM domination_games
         WHERE lower(road_name) = lower(v_road) AND NOT (id = ANY(coalesce(v_keep,'{}'::uuid[])))),
      'deletes', coalesce((SELECT jsonb_agg(jsonb_build_object(
          'domination_game_id', id, 'game_order', game_order, 'opponent_name', opponent_name,
          'roster_rows', (SELECT count(*) FROM domination_game_players WHERE domination_game_id = g.id)))
        FROM domination_games g
        WHERE lower(road_name) = lower(v_road) AND NOT (id = ANY(coalesce(v_keep,'{}'::uuid[])))), '[]'::jsonb));

    IF p_commit THEN
      DELETE FROM domination_game_players WHERE domination_game_id IN (
        SELECT id FROM domination_games
        WHERE lower(road_name) = lower(v_road) AND NOT (id = ANY(coalesce(v_keep,'{}'::uuid[]))));
      DELETE FROM domination_games
        WHERE lower(road_name) = lower(v_road) AND NOT (id = ANY(coalesce(v_keep,'{}'::uuid[])));
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'kind','domination_road','road_name', v_road,
    'mode', CASE WHEN p_commit THEN 'commit' ELSE 'preview' END,
    'applied', p_commit,
    'game_ids', to_jsonb(v_keep),
    'operations', v_ops, 'destructive', v_destr,
    'warnings', v_warn, 'resolved_references', v_refs);
END $$;

REVOKE ALL ON FUNCTION public.admin_apply_extra(text,jsonb,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_apply_extra(text,jsonb,boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_apply_extra_legacy(text,jsonb,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_apply_extra_legacy(text,jsonb,boolean) TO authenticated, service_role;

-- 5. Single-game delete with preview/commit -------------------------------
CREATE OR REPLACE FUNCTION public.admin_delete_domination_game(
  p_payload jsonb, p_commit boolean DEFAULT false, p_preview_token text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_row public.domination_games; v_hash text; v_token text; v_tok public.admin_preview_tokens;
  v_roster jsonb; v_n int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED: sign in first'; END IF;
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN RAISE EXCEPTION 'FORBIDDEN: admin role required'; END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_PAYLOAD: payload must be an object';
  END IF;

  IF p_payload ? 'domination_game_id' AND (p_payload->>'domination_game_id') IS NOT NULL THEN
    SELECT * INTO v_row FROM domination_games WHERE id = (p_payload->>'domination_game_id')::uuid;
    IF v_row.id IS NULL THEN
      PERFORM public.admin_road_raise('UNKNOWN_DOMINATION_GAME_ID',
        format('no domination game with id %s', p_payload->>'domination_game_id'),
        NULL, 'domination_game_id', p_payload->>'domination_game_id');
    END IF;
    IF p_payload ? 'road_name' AND lower(btrim(p_payload->>'road_name')) <> lower(v_row.road_name) THEN
      PERFORM public.admin_road_raise('GAME_ON_OTHER_ROAD',
        format('game %s belongs to road "%s"', v_row.id, v_row.road_name),
        v_row.game_order, 'road_name', p_payload->>'road_name');
    END IF;
  ELSIF (p_payload ? 'road_name') AND (p_payload ? 'game_order') THEN
    SELECT * INTO v_row FROM domination_games
    WHERE lower(road_name) = lower(btrim(p_payload->>'road_name'))
      AND game_order = (p_payload->>'game_order')::int;
    IF v_row.id IS NULL THEN
      PERFORM public.admin_road_raise('UNKNOWN_DOMINATION_GAME',
        format('no game at %s / order %s', p_payload->>'road_name', p_payload->>'game_order'),
        (p_payload->>'game_order')::int, 'game_order', p_payload->>'game_order');
    END IF;
  ELSE
    PERFORM public.admin_road_raise('MISSING_TARGET',
      'target the game with domination_game_id, or road_name + game_order; opponent name alone is not accepted',
      NULL, 'domination_game_id', NULL);
  END IF;

  SELECT count(*) INTO v_n FROM domination_game_players WHERE domination_game_id = v_row.id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('slot', slot, 'player_card_id', player_card_id) ORDER BY slot), '[]'::jsonb)
    INTO v_roster FROM domination_game_players WHERE domination_game_id = v_row.id;

  v_hash := md5(jsonb_build_object('domination_game_id', v_row.id)::text);

  IF p_commit THEN
    IF p_preview_token IS NULL THEN
      RAISE EXCEPTION 'PREVIEW_REQUIRED: commit needs the preview_token returned by the matching preview';
    END IF;
    SELECT * INTO v_tok FROM admin_preview_tokens WHERE token = p_preview_token AND user_id = auth.uid();
    IF v_tok.id IS NULL THEN RAISE EXCEPTION 'UNKNOWN_PREVIEW_TOKEN: run a preview again'; END IF;
    IF v_tok.consumed_at IS NOT NULL THEN RAISE EXCEPTION 'PREVIEW_ALREADY_COMMITTED: run a new preview'; END IF;
    IF v_tok.expires_at < now() THEN RAISE EXCEPTION 'PREVIEW_EXPIRED: run a new preview'; END IF;
    IF v_tok.payload_hash <> v_hash THEN
      RAISE EXCEPTION 'PREVIEW_MISMATCH: payload does not match the approved preview';
    END IF;

    DELETE FROM domination_game_players WHERE domination_game_id = v_row.id;
    DELETE FROM domination_games WHERE id = v_row.id;
    UPDATE admin_preview_tokens SET consumed_at = now() WHERE token = p_preview_token;
  ELSE
    DELETE FROM admin_preview_tokens WHERE user_id = auth.uid() AND consumed_at IS NULL AND kind = 'domination_game_delete';
    v_token := encode(gen_random_bytes(18), 'hex');
    INSERT INTO admin_preview_tokens(user_id, kind, token, payload_hash, normalized_payload)
    VALUES (auth.uid(), 'domination_game_delete', v_token, v_hash, jsonb_build_object('domination_game_id', v_row.id));
  END IF;

  RETURN jsonb_build_object(
    'kind','domination_game_delete',
    'mode', CASE WHEN p_commit THEN 'commit' ELSE 'preview' END,
    'applied', p_commit,
    'creates','[]'::jsonb, 'updates','[]'::jsonb, 'replacements','[]'::jsonb, 'warnings','[]'::jsonb,
    'deletes', jsonb_build_array(jsonb_build_object(
      'table','domination_games','domination_game_id', v_row.id, 'road_name', v_row.road_name,
      'game_order', v_row.game_order, 'opponent_name', v_row.opponent_name,
      'roster_rows', v_n, 'roster', v_roster)),
    'payload_hash', v_hash, 'preview_token', v_token);
END $$;

REVOKE ALL ON FUNCTION public.admin_delete_domination_game(jsonb,boolean,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_domination_game(jsonb,boolean,text) TO authenticated, service_role;