CREATE OR REPLACE FUNCTION public.admin_api_job_commit(p_job_id uuid, p_preview_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job public.admin_api_scheduled_jobs;
  v_result jsonb;
BEGIN
  SELECT * INTO v_job FROM public.admin_api_scheduled_jobs WHERE id = p_job_id FOR UPDATE;
  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'UNKNOWN_SCHEDULED_JOB: no scheduled job %', p_job_id;
  END IF;
  IF v_job.executed_at IS NOT NULL THEN
    RAISE EXCEPTION 'JOB_ALREADY_EXECUTED: job % already executed at %', p_job_id, v_job.executed_at;
  END IF;
  IF NOT public.has_role(v_job.admin_id, 'admin') THEN
    RAISE EXCEPTION 'FORBIDDEN: the approving user is no longer an admin';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_job.admin_id::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_job.admin_id, 'role', 'authenticated')::text, true);

  v_result := public.admin_apply_batch(
    p_payload => v_job.canonical_payload,
    p_commit => true,
    p_preview_token => p_preview_token,
    p_kind => v_job.operation
  );
  RETURN v_result;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_api_job_preview(p_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_job public.admin_api_scheduled_jobs;
  v_result jsonb;
BEGIN
  SELECT * INTO v_job FROM public.admin_api_scheduled_jobs WHERE id = p_job_id;
  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'UNKNOWN_SCHEDULED_JOB: no scheduled job %', p_job_id;
  END IF;
  IF NOT public.has_role(v_job.admin_id, 'admin') THEN
    RAISE EXCEPTION 'FORBIDDEN: the approving user is no longer an admin';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', v_job.admin_id::text, true);
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_job.admin_id, 'role', 'authenticated')::text, true);

  v_result := public.admin_apply_batch(
    p_payload => v_job.canonical_payload,
    p_commit => false,
    p_preview_token => NULL,
    p_kind => v_job.operation
  );
  RETURN v_result;
