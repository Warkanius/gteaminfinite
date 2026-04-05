
ALTER TABLE public.evo_paths ADD COLUMN evolves_to_card_id uuid REFERENCES public.player_cards(id);

ALTER TABLE public.user_evo_progress ADD COLUMN claimed boolean NOT NULL DEFAULT false;
