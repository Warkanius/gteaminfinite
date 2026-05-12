INSERT INTO public.rule_config (key, value, description)
VALUES ('domination_appearance_min_gem_tier', '"Pink Diamond"'::jsonb, 'Minimum gem tier name required for a Domination appearance media post.')
ON CONFLICT (key) DO NOTHING;