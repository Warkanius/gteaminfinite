-- One canonical evo-objective shape for every API surface.
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
$function$;

DO $mig$
DECLARE
  src text;
BEGIN
  -------------------------------------------------------------------- evo version
  -- The Runs-stat extraction used LIKE 'run_stat_%', whose '_' wildcard let the
  -- container key run_stats look like a Runs stat, so a nested run_stats object
  -- passed preview and then failed commit with UNKNOWN_RUN_STAT_KEY.
  src := pg_get_functiondef('public.admin_apply_evo_version(uuid,jsonb,boolean,jsonb)'::regprocedure);
  src := replace(src,
$old$  v_run := coalesce(p_version->'run_stats', '{}'::jsonb);
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
  END LOOP;$old$,
$new$  v_run := coalesce(p_version->'run_stats', p_version->'runs_stats', '{}'::jsonb);
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
  END LOOP;$new$);
  IF src NOT LIKE '%admin_run_stat_keys()) THEN v_run%' THEN
    RAISE EXCEPTION 'PATCH_FAILED: admin_apply_evo_version run-stat extraction not replaced';
  END IF;
  EXECUTE src;

  ----------------------------------------------------------------- evo objectives
  src := pg_get_functiondef('public.admin_apply_evo_core(jsonb,boolean)'::regprocedure);
  src := replace(src,
$old$      v_idx := v_idx + 1;
      IF v_obj->>'objective_type' IS NULL THEN RAISE EXCEPTION 'INVALID_OBJECTIVE: objective_type is required'; END IF;$old$,
$new$      v_idx := v_idx + 1;
      v_obj := public.admin_normalize_evo_objective(v_obj);$new$);
  IF src NOT LIKE '%admin_normalize_evo_objective%' THEN
    RAISE EXCEPTION 'PATCH_FAILED: admin_apply_evo_core objective normalization not applied';
  END IF;
  EXECUTE src;

  --------------------------------------------------------------------- challenges
  src := pg_get_functiondef('public.admin_apply_content(text,jsonb,boolean)'::regprocedure);
  src := replace(src,
$old$    v_card := NULL;
    IF p_payload->>'card_reward' IS NOT NULL THEN
      v_ids := public.admin_resolve_player_ids(jsonb_build_array(p_payload->>'card_reward'));
      v_card := v_ids[1];
    END IF;

    v_stat_player := NULL;$old$,
$new$    v_card := NULL;
    IF p_payload->>'card_reward_id' IS NOT NULL THEN
      v_card := (p_payload->>'card_reward_id')::uuid;
      IF NOT EXISTS (SELECT 1 FROM player_cards WHERE id = v_card) THEN
        RAISE EXCEPTION 'UNKNOWN_PLAYER_CARD_ID: card_reward_id % does not exist', v_card;
      END IF;
    ELSIF p_payload->>'card_reward' IS NOT NULL THEN
      v_ids := public.admin_resolve_player_ids(jsonb_build_array(p_payload->>'card_reward'));
      v_card := v_ids[1];
    END IF;

    v_stat_player := NULL;$new$);
  src := replace(src,
$old$    v_pack_reward := NULL;
    IF p_payload->>'pack_reward' IS NOT NULL THEN$old$,
$new$    v_pack_reward := NULL;
    IF p_payload->>'pack_reward_id' IS NOT NULL THEN
      SELECT id::text INTO v_pack_reward FROM packs WHERE id = (p_payload->>'pack_reward_id')::uuid;
      IF v_pack_reward IS NULL THEN
        RAISE EXCEPTION 'UNKNOWN_PACK_ID: pack_reward_id % does not exist', p_payload->>'pack_reward_id';
      END IF;
    ELSIF p_payload->>'pack_reward' IS NOT NULL THEN$new$);
  src := replace(src,
$old$        'card_reward_id', v_card,
        'stat_limit_player_id', v_stat_player,$old$,
$new$        'card_reward_id', v_card,
        'conditions', p_payload->'conditions',
        'reward_payload', p_payload->'reward_payload',
        'stat_limit_player_id', v_stat_player,$new$);
  src := replace(src,
$old$          spotlight_group, sort_order, lineup_restrictions, is_repeatable, expires_at)$old$,
$new$          spotlight_group, sort_order, lineup_restrictions, is_repeatable, expires_at,
          conditions, reward_payload, status)$new$);
  src := replace(src,
$old$          coalesce((p_payload->>'is_repeatable')::boolean, true),
          (p_payload->>'expires_at')::timestamptz)
        RETURNING id INTO v_id;$old$,
$new$          coalesce((p_payload->>'is_repeatable')::boolean, true),
          (p_payload->>'expires_at')::timestamptz,
          p_payload->'conditions', p_payload->'reward_payload',
          coalesce(nullif(p_payload->>'status',''), 'active')::content_status)
        RETURNING id INTO v_id;$new$);
  src := replace(src,
$old$          card_reward_id = CASE WHEN p_payload ? 'card_reward' THEN v_card ELSE card_reward_id END,$old$,
$new$          card_reward_id = CASE WHEN p_payload ? 'card_reward' OR p_payload ? 'card_reward_id' THEN v_card ELSE card_reward_id END,
          conditions = CASE WHEN p_payload ? 'conditions' THEN p_payload->'conditions' ELSE conditions END,
          reward_payload = CASE WHEN p_payload ? 'reward_payload' THEN p_payload->'reward_payload' ELSE reward_payload END,
          status = CASE WHEN nullif(p_payload->>'status','') IS NOT NULL THEN (p_payload->>'status')::content_status ELSE status END,$new$);
  src := replace(src,
$old$          pack_reward = CASE WHEN p_payload ? 'pack_reward' THEN v_pack_reward ELSE pack_reward END,$old$,
$new$          pack_reward = CASE WHEN p_payload ? 'pack_reward' OR p_payload ? 'pack_reward_id' THEN v_pack_reward ELSE pack_reward END,$new$);
  IF src NOT LIKE '%card_reward_id % does not exist%'
     OR src NOT LIKE '%pack_reward_id % does not exist%'
     OR src NOT LIKE '%reward_payload = CASE WHEN%' THEN
    RAISE EXCEPTION 'PATCH_FAILED: challenge branch patches not fully applied';
  END IF;
  EXECUTE src;
END
$mig$;