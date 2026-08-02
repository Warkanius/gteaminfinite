-- ============================================================
-- 1. Lifecycle status type
-- ============================================================
DO $$ BEGIN
  CREATE TYPE public.content_status AS ENUM ('draft','scheduled','active','disabled','archived');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Generic lifecycle column installer
CREATE OR REPLACE FUNCTION public.admin_install_lifecycle(p_table text)
RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  EXECUTE format('ALTER TABLE public.%I
      ADD COLUMN IF NOT EXISTS status public.content_status NOT NULL DEFAULT ''active'',
      ADD COLUMN IF NOT EXISTS publish_at timestamptz,
      ADD COLUMN IF NOT EXISTS starts_at timestamptz,
      ADD COLUMN IF NOT EXISTS ends_at timestamptz,
      ADD COLUMN IF NOT EXISTS disabled_at timestamptz,
      ADD COLUMN IF NOT EXISTS archived_at timestamptz', p_table);
  EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (status)', p_table || '_status_idx', p_table);
END $$;

SELECT public.admin_install_lifecycle(t) FROM (VALUES
  ('player_cards'),('packs'),('collections'),('sub_collections'),('evo_paths'),
  ('challenges'),('locker_codes'),('storylines'),('domination_roads'),('domination_games'),
  ('runs'),('gem_tasks'),('social_posts'),('gem_market_listings'),('teams'),
  ('badges'),('signature_traits'),('gem_tiers'),('dynamic_duos')
) AS x(t);

-- ============================================================
-- 2. Collections + sub-collections
-- ============================================================
ALTER TABLE public.collections
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS color_primary text,
  ADD COLUMN IF NOT EXISTS color_secondary text,
  ADD COLUMN IF NOT EXISTS glow_color text,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_repeatable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS prerequisite_collection_id uuid REFERENCES public.collections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS allow_multiple_reward_cards boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reward_card_id uuid REFERENCES public.player_cards(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reward_payload jsonb,
  ADD COLUMN IF NOT EXISTS evolved_counts boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.sub_collections
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS color_primary text,
  ADD COLUMN IF NOT EXISTS color_secondary text,
  ADD COLUMN IF NOT EXISTS glow_color text,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_repeatable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reward_card_id uuid REFERENCES public.player_cards(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reward_payload jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS public.collection_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id uuid NOT NULL REFERENCES public.collections(id) ON DELETE CASCADE,
  player_card_id uuid NOT NULL REFERENCES public.player_cards(id) ON DELETE CASCADE,
  evolved_counts boolean NOT NULL DEFAULT true,
  any_evo_stage boolean NOT NULL DEFAULT true,
  allowed_evo_stages integer[],
  is_reward_card boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (collection_id, player_card_id)
);
GRANT SELECT ON public.collection_requirements TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.collection_requirements TO authenticated;
GRANT ALL ON public.collection_requirements TO service_role;
ALTER TABLE public.collection_requirements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "collection_requirements readable" ON public.collection_requirements FOR SELECT USING (true);
CREATE POLICY "collection_requirements admin write" ON public.collection_requirements FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.sub_collection_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sub_collection_id uuid NOT NULL REFERENCES public.sub_collections(id) ON DELETE CASCADE,
  player_card_id uuid NOT NULL REFERENCES public.player_cards(id) ON DELETE CASCADE,
  evolved_counts boolean NOT NULL DEFAULT true,
  any_evo_stage boolean NOT NULL DEFAULT true,
  allowed_evo_stages integer[],
  is_reward_card boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sub_collection_id, player_card_id)
);
GRANT SELECT ON public.sub_collection_requirements TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sub_collection_requirements TO authenticated;
GRANT ALL ON public.sub_collection_requirements TO service_role;
ALTER TABLE public.sub_collection_requirements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sub_collection_requirements readable" ON public.sub_collection_requirements FOR SELECT USING (true);
CREATE POLICY "sub_collection_requirements admin write" ON public.sub_collection_requirements FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ============================================================
-- 3. Evo paths: lifecycle, cosmetics, objectives
-- ============================================================
ALTER TABLE public.evo_paths
  ADD COLUMN IF NOT EXISTS is_repeatable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS objective_mode text NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS objectives jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS final_rating numeric,
  ADD COLUMN IF NOT EXISTS final_stats jsonb,
  ADD COLUMN IF NOT EXISTS badge_upgrades jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS trait_upgrades jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS card_color_primary text,
  ADD COLUMN IF NOT EXISTS card_color_secondary text,
  ADD COLUMN IF NOT EXISTS card_glow_color text,
  ADD COLUMN IF NOT EXISTS card_animation text,
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS market_value integer,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tier_progression_override boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$ BEGIN
  ALTER TABLE public.evo_paths ADD CONSTRAINT evo_paths_objective_mode_chk CHECK (objective_mode IN ('all','any'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.evo_objectives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evo_path_id uuid NOT NULL REFERENCES public.evo_paths(id) ON DELETE CASCADE,
  group_key text NOT NULL DEFAULT 'default',
  objective_type text NOT NULL,
  stat_key text,
  scope text NOT NULL DEFAULT 'cumulative',
  target numeric NOT NULL,
  description text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evo_objectives_scope_chk CHECK (scope IN ('cumulative','single_game','career')),
  CONSTRAINT evo_objectives_target_chk CHECK (target > 0)
);
CREATE INDEX IF NOT EXISTS evo_objectives_path_idx ON public.evo_objectives (evo_path_id, group_key, sort_order);
GRANT SELECT ON public.evo_objectives TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.evo_objectives TO authenticated;
GRANT ALL ON public.evo_objectives TO service_role;
ALTER TABLE public.evo_objectives ENABLE ROW LEVEL SECURITY;
CREATE POLICY "evo_objectives readable" ON public.evo_objectives FOR SELECT USING (true);
CREATE POLICY "evo_objectives admin write" ON public.evo_objectives FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ============================================================
-- 4. Reference entities: gem tiers, badges, traits
-- ============================================================
ALTER TABLE public.gem_tiers
  ADD COLUMN IF NOT EXISTS abbreviation text,
  ADD COLUMN IF NOT EXISTS glow_color text,
  ADD COLUMN IF NOT EXISTS rating_min numeric,
  ADD COLUMN IF NOT EXISTS rating_max numeric,
  ADD COLUMN IF NOT EXISTS market_rules jsonb,
  ADD COLUMN IF NOT EXISTS max_badges integer,
  ADD COLUMN IF NOT EXISTS max_traits integer;

ALTER TABLE public.badges
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS supported_tiers text[],
  ADD COLUMN IF NOT EXISTS metadata jsonb;

ALTER TABLE public.signature_traits
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS supported_tiers text[],
  ADD COLUMN IF NOT EXISTS requires_target_stat boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS supported_target_stats text[],
  ADD COLUMN IF NOT EXISTS metadata jsonb;

-- ============================================================
-- 5. Packs + odds
-- ============================================================
ALTER TABLE public.packs
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS pack_size integer,
  ADD COLUMN IF NOT EXISTS guaranteed_tier_ids uuid[],
  ADD COLUMN IF NOT EXISTS duplicate_protection boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_choice_pack boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS featured_card_ids uuid[],
  ADD COLUMN IF NOT EXISTS purchase_limit integer,
  ADD COLUMN IF NOT EXISTS per_user_limit integer,
  ADD COLUMN IF NOT EXISTS pity_threshold integer,
  ADD COLUMN IF NOT EXISTS pity_reward jsonb,
  ADD COLUMN IF NOT EXISTS box_topper jsonb,
  ADD COLUMN IF NOT EXISTS open_animation text,
  ADD COLUMN IF NOT EXISTS collection_id uuid REFERENCES public.collections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.pack_odds
  ADD COLUMN IF NOT EXISTS slot_number integer,
  ADD COLUMN IF NOT EXISTS gem_tier_id uuid REFERENCES public.gem_tiers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS conditional_rules jsonb;

-- ============================================================
-- 6. Gem tasks, challenges, locker codes: normalized rewards
-- ============================================================
ALTER TABLE public.gem_tasks
  ADD COLUMN IF NOT EXISTS gem_tier_id uuid REFERENCES public.gem_tiers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS requirement_type text,
  ADD COLUMN IF NOT EXISTS requirement_amount integer,
  ADD COLUMN IF NOT EXISTS stat_key text,
  ADD COLUMN IF NOT EXISTS reward_payload jsonb,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS prerequisite_task_id uuid REFERENCES public.gem_tasks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS group_key text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.challenges ADD COLUMN IF NOT EXISTS reward_payload jsonb;
ALTER TABLE public.locker_codes ADD COLUMN IF NOT EXISTS reward_payload jsonb;

-- ============================================================
-- 7. Release bundles
-- ============================================================
CREATE TABLE IF NOT EXISTS public.release_bundles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text,
  notes text,
  status public.content_status NOT NULL DEFAULT 'draft',
  publish_at timestamptz,
  starts_at timestamptz,
  ends_at timestamptz,
  disabled_at timestamptz,
  archived_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.release_bundles TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.release_bundles TO authenticated;
GRANT ALL ON public.release_bundles TO service_role;
ALTER TABLE public.release_bundles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "release_bundles readable" ON public.release_bundles FOR SELECT USING (true);
CREATE POLICY "release_bundles admin write" ON public.release_bundles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.release_bundle_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_bundle_id uuid NOT NULL REFERENCES public.release_bundles(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  role text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (release_bundle_id, entity_type, entity_id)
);
CREATE INDEX IF NOT EXISTS release_bundle_entities_entity_idx ON public.release_bundle_entities (entity_type, entity_id);
GRANT SELECT ON public.release_bundle_entities TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.release_bundle_entities TO authenticated;
GRANT ALL ON public.release_bundle_entities TO service_role;
ALTER TABLE public.release_bundle_entities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "release_bundle_entities readable" ON public.release_bundle_entities FOR SELECT USING (true);
CREATE POLICY "release_bundle_entities admin write" ON public.release_bundle_entities FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

ALTER TABLE public.packs ADD COLUMN IF NOT EXISTS release_bundle_id uuid REFERENCES public.release_bundles(id) ON DELETE SET NULL;
ALTER TABLE public.collections ADD COLUMN IF NOT EXISTS release_bundle_id uuid REFERENCES public.release_bundles(id) ON DELETE SET NULL;
ALTER TABLE public.player_cards ADD COLUMN IF NOT EXISTS release_bundle_id uuid REFERENCES public.release_bundles(id) ON DELETE SET NULL;

-- ============================================================
-- 8. Rule config versions
-- ============================================================
CREATE TABLE IF NOT EXISTS public.rule_config_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL,
  value jsonb NOT NULL,
  environment text NOT NULL DEFAULT 'production',
  version integer NOT NULL DEFAULT 1,
  description text,
  is_active boolean NOT NULL DEFAULT false,
  activate_at timestamptz,
  archived_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rule_config_versions_env_chk CHECK (environment IN ('development','staging','production'))
);
CREATE INDEX IF NOT EXISTS rule_config_versions_key_idx ON public.rule_config_versions (key, environment, version DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rule_config_versions TO authenticated;
GRANT ALL ON public.rule_config_versions TO service_role;
ALTER TABLE public.rule_config_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rule_config_versions admin only" ON public.rule_config_versions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- ============================================================
-- 9. Lifecycle history
-- ============================================================
CREATE TABLE IF NOT EXISTS public.lifecycle_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  from_status text,
  to_status text NOT NULL,
  operation_id uuid,
  changed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lifecycle_history_entity_idx ON public.lifecycle_history (entity_type, entity_id, created_at DESC);
GRANT SELECT ON public.lifecycle_history TO authenticated;
GRANT ALL ON public.lifecycle_history TO service_role;
ALTER TABLE public.lifecycle_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lifecycle_history admin read" ON public.lifecycle_history FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

-- ============================================================
-- 10. Central content reference registry (drives usage auditing)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.content_reference_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_entity_type text NOT NULL,
  reference_type text NOT NULL,
  source_table text NOT NULL,
  source_column text NOT NULL,
  column_kind text NOT NULL DEFAULT 'uuid',
  label_column text,
  parent_column text,
  is_protected boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_table, source_column, target_entity_type),
  CONSTRAINT content_reference_registry_kind_chk CHECK (column_kind IN ('uuid','uuid_array'))
);
GRANT SELECT ON public.content_reference_registry TO authenticated;
GRANT ALL ON public.content_reference_registry TO service_role;
ALTER TABLE public.content_reference_registry ENABLE ROW LEVEL SECURITY;
CREATE POLICY "content_reference_registry admin read" ON public.content_reference_registry FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin'));

