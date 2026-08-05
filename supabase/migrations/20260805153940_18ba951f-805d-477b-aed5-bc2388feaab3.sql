-- Durable content-release previews: approve in one turn, commit in a later turn.
CREATE TABLE public.content_release_previews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payload_hash text NOT NULL,
  canonical_payload jsonb NOT NULL,
  preview_token_encrypted text,
  preview_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  operation_plan jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  requested_by uuid NOT NULL,
  approved_at timestamptz,
  committed_at timestamptz,
  expires_at timestamptz NOT NULL,
  commit_result jsonb,
  verification_result jsonb,
  idempotency_key text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_release_previews_status_check
    CHECK (status IN ('pending','committed','expired','cancelled','failed'))
);

-- Server-only table: no Data API access at all. Reached exclusively through the
-- security-definer functions below so the stored token never leaves the server.
GRANT ALL ON public.content_release_previews TO service_role;
ALTER TABLE public.content_release_previews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role manages release previews"
  ON public.content_release_previews FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX content_release_previews_requested_by_idx
  ON public.content_release_previews (requested_by, created_at DESC);
CREATE INDEX content_release_previews_status_idx ON public.content_release_previews (status);

CREATE TRIGGER content_release_previews_updated_at
  BEFORE UPDATE ON public.content_release_previews
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------- redaction
CREATE OR REPLACE FUNCTION public.content_release_preview_public(p_row public.content_release_previews)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public AS $$
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
$$;

-- ---------------------------------------------------------------- store
CREATE OR REPLACE FUNCTION public.content_release_preview_store(
  p_payload_hash text,
  p_canonical_payload jsonb,
  p_preview_token text,
  p_summary jsonb,
  p_plan jsonb,
  p_ttl_minutes integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
END $$;

-- ---------------------------------------------------------------- read
CREATE OR REPLACE FUNCTION public.content_release_preview_get(p_preview_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
END $$;

-- ---------------------------------------------------------------- cancel
CREATE OR REPLACE FUNCTION public.content_release_preview_cancel(p_preview_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
END $$;

-- ---------------------------------------------------------------- verification
-- Verifies every immutable id the transaction produced actually exists.
CREATE OR REPLACE FUNCTION public.content_release_verify(p_result jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tables text[] := ARRAY['release_bundles','player_cards','collections','collection_requirements','sub_collections',
    'teams','team_players','packs','pack_players','pack_odds','evo_paths','evo_objectives','evo_card_versions',
    'evo_card_version_badges','evo_card_version_traits','player_card_badges','player_card_traits','locker_codes',
    'challenges','gem_tasks','dynamic_duos','release_bundle_entities'];
  v_rec record; v_exists boolean; v_errors jsonb := '[]'::jsonb; v_seen jsonb := '{}'::jsonb;
  v_players jsonb := '[]'::jsonb; v_paths jsonb := '[]'::jsonb; v_versions jsonb := '[]'::jsonb;
  v_release uuid; v_collection uuid; v_pack uuid; v_code uuid; v_key text;
BEGIN
  FOR v_rec IN
    SELECT DISTINCT op->>'table' AS tbl, op->>'id' AS id
      FROM jsonb_array_elements(coalesce(p_result->'results','[]'::jsonb)) r,
           jsonb_array_elements(coalesce(r.value->'result'->'operations','[]'::jsonb)) op
     WHERE op->>'id' IS NOT NULL AND op->>'table' IS NOT NULL
  LOOP
    v_key := v_rec.tbl || ':' || v_rec.id;
    IF v_seen ? v_key THEN CONTINUE; END IF;
    v_seen := v_seen || jsonb_build_object(v_key, true);

    IF NOT (v_rec.tbl = ANY (v_tables)) THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'code','VERIFICATION_FAILED','table', v_rec.tbl, 'id', v_rec.id,
        'message','unexpected table in release result; cannot verify'));
      CONTINUE;
    END IF;

    EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE id = $1)', v_rec.tbl)
      INTO v_exists USING v_rec.id::uuid;
    IF NOT v_exists THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'code','VERIFICATION_FAILED','table', v_rec.tbl, 'id', v_rec.id,
        'message','row is missing after commit'));
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
        'code','VERIFICATION_FAILED','table','collections','id', v_collection,
        'message','collection reward card is missing'));
    END IF;
  END IF;

  -- Pack odds must still total exactly 100.00 for a pack written in this release.
  IF v_pack IS NOT NULL THEN
    PERFORM 1 FROM public.pack_odds o WHERE o.pack_id = v_pack
      HAVING round(sum(o.percentage)::numeric, 2) <> 100.00;
    IF FOUND THEN
      v_errors := v_errors || jsonb_build_array(jsonb_build_object(
        'code','VERIFICATION_FAILED','table','pack_odds','id', v_pack,
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
    'locker_code_id', v_code,
    'verification_errors', v_errors);
END $$;

-- ---------------------------------------------------------------- commit by id
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

  -- Reuse the stored backend token when it is still usable, otherwise mint a
  -- fresh one for the SAME stored canonical payload. The payload is never
  -- re-previewed, re-normalized or re-resolved here.
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

REVOKE EXECUTE ON FUNCTION public.content_release_preview_store(text, jsonb, text, jsonb, jsonb, integer) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.content_release_preview_get(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.content_release_preview_cancel(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.content_release_preview_commit(uuid, text, text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.content_release_verify(jsonb) FROM anon, public, authenticated;
GRANT EXECUTE ON FUNCTION public.content_release_preview_store(text, jsonb, text, jsonb, jsonb, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.content_release_preview_get(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.content_release_preview_cancel(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.content_release_preview_commit(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.content_release_verify(jsonb) TO service_role;