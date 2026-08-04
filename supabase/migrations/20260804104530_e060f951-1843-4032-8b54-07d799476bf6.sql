-- 1. Supported evo objective registry (extensible)
CREATE TABLE IF NOT EXISTS public.evo_objective_registry (
  key text PRIMARY KEY,
  label text NOT NULL,
  objective_type text NOT NULL,
  stat_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.evo_objective_registry TO anon;
GRANT SELECT ON public.evo_objective_registry TO authenticated;
GRANT ALL ON public.evo_objective_registry TO service_role;
ALTER TABLE public.evo_objective_registry ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "evo_objective_registry readable" ON public.evo_objective_registry;
CREATE POLICY "evo_objective_registry readable" ON public.evo_objective_registry FOR SELECT USING (true);
DROP POLICY IF EXISTS "evo_objective_registry admin write" ON public.evo_objective_registry;
CREATE POLICY "evo_objective_registry admin write" ON public.evo_objective_registry
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

INSERT INTO public.evo_objective_registry (key, label, objective_type, stat_key) VALUES
  ('points','Points','total_stat','stat_pts'),
  ('three_pointers_made','Three-pointers made','total_stat','stat_3pt'),
  ('mid_range_shots_made','Mid-range shots made','total_stat','stat_mid'),
  ('dunks_made','Dunks made','total_stat','stat_dnk'),
  ('assists','Assists','total_stat','stat_ast'),
  ('steals','Steals','total_stat','stat_stl'),
  ('rebounds','Rebounds','total_stat','stat_reb'),
  ('blocks','Blocks','total_stat','stat_blk'),
  ('games_won','Games won','games_won',NULL)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.admin_evo_objective_keys()
RETURNS text[] LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce(array_agg(key ORDER BY key), ARRAY[]::text[]) FROM public.evo_objective_registry
$$;

-- 2. Materialized evo card versions
CREATE TABLE IF NOT EXISTS public.evo_card_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evo_path_id uuid NOT NULL REFERENCES public.evo_paths(id) ON DELETE CASCADE,
  base_player_card_id uuid NOT NULL REFERENCES public.player_cards(id) ON DELETE CASCADE,
  version_order integer NOT NULL,
  gem_tier_id uuid REFERENCES public.gem_tiers(id),
  gem_name text,
  rating numeric,
  stat_3pt integer NOT NULL DEFAULT 0,
  stat_mid integer NOT NULL DEFAULT 0,
  stat_fin integer NOT NULL DEFAULT 0,
  stat_dnk integer NOT NULL DEFAULT 0,
  stat_ast integer NOT NULL DEFAULT 0,
  stat_stl integer NOT NULL DEFAULT 0,
  stat_reb integer NOT NULL DEFAULT 0,
  stat_blk integer NOT NULL DEFAULT 0,
  stat_int integer NOT NULL DEFAULT 0,
  status public.content_status NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evo_card_versions_one_per_step UNIQUE (evo_path_id),
  CONSTRAINT evo_card_versions_order_uniq UNIQUE (base_player_card_id, version_order),
  CONSTRAINT evo_card_versions_order_chk CHECK (version_order >= 1)
);
GRANT SELECT ON public.evo_card_versions TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.evo_card_versions TO authenticated;
GRANT ALL ON public.evo_card_versions TO service_role;
ALTER TABLE public.evo_card_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "evo_card_versions readable" ON public.evo_card_versions;
CREATE POLICY "evo_card_versions readable" ON public.evo_card_versions FOR SELECT USING (true);
DROP POLICY IF EXISTS "evo_card_versions admin write" ON public.evo_card_versions;
CREATE POLICY "evo_card_versions admin write" ON public.evo_card_versions
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE INDEX IF NOT EXISTS evo_card_versions_card_idx ON public.evo_card_versions (base_player_card_id, version_order);

