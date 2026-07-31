CREATE OR REPLACE FUNCTION public.admin_substitute_refs(p_item jsonb, p_refs jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  v_out jsonb := '{}'::jsonb;
  v_k text; v_v jsonb; v_target text; v_val text; v_arr jsonb; v_el jsonb; v_pending int;
BEGIN
  IF p_item IS NULL OR jsonb_typeof(p_item) <> 'object' THEN RETURN p_item; END IF;
  FOR v_k, v_v IN SELECT key, value FROM jsonb_each(p_item) LOOP
    v_target := CASE WHEN v_k ~ '_ref$' THEN regexp_replace(v_k, '_ref$', '_id') ELSE v_k END;
    IF jsonb_typeof(v_v) = 'string' AND (v_v #>> '{}') LIKE 'ref:%' THEN
      v_val := p_refs->>(v_v #>> '{}');
      IF v_val IS NULL THEN
        RAISE EXCEPTION 'UNKNOWN_TEMP_REF: "%" was never declared as a temp_ref in this batch', v_v #>> '{}';
      END IF;
      IF v_val = 'pending' THEN
        v_out := v_out || jsonb_build_object(v_target || '_pending', v_v #>> '{}');
      ELSE
        v_out := v_out || jsonb_build_object(v_target, v_val);
      END IF;
    ELSIF jsonb_typeof(v_v) = 'array' THEN
      v_arr := '[]'::jsonb; v_pending := 0;
      FOR v_el IN SELECT * FROM jsonb_array_elements(v_v) LOOP
        v_val := NULL;
        IF jsonb_typeof(v_el) = 'string' AND (v_el #>> '{}') LIKE 'ref:%' THEN
          v_val := p_refs->>(v_el #>> '{}');
          IF v_val IS NULL THEN RAISE EXCEPTION 'UNKNOWN_TEMP_REF: "%"', v_el #>> '{}'; END IF;
        ELSIF jsonb_typeof(v_el) = 'object' AND (v_el->>'player_ref') IS NOT NULL THEN
          v_val := p_refs->>(v_el->>'player_ref');
          IF v_val IS NULL THEN RAISE EXCEPTION 'UNKNOWN_TEMP_REF: "%"', v_el->>'player_ref'; END IF;
        END IF;
        IF v_val IS NULL THEN
          IF jsonb_typeof(v_el) = 'object' THEN
            v_arr := v_arr || jsonb_build_array(public.admin_substitute_refs(v_el, p_refs));
          ELSE
            v_arr := v_arr || jsonb_build_array(v_el);
          END IF;
        ELSIF v_val = 'pending' THEN
          v_pending := v_pending + 1;
        ELSE
          v_arr := v_arr || jsonb_build_array(jsonb_build_object('player_id', v_val));
        END IF;
      END LOOP;
      IF v_pending > 0 THEN
        v_out := v_out || jsonb_build_object(v_target || '_pending', v_pending);
        IF jsonb_array_length(v_arr) > 0 THEN v_out := v_out || jsonb_build_object(v_target, v_arr); END IF;
      ELSE
        v_out := v_out || jsonb_build_object(v_target, v_arr);
      END IF;
    ELSIF jsonb_typeof(v_v) = 'object' THEN
      v_out := v_out || jsonb_build_object(v_target, public.admin_substitute_refs(v_v, p_refs));
    ELSE
      v_out := v_out || jsonb_build_object(v_target, v_v);
    END IF;
  END LOOP;
  RETURN v_out;
END $$;

REVOKE ALL ON FUNCTION public.admin_substitute_refs(jsonb, jsonb) FROM anon;