END;
$function$
;

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
    'evo_version_updates','evo_step_updates','gem_tasks','runs','domination_roads','domination_games','challenges','locker_codes',
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
      ELSIF v_group = 'evo_version_updates' THEN
        v_res := public.admin_patch_evo_version(v_item, p_commit);
      ELSIF v_group = 'evo_step_updates' THEN
        v_res := public.admin_patch_evo_step(v_item, p_commit);
      ELSIF v_group = 'challenges' THEN
        v_res := public.admin_apply_challenge(v_item, p_commit);
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
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_apply_challenge(p_payload jsonb, p_commit boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_apply_content(p_kind text, p_payload jsonb, p_commit boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ops jsonb := '[]'::jsonb;
  v_destr jsonb := '[]'::jsonb;
  v_id uuid;
  v_other uuid;
  v_card uuid;
  v_stat_player uuid;
  v_prereq uuid;
  v_name text;
  v_road text;
  v_code text;
  v_ids uuid[];
  v_ids_b uuid[];
  v_n int;
  v_m int;
  v_total numeric;
  v_slot text;
  v_slots int[];
  v_reward jsonb;
  v_pack_reward text;
  v_type text;
  v_stat_keys text[] := ARRAY['stat_3pt','stat_mid','stat_fin','stat_dnk','stat_ast','stat_stl','stat_reb','stat_blk','stat_int'];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Admin role required';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Payload must be an object';
  END IF;

  ------------------------------------------------------------------ TEAM
  IF p_kind = 'team' THEN
    v_name := btrim(coalesce(p_payload->>'name',''));
    IF v_name = '' THEN RAISE EXCEPTION 'name is required'; END IF;
    SELECT id INTO v_id FROM teams WHERE lower(name) = lower(v_name);

    v_ops := v_ops || jsonb_build_object(
      'table','teams',
      'action', CASE WHEN v_id IS NULL THEN 'insert' ELSE 'update' END,
      'match', v_name,
      'fields', jsonb_strip_nulls(jsonb_build_object(
        'category', p_payload->>'category',
        'unlock_cost', p_payload->'unlock_cost')));

    IF p_payload ? 'roster' THEN
      v_ids := public.admin_resolve_player_ids(p_payload->'roster');
      SELECT count(*) INTO v_n FROM team_players WHERE team_id = v_id;
      v_destr := v_destr || jsonb_build_object(
        'table','team_players','action','replace',
        'replaces_rows', coalesce(v_n,0),
        'new_rows', coalesce(array_length(v_ids,1),0));
    END IF;

    IF p_commit THEN
      IF v_id IS NULL THEN
        INSERT INTO teams(name, category, unlock_cost)
        VALUES (v_name, coalesce(p_payload->>'category','domination'), coalesce((p_payload->>'unlock_cost')::int,0))
        RETURNING id INTO v_id;
      ELSE
        UPDATE teams SET
          category = coalesce(p_payload->>'category', category),
          unlock_cost = coalesce((p_payload->>'unlock_cost')::int, unlock_cost)
        WHERE id = v_id;
      END IF;
      IF p_payload ? 'roster' THEN
        DELETE FROM team_players WHERE team_id = v_id;
        INSERT INTO team_players(team_id, player_card_id, slot)
        SELECT v_id, v_ids[i], i FROM generate_subscripts(v_ids,1) AS i;
      END IF;
    END IF;

  ------------------------------------------------------------------ RUN
  ELSIF p_kind = 'run' THEN
    v_name := btrim(coalesce(p_payload->>'name',''));
    IF v_name = '' THEN RAISE EXCEPTION 'name is required'; END IF;
    SELECT id INTO v_id FROM runs WHERE lower(name) = lower(v_name);

    v_other := NULL;
    IF p_payload ? 'team' AND p_payload->>'team' IS NOT NULL THEN
      SELECT id INTO v_other FROM teams WHERE lower(name) = lower(btrim(p_payload->>'team'));
      IF v_other IS NULL THEN RAISE EXCEPTION 'Unknown team: "%"', p_payload->>'team'; END IF;
    END IF;

    IF p_payload ? 'milestones' AND jsonb_typeof(p_payload->'milestones') <> 'array' THEN
      RAISE EXCEPTION 'milestones must be an array';
    END IF;

    v_ops := v_ops || jsonb_build_object(
      'table','runs',
      'action', CASE WHEN v_id IS NULL THEN 'insert' ELSE 'update' END,
      'match', v_name,
      'fields', jsonb_strip_nulls(jsonb_build_object(
        'target_score', p_payload->'target_score',
        'team_id', v_other,
        'milestones', p_payload->'milestones')));

    IF p_payload ? 'roster' THEN
      v_ids := public.admin_resolve_player_ids(p_payload->'roster');
      SELECT count(*) INTO v_n FROM run_players WHERE run_id = v_id;
      v_destr := v_destr || jsonb_build_object(
        'table','run_players','action','replace',
        'replaces_rows', coalesce(v_n,0),
        'new_rows', coalesce(array_length(v_ids,1),0));
    END IF;

    IF p_payload ? 'rank_rewards' THEN
      IF jsonb_typeof(p_payload->'rank_rewards') <> 'array' THEN
        RAISE EXCEPTION 'rank_rewards must be an array';
      END IF;
      SELECT count(*) INTO v_n FROM run_rank_rewards;
      v_destr := v_destr || jsonb_build_object(
        'table','run_rank_rewards','action','replace_global',
        'note','run_rank_rewards is a single global ladder shared by every Run',
        'replaces_rows', coalesce(v_n,0),
        'new_rows', jsonb_array_length(p_payload->'rank_rewards'));
    END IF;

    IF p_commit THEN
      IF v_id IS NULL THEN
        INSERT INTO runs(name, target_score, team_id, milestones)
        VALUES (v_name,
                coalesce((p_payload->>'target_score')::int, 21),
                v_other,
                coalesce(p_payload->'milestones','[]'::jsonb))
        RETURNING id INTO v_id;
      ELSE
        UPDATE runs SET
          target_score = coalesce((p_payload->>'target_score')::int, target_score),
          team_id = coalesce(v_other, team_id),
          milestones = coalesce(p_payload->'milestones', milestones)
        WHERE id = v_id;
      END IF;

      IF p_payload ? 'roster' THEN
        DELETE FROM run_players WHERE run_id = v_id;
        INSERT INTO run_players(run_id, player_card_id, run_rating,
          run_stat_3pt, run_stat_mid, run_stat_fin, run_stat_dnk,
          run_stat_stl, run_stat_blk, run_stat_ast, run_stat_reb, run_stat_int)
        SELECT v_id, pc.id,
          coalesce(pc.run_rating, round(pc.rating)::int),
          coalesce(pc.run_stat_3pt, pc.stat_3pt),
          coalesce(pc.run_stat_mid, pc.stat_mid),
          coalesce(pc.run_stat_fin, pc.stat_fin),
          coalesce(pc.run_stat_dnk, pc.stat_dnk),
          coalesce(pc.run_stat_stl, pc.stat_stl),
          coalesce(pc.run_stat_blk, pc.stat_blk),
          coalesce(pc.run_stat_ast, pc.stat_ast),
          coalesce(pc.run_stat_reb, pc.stat_reb),
          coalesce(pc.run_stat_int, pc.stat_int)
        FROM player_cards pc WHERE pc.id = ANY(v_ids);
      END IF;

      IF p_payload ? 'rank_rewards' THEN
        DELETE FROM run_rank_rewards;
        INSERT INTO run_rank_rewards(rank_name, wins_required, coin_reward, gem_reward, pack_reward, sort_order)
        SELECT coalesce(e->>'rank_name', 'Rank ' || ord),
               coalesce((e->>'wins_required')::int, ord::int),
               coalesce((e->>'coin_reward')::int, 0),
               coalesce((e->>'gem_reward')::int, 0),
               coalesce(e->>'pack_reward', ''),
               coalesce((e->>'sort_order')::int, ord::int)
        FROM jsonb_array_elements(p_payload->'rank_rewards') WITH ORDINALITY AS t(e, ord);
      END IF;
    END IF;

  ------------------------------------------------------- DOMINATION GAME
  ELSIF p_kind = 'domination_game' THEN
    v_name := btrim(coalesce(p_payload->>'opponent_name',''));
    v_road := btrim(coalesce(p_payload->>'road_name',''));
    IF v_name = '' OR v_road = '' THEN
      RAISE EXCEPTION 'opponent_name and road_name are required';
    END IF;
    SELECT id INTO v_id FROM domination_games
    WHERE lower(opponent_name) = lower(v_name) AND lower(road_name) = lower(v_road);

    v_ops := v_ops || jsonb_build_object(
      'table','domination_games',
      'action', CASE WHEN v_id IS NULL THEN 'insert' ELSE 'update' END,
      'match', v_road || ' / ' || v_name,
      'fields', jsonb_strip_nulls(jsonb_build_object(
        'game_order', p_payload->'game_order',
        'difficulty_stars', p_payload->'difficulty_stars',
        'coin_reward', p_payload->'coin_reward',
        'pack_reward', p_payload->>'pack_reward')));

    IF p_payload ? 'roster' THEN
      v_ids := public.admin_resolve_player_ids(p_payload->'roster');
      SELECT count(*) INTO v_n FROM domination_game_players WHERE domination_game_id = v_id;
      v_destr := v_destr || jsonb_build_object(
        'table','domination_game_players','action','replace',
        'replaces_rows', coalesce(v_n,0),
        'new_rows', coalesce(array_length(v_ids,1),0));
    END IF;

    IF p_commit THEN
      IF v_id IS NULL THEN
        INSERT INTO domination_games(road_name, opponent_name, difficulty_stars, game_order, coin_reward, pack_reward)
        VALUES (v_road, v_name,
                coalesce((p_payload->>'difficulty_stars')::int, 1),
                coalesce((p_payload->>'game_order')::int, 1),
                coalesce((p_payload->>'coin_reward')::int, 0),
                p_payload->>'pack_reward')
        RETURNING id INTO v_id;
      ELSE
        UPDATE domination_games SET
          difficulty_stars = coalesce((p_payload->>'difficulty_stars')::int, difficulty_stars),
          game_order = coalesce((p_payload->>'game_order')::int, game_order),
          coin_reward = coalesce((p_payload->>'coin_reward')::int, coin_reward),
          pack_reward = CASE WHEN p_payload ? 'pack_reward' THEN p_payload->>'pack_reward' ELSE pack_reward END
        WHERE id = v_id;
      END IF;
      IF p_payload ? 'roster' THEN
        DELETE FROM domination_game_players WHERE domination_game_id = v_id;
        INSERT INTO domination_game_players(domination_game_id, player_card_id, slot)
        SELECT v_id, v_ids[i], i FROM generate_subscripts(v_ids,1) AS i;
      END IF;
    END IF;

  ------------------------------------------------------------------ PACK
  ELSIF p_kind = 'pack' THEN
    v_name := btrim(coalesce(p_payload->>'name',''));
    IF v_name = '' THEN RAISE EXCEPTION 'name is required'; END IF;
    SELECT id INTO v_id FROM packs WHERE lower(name) = lower(v_name);
    v_type := p_payload->>'pack_type';
    IF v_type IS NULL AND v_id IS NOT NULL THEN
      SELECT pack_type INTO v_type FROM packs WHERE id = v_id;
    END IF;
    v_type := coalesce(v_type, 'standard');

    IF p_payload ? 'players' THEN
      v_ids := public.admin_resolve_player_ids(p_payload->'players');
      IF coalesce(array_length(v_ids,1),0) = 0 THEN
        RAISE EXCEPTION 'players pool cannot be empty; omit the field to keep the current pool';
      END IF;
      SELECT count(*) INTO v_n FROM pack_players WHERE pack_id = v_id;
      v_destr := v_destr || jsonb_build_object(
        'table','pack_players','action','replace',
        'replaces_rows', coalesce(v_n,0),
        'new_rows', array_length(v_ids,1));
      v_slots := ARRAY(SELECT i FROM generate_subscripts(v_ids,1) AS i);
    ELSE
      SELECT array_agg(DISTINCT slot_number) INTO v_slots FROM pack_players WHERE pack_id = v_id;
    END IF;

    IF p_payload ? 'odds' THEN
      IF jsonb_typeof(p_payload->'odds') <> 'array' OR jsonb_array_length(p_payload->'odds') = 0 THEN
        RAISE EXCEPTION 'odds must be a non-empty array';
      END IF;
      SELECT sum((e->>'percentage')::numeric) INTO v_total
      FROM jsonb_array_elements(p_payload->'odds') AS e;
      IF v_total IS NULL OR abs(v_total - 100) > 0.01 THEN
        RAISE EXCEPTION 'Pack odds must total 100 percent (got %)', coalesce(v_total, 0);
      END IF;
      SELECT count(*) INTO v_m
      FROM jsonb_array_elements(p_payload->'odds') AS e
      WHERE coalesce((e->>'percentage')::numeric, 0) <= 0;
      IF v_m > 0 THEN
        RAISE EXCEPTION 'Every odds entry needs a percentage greater than 0';
      END IF;
      FOR v_slot IN SELECT e->>'result_slot' FROM jsonb_array_elements(p_payload->'odds') AS e LOOP
        IF v_slot IS NULL OR btrim(v_slot) = '' THEN
          RAISE EXCEPTION 'Every odds entry needs a result_slot';
        END IF;
        IF v_slot <> 'player_choice' THEN
          IF v_slot !~ '^[0-9]+$' THEN
            RAISE EXCEPTION 'result_slot must be a slot number or "player_choice" (got "%")', v_slot;
          END IF;
          IF coalesce(array_length(v_slots,1),0) > 0 AND NOT (v_slot::int = ANY(v_slots)) THEN
            RAISE EXCEPTION 'Odds slot % has no cards in the pack pool (pool slots: %)', v_slot, v_slots;
          END IF;
        END IF;
      END LOOP;
      SELECT count(*) INTO v_n FROM pack_odds WHERE pack_id = v_id;
      v_destr := v_destr || jsonb_build_object(
        'table','pack_odds','action','replace',
        'replaces_rows', coalesce(v_n,0),
        'new_rows', jsonb_array_length(p_payload->'odds'));
    END IF;

    v_ops := v_ops || jsonb_build_object(
      'table','packs',
      'action', CASE WHEN v_id IS NULL THEN 'insert' ELSE 'update' END,
      'match', v_name,
      'fields', jsonb_strip_nulls(jsonb_build_object(
        'pack_type', v_type,
        'cost', p_payload->'cost',
        'ten_box_cost', p_payload->'ten_box_cost')));

    IF p_commit THEN
      IF v_id IS NULL THEN
        INSERT INTO packs(name, pack_type, cost, ten_box_cost)
        VALUES (v_name, v_type,
                coalesce((p_payload->>'cost')::int, 0),
                (p_payload->>'ten_box_cost')::int)
        RETURNING id INTO v_id;
      ELSE
        UPDATE packs SET
          pack_type = v_type,
          cost = coalesce((p_payload->>'cost')::int, cost),
          ten_box_cost = CASE WHEN p_payload ? 'ten_box_cost' THEN (p_payload->>'ten_box_cost')::int ELSE ten_box_cost END
        WHERE id = v_id;
      END IF;

      IF p_payload ? 'players' THEN
        DELETE FROM pack_players WHERE pack_id = v_id;
        INSERT INTO pack_players(pack_id, player_card_id, slot_number)
        SELECT v_id, v_ids[i], i FROM generate_subscripts(v_ids,1) AS i;
      END IF;

      IF p_payload ? 'odds' THEN
        DELETE FROM pack_odds WHERE pack_id = v_id;
        INSERT INTO pack_odds(pack_id, pack_type, dice_roll, result_slot, percentage, description)
        SELECT v_id, v_type, '0', e->>'result_slot', (e->>'percentage')::numeric,
               coalesce(e->>'description', 'Slot ' || (e->>'result_slot'))
        FROM jsonb_array_elements(p_payload->'odds') AS e;
      END IF;
    END IF;

  ------------------------------------------------------------ LOCKER CODE
  ELSIF p_kind = 'locker_code' THEN
    v_code := upper(btrim(coalesce(p_payload->>'code','')));
    IF v_code = '' THEN RAISE EXCEPTION 'code is required'; END IF;
    SELECT id INTO v_id FROM locker_codes WHERE upper(code) = v_code;

    v_type := coalesce(p_payload->>'reward_type', 'coins');
    IF v_type NOT IN ('coins','gems','pack','card') THEN
      RAISE EXCEPTION 'reward_type must be coins, gems, pack or card';
    END IF;
    v_reward := coalesce(p_payload->'reward_value', '{}'::jsonb);

    IF v_type IN ('coins','gems') THEN
      IF coalesce((v_reward->>'amount')::numeric, 0) <= 0 THEN
        RAISE EXCEPTION '% reward needs reward_value.amount greater than 0', v_type;
      END IF;
      v_reward := jsonb_build_object('amount', (v_reward->>'amount')::int);
    ELSIF v_type = 'pack' THEN
      IF v_reward ? 'pack_name' THEN
        SELECT id INTO v_other FROM packs WHERE lower(name) = lower(btrim(v_reward->>'pack_name'));
        IF v_other IS NULL THEN RAISE EXCEPTION 'Unknown pack: "%"', v_reward->>'pack_name'; END IF;
      ELSIF v_reward ? 'pack_id' THEN
        SELECT id INTO v_other FROM packs WHERE id = (v_reward->>'pack_id')::uuid;
        IF v_other IS NULL THEN RAISE EXCEPTION 'Unknown pack id: %', v_reward->>'pack_id'; END IF;
      ELSE
        RAISE EXCEPTION 'pack reward needs reward_value.pack_name';
      END IF;
      v_reward := jsonb_build_object('pack_id', v_other);
    ELSE
      IF v_reward ? 'card_name' THEN
        v_ids := public.admin_resolve_player_ids(jsonb_build_array(v_reward->>'card_name'));
        v_other := v_ids[1];
      ELSIF v_reward ? 'player_card_id' THEN
        SELECT id INTO v_other FROM player_cards WHERE id = (v_reward->>'player_card_id')::uuid;
        IF v_other IS NULL THEN RAISE EXCEPTION 'Unknown player card id: %', v_reward->>'player_card_id'; END IF;
      ELSE
        RAISE EXCEPTION 'card reward needs reward_value.card_name';
      END IF;
      v_reward := jsonb_build_object('player_card_id', v_other);
    END IF;

    v_ops := v_ops || jsonb_build_object(
      'table','locker_codes',
      'action', CASE WHEN v_id IS NULL THEN 'insert' ELSE 'update' END,
      'match', v_code,
      'fields', jsonb_build_object(
        'reward_type', v_type,
        'reward_value', v_reward,
        'max_redemptions', p_payload->'max_redemptions',
        'expires_at', p_payload->>'expires_at'));

    IF p_commit THEN
      IF v_id IS NULL THEN
        INSERT INTO locker_codes(code, reward_type, reward_value, max_redemptions, expires_at)
        VALUES (v_code, v_type, v_reward,
                (p_payload->>'max_redemptions')::int,
                (p_payload->>'expires_at')::timestamptz)
        RETURNING id INTO v_id;
      ELSE
        UPDATE locker_codes SET
          reward_type = v_type,
          reward_value = v_reward,
          max_redemptions = CASE WHEN p_payload ? 'max_redemptions' THEN (p_payload->>'max_redemptions')::int ELSE max_redemptions END,
          expires_at = CASE WHEN p_payload ? 'expires_at' THEN (p_payload->>'expires_at')::timestamptz ELSE expires_at END
        WHERE id = v_id;
      END IF;
    END IF;

  ------------------------------------------------------------- CHALLENGE
  ELSIF p_kind = 'challenge' THEN
    v_name := btrim(coalesce(p_payload->>'name',''));
    IF v_name = '' THEN RAISE EXCEPTION 'name is required'; END IF;
    SELECT id INTO v_id FROM challenges WHERE lower(name) = lower(v_name);

    v_other := NULL;
    IF p_payload->>'opponent_team_id' IS NOT NULL THEN
      SELECT id INTO v_other FROM teams WHERE id = (p_payload->>'opponent_team_id')::uuid;
      IF v_other IS NULL THEN
        RAISE EXCEPTION 'UNKNOWN_TEAM_ID: opponent_team_id % does not exist', p_payload->>'opponent_team_id';
      END IF;
    ELSIF p_payload->>'opponent_team' IS NOT NULL THEN
      SELECT id INTO v_other FROM teams WHERE lower(name) = lower(btrim(p_payload->>'opponent_team'));
      IF v_other IS NULL THEN RAISE EXCEPTION 'Unknown team: "%"', p_payload->>'opponent_team'; END IF;
    END IF;

    v_card := NULL;
    IF p_payload->>'card_reward_id' IS NOT NULL THEN
      v_card := (p_payload->>'card_reward_id')::uuid;
      IF NOT EXISTS (SELECT 1 FROM player_cards WHERE id = v_card) THEN
        RAISE EXCEPTION 'UNKNOWN_PLAYER_CARD_ID: card_reward_id % does not exist', v_card;
      END IF;
    ELSIF p_payload->>'card_reward' IS NOT NULL THEN
      v_ids := public.admin_resolve_player_ids(jsonb_build_array(p_payload->>'card_reward'));
      v_card := v_ids[1];
    END IF;

    v_stat_player := NULL;
    IF p_payload->>'stat_limit_player' IS NOT NULL THEN
      v_ids_b := public.admin_resolve_player_ids(jsonb_build_array(p_payload->>'stat_limit_player'));
      v_stat_player := v_ids_b[1];
    END IF;

    v_prereq := NULL;
    IF p_payload->>'prerequisite' IS NOT NULL THEN
      SELECT id INTO v_prereq FROM challenges WHERE lower(name) = lower(btrim(p_payload->>'prerequisite'));
      IF v_prereq IS NULL THEN RAISE EXCEPTION 'Unknown prerequisite challenge: "%"', p_payload->>'prerequisite'; END IF;
    END IF;

    v_pack_reward := NULL;
    IF p_payload->>'pack_reward_id' IS NOT NULL THEN
      SELECT id::text INTO v_pack_reward FROM packs WHERE id = (p_payload->>'pack_reward_id')::uuid;
      IF v_pack_reward IS NULL THEN
        RAISE EXCEPTION 'UNKNOWN_PACK_ID: pack_reward_id % does not exist', p_payload->>'pack_reward_id';
      END IF;
    ELSIF p_payload->>'pack_reward' IS NOT NULL THEN
      SELECT id::text INTO v_pack_reward FROM packs WHERE lower(name) = lower(btrim(p_payload->>'pack_reward'));
      IF v_pack_reward IS NULL THEN v_pack_reward := p_payload->>'pack_reward'; END IF;
    END IF;

    v_ops := v_ops || jsonb_build_object(
      'table','challenges',
      'action', CASE WHEN v_id IS NULL THEN 'insert' ELSE 'update' END,
      'match', v_name,
      'fields', jsonb_strip_nulls(jsonb_build_object(
        'challenge_type', p_payload->>'challenge_type',
        'opponent_team_id', v_other,
        'win_condition', p_payload->>'win_condition',
        'coin_reward', p_payload->'coin_reward',
        'gem_reward', p_payload->'gem_reward',
        'pack_reward', v_pack_reward,
        'card_reward_id', v_card,
        'conditions', p_payload->'conditions',
        'reward_payload', p_payload->'reward_payload',
        'stat_limit_player_id', v_stat_player,
        'prerequisite_id', v_prereq,
        'lineup_restrictions', p_payload->'lineup_restrictions',
        'expires_at', p_payload->>'expires_at')));

    IF p_commit THEN
      IF v_id IS NULL THEN
        INSERT INTO challenges(
          name, description, challenge_type, opponent_team_id, win_condition, win_by_amount,
          series_length, series_win_coins, series_loss_coins, stat_limit_player_id, stat_limit_stat,
          stat_limit_value, coin_reward, gem_reward, pack_reward, card_reward_id, prerequisite_id,
          spotlight_group, sort_order, lineup_restrictions, is_repeatable, expires_at,
          conditions, reward_payload, status)
        VALUES (
          v_name, p_payload->>'description', coalesce(p_payload->>'challenge_type','single'), v_other,
          coalesce(p_payload->>'win_condition','win'), (p_payload->>'win_by_amount')::int,
          (p_payload->>'series_length')::int,
          coalesce((p_payload->>'series_win_coins')::int, 0),
          coalesce((p_payload->>'series_loss_coins')::int, 0),
          v_stat_player, p_payload->>'stat_limit_stat', (p_payload->>'stat_limit_value')::int,
          coalesce((p_payload->>'coin_reward')::int, 0),
          coalesce((p_payload->>'gem_reward')::int, 0),
          v_pack_reward, v_card, v_prereq,
          p_payload->>'spotlight_group',
          coalesce((p_payload->>'sort_order')::int, 0),
          p_payload->'lineup_restrictions',
          coalesce((p_payload->>'is_repeatable')::boolean, true),
          (p_payload->>'expires_at')::timestamptz,
          p_payload->'conditions', p_payload->'reward_payload',
          coalesce(nullif(p_payload->>'status',''), 'active')::content_status)
        RETURNING id INTO v_id;
      ELSE
        UPDATE challenges SET
          description = CASE WHEN p_payload ? 'description' THEN p_payload->>'description' ELSE description END,
          challenge_type = coalesce(p_payload->>'challenge_type', challenge_type),
          opponent_team_id = coalesce(v_other, opponent_team_id),
          win_condition = coalesce(p_payload->>'win_condition', win_condition),
          win_by_amount = CASE WHEN p_payload ? 'win_by_amount' THEN (p_payload->>'win_by_amount')::int ELSE win_by_amount END,
          series_length = CASE WHEN p_payload ? 'series_length' THEN (p_payload->>'series_length')::int ELSE series_length END,
          series_win_coins = coalesce((p_payload->>'series_win_coins')::int, series_win_coins),
          series_loss_coins = coalesce((p_payload->>'series_loss_coins')::int, series_loss_coins),
          stat_limit_player_id = CASE WHEN p_payload ? 'stat_limit_player' THEN v_stat_player ELSE stat_limit_player_id END,
          stat_limit_stat = CASE WHEN p_payload ? 'stat_limit_stat' THEN p_payload->>'stat_limit_stat' ELSE stat_limit_stat END,
          stat_limit_value = CASE WHEN p_payload ? 'stat_limit_value' THEN (p_payload->>'stat_limit_value')::int ELSE stat_limit_value END,
          coin_reward = coalesce((p_payload->>'coin_reward')::int, coin_reward),
          gem_reward = coalesce((p_payload->>'gem_reward')::int, gem_reward),
          pack_reward = CASE WHEN p_payload ? 'pack_reward' OR p_payload ? 'pack_reward_id' THEN v_pack_reward ELSE pack_reward END,
          card_reward_id = CASE WHEN p_payload ? 'card_reward' OR p_payload ? 'card_reward_id' THEN v_card ELSE card_reward_id END,
          conditions = CASE WHEN p_payload ? 'conditions' THEN p_payload->'conditions' ELSE conditions END,
          reward_payload = CASE WHEN p_payload ? 'reward_payload' THEN p_payload->'reward_payload' ELSE reward_payload END,
          status = CASE WHEN nullif(p_payload->>'status','') IS NOT NULL THEN (p_payload->>'status')::content_status ELSE status END,
          prerequisite_id = CASE WHEN p_payload ? 'prerequisite' THEN v_prereq ELSE prerequisite_id END,
          spotlight_group = CASE WHEN p_payload ? 'spotlight_group' THEN p_payload->>'spotlight_group' ELSE spotlight_group END,
          sort_order = coalesce((p_payload->>'sort_order')::int, sort_order),
          lineup_restrictions = CASE WHEN p_payload ? 'lineup_restrictions' THEN p_payload->'lineup_restrictions' ELSE lineup_restrictions END,
          is_repeatable = coalesce((p_payload->>'is_repeatable')::boolean, is_repeatable),
          expires_at = CASE WHEN p_payload ? 'expires_at' THEN (p_payload->>'expires_at')::timestamptz ELSE expires_at END
        WHERE id = v_id;
      END IF;
    END IF;

  ----------------------------------------------------------- DYNAMIC DUO
  ELSIF p_kind = 'dynamic_duo' THEN
    v_name := btrim(coalesce(p_payload->>'name',''));
    IF v_name = '' THEN RAISE EXCEPTION 'name is required'; END IF;
    SELECT id INTO v_id FROM dynamic_duos WHERE lower(name) = lower(v_name);

    IF v_id IS NULL AND (p_payload->>'player_a' IS NULL OR p_payload->>'player_b' IS NULL) THEN
      RAISE EXCEPTION 'player_a and player_b are required when creating a duo';
    END IF;

    v_ids := '{}';
    IF p_payload->>'player_a' IS NOT NULL THEN
      v_ids := public.admin_resolve_player_ids(jsonb_build_array(p_payload->>'player_a'));
    END IF;
    v_ids_b := '{}';
    IF p_payload->>'player_b' IS NOT NULL THEN
      v_ids_b := public.admin_resolve_player_ids(jsonb_build_array(p_payload->>'player_b'));
    END IF;
    IF coalesce(array_length(v_ids,1),0) > 0 AND coalesce(array_length(v_ids_b,1),0) > 0
       AND v_ids[1] = v_ids_b[1] THEN
      RAISE EXCEPTION 'player_a and player_b must be different cards';
    END IF;

    FOR v_slot IN SELECT k FROM (
      SELECT jsonb_object_keys(coalesce(p_payload->'boosts_a','{}'::jsonb)) AS k
      UNION ALL
      SELECT jsonb_object_keys(coalesce(p_payload->'boosts_b','{}'::jsonb)) AS k) s LOOP
      IF NOT (v_slot = ANY(v_stat_keys)) THEN
        RAISE EXCEPTION 'Unknown boost key "%". Allowed: %', v_slot, v_stat_keys;
      END IF;
    END LOOP;

    v_ops := v_ops || jsonb_build_object(
      'table','dynamic_duos',
      'action', CASE WHEN v_id IS NULL THEN 'insert' ELSE 'update' END,
      'match', v_name,
      'fields', jsonb_strip_nulls(jsonb_build_object(
        'player_card_id_a', v_ids[1],
        'player_card_id_b', v_ids_b[1],
        'boosts_a', p_payload->'boosts_a',
        'boosts_b', p_payload->'boosts_b',
        'is_active', p_payload->'is_active')));

    IF p_commit THEN
      IF v_id IS NULL THEN
        INSERT INTO dynamic_duos(name, description, player_card_id_a, player_card_id_b, boosts_a, boosts_b, is_active)
        VALUES (v_name, p_payload->>'description', v_ids[1], v_ids_b[1],
                coalesce(p_payload->'boosts_a','{}'::jsonb),
                coalesce(p_payload->'boosts_b','{}'::jsonb),
                coalesce((p_payload->>'is_active')::boolean, true))
        RETURNING id INTO v_id;
      ELSE
        UPDATE dynamic_duos SET
          description = CASE WHEN p_payload ? 'description' THEN p_payload->>'description' ELSE description END,
          player_card_id_a = coalesce(v_ids[1], player_card_id_a),
          player_card_id_b = coalesce(v_ids_b[1], player_card_id_b),
          boosts_a = coalesce(p_payload->'boosts_a', boosts_a),
          boosts_b = coalesce(p_payload->'boosts_b', boosts_b),
          is_active = coalesce((p_payload->>'is_active')::boolean, is_active),
          updated_at = now()
        WHERE id = v_id;
      END IF;
    END IF;

  ELSE
    RAISE EXCEPTION 'Unknown kind: %', p_kind;
  END IF;

  RETURN jsonb_build_object(
    'kind', p_kind,
    'mode', CASE WHEN p_commit THEN 'commit' ELSE 'preview' END,
    'applied', p_commit,
    'id', v_id,
    'operations', v_ops,
    'destructive', v_destr);
END
$function$
;

CREATE OR REPLACE FUNCTION public.admin_apply_entity(p_kind text, p_item jsonb, p_commit boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tbl text; v_meta jsonb; v_id uuid; v_action text; v_match text; v_fields jsonb := '{}'::jsonb;
  v_ctl text[] := ARRAY['action','temp_ref','requirements','replace_requirements','entities','replace_entities',
                        'objectives','replace_objectives','badges','traits','collection','sub_collection',
                        'gem_tier','team','reward_pack','reward_card','prerequisite_collection','prerequisite_task',
                        'source','destination','player','creator','location_account','new_name'];
  k text; v_res jsonb; v_ops jsonb := '[]'::jsonb; v_destr jsonb := '[]'::jsonb; v_warn jsonb := '[]'::jsonb;
  v_resolved jsonb := '{}'::jsonb; v_item jsonb := p_item; v_tmp uuid; v_n int; v_rv jsonb; v_child jsonb;
  v_before jsonb; v_removed jsonb;
BEGIN
  PERFORM public.admin_require_admin();
  v_meta := public.admin_entity_meta(p_kind);
  v_tbl := v_meta->>'table';
  v_action := lower(coalesce(v_item->>'action','upsert'));

  -- ---- target resolution ----
  v_id := nullif(coalesce(v_item->>(p_kind || '_id'), v_item->>'id'), '')::uuid;
  IF v_id IS NOT NULL THEN
    EXECUTE format('SELECT count(*) FROM public.%I WHERE id = $1', v_tbl) INTO v_n USING v_id;
    IF v_n = 0 THEN RAISE EXCEPTION 'UNKNOWN_%_ID: %', upper(p_kind), v_id; END IF;
  ELSIF v_meta ? 'name_column' AND coalesce(v_item->>'name', v_item->>'title', v_item->>'code') IS NOT NULL THEN
    v_resolved := public.admin_entity_lookup(v_tbl, v_meta->>'name_column',
                     coalesce(v_item->>'name', v_item->>'title', v_item->>'code'));
    v_n := (v_resolved->>'n')::int;
    v_id := nullif(v_resolved->>'id','')::uuid;
    IF v_n > 1 THEN
      RAISE EXCEPTION 'AMBIGUOUS_%_NAME: "%" matches % records; target one by its id',
        upper(p_kind), coalesce(v_item->>'name', v_item->>'title', v_item->>'code'), v_n;
    END IF;
    IF v_n = 0 THEN v_id := NULL; END IF;
    v_resolved := '{}'::jsonb;
  END IF;
  IF v_id IS NOT NULL AND v_action = 'create' THEN
    RAISE EXCEPTION 'ALREADY_EXISTS: a % already exists for this target; use action=update or upsert', p_kind;
  END IF;
  v_match := coalesce(v_item->>'name', v_item->>'title', v_item->>'code', v_id::text, '(new)');

  -- ---- alias normalization ----
  IF v_item ? 'new_name' THEN v_item := v_item || jsonb_build_object('name', v_item->>'new_name'); END IF;
  IF v_item ? 'gem_tier' AND public.admin_has_column(v_tbl,'gem_tier_id') THEN
    SELECT id INTO v_tmp FROM gem_tiers WHERE lower(name) = lower(v_item->>'gem_tier');
    IF v_tmp IS NULL THEN RAISE EXCEPTION 'UNKNOWN_GEM_TIER: "%"', v_item->>'gem_tier'; END IF;
    v_item := v_item || jsonb_build_object('gem_tier_id', v_tmp);
  END IF;
  IF v_item ? 'reward_pack' AND public.admin_has_column(v_tbl,'reward_pack_id') THEN
    v_item := v_item || jsonb_build_object('reward_pack_id', public.admin_resolve_pack(v_item->'reward_pack', NULL));
  END IF;
  IF v_item ? 'reward_card' AND public.admin_has_column(v_tbl,'reward_card_id') THEN
    v_item := v_item || jsonb_build_object('reward_card_id', public.admin_resolve_card(v_item->'reward_card'));
  END IF;
  IF v_item ? 'prerequisite_collection' THEN
    SELECT id INTO v_tmp FROM collections WHERE lower(name) = lower(v_item->>'prerequisite_collection');
    IF v_tmp IS NULL THEN RAISE EXCEPTION 'UNKNOWN_COLLECTION: "%"', v_item->>'prerequisite_collection'; END IF;
    v_item := v_item || jsonb_build_object('prerequisite_collection_id', v_tmp);
  END IF;
  IF v_item ? 'prerequisite_task' THEN
    SELECT id INTO v_tmp FROM gem_tasks WHERE lower(title) = lower(v_item->>'prerequisite_task');
    IF v_tmp IS NULL THEN RAISE EXCEPTION 'UNKNOWN_GEM_TASK: "%"', v_item->>'prerequisite_task'; END IF;
    v_item := v_item || jsonb_build_object('prerequisite_task_id', v_tmp);
  END IF;
  IF v_item ? 'collection' AND public.admin_has_column(v_tbl,'collection_id') THEN
    SELECT id INTO v_tmp FROM collections WHERE lower(name) = lower(v_item->>'collection');
    IF v_tmp IS NULL THEN RAISE EXCEPTION 'UNKNOWN_COLLECTION: "%"', v_item->>'collection'; END IF;
    v_item := v_item || jsonb_build_object('collection_id', v_tmp);
  END IF;
  IF v_item ? 'player' AND public.admin_has_column(v_tbl,'player_card_id') THEN
    v_item := v_item || jsonb_build_object('player_card_id', public.admin_resolve_card(v_item->'player'));
  END IF;

  -- ---- kind-specific validation ----
  IF p_kind IN ('collection','sub_collection') THEN
    IF v_item ? 'reward_payload' THEN
      v_rv := public.admin_reward_validate(v_item->'reward_payload');
      IF NOT (v_rv->>'valid')::boolean THEN
        RAISE EXCEPTION 'INVALID_REWARD_PAYLOAD: % detail=%', (v_rv->'errors'->0->>'message'),
          jsonb_build_object('reward_errors', v_rv->'errors')::text;
      END IF;
      v_warn := v_warn || coalesce(v_rv->'warnings','[]'::jsonb);
    END IF;
    IF p_kind = 'collection' AND v_item ? 'prerequisite_collection_id' AND v_id IS NOT NULL
       AND (v_item->>'prerequisite_collection_id')::uuid = v_id THEN
      RAISE EXCEPTION 'CIRCULAR_COLLECTION_PREREQUISITE: a collection cannot require itself';
    END IF;
    IF p_kind = 'sub_collection' THEN
      IF v_item->>'collection_id' IS NULL AND v_id IS NULL THEN
        RAISE EXCEPTION 'MISSING_PARENT: sub-collections need collection_id (or collection name)';
      END IF;
      IF v_item ? 'collection_id' THEN
        SELECT count(*) INTO v_n FROM collections
         WHERE id = (v_item->>'collection_id')::uuid AND status <> 'archived';
        IF v_n = 0 THEN RAISE EXCEPTION 'PARENT_UNAVAILABLE: parent collection is missing or archived'; END IF;
      END IF;
    END IF;
  ELSIF p_kind = 'gem_task' THEN
    IF v_item ? 'stat_key' AND NOT (v_item->>'stat_key' = ANY(public.admin_stat_keys())) THEN
      RAISE EXCEPTION 'UNKNOWN_STAT_KEY: "%" detail=%', v_item->>'stat_key',
        jsonb_build_object('supported', public.admin_stat_keys())::text;
    END IF;
    IF v_item ? 'prerequisite_task_id' AND v_id IS NOT NULL AND (v_item->>'prerequisite_task_id')::uuid = v_id THEN
      RAISE EXCEPTION 'CIRCULAR_TASK_PREREQUISITE: a task cannot require itself';
    END IF;
    IF v_item ? 'reward_payload' THEN
      v_rv := public.admin_reward_validate(v_item->'reward_payload');
      IF NOT (v_rv->>'valid')::boolean THEN
        RAISE EXCEPTION 'INVALID_REWARD_PAYLOAD: % detail=%', (v_rv->'errors'->0->>'message'),
          jsonb_build_object('reward_errors', v_rv->'errors')::text;
      END IF;
    END IF;
  ELSIF p_kind = 'signature_trait' THEN
    IF coalesce((v_item->>'requires_target_stat')::boolean, false)
       AND coalesce(jsonb_array_length(v_item->'supported_target_stats'), 0) = 0 THEN
      v_warn := v_warn || jsonb_build_object('code','TRAIT_TARGET_STATS_EMPTY',
        'message','requires_target_stat is true but supported_target_stats is empty; any stat will be accepted');
    END IF;
  ELSIF p_kind = 'release_bundle' THEN
    IF v_item->>'slug' IS NULL AND v_id IS NULL THEN
      v_item := v_item || jsonb_build_object('slug', public.admin_slugify(coalesce(v_item->>'name','release')));
    END IF;
  ELSIF p_kind = 'social_post' THEN
    IF v_item ? 'creator' THEN
      SELECT id INTO v_tmp FROM social_creators WHERE lower(name) = lower(v_item->>'creator');
      IF v_tmp IS NULL THEN RAISE EXCEPTION 'UNKNOWN_SOCIAL_CREATOR: "%"', v_item->>'creator'; END IF;
      v_item := v_item || jsonb_build_object('creator_id', v_tmp);
    END IF;
    IF v_item ? 'location_account' THEN
      SELECT id INTO v_tmp FROM location_accounts WHERE lower(name) = lower(v_item->>'location_account');
      IF v_tmp IS NULL THEN RAISE EXCEPTION 'UNKNOWN_LOCATION_ACCOUNT: "%"', v_item->>'location_account'; END IF;
      v_item := v_item || jsonb_build_object('location_account_id', v_tmp);
    END IF;
  END IF;

  -- ---- build the write payload from real columns only ----
  FOR k IN SELECT jsonb_object_keys(v_item) LOOP
    CONTINUE WHEN k = ANY(v_ctl);
    CONTINUE WHEN k = p_kind || '_id' OR k = 'id';
    IF public.admin_has_column(v_tbl, k) THEN
      v_fields := v_fields || jsonb_build_object(k, v_item->k);
    ELSE
      v_warn := v_warn || jsonb_build_object('code','FIELD_IGNORED',
        'message', format('"%s" is not a field of %s and was ignored', k, p_kind));
    END IF;
  END LOOP;

  IF v_id IS NULL AND v_meta ? 'name_column' AND v_fields->>(v_meta->>'name_column') IS NULL THEN
    RAISE EXCEPTION 'MISSING_NAME: a new % needs %', p_kind, v_meta->>'name_column';
  END IF;

  v_res := public.admin_upsert_row(v_tbl, v_id, v_fields, v_match, p_commit, v_action);
  v_id := coalesce((v_res->>'id')::uuid, v_id);
  v_ops := v_ops || coalesce(v_res->'operations','[]'::jsonb);

  -- ---- children: collection / sub-collection requirements ----
  IF p_kind IN ('collection','sub_collection') AND v_item ? 'requirements' THEN
    IF jsonb_typeof(v_item->'requirements') <> 'array' THEN RAISE EXCEPTION 'INVALID_PAYLOAD: requirements must be an array'; END IF;
    DECLARE
      v_req jsonb; v_cards uuid[] := '{}'; v_card uuid; v_reward_cards int := 0; v_idx int := 0;
      v_reqtbl text := CASE WHEN p_kind = 'collection' THEN 'collection_requirements' ELSE 'sub_collection_requirements' END;
      v_parent text := CASE WHEN p_kind = 'collection' THEN 'collection_id' ELSE 'sub_collection_id' END;
      v_rows jsonb := '[]'::jsonb;
    BEGIN
      FOR v_req IN SELECT * FROM jsonb_array_elements(v_item->'requirements') LOOP
        v_idx := v_idx + 1;
        v_card := public.admin_resolve_card(CASE WHEN jsonb_typeof(v_req) = 'object' THEN v_req ELSE v_req END);
        IF v_card = ANY(v_cards) THEN
          RAISE EXCEPTION 'DUPLICATE_REQUIREMENT: card % appears more than once in requirements', v_card;
        END IF;
        v_cards := v_cards || v_card;
        IF coalesce((v_req->>'is_reward_card')::boolean, false) THEN v_reward_cards := v_reward_cards + 1; END IF;
        v_rows := v_rows || jsonb_build_object('player_card_id', v_card,
          'evolved_counts', coalesce((v_req->>'evolved_counts')::boolean, coalesce((v_item->>'evolved_counts')::boolean, true)),
          'any_evo_stage', coalesce((v_req->>'any_evo_stage')::boolean, true),
          'allowed_evo_stages', v_req->'allowed_evo_stages',
          'is_reward_card', coalesce((v_req->>'is_reward_card')::boolean, false),
          'sort_order', coalesce((v_req->>'sort_order')::int, v_idx));
      END LOOP;

      IF v_reward_cards > 1 AND NOT coalesce((v_item->>'allow_multiple_reward_cards')::boolean, false) THEN
        RAISE EXCEPTION 'MULTIPLE_REWARD_CARDS: % requirement rows are flagged is_reward_card; set allow_multiple_reward_cards: true if that is intended', v_reward_cards;
      END IF;
      IF v_item->>'reward_card_id' IS NOT NULL AND (v_item->>'reward_card_id')::uuid = ANY(v_cards) THEN
        SELECT count(*) INTO v_n FROM jsonb_array_elements(v_rows) e
         WHERE (e.value->>'player_card_id')::uuid = (v_item->>'reward_card_id')::uuid
           AND coalesce((e.value->>'is_reward_card')::boolean,false);
        IF v_n = 0 THEN
          RAISE EXCEPTION 'REWARD_CARD_IN_REQUIREMENTS: the completion-reward card is also listed as a required card; remove it or mark that row is_reward_card: true';
        END IF;
      END IF;
      IF array_length(v_cards,1) IS NULL THEN
        v_warn := v_warn || jsonb_build_object('code','COLLECTION_EMPTY','message','requirements is empty: this collection can never be completed');
      END IF;

      EXECUTE format('SELECT coalesce(jsonb_agg(jsonb_build_object(''player_card_id'',r.player_card_id,''name'',pc.name)),''[]''::jsonb)
                      FROM public.%I r JOIN player_cards pc ON pc.id = r.player_card_id WHERE r.%I = $1', v_reqtbl, v_parent)
        INTO v_before USING v_id;
      SELECT coalesce(jsonb_agg(e), '[]'::jsonb) INTO v_removed
      FROM jsonb_array_elements(coalesce(v_before,'[]'::jsonb)) e
      WHERE NOT ((e->>'player_card_id')::uuid = ANY(v_cards));

      IF coalesce((v_item->>'replace_requirements')::boolean, true) THEN
        v_destr := v_destr || jsonb_build_object('action','replace','label','DESTRUCTIVE_REPLACEMENT',
          'table', v_reqtbl, 'id', v_id, 'match', v_match,
          'message', format('the required-card list is replaced with %s card(s)', coalesce(array_length(v_cards,1),0)),
          'before', coalesce(v_before,'[]'::jsonb), 'removed', v_removed, 'after', v_rows);
        IF p_commit THEN
          EXECUTE format('DELETE FROM public.%I WHERE %I = $1', v_reqtbl, v_parent) USING v_id;
        END IF;
      END IF;

      IF p_commit THEN
        FOR v_child IN SELECT * FROM jsonb_array_elements(v_rows) LOOP
          EXECUTE format('INSERT INTO public.%I (%I, player_card_id, evolved_counts, any_evo_stage, allowed_evo_stages, is_reward_card, sort_order)
                          VALUES ($1, ($2->>''player_card_id'')::uuid, ($2->>''evolved_counts'')::boolean,
                                  ($2->>''any_evo_stage'')::boolean,
                                  (CASE WHEN jsonb_typeof($2->''allowed_evo_stages'')=''array''
                                        THEN (SELECT array_agg(e::int) FROM jsonb_array_elements_text($2->''allowed_evo_stages'') e) END),
                                  ($2->>''is_reward_card'')::boolean, ($2->>''sort_order'')::int)
                          ON CONFLICT (%I, player_card_id) DO UPDATE SET
                            evolved_counts = EXCLUDED.evolved_counts, any_evo_stage = EXCLUDED.any_evo_stage,
                            allowed_evo_stages = EXCLUDED.allowed_evo_stages, is_reward_card = EXCLUDED.is_reward_card,
                            sort_order = EXCLUDED.sort_order', v_reqtbl, v_parent, v_parent)
            USING v_id, v_child;
        END LOOP;
      END IF;
      v_ops := v_ops || jsonb_build_array(jsonb_build_object('action', CASE WHEN v_res->>'action' = 'insert' THEN 'insert' ELSE 'update' END,
        'table', v_reqtbl, 'id', v_id, 'match', v_match, 'fields', jsonb_build_object('requirements', v_rows)));
      v_resolved := v_resolved || jsonb_build_object('requirement_card_ids', to_jsonb(v_cards));
    END;
  END IF;

  -- ---- children: release bundle entities ----
  IF p_kind = 'release_bundle' AND v_item ? 'entities' THEN
    DECLARE v_e jsonb; v_seen text[] := '{}'; v_key text;
    BEGIN
      IF coalesce((v_item->>'replace_entities')::boolean, false) THEN
        v_destr := v_destr || jsonb_build_object('action','replace','label','DESTRUCTIVE_REPLACEMENT',
          'table','release_bundle_entities','id',v_id,'match',v_match,
          'message','the release member list is replaced');
        IF p_commit THEN DELETE FROM release_bundle_entities WHERE release_bundle_id = v_id; END IF;
      END IF;
      FOR v_e IN SELECT * FROM jsonb_array_elements(v_item->'entities') LOOP
        IF v_e->>'entity_type' IS NULL OR v_e->>'entity_id' IS NULL THEN
          RAISE EXCEPTION 'INVALID_PAYLOAD: release entities need entity_type and entity_id';
        END IF;
        PERFORM public.admin_entity_meta(v_e->>'entity_type');
        v_key := (v_e->>'entity_type') || ':' || (v_e->>'entity_id');
        IF v_key = ANY(v_seen) THEN RAISE EXCEPTION 'DUPLICATE_RELEASE_ENTITY: %', v_key; END IF;
        v_seen := v_seen || v_key;
        IF p_commit THEN
          INSERT INTO release_bundle_entities(release_bundle_id, entity_type, entity_id, role, sort_order)
          VALUES (v_id, v_e->>'entity_type', (v_e->>'entity_id')::uuid, v_e->>'role',
                  coalesce((v_e->>'sort_order')::int, 0))
          ON CONFLICT (release_bundle_id, entity_type, entity_id)
          DO UPDATE SET role = EXCLUDED.role, sort_order = EXCLUDED.sort_order;
        END IF;
      END LOOP;
      v_ops := v_ops || jsonb_build_array(jsonb_build_object('action','update','table','release_bundle_entities',
        'id', v_id, 'match', v_match, 'fields', jsonb_build_object('entities', v_item->'entities')));
    END;
  END IF;

  RETURN jsonb_build_object('kind', p_kind, 'id', v_id, 'match', v_match,
    'action', v_res->>'action', 'applied', p_commit,
    'operations', v_ops, 'destructive', v_destr, 'warnings', v_warn,
    'resolved_references', v_resolved, 'normalized_fields', v_fields);
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_apply_evo(p_item jsonb, p_commit boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_res jsonb; v_ver jsonb; v_obj jsonb; v_key text; v_step jsonb;
  v_version jsonb := coalesce(p_item->'resulting_version', p_item->'version');
BEGIN
  -- validate objective keys against the extensible registry when supplied by key
  FOR v_obj IN SELECT * FROM jsonb_array_elements(coalesce(p_item->'objectives','[]'::jsonb)) LOOP
    v_key := v_obj->>'key';
    IF v_key IS NOT NULL AND NOT (v_key = ANY(public.admin_evo_objective_keys())) THEN
      RAISE EXCEPTION 'UNSUPPORTED_OBJECTIVE: "%" is not a supported tracked objective detail=%', v_key,
        jsonb_build_object('supported', public.admin_evo_objective_keys())::text;
    END IF;
  END LOOP;

  v_res := public.admin_apply_evo_core(p_item - 'resulting_version' - 'version', p_commit);

  IF v_version IS NULL THEN
    RETURN jsonb_set(v_res, '{warnings}',
      coalesce(v_res->'warnings','[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'code','EVO_VERSION_MISSING',
        'message','this step has no resulting_version: the evolution has no materialized playable card')));
  END IF;

  v_step := jsonb_build_object(
    'player_card_id', v_res->'resolved_references'->>'player_card_id',
    'step_order', v_res->>'step_order',
    'to_tier', p_item->>'to_tier');
  IF v_step->>'step_order' IS NULL THEN
    v_step := v_step || jsonb_build_object('step_order', p_item->>'step_order');
  END IF;

  v_ver := public.admin_apply_evo_version(nullif(v_res->>'id','')::uuid, v_version, p_commit, v_step);

  RETURN v_res
    || jsonb_build_object('evo_card_version', v_ver)
    || jsonb_build_object(
      'operations', coalesce(v_res->'operations','[]'::jsonb) || coalesce(v_ver->'operations','[]'::jsonb),
      'destructive', coalesce(v_res->'destructive','[]'::jsonb) || coalesce(v_ver->'destructive','[]'::jsonb),
      'warnings', coalesce(v_res->'warnings','[]'::jsonb) || coalesce(v_ver->'warnings','[]'::jsonb));
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_apply_evo_core(p_item jsonb, p_commit boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item jsonb := p_item;
  v_id uuid; v_action text := lower(coalesce(p_item->>'action','upsert'));
  v_src uuid; v_dst uuid; v_step int; v_fields jsonb := '{}'::jsonb;
  v_from uuid; v_to uuid; v_from_stars int; v_to_stars int; v_from_name text; v_to_name text;
  v_ops jsonb := '[]'::jsonb; v_destr jsonb := '[]'::jsonb; v_warn jsonb := '[]'::jsonb;
  v_res jsonb; v_match text; v_n int; v_cursor uuid; v_hops int := 0;
  v_obj jsonb; v_rows jsonb := '[]'::jsonb; v_groups text[] := '{}'; v_idx int := 0;
  v_b jsonb; v_bid uuid; v_needs boolean; v_badges jsonb := '[]'::jsonb; v_traits jsonb := '[]'::jsonb;
  v_status text; v_key text; v_before jsonb;
  v_planned jsonb := '[]'::jsonb; v_inserted jsonb := '[]'::jsonb; v_obj_ops jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.admin_require_admin();

  v_id := nullif(coalesce(v_item->>'evo_path_id', v_item->>'id'), '')::uuid;
  IF v_id IS NOT NULL THEN
    SELECT player_card_id, step_order INTO v_src, v_step FROM evo_paths WHERE id = v_id;
    IF v_src IS NULL THEN RAISE EXCEPTION 'UNKNOWN_EVO_PATH_ID: %', v_id; END IF;
  END IF;

  -- source card
  IF v_item ? 'source' OR v_item ? 'player' OR v_item ? 'player_card_id' OR v_item ? 'player_name' THEN
    v_src := public.admin_resolve_card(coalesce(v_item->'source', v_item->'player',
      CASE WHEN v_item ? 'player_card_id' THEN jsonb_build_object('player_card_id', v_item->>'player_card_id')
           ELSE jsonb_build_object('name', v_item->>'player_name') END));
  END IF;
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'MISSING_SOURCE_CARD: supply source (player_card_id, card_key, or name + distinguishing fields)';
  END IF;

  -- destination card
  IF v_item ? 'destination' OR v_item ? 'evolves_to_card_id' OR v_item ? 'destination_player_ref' THEN
    v_dst := public.admin_resolve_card(coalesce(v_item->'destination', v_item->'destination_player_ref',
      jsonb_build_object('player_card_id', v_item->>'evolves_to_card_id')));
  ELSIF v_id IS NOT NULL THEN
    SELECT evolves_to_card_id INTO v_dst FROM evo_paths WHERE id = v_id;
  END IF;

  IF v_dst IS NOT NULL THEN
    IF v_dst = v_src THEN RAISE EXCEPTION 'SELF_EVOLUTION: a card cannot evolve into itself'; END IF;
    v_cursor := v_dst;
    WHILE v_cursor IS NOT NULL AND v_hops < 50 LOOP
      IF v_cursor = v_src THEN
        RAISE EXCEPTION 'CIRCULAR_EVOLUTION: this path would create a loop back to the source card';
      END IF;
      SELECT evolves_to_card_id INTO v_cursor FROM evo_paths
       WHERE player_card_id = v_cursor AND evolves_to_card_id IS NOT NULL
         AND (v_id IS NULL OR id <> v_id) ORDER BY step_order LIMIT 1;
      v_hops := v_hops + 1;
    END LOOP;
    SELECT status::text INTO v_status FROM player_cards WHERE id = v_dst;
    IF v_status IN ('draft','archived') THEN
      RAISE EXCEPTION 'EVO_TARGET_UNAVAILABLE: the destination card is % detail=%', v_status,
        jsonb_build_object('destination_card_id', v_dst, 'destination_status', v_status)::text;
    END IF;
    v_fields := v_fields || jsonb_build_object('evolves_to_card_id', v_dst);
  END IF;

  -- gem tiers
  IF v_item ? 'from_tier' THEN
    SELECT id, stars, name INTO v_from, v_from_stars, v_from_name FROM gem_tiers WHERE lower(name) = lower(v_item->>'from_tier');
    IF v_from IS NULL THEN RAISE EXCEPTION 'UNKNOWN_GEM_TIER: "%"', v_item->>'from_tier'; END IF;
    v_fields := v_fields || jsonb_build_object('from_tier_id', v_from);
  ELSIF v_item ? 'from_tier_id' THEN
    v_fields := v_fields || jsonb_build_object('from_tier_id', v_item->>'from_tier_id');
    SELECT stars, name INTO v_from_stars, v_from_name FROM gem_tiers WHERE id = (v_item->>'from_tier_id')::uuid;
  END IF;
  IF v_item ? 'to_tier' THEN
    SELECT id, stars, name INTO v_to, v_to_stars, v_to_name FROM gem_tiers WHERE lower(name) = lower(v_item->>'to_tier');
    IF v_to IS NULL THEN RAISE EXCEPTION 'UNKNOWN_GEM_TIER: "%"', v_item->>'to_tier'; END IF;
    v_fields := v_fields || jsonb_build_object('to_tier_id', v_to);
  ELSIF v_item ? 'to_tier_id' THEN
    v_fields := v_fields || jsonb_build_object('to_tier_id', v_item->>'to_tier_id');
    SELECT stars, name INTO v_to_stars, v_to_name FROM gem_tiers WHERE id = (v_item->>'to_tier_id')::uuid;
  END IF;
  IF v_from_stars IS NOT NULL AND v_to_stars IS NOT NULL AND v_to_stars <= v_from_stars
     AND NOT coalesce((v_item->>'tier_progression_override')::boolean, false) THEN
    RAISE EXCEPTION 'INVALID_TIER_PROGRESSION: % (% stars) does not progress to % (% stars); set tier_progression_override: true to allow it',
      v_from_name, v_from_stars, v_to_name, v_to_stars;
  END IF;

  -- step order / duplicate guard
  v_step := coalesce((v_item->>'step_order')::int, v_step);
  IF v_step IS NULL THEN
    SELECT coalesce(max(step_order), 0) + 1 INTO v_step FROM evo_paths WHERE player_card_id = v_src;
  END IF;
  SELECT count(*) INTO v_n FROM evo_paths
   WHERE player_card_id = v_src AND step_order = v_step AND (v_id IS NULL OR id <> v_id);
  IF v_n > 0 THEN
    IF v_id IS NULL AND v_action <> 'create' THEN
      SELECT id INTO v_id FROM evo_paths WHERE player_card_id = v_src AND step_order = v_step;
    ELSE
      RAISE EXCEPTION 'DUPLICATE_EVO_STEP: this card already has a step % detail=%', v_step,
        jsonb_build_object('player_card_id', v_src, 'step_order', v_step)::text;
    END IF;
  END IF;
  IF v_id IS NOT NULL AND v_action = 'create' THEN
    RAISE EXCEPTION 'ALREADY_EXISTS: an evo path already exists for this card and step; use action=update';
  END IF;
  IF v_id IS NULL AND v_action = 'update' THEN
    RAISE EXCEPTION 'NOT_FOUND: no evo path matches this card and step to update';
  END IF;
  v_fields := v_fields || jsonb_build_object('player_card_id', v_src, 'step_order', v_step);

  -- objective mode
  IF v_item ? 'objective_mode' THEN
    IF lower(v_item->>'objective_mode') NOT IN ('all','any') THEN
      RAISE EXCEPTION 'INVALID_OBJECTIVE_MODE: use "all" (every objective required) or "any" (one group is enough)';
    END IF;
    v_fields := v_fields || jsonb_build_object('objective_mode', lower(v_item->>'objective_mode'));
  END IF;

  -- stats validation
  IF v_item ? 'challenge_stat' AND v_item->>'challenge_stat' IS NOT NULL
     AND NOT (v_item->>'challenge_stat' = ANY(public.admin_stat_keys())) THEN
    RAISE EXCEPTION 'UNKNOWN_STAT_KEY: "%" detail=%', v_item->>'challenge_stat',
      jsonb_build_object('supported', public.admin_stat_keys())::text;
  END IF;
  IF v_item ? 'final_stats' THEN
    FOR v_key IN SELECT jsonb_object_keys(v_item->'final_stats') LOOP
      IF NOT (v_key = ANY(public.admin_stat_keys())) THEN
        RAISE EXCEPTION 'UNKNOWN_STAT_KEY: final_stats."%" is not a stat detail=%', v_key,
          jsonb_build_object('supported', public.admin_stat_keys())::text;
      END IF;
    END LOOP;
  END IF;
  IF v_item ? 'stat_boosts' THEN
    FOR v_key IN SELECT jsonb_object_keys(v_item->'stat_boosts') LOOP
      IF NOT (v_key = ANY(public.admin_stat_keys())) THEN
        RAISE EXCEPTION 'UNKNOWN_STAT_KEY: stat_boosts."%" is not a stat', v_key;
      END IF;
    END LOOP;
  END IF;

  -- badges / traits payloads
  IF v_item ? 'badges' THEN
    FOR v_b IN SELECT * FROM jsonb_array_elements(v_item->'badges') LOOP
      IF jsonb_typeof(v_b) = 'string' THEN v_b := jsonb_build_object('badge', v_b #>> '{}'); END IF;
      SELECT id INTO v_bid FROM badges WHERE lower(name) = lower(coalesce(v_b->>'badge', v_b->>'name'))
         OR lower(abbreviation) = lower(coalesce(v_b->>'badge', v_b->>'name'));
      IF v_bid IS NULL THEN RAISE EXCEPTION 'UNKNOWN_BADGE: "%"', coalesce(v_b->>'badge', v_b->>'name'); END IF;
      v_badges := v_badges || jsonb_build_array(jsonb_build_object('badge_id', v_bid,
        'name', coalesce(v_b->>'badge', v_b->>'name'), 'tier', coalesce(v_b->>'tier','base')));
    END LOOP;
    v_fields := v_fields || jsonb_build_object('new_badges', v_badges);
  END IF;
  IF v_item ? 'traits' THEN
    FOR v_b IN SELECT * FROM jsonb_array_elements(v_item->'traits') LOOP
      IF jsonb_typeof(v_b) = 'string' THEN v_b := jsonb_build_object('trait', v_b #>> '{}'); END IF;
      SELECT id, coalesce(requires_target_stat, false) INTO v_bid, v_needs FROM signature_traits
       WHERE lower(name) = lower(coalesce(v_b->>'trait', v_b->>'name'))
          OR lower(abbreviation) = lower(coalesce(v_b->>'trait', v_b->>'name'));
      IF v_bid IS NULL THEN RAISE EXCEPTION 'UNKNOWN_TRAIT: "%"', coalesce(v_b->>'trait', v_b->>'name'); END IF;
      IF v_needs AND nullif(btrim(coalesce(v_b->>'target_stat','')),'') IS NULL THEN
        RAISE EXCEPTION 'TRAIT_TARGET_STAT_REQUIRED: trait "%" needs target_stat', coalesce(v_b->>'trait', v_b->>'name');
      END IF;
      IF v_b ? 'target_stat' AND NOT (v_b->>'target_stat' = ANY(public.admin_stat_keys())) THEN
        RAISE EXCEPTION 'UNKNOWN_STAT_KEY: trait target_stat "%"', v_b->>'target_stat';
      END IF;
      v_traits := v_traits || jsonb_build_array(jsonb_build_object('trait_id', v_bid,
        'name', coalesce(v_b->>'trait', v_b->>'name'), 'tier', coalesce(v_b->>'tier','base'),
        'target_stat', v_b->>'target_stat'));
    END LOOP;
    v_fields := v_fields || jsonb_build_object('new_traits', v_traits);
  END IF;

  -- plain passthrough columns
  FOR v_key IN SELECT jsonb_object_keys(v_item) LOOP
    CONTINUE WHEN v_key = ANY(ARRAY['action','id','evo_path_id','source','destination','destination_player_ref',
      'player','player_name','player_card_id','from_tier','to_tier','badges','traits','objectives',
      'replace_objectives','temp_ref','step_order','objective_mode','evolves_to_card_id']);
    IF public.admin_has_column('evo_paths', v_key) THEN
      v_fields := v_fields || jsonb_build_object(v_key, v_item->v_key);
    ELSE
      v_warn := v_warn || jsonb_build_object('code','FIELD_IGNORED',
        'message', format('"%s" is not a field of evo_paths and was ignored', v_key));
    END IF;
  END LOOP;

  v_match := format('%s step %s', (SELECT name FROM player_cards WHERE id = v_src), v_step);
  v_res := public.admin_upsert_row('evo_paths', v_id, v_fields, v_match, p_commit, v_action);
  v_id := coalesce((v_res->>'id')::uuid, v_id);
  v_ops := v_ops || coalesce(v_res->'operations','[]'::jsonb);

  -- structured objectives
  IF v_item ? 'objectives' THEN
    IF jsonb_typeof(v_item->'objectives') <> 'array' THEN RAISE EXCEPTION 'INVALID_PAYLOAD: objectives must be an array'; END IF;
    FOR v_obj IN SELECT * FROM jsonb_array_elements(v_item->'objectives') LOOP
      v_idx := v_idx + 1;
      v_obj := public.admin_normalize_evo_objective(v_obj);
      IF (v_obj->>'target') IS NULL OR (v_obj->>'target')::numeric <= 0 THEN
        RAISE EXCEPTION 'INVALID_OBJECTIVE: target must be greater than 0 (objective %)', v_idx;
      END IF;
      IF v_obj ? 'stat_key' AND v_obj->>'stat_key' IS NOT NULL
         AND NOT (v_obj->>'stat_key' = ANY(public.admin_stat_keys())) THEN
        RAISE EXCEPTION 'UNKNOWN_STAT_KEY: objective % uses "%" detail=%', v_idx, v_obj->>'stat_key',
          jsonb_build_object('supported', public.admin_stat_keys())::text;
      END IF;
      IF coalesce(v_obj->>'scope','cumulative') NOT IN ('cumulative','single_game','per_season') THEN
        RAISE EXCEPTION 'INVALID_OBJECTIVE_SCOPE: use cumulative, single_game, or per_season';
      END IF;
      v_groups := v_groups || coalesce(v_obj->>'group_key','default');
      v_rows := v_rows || jsonb_build_array(jsonb_build_object(
        'group_key', coalesce(v_obj->>'group_key','default'), 'objective_type', v_obj->>'objective_type',
        'stat_key', v_obj->>'stat_key', 'scope', coalesce(v_obj->>'scope','cumulative'),
        'target', (v_obj->>'target')::numeric, 'description', v_obj->>'description',
        'sort_order', coalesce((v_obj->>'sort_order')::int, v_idx)));
    END LOOP;
    IF v_idx = 0 THEN
      v_warn := v_warn || jsonb_build_object('code','EVO_NO_OBJECTIVES',
        'message','objectives is empty: this evolution can never be completed');
    END IF;
    IF lower(coalesce(v_item->>'objective_mode','all')) = 'any'
       AND (SELECT count(DISTINCT g) FROM unnest(v_groups) g) < 2 THEN
      v_warn := v_warn || jsonb_build_object('code','ANY_MODE_SINGLE_GROUP',
        'message','objective_mode is "any" but every objective shares one group_key, so all of them are required');
    END IF;

    IF coalesce((v_item->>'replace_objectives')::boolean, true) THEN
      SELECT coalesce(jsonb_agg(jsonb_build_object('objective_type',objective_type,'stat_key',stat_key,
               'scope',scope,'target',target,'group_key',group_key) ORDER BY sort_order), '[]'::jsonb)
        INTO v_before FROM evo_objectives WHERE evo_path_id = v_id;
      v_destr := v_destr || jsonb_build_object('action','replace','label','DESTRUCTIVE_REPLACEMENT',
        'table','evo_objectives','parent_table','evo_paths','parent_id',v_id,'match',v_match,
        'message', format('the objective list is replaced with %s objective(s)', v_idx),
        'before', coalesce(v_before,'[]'::jsonb), 'after', v_rows);
      IF p_commit THEN DELETE FROM evo_objectives WHERE evo_path_id = v_id; END IF;
    END IF;

    IF p_commit AND v_idx > 0 THEN
      -- Immutable objective ids are generated exactly once here, supplied explicitly to
      -- the INSERT, and read back from the database so commit results, API responses and
      -- verification all reference the very same rows.
      SELECT coalesce(jsonb_agg(e || jsonb_build_object('id', gen_random_uuid())
                                ORDER BY (e->>'sort_order')::int), '[]'::jsonb)
        INTO v_planned FROM jsonb_array_elements(v_rows) e;

      WITH ins AS (
        INSERT INTO evo_objectives (id, evo_path_id, group_key, objective_type, stat_key, scope, target, description, sort_order)
        SELECT (e->>'id')::uuid, v_id, e->>'group_key', e->>'objective_type', e->>'stat_key', e->>'scope',
               (e->>'target')::numeric, e->>'description', (e->>'sort_order')::int
        FROM jsonb_array_elements(v_planned) e
        RETURNING id, evo_path_id, group_key, objective_type, stat_key, scope, target, sort_order
      )
      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'id', i.id, 'evo_path_id', i.evo_path_id, 'group_key', i.group_key,
               'objective_type', i.objective_type, 'stat_key', i.stat_key, 'scope', i.scope,
               'target', i.target, 'sort_order', i.sort_order) ORDER BY i.sort_order), '[]'::jsonb)
        INTO v_inserted FROM ins i;

      -- Validate what the database actually returned, before anything is verified elsewhere.
      IF jsonb_array_length(v_inserted) <> v_idx THEN
        RAISE EXCEPTION 'EVO_OBJECTIVE_INSERT_FAILED: expected % objective row(s), the database returned % detail=%',
          v_idx, jsonb_array_length(v_inserted),
          jsonb_build_object('stage','insert','table','evo_objectives','parent_table','evo_paths',
            'parent_id', v_id, 'expected_ids', (SELECT jsonb_agg(e->'id') FROM jsonb_array_elements(v_planned) e),
            'returned_ids', (SELECT jsonb_agg(e->'id') FROM jsonb_array_elements(v_inserted) e))::text;
      END IF;
      IF EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_planned) p
         WHERE NOT EXISTS (
           SELECT 1 FROM jsonb_array_elements(v_inserted) i
            WHERE i->>'id' = p->>'id'
              AND i->>'evo_path_id' = v_id::text
              AND i->>'objective_type' = p->>'objective_type'
              AND (i->>'target')::numeric = (p->>'target')::numeric
              AND (i->>'sort_order')::int = (p->>'sort_order')::int)) THEN
        RAISE EXCEPTION 'EVO_OBJECTIVE_INSERT_MISMATCH: inserted objective rows do not match the planned rows detail=%',
          jsonb_build_object('stage','insert_readback','table','evo_objectives','parent_table','evo_paths',
            'columns', jsonb_build_array('id','evo_path_id','objective_type','target','sort_order'),
            'expected_parent_id', v_id, 'planned', v_planned, 'inserted', v_inserted)::text;
      END IF;

      SELECT coalesce(jsonb_agg(jsonb_build_object(
               'action','insert','table','evo_objectives','id', i->>'id',
               'parent_table','evo_paths','parent_id', v_id, 'match', v_match,
               'expected_count', v_idx,
               'fields', jsonb_build_object(
                 'evo_path_id', v_id, 'group_key', i->>'group_key', 'objective_type', i->>'objective_type',
                 'stat_key', i->>'stat_key', 'scope', i->>'scope',
                 'target', (i->>'target')::numeric, 'sort_order', (i->>'sort_order')::int))), '[]'::jsonb)
        INTO v_obj_ops FROM jsonb_array_elements(v_inserted) i;
      v_ops := v_ops || v_obj_ops;
    ELSIF v_idx > 0 THEN
      -- Preview: zero writes, and no fabricated ids. Ids only exist after the insert.
      v_ops := v_ops || jsonb_build_array(jsonb_build_object(
        'action','planned_replace','table','evo_objectives','parent_table','evo_paths',
        'parent_id', v_id, 'match', v_match, 'expected_count', v_idx,
        'fields', jsonb_build_object('objectives', v_rows)));
    END IF;
  END IF;

  RETURN jsonb_build_object('kind','evo_path','id', v_id, 'match', v_match, 'action', v_res->>'action',
    'applied', p_commit, 'operations', v_ops, 'destructive', v_destr, 'warnings', v_warn,
    'evo_objectives', CASE WHEN p_commit THEN v_inserted ELSE v_rows END,
    'resolved_references', jsonb_build_object('player_card_id', v_src, 'evolves_to_card_id', v_dst),
    'normalized_fields', v_fields);
END $function$
;

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
  v_stale record; v_new uuid; v_step_ids jsonb := '[]'::jsonb;
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

  SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'step_order', step_order,
           'from_tier_id', from_tier_id, 'to_tier_id', to_tier_id,
           'objective_count', (SELECT count(*) FROM evo_objectives o WHERE o.evo_path_id = p.id),
           'version_id', (SELECT v.id FROM evo_card_versions v WHERE v.evo_path_id = p.id))
           ORDER BY step_order), '[]'::jsonb)
    INTO v_existing FROM evo_paths p WHERE player_card_id = v_src;

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

    -- A step created by this replacement is part of the authoritative path and
    -- must survive the stale-step sweep below.
    v_new := nullif(v_res->>'id','')::uuid;
    IF v_id IS NULL AND v_new IS NOT NULL THEN v_keep := v_keep || v_new; END IF;

    v_results := v_results || jsonb_build_array(v_res);
    v_ops := v_ops || coalesce(v_res->'operations','[]'::jsonb);
    v_destr := v_destr || coalesce(v_res->'destructive','[]'::jsonb);
    v_warn := v_warn || coalesce(v_res->'warnings','[]'::jsonb);
    IF v_res->>'id' IS NOT NULL THEN
      v_step_ids := v_step_ids || jsonb_build_array(jsonb_build_object(
        'evo_path_id', v_res->>'id', 'step_order', v_order, 'action', v_res->>'action'));
    END IF;
  END LOOP;

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
END $function$
;

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
  v_run := coalesce(p_version->'run_stats', p_version->'runs_stats', '{}'::jsonb);
  IF jsonb_typeof(v_run) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_PAYLOAD: resulting_version.run_stats must be an object mapping run_stat_* keys to numbers';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(v_run) LOOP
    IF v_key IN ('run_stats','runs_stats','stats') AND jsonb_typeof(v_run->v_key) = 'object' THEN
      v_run := (v_run - v_key) || (v_run->v_key);
    END IF;
  END LOOP;
  FOR v_key IN SELECT jsonb_object_keys(p_version) LOOP
    IF v_key = ANY(public.admin_run_stat_keys()) THEN v_run := v_run || jsonb_build_object(v_key, p_version->v_key); END IF;
  END LOOP;
  FOR v_key IN SELECT jsonb_object_keys(v_stats) LOOP
    IF v_key IN ('run_stats','runs_stats') AND jsonb_typeof(v_stats->v_key) = 'object' THEN
      v_run := v_run || (v_stats->v_key);
      v_stats := v_stats - v_key;
    ELSIF v_key = ANY(public.admin_run_stat_keys()) THEN
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
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_apply_extra(p_kind text, p_payload jsonb, p_commit boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_apply_extra_legacy(p_kind text, p_payload jsonb, p_commit boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_apply_player(p_payload jsonb, p_commit boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ops jsonb := '[]'::jsonb;
  v_destr jsonb := '[]'::jsonb;
  v_id uuid; v_name text; v_new_name text; v_key text; v_ref_txt text;
  v_tier uuid; v_team uuid; v_coll uuid; v_sub uuid; v_base uuid;
  v_gem_name text; v_rating numeric; v_band int; v_n int; v_el jsonb; v_ref uuid;
  v_badges jsonb := '[]'::jsonb;
  v_traits jsonb := '[]'::jsonb;
  v_fields jsonb;
  v_action text := lower(coalesce(p_payload->>'action','upsert'));
  v_tiers text[] := ARRAY['base','gold','hof','diamond','actolytrene'];
  v_stat_keys text[] := ARRAY['stat_3pt','stat_mid','stat_fin','stat_dnk','stat_ast','stat_stl','stat_reb','stat_blk','stat_int',
                              'run_stat_3pt','run_stat_mid','run_stat_fin','run_stat_dnk','run_stat_ast','run_stat_stl','run_stat_reb','run_stat_blk','run_stat_int'];
  v_k text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED: sign in first'; END IF;
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN RAISE EXCEPTION 'FORBIDDEN: admin role required'; END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN RAISE EXCEPTION 'INVALID_PAYLOAD: payload must be an object'; END IF;

  ----------------------------------------------------------------- resolve card
  v_ref_txt := coalesce(nullif(btrim(coalesce(p_payload->>'player_card_id','')),''),
                        nullif(btrim(coalesce(p_payload->>'player_id','')),''),
                        nullif(btrim(coalesce(p_payload->>'card_id','')),''),
                        nullif(btrim(coalesce(p_payload->>'id','')),''));
  IF v_ref_txt IS NOT NULL THEN
    IF v_ref_txt !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'INVALID_PLAYER_ID: "%" is not a uuid', v_ref_txt;
    END IF;
    SELECT id, name INTO v_id, v_name FROM player_cards WHERE id = v_ref_txt::uuid;
    IF v_id IS NULL THEN RAISE EXCEPTION 'UNKNOWN_PLAYER_ID: %', v_ref_txt; END IF;
  ELSIF nullif(btrim(coalesce(p_payload->>'card_key','')),'') IS NOT NULL THEN
    v_key := btrim(p_payload->>'card_key');
    SELECT id, name INTO v_id, v_name FROM player_cards WHERE lower(card_key) = lower(v_key);
    IF v_id IS NULL AND v_action = 'update' THEN RAISE EXCEPTION 'UNKNOWN_CARD_KEY: %', v_key; END IF;
    v_name := coalesce(v_name, btrim(coalesce(p_payload->>'name','')));
  ELSE
    v_name := btrim(coalesce(p_payload->>'name',''));
    IF v_name = '' THEN RAISE EXCEPTION 'MISSING_PLAYER_REF: supply player_card_id, card_key, or name'; END IF;
    SELECT count(*) INTO v_n FROM player_cards WHERE lower(name) = lower(v_name);
    IF v_n > 1 THEN
      RAISE EXCEPTION 'AMBIGUOUS_PLAYER_NAME: "%" matches % cards. Target one with player_card_id or card_key. matches=%',
        v_name, v_n, public.admin_player_matches(v_name)::text;
    END IF;
    IF v_n = 1 AND v_action <> 'create' THEN
      SELECT id INTO v_id FROM player_cards WHERE lower(name) = lower(v_name);
    END IF;
  END IF;

  IF v_action = 'update' AND v_id IS NULL THEN
    RAISE EXCEPTION 'UNKNOWN_PLAYER: no existing card matched for action="update"';
  END IF;
  IF v_action = 'create' AND v_id IS NOT NULL THEN
    RAISE EXCEPTION 'ALREADY_EXISTS: action="create" but card % already exists', v_id;
  END IF;
  IF v_id IS NULL AND coalesce(v_name,'') = '' THEN RAISE EXCEPTION 'MISSING_NAME: new cards require a name'; END IF;

  v_new_name := nullif(btrim(coalesce(p_payload->>'new_name','')), '');
  IF v_key IS NOT NULL AND v_id IS NULL THEN
    IF EXISTS (SELECT 1 FROM player_cards WHERE lower(card_key) = lower(v_key)) THEN
      RAISE EXCEPTION 'DUPLICATE_CARD_KEY: card_key "%" already exists', v_key;
    END IF;
  ELSIF v_key IS NOT NULL AND v_id IS NOT NULL AND p_payload ? 'new_card_key' THEN
    IF EXISTS (SELECT 1 FROM player_cards WHERE lower(card_key) = lower(btrim(p_payload->>'new_card_key')) AND id <> v_id) THEN
      RAISE EXCEPTION 'DUPLICATE_CARD_KEY: card_key "%" already exists', p_payload->>'new_card_key';
    END IF;
  END IF;

  ------------------------------------------------------------ resolve relations
  IF p_payload ? 'gem_tier_id' AND p_payload->>'gem_tier_id' IS NOT NULL THEN
    SELECT id INTO v_tier FROM gem_tiers WHERE id = (p_payload->>'gem_tier_id')::uuid;
    IF v_tier IS NULL THEN RAISE EXCEPTION 'UNKNOWN_GEM_TIER_ID: %', p_payload->>'gem_tier_id'; END IF;
  ELSIF p_payload ? 'gem_tier' AND p_payload->>'gem_tier' IS NOT NULL THEN
    SELECT id INTO v_tier FROM gem_tiers WHERE lower(name) = lower(btrim(p_payload->>'gem_tier'));
    IF v_tier IS NULL THEN
      RAISE EXCEPTION 'UNKNOWN_GEM_TIER: "%". Known tiers: %', p_payload->>'gem_tier',
        (SELECT string_agg(name, ', ' ORDER BY sort_order) FROM gem_tiers);
    END IF;
  END IF;

  -- gem_name is a display label; it must never be persisted without a real tier.
  v_gem_name := nullif(btrim(coalesce(p_payload->>'gem_name','')),'');
  v_rating := nullif(p_payload->>'rating','')::numeric;
  IF v_tier IS NULL AND v_gem_name IS NOT NULL THEN
    SELECT id INTO v_tier FROM gem_tiers WHERE lower(name) = lower(v_gem_name);
    IF v_tier IS NULL AND v_rating IS NOT NULL THEN
      v_band := floor(v_rating)::int;
      SELECT id INTO v_tier FROM gem_tiers WHERE stars = least(v_band, (SELECT max(stars) FROM gem_tiers));
    END IF;
    IF v_tier IS NULL AND v_id IS NOT NULL THEN
      SELECT gem_tier_id INTO v_tier FROM player_cards WHERE id = v_id;
    END IF;
    IF v_tier IS NULL THEN
      RAISE EXCEPTION 'GEM_TIER_UNRESOLVED: gem_name "%" does not match a gem tier and no rating was supplied to infer one. Send gem_tier (one of: %) or a rating.',
        v_gem_name, (SELECT string_agg(name, ', ' ORDER BY sort_order) FROM gem_tiers);
    END IF;
  END IF;

  IF p_payload ? 'team_id' THEN
    SELECT id INTO v_team FROM teams WHERE id = (p_payload->>'team_id')::uuid;
    IF v_team IS NULL THEN RAISE EXCEPTION 'UNKNOWN_TEAM_ID: %', p_payload->>'team_id'; END IF;
  ELSIF p_payload ? 'team' AND p_payload->>'team' IS NOT NULL THEN
    SELECT id INTO v_team FROM teams WHERE lower(name) = lower(btrim(p_payload->>'team'));
    IF v_team IS NULL THEN RAISE EXCEPTION 'UNKNOWN_TEAM: "%"', p_payload->>'team'; END IF;
  END IF;
  IF p_payload ? 'collection_id' THEN
    SELECT id INTO v_coll FROM collections WHERE id = (p_payload->>'collection_id')::uuid;
    IF v_coll IS NULL THEN RAISE EXCEPTION 'UNKNOWN_COLLECTION_ID: %', p_payload->>'collection_id'; END IF;
  ELSIF p_payload ? 'collection' AND p_payload->>'collection' IS NOT NULL THEN
    SELECT id INTO v_coll FROM collections WHERE lower(name) = lower(btrim(p_payload->>'collection'));
    IF v_coll IS NULL THEN RAISE EXCEPTION 'UNKNOWN_COLLECTION: "%"', p_payload->>'collection'; END IF;
  END IF;
  IF p_payload ? 'sub_collection_id' THEN
    SELECT id INTO v_sub FROM sub_collections WHERE id = (p_payload->>'sub_collection_id')::uuid;
    IF v_sub IS NULL THEN RAISE EXCEPTION 'UNKNOWN_SUB_COLLECTION_ID: %', p_payload->>'sub_collection_id'; END IF;
  ELSIF p_payload ? 'sub_collection' AND p_payload->>'sub_collection' IS NOT NULL THEN
    SELECT id INTO v_sub FROM sub_collections WHERE lower(name) = lower(btrim(p_payload->>'sub_collection'));
    IF v_sub IS NULL THEN RAISE EXCEPTION 'UNKNOWN_SUB_COLLECTION: "%"', p_payload->>'sub_collection'; END IF;
  END IF;
  IF p_payload ? 'base_card_id' THEN
    v_base := public.admin_resolve_player(p_payload->'base_card_id');
  END IF;

  FOREACH v_k IN ARRAY v_stat_keys LOOP
    IF p_payload ? v_k AND jsonb_typeof(p_payload->v_k) NOT IN ('number','null') THEN
      RAISE EXCEPTION 'INVALID_STAT: % must be a number', v_k;
    END IF;
  END LOOP;

  IF p_payload ? 'badges' THEN
    IF jsonb_typeof(p_payload->'badges') <> 'array' THEN RAISE EXCEPTION 'INVALID_BADGES: badges must be an array'; END IF;
    FOR v_el IN SELECT * FROM jsonb_array_elements(p_payload->'badges') LOOP
      IF v_el ? 'badge_id' THEN
        SELECT id INTO v_ref FROM badges WHERE id = (v_el->>'badge_id')::uuid;
        IF v_ref IS NULL THEN RAISE EXCEPTION 'UNKNOWN_BADGE_ID: %', v_el->>'badge_id'; END IF;
      ELSE
        SELECT id INTO v_ref FROM badges WHERE lower(name) = lower(btrim(v_el->>'badge')) OR lower(abbreviation) = lower(btrim(v_el->>'badge'));
        IF v_ref IS NULL THEN RAISE EXCEPTION 'UNKNOWN_BADGE: "%"', v_el->>'badge'; END IF;
      END IF;
      IF NOT (coalesce(v_el->>'tier','base') = ANY(v_tiers)) THEN
        RAISE EXCEPTION 'INVALID_BADGE_TIER: "%" (use base/gold/hof/diamond/actolytrene)', v_el->>'tier';
      END IF;
      v_badges := v_badges || jsonb_build_object('badge_id', v_ref, 'tier', coalesce(v_el->>'tier','base'), 'name', coalesce(v_el->>'badge', (SELECT name FROM badges WHERE id = v_ref)));
    END LOOP;
  END IF;

  IF p_payload ? 'traits' THEN
    IF jsonb_typeof(p_payload->'traits') <> 'array' THEN RAISE EXCEPTION 'INVALID_TRAITS: traits must be an array'; END IF;
    FOR v_el IN SELECT * FROM jsonb_array_elements(p_payload->'traits') LOOP
      IF v_el ? 'trait_id' THEN
        SELECT id INTO v_ref FROM signature_traits WHERE id = (v_el->>'trait_id')::uuid;
        IF v_ref IS NULL THEN RAISE EXCEPTION 'UNKNOWN_TRAIT_ID: %', v_el->>'trait_id'; END IF;
      ELSE
        SELECT id INTO v_ref FROM signature_traits WHERE lower(name) = lower(btrim(v_el->>'trait')) OR lower(abbreviation) = lower(btrim(v_el->>'trait'));
        IF v_ref IS NULL THEN RAISE EXCEPTION 'UNKNOWN_TRAIT: "%"', v_el->>'trait'; END IF;
      END IF;
      IF NOT (coalesce(v_el->>'tier','base') = ANY(v_tiers)) THEN
        RAISE EXCEPTION 'INVALID_TRAIT_TIER: "%"', v_el->>'tier';
      END IF;
      IF v_el ? 'target_stat' AND v_el->>'target_stat' IS NOT NULL
         AND NOT (v_el->>'target_stat' = ANY(ARRAY['stat_3pt','stat_mid','stat_fin','stat_dnk','stat_ast','stat_stl','stat_reb','stat_blk','stat_int'])) THEN
        RAISE EXCEPTION 'INVALID_TARGET_STAT: "%"', v_el->>'target_stat';
      END IF;
      v_traits := v_traits || jsonb_build_object('trait_id', v_ref, 'tier', coalesce(v_el->>'tier','base'), 'target_stat', v_el->>'target_stat', 'name', coalesce(v_el->>'trait', (SELECT name FROM signature_traits WHERE id = v_ref)));
    END LOOP;
  END IF;

  v_fields := jsonb_strip_nulls(jsonb_build_object(
    'name', coalesce(to_jsonb(v_new_name), CASE WHEN v_id IS NULL THEN to_jsonb(v_name) ELSE NULL END),
    'card_key', to_jsonb(coalesce(nullif(btrim(coalesce(p_payload->>'new_card_key','')),''), CASE WHEN v_id IS NULL THEN v_key ELSE NULL END)),
    'card_variant', p_payload->'card_variant',
    'evo_stage', p_payload->'evo_stage',
    'base_card_id', to_jsonb(v_base),
    'gem_tier_id', to_jsonb(v_tier),
    'gem_name', p_payload->'gem_name',
    'team_id', to_jsonb(v_team),
    'collection_id', to_jsonb(v_coll),
    'sub_collection_id', to_jsonb(v_sub),
    'position1', p_payload->'position1',
    'position2', p_payload->'position2',
    'rating', p_payload->'rating',
    'run_rating', p_payload->'run_rating',
    'market_value', p_payload->'market_value',
    'social_handle', p_payload->'social_handle',
    'avatar_url', p_payload->'avatar_url',
    'is_collection_reward', p_payload->'is_collection_reward',
    'card_color_primary', p_payload->'card_color_primary',
    'card_color_secondary', p_payload->'card_color_secondary',
    'card_glow_color', p_payload->'card_glow_color',
    'card_animation', p_payload->'card_animation'
  ));
  FOREACH v_k IN ARRAY v_stat_keys LOOP
    IF p_payload ? v_k THEN v_fields := v_fields || jsonb_build_object(v_k, p_payload->v_k); END IF;
  END LOOP;

  -- zero-write type contract: preview fails here instead of at commit
  PERFORM public.admin_assert_castable('player_cards', v_fields);

  v_ops := v_ops || jsonb_build_object(
    'table','player_cards',
    'action', CASE WHEN v_id IS NULL THEN 'insert' ELSE 'update' END,
    'id', v_id, 'match', coalesce(v_name, v_key),
    'fields', v_fields,
    'field_changes', public.admin_diff_fields('player_cards', v_id, v_fields));

  IF p_payload ? 'badges' THEN
    SELECT count(*) INTO v_n FROM player_card_badges WHERE player_card_id = v_id;
    v_destr := v_destr || jsonb_build_object('table','player_card_badges','action','replace','player', coalesce(v_name, v_key),
      'replaces_rows', coalesce(v_n,0), 'new_rows', jsonb_array_length(v_badges),
      'removed', coalesce((SELECT jsonb_agg(b.name) FROM player_card_badges pb JOIN badges b ON b.id = pb.badge_id
        WHERE pb.player_card_id = v_id AND NOT (pb.badge_id::text IN (SELECT jsonb_array_elements(v_badges)->>'badge_id'))), '[]'::jsonb),
      'new_assignments', v_badges);
  END IF;
  IF p_payload ? 'traits' THEN
    SELECT count(*) INTO v_n FROM player_card_traits WHERE player_card_id = v_id;
    v_destr := v_destr || jsonb_build_object('table','player_card_traits','action','replace','player', coalesce(v_name, v_key),
      'replaces_rows', coalesce(v_n,0), 'new_rows', jsonb_array_length(v_traits),
      'removed', coalesce((SELECT jsonb_agg(t.name) FROM player_card_traits pt JOIN signature_traits t ON t.id = pt.trait_id
        WHERE pt.player_card_id = v_id AND NOT (pt.trait_id::text IN (SELECT jsonb_array_elements(v_traits)->>'trait_id'))), '[]'::jsonb),
      'new_assignments', v_traits);
  END IF;

  IF p_commit THEN
    IF v_id IS NULL THEN
      INSERT INTO player_cards(name, card_key) VALUES (coalesce(v_new_name, v_name), coalesce(v_key, ''))
      RETURNING id INTO v_id;
    END IF;

    UPDATE player_cards SET
      name = coalesce(v_new_name, name),
      card_key = coalesce(nullif(btrim(coalesce(p_payload->>'new_card_key','')),''), card_key),
      card_variant = CASE WHEN p_payload ? 'card_variant' THEN p_payload->>'card_variant' ELSE card_variant END,
      evo_stage = coalesce((p_payload->>'evo_stage')::int, evo_stage),
      base_card_id = coalesce(v_base, base_card_id),
      gem_tier_id = coalesce(v_tier, gem_tier_id),
      gem_name = CASE WHEN p_payload ? 'gem_name' THEN p_payload->>'gem_name' ELSE gem_name END,
      team_id = coalesce(v_team, team_id),
      collection_id = coalesce(v_coll, collection_id),
      sub_collection_id = coalesce(v_sub, sub_collection_id),
      position1 = CASE WHEN p_payload ? 'position1' THEN p_payload->>'position1' ELSE position1 END,
      position2 = CASE WHEN p_payload ? 'position2' THEN p_payload->>'position2' ELSE position2 END,
      rating = coalesce((p_payload->>'rating')::numeric, rating),
      run_rating = CASE WHEN p_payload ? 'run_rating' THEN (p_payload->>'run_rating')::numeric ELSE run_rating END,
      market_value = coalesce((p_payload->>'market_value')::int, market_value),
      social_handle = CASE WHEN p_payload ? 'social_handle' THEN p_payload->>'social_handle' ELSE social_handle END,
      avatar_url = CASE WHEN p_payload ? 'avatar_url' THEN p_payload->>'avatar_url' ELSE avatar_url END,
      is_collection_reward = coalesce((p_payload->>'is_collection_reward')::boolean, is_collection_reward),
      card_color_primary = CASE WHEN p_payload ? 'card_color_primary' THEN p_payload->>'card_color_primary' ELSE card_color_primary END,
      card_color_secondary = CASE WHEN p_payload ? 'card_color_secondary' THEN p_payload->>'card_color_secondary' ELSE card_color_secondary END,
      card_glow_color = CASE WHEN p_payload ? 'card_glow_color' THEN p_payload->>'card_glow_color' ELSE card_glow_color END,
      card_animation = CASE WHEN p_payload ? 'card_animation' THEN p_payload->>'card_animation' ELSE card_animation END,
      stat_3pt = coalesce((p_payload->>'stat_3pt')::int, stat_3pt),
      stat_mid = coalesce((p_payload->>'stat_mid')::int, stat_mid),
      stat_fin = coalesce((p_payload->>'stat_fin')::int, stat_fin),
      stat_dnk = coalesce((p_payload->>'stat_dnk')::int, stat_dnk),
      stat_ast = coalesce((p_payload->>'stat_ast')::int, stat_ast),
      stat_stl = coalesce((p_payload->>'stat_stl')::int, stat_stl),
      stat_reb = coalesce((p_payload->>'stat_reb')::int, stat_reb),
      stat_blk = coalesce((p_payload->>'stat_blk')::int, stat_blk),
      stat_int = coalesce((p_payload->>'stat_int')::int, stat_int),
      run_stat_3pt = coalesce((p_payload->>'run_stat_3pt')::int, run_stat_3pt),
      run_stat_mid = coalesce((p_payload->>'run_stat_mid')::int, run_stat_mid),
      run_stat_fin = coalesce((p_payload->>'run_stat_fin')::int, run_stat_fin),
      run_stat_dnk = coalesce((p_payload->>'run_stat_dnk')::int, run_stat_dnk),
      run_stat_ast = coalesce((p_payload->>'run_stat_ast')::int, run_stat_ast),
      run_stat_stl = coalesce((p_payload->>'run_stat_stl')::int, run_stat_stl),
      run_stat_reb = coalesce((p_payload->>'run_stat_reb')::int, run_stat_reb),
      run_stat_blk = coalesce((p_payload->>'run_stat_blk')::int, run_stat_blk),
      run_stat_int = coalesce((p_payload->>'run_stat_int')::int, run_stat_int),
      updated_at = now()
    WHERE id = v_id;

    IF p_payload ? 'badges' THEN
      DELETE FROM player_card_badges WHERE player_card_id = v_id;
      INSERT INTO player_card_badges(player_card_id, badge_id, tier)
      SELECT v_id, (e->>'badge_id')::uuid, e->>'tier' FROM jsonb_array_elements(v_badges) e;
    END IF;
    IF p_payload ? 'traits' THEN
      DELETE FROM player_card_traits WHERE player_card_id = v_id;
      INSERT INTO player_card_traits(player_card_id, trait_id, tier, target_stat)
      SELECT v_id, (e->>'trait_id')::uuid, e->>'tier', e->>'target_stat' FROM jsonb_array_elements(v_traits) e;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'kind','player', 'mode', CASE WHEN p_commit THEN 'commit' ELSE 'preview' END,
    'applied', p_commit, 'player_id', v_id, 'id', v_id,
    'operations', v_ops, 'destructive', v_destr, 'destructive_operations', v_destr,
    'resolved_references', jsonb_strip_nulls(jsonb_build_object(
      'player_id', to_jsonb(v_id), 'gem_tier_id', to_jsonb(v_tier), 'team_id', to_jsonb(v_team),
      'collection_id', to_jsonb(v_coll), 'sub_collection_id', to_jsonb(v_sub))));
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_assert_castable(p_table text, p_fields jsonb)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE k text; v_type text; v_txt text; v_num numeric;
BEGIN
  IF p_fields IS NULL OR jsonb_typeof(p_fields) <> 'object' THEN RETURN; END IF;
  FOR k IN SELECT jsonb_object_keys(p_fields) LOOP
    v_type := public.admin_col_type(p_table, k);
    IF v_type IS NULL THEN
      RAISE EXCEPTION 'UNKNOWN_FIELD: "%" is not a column of %', k, p_table;
    END IF;
    CONTINUE WHEN v_type IN ('jsonb','json') OR v_type LIKE '%[]';
    CONTINUE WHEN jsonb_typeof(p_fields->k) = 'null';
    v_txt := p_fields->>k;
    CONTINUE WHEN v_txt IS NULL;

    IF v_type IN ('integer','bigint','smallint') THEN
      BEGIN
        v_num := v_txt::numeric;
      EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'INVALID_FIELD_TYPE: %.% expects a whole number, got "%"', p_table, k, v_txt;
      END;
      IF v_num <> trunc(v_num) THEN
        RAISE EXCEPTION 'INVALID_FIELD_TYPE: %.% is a whole-number column but received %. Send a whole number (this column cannot store decimals).', p_table, k, v_txt;
      END IF;
    END IF;

    BEGIN
      EXECUTE format('SELECT (($1->>%L)::%s)', k, v_type) USING p_fields;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'INVALID_FIELD_TYPE: %.% (%) cannot accept "%"', p_table, k, v_type, v_txt;
    END;
  END LOOP;
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_audit_write(p_content_type text, p_operation_type text, p_scope_id uuid, p_scope_label text, p_token text, p_payload jsonb, p_before jsonb, p_after jsonb, p_created jsonb, p_updated jsonb, p_deleted jsonb, p_warnings jsonb, p_verification jsonb, p_restored_from uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_consume_preview_token(p_kind text, p_token text, p_payload jsonb, p_fingerprint text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_content_restore_payload(p_audit_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_delete_domination_game(p_payload jsonb, p_commit boolean DEFAULT false, p_preview_token text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_delete_entity(p_entity_type text, p_entity_id uuid, p_force boolean DEFAULT false, p_commit boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_meta jsonb; v_tbl text; v_name text; v_refs jsonb; v_protected jsonb := '[]'::jsonb; r record;
BEGIN
  PERFORM public.admin_require_admin();
  v_meta := public.admin_entity_meta(p_entity_type);
  v_tbl := v_meta->>'table';
  EXECUTE format('SELECT %s FROM public.%I WHERE id = $1',
    CASE WHEN v_meta ? 'name_column' THEN format('%I::text', v_meta->>'name_column') ELSE 'id::text' END, v_tbl)
    INTO v_name USING p_entity_id;
  IF v_name IS NULL THEN RAISE EXCEPTION 'UNKNOWN_ENTITY: % %', p_entity_type, p_entity_id; END IF;

  v_refs := public.admin_usage(p_entity_type, p_entity_id);
  FOR r IN SELECT * FROM jsonb_array_elements(v_refs) e(v) LOOP
    IF coalesce((r.v->>'is_protected')::boolean, true) THEN v_protected := v_protected || r.v; END IF;
  END LOOP;

  IF p_commit THEN
    IF jsonb_array_length(v_protected) > 0 AND NOT p_force THEN
      RAISE EXCEPTION 'PROTECTED_DEPENDENCIES: % reference(s) still point at this % — resolve them or commit with force: true',
        jsonb_array_length(v_protected), p_entity_type;
    END IF;
    EXECUTE format('DELETE FROM public.%I WHERE id = $1', v_tbl) USING p_entity_id;
  END IF;

  RETURN jsonb_build_object('entity_type', p_entity_type, 'entity_id', p_entity_id, 'entity_name', v_name,
    'applied', p_commit, 'force', p_force,
    'dependency_count', jsonb_array_length(v_refs), 'dependencies', v_refs,
    'protected_dependencies', v_protected,
    'recommendation', CASE WHEN jsonb_array_length(v_protected) > 0
      THEN 'Prefer archiving: this record is still referenced by live content.'
      ELSE 'Safe to hard delete; nothing references it.' END,
    'destructive', jsonb_build_array(jsonb_build_object('action','delete','table',v_tbl,'id',p_entity_id,
      'match', v_name, 'label','DESTRUCTIVE_REPLACEMENT')));
END $function$
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
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_duplicate_player_names()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  PERFORM public.admin_require_admin();
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'normalized_name'), '[]'::jsonb) INTO v FROM (
    SELECT jsonb_build_object('normalized_name', lower(btrim(pc.name)), 'count', count(*),
      'versions', jsonb_agg(jsonb_build_object('player_card_id',pc.id,'card_key',pc.card_key,'name',pc.name,
        'rating',pc.rating,'gem_tier',gt.name,'team',tm.name,'collection',c.name,'sub_collection',sc.name,
        'card_variant',pc.card_variant,'evo_stage',pc.evo_stage,'status',pc.status) ORDER BY pc.evo_stage, pc.rating DESC)) AS x
    FROM player_cards pc
    LEFT JOIN gem_tiers gt ON gt.id = pc.gem_tier_id
    LEFT JOIN teams tm ON tm.id = pc.team_id
    LEFT JOIN collections c ON c.id = pc.collection_id
    LEFT JOIN sub_collections sc ON sc.id = pc.sub_collection_id
    GROUP BY lower(btrim(pc.name)) HAVING count(*) > 1) s;
  RETURN jsonb_build_object('count', jsonb_array_length(v), 'groups', v);
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

CREATE OR REPLACE FUNCTION public.admin_entity_meta(p_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  v := (jsonb_build_object(
    'player_card',      jsonb_build_object('table','player_cards','name_column','name','key_column','card_key'),
    'pack',             jsonb_build_object('table','packs','name_column','name'),
    'collection',       jsonb_build_object('table','collections','name_column','name'),
    'sub_collection',   jsonb_build_object('table','sub_collections','name_column','name'),
    'team',             jsonb_build_object('table','teams','name_column','name'),
    'run',              jsonb_build_object('table','runs','name_column','name'),
    'challenge',        jsonb_build_object('table','challenges','name_column','name'),
    'storyline',        jsonb_build_object('table','storylines','name_column','title'),
    'domination_road',  jsonb_build_object('table','domination_roads','name_column','name','key_column','slug'),
    'domination_game',  jsonb_build_object('table','domination_games','name_column','opponent_name'),
    'evo_path',         jsonb_build_object('table','evo_paths'),
    'gem_task',         jsonb_build_object('table','gem_tasks','name_column','title'),
    'badge',            jsonb_build_object('table','badges','name_column','name'),
    'signature_trait',  jsonb_build_object('table','signature_traits','name_column','name'),
    'gem_tier',         jsonb_build_object('table','gem_tiers','name_column','name'),
    'social_post',      jsonb_build_object('table','social_posts'),
    'location_account', jsonb_build_object('table','location_accounts','name_column','name'),
    'release_bundle',   jsonb_build_object('table','release_bundles','name_column','name','key_column','slug'),
    'locker_code',      jsonb_build_object('table','locker_codes','name_column','code'),
    'dynamic_duo',      jsonb_build_object('table','dynamic_duos','name_column','name'),
    'gem_market_listing', jsonb_build_object('table','gem_market_listings')
  ))->p_type;
  IF v IS NULL THEN RAISE EXCEPTION 'UNKNOWN_ENTITY_TYPE: %', p_type; END IF;
  RETURN v || jsonb_build_object('lifecycle', public.admin_has_column(v->>'table','status'));
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

CREATE OR REPLACE FUNCTION public.admin_evo_version_audit()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$
;

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
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_install_lifecycle(p_table text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  EXECUTE format('ALTER TABLE public.%I
      ADD COLUMN IF NOT EXISTS status public.content_status NOT NULL DEFAULT ''active'',
      ADD COLUMN IF NOT EXISTS publish_at timestamptz,
      ADD COLUMN IF NOT EXISTS starts_at timestamptz,
      ADD COLUMN IF NOT EXISTS ends_at timestamptz,
      ADD COLUMN IF NOT EXISTS disabled_at timestamptz,
      ADD COLUMN IF NOT EXISTS archived_at timestamptz', p_table);
  EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (status)', p_table || '_status_idx', p_table);
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_issue_preview_token(p_kind text, p_payload jsonb, p_fingerprint text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_token text;
BEGIN
  DELETE FROM public.admin_preview_tokens
   WHERE user_id = auth.uid() AND consumed_at IS NULL AND kind = p_kind;
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  INSERT INTO public.admin_preview_tokens (user_id, kind, token, payload_hash, normalized_payload, expires_at)
  VALUES (auth.uid(), p_kind, v_token, public.admin_canonical_hash(p_payload),
          jsonb_build_object('payload', public.admin_canonical_json(p_payload),
                             'scope_fingerprint', coalesce(p_fingerprint, '')),
          now() + interval '30 minutes');
  RETURN v_token;
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_lifecycle_apply(p_entity_type text, p_entity_id uuid, p_status text, p_dates jsonb DEFAULT '{}'::jsonb, p_commit boolean DEFAULT false, p_override boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_meta jsonb; v_tbl text; v_from text; v_name text; v_sets text[] := '{}'; v_warn jsonb := '[]'::jsonb;
  v_draft_deps jsonb := '[]'::jsonb; r record;
BEGIN
  PERFORM public.admin_require_admin();
  v_meta := public.admin_entity_meta(p_entity_type);
  v_tbl := v_meta->>'table';
  IF NOT (v_meta->>'lifecycle')::boolean THEN RAISE EXCEPTION 'NO_LIFECYCLE: % has no lifecycle fields', p_entity_type; END IF;
  IF p_status IS NOT NULL AND p_status NOT IN ('draft','scheduled','active','disabled','archived') THEN
    RAISE EXCEPTION 'INVALID_STATUS: %', p_status;
  END IF;

  EXECUTE format('SELECT status::text, %s FROM public.%I WHERE id = $1',
    CASE WHEN v_meta ? 'name_column' THEN format('%I::text', v_meta->>'name_column') ELSE 'id::text' END, v_tbl)
    INTO v_from, v_name USING p_entity_id;
  IF v_from IS NULL THEN RAISE EXCEPTION 'UNKNOWN_ENTITY: % %', p_entity_type, p_entity_id; END IF;

  IF p_status IN ('active','scheduled') THEN
    FOR r IN SELECT * FROM jsonb_array_elements(public.admin_usage(p_entity_type, p_entity_id)) e(v) LOOP
      IF (r.v->>'status') IN ('draft','archived') THEN
        v_draft_deps := v_draft_deps || r.v;
      END IF;
    END LOOP;
    IF jsonb_array_length(v_draft_deps) > 0 AND NOT p_override THEN
      v_warn := v_warn || jsonb_build_object('code','DEPENDENCY_NOT_PUBLISHABLE',
        'message','related records are draft or archived; pass override: true to publish anyway',
        'dependencies', v_draft_deps);
    END IF;
  END IF;

  IF p_status IS NOT NULL THEN v_sets := v_sets || format('status = %L::public.content_status', p_status); END IF;
  IF p_status = 'archived' THEN v_sets := v_sets || 'archived_at = now()';
  ELSIF p_status = 'disabled' THEN v_sets := v_sets || 'disabled_at = now()';
  ELSIF p_status = 'active' THEN v_sets := v_sets || 'archived_at = NULL, disabled_at = NULL';
  END IF;
  IF p_dates ? 'publish_at' THEN v_sets := v_sets || format('publish_at = %L::timestamptz', p_dates->>'publish_at'); END IF;
  IF p_dates ? 'starts_at' THEN v_sets := v_sets || format('starts_at = %L::timestamptz', p_dates->>'starts_at'); END IF;
  IF p_dates ? 'ends_at' THEN v_sets := v_sets || format('ends_at = %L::timestamptz', p_dates->>'ends_at'); END IF;

  IF p_commit AND array_length(v_sets,1) > 0 THEN
    EXECUTE format('UPDATE public.%I SET %s WHERE id = $1', v_tbl, array_to_string(v_sets, ', ')) USING p_entity_id;
    INSERT INTO lifecycle_history(entity_type, entity_id, from_status, to_status, changed_by)
    VALUES (p_entity_type, p_entity_id, v_from, coalesce(p_status, v_from), auth.uid());
  END IF;

  RETURN jsonb_build_object('entity_type', p_entity_type, 'entity_id', p_entity_id, 'entity_name', v_name,
    'from_status', v_from, 'to_status', coalesce(p_status, v_from), 'dates', p_dates,
    'applied', p_commit, 'warnings', v_warn,
    'operations', jsonb_build_array(jsonb_build_object('action','update','table',v_tbl,'id',p_entity_id,
      'match', v_name, 'fields', jsonb_build_object('status', coalesce(p_status, v_from)) || coalesce(p_dates,'{}'::jsonb))));
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_normalize_evo_objective(p_obj jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key text; v_type text; v_stat text; v_target numeric;
  v_reg_type text; v_reg_stat text;
BEGIN
  IF p_obj IS NULL OR jsonb_typeof(p_obj) <> 'object' THEN
    RAISE EXCEPTION 'INVALID_OBJECTIVE: each objective must be an object such as {"stat":"points","amount":250} detail=%',
      jsonb_build_object('supported_stats', public.admin_evo_objective_keys())::text;
  END IF;
  v_key := lower(btrim(coalesce(p_obj->>'key', p_obj->>'stat', p_obj->>'statistic', p_obj->>'objective', '')));
  v_key := regexp_replace(v_key, '[[:space:]-]+', '_', 'g');
  v_type := nullif(btrim(coalesce(p_obj->>'objective_type','')), '');
  v_stat := nullif(btrim(coalesce(p_obj->>'stat_key','')), '');
  v_target := nullif(btrim(coalesce(p_obj->>'target', p_obj->>'amount', p_obj->>'target_value', p_obj->>'value', '')), '')::numeric;

  IF v_key <> '' THEN
    SELECT objective_type, stat_key INTO v_reg_type, v_reg_stat
      FROM public.evo_objective_registry WHERE key = v_key;
    IF v_reg_type IS NULL AND v_type IS NULL THEN
      RAISE EXCEPTION 'UNSUPPORTED_EVO_OBJECTIVE: "%" is not a tracked objective detail=%', v_key,
        jsonb_build_object('field','objectives[].stat','supported', public.admin_evo_objective_keys(),
          'remediation','Use one of the supported objective stats, or send objective_type/stat_key explicitly.')::text;
    END IF;
    v_type := coalesce(v_type, v_reg_type);
    v_stat := coalesce(v_stat, v_reg_stat);
  END IF;

  IF v_type IS NULL THEN
    RAISE EXCEPTION 'INVALID_OBJECTIVE: supply stat (one of %) or an explicit objective_type detail=%',
      array_to_string(public.admin_evo_objective_keys(), ', '),
      jsonb_build_object('field','objectives[].stat','supported', public.admin_evo_objective_keys())::text;
  END IF;
  IF v_target IS NULL OR v_target <= 0 THEN
    RAISE EXCEPTION 'INVALID_OBJECTIVE: amount must be greater than 0 for objective "%" detail=%',
      coalesce(nullif(v_key,''), v_type),
      jsonb_build_object('field','objectives[].amount','received', coalesce(p_obj->>'amount', p_obj->>'target'))::text;
  END IF;

  RETURN (p_obj - 'stat' - 'amount' - 'statistic' - 'objective' - 'target_value' - 'value')
    || jsonb_strip_nulls(jsonb_build_object(
         'objective_type', v_type,
         'stat_key', v_stat,
         'target', v_target,
         'key', nullif(v_key,'')));
END
$function$
;

CREATE OR REPLACE FUNCTION public.admin_patch_evo_step(p_item jsonb, p_commit boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_patch_evo_version(p_item jsonb, p_commit boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid; v_row public.evo_card_versions%ROWTYPE;
  v_fields jsonb := '{}'::jsonb; v_key text; v_num numeric; v_tier uuid; v_status text;
  v_match text; v_res jsonb; v_ops jsonb := '[]'::jsonb; v_destr jsonb := '[]'::jsonb;
  v_badges jsonb := '[]'::jsonb; v_traits jsonb := '[]'::jsonb; v_before jsonb;
  v_b jsonb; v_bid uuid; v_needs boolean; v_stats jsonb; v_run jsonb; v_k text;
  v_base text[] := public.admin_base_stat_keys();
  v_runk text[] := public.admin_run_stat_keys();
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
    IF NOT (v_key = ANY(v_allowed)) AND NOT (v_key = ANY(v_base)) AND NOT (v_key = ANY(v_runk)) THEN
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

  -- base stats: nested stats{} and/or flat stat_* keys, star point scale 0..99
  v_stats := coalesce(p_item->'stats', '{}'::jsonb);
  FOREACH v_k IN ARRAY v_base LOOP
    IF p_item ? v_k THEN v_stats := v_stats || jsonb_build_object(v_k, p_item->v_k); END IF;
  END LOOP;
  FOR v_k IN SELECT jsonb_object_keys(v_stats) LOOP
    IF NOT (v_k = ANY(v_base)) THEN
      RAISE EXCEPTION 'UNKNOWN_STAT_KEY: "%" detail=%', v_k, jsonb_build_object('supported', v_base)::text;
    END IF;
    v_num := (v_stats->>v_k)::numeric;
    IF v_num < 0 OR v_num > 99 THEN RAISE EXCEPTION 'STAT_OUT_OF_RANGE: % = % must be 0..99', v_k, v_num; END IF;
    v_fields := v_fields || jsonb_build_object(v_k, v_stats->v_k);
  END LOOP;

  -- Runs stats: nested run_stats{} (bare or prefixed) and/or flat run_stat_* keys, 0..139
  v_run := '{}'::jsonb;
  FOR v_k IN SELECT jsonb_object_keys(coalesce(p_item->'run_stats','{}'::jsonb)) LOOP
    IF v_k = ANY(v_runk) THEN
      v_run := v_run || jsonb_build_object(v_k, p_item->'run_stats'->v_k);
    ELSIF ('run_' || v_k) = ANY(v_runk) THEN
      v_run := v_run || jsonb_build_object('run_' || v_k, p_item->'run_stats'->v_k);
    ELSE
      RAISE EXCEPTION 'UNKNOWN_RUN_STAT_KEY: "%" detail=%', v_k, jsonb_build_object('supported', v_runk)::text;
    END IF;
  END LOOP;
  FOREACH v_k IN ARRAY v_runk LOOP
    IF p_item ? v_k THEN v_run := v_run || jsonb_build_object(v_k, p_item->v_k); END IF;
  END LOOP;
  FOR v_k IN SELECT jsonb_object_keys(v_run) LOOP
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
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_pending_refs(p_item jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  v_out jsonb := '{}'::jsonb; v_k text; v_v jsonb; v_child jsonb; v_el jsonb;
BEGIN
  IF p_item IS NULL OR jsonb_typeof(p_item) <> 'object' THEN RETURN v_out; END IF;
  FOR v_k, v_v IN SELECT key, value FROM jsonb_each(p_item) LOOP
    IF v_k ~ '_pending$' THEN
      v_out := v_out || jsonb_build_object(v_k, v_v);
    ELSIF jsonb_typeof(v_v) = 'object' THEN
      v_child := public.admin_pending_refs(v_v);
      IF v_child <> '{}'::jsonb THEN v_out := v_out || jsonb_build_object(v_k, v_child); END IF;
    ELSIF jsonb_typeof(v_v) = 'array' THEN
      FOR v_el IN SELECT * FROM jsonb_array_elements(v_v) LOOP
        IF jsonb_typeof(v_el) = 'object' THEN
          v_child := public.admin_pending_refs(v_el);
          IF v_child <> '{}'::jsonb THEN v_out := v_out || jsonb_build_object(v_k, v_child); END IF;
        END IF;
      END LOOP;
    END IF;
  END LOOP;
  RETURN v_out;
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_player_usage(p_card_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_card jsonb; v_refs jsonb; v_versions jsonb;
BEGIN
  PERFORM public.admin_require_admin();
  SELECT jsonb_build_object('player_card_id',pc.id,'card_key',pc.card_key,'name',pc.name,'rating',pc.rating,
           'gem_tier', gt.name, 'team', tm.name, 'collection', c.name, 'sub_collection', sc.name,
           'card_variant', pc.card_variant, 'evo_stage', pc.evo_stage, 'status', pc.status)
    INTO v_card
  FROM player_cards pc
  LEFT JOIN gem_tiers gt ON gt.id = pc.gem_tier_id
  LEFT JOIN teams tm ON tm.id = pc.team_id
  LEFT JOIN collections c ON c.id = pc.collection_id
  LEFT JOIN sub_collections sc ON sc.id = pc.sub_collection_id
  WHERE pc.id = p_card_id;
  IF v_card IS NULL THEN RAISE EXCEPTION 'UNKNOWN_PLAYER_CARD_ID: %', p_card_id; END IF;

  v_refs := public.admin_usage('player_card', p_card_id);
  SELECT coalesce(jsonb_agg(jsonb_build_object('player_card_id',pc.id,'card_key',pc.card_key,'name',pc.name,
           'rating',pc.rating,'gem_tier',gt.name,'card_variant',pc.card_variant,'evo_stage',pc.evo_stage,
           'status',pc.status) ORDER BY pc.evo_stage, pc.rating), '[]'::jsonb)
    INTO v_versions
  FROM player_cards pc LEFT JOIN gem_tiers gt ON gt.id = pc.gem_tier_id
  WHERE lower(btrim(pc.name)) = lower(btrim(v_card->>'name'));

  RETURN jsonb_build_object('card', v_card, 'all_versions_of_name', v_versions,
    'reference_count', jsonb_array_length(v_refs), 'references', v_refs,
    'is_unused', jsonb_array_length(v_refs) = 0);
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_rename_apply(p_entity_type text, p_entity_id uuid, p_new_name text, p_new_key text DEFAULT NULL::text, p_commit boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_meta jsonb; v_tbl text; v_ncol text; v_kcol text; v_old text; v_oldkey text;
  v_dupes int := 0; v_refs jsonb; v_sets text[] := '{}'; v_warn jsonb := '[]'::jsonb; v_extra jsonb := '{}'::jsonb;
BEGIN
  PERFORM public.admin_require_admin();
  IF p_new_name IS NULL AND p_new_key IS NULL THEN RAISE EXCEPTION 'NOTHING_TO_RENAME: supply new_name and/or new_key'; END IF;
  v_meta := public.admin_entity_meta(p_entity_type);
  v_tbl := v_meta->>'table'; v_ncol := v_meta->>'name_column'; v_kcol := v_meta->>'key_column';
  IF v_ncol IS NULL AND p_new_name IS NOT NULL THEN RAISE EXCEPTION 'NOT_RENAMEABLE: % has no display name column', p_entity_type; END IF;

  EXECUTE format('SELECT %s, %s FROM public.%I WHERE id = $1',
    coalesce(format('%I::text', v_ncol), 'NULL::text'),
    coalesce(format('%I::text', v_kcol), 'NULL::text'), v_tbl) INTO v_old, v_oldkey USING p_entity_id;
  IF v_old IS NULL AND v_oldkey IS NULL THEN RAISE EXCEPTION 'UNKNOWN_ENTITY: % %', p_entity_type, p_entity_id; END IF;

  IF p_new_name IS NOT NULL THEN
    EXECUTE format('SELECT count(*) FROM public.%I WHERE lower(btrim(%I::text)) = lower(btrim($1)) AND id <> $2',
      v_tbl, v_ncol) INTO v_dupes USING p_new_name, p_entity_id;
    IF v_dupes > 0 THEN
      IF p_entity_type = 'player_card' THEN
        v_warn := v_warn || jsonb_build_object('code','DUPLICATE_DISPLAY_NAME','message',
          format('%s other card(s) already use the name "%s" — legal for cards, but future name-only targeting of this card will be rejected as ambiguous', v_dupes, p_new_name));
      ELSE
        RAISE EXCEPTION 'NAME_TAKEN: % other %s record(s) already use "%s"', v_dupes, p_entity_type, p_new_name;
      END IF;
    END IF;
    v_sets := v_sets || format('%I = %L', v_ncol, p_new_name);
  END IF;

  IF p_new_key IS NOT NULL THEN
    IF v_kcol IS NULL THEN RAISE EXCEPTION 'NO_KEY_COLUMN: % has no canonical key', p_entity_type; END IF;
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %I = $1 AND id <> $2', v_tbl, v_kcol)
      INTO v_dupes USING p_new_key, p_entity_id;
    IF v_dupes > 0 THEN RAISE EXCEPTION 'KEY_TAKEN: %s "%s" is already used', v_kcol, p_new_key; END IF;
    v_sets := v_sets || format('%I = %L', v_kcol, p_new_key);
  END IF;

  v_refs := public.admin_usage(p_entity_type, p_entity_id);

  IF p_commit THEN
    EXECUTE format('UPDATE public.%I SET %s WHERE id = $1', v_tbl, array_to_string(v_sets, ', ')) USING p_entity_id;
    -- refresh intentionally denormalized display-name caches
    IF p_entity_type = 'domination_road' AND p_new_name IS NOT NULL THEN
      UPDATE domination_games SET road_name = p_new_name WHERE road_id = p_entity_id;
      v_extra := v_extra || jsonb_build_object('domination_games_road_name_refreshed',
        (SELECT count(*) FROM domination_games WHERE road_id = p_entity_id));
    END IF;
    IF p_entity_type = 'player_card' AND p_new_name IS NOT NULL THEN
      UPDATE player_cards SET gem_name = gem_name WHERE id = p_entity_id;
    END IF;
  END IF;

  RETURN jsonb_build_object('entity_type', p_entity_type, 'entity_id', p_entity_id,
    'old_name', v_old, 'new_name', coalesce(p_new_name, v_old),
    'old_key', v_oldkey, 'new_key', coalesce(p_new_key, v_oldkey),
    'applied', p_commit, 'warnings', v_warn, 'side_effects', v_extra,
    'dependent_records', v_refs, 'dependent_count', jsonb_array_length(v_refs),
    'operations', jsonb_build_array(jsonb_build_object('action','update','table',v_tbl,'id',p_entity_id,
      'match', v_old, 'fields', jsonb_strip_nulls(jsonb_build_object('name', p_new_name, 'key', p_new_key)))));
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_rename_domination_opponent(p_game_id uuid, p_road_id uuid, p_game_order integer, p_new_name text, p_commit boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_old text; v_road text; v_order int;
BEGIN
  PERFORM public.admin_require_admin();
  IF p_new_name IS NULL OR btrim(p_new_name) = '' THEN RAISE EXCEPTION 'INVALID_PAYLOAD: new_opponent_name required'; END IF;
  IF p_game_id IS NOT NULL THEN
    SELECT id, opponent_name, road_name, game_order INTO v_id, v_old, v_road, v_order FROM domination_games WHERE id = p_game_id;
    IF v_id IS NULL THEN RAISE EXCEPTION 'UNKNOWN_DOMINATION_GAME_ID: %', p_game_id; END IF;
  ELSIF p_road_id IS NOT NULL AND p_game_order IS NOT NULL THEN
    SELECT id, opponent_name, road_name, game_order INTO v_id, v_old, v_road, v_order
    FROM domination_games WHERE road_id = p_road_id AND game_order = p_game_order;
    IF v_id IS NULL THEN RAISE EXCEPTION 'UNKNOWN_DOMINATION_GAME: road % order %', p_road_id, p_game_order; END IF;
  ELSE
    RAISE EXCEPTION 'AMBIGUOUS_TARGET: supply domination_game_id, or road_id + game_order. Opponent names repeat across rematches and are never a valid key.';
  END IF;
  IF p_commit THEN UPDATE domination_games SET opponent_name = p_new_name WHERE id = v_id; END IF;
  RETURN jsonb_build_object('domination_game_id', v_id, 'road_name', v_road, 'game_order', v_order,
    'old_opponent_name', v_old, 'new_opponent_name', p_new_name, 'applied', p_commit, 'scope','single_game',
    'operations', jsonb_build_array(jsonb_build_object('action','update','table','domination_games','id',v_id,
      'match', format('%s game %s', v_road, v_order), 'fields', jsonb_build_object('opponent_name', p_new_name))));
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_repair_evo_version_runs(p_commit boolean DEFAULT false, p_version_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$
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

CREATE OR REPLACE FUNCTION public.admin_resolve_pack(p_ref jsonb, p_game_order integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

CREATE OR REPLACE FUNCTION public.admin_resolve_player_ids(p_names jsonb)
 RETURNS uuid[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_ids uuid[] := '{}'; v_el jsonb;
BEGIN
  IF p_names IS NULL OR jsonb_typeof(p_names) <> 'array' THEN RETURN v_ids; END IF;
  FOR v_el IN SELECT * FROM jsonb_array_elements(p_names) LOOP
    v_ids := v_ids || public.admin_resolve_player(v_el);
  END LOOP;
  RETURN v_ids;
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_reward_validate(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_err jsonb := '[]'::jsonb; v_warn jsonb := '[]'::jsonb;
  v_items jsonb; v_it jsonb; v_type text; v_mode text; v_weight numeric := 0; v_has_weight boolean := false;
  v_resolved jsonb := '[]'::jsonb; v_st text; v_name text;
BEGIN
  IF p_payload IS NULL OR p_payload = 'null'::jsonb THEN
    RETURN jsonb_build_object('valid', true, 'errors','[]'::jsonb,'warnings','[]'::jsonb,'normalized', NULL);
  END IF;
  IF jsonb_typeof(p_payload) <> 'object' THEN
    RETURN jsonb_build_object('valid', false, 'errors', jsonb_build_array(
      jsonb_build_object('code','REWARD_NOT_OBJECT','message','reward payload must be an object with a mode and items')),
      'warnings','[]'::jsonb,'normalized', p_payload);
  END IF;

  v_mode := lower(coalesce(p_payload->>'mode','all'));
  IF v_mode NOT IN ('all','choice','weighted','first_then_repeat') THEN
    v_err := v_err || jsonb_build_object('code','REWARD_MODE_INVALID','message',
      format('mode "%s" is not one of all | choice | weighted | first_then_repeat', v_mode));
  END IF;

  v_items := coalesce(p_payload->'items', p_payload->'rewards', '[]'::jsonb);
  IF v_mode = 'first_then_repeat' THEN
    v_items := coalesce(p_payload->'first', '[]'::jsonb) || coalesce(p_payload->'repeat', '[]'::jsonb);
    IF jsonb_array_length(coalesce(p_payload->'first','[]'::jsonb)) = 0 THEN
      v_err := v_err || jsonb_build_object('code','REWARD_FIRST_EMPTY','message','first_then_repeat needs a non-empty "first" array');
    END IF;
  END IF;

  IF jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
    v_err := v_err || jsonb_build_object('code','REWARD_GROUP_EMPTY','message','reward payload has no items');
  ELSE
    FOR v_it IN SELECT * FROM jsonb_array_elements(v_items) LOOP
      v_type := lower(coalesce(v_it->>'type',''));
      IF v_type NOT IN ('coins','gems','pack','card','nothing') THEN
        v_err := v_err || jsonb_build_object('code','REWARD_TYPE_INVALID','message',
          format('reward item type "%s" is not one of coins | gems | pack | card | nothing', v_type),'item',v_it);
        CONTINUE;
      END IF;
      IF v_type IN ('coins','gems') THEN
        IF coalesce((v_it->>'amount')::numeric, -1) < 0 THEN
          v_err := v_err || jsonb_build_object('code','REWARD_AMOUNT_INVALID','message','coins/gems need amount >= 0','item',v_it);
        END IF;
      ELSIF v_type = 'pack' THEN
        IF v_it->>'pack_id' IS NULL THEN
          v_err := v_err || jsonb_build_object('code','REWARD_TARGET_MISSING','message','pack rewards need pack_id (names are often duplicated)','item',v_it);
        ELSE
          SELECT status::text, name INTO v_st, v_name FROM packs WHERE id = (v_it->>'pack_id')::uuid;
          IF v_name IS NULL THEN
            v_err := v_err || jsonb_build_object('code','REWARD_TARGET_MISSING','message',format('pack %s does not exist', v_it->>'pack_id'),'item',v_it);
          ELSE
            v_resolved := v_resolved || jsonb_build_object('type','pack','id',v_it->>'pack_id','name',v_name,'status',v_st);
            IF v_st IN ('draft','archived') THEN
              v_err := v_err || jsonb_build_object('code','REWARD_TARGET_NOT_PUBLISHABLE','message',
                format('pack "%s" is %s and cannot back an active reward', v_name, v_st),'item',v_it);
            END IF;
          END IF;
        END IF;
      ELSIF v_type = 'card' THEN
        IF v_it->>'player_card_id' IS NULL THEN
          v_err := v_err || jsonb_build_object('code','REWARD_TARGET_MISSING','message','card rewards need player_card_id or card_key resolved to an id','item',v_it);
        ELSE
          SELECT status::text, name INTO v_st, v_name FROM player_cards WHERE id = (v_it->>'player_card_id')::uuid;
          IF v_name IS NULL THEN
            v_err := v_err || jsonb_build_object('code','REWARD_TARGET_MISSING','message',format('player card %s does not exist', v_it->>'player_card_id'),'item',v_it);
          ELSE
            v_resolved := v_resolved || jsonb_build_object('type','card','id',v_it->>'player_card_id','name',v_name,'status',v_st);
            IF v_st IN ('draft','archived') THEN
              v_err := v_err || jsonb_build_object('code','REWARD_TARGET_NOT_PUBLISHABLE','message',
                format('card "%s" is %s and cannot back an active reward', v_name, v_st),'item',v_it);
            END IF;
          END IF;
        END IF;
      END IF;
      IF v_it ? 'weight' THEN
        v_has_weight := true;
        IF (v_it->>'weight')::numeric <= 0 THEN
          v_err := v_err || jsonb_build_object('code','REWARD_WEIGHT_INVALID','message','weights must be > 0','item',v_it);
        END IF;
        v_weight := v_weight + (v_it->>'weight')::numeric;
      END IF;
    END LOOP;
  END IF;

  IF v_mode = 'weighted' AND NOT v_has_weight THEN
    v_err := v_err || jsonb_build_object('code','REWARD_WEIGHTS_MISSING','message','mode=weighted requires a weight on every item');
  END IF;
  IF v_has_weight AND v_mode <> 'weighted' THEN
    v_warn := v_warn || jsonb_build_object('code','REWARD_WEIGHT_IGNORED','message',
      format('weights are only used when mode=weighted (mode is %s)', v_mode));
  END IF;
  IF v_mode = 'weighted' AND v_has_weight AND v_weight <> 100 THEN
    v_warn := v_warn || jsonb_build_object('code','REWARD_WEIGHT_TOTAL','message',
      format('weights total %s (they are treated as relative shares, not percentages)', v_weight));
  END IF;

  RETURN jsonb_build_object('valid', jsonb_array_length(v_err) = 0, 'errors', v_err, 'warnings', v_warn,
    'mode', v_mode, 'item_count', jsonb_array_length(coalesce(v_items,'[]'::jsonb)),
    'resolved_targets', v_resolved, 'normalized', p_payload);
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_road_bulk(p_payload jsonb, p_commit boolean DEFAULT false, p_preview_token text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_road_delete(p_payload jsonb, p_commit boolean DEFAULT false, p_preview_token text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.admin_road_export(p_ref jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.admin_road_raise(p_code text, p_message text, p_game_order integer DEFAULT NULL::integer, p_field text DEFAULT NULL::text, p_value text DEFAULT NULL::text, p_extra jsonb DEFAULT NULL::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  RAISE EXCEPTION '%: % detail=%', p_code, p_message,
    (jsonb_strip_nulls(jsonb_build_object(
      'game_order', p_game_order, 'field', p_field, 'value', p_value)) || coalesce(p_extra,'{}'::jsonb))::text;
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_run_rating(p_run jsonb)
 RETURNS numeric
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
DECLARE k text; v_total numeric := 0;
BEGIN
  FOREACH k IN ARRAY public.admin_run_stat_keys() LOOP
    IF NOT (p_run ? k) OR p_run->>k IS NULL THEN RETURN NULL; END IF;
    v_total := v_total + (p_run->>k)::numeric;
  END LOOP;
  RETURN round(v_total / 9.0, 2);
END $function$
;

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
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_substitute_refs(p_item jsonb, p_refs jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
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
          IF jsonb_typeof(v_el) = 'object' THEN
            v_arr := v_arr || jsonb_build_array(public.admin_substitute_refs(v_el, p_refs));
          ELSE
            v_arr := v_arr || jsonb_build_array(v_el);
          END IF;
        ELSIF v_val = 'pending' THEN
          v_pending := v_pending + 1;
        ELSE
          v_arr := v_arr || jsonb_build_array(jsonb_build_object('player_id', v_val));
        END IF;
      END LOOP;
      IF v_pending > 0 THEN
        v_out := v_out || jsonb_build_object(v_target || '_pending', v_pending);
        IF jsonb_array_length(v_arr) > 0 THEN v_out := v_out || jsonb_build_object(v_target, v_arr); END IF;
      ELSE
        v_out := v_out || jsonb_build_object(v_target, v_arr);
      END IF;
    ELSIF jsonb_typeof(v_v) = 'object' THEN
      v_out := v_out || jsonb_build_object(v_target, public.admin_substitute_refs(v_v, p_refs));
    ELSE
      v_out := v_out || jsonb_build_object(v_target, v_v);
    END IF;
  END LOOP;
  RETURN v_out;
END $function$
;

CREATE OR REPLACE FUNCTION public.admin_unused_players(p_by_name boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_used uuid[]; v_out jsonb;
BEGIN
  PERFORM public.admin_require_admin();
  SELECT coalesce(array_agg(DISTINCT pc.id), '{}') INTO v_used
  FROM player_cards pc
  WHERE jsonb_array_length(public.admin_usage('player_card', pc.id)) > 0;

  IF p_by_name THEN
    SELECT coalesce(jsonb_agg(x), '[]'::jsonb) INTO v_out FROM (
      SELECT jsonb_build_object('normalized_name', lower(btrim(name)), 'versions', count(*),
               'player_card_ids', jsonb_agg(id)) AS x
      FROM player_cards GROUP BY lower(btrim(name))
      HAVING bool_and(NOT (id = ANY(v_used)))
      ORDER BY 1) s;
  ELSE
    SELECT coalesce(jsonb_agg(jsonb_build_object('player_card_id',pc.id,'card_key',pc.card_key,'name',pc.name,
             'rating',pc.rating,'gem_tier',gt.name,'status',pc.status) ORDER BY pc.name), '[]'::jsonb) INTO v_out
    FROM player_cards pc LEFT JOIN gem_tiers gt ON gt.id = pc.gem_tier_id
    WHERE NOT (pc.id = ANY(v_used));
  END IF;
  RETURN jsonb_build_object('mode', CASE WHEN p_by_name THEN 'normalized_name' ELSE 'card_record' END,
                            'count', jsonb_array_length(v_out), 'items', v_out);
END $function$
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

  PERFORM public.admin_assert_castable(p_table, p_fields);

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

CREATE OR REPLACE FUNCTION public.admin_usage(p_entity_type text, p_entity_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record; v_sql text; v_rows jsonb; v_out jsonb := '[]'::jsonb;
  v_label text; v_status text; v_parent text; v_where text;
BEGIN
  PERFORM public.admin_require_admin();
  FOR r IN SELECT * FROM content_reference_registry
           WHERE target_entity_type = p_entity_type AND is_active ORDER BY reference_type LOOP
    IF NOT public.admin_has_column(r.source_table, r.source_column) THEN CONTINUE; END IF;
    v_label  := CASE WHEN r.label_column IS NOT NULL AND public.admin_has_column(r.source_table, r.label_column)
                     THEN format('left(t.%I::text, 120)', r.label_column) ELSE 'NULL::text' END;
    v_status := CASE WHEN public.admin_has_column(r.source_table,'status') THEN 't.status::text' ELSE 'NULL::text' END;
    v_parent := CASE WHEN r.parent_column IS NOT NULL AND public.admin_has_column(r.source_table, r.parent_column)
                     THEN format('t.%I::text', r.parent_column) ELSE 'NULL::text' END;
    v_where  := CASE WHEN r.column_kind = 'uuid_array'
                     THEN format('$1 = ANY(t.%I)', r.source_column)
                     ELSE format('t.%I = $1', r.source_column) END;
    v_sql := format(
      'SELECT coalesce(jsonb_agg(jsonb_build_object(
          ''reference_type'', %L, ''source_table'', %L, ''is_protected'', %L::boolean,
          ''referencing_entity_id'', t.id, ''referencing_entity_name'', %s,
          ''parent_id'', %s, ''status'', %s)), ''[]''::jsonb)
       FROM public.%I t WHERE %s',
      r.reference_type, r.source_table, r.is_protected, v_label, v_parent, v_status, r.source_table, v_where);
    EXECUTE v_sql INTO v_rows USING p_entity_id;
    v_out := v_out || v_rows;
  END LOOP;
  RETURN v_out;
END $function$
;

CREATE OR REPLACE FUNCTION public.content_release_preview_cancel(p_preview_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_row public.content_release_previews;
BEGIN
  PERFORM public.admin_require_admin();
  SELECT * INTO v_row FROM public.content_release_previews WHERE id = p_preview_id FOR UPDATE;
  IF v_row.id IS NULL THEN
    PERFORM public.admin_error('PREVIEW_NOT_FOUND', 'no stored content-release preview with that preview_id', jsonb_build_object('preview_id', p_preview_id));
  END IF;
  IF v_row.status = 'committed' THEN
    PERFORM public.admin_error('PREVIEW_ALREADY_COMMITTED', 'that preview was already committed and cannot be cancelled', jsonb_build_object('preview_id', p_preview_id));
  END IF;
  IF v_row.status = 'pending' THEN
    UPDATE public.content_release_previews SET status = 'cancelled' WHERE id = v_row.id RETURNING * INTO v_row;
  END IF;
  RETURN public.content_release_preview_public(v_row);
END $function$
;

CREATE OR REPLACE FUNCTION public.content_release_preview_claim(p_preview_id uuid, p_approved_payload_hash text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.content_release_previews;
BEGIN
  PERFORM public.admin_require_admin();

  SELECT * INTO v_row FROM public.content_release_previews WHERE id = p_preview_id FOR UPDATE;
  IF v_row.id IS NULL THEN
    PERFORM public.admin_error('PREVIEW_NOT_FOUND', 'no stored content-release preview with that preview_id',
      jsonb_build_object('preview_id', p_preview_id));
  END IF;

  IF v_row.status = 'committed' THEN
    -- Idempotent replay: same preview + same approved hash (or same key) returns the stored result.
    IF (p_approved_payload_hash IS NOT NULL AND p_approved_payload_hash = v_row.payload_hash)
       OR (p_idempotency_key IS NOT NULL AND v_row.idempotency_key = p_idempotency_key) THEN
      RETURN public.content_release_preview_public(v_row) || jsonb_build_object('idempotent_replay', true, 'claimed', false);
    END IF;
    PERFORM public.admin_error('PREVIEW_ALREADY_COMMITTED', 'that preview was already committed; nothing was written',
      jsonb_build_object('preview_id', p_preview_id, 'committed_at', to_jsonb(v_row.committed_at)));
  END IF;
  IF v_row.status = 'committing' THEN
    RETURN public.content_release_preview_public(v_row) || jsonb_build_object('already_running', true, 'claimed', false);
  END IF;
  IF v_row.status = 'cancelled' THEN
    PERFORM public.admin_error('PREVIEW_CANCELLED', 'that preview was cancelled; run a new preview',
      jsonb_build_object('preview_id', p_preview_id));
  END IF;
  IF v_row.status <> 'pending' AND v_row.status <> 'failed' THEN
    PERFORM public.admin_error('PREVIEW_EXPIRED', 'that preview is no longer pending; run a new preview',
      jsonb_build_object('preview_id', p_preview_id, 'status', v_row.status));
  END IF;
  IF v_row.expires_at < now() THEN
    UPDATE public.content_release_previews SET status = 'expired' WHERE id = v_row.id;
    PERFORM public.admin_error('PREVIEW_EXPIRED', 'that preview expired; run a new preview and approve it again',
      jsonb_build_object('preview_id', p_preview_id, 'expires_at', to_jsonb(v_row.expires_at)));
  END IF;
  IF v_row.requested_by <> auth.uid() THEN
    PERFORM public.admin_error('UNAUTHORIZED', 'that preview belongs to a different admin',
      jsonb_build_object('preview_id', p_preview_id));
  END IF;
  IF p_approved_payload_hash IS NULL OR p_approved_payload_hash <> v_row.payload_hash THEN
    PERFORM public.admin_error('PAYLOAD_HASH_MISMATCH', 'approved_payload_hash does not match the stored preview hash; nothing was written',
      jsonb_build_object('preview_id', p_preview_id, 'expected', v_row.payload_hash, 'received', p_approved_payload_hash));
  END IF;

  UPDATE public.content_release_previews
     SET status = 'committing',
         approved_at = coalesce(approved_at, now()),
         idempotency_key = coalesce(p_idempotency_key, idempotency_key),
         expires_at = greatest(expires_at, now() + interval '15 minutes'),
         last_error = NULL
   WHERE id = v_row.id
  RETURNING * INTO v_row;

  RETURN public.content_release_preview_public(v_row) || jsonb_build_object('claimed', true);
END $function$
;

CREATE OR REPLACE FUNCTION public.content_release_preview_commit(p_preview_id uuid, p_approved_payload_hash text, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.content_release_previews;
  v_token text; v_valid boolean; v_result jsonb; v_verify jsonb;
BEGIN
  PERFORM public.admin_require_admin();

  SELECT * INTO v_row FROM public.content_release_previews WHERE id = p_preview_id FOR UPDATE;
  IF v_row.id IS NULL THEN
    PERFORM public.admin_error('PREVIEW_NOT_FOUND', 'no stored content-release preview with that preview_id',
      jsonb_build_object('preview_id', p_preview_id));
  END IF;

  IF v_row.status = 'committed' THEN
    IF (p_approved_payload_hash IS NOT NULL AND p_approved_payload_hash = v_row.payload_hash)
       OR (p_idempotency_key IS NOT NULL AND v_row.idempotency_key = p_idempotency_key) THEN
      RETURN public.content_release_preview_public(v_row) || jsonb_build_object('idempotent_replay', true);
    END IF;
    PERFORM public.admin_error('PREVIEW_ALREADY_COMMITTED', 'that preview was already committed; nothing was written',
      jsonb_build_object('preview_id', p_preview_id, 'committed_at', to_jsonb(v_row.committed_at)));
  END IF;
  IF v_row.status = 'cancelled' THEN
    PERFORM public.admin_error('PREVIEW_CANCELLED', 'that preview was cancelled; run a new preview',
      jsonb_build_object('preview_id', p_preview_id));
  END IF;
  IF v_row.status NOT IN ('pending','failed','committing') THEN
    PERFORM public.admin_error('PREVIEW_EXPIRED', 'that preview is no longer pending; run a new preview',
      jsonb_build_object('preview_id', p_preview_id, 'status', v_row.status));
  END IF;
  IF v_row.expires_at < now() THEN
    UPDATE public.content_release_previews SET status = 'expired' WHERE id = v_row.id;
    PERFORM public.admin_error('PREVIEW_EXPIRED', 'that preview expired; run a new preview and approve it again',
      jsonb_build_object('preview_id', p_preview_id, 'expires_at', to_jsonb(v_row.expires_at)));
  END IF;
  IF v_row.requested_by <> auth.uid() THEN
    PERFORM public.admin_error('UNAUTHORIZED', 'that preview belongs to a different admin',
      jsonb_build_object('preview_id', p_preview_id));
  END IF;
  IF p_approved_payload_hash IS NULL OR p_approved_payload_hash <> v_row.payload_hash THEN
    PERFORM public.admin_error('PAYLOAD_HASH_MISMATCH', 'approved_payload_hash does not match the stored preview hash; nothing was written',
      jsonb_build_object('preview_id', p_preview_id, 'expected', v_row.payload_hash, 'received', p_approved_payload_hash));
  END IF;

  v_token := v_row.preview_token_encrypted;
  SELECT true INTO v_valid FROM public.admin_preview_tokens
   WHERE token = v_token AND user_id = auth.uid() AND kind = 'content_release'
     AND consumed_at IS NULL AND expires_at > now();
  IF v_valid IS NOT TRUE THEN
    v_token := public.admin_issue_preview_token('content_release', v_row.canonical_payload, NULL);
  END IF;

  v_result := public.admin_apply_batch(v_row.canonical_payload, true, v_token, 'content_release');
  v_verify := public.content_release_verify(v_result);

  IF (v_verify->>'verified')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'VERIFICATION_FAILED: %', v_verify->'verification_errors';
  END IF;

  UPDATE public.content_release_previews
     SET status = 'committed',
         approved_at = coalesce(approved_at, now()),
         committed_at = now(),
         commit_result = v_result,
         verification_result = v_verify,
         idempotency_key = coalesce(p_idempotency_key, idempotency_key),
         last_error = NULL
   WHERE id = v_row.id
  RETURNING * INTO v_row;

  RETURN public.content_release_preview_public(v_row) || jsonb_build_object('idempotent_replay', false);
END $function$
;

CREATE OR REPLACE FUNCTION public.content_release_preview_fail(p_preview_id uuid, p_error text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_row public.content_release_previews;
BEGIN
  PERFORM public.admin_require_admin();
  UPDATE public.content_release_previews
     SET status = 'failed', last_error = left(coalesce(p_error, 'commit failed'), 4000)
   WHERE id = p_preview_id AND requested_by = auth.uid() AND status = 'committing'
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'preview_id', p_preview_id); END IF;
  RETURN public.content_release_preview_public(v_row);
END $function$
;

CREATE OR REPLACE FUNCTION public.content_release_preview_get(p_preview_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_row public.content_release_previews;
BEGIN
  PERFORM public.admin_require_admin();
  SELECT * INTO v_row FROM public.content_release_previews WHERE id = p_preview_id;
  IF v_row.id IS NULL THEN
    PERFORM public.admin_error('PREVIEW_NOT_FOUND', 'no stored content-release preview with that preview_id', jsonb_build_object('preview_id', p_preview_id));
  END IF;
  IF v_row.status = 'pending' AND v_row.expires_at < now() THEN
    UPDATE public.content_release_previews SET status = 'expired' WHERE id = v_row.id RETURNING * INTO v_row;
  END IF;
  RETURN public.content_release_preview_public(v_row);
END $function$
;

CREATE OR REPLACE FUNCTION public.content_release_preview_store(p_payload_hash text, p_canonical_payload jsonb, p_preview_token text, p_summary jsonb, p_plan jsonb, p_ttl_minutes integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_row public.content_release_previews;
BEGIN
  PERFORM public.admin_require_admin();
  IF p_payload_hash IS NULL OR btrim(p_payload_hash) = '' THEN
    PERFORM public.admin_error('VALIDATION_FAILED', 'payload_hash is required to store a preview', jsonb_build_object('field','payload_hash'));
  END IF;
  IF p_canonical_payload IS NULL OR jsonb_typeof(p_canonical_payload) <> 'object' THEN
    PERFORM public.admin_error('VALIDATION_FAILED', 'canonical_payload must be a JSON object', jsonb_build_object('field','canonical_payload'));
  END IF;

  UPDATE public.content_release_previews
     SET status = 'expired'
   WHERE status = 'pending' AND expires_at < now();

  INSERT INTO public.content_release_previews
    (payload_hash, canonical_payload, preview_token_encrypted, preview_summary, operation_plan, requested_by, expires_at)
  VALUES
    (p_payload_hash, public.admin_canonical_json(p_canonical_payload), p_preview_token,
     coalesce(p_summary, '{}'::jsonb), coalesce(p_plan, '{}'::jsonb), auth.uid(),
     now() + make_interval(mins => greatest(1, least(coalesce(p_ttl_minutes, 30), 1440))))
  RETURNING * INTO v_row;

  RETURN public.content_release_preview_public(v_row);
END $function$
;

CREATE OR REPLACE FUNCTION public.content_release_verify(p_result jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_out jsonb; v_extra jsonb; v_errors jsonb;
BEGIN
  v_out := public.content_release_verify_base(p_result);
  v_extra := public.content_release_verify_evo(p_result);
  v_errors := coalesce(v_out->'verification_errors', '[]'::jsonb) || coalesce(v_extra, '[]'::jsonb);
  RETURN v_out
    || jsonb_build_object('verification_errors', v_errors)
    || jsonb_build_object('verified', jsonb_array_length(v_errors) = 0);
END $function$
;

CREATE OR REPLACE FUNCTION public.content_release_verify_base(p_result jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tables text[] := ARRAY['release_bundles','player_cards','collections','collection_requirements','sub_collections',
    'teams','team_players','packs','pack_players','pack_odds','evo_paths','evo_objectives','evo_card_versions',
    'evo_card_version_badges','evo_card_version_traits','player_card_badges','player_card_traits','locker_codes',
    'challenges','gem_tasks','dynamic_duos','release_bundle_entities'];
  v_rec record; v_exists boolean; v_errors jsonb := '[]'::jsonb; v_seen jsonb := '{}'::jsonb;
  v_players jsonb := '[]'::jsonb; v_paths jsonb := '[]'::jsonb; v_versions jsonb := '[]'::jsonb;
  v_objectives jsonb := '[]'::jsonb;
  v_release uuid; v_collection uuid; v_pack uuid; v_code uuid; v_key text;
  v_row record; v_found int;
BEGIN
  FOR v_rec IN
    SELECT DISTINCT op->>'table' AS tbl, op->>'id' AS id, op->>'parent_id' AS parent_id,
           op->'fields' AS fields, (op->>'expected_count')::int AS expected_count
      FROM jsonb_array_elements(coalesce(p_result->'results','[]'::jsonb)) r,
           jsonb_array_elements(coalesce(r.value->'result'->'operations','[]'::jsonb)) op
     WHERE op->>'id' IS NOT NULL AND op->>'table' IS NOT NULL
  LOOP
    v_key := v_rec.tbl || ':' || v_rec.id;
    IF v_seen ? v_key THEN CONTINUE; END IF;
    v_seen := v_seen || jsonb_build_object(v_key, true);

    IF NOT (v_rec.tbl = ANY (v_tables)) THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'code','VERIFICATION_FAILED','stage','table_allowlist','table', v_rec.tbl, 'id', v_rec.id,
        'message','unexpected table in release result; cannot verify'));
      CONTINUE;
    END IF;

    -- Evo objectives are verified by their exact immutable id plus parent and field values.
    IF v_rec.tbl = 'evo_objectives' THEN
      SELECT * INTO v_row FROM public.evo_objectives WHERE id = v_rec.id::uuid;
      IF NOT FOUND THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'code','VERIFICATION_ROW_MISSING','stage','verification_query',
          'table','evo_objectives','columns', jsonb_build_array('id','evo_path_id'),
          'expected_id', v_rec.id, 'inserted_id', v_rec.id, 'found_id', NULL,
          'expected_parent_id', v_rec.parent_id, 'found_parent_id', NULL,
          'message','evo objective row is missing after commit'));
        CONTINUE;
      END IF;
      IF v_rec.parent_id IS NOT NULL AND v_row.evo_path_id <> v_rec.parent_id::uuid THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'code','VERIFICATION_PARENT_MISMATCH','stage','verification_compare',
          'table','evo_objectives','columns', jsonb_build_array('evo_path_id'),
          'expected_id', v_rec.id, 'found_id', v_row.id,
          'expected_parent_id', v_rec.parent_id, 'found_parent_id', v_row.evo_path_id,
          'message','evo objective is attached to a different evo path than the commit reported'));
        CONTINUE;
      END IF;
      IF v_rec.fields IS NOT NULL AND (
           v_row.objective_type <> (v_rec.fields->>'objective_type')
        OR v_row.target <> (v_rec.fields->>'target')::numeric
        OR v_row.sort_order <> (v_rec.fields->>'sort_order')::int) THEN
        v_errors := v_errors || jsonb_build_array(jsonb_build_object(
          'code','VERIFICATION_MISMATCH','stage','verification_compare',
          'table','evo_objectives','columns', jsonb_build_array('objective_type','target','sort_order'),
          'expected_id', v_rec.id, 'found_id', v_row.id,
          'expected_parent_id', v_rec.parent_id, 'found_parent_id', v_row.evo_path_id,
          'expected', jsonb_build_object('objective_type', v_rec.fields->>'objective_type',
            'target', v_rec.fields->'target', 'sort_order', v_rec.fields->'sort_order'),
          'found', jsonb_build_object('objective_type', v_row.objective_type,
            'target', v_row.target, 'sort_order', v_row.sort_order),
          'message','evo objective values differ from the committed plan'));
        CONTINUE;
      END IF;
      IF v_rec.expected_count IS NOT NULL AND v_rec.parent_id IS NOT NULL THEN
        SELECT count(*) INTO v_found FROM public.evo_objectives WHERE evo_path_id = v_rec.parent_id::uuid;
        IF v_found <> v_rec.expected_count THEN
          v_errors := v_errors || jsonb_build_array(jsonb_build_object(
            'code','VERIFICATION_COUNT_MISMATCH','stage','verification_count',
            'table','evo_objectives','columns', jsonb_build_array('evo_path_id'),
            'expected_parent_id', v_rec.parent_id, 'found_parent_id', v_rec.parent_id,
            'expected_count', v_rec.expected_count, 'found_count', v_found,
            'message','evo path has a different number of objectives than the commit reported'));
          CONTINUE;
        END IF;
      END IF;
      v_objectives := v_objectives || to_jsonb(v_rec.id);
      CONTINUE;
    END IF;

    EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE id = $1)', v_rec.tbl)
      INTO v_exists USING v_rec.id::uuid;
    IF NOT v_exists THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'code','VERIFICATION_ROW_MISSING','stage','verification_query','table', v_rec.tbl,
        'columns', jsonb_build_array('id'), 'expected_id', v_rec.id, 'found_id', NULL,
        'id', v_rec.id, 'message','row is missing after commit'));
      CONTINUE;
    END IF;

    CASE v_rec.tbl
      WHEN 'release_bundles' THEN v_release := coalesce(v_release, v_rec.id::uuid);
      WHEN 'collections' THEN v_collection := coalesce(v_collection, v_rec.id::uuid);
      WHEN 'packs' THEN v_pack := coalesce(v_pack, v_rec.id::uuid);
      WHEN 'locker_codes' THEN v_code := coalesce(v_code, v_rec.id::uuid);
      WHEN 'player_cards' THEN v_players := v_players || to_jsonb(v_rec.id);
      WHEN 'evo_paths' THEN v_paths := v_paths || to_jsonb(v_rec.id);
      WHEN 'evo_card_versions' THEN v_versions := v_versions || to_jsonb(v_rec.id);
      ELSE NULL;
    END CASE;
  END LOOP;

  -- The collection reward must point at a real card when a reward was requested.
  IF v_collection IS NOT NULL THEN
    PERFORM 1 FROM public.collections c
      WHERE c.id = v_collection
        AND c.reward_card_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM public.player_cards pc WHERE pc.id = c.reward_card_id);
    IF FOUND THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'code','VERIFICATION_FAILED','stage','verification_compare','table','collections','id', v_collection,
        'message','collection reward card is missing'));
    END IF;
  END IF;

  -- Pack odds must still total exactly 100.00 for a pack written in this release.
  IF v_pack IS NOT NULL THEN
    PERFORM 1 FROM public.pack_odds o WHERE o.pack_id = v_pack
      HAVING round(sum(o.percentage)::numeric, 2) <> 100.00;
    IF FOUND THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'code','VERIFICATION_FAILED','stage','verification_compare','table','pack_odds','id', v_pack,
        'message','pack odds do not total 100.00 after commit'));
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'verified', jsonb_array_length(v_errors) = 0,
    'release_id', v_release,
    'collection_id', v_collection,
    'player_card_ids', v_players,
    'pack_id', v_pack,
    'evo_path_ids', v_paths,
    'evo_version_ids', v_versions,
    'evo_objective_ids', v_objectives,
    'locker_code_id', v_code,
    'verification_errors', v_errors);
END $function$
;

CREATE OR REPLACE FUNCTION public.content_release_verify_evo(p_result jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_rec record; v_row jsonb; v_errors jsonb := '[]'::jsonb; v_seen jsonb := '{}'::jsonb;
  v_key text; v_cols text[]; v_expected jsonb; v_found jsonb; v_bad text[];
  v_exp_num numeric; v_got_num numeric; v_dupes int; v_path record;
BEGIN
  FOR v_rec IN
    SELECT DISTINCT op->>'id' AS id, op->'fields' AS fields
      FROM jsonb_array_elements(coalesce(p_result->'results','[]'::jsonb)) r,
           jsonb_array_elements(coalesce(r.value->'result'->'operations','[]'::jsonb)) op
     WHERE op->>'table' = 'evo_card_versions' AND op->>'id' IS NOT NULL
  LOOP
    IF v_seen ? v_rec.id THEN CONTINUE; END IF;
    v_seen := v_seen || jsonb_build_object(v_rec.id, true);

    SELECT to_jsonb(t) INTO v_row FROM public.evo_card_versions t WHERE t.id = v_rec.id::uuid;
    IF v_row IS NULL THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'code','VERIFICATION_ROW_MISSING','stage','verification_query','table','evo_card_versions',
        'expected_id', v_rec.id, 'found_id', NULL,
        'message','evo card version row is missing after commit'));
      CONTINUE;
    END IF;

    v_cols := ARRAY['rating','run_rating','gem_name','position1','position2','status','version_order','evo_path_id','base_player_card_id']
              || public.admin_base_stat_keys() || public.admin_run_stat_keys();
    v_bad := '{}'; v_expected := '{}'::jsonb; v_found := '{}'::jsonb;
    FOREACH v_key IN ARRAY v_cols LOOP
      IF v_rec.fields IS NULL OR NOT (v_rec.fields ? v_key) THEN CONTINUE; END IF;
      IF v_rec.fields->>v_key IS NULL THEN
        IF v_row->>v_key IS NOT NULL AND v_key IN ('rating','run_rating') THEN
          v_bad := v_bad || v_key;
          v_expected := v_expected || jsonb_build_object(v_key, NULL);
          v_found := v_found || jsonb_build_object(v_key, v_row->v_key);
        END IF;
        CONTINUE;
      END IF;
      IF v_key = ANY(ARRAY['rating','run_rating','version_order'] || public.admin_base_stat_keys() || public.admin_run_stat_keys()) THEN
        v_exp_num := (v_rec.fields->>v_key)::numeric;
        v_got_num := nullif(v_row->>v_key,'')::numeric;
        IF v_got_num IS NULL OR abs(v_got_num - v_exp_num) > 0.0000001 THEN
          v_bad := v_bad || v_key;
          v_expected := v_expected || jsonb_build_object(v_key, v_exp_num);
          v_found := v_found || jsonb_build_object(v_key, v_got_num);
        END IF;
      ELSIF coalesce(v_row->>v_key,'') <> coalesce(v_rec.fields->>v_key,'') THEN
        v_bad := v_bad || v_key;
        v_expected := v_expected || jsonb_build_object(v_key, v_rec.fields->>v_key);
        v_found := v_found || jsonb_build_object(v_key, v_row->>v_key);
      END IF;
    END LOOP;

    IF array_length(v_bad,1) > 0 THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'code','VERIFICATION_MISMATCH','stage','verification_compare','table','evo_card_versions',
        'columns', to_jsonb(v_bad), 'expected_id', v_rec.id, 'found_id', v_rec.id,
        'expected', v_expected, 'found', v_found,
        'message','evo card version values differ from the committed plan'));
      CONTINUE;
    END IF;

    -- parent evo step relationship and duplicate protection
    SELECT * INTO v_path FROM public.evo_paths WHERE id = (v_row->>'evo_path_id')::uuid;
    IF NOT FOUND THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'code','VERIFICATION_PARENT_MISSING','stage','verification_compare','table','evo_card_versions',
        'expected_id', v_rec.id, 'expected_parent_id', v_row->'evo_path_id',
        'message','evo card version points at an evo step that does not exist'));
      CONTINUE;
    END IF;
    IF v_path.player_card_id::text <> (v_row->>'base_player_card_id') THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'code','VERIFICATION_PARENT_MISMATCH','stage','verification_compare','table','evo_card_versions',
        'expected_id', v_rec.id, 'expected_parent_id', v_path.id,
        'expected', to_jsonb(v_path.player_card_id), 'found', v_row->'base_player_card_id',
        'message','evo card version belongs to a different player than its evo step'));
      CONTINUE;
    END IF;
    SELECT count(*) INTO v_dupes FROM public.evo_card_versions WHERE evo_path_id = v_path.id;
    IF v_dupes > 1 THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'code','VERIFICATION_DUPLICATE_VERSION','stage','verification_count','table','evo_card_versions',
        'expected_id', v_rec.id, 'expected_parent_id', v_path.id,
        'expected_count', 1, 'found_count', v_dupes,
        'message','more than one evo card version exists for this evo step'));
      CONTINUE;
    END IF;

    -- Runs data must be complete and consistent with the stored gameplay stats.
    IF public.admin_run_rating(v_row) IS NULL THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'code','VERIFICATION_RUN_STATS_INCOMPLETE','stage','verification_compare','table','evo_card_versions',
        'expected_id', v_rec.id, 'message','evo card version does not have all nine Runs stats after commit'));
    ELSIF (v_row->>'run_rating') IS NULL
       OR abs((v_row->>'run_rating')::numeric - public.admin_run_rating(v_row)) > 1 THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'code','VERIFICATION_RUN_RATING_MISMATCH','stage','verification_compare','table','evo_card_versions',
        'expected_id', v_rec.id, 'expected', public.admin_run_rating(v_row), 'found', v_row->'run_rating',
        'message','stored run_rating is not the mean of the stored Runs stats'));
    END IF;
  END LOOP;

  RETURN v_errors;
END $function$
;

CREATE OR REPLACE FUNCTION public.evo_seed_objectives_from_legacy(p_path uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r record; v_el jsonb; v_i int := 0;
BEGIN
  SELECT * INTO r FROM evo_paths WHERE id = p_path;
  IF r.id IS NULL THEN RETURN 0; END IF;
  IF EXISTS (SELECT 1 FROM evo_objectives WHERE evo_path_id = p_path) THEN RETURN 0; END IF;

  IF jsonb_typeof(r.compound_challenges) = 'array' AND jsonb_array_length(r.compound_challenges) > 0 THEN
    FOR v_el IN SELECT * FROM jsonb_array_elements(r.compound_challenges) LOOP
      INSERT INTO evo_objectives(evo_path_id, group_key, objective_type, stat_key, scope, target, description, sort_order)
      VALUES (p_path, 'default',
              coalesce(nullif(v_el->>'type',''), 'points_scored'),
              nullif(v_el->>'stat',''),
              'cumulative',
              coalesce(nullif(v_el->>'target','')::numeric, 1),
              nullif(v_el->>'description',''),
              v_i);
      v_i := v_i + 1;
    END LOOP;
  ELSE
    INSERT INTO evo_objectives(evo_path_id, group_key, objective_type, stat_key, scope, target, description, sort_order)
    VALUES (p_path, 'default', coalesce(nullif(r.challenge_type,''), 'points_scored'), nullif(r.challenge_stat,''),
            'cumulative', greatest(coalesce(r.challenge_target, 1), 1), nullif(r.challenge_description,''), 0);
    v_i := 1;
  END IF;
  RETURN v_i;
END $function$
;

CREATE OR REPLACE FUNCTION public.evo_sync_legacy_from_objectives(p_path uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_objs jsonb; v_first jsonb; v_compound jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'group_key', group_key, 'objective_type', objective_type, 'type', objective_type,
           'stat_key', stat_key, 'stat', stat_key, 'scope', scope, 'target', target,
           'description', coalesce(description,''), 'sort_order', sort_order
         ) ORDER BY sort_order, created_at), '[]'::jsonb)
    INTO v_objs
    FROM evo_objectives WHERE evo_path_id = p_path;

  IF jsonb_array_length(v_objs) = 0 THEN
    UPDATE evo_paths SET objectives = '[]'::jsonb WHERE id = p_path AND objectives <> '[]'::jsonb;
    RETURN;
  END IF;

  v_first := v_objs->0;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'type', e->>'objective_type', 'stat', e->>'stat_key',
           'target', (e->>'target')::numeric, 'description', coalesce(e->>'description','')
         )), '[]'::jsonb)
    INTO v_compound FROM jsonb_array_elements(v_objs) e;

  UPDATE evo_paths SET
    objectives = v_objs,
    challenge_type = v_first->>'objective_type',
    challenge_stat = v_first->>'stat_key',
    challenge_target = greatest(ceil((v_first->>'target')::numeric)::int, 1),
    challenge_description = CASE WHEN coalesce(btrim(challenge_description),'') = ''
                                 THEN coalesce(v_first->>'description','') ELSE challenge_description END,
    compound_challenges = CASE WHEN jsonb_array_length(v_objs) > 1 THEN v_compound ELSE '[]'::jsonb END,
    updated_at = now()
  WHERE id = p_path;