DROP TRIGGER IF EXISTS evo_card_versions_updated_at ON public.evo_card_versions;
CREATE TRIGGER evo_card_versions_updated_at BEFORE UPDATE ON public.evo_card_versions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- version must belong to the same base card as its step, and use the step target tier
CREATE OR REPLACE FUNCTION public.evo_card_versions_validate()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE v_card uuid; v_to uuid;
BEGIN
  SELECT player_card_id, to_tier_id INTO v_card, v_to FROM public.evo_paths WHERE id = NEW.evo_path_id;
  IF v_card IS NULL THEN
    RAISE EXCEPTION 'EVO_STEP_NOT_FOUND: evo_path_id % does not exist', NEW.evo_path_id;
  END IF;
  IF NEW.base_player_card_id <> v_card THEN
    RAISE EXCEPTION 'EVO_VERSION_CARD_MISMATCH: version base card does not match its evo step card';
  END IF;
  IF v_to IS NOT NULL AND NEW.gem_tier_id IS NOT NULL AND NEW.gem_tier_id <> v_to THEN
    RAISE EXCEPTION 'EVO_VERSION_TIER_MISMATCH: version tier must equal the evo step target tier';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS evo_card_versions_validate_trg ON public.evo_card_versions;
CREATE TRIGGER evo_card_versions_validate_trg BEFORE INSERT OR UPDATE ON public.evo_card_versions
  FOR EACH ROW EXECUTE FUNCTION public.evo_card_versions_validate();

CREATE TABLE IF NOT EXISTS public.evo_card_version_badges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evo_card_version_id uuid NOT NULL REFERENCES public.evo_card_versions(id) ON DELETE CASCADE,
  badge_id uuid NOT NULL REFERENCES public.badges(id) ON DELETE CASCADE,
  tier text NOT NULL DEFAULT 'base',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evo_card_version_badges_uniq UNIQUE (evo_card_version_id, badge_id),
  CONSTRAINT evo_card_version_badges_tier_chk CHECK (tier IN ('base','gold','hof','diamond','actolytrene'))
);
GRANT SELECT ON public.evo_card_version_badges TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.evo_card_version_badges TO authenticated;
GRANT ALL ON public.evo_card_version_badges TO service_role;
ALTER TABLE public.evo_card_version_badges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "evo_card_version_badges readable" ON public.evo_card_version_badges;
CREATE POLICY "evo_card_version_badges readable" ON public.evo_card_version_badges FOR SELECT USING (true);
DROP POLICY IF EXISTS "evo_card_version_badges admin write" ON public.evo_card_version_badges;
CREATE POLICY "evo_card_version_badges admin write" ON public.evo_card_version_badges
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TABLE IF NOT EXISTS public.evo_card_version_traits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evo_card_version_id uuid NOT NULL REFERENCES public.evo_card_versions(id) ON DELETE CASCADE,
  trait_id uuid NOT NULL REFERENCES public.signature_traits(id) ON DELETE CASCADE,
  tier text NOT NULL DEFAULT 'base',
  target_stat text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evo_card_version_traits_uniq UNIQUE (evo_card_version_id, trait_id),
  CONSTRAINT evo_card_version_traits_tier_chk CHECK (tier IN ('base','gold','hof','diamond','actolytrene'))
);
GRANT SELECT ON public.evo_card_version_traits TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.evo_card_version_traits TO authenticated;
GRANT ALL ON public.evo_card_version_traits TO service_role;
ALTER TABLE public.evo_card_version_traits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "evo_card_version_traits readable" ON public.evo_card_version_traits;
CREATE POLICY "evo_card_version_traits readable" ON public.evo_card_version_traits FOR SELECT USING (true);
DROP POLICY IF EXISTS "evo_card_version_traits admin write" ON public.evo_card_version_traits;
CREATE POLICY "evo_card_version_traits admin write" ON public.evo_card_version_traits
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 3. Ownership stays on the base card; the active version is tracked separately
ALTER TABLE public.user_collections
  ADD COLUMN IF NOT EXISTS active_evo_version_id uuid REFERENCES public.evo_card_versions(id) ON DELETE SET NULL;

