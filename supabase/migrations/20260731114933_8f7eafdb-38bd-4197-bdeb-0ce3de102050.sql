CREATE OR REPLACE FUNCTION public.admin_apply_batch(
  p_payload jsonb,
  p_commit boolean DEFAULT false,
  p_preview_token text DEFAULT NULL,
  p_kind text DEFAULT 'batch')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_groups text[] := ARRAY['players','teams','runs','domination_roads','domination_games','packs','locker_codes','challenges','dynamic_duos','evo_paths','storylines'];
  v_group text; v_item jsonb; v_items jsonb; v_res jsonb; v_op jsonb;
  v_refs jsonb := '{}'::jsonb;
  v_creates jsonb := '[]'::jsonb;
  v_updates jsonb := '[]'::jsonb;
  v_deletes jsonb := '[]'::jsonb;
  v_repl jsonb := '[]'::jsonb;
  v_warn jsonb := '[]'::jsonb;
  v_resolved jsonb := '[]'::jsonb;
  v_results jsonb := '[]'::jsonb;
  v_ids jsonb := '{}'::jsonb;
  v_hash text; v_token text; v_row public.admin_preview_tokens;
  v_kind text; v_idx int; v_action text; v_tmp text; v_road text; v_name text; v_count int := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED: sign in first'; END IF;
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN RAISE EXCEPTION 'FORBIDDEN: admin role required'; END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN RAISE EXCEPTION 'INVALID_PAYLOAD: payload must be an object'; END IF;

  v_hash := md5(p_payload::text);

  IF p_commit THEN
    IF p_preview_token IS NULL THEN
      RAISE EXCEPTION 'PREVIEW_REQUIRED: commit needs the preview_token returned by the matching preview';
    END IF;
    SELECT * INTO v_row FROM admin_preview_tokens WHERE token = p_preview_token AND user_id = auth.uid();
    IF v_row.id IS NULL THEN RAISE EXCEPTION 'UNKNOWN_PREVIEW_TOKEN: run a preview again'; END IF;
    IF v_row.consumed_at IS NOT NULL THEN RAISE EXCEPTION 'PREVIEW_ALREADY_COMMITTED: run a new preview'; END IF;
    IF v_row.expires_at < now() THEN RAISE EXCEPTION 'PREVIEW_EXPIRED: run a new preview'; END IF;
    IF v_row.payload_hash <> v_hash THEN
      RAISE EXCEPTION 'PREVIEW_MISMATCH: payload does not match the approved preview (expected hash %, got %)', v_row.payload_hash, v_hash;
    END IF;
  END IF;

  FOREACH v_group IN ARRAY v_groups LOOP
    v_items := p_payload->v_group;
    IF v_items IS NULL THEN CONTINUE; END IF;
    IF jsonb_typeof(v_items) <> 'array' THEN RAISE EXCEPTION 'INVALID_GROUP: "%" must be an array', v_group; END IF;
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_items) LOOP
      v_tmp := v_item->>'temp_ref';
      IF v_tmp IS NOT NULL THEN
        IF v_refs ? v_tmp THEN RAISE EXCEPTION 'DUPLICATE_TEMP_REF: "%"', v_tmp; END IF;
        v_refs := v_refs || jsonb_build_object(v_tmp, 'pending');
      END IF;
    END LOOP;
  END LOOP;

  FOREACH v_group IN ARRAY v_groups LOOP
    v_items := p_payload->v_group;
    IF v_items IS NULL THEN CONTINUE; END IF;
    v_idx := 0;
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_items) LOOP
      v_idx := v_idx + 1;
      v_count := v_count + 1;
      v_tmp := v_item->>'temp_ref';
      v_action := lower(coalesce(v_item->>'action','upsert'));
      IF v_action NOT IN ('create','update','upsert','replace') THEN
        RAISE EXCEPTION 'INVALID_ACTION: "%" in %[%] (use create|update|upsert|replace)', v_action, v_group, v_idx;
      END IF;
      v_item := public.admin_substitute_refs(v_item - 'temp_ref', v_refs);

      IF v_group = 'teams' AND v_item ? 'team_id' AND NOT (v_item ? 'name') THEN
        SELECT name INTO v_name FROM teams WHERE id = (v_item->>'team_id')::uuid;
        IF v_name IS NULL THEN RAISE EXCEPTION 'UNKNOWN_TEAM_ID: %', v_item->>'team_id'; END IF;
        v_item := v_item || jsonb_build_object('name', v_name);
      ELSIF v_group = 'runs' AND v_item ? 'run_id' AND NOT (v_item ? 'name') THEN
        SELECT name INTO v_name FROM runs WHERE id = (v_item->>'run_id')::uuid;
        IF v_name IS NULL THEN RAISE EXCEPTION 'UNKNOWN_RUN_ID: %', v_item->>'run_id'; END IF;
        v_item := v_item || jsonb_build_object('name', v_name);
      ELSIF v_group = 'packs' AND v_item ? 'pack_id' AND NOT (v_item ? 'name') THEN
        SELECT name INTO v_name FROM packs WHERE id = (v_item->>'pack_id')::uuid;
        IF v_name IS NULL THEN RAISE EXCEPTION 'UNKNOWN_PACK_ID: %', v_item->>'pack_id'; END IF;
        v_item := v_item || jsonb_build_object('name', v_name);
      ELSIF v_group = 'challenges' AND v_item ? 'challenge_id' AND NOT (v_item ? 'name') THEN
        SELECT name INTO v_name FROM challenges WHERE id = (v_item->>'challenge_id')::uuid;
        IF v_name IS NULL THEN RAISE EXCEPTION 'UNKNOWN_CHALLENGE_ID: %', v_item->>'challenge_id'; END IF;
        v_item := v_item || jsonb_build_object('name', v_name);
      ELSIF v_group = 'domination_games' AND v_item ? 'domination_game_id' AND NOT (v_item ? 'opponent_name') THEN
        SELECT road_name, opponent_name INTO v_road, v_name FROM domination_games WHERE id = (v_item->>'domination_game_id')::uuid;
        IF v_name IS NULL THEN RAISE EXCEPTION 'UNKNOWN_DOMINATION_GAME_ID: %', v_item->>'domination_game_id'; END IF;
        v_item := v_item || jsonb_build_object('road_name', v_road, 'opponent_name', v_name);
      END IF;

      IF v_group IN ('teams','runs') AND v_item ? 'roster'
         AND NOT coalesce((v_item->>'replace_roster')::boolean, v_action = 'replace') THEN
        v_warn := v_warn || jsonb_build_object('group', v_group, 'index', v_idx, 'code','ROSTER_IGNORED',
          'message','roster was ignored because replace_roster was not true (a supplied roster always replaces the whole roster)');
        v_item := v_item - 'roster';
      END IF;
      v_item := v_item - 'replace_roster' - 'action';

      IF v_group = 'players' THEN
        v_res := public.admin_apply_player(v_item || jsonb_build_object('action', v_action), p_commit);
      ELSIF v_group IN ('domination_roads','evo_paths','storylines') THEN
        v_kind := CASE v_group WHEN 'domination_roads' THEN 'domination_road' WHEN 'evo_paths' THEN 'evo_path' ELSE 'storyline' END;
        v_res := public.admin_apply_extra(v_kind, v_item, p_commit);
      ELSE
        v_kind := CASE v_group
          WHEN 'teams' THEN 'team' WHEN 'runs' THEN 'run' WHEN 'domination_games' THEN 'domination_game'
          WHEN 'packs' THEN 'pack' WHEN 'locker_codes' THEN 'locker_code' WHEN 'challenges' THEN 'challenge'
          ELSE 'dynamic_duo' END;
        v_res := public.admin_apply_content(v_kind, v_item, p_commit);
      END IF;

      IF v_tmp IS NOT NULL THEN
        v_refs := v_refs || jsonb_build_object(v_tmp, coalesce(v_res->>'id', v_res->>'player_id', 'pending'));
      END IF;

      v_results := v_results || jsonb_build_object('group', v_group, 'index', v_idx, 'result', v_res);
      IF coalesce(v_res->>'id', v_res->>'player_id') IS NOT NULL THEN
        v_ids := v_ids || jsonb_build_object(v_group || '[' || v_idx || ']', coalesce(v_res->>'id', v_res->>'player_id'));
      END IF;

      FOR v_op IN SELECT * FROM jsonb_array_elements(coalesce(v_res->'operations','[]'::jsonb)) LOOP
        IF v_op->>'action' = 'insert' THEN
          v_creates := v_creates || jsonb_build_object('group', v_group, 'index', v_idx,
            'table', v_op->>'table', 'match', v_op->>'match', 'fields', v_op->'fields');
        ELSE
          v_updates := v_updates || jsonb_build_object('group', v_group, 'index', v_idx,
            'table', v_op->>'table', 'id', v_op->>'id', 'match', v_op->>'match',
            'field_changes', coalesce(v_op->'field_changes','[]'::jsonb), 'fields', v_op->'fields');
        END IF;
      END LOOP;
      FOR v_op IN SELECT * FROM jsonb_array_elements(coalesce(v_res->'destructive', v_res->'destructive_operations', '[]'::jsonb)) LOOP
        IF v_op->>'action' = 'delete' THEN
          v_deletes := v_deletes || (v_op || jsonb_build_object('group', v_group, 'index', v_idx));
        ELSE
          v_repl := v_repl || (v_op || jsonb_build_object('group', v_group, 'index', v_idx));
        END IF;
      END LOOP;
      IF v_res ? 'resolved_references' THEN
        v_resolved := v_resolved || jsonb_build_object('group', v_group, 'index', v_idx, 'references', v_res->'resolved_references');
      END IF;
      IF v_res ? 'warnings' AND jsonb_typeof(v_res->'warnings') = 'array' THEN
        v_warn := v_warn || (v_res->'warnings');
      END IF;
    END LOOP;
  END LOOP;

  IF v_count = 0 THEN RAISE EXCEPTION 'EMPTY_BATCH: supply at least one item in one of %', array_to_string(v_groups, ', '); END IF;

  IF NOT p_commit THEN
    DELETE FROM admin_preview_tokens WHERE user_id = auth.uid() AND consumed_at IS NULL;
    v_token := encode(gen_random_bytes(18), 'hex');
    INSERT INTO admin_preview_tokens(user_id, kind, token, payload_hash, normalized_payload)
    VALUES (auth.uid(), p_kind, v_token, v_hash, p_payload);
  ELSE
    UPDATE admin_preview_tokens SET consumed_at = now() WHERE token = p_preview_token;
    v_token := NULL;
  END IF;

  RETURN jsonb_build_object(
    'kind', p_kind, 'mode', CASE WHEN p_commit THEN 'commit' ELSE 'preview' END,
    'applied', p_commit, 'item_count', v_count,
    'creates', v_creates, 'updates', v_updates, 'deletes', v_deletes, 'replacements', v_repl,
    'warnings', v_warn, 'resolved_references', v_resolved,
    'created_ids', v_ids, 'temp_refs', v_refs, 'results', v_results,
    'normalized_payload', p_payload, 'payload_hash', v_hash, 'preview_token', v_token);
END $$;

REVOKE ALL ON FUNCTION public.admin_apply_batch(jsonb, boolean, text, text) FROM anon;