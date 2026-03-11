
ALTER TABLE public.run_players
  ADD COLUMN run_rating integer NOT NULL DEFAULT 0,
  ADD COLUMN run_stat_3pt integer NOT NULL DEFAULT 0,
  ADD COLUMN run_stat_mid integer NOT NULL DEFAULT 0,
  ADD COLUMN run_stat_fin integer NOT NULL DEFAULT 0,
  ADD COLUMN run_stat_dnk integer NOT NULL DEFAULT 0,
  ADD COLUMN run_stat_stl integer NOT NULL DEFAULT 0,
  ADD COLUMN run_stat_blk integer NOT NULL DEFAULT 0,
  ADD COLUMN run_stat_ast integer NOT NULL DEFAULT 0,
  ADD COLUMN run_stat_reb integer NOT NULL DEFAULT 0,
  ADD COLUMN run_stat_int integer NOT NULL DEFAULT 0;