-- 4. Version materialization used by the release engine
CREATE OR REPLACE FUNCTION public.admin_apply_evo_version(
  p_evo_path_id uuid,
  p_version jsonb,
  p_commit boolean,
  p_step jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_card uuid; v_to uuid; v_to_name text; v_order int; v_id uuid;
  v_stats jsonb := coalesce(p_version->'stats', '{}'::jsonb);
  v_key text; v_val numeric;
  v_badges jsonb := '[]'::jsonb; v_traits jsonb := '[]'::jsonb;
  v_b jsonb; v_bid uuid; v_needs boolean;
  v_before jsonb; v_ops jsonb := '[]'::jsonb; v_destr jsonb := '[]'::jsonb; v_warn jsonb := '[]'::jsonb;
  v_fields jsonb; v_res jsonb; v_match text; v_action text;
BEGIN
  IF p_evo_path_id IS NOT NULL THEN
    SELECT player_card_id, to_tier_id, step_order INTO v_card, v_to, v_order
      FROM public.evo_paths WHERE id = p_evo_path_id;
  END IF;
  IF v_card IS NULL THEN
    v_card := nullif(p_step->>'player_card_id','')::uuid;
    v_order := coalesce((p_step->>'step_order')::int, 1);
    IF p_step ? 'to_tier' THEN
      SELECT id, name INTO v_to, v_to_name FROM public.gem_tiers WHERE lower(name) = lower(p_step->>'to_tier');
    END IF;
  ELSE
    SELECT name INTO v_to_name FROM public.gem_tiers WHERE id = v_to;
  END IF;

  -- stats
  FOR v_key IN SELECT jsonb_object_keys(v_stats) LOOP
    IF NOT (v_key = ANY(public.admin_stat_keys())) THEN
      RAISE EXCEPTION 'UNKNOWN_STAT_KEY: resulting_version.stats."%" is not a stat detail=%', v_key,
        jsonb_build_object('supported', public.admin_stat_keys())::text;
    END IF;
    v_val := (v_stats->>v_key)::numeric;
    IF v_val < 0 OR v_val > 99 THEN
      RAISE EXCEPTION 'STAT_OUT_OF_RANGE: resulting_version.stats.% = % must be between 0 and 99', v_key, v_val;
    END IF;
  END LOOP;

  -- badges (full replacement)
  FOR v_b IN SELECT * FROM jsonb_array_elements(coalesce(p_version->'badges','[]'::jsonb)) LOOP
    IF jsonb_typeof(v_b) = 'string' THEN v_b := jsonb_build_object('badge', v_b #>> '{}'); END IF;
    IF v_b ? 'badge_id' THEN
      SELECT id INTO v_bid FROM public.badges WHERE id = (v_b->>'badge_id')::uuid;
    ELSE
      SELECT id INTO v_bid FROM public.badges
       WHERE lower(name) = lower(coalesce(v_b->>'badge', v_b->>'name'))
          OR lower(abbreviation) = lower(coalesce(v_b->>'badge', v_b->>'name'));
    END IF;
    IF v_bid IS NULL THEN RAISE EXCEPTION 'UNKNOWN_BADGE: "%"', coalesce(v_b->>'badge', v_b->>'name', v_b->>'badge_id'); END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_badges) e WHERE (e->>'badge_id')::uuid = v_bid) THEN
      RAISE EXCEPTION 'DUPLICATE_BADGE_ASSIGNMENT: badge "%" listed twice for one evo version', coalesce(v_b->>'badge', v_b->>'name');
    END IF;
    v_badges := v_badges || jsonb_build_array(jsonb_build_object(
      'badge_id', v_bid, 'name', coalesce(v_b->>'badge', v_b->>'name'),
      'tier', coalesce(v_b->>'tier','base')));
  END LOOP;

  -- traits (full replacement)
  FOR v_b IN SELECT * FROM jsonb_array_elements(coalesce(p_version->'traits','[]'::jsonb)) LOOP
    IF jsonb_typeof(v_b) = 'string' THEN v_b := jsonb_build_object('trait', v_b #>> '{}'); END IF;
    IF v_b ? 'trait_id' THEN
      SELECT id, coalesce(requires_target_stat,false) INTO v_bid, v_needs
        FROM public.signature_traits WHERE id = (v_b->>'trait_id')::uuid;
    ELSE
      SELECT id, coalesce(requires_target_stat,false) INTO v_bid, v_needs FROM public.signature_traits
       WHERE lower(name) = lower(coalesce(v_b->>'trait', v_b->>'name'))
          OR lower(abbreviation) = lower(coalesce(v_b->>'trait', v_b->>'name'));
    END IF;
    IF v_bid IS NULL THEN RAISE EXCEPTION 'UNKNOWN_TRAIT: "%"', coalesce(v_b->>'trait', v_b->>'name', v_b->>'trait_id'); END IF;
    IF v_b ? 'target_stat' AND v_b->>'target_stat' IS NOT NULL
       AND NOT (v_b->>'target_stat' = ANY(public.admin_stat_keys())) THEN
      RAISE EXCEPTION 'UNKNOWN_STAT_KEY: trait target_stat "%" detail=%', v_b->>'target_stat',
        jsonb_build_object('supported', public.admin_stat_keys())::text;
    END IF;
    IF v_needs AND nullif(btrim(coalesce(v_b->>'target_stat','')),'') IS NULL THEN
      RAISE EXCEPTION 'TRAIT_TARGET_STAT_REQUIRED: trait "%" needs target_stat', coalesce(v_b->>'trait', v_b->>'name');
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_traits) e WHERE (e->>'trait_id')::uuid = v_bid) THEN
      RAISE EXCEPTION 'DUPLICATE_TRAIT_ASSIGNMENT: trait "%" listed twice for one evo version', coalesce(v_b->>'trait', v_b->>'name');
    END IF;
    v_traits := v_traits || jsonb_build_array(jsonb_build_object(
      'trait_id', v_bid, 'name', coalesce(v_b->>'trait', v_b->>'name'),
      'tier', coalesce(v_b->>'tier','base'), 'target_stat', v_b->>'target_stat'));
  END LOOP;

  IF p_evo_path_id IS NOT NULL THEN
    SELECT id INTO v_id FROM public.evo_card_versions WHERE evo_path_id = p_evo_path_id;
  END IF;
  v_action := CASE WHEN v_id IS NULL THEN 'create' ELSE 'update' END;
  v_match := format('%s v%s (%s)', (SELECT name FROM public.player_cards WHERE id = v_card), v_order, coalesce(v_to_name,'?'));

  v_fields := jsonb_build_object(
    'evo_path_id', p_evo_path_id, 'base_player_card_id', v_card,
    'version_order', v_order, 'gem_tier_id', v_to,
    'gem_name', coalesce(p_version->>'gem_name', v_to_name),
    'rating', p_version->'rating',
    'status', coalesce(p_version->>'status','draft')
  ) || v_stats;

  IF p_evo_path_id IS NOT NULL THEN
    v_res := public.admin_upsert_row('evo_card_versions', v_id, v_fields, v_match, p_commit, v_action);
    v_id := coalesce((v_res->>'id')::uuid, v_id);
    v_ops := v_ops || coalesce(v_res->'operations','[]'::jsonb);
  ELSE
    v_ops := v_ops || jsonb_build_array(jsonb_build_object(
      'action','create','table','evo_card_versions','match',v_match,'fields',v_fields));
  END IF;

  -- badge replacement
  SELECT coalesce(jsonb_agg(jsonb_build_object('badge_id', b.badge_id, 'name', bg.name, 'tier', b.tier)), '[]'::jsonb)
    INTO v_before FROM public.evo_card_version_badges b
    JOIN public.badges bg ON bg.id = b.badge_id WHERE b.evo_card_version_id = v_id;
  IF coalesce(v_before,'[]'::jsonb) <> '[]'::jsonb OR v_badges <> '[]'::jsonb THEN
    v_destr := v_destr || jsonb_build_object('action','replace','label','DESTRUCTIVE_REPLACEMENT',
      'table','evo_card_version_badges','id',v_id,'match',v_match,
      'message','this evo version badge list is fully replaced',
      'before', coalesce(v_before,'[]'::jsonb), 'after', v_badges);
  END IF;
  IF p_commit AND v_id IS NOT NULL THEN
    DELETE FROM public.evo_card_version_badges WHERE evo_card_version_id = v_id;
    INSERT INTO public.evo_card_version_badges (evo_card_version_id, badge_id, tier)
      SELECT v_id, (e->>'badge_id')::uuid, e->>'tier' FROM jsonb_array_elements(v_badges) e;
  END IF;

  -- trait replacement
  SELECT coalesce(jsonb_agg(jsonb_build_object('trait_id', t.trait_id, 'name', st.name, 'tier', t.tier, 'target_stat', t.target_stat)), '[]'::jsonb)
    INTO v_before FROM public.evo_card_version_traits t
    JOIN public.signature_traits st ON st.id = t.trait_id WHERE t.evo_card_version_id = v_id;
  IF coalesce(v_before,'[]'::jsonb) <> '[]'::jsonb OR v_traits <> '[]'::jsonb THEN
    v_destr := v_destr || jsonb_build_object('action','replace','label','DESTRUCTIVE_REPLACEMENT',
      'table','evo_card_version_traits','id',v_id,'match',v_match,
      'message','this evo version trait list is fully replaced',
      'before', coalesce(v_before,'[]'::jsonb), 'after', v_traits);
  END IF;
  IF p_commit AND v_id IS NOT NULL THEN
    DELETE FROM public.evo_card_version_traits WHERE evo_card_version_id = v_id;
    INSERT INTO public.evo_card_version_traits (evo_card_version_id, trait_id, tier, target_stat)
      SELECT v_id, (e->>'trait_id')::uuid, e->>'tier', e->>'target_stat' FROM jsonb_array_elements(v_traits) e;
  END IF;

  IF v_stats = '{}'::jsonb THEN
    v_warn := v_warn || jsonb_build_object('code','EVO_VERSION_NO_STATS',
      'message', format('%s has no resulting stats: the version inherits zeros', v_match));
  END IF;

  RETURN jsonb_build_object('kind','evo_card_version','id', v_id, 'match', v_match,
    'version_order', v_order, 'to_tier', v_to_name, 'base_player_card_id', v_card,
    'badges', v_badges, 'traits', v_traits,
    'applied', p_commit, 'operations', v_ops, 'destructive', v_destr, 'warnings', v_warn);
