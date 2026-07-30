CREATE OR REPLACE FUNCTION public.__mcp_selftest(p_uid uuid, p_kind text, p_payload jsonb, p_commit boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  BEGIN
    v := public.admin_apply_content(p_kind, p_payload, p_commit);
  EXCEPTION WHEN others THEN
    v := jsonb_build_object('error', SQLERRM);
  END;
  RETURN v;
END
$fn$;