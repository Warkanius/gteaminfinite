-- ============================================================ export a road
CREATE OR REPLACE FUNCTION public.admin_road_export(p_ref jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE v_road public.domination_roads; v_games jsonb; v_orders int[]; v_warn jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED: sign in first'; END IF;

  IF p_ref ? 'road_id' AND (p_ref->>'road_id') IS NOT NULL THEN
    SELECT * INTO v_road FROM domination_roads WHERE id = (p_ref->>'road_id')::uuid;
  ELSIF p_ref ? 'road_name' AND btrim(coalesce(p_ref->>'road_name','')) <> '' THEN
    SELECT * INTO v_road FROM domination_roads WHERE lower(btrim(name)) = lower(btrim(p_ref->>'road_name'));
  ELSE
    PERFORM public.admin_road_raise('MISSING_TARGET', 'pass road_id or road_name', NULL, 'road_id', NULL);
  END IF;

  IF v_road.id IS NULL THEN
    PERFORM public.admin_road_raise('UNKNOWN_ROAD',
      format('no domination road matched %s', coalesce(p_ref->>'road_id', p_ref->>'road_name')),
      NULL, 'road_name', coalesce(p_ref->>'road_id', p_ref->>'road_name'));
  END IF;

  SELECT coalesce(jsonb_agg(g ORDER BY g.game_order), '[]'::jsonb), array_agg(g.game_order ORDER BY g.game_order)
    INTO v_games, v_orders
  FROM (
    SELECT dg.game_order,
           jsonb_build_object(
             'domination_game_id', dg.id,
             'game_order', dg.game_order,
             'opponent_name', dg.opponent_name,
             'opponent_team_id', dg.opponent_team_id,
             'opponent_team_name', t.name,
             'difficulty_stars', dg.difficulty_stars,
             'coin_reward', dg.coin_reward,
             'pack_reward_id', dg.pack_reward_id,
             'pack_reward_name', pk.name,
             'roster', (
               SELECT coalesce(jsonb_agg(jsonb_build_object(
                        'slot', p.slot, 'player_id', p.player_card_id,
                        'card_key', pc.card_key, 'player_name', pc.name, 'rating', pc.rating
                      ) ORDER BY p.slot), '[]'::jsonb)
               FROM domination_game_players p
               JOIN player_cards pc ON pc.id = p.player_card_id
               WHERE p.domination_game_id = dg.id
             )
           ) AS g
    FROM domination_games dg
    LEFT JOIN teams t ON t.id = dg.opponent_team_id
    LEFT JOIN packs pk ON pk.id = dg.pack_reward_id
    WHERE dg.road_id = v_road.id
  ) g;

  -- warnings ---------------------------------------------------------------
  IF v_orders IS NOT NULL AND array_length(v_orders,1) > 0 THEN
    IF v_orders[1] <> 1 THEN
      v_warn := v_warn || jsonb_build_array(jsonb_build_object(
        'code','ROAD_ORDER_NOT_STARTING_AT_1','game_order', v_orders[1]));
    END IF;
    IF array_length(v_orders,1) <> (v_orders[array_length(v_orders,1)] - v_orders[1] + 1) THEN
      v_warn := v_warn || jsonb_build_array(jsonb_build_object(
        'code','ROAD_ORDER_GAP','message','game_order values are not contiguous'));
    END IF;
  END IF;
  v_warn := v_warn || coalesce((
    SELECT jsonb_agg(jsonb_build_object('code','EMPTY_ROSTER','game_order', x.game_order))
    FROM (SELECT (e->>'game_order')::int game_order FROM jsonb_array_elements(v_games) e
          WHERE jsonb_array_length(e->'roster') = 0) x), '[]'::jsonb);
  v_warn := v_warn || coalesce((
    SELECT jsonb_agg(jsonb_build_object('code','NO_PACK_REWARD','game_order', x.game_order))
    FROM (SELECT (e->>'game_order')::int game_order FROM jsonb_array_elements(v_games) e
          WHERE (e->>'pack_reward_id') IS NULL) x), '[]'::jsonb);

  RETURN jsonb_build_object(
    'road', jsonb_build_object(
      'road_id', v_road.id, 'road_name', v_road.name, 'slug', v_road.slug,
      'description', v_road.description, 'sort_order', v_road.sort_order, 'is_active', v_road.is_active),
    'game_count', jsonb_array_length(v_games),
    'rematches', coalesce((
      SELECT jsonb_agg(jsonb_build_object('opponent_name', o.opponent_name, 'game_orders', o.orders))
      FROM (SELECT dg.opponent_name, jsonb_agg(dg.game_order ORDER BY dg.game_order) orders
            FROM domination_games dg WHERE dg.road_id = v_road.id
            GROUP BY dg.opponent_name HAVING count(*) > 1) o), '[]'::jsonb),
    'games', v_games,
    'warnings', v_warn
  );
END;
$$;

-- ================================================ bulk import / replace road
CREATE OR REPLACE FUNCTION public.admin_road_bulk(p_payload jsonb, p_commit boolean DEFAULT false, p_preview_token text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_road public.domination_roads; v_name text; v_new_name text; v_mode text;
  v_hash text; v_token text; v_tok public.admin_preview_tokens;
  v_games jsonb; v_res jsonb; v_updates jsonb := '[]'::jsonb; v_creates jsonb := '[]'::jsonb;
  v_warn jsonb := '[]'::jsonb; v_road_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED: sign in first'; END IF;
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN RAISE EXCEPTION 'FORBIDDEN: admin role required'; END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_PAYLOAD: payload must be an object';
  END IF;

  v_mode := lower(coalesce(p_payload->>'mode','merge'));
  IF v_mode NOT IN ('merge','replace') THEN
    PERFORM public.admin_road_raise('INVALID_MODE', 'mode must be "merge" or "replace"', NULL, 'mode', v_mode);
  END IF;

  -- resolve the road ------------------------------------------------------
  IF p_payload ? 'road_id' AND (p_payload->>'road_id') IS NOT NULL THEN
    SELECT * INTO v_road FROM domination_roads WHERE id = (p_payload->>'road_id')::uuid;
    IF v_road.id IS NULL THEN
      PERFORM public.admin_road_raise('UNKNOWN_ROAD_ID', format('no domination road with id %s', p_payload->>'road_id'),
        NULL, 'road_id', p_payload->>'road_id');
    END IF;
  ELSIF btrim(coalesce(p_payload->>'road_name','')) <> '' THEN
    SELECT * INTO v_road FROM domination_roads WHERE lower(btrim(name)) = lower(btrim(p_payload->>'road_name'));
  ELSE
    PERFORM public.admin_road_raise('MISSING_ROAD', 'pass road_id or road_name', NULL, 'road_name', NULL);
  END IF;

  v_name := coalesce(v_road.name, btrim(p_payload->>'road_name'));
  v_new_name := nullif(btrim(coalesce(p_payload->>'new_road_name','')), '');
  IF v_new_name IS NOT NULL AND EXISTS (
      SELECT 1 FROM domination_roads WHERE lower(btrim(name)) = lower(v_new_name) AND id IS DISTINCT FROM v_road.id) THEN
    PERFORM public.admin_road_raise('ROAD_NAME_TAKEN', format('another road is already named "%s"', v_new_name),
      NULL, 'new_road_name', v_new_name);
  END IF;
  IF v_road.id IS NULL AND v_mode = 'replace' THEN
    v_warn := v_warn || jsonb_build_array(jsonb_build_object(
      'code','NEW_ROAD','message', format('road "%s" does not exist yet and will be created', v_name)));
  END IF;

  v_games := coalesce(p_payload->'games','[]'::jsonb);
  IF jsonb_typeof(v_games) <> 'array' THEN
    PERFORM public.admin_road_raise('INVALID_GAMES', 'games must be an array', NULL, 'games', NULL);
  END IF;

  v_hash := md5(p_payload::text);

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
  END IF;

  -- road metadata --------------------------------------------------------
  IF v_road.id IS NULL THEN
    v_creates := v_creates || jsonb_build_array(jsonb_build_object('table','domination_roads','road_name', coalesce(v_new_name, v_name)));
    IF p_commit THEN
      INSERT INTO domination_roads (name, slug, description, sort_order, is_active)
      VALUES (coalesce(v_new_name, v_name), public.admin_slugify(coalesce(v_new_name, v_name)),
              p_payload->>'description',
              coalesce((p_payload->>'sort_order')::int, (SELECT coalesce(max(sort_order),0)+1 FROM domination_roads)),
              coalesce((p_payload->>'is_active')::boolean, true))
      RETURNING * INTO v_road;
      v_name := v_road.name;
    END IF;
  ELSE
    IF v_new_name IS NOT NULL OR p_payload ? 'description' OR p_payload ? 'sort_order' OR p_payload ? 'is_active' THEN
      v_updates := v_updates || jsonb_build_array(jsonb_build_object(
        'table','domination_roads','road_id', v_road.id,
        'from', jsonb_build_object('road_name', v_road.name, 'description', v_road.description,
                                   'sort_order', v_road.sort_order, 'is_active', v_road.is_active),
        'to', jsonb_build_object('road_name', coalesce(v_new_name, v_road.name),
                                 'description', coalesce(p_payload->>'description', v_road.description),
                                 'sort_order', coalesce((p_payload->>'sort_order')::int, v_road.sort_order),
                                 'is_active', coalesce((p_payload->>'is_active')::boolean, v_road.is_active))));
    END IF;
    IF p_commit THEN
      UPDATE domination_roads SET
        name = coalesce(v_new_name, name),
        slug = CASE WHEN v_new_name IS NOT NULL THEN public.admin_slugify(v_new_name) ELSE slug END,
        description = CASE WHEN p_payload ? 'description' THEN p_payload->>'description' ELSE description END,
        sort_order = coalesce((p_payload->>'sort_order')::int, sort_order),
        is_active = coalesce((p_payload->>'is_active')::boolean, is_active)
      WHERE id = v_road.id
      RETURNING * INTO v_road;
      v_name := v_road.name;
    ELSIF v_new_name IS NOT NULL THEN
      v_name := v_road.name;  -- games are still addressed by the current name during preview
    END IF;
  END IF;
  v_road_id := v_road.id;

  -- games ----------------------------------------------------------------
  IF jsonb_array_length(v_games) > 0 THEN
    v_res := public.admin_apply_extra('domination_road', jsonb_build_object(
      'road_name', v_name,
      'replace_road', (v_mode = 'replace'),
      'games', v_games
    ), p_commit);
  ELSE
    IF v_mode = 'replace' THEN
      PERFORM public.admin_road_raise('INVALID_GAMES',
        'replace mode needs a non-empty games array; use admin_road_delete to remove a whole road',
        NULL, 'games', NULL);
    END IF;
    v_res := jsonb_build_object('operations','[]'::jsonb,'destructive_operations','[]'::jsonb,'warnings','[]'::jsonb);
  END IF;

  IF p_commit THEN
    UPDATE admin_preview_tokens SET consumed_at = now() WHERE token = p_preview_token;
  ELSE
    DELETE FROM admin_preview_tokens WHERE user_id = auth.uid() AND consumed_at IS NULL AND kind = 'domination_road_bulk';
    v_token := encode(gen_random_bytes(18), 'hex');
    INSERT INTO admin_preview_tokens(user_id, kind, token, payload_hash, normalized_payload)
    VALUES (auth.uid(), 'domination_road_bulk', v_token, v_hash, p_payload);
  END IF;

  RETURN jsonb_build_object(
    'kind','domination_road_bulk',
    'mode', CASE WHEN p_commit THEN 'commit' ELSE 'preview' END,
    'applied', p_commit,
    'road', jsonb_build_object('road_id', v_road_id, 'road_name', coalesce(v_new_name, v_name), 'import_mode', v_mode),
    'road_creates', v_creates,
    'road_updates', v_updates,
    'game_operations', coalesce(v_res->'operations','[]'::jsonb),
    'destructive_operations', coalesce(v_res->'destructive_operations','[]'::jsonb),
    'warnings', v_warn || coalesce(v_res->'warnings','[]'::jsonb),
    'preview_token', v_token
  );
END;
$$;

-- ============================================================= delete a road
CREATE OR REPLACE FUNCTION public.admin_road_delete(p_payload jsonb, p_commit boolean DEFAULT false, p_preview_token text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_road public.domination_roads; v_hash text; v_token text; v_tok public.admin_preview_tokens;
  v_games jsonb; v_roster_rows int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED: sign in first'; END IF;
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN RAISE EXCEPTION 'FORBIDDEN: admin role required'; END IF;

  IF p_payload ? 'road_id' AND (p_payload->>'road_id') IS NOT NULL THEN
    SELECT * INTO v_road FROM domination_roads WHERE id = (p_payload->>'road_id')::uuid;
  ELSIF btrim(coalesce(p_payload->>'road_name','')) <> '' THEN
    SELECT * INTO v_road FROM domination_roads WHERE lower(btrim(name)) = lower(btrim(p_payload->>'road_name'));
  ELSE
    PERFORM public.admin_road_raise('MISSING_TARGET', 'pass road_id or road_name', NULL, 'road_id', NULL);
  END IF;
  IF v_road.id IS NULL THEN
    PERFORM public.admin_road_raise('UNKNOWN_ROAD', 'no domination road matched that target', NULL, 'road_name',
      coalesce(p_payload->>'road_id', p_payload->>'road_name'));
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('domination_game_id', id, 'game_order', game_order,
           'opponent_name', opponent_name) ORDER BY game_order), '[]'::jsonb)
    INTO v_games FROM domination_games WHERE road_id = v_road.id;
  SELECT count(*) INTO v_roster_rows FROM domination_game_players p
    JOIN domination_games g ON g.id = p.domination_game_id WHERE g.road_id = v_road.id;

  v_hash := md5(jsonb_build_object('road_id', v_road.id)::text);

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
    DELETE FROM domination_roads WHERE id = v_road.id;  -- cascades to games and rosters
    UPDATE admin_preview_tokens SET consumed_at = now() WHERE token = p_preview_token;
  ELSE
    DELETE FROM admin_preview_tokens WHERE user_id = auth.uid() AND consumed_at IS NULL AND kind = 'domination_road_delete';
    v_token := encode(gen_random_bytes(18), 'hex');
    INSERT INTO admin_preview_tokens(user_id, kind, token, payload_hash, normalized_payload)
    VALUES (auth.uid(), 'domination_road_delete', v_token, v_hash, jsonb_build_object('road_id', v_road.id));
  END IF;

  RETURN jsonb_build_object(
    'kind','domination_road_delete',
    'mode', CASE WHEN p_commit THEN 'commit' ELSE 'preview' END,
    'applied', p_commit,
    'road', jsonb_build_object('road_id', v_road.id, 'road_name', v_road.name),
    'deletes', jsonb_build_object('games', v_games, 'game_count', jsonb_array_length(v_games), 'roster_rows', v_roster_rows),
    'destructive_operations', jsonb_build_array(jsonb_build_object(
      'table','domination_roads','action','delete','road_name', v_road.name,
      'games_deleted', jsonb_array_length(v_games), 'roster_rows_deleted', v_roster_rows)),
    'warnings','[]'::jsonb,
    'preview_token', v_token
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_road_export(jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_road_bulk(jsonb, boolean, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_road_delete(jsonb, boolean, text) FROM anon;
