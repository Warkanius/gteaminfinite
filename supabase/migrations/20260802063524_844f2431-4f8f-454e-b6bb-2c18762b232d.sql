CREATE OR REPLACE FUNCTION public.admin_entity_lookup(p_table text, p_name_column text, p_name text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  EXECUTE format('SELECT jsonb_build_object(''n'', count(*), ''id'', min(id::text))
                  FROM public.%I WHERE lower(btrim(%I::text)) = lower(btrim($1))', p_table, p_name_column)
    INTO v USING p_name;
  RETURN coalesce(v, jsonb_build_object('n', 0));
END $$;

REVOKE EXECUTE ON FUNCTION public.admin_entity_lookup(text,text,text) FROM anon;