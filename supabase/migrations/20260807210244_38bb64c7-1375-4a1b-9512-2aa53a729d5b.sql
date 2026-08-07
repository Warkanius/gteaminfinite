DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'content_release_verify_base'
  ) THEN
    ALTER FUNCTION public.content_release_verify(jsonb) RENAME TO content_release_verify_base;
  END IF;
END $$;

-- Field-level verification of every evo_card_version written by a release.
CREATE OR REPLACE FUNCTION public.content_release_verify_evo(p_result jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
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
END $function$;

CREATE OR REPLACE FUNCTION public.content_release_verify(p_result jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_out jsonb; v_extra jsonb; v_errors jsonb;
BEGIN
  v_out := public.content_release_verify_base(p_result);
  v_extra := public.content_release_verify_evo(p_result);
  v_errors := coalesce(v_out->'verification_errors', '[]'::jsonb) || coalesce(v_extra, '[]'::jsonb);
  RETURN v_out
    || jsonb_build_object('verification_errors', v_errors)
    || jsonb_build_object('verified', jsonb_array_length(v_errors) = 0);
END $function$;