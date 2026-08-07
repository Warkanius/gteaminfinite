-- ============================================================================
-- 1. Pending same-batch reference helpers
-- ============================================================================

-- Removes every unresolved same-batch reference marker so a preview can still
-- validate and classify the item it is attached to. The stripped references are
-- reported separately (admin_pending_refs) instead of silently turning the item
-- into a "create".
CREATE OR REPLACE FUNCTION public.admin_strip_pending(p_item jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_out jsonb := '{}'::jsonb; v_k text; v_v jsonb; v_arr jsonb; v_el jsonb;
BEGIN
  IF p_item IS NULL OR jsonb_typeof(p_item) <> 'object' THEN RETURN p_item; END IF;
  FOR v_k, v_v IN SELECT key, value FROM jsonb_each(p_item) LOOP
    CONTINUE WHEN v_k ~ '_pending$';
    IF jsonb_typeof(v_v) = 'object' THEN
      v_out := v_out || jsonb_build_object(v_k, public.admin_strip_pending(v_v));
    ELSIF jsonb_typeof(v_v) = 'array' THEN
      v_arr := '[]'::jsonb;
      FOR v_el IN SELECT * FROM jsonb_array_elements(v_v) LOOP
        IF jsonb_typeof(v_el) = 'object' THEN
          v_arr := v_arr || jsonb_build_array(public.admin_strip_pending(v_el));
        ELSE
          v_arr := v_arr || jsonb_build_array(v_el);
        END IF;
      END LOOP;
      v_out := v_out || jsonb_build_object(v_k, v_arr);
    ELSE
      v_out := v_out || jsonb_build_object(v_k, v_v);
    END IF;
  END LOOP;
  RETURN v_out;
END $function$;

-- True when the pending reference decides WHICH record the item is, so the item
-- cannot be matched against an existing row during a zero-write preview.
CREATE OR REPLACE FUNCTION public.admin_identity_pending(p_group text, p_item jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  v_keys text[];
BEGIN
  v_keys := CASE p_group
    WHEN 'evo_paths' THEN ARRAY['player_card_id_pending','player_id_pending','source_pending']
    WHEN 'collection_requirements' THEN ARRAY['collection_id_pending','player_card_id_pending','player_id_pending']
    ELSE ARRAY[]::text[]
  END;
  IF array_length(v_keys, 1) IS NULL THEN RETURN false; END IF;
  RETURN EXISTS (SELECT 1 FROM unnest(v_keys) k WHERE p_item ? k);
END $function$;

-- ============================================================================
-- 2. Whole-path evolution replacement
-- ============================================================================

-- Explicit replacement semantics for the complete evolution path of ONE source
-- player card:
--   * player_card_id (or any accepted card reference) identifies the source
--   * `steps` is the complete, authoritative ordered step list
--   * existing steps are matched by immutable evo_path_id when supplied, else by
--     step_order, and UPDATED in place (ids are never recycled)
--   * leftover existing steps are DELETED together with their objectives and
--     materialized playable versions
--   * objectives and the resulting version of each step are replaced atomically
--     by admin_apply_evo
--   * duplicate step_order values in the payload are rejected
--   * everything happens in the caller's transaction, so any failure restores
--     the previous path
CREATE OR REPLACE FUNCTION public.admin_apply_evo_path(p_item jsonb, p_commit boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_src uuid; v_steps jsonb; v_step jsonb; v_order int; v_id uuid;
  v_existing jsonb := '[]'::jsonb; v_keep uuid[] := '{}'; v_orders int[] := '{}';
  v_ops jsonb := '[]'::jsonb; v_destr jsonb := '[]'::jsonb; v_warn jsonb := '[]'::jsonb;
  v_results jsonb := '[]'::jsonb; v_res jsonb; v_name text; v_idx int := 0;
  v_stale record; v_before jsonb; v_step_ids jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.admin_require_admin();

  IF p_item ? 'player_card_id' OR p_item ? 'source' OR p_item ? 'player' OR p_item ? 'player_name' THEN
    v_src := public.admin_resolve_card(coalesce(p_item->'source', p_item->'player',
      CASE WHEN p_item ? 'player_card_id'
           THEN jsonb_build_object('player_card_id', p_item->>'player_card_id')
           ELSE jsonb_build_object('name', p_item->>'player_name') END));
  END IF;
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'MISSING_SOURCE_CARD: replace_path needs the source card (player_card_id, card_key, or name + distinguishing fields)';
  END IF;
  SELECT name INTO v_name FROM player_cards WHERE id = v_src;

  v_steps := coalesce(p_item->'steps', '[]'::jsonb);
  IF jsonb_typeof(v_steps) <> 'array' THEN
    RAISE EXCEPTION 'INVALID_PAYLOAD: steps must be an array of evolution steps';
  END IF;
  IF jsonb_array_length(v_steps) = 0 THEN
    RAISE EXCEPTION 'EMPTY_EVO_PATH: replace_path with zero steps would delete the whole path; use delete_entity explicitly instead';
  END IF;

  -- current path, before anything changes
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'step_order', step_order,
           'from_tier_id', from_tier_id, 'to_tier_id', to_tier_id,
           'objective_count', (SELECT count(*) FROM evo_objectives o WHERE o.evo_path_id = p.id),
           'version_id', (SELECT v.id FROM evo_card_versions v WHERE v.evo_path_id = p.id))
           ORDER BY step_order), '[]'::jsonb)
    INTO v_existing FROM evo_paths p WHERE player_card_id = v_src;

  -- classify + apply every submitted step
  FOR v_step IN SELECT * FROM jsonb_array_elements(v_steps) LOOP
    v_idx := v_idx + 1;
    v_order := coalesce((v_step->>'step_order')::int, v_idx);
    IF v_order = ANY(v_orders) THEN
      RAISE EXCEPTION 'DUPLICATE_STEP_ORDER: step_order % appears twice in this path detail=%', v_order,
        jsonb_build_object('player_card_id', v_src, 'step_order', v_order)::text;
    END IF;
    v_orders := v_orders || v_order;

    v_id := nullif(coalesce(v_step->>'evo_path_id', v_step->>'id'), '')::uuid;
    IF v_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM evo_paths WHERE id = v_id AND player_card_id = v_src) THEN
      RAISE EXCEPTION 'UNKNOWN_EVO_STEP_ID: % is not a step of this card detail=%', v_id,
        jsonb_build_object('player_card_id', v_src, 'evo_path_id', v_id)::text;
    END IF;
    IF v_id IS NULL THEN
      SELECT id INTO v_id FROM evo_paths WHERE player_card_id = v_src AND step_order = v_order;
    END IF;
    IF v_id IS NOT NULL THEN v_keep := v_keep || v_id; END IF;

    v_res := public.admin_apply_evo(
      (v_step - 'id' - 'evo_path_id')
        || jsonb_build_object('player_card_id', v_src, 'step_order', v_order,
             'action', CASE WHEN v_id IS NULL THEN 'create' ELSE 'update' END)
        || CASE WHEN v_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('evo_path_id', v_id) END,
      p_commit);

    v_results := v_results || jsonb_build_array(v_res);
    v_ops := v_ops || coalesce(v_res->'operations','[]'::jsonb);
    v_destr := v_destr || coalesce(v_res->'destructive','[]'::jsonb);
    v_warn := v_warn || coalesce(v_res->'warnings','[]'::jsonb);
    IF v_res->>'id' IS NOT NULL THEN
      v_step_ids := v_step_ids || jsonb_build_array(jsonb_build_object(
        'evo_path_id', v_res->>'id', 'step_order', v_order, 'action', v_res->>'action'));
    END IF;
  END LOOP;

  -- stale steps: present in the database, absent from the authoritative payload
  FOR v_stale IN
    SELECT p.id, p.step_order,
           (SELECT count(*) FROM evo_objectives o WHERE o.evo_path_id = p.id) AS objectives,
           (SELECT count(*) FROM evo_card_versions v WHERE v.evo_path_id = p.id) AS versions
      FROM evo_paths p
     WHERE p.player_card_id = v_src AND NOT (p.id = ANY(v_keep))
     ORDER BY p.step_order
  LOOP
    v_destr := v_destr || jsonb_build_object(
      'action','delete','label','DESTRUCTIVE_DELETE','table','evo_paths','id', v_stale.id,
      'match', format('%s step %s', v_name, v_stale.step_order),
      'message', format('step %s is not part of the replacement path and is removed with its %s objective(s) and %s playable version(s)',
        v_stale.step_order, v_stale.objectives, v_stale.versions),
      'cascades', jsonb_build_object('evo_objectives', v_stale.objectives, 'evo_card_versions', v_stale.versions));
    IF p_commit THEN
      DELETE FROM evo_paths WHERE id = v_stale.id;
    END IF;
  END LOOP;

  -- contiguity check on the final shape
  IF EXISTS (
    SELECT 1 FROM unnest(v_orders) o
     WHERE o <> ALL (SELECT generate_series(1, array_length(v_orders,1)))
  ) THEN
    v_warn := v_warn || jsonb_build_object('code','EVO_STEP_ORDER_GAP',
      'message', format('step orders %s are not 1..%s: the game shows steps in step_order sequence',
        array_to_string(v_orders, ','), array_length(v_orders,1)));
  END IF;

  IF p_commit THEN
    PERFORM 1 FROM evo_paths WHERE player_card_id = v_src
      GROUP BY step_order HAVING count(*) > 1;
    IF FOUND THEN
      RAISE EXCEPTION 'DUPLICATE_EVO_STEP_AFTER_REPLACE: the card ended up with two steps sharing one step_order detail=%',
        jsonb_build_object('player_card_id', v_src)::text;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'kind','evo_path_replacement', 'id', v_src, 'match', format('%s evolution path', v_name),
    'action','replace', 'applied', p_commit,
    'player_card_id', v_src,
    'before', v_existing, 'steps', v_step_ids, 'step_results', v_results,
    'operations', v_ops, 'destructive', v_destr, 'warnings', v_warn,
    'resolved_references', jsonb_build_object('player_card_id', v_src));