END $function$
;

CREATE OR REPLACE FUNCTION public.player_cards_autofill_card_key()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE v_base text; v_key text; v_i int := 1;
BEGIN
  IF NEW.card_key IS NOT NULL AND btrim(NEW.card_key) <> '' THEN
    RETURN NEW;
  END IF;
  v_base := nullif(public.admin_slugify(NEW.name), '');
  IF v_base IS NULL THEN v_base := 'card-' || left(NEW.id::text, 8); END IF;
  v_key := v_base;
  WHILE EXISTS (SELECT 1 FROM public.player_cards WHERE lower(card_key) = lower(v_key)) LOOP
    v_i := v_i + 1;
    v_key := v_base || '-' || v_i;
  END LOOP;
  NEW.card_key := v_key;
  RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.sync_gem_tier_collection(p_tier_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tier_name TEXT;
  v_collection_id UUID;
BEGIN
  IF p_tier_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT name INTO v_tier_name FROM public.gem_tiers WHERE id = p_tier_id;
  IF v_tier_name IS NULL THEN
    RETURN NULL;
  END IF;

  -- Ensure a collection exists for this tier
  SELECT id INTO v_collection_id
  FROM public.collections
  WHERE gem_tier_id = p_tier_id;

  IF v_collection_id IS NULL THEN
    INSERT INTO public.collections (name, description, gem_tier_id)
    VALUES (
      'Gem Market: ' || v_tier_name,
      'Auto-managed collection of all ' || v_tier_name || ' gem market cards.',
      p_tier_id
    )
    RETURNING id INTO v_collection_id;
  ELSE
    -- Keep name in sync if the tier was renamed
    UPDATE public.collections
    SET name = 'Gem Market: ' || v_tier_name
    WHERE id = v_collection_id
      AND name <> 'Gem Market: ' || v_tier_name;
  END IF;

  -- Add cards currently in this tier's listings to the collection (top-level, no sub)
  UPDATE public.player_cards pc
  SET collection_id = v_collection_id,
      sub_collection_id = NULL
  WHERE pc.id IN (
    SELECT player_card_id FROM public.gem_market_listings WHERE gem_tier_id = p_tier_id
  )
  AND (pc.collection_id IS DISTINCT FROM v_collection_id OR pc.sub_collection_id IS NOT NULL);

  -- Remove cards from this collection that are NO LONGER listed in this tier
  UPDATE public.player_cards pc
  SET collection_id = NULL
  WHERE pc.collection_id = v_collection_id
    AND pc.id NOT IN (
      SELECT player_card_id FROM public.gem_market_listings WHERE gem_tier_id = p_tier_id
    );

  RETURN v_collection_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_base_stat_keys()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT ARRAY['stat_3pt','stat_mid','stat_fin','stat_dnk','stat_ast','stat_stl','stat_reb','stat_blk','stat_int'];
$function$
;

CREATE OR REPLACE FUNCTION public.admin_canonical_json(p jsonb)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE jsonb_typeof(p)
    WHEN 'object' THEN coalesce((
      SELECT jsonb_object_agg(k, public.admin_canonical_json(v))
      FROM (SELECT key k, value v FROM jsonb_each(p) ORDER BY key) s), '{}'::jsonb)
    WHEN 'array' THEN coalesce((
      SELECT jsonb_agg(public.admin_canonical_json(e) ORDER BY ord)
      FROM jsonb_array_elements(p) WITH ORDINALITY t(e, ord)), '[]'::jsonb)
    ELSE p
  END
$function$
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

CREATE OR REPLACE FUNCTION public.admin_evo_objective_keys()
 RETURNS text[]
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT coalesce(array_agg(key ORDER BY key), ARRAY[]::text[]) FROM public.evo_objective_registry
$function$
;

CREATE OR REPLACE FUNCTION public.admin_evo_version_get(p_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
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
$function$
;

CREATE OR REPLACE FUNCTION public.admin_evo_version_list(p_filters jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
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
$function$
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

CREATE OR REPLACE FUNCTION public.admin_road_fingerprint(p_road_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.admin_road_outside_fingerprint(p_road_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT md5(coalesce((SELECT string_agg(x, '|' ORDER BY x) FROM (
      SELECT g.id::text || ':' || coalesce(g.road_id::text, '') || ':' || g.game_order || ':' ||
             coalesce(g.opponent_name, '') || ':' || g.difficulty_stars || ':' || g.coin_reward || ':' ||
             coalesce((SELECT string_agg(p.player_card_id::text, ',' ORDER BY p.slot)
                       FROM public.domination_game_players p WHERE p.domination_game_id = g.id), '') AS x
      FROM public.domination_games g
      WHERE p_road_id IS NULL OR g.road_id IS DISTINCT FROM p_road_id) s), 'none'))
$function$
;

CREATE OR REPLACE FUNCTION public.admin_run_band(p_base numeric)
 RETURNS integer[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT ARRAY[s * 20, s * 20 + 19]
  FROM (SELECT least(greatest(floor(coalesce(p_base, 0))::int, 0), 6) AS s) q;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_run_stat_keys()
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT ARRAY['run_stat_3pt','run_stat_mid','run_stat_fin','run_stat_dnk','run_stat_ast',
               'run_stat_stl','run_stat_reb','run_stat_blk','run_stat_int'];
$function$
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

CREATE OR REPLACE FUNCTION public.content_release_preview_public(p_row content_release_previews)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object(
    'preview_id', p_row.id,
    'payload_hash', p_row.payload_hash,
    'status', p_row.status,
    'requested_by', p_row.requested_by,
    'created_at', p_row.created_at,
    'expires_at', p_row.expires_at,
    'approved_at', p_row.approved_at,
    'committed_at', p_row.committed_at,
    'summary', coalesce(p_row.preview_summary, '{}'::jsonb),
    'creates', coalesce(p_row.operation_plan->'creates', '[]'::jsonb),
    'updates', coalesce(p_row.operation_plan->'updates', '[]'::jsonb),
    'replacements', coalesce(p_row.operation_plan->'replacements', '[]'::jsonb),
    'deletes', coalesce(p_row.operation_plan->'deletes', '[]'::jsonb),
    'warnings', coalesce(p_row.operation_plan->'warnings', '[]'::jsonb),
    'destructive_operations', coalesce(p_row.operation_plan->'destructive_operations', p_row.operation_plan->'replacements', '[]'::jsonb),
    'resolved_references', coalesce(p_row.operation_plan->'resolved_references', '[]'::jsonb),
    'canonical_payload', p_row.canonical_payload,
    'commit_result', p_row.commit_result,
    'verification_result', p_row.verification_result,
    'last_error', p_row.last_error
  )
$function$
;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$function$
;

CREATE OR REPLACE FUNCTION public.admin_canonical_hash(p jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT md5(public.admin_canonical_json(coalesce(p, '{}'::jsonb))::text)
$function$
;

CREATE OR REPLACE FUNCTION public.admin_derive_run_stat(p_base numeric, p_seed text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT b[1] + least(greatest(round(centre + jitter)::int, 0), 19)
  FROM (
    SELECT public.admin_run_band(p_base) AS b,
           (least(greatest((coalesce(p_base, 0) - floor(coalesce(p_base, 0))) * 100, 0), 99) / 99.0) * 19 AS centre,
           ((((('x' || substr(md5(coalesce(p_seed, '')), 1, 8))::bit(32)::bigint) % 1201)::numeric) / 100.0) - 6 AS jitter
  ) q;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_has_pending_ref(p_item jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$ SELECT public.admin_pending_refs(p_item) <> '{}'::jsonb $function$
;

