-- 1. Roads table -------------------------------------------------------------
CREATE TABLE public.domination_roads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL,
  description text,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.domination_roads TO authenticated;
GRANT ALL ON public.domination_roads TO service_role;

ALTER TABLE public.domination_roads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Domination roads readable" ON public.domination_roads
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage domination roads" ON public.domination_roads
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE UNIQUE INDEX domination_roads_name_ci_key ON public.domination_roads (lower(btrim(name)));
CREATE UNIQUE INDEX domination_roads_slug_key ON public.domination_roads (slug);

CREATE TRIGGER domination_roads_updated_at
  BEFORE UPDATE ON public.domination_roads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Link games to roads ------------------------------------------------------
ALTER TABLE public.domination_games
  ADD COLUMN road_id uuid REFERENCES public.domination_roads(id) ON DELETE CASCADE;

INSERT INTO public.domination_roads (name, slug, sort_order)
SELECT DISTINCT btrim(g.road_name), public.admin_slugify(btrim(g.road_name)), 0
FROM public.domination_games g
WHERE btrim(coalesce(g.road_name,'')) <> ''
ON CONFLICT DO NOTHING;

UPDATE public.domination_games g
SET road_id = r.id
FROM public.domination_roads r
WHERE lower(btrim(g.road_name)) = lower(btrim(r.name)) AND g.road_id IS NULL;

WITH ordered AS (
  SELECT r.id, row_number() OVER (ORDER BY r.name) AS rn FROM public.domination_roads r
)
UPDATE public.domination_roads r SET sort_order = o.rn FROM ordered o WHERE o.id = r.id;

ALTER TABLE public.domination_games ALTER COLUMN road_id SET NOT NULL;

CREATE INDEX domination_games_road_id_order_idx
  ON public.domination_games (road_id, game_order);

-- 3. Keep road_name mirrored from road_id ------------------------------------
CREATE OR REPLACE FUNCTION public.domination_games_sync_road()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE v_name text; v_id uuid;
BEGIN
  IF NEW.road_id IS NOT NULL THEN
    SELECT name INTO v_name FROM public.domination_roads WHERE id = NEW.road_id;
    IF v_name IS NULL THEN
      RAISE EXCEPTION 'UNKNOWN_ROAD_ID: no domination road with id %', NEW.road_id;
    END IF;
    NEW.road_name := v_name;
  ELSIF btrim(coalesce(NEW.road_name,'')) <> '' THEN
    SELECT id, name INTO v_id, v_name FROM public.domination_roads
      WHERE lower(btrim(name)) = lower(btrim(NEW.road_name));
    IF v_id IS NULL THEN
      INSERT INTO public.domination_roads (name, slug, sort_order)
      VALUES (btrim(NEW.road_name), public.admin_slugify(btrim(NEW.road_name)),
              (SELECT coalesce(max(sort_order),0) + 1 FROM public.domination_roads))
      RETURNING id, name INTO v_id, v_name;
    END IF;
    NEW.road_id := v_id;
    NEW.road_name := v_name;
  ELSE
    RAISE EXCEPTION 'MISSING_ROAD: a domination game needs road_id or road_name';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER domination_games_sync_road
  BEFORE INSERT OR UPDATE OF road_id, road_name ON public.domination_games
  FOR EACH ROW EXECUTE FUNCTION public.domination_games_sync_road();

CREATE OR REPLACE FUNCTION public.domination_roads_cascade_name()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.name IS DISTINCT FROM OLD.name THEN
    UPDATE public.domination_games SET road_name = NEW.name WHERE road_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER domination_roads_cascade_name
  AFTER UPDATE ON public.domination_roads
  FOR EACH ROW EXECUTE FUNCTION public.domination_roads_cascade_name();

-- 4. Uniqueness now hangs off the road id ------------------------------------
ALTER TABLE public.domination_games DROP CONSTRAINT IF EXISTS domination_games_road_game_order_key;
ALTER TABLE public.domination_games
  ADD CONSTRAINT domination_games_road_id_game_order_key
  UNIQUE (road_id, game_order) DEFERRABLE INITIALLY IMMEDIATE;
