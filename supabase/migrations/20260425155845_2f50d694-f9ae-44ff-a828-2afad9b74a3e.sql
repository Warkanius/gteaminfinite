INSERT INTO public.rule_config (key, value, description)
VALUES ('evolution_post_min_gem_tier', '"Diamond"'::jsonb, 'Minimum gem tier name required for an evolution to trigger a media post.')
ON CONFLICT (key) DO NOTHING;