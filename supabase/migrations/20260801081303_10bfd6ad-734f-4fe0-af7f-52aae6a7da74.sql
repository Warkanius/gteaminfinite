DROP FUNCTION IF EXISTS public.admin_road_bulk(jsonb, boolean, text);

CREATE OR REPLACE FUNCTION public.admin_canonical_json(p jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public AS $$ SELECT p $$;

CREATE OR REPLACE FUNCTION public.admin_canonical_json(p jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE jsonb_typeof(p)
    WHEN 'object' THEN coalesce((
      SELECT jsonb_object_agg(k, public.admin_canonical_json(v))
      FROM (SELECT key k, value v FROM jsonb_each(p) ORDER BY key) s), '{}'::jsonb)
    WHEN 'array' THEN coalesce((
      SELECT jsonb_agg(public.admin_canonical_json(e) ORDER BY ord)
      FROM jsonb_array_elements(p) WITH ORDINALITY t(e, ord)), '[]'::jsonb)
    ELSE p
  END
$$;

CREATE OR REPLACE FUNCTION public.admin_canonical_hash(p jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT md5(public.admin_canonical_json(coalesce(p, '{}'::jsonb))::text)
$$;

CREATE OR REPLACE FUNCTION public.admin_error(p_code text, p_message text, p_extra jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '%: % detail=%', p_code, p_message, coalesce(p_extra, '{}'::jsonb)::text;
END $$;

CREATE TABLE IF NOT EXISTS public.content_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  content_type text NOT NULL,
  operation_type text NOT NULL,
  scope_id uuid,
  scope_label text,
  preview_token text,
  payload_hash text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  before_snapshot jsonb,
  after_snapshot jsonb,
  created_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  deleted_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  verification jsonb,
  restored_from uuid REFERENCES public.content_audit_log(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT ON public.content_audit_log TO authenticated;
GRANT ALL ON public.content_audit_log TO service_role;
ALTER TABLE public.content_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read the content audit log" ON public.content_audit_log;
CREATE POLICY "Admins read the content audit log"
  ON public.content_audit_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS content_audit_log_scope_idx
  ON public.content_audit_log (content_type, scope_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.admin_road_fingerprint(p_road_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT md5(
    coalesce((SELECT r.name || '|' || coalesce(r.description, '') || '|' || r.sort_order || '|' || r.is_active
              FROM public.domination_roads r WHERE r.id = p_road_id), 'no-road')
    || '#' ||
    coalesce((SELECT string_agg(x, '|' ORDER BY x) FROM (
      SELECT g.id::text || ':' || g.game_order || ':' || coalesce(g.opponent_name, '') || ':' ||
             g.difficulty_stars || ':' || g.coin_reward || ':' ||
             coalesce(g.opponent_team_id::text, '') || ':' || coalesce(g.pack_reward_id::text, '') || ':' ||
             coalesce((SELECT string_agg(p.player_card_id::text, ',' ORDER BY p.slot)
                       FROM public.domination_game_players p WHERE p.domination_game_id = g.id), '') AS x
      FROM public.domination_games g WHERE g.road_id = p_road_id) s), 'no-games'))
$$;

CREATE OR REPLACE FUNCTION public.admin_road_outside_fingerprint(p_road_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT md5(coalesce((SELECT string_agg(x, '|' ORDER BY x) FROM (
      SELECT g.id::text || ':' || coalesce(g.road_id::text, '') || ':' || g.game_order || ':' ||
             coalesce(g.opponent_name, '') || ':' || g.difficulty_stars || ':' || g.coin_reward || ':' ||
             coalesce((SELECT string_agg(p.player_card_id::text, ',' ORDER BY p.slot)
                       FROM public.domination_game_players p WHERE p.domination_game_id = g.id), '') AS x
      FROM public.domination_games g
      WHERE p_road_id IS NULL OR g.road_id IS DISTINCT FROM p_road_id) s), 'none'))
$$;

CREATE OR REPLACE FUNCTION public.admin_issue_preview_token(p_kind text, p_payload jsonb, p_fingerprint text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_token text;
BEGIN
  DELETE FROM public.admin_preview_tokens
   WHERE user_id = auth.uid() AND consumed_at IS NULL AND kind = p_kind;
  v_token := encode(gen_random_bytes(18), 'hex');
  INSERT INTO public.admin_preview_tokens (user_id, kind, token, payload_hash, normalized_payload, expires_at)
  VALUES (auth.uid(), p_kind, v_token, public.admin_canonical_hash(p_payload),
          jsonb_build_object('payload', public.admin_canonical_json(p_payload),
                             'scope_fingerprint', coalesce(p_fingerprint, '')),
          now() + interval '30 minutes');
  RETURN v_token;
END $$;

CREATE OR REPLACE FUNCTION public.admin_consume_preview_token(
  p_kind text, p_token text, p_payload jsonb, p_fingerprint text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tok public.admin_preview_tokens; v_hash text; v_prev text;
BEGIN
  IF p_token IS NULL OR btrim(p_token) = '' THEN
    PERFORM public.admin_error('PREVIEW_REQUIRED',
      'commit needs the preview_token returned by the matching preview', jsonb_build_object('field', 'preview_token'));
  END IF;
  SELECT * INTO v_tok FROM public.admin_preview_tokens
   WHERE token = p_token AND user_id = auth.uid() AND kind = p_kind FOR UPDATE;
  IF v_tok.id IS NULL THEN
    PERFORM public.admin_error('UNKNOWN_PREVIEW_TOKEN', 'no matching preview for this user; run a new preview',
      jsonb_build_object('field', 'preview_token'));
  END IF;
  IF v_tok.consumed_at IS NOT NULL THEN
    PERFORM public.admin_error('PREVIEW_ALREADY_COMMITTED', 'this preview was already committed; run a new preview',
      jsonb_build_object('field', 'preview_token'));
  END IF;
  IF v_tok.expires_at < now() THEN
    PERFORM public.admin_error('PREVIEW_TOKEN_EXPIRED', 'the preview expired; run a new preview',
      jsonb_build_object('field', 'preview_token', 'expires_at', to_jsonb(v_tok.expires_at)));
  END IF;
  v_hash := public.admin_canonical_hash(p_payload);
  IF v_tok.payload_hash <> v_hash THEN
    PERFORM public.admin_error('PREVIEW_PAYLOAD_MISMATCH',
      'the committed payload differs from the approved preview; nothing was written',
      jsonb_build_object('field', 'payload', 'approved_hash', v_tok.payload_hash, 'submitted_hash', v_hash));
  END IF;
  v_prev := coalesce(v_tok.normalized_payload->>'scope_fingerprint', '');
  IF v_prev <> '' AND p_fingerprint IS NOT NULL AND v_prev <> p_fingerprint THEN
    PERFORM public.admin_error('CONCURRENT_MODIFICATION',
      'the target scope changed after the preview was generated; run a new preview and re-approve',
      jsonb_build_object('field', 'scope', 'preview_fingerprint', v_prev, 'current_fingerprint', p_fingerprint));
  END IF;
  UPDATE public.admin_preview_tokens SET consumed_at = now() WHERE id = v_tok.id;
  RETURN jsonb_build_object('payload_hash', v_hash, 'token_id', v_tok.id);
END $$;

CREATE OR REPLACE FUNCTION public.admin_audit_write(
  p_content_type text, p_operation_type text, p_scope_id uuid, p_scope_label text,
  p_token text, p_payload jsonb, p_before jsonb, p_after jsonb,
  p_created jsonb, p_updated jsonb, p_deleted jsonb, p_warnings jsonb, p_verification jsonb,
  p_restored_from uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.content_audit_log (
    user_id, content_type, operation_type, scope_id, scope_label, preview_token, payload_hash, payload,
    before_snapshot, after_snapshot, created_ids, updated_ids, deleted_ids, warnings, verification, restored_from)
  VALUES (auth.uid(), p_content_type, p_operation_type, p_scope_id, p_scope_label, p_token,
    public.admin_canonical_hash(p_payload), public.admin_canonical_json(coalesce(p_payload, '{}'::jsonb)),
    p_before, p_after, coalesce(p_created, '[]'::jsonb), coalesce(p_updated, '[]'::jsonb),
    coalesce(p_deleted, '[]'::jsonb), coalesce(p_warnings, '[]'::jsonb), p_verification, p_restored_from)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.admin_road_bulk(p_payload jsonb, p_commit boolean DEFAULT false, p_preview_token text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_road public.domination_roads; v_name text; v_new_name text; v_mode text;
  v_token text; v_games jsonb; v_res jsonb;
  v_updates jsonb := '[]'::jsonb; v_creates jsonb := '[]'::jsonb; v_warn jsonb := '[]'::jsonb;
  v_road_id uuid; v_fp text; v_outside_before text; v_outside_after text;
  v_before jsonb; v_after jsonb; v_verify jsonb; v_audit uuid;
  v_expected int; v_count int; v_orders int[]; v_coins bigint; v_dupe int; v_empty int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED: sign in first'; END IF;
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN RAISE EXCEPTION 'FORBIDDEN: admin role required'; END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_PAYLOAD: payload must be an object';
  END IF;

  v_mode := lower(coalesce(p_payload->>'mode', 'merge'));
  IF v_mode NOT IN ('merge', 'replace') THEN
    PERFORM public.admin_road_raise('INVALID_MODE', 'mode must be "merge" or "replace"', NULL, 'mode', v_mode);
  END IF;

  IF p_payload ? 'road_id' AND (p_payload->>'road_id') IS NOT NULL THEN
    SELECT * INTO v_road FROM domination_roads WHERE id = (p_payload->>'road_id')::uuid;
    IF v_road.id IS NULL THEN
      PERFORM public.admin_road_raise('UNKNOWN_ROAD_ID', format('no domination road with id %s', p_payload->>'road_id'),
        NULL, 'road_id', p_payload->>'road_id');
    END IF;
  ELSIF btrim(coalesce(p_payload->>'road_name', '')) <> '' THEN
    SELECT * INTO v_road FROM domination_roads WHERE lower(btrim(name)) = lower(btrim(p_payload->>'road_name'));
  ELSE
    PERFORM public.admin_road_raise('MISSING_ROAD', 'pass road_id or road_name', NULL, 'road_name', NULL);
  END IF;

  IF v_road.id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext('domination_road:' || v_road.id::text));
    PERFORM 1 FROM domination_roads WHERE id = v_road.id FOR UPDATE;
    PERFORM 1 FROM domination_games WHERE road_id = v_road.id FOR UPDATE;
    SELECT * INTO v_road FROM domination_roads WHERE id = v_road.id;
  END IF;

  v_fp := CASE WHEN v_road.id IS NULL THEN 'no-road' ELSE public.admin_road_fingerprint(v_road.id) END;
  v_outside_before := public.admin_road_outside_fingerprint(v_road.id);
  v_before := CASE WHEN v_road.id IS NULL THEN NULL
                   ELSE public.admin_road_export(jsonb_build_object('road_id', v_road.id)) END;

  v_name := coalesce(v_road.name, btrim(p_payload->>'road_name'));
  v_new_name := nullif(btrim(coalesce(p_payload->>'new_road_name', '')), '');
  IF v_new_name IS NOT NULL AND EXISTS (
      SELECT 1 FROM domination_roads WHERE lower(btrim(name)) = lower(v_new_name) AND id IS DISTINCT FROM v_road.id) THEN
    PERFORM public.admin_road_raise('ROAD_NAME_TAKEN', format('another road is already named "%s"', v_new_name),
      NULL, 'new_road_name', v_new_name);
  END IF;
  IF v_road.id IS NULL AND v_mode = 'replace' THEN
    v_warn := v_warn || jsonb_build_array(jsonb_build_object(
      'code', 'NEW_ROAD', 'message', format('road "%s" does not exist yet and will be created', v_name)));
  END IF;

  v_games := coalesce(p_payload->'games', '[]'::jsonb);
  IF jsonb_typeof(v_games) <> 'array' THEN
    PERFORM public.admin_road_raise('INVALID_GAMES', 'games must be an array', NULL, 'games', NULL);
  END IF;

  v_expected := nullif(p_payload->>'expected_game_count', '')::int;
  IF v_expected IS NOT NULL AND v_mode = 'replace' AND v_expected <> jsonb_array_length(v_games) THEN
    PERFORM public.admin_road_raise('EXPECTED_COUNT_MISMATCH',
      format('expected_game_count is %s but %s games were supplied', v_expected, jsonb_array_length(v_games)),
      NULL, 'expected_game_count', v_expected::text);
  END IF;

  IF p_commit THEN
    PERFORM public.admin_consume_preview_token('domination_road_bulk', p_preview_token, p_payload, v_fp);
  END IF;

  IF v_road.id IS NULL THEN
    v_creates := v_creates || jsonb_build_array(jsonb_build_object('table', 'domination_roads', 'road_name', coalesce(v_new_name, v_name)));
    IF p_commit THEN
      INSERT INTO domination_roads (name, slug, description, sort_order, is_active)
      VALUES (coalesce(v_new_name, v_name), public.admin_slugify(coalesce(v_new_name, v_name)),
              p_payload->>'description',
              coalesce((p_payload->>'sort_order')::int, (SELECT coalesce(max(sort_order), 0) + 1 FROM domination_roads)),
              coalesce((p_payload->>'is_active')::boolean, true))
      RETURNING * INTO v_road;
      v_name := v_road.name;
    END IF;
  ELSE
    IF v_new_name IS NOT NULL OR p_payload ? 'description' OR p_payload ? 'sort_order' OR p_payload ? 'is_active' THEN
      v_updates := v_updates || jsonb_build_array(jsonb_build_object(
        'table', 'domination_roads', 'road_id', v_road.id,
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
      v_name := v_road.name;
    END IF;
  END IF;
  v_road_id := v_road.id;

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
    v_res := jsonb_build_object('operations', '[]'::jsonb, 'destructive_operations', '[]'::jsonb, 'warnings', '[]'::jsonb);
  END IF;

  IF p_commit THEN
    SELECT count(*), array_agg(game_order ORDER BY game_order), coalesce(sum(coin_reward), 0)
      INTO v_count, v_orders, v_coins
      FROM domination_games WHERE road_id = v_road_id;

    SELECT count(*) INTO v_dupe FROM (
      SELECT game_order FROM domination_games WHERE road_id = v_road_id
      GROUP BY game_order HAVING count(*) > 1) d;
    IF v_dupe > 0 THEN
      PERFORM public.admin_road_raise('FINAL_VERIFICATION_FAILED',
        format('%s duplicated game_order values remain on the road', v_dupe), NULL, 'game_order', NULL);
    END IF;

    IF v_expected IS NOT NULL AND v_mode = 'replace' AND v_count <> v_expected THEN
      PERFORM public.admin_road_raise('FINAL_VERIFICATION_FAILED',
        format('road ended with %s games but %s were expected', v_count, v_expected),
        NULL, 'expected_game_count', v_expected::text);
    END IF;

    v_outside_after := public.admin_road_outside_fingerprint(v_road_id);
    IF v_outside_before <> v_outside_after THEN
      PERFORM public.admin_road_raise('FINAL_VERIFICATION_FAILED',
        'games on other roads changed during this import; rolling back', NULL, 'scope', NULL);
    END IF;

    SELECT count(*) INTO v_empty FROM domination_games g
     WHERE g.road_id = v_road_id
       AND NOT EXISTS (SELECT 1 FROM domination_game_players p WHERE p.domination_game_id = g.id);

    v_after := public.admin_road_export(jsonb_build_object('road_id', v_road_id));
    v_verify := jsonb_build_object(
      'game_count', v_count, 'game_orders', to_jsonb(v_orders), 'total_coin_reward', v_coins,
      'contiguous_orders', (v_orders IS NOT NULL AND v_orders[1] = 1 AND v_orders[array_length(v_orders, 1)] = v_count),
      'duplicate_orders', v_dupe, 'games_with_empty_roster', v_empty,
      'unrelated_roads_unchanged', true,
      'rosters', coalesce((SELECT jsonb_agg(jsonb_build_object('game_order', g.game_order, 'roster_size',
                    (SELECT count(*) FROM domination_game_players p WHERE p.domination_game_id = g.id))
                    ORDER BY g.game_order) FROM domination_games g WHERE g.road_id = v_road_id), '[]'::jsonb));

    v_audit := public.admin_audit_write('domination_road',
      CASE WHEN v_mode = 'replace' THEN 'replace' ELSE 'merge' END,
      v_road_id, coalesce(v_new_name, v_name), p_preview_token, p_payload, v_before, v_after,
      v_creates || coalesce(v_res->'operations', '[]'::jsonb), v_updates,
      coalesce(v_res->'destructive_operations', '[]'::jsonb),
      v_warn || coalesce(v_res->'warnings', '[]'::jsonb), v_verify,
      nullif(p_payload->>'restored_from', '')::uuid);
  ELSE
    v_token := public.admin_issue_preview_token('domination_road_bulk', p_payload, v_fp);
  END IF;

  RETURN jsonb_build_object(
    'kind', 'domination_road_bulk',
    'mode', CASE WHEN p_commit THEN 'commit' ELSE 'preview' END,
    'applied', p_commit,
    'road', jsonb_build_object('road_id', v_road_id, 'road_name', coalesce(v_new_name, v_name), 'import_mode', v_mode),
    'road_creates', v_creates,
    'road_updates', v_updates,
    'game_operations', coalesce(v_res->'operations', '[]'::jsonb),
    'destructive_operations', coalesce(v_res->'destructive_operations', '[]'::jsonb),
    'warnings', v_warn || coalesce(v_res->'warnings', '[]'::jsonb),
    'scope_fingerprint', v_fp,
    'payload_hash', public.admin_canonical_hash(p_payload),
    'before_snapshot', CASE WHEN p_commit THEN v_before ELSE NULL END,
    'final_road', v_after,
    'verification', v_verify,
    'operation_id', v_audit,
    'preview_token', v_token
  );
END $$;

CREATE OR REPLACE FUNCTION public.admin_content_restore_payload(p_audit_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.content_audit_log; v_snap jsonb; v_games jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED: sign in first'; END IF;
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN RAISE EXCEPTION 'FORBIDDEN: admin role required'; END IF;
  SELECT * INTO v_row FROM public.content_audit_log WHERE id = p_audit_id;
  IF v_row.id IS NULL THEN
    PERFORM public.admin_error('UNKNOWN_OPERATION', 'no audit record with that id', jsonb_build_object('field', 'operation_id'));
  END IF;
  IF v_row.content_type <> 'domination_road' THEN
    PERFORM public.admin_error('RESTORE_UNSUPPORTED',
      format('restore is not implemented for content type "%s" yet', v_row.content_type),
      jsonb_build_object('field', 'content_type'));
  END IF;
  v_snap := v_row.before_snapshot;
  IF v_snap IS NULL THEN
    PERFORM public.admin_error('NO_SNAPSHOT', 'this operation created the road, so there is no earlier state to restore',
      jsonb_build_object('field', 'before_snapshot'));
  END IF;
  v_games := coalesce(v_snap->'games', '[]'::jsonb);
  IF jsonb_array_length(v_games) = 0 THEN
    PERFORM public.admin_error('NO_SNAPSHOT', 'the recorded earlier state has no games; delete the road instead',
      jsonb_build_object('field', 'games'));
  END IF;
  RETURN jsonb_build_object(
    'road_id', coalesce(v_snap->>'road_id', v_row.scope_id::text),
    'road_name', coalesce(v_snap->>'road_name', v_row.scope_label),
    'mode', 'replace',
    'expected_game_count', jsonb_array_length(v_games),
    'restored_from', p_audit_id,
    'games', v_games);
END $$;