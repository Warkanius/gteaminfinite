ALTER TABLE public.pack_odds ADD COLUMN percentage numeric NOT NULL DEFAULT 0;
ALTER TABLE public.pack_odds ALTER COLUMN dice_roll SET DEFAULT '0';
ALTER TABLE public.pack_odds ALTER COLUMN dice_roll DROP NOT NULL;