INSERT INTO public.content_reference_registry (target_entity_type, reference_type, source_table, source_column, column_kind, label_column, parent_column) VALUES
  ('player_card','team_assignment','player_cards','team_id','uuid','name',NULL),
  ('player_card','team_roster','team_players','player_card_id','uuid',NULL,'team_id'),
  ('player_card','pack_pool','pack_players','player_card_id','uuid',NULL,'pack_id'),
  ('player_card','pack_featured','packs','featured_card_ids','uuid_array','name',NULL),
  ('player_card','collection_requirement','collection_requirements','player_card_id','uuid',NULL,'collection_id'),
  ('player_card','sub_collection_requirement','sub_collection_requirements','player_card_id','uuid',NULL,'sub_collection_id'),
  ('player_card','collection_reward','collections','reward_card_id','uuid','name',NULL),
  ('player_card','sub_collection_reward','sub_collections','reward_card_id','uuid','name',NULL),
  ('player_card','collection_membership','player_cards','collection_id','uuid','name',NULL),
  ('player_card','run_roster','run_players','player_card_id','uuid',NULL,'run_id'),
  ('player_card','domination_roster','domination_game_players','player_card_id','uuid',NULL,'domination_game_id'),
  ('player_card','challenge_reward','challenges','card_reward_id','uuid','name',NULL),
  ('player_card','challenge_stat_limit','challenges','stat_limit_player_id','uuid','name',NULL),
  ('player_card','dynamic_duo_a','dynamic_duos','player_card_id_a','uuid','name',NULL),
  ('player_card','dynamic_duo_b','dynamic_duos','player_card_id_b','uuid','name',NULL),
  ('player_card','evo_source','evo_paths','player_card_id','uuid',NULL,NULL),
  ('player_card','evo_destination','evo_paths','evolves_to_card_id','uuid',NULL,NULL),
  ('player_card','gem_market_listing','gem_market_listings','player_card_id','uuid',NULL,NULL),
  ('player_card','auction_listing','auction_listings','player_card_id','uuid',NULL,NULL),
  ('player_card','social_post','social_posts','player_card_id','uuid','content',NULL),
  ('player_card','badge_assignment','player_card_badges','player_card_id','uuid',NULL,'badge_id'),
  ('player_card','trait_assignment','player_card_traits','player_card_id','uuid',NULL,'trait_id'),
  ('player_card','base_card','player_cards','base_card_id','uuid','name',NULL),
  ('player_card','release_bundle','player_cards','release_bundle_id','uuid','name',NULL),
  ('pack','domination_reward','domination_games','pack_reward_id','uuid','opponent_name',NULL),
  ('pack','collection_reward','collections','reward_pack_id','uuid','name',NULL),
  ('pack','sub_collection_reward','sub_collections','reward_pack_id','uuid','name',NULL),
  ('pack','pack_pool','pack_players','pack_id','uuid',NULL,NULL),
  ('pack','pack_odds','pack_odds','pack_id','uuid',NULL,NULL),
  ('collection','card_membership','player_cards','collection_id','uuid','name',NULL),
  ('collection','sub_collection','sub_collections','collection_id','uuid','name',NULL),
  ('collection','pack_link','packs','collection_id','uuid','name',NULL),
  ('collection','requirement','collection_requirements','collection_id','uuid',NULL,NULL),
  ('collection','prerequisite','collections','prerequisite_collection_id','uuid','name',NULL),
  ('sub_collection','card_membership','player_cards','sub_collection_id','uuid','name',NULL),
  ('sub_collection','requirement','sub_collection_requirements','sub_collection_id','uuid',NULL,NULL),
  ('team','card_assignment','player_cards','team_id','uuid','name',NULL),
  ('team','team_roster','team_players','team_id','uuid',NULL,NULL),
  ('team','run_team','runs','team_id','uuid','name',NULL),
  ('team','domination_opponent','domination_games','opponent_team_id','uuid','opponent_name',NULL),
  ('gem_tier','card_tier','player_cards','gem_tier_id','uuid','name',NULL),
  ('gem_tier','collection_tier','collections','gem_tier_id','uuid','name',NULL),
  ('gem_tier','market_listing','gem_market_listings','gem_tier_id','uuid',NULL,NULL),
  ('gem_tier','evo_from','evo_paths','from_tier_id','uuid',NULL,NULL),
  ('gem_tier','evo_to','evo_paths','to_tier_id','uuid',NULL,NULL),
  ('gem_tier','gem_task','gem_tasks','gem_tier_id','uuid','title',NULL),
  ('badge','card_assignment','player_card_badges','badge_id','uuid',NULL,'player_card_id'),
  ('signature_trait','card_assignment','player_card_traits','trait_id','uuid',NULL,'player_card_id'),
  ('storyline','entity_link','storyline_entities','storyline_id','uuid',NULL,NULL),
  ('domination_road','game','domination_games','road_id','uuid','opponent_name',NULL),
  ('domination_game','roster','domination_game_players','domination_game_id','uuid',NULL,NULL),
  ('run','roster','run_players','run_id','uuid',NULL,NULL),
  ('challenge','prerequisite','challenges','prerequisite_id','uuid','name',NULL),
  ('evo_path','objective','evo_objectives','evo_path_id','uuid',NULL,NULL),
  ('release_bundle','entity','release_bundle_entities','release_bundle_id','uuid','entity_type',NULL),
  ('location_account','social_post','social_posts','location_account_id','uuid','content',NULL),
  ('social_creator','social_post','social_posts','creator_id','uuid','content',NULL)
ON CONFLICT (source_table, source_column, target_entity_type) DO NOTHING;

-- updated_at triggers for new/updated tables
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['collections','sub_collections','evo_paths','packs','gem_tasks','release_bundles'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', 'set_updated_at_' || t, t);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()',
      'set_updated_at_' || t, t);
  END LOOP;
END $$;