UPDATE public.domination_games g
SET pack_reward = p.id::text
FROM public.packs p
WHERE g.pack_reward = p.name
  AND g.pack_reward !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';