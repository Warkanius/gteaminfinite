-- Helpers: detect and describe references that point at another item created in
-- the same batch. admin_substitute_refs marks these with a "<field>_pending" key
-- because nothing is written during a zero-write preview.
CREATE OR REPLACE FUNCTION public.admin_pending_refs(p_item jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $fn$
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
END $fn$;

CREATE OR REPLACE FUNCTION public.admin_has_pending_ref(p_item jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $fn$ SELECT public.admin_pending_refs(p_item) <> '{}'::jsonb $fn$;

GRANT EXECUTE ON FUNCTION public.admin_pending_refs(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_has_pending_ref(jsonb) TO authenticated, service_role;

-- Patch admin_apply_batch in place: during preview only, an item whose reference
-- resolves to a same-batch pending item is reported in the plan instead of
-- aborting the whole preview. Commit behaviour is unchanged.
DO $do$
DECLARE
  v_src text;
  v_anchor text := 'v_item := v_item - ''replace_roster'' - ''action'';';
  v_ins text := '
      IF NOT p_commit AND public.admin_has_pending_ref(v_item) THEN
        v_res := jsonb_build_object(
          ''pending_same_batch_reference'', true,
          ''pending_references'', public.admin_pending_refs(v_item),
          ''note'', ''This item links to another item created in the same batch, so it has no id during a zero-write preview. It is fully validated on commit, when the reference resolves inside the transaction.'');
        v_results := v_results || jsonb_build_object(''group'', v_group, ''index'', v_idx, ''result'', v_res);
        v_creates := v_creates || jsonb_build_object(''group'', v_group, ''index'', v_idx,
          ''table'', v_group,
          ''match'', coalesce(v_item->>''name'', v_item->>''code'', v_item->>''player_name'', ''same-batch reference''),
          ''fields'', v_item,
          ''pending_references'', public.admin_pending_refs(v_item));
        v_resolved := v_resolved || jsonb_build_object(''group'', v_group, ''index'', v_idx,
          ''references'', public.admin_pending_refs(v_item));
        CONTINUE;
      END IF;
';
BEGIN
  v_src := pg_get_functiondef('public.admin_apply_batch(jsonb,boolean,text,text)'::regprocedure);
  IF position('admin_has_pending_ref' in v_src) > 0 THEN
    RAISE NOTICE 'admin_apply_batch already tolerates pending same-batch references';
    RETURN;
  END IF;
  IF position(v_anchor in v_src) = 0 THEN
    RAISE EXCEPTION 'PATCH_ANCHOR_NOT_FOUND: admin_apply_batch source changed shape';
  END IF;
  v_src := replace(v_src, v_anchor, v_anchor || v_ins);
  EXECUTE v_src;
END $do$;