ALTER TABLE public.evo_objectives ADD CONSTRAINT evo_objectives_path_fk FOREIGN KEY (evo_path_id) REFERENCES public.evo_paths(id) ON DELETE CASCADE;
ALTER TABLE public.evo_card_versions ADD CONSTRAINT evo_versions_path_fk FOREIGN KEY (evo_path_id) REFERENCES public.evo_paths(id) ON DELETE CASCADE;
INSERT INTO public.gem_tiers (id,name,stars,color) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000001','Emerald',1,'#0f0'),
 ('aaaaaaaa-0000-0000-0000-000000000002','Sapphire',2,'#00f'),
 ('aaaaaaaa-0000-0000-0000-000000000003','Ruby',3,'#f00');
INSERT INTO public.player_cards (id,name,gem_tier_id,rating,card_key) VALUES
 ('bbbbbbbb-0000-0000-0000-000000000001','Test Guard One','aaaaaaaa-0000-0000-0000-000000000001',80,'test-guard-one'),
 ('bbbbbbbb-0000-0000-0000-000000000002','Test Guard Two','aaaaaaaa-0000-0000-0000-000000000001',81,'test-guard-two');
