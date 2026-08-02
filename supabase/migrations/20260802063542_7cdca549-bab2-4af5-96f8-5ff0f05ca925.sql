DO $mig$
DECLARE v_def text;
BEGIN
  v_def := pg_get_functiondef('public.admin_apply_entity(text,jsonb,boolean)'::regprocedure);
  v_def := replace(v_def,
$old$    EXECUTE format('SELECT array_agg(id) FROM public.%I WHERE lower(btrim(%I::text)) = lower(btrim($1))',
                   v_tbl, v_meta->>'name_column')
      INTO v_resolved USING coalesce(v_item->>'name', v_item->>'title', v_item->>'code');
    EXECUTE format('SELECT count(*), min(id) FROM public.%I WHERE lower(btrim(%I::text)) = lower(btrim($1))',
                   v_tbl, v_meta->>'name_column')
      INTO v_n, v_id USING coalesce(v_item->>'name', v_item->>'title', v_item->>'code');$old$,
$new$    v_resolved := public.admin_entity_lookup(v_tbl, v_meta->>'name_column',
                     coalesce(v_item->>'name', v_item->>'title', v_item->>'code'));
    v_n := (v_resolved->>'n')::int;
    v_id := nullif(v_resolved->>'id','')::uuid;$new$);
  IF v_def NOT LIKE '%admin_entity_lookup%' THEN
    RAISE EXCEPTION 'patch target not found in admin_apply_entity';
  END IF;
  EXECUTE v_def;
END $mig$;