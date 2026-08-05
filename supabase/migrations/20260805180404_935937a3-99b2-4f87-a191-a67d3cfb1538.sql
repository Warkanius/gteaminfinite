CREATE OR REPLACE FUNCTION public.content_release_preview_commit(
  p_preview_id uuid,
  p_approved_payload_hash text,
  p_idempotency_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    IF p_idempotency_key IS NOT NULL AND v_row.idempotency_key = p_idempotency_key THEN
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
END $$;