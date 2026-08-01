CREATE OR REPLACE FUNCTION public.admin_issue_preview_token(p_kind text, p_payload jsonb, p_fingerprint text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
END $$;

REVOKE EXECUTE ON FUNCTION public.admin_issue_preview_token(text, jsonb, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_consume_preview_token(text, text, jsonb, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_audit_write(text, text, uuid, text, text, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_road_fingerprint(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_road_outside_fingerprint(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_content_restore_payload(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.admin_road_bulk(jsonb, boolean, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.admin_road_bulk(jsonb, boolean, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_content_restore_payload(uuid) TO authenticated, service_role;