ALTER TABLE public.content_release_previews DROP CONSTRAINT IF EXISTS content_release_previews_status_check;
ALTER TABLE public.content_release_previews ADD CONSTRAINT content_release_previews_status_check
  CHECK (status IN ('pending','committing','committed','expired','cancelled','failed'));

-- Claim: run every guard synchronously, then hand the release to a background commit.
CREATE OR REPLACE FUNCTION public.content_release_preview_claim(
  p_preview_id uuid,
  p_approved_payload_hash text,
  p_idempotency_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    IF p_idempotency_key IS NOT NULL AND v_row.idempotency_key = p_idempotency_key THEN
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
         -- keep the approval alive long enough for the background commit to finish
         expires_at = greatest(expires_at, now() + interval '15 minutes'),
         last_error = NULL
   WHERE id = v_row.id
  RETURNING * INTO v_row;

  RETURN public.content_release_preview_public(v_row) || jsonb_build_object('claimed', true);
END $$;

-- Record a background commit failure so polling reports it instead of hanging.
CREATE OR REPLACE FUNCTION public.content_release_preview_fail(
  p_preview_id uuid,
  p_error text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.content_release_previews;
BEGIN
  PERFORM public.admin_require_admin();
  UPDATE public.content_release_previews
     SET status = 'failed', last_error = left(coalesce(p_error, 'commit failed'), 4000)
   WHERE id = p_preview_id AND requested_by = auth.uid() AND status = 'committing'
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'preview_id', p_preview_id); END IF;
  RETURN public.content_release_preview_public(v_row);
END $$;

REVOKE EXECUTE ON FUNCTION public.content_release_preview_claim(uuid, text, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.content_release_preview_fail(uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.content_release_preview_claim(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.content_release_preview_fail(uuid, text) TO authenticated, service_role;