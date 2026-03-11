ALTER TABLE public.player_cards
  ADD COLUMN run_rating integer DEFAULT NULL,
  ADD COLUMN run_stat_3pt integer DEFAULT NULL,
  ADD COLUMN run_stat_mid integer DEFAULT NULL,
  ADD COLUMN run_stat_fin integer DEFAULT NULL,
  ADD COLUMN run_stat_dnk integer DEFAULT NULL,
  ADD COLUMN run_stat_stl integer DEFAULT NULL,
  ADD COLUMN run_stat_blk integer DEFAULT NULL,
  ADD COLUMN run_stat_ast integer DEFAULT NULL,
  ADD COLUMN run_stat_reb integer DEFAULT NULL,
  ADD COLUMN run_stat_int integer DEFAULT NULL;