END $$;
REVOKE EXECUTE ON FUNCTION public.admin_apply_evo_version(uuid,jsonb,boolean,jsonb) FROM anon;

-- 5. Wrap the evo engine so every step materializes its version in the same transaction
ALTER FUNCTION public.admin_apply_evo(jsonb, boolean) RENAME TO admin_apply_evo_core;

CREATE OR REPLACE FUNCTION public.admin_apply_evo(p_item jsonb, p_commit boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_res jsonb; v_ver jsonb; v_obj jsonb; v_key text; v_step jsonb;
  v_version jsonb := coalesce(p_item->'resulting_version', p_item->'version');
BEGIN
  -- validate objective keys against the extensible registry when supplied by key
  FOR v_obj IN SELECT * FROM jsonb_array_elements(coalesce(p_item->'objectives','[]'::jsonb)) LOOP
    v_key := v_obj->>'key';
    IF v_key IS NOT NULL AND NOT (v_key = ANY(public.admin_evo_objective_keys())) THEN
      RAISE EXCEPTION 'UNSUPPORTED_OBJECTIVE: "%" is not a supported tracked objective detail=%', v_key,
        jsonb_build_object('supported', public.admin_evo_objective_keys())::text;
    END IF;
  END LOOP;

  v_res := public.admin_apply_evo_core(p_item - 'resulting_version' - 'version', p_commit);

  IF v_version IS NULL THEN
    RETURN jsonb_set(v_res, '{warnings}',
      coalesce(v_res->'warnings','[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'code','EVO_VERSION_MISSING',
        'message','this step has no resulting_version: the evolution has no materialized playable card')));
  END IF;

  v_step := jsonb_build_object(
    'player_card_id', v_res->'resolved_references'->>'player_card_id',
    'step_order', v_res->>'step_order',
    'to_tier', p_item->>'to_tier');
  IF v_step->>'step_order' IS NULL THEN
    v_step := v_step || jsonb_build_object('step_order', p_item->>'step_order');
  END IF;

  v_ver := public.admin_apply_evo_version(nullif(v_res->>'id','')::uuid, v_version, p_commit, v_step);

  RETURN v_res
    || jsonb_build_object('evo_card_version', v_ver)
    || jsonb_build_object(
      'operations', coalesce(v_res->'operations','[]'::jsonb) || coalesce(v_ver->'operations','[]'::jsonb),
      'destructive', coalesce(v_res->'destructive','[]'::jsonb) || coalesce(v_ver->'destructive','[]'::jsonb),
      'warnings', coalesce(v_res->'warnings','[]'::jsonb) || coalesce(v_ver->'warnings','[]'::jsonb));
END $$;
REVOKE EXECUTE ON FUNCTION public.admin_apply_evo(jsonb,boolean) FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_apply_evo_core(jsonb,boolean) FROM anon;