END $function$;

-- ============================================================================
-- 3. Batch: parents first, honest preview classification, replace_path routing
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_apply_batch(p_payload jsonb, p_commit boolean DEFAULT false, p_preview_token text DEFAULT NULL::text, p_kind text DEFAULT 'batch'::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  -- Parents strictly before children: a group may only reference groups that
  -- appear earlier, so a zero-write preview resolves real ids instead of
  -- guessing. release_bundles is first because every content item links to it.
  v_groups text[] := ARRAY['release_bundles','gem_tiers','badges','signature_traits','players',
    'collections','sub_collections','collection_requirements','teams','packs','evo_paths',
    'gem_tasks','runs','domination_roads','domination_games','challenges','locker_codes',
    'dynamic_duos','storylines','location_accounts','social_posts'];
  v_group text; v_item jsonb; v_items jsonb; v_res jsonb; v_op jsonb;
  v_refs jsonb := '{}'::jsonb;
  v_creates jsonb := '[]'::jsonb; v_updates jsonb := '[]'::jsonb; v_deletes jsonb := '[]'::jsonb;
  v_repl jsonb := '[]'::jsonb; v_warn jsonb := '[]'::jsonb; v_resolved jsonb := '[]'::jsonb;
  v_results jsonb := '[]'::jsonb; v_ids jsonb := '{}'::jsonb;
  v_hash text; v_token text; v_row public.admin_preview_tokens;
  v_kind text; v_idx int; v_action text; v_tmp text; v_road text; v_name text; v_count int := 0;
  v_audit uuid; v_created_ids jsonb := '[]'::jsonb; v_updated_ids jsonb := '[]'::jsonb; v_deleted_ids jsonb := '[]'::jsonb;
  v_pending jsonb;
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

  FOR v_group IN SELECT jsonb_object_keys(p_payload) LOOP
    IF NOT (v_group = ANY(v_groups)) AND NOT (v_group = ANY(ARRAY['notes','release','expected_counts'])) THEN
      RAISE EXCEPTION 'UNKNOWN_GROUP: "%" is not a supported group detail=%', v_group,
        jsonb_build_object('supported_groups', to_jsonb(v_groups))::text;
    END IF;
  END LOOP;

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
      IF v_action NOT IN ('create','update','upsert','replace','replace_path') THEN
        RAISE EXCEPTION 'INVALID_ACTION: "%" in %[%] (use create|update|upsert|replace|replace_path)', v_action, v_group, v_idx;
      END IF;
      IF v_action = 'replace_path' AND v_group <> 'evo_paths' THEN
        RAISE EXCEPTION 'INVALID_ACTION: replace_path is only supported for evo_paths, not %', v_group;
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

      -- Same-batch references that cannot resolve yet.
      -- Identity-deciding reference  -> the item can only be a create.
      -- Plain link reference         -> strip the marker, still validate and
      --                                 classify the item for real, and report
      --                                 the deferred link in the plan.
      v_pending := public.admin_pending_refs(v_item);
      IF NOT p_commit AND v_pending <> '{}'::jsonb THEN
        IF public.admin_identity_pending(v_group, v_item) THEN
          v_res := jsonb_build_object(
            'pending_same_batch_reference', true,
            'pending_references', v_pending,
            'note', 'This item is identified by another item created in the same batch, so it has no id during a zero-write preview. It is fully validated on commit, when the reference resolves inside the transaction.');
          v_results := v_results || jsonb_build_object('group', v_group, 'index', v_idx, 'result', v_res);
          v_creates := v_creates || jsonb_build_object('group', v_group, 'index', v_idx,
            'table', v_group,
            'match', coalesce(v_item->>'name', v_item->>'code', v_item->>'player_name', 'same-batch reference'),
            'fields', v_item,
            'pending_references', v_pending);
          v_resolved := v_resolved || jsonb_build_object('group', v_group, 'index', v_idx,
            'references', v_pending);
          CONTINUE;
        END IF;
        v_item := public.admin_strip_pending(v_item);
        v_warn := v_warn || jsonb_build_object('group', v_group, 'index', v_idx,
          'code','DEFERRED_SAME_BATCH_LINK',
          'message','one or more links point at records created in the same release, so they are attached during the commit transaction; every other field is validated and classified now',
          'deferred_references', v_pending);
        v_resolved := v_resolved || jsonb_build_object('group', v_group, 'index', v_idx,
          'deferred_references', v_pending);
      END IF;

      IF v_group = 'players' THEN
        v_res := public.admin_apply_player(v_item || jsonb_build_object('action', v_action), p_commit);
      ELSIF v_group = 'evo_paths' THEN
        IF v_action = 'replace_path' OR v_item ? 'steps' THEN
          v_res := public.admin_apply_evo_path(v_item, p_commit);
        ELSE
          v_res := public.admin_apply_evo(v_item || jsonb_build_object('action', v_action), p_commit);
        END IF;
      ELSIF v_group IN ('domination_roads','storylines') THEN
        v_kind := CASE v_group WHEN 'domination_roads' THEN 'domination_road' ELSE 'storyline' END;
        v_res := public.admin_apply_extra(v_kind, v_item, p_commit);
      ELSIF v_group IN ('gem_tiers','badges','signature_traits','collections','sub_collections',
                        'collection_requirements','gem_tasks','location_accounts','social_posts','release_bundles') THEN
        v_kind := CASE v_group
          WHEN 'gem_tiers' THEN 'gem_tier' WHEN 'badges' THEN 'badge'
          WHEN 'signature_traits' THEN 'signature_trait' WHEN 'collections' THEN 'collection'
          WHEN 'sub_collections' THEN 'sub_collection' WHEN 'collection_requirements' THEN 'collection'
          WHEN 'gem_tasks' THEN 'gem_task' WHEN 'location_accounts' THEN 'location_account'
          WHEN 'social_posts' THEN 'social_post' ELSE 'release_bundle' END;
        v_res := public.admin_apply_entity(v_kind, v_item || jsonb_build_object('action', v_action), p_commit);
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
        IF v_op->>'action' IN ('insert','create') THEN
          v_creates := v_creates || jsonb_build_object('group', v_group, 'index', v_idx,
            'table', v_op->>'table', 'match', v_op->>'match', 'fields', v_op->'fields');
          IF v_op->>'id' IS NOT NULL THEN
            v_created_ids := v_created_ids || jsonb_build_object('table', v_op->>'table', 'id', v_op->>'id', 'match', v_op->>'match');
          END IF;
        ELSE
          v_updates := v_updates || jsonb_build_object('group', v_group, 'index', v_idx,
            'table', v_op->>'table', 'id', v_op->>'id', 'match', v_op->>'match',
            'field_changes', coalesce(v_op->'field_changes','[]'::jsonb), 'fields', v_op->'fields');
          IF v_op->>'id' IS NOT NULL THEN
            v_updated_ids := v_updated_ids || jsonb_build_object('table', v_op->>'table', 'id', v_op->>'id', 'match', v_op->>'match');
          END IF;
        END IF;
      END LOOP;
      FOR v_op IN SELECT * FROM jsonb_array_elements(coalesce(v_res->'destructive', v_res->'destructive_operations', '[]'::jsonb)) LOOP
        IF v_op->>'action' = 'delete' THEN
          v_deletes := v_deletes || (v_op || jsonb_build_object('group', v_group, 'index', v_idx));
          IF v_op->>'id' IS NOT NULL THEN
            v_deleted_ids := v_deleted_ids || jsonb_build_object('table', v_op->>'table', 'id', v_op->>'id', 'match', v_op->>'match');
          END IF;
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
    v_audit := public.admin_audit_write(p_kind, 'batch', NULL,
      coalesce(p_payload#>>'{release,name}', p_kind), p_preview_token, p_payload, NULL, NULL,
      v_created_ids, v_updated_ids, v_deleted_ids, v_warn,
      jsonb_build_object('item_count', v_count,
        'created', jsonb_array_length(v_created_ids),
        'updated', jsonb_array_length(v_updated_ids),
        'deleted', jsonb_array_length(v_deleted_ids)));
  END IF;

  RETURN jsonb_build_object(
    'kind', p_kind, 'mode', CASE WHEN p_commit THEN 'commit' ELSE 'preview' END,
    'applied', p_commit, 'item_count', v_count,
    'creates', v_creates, 'updates', v_updates, 'deletes', v_deletes, 'replacements', v_repl,
    'warnings', v_warn, 'resolved_references', v_resolved,
    'created_ids', v_ids, 'temp_refs', v_refs, 'results', v_results,
    'audit_operation_id', v_audit,
    'normalized_payload', p_payload, 'payload_hash', v_hash, 'preview_token', v_token);
END $function$;

REVOKE ALL ON FUNCTION public.admin_apply_evo_path(jsonb, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_apply_evo_path(jsonb, boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_strip_pending(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_strip_pending(jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.admin_identity_pending(text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_identity_pending(text, jsonb) TO authenticated;