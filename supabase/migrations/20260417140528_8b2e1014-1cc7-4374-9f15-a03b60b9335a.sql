UPDATE public.player_cards e
SET collection_id = COALESCE(e.collection_id, b.collection_id),
    sub_collection_id = COALESCE(e.sub_collection_id, b.sub_collection_id)
FROM public.evo_paths ep
JOIN public.player_cards b ON b.id = ep.player_card_id
WHERE e.id = ep.evolves_to_card_id
  AND (e.collection_id IS NULL OR e.sub_collection_id IS NULL)
  AND (b.collection_id IS NOT NULL OR b.sub_collection_id IS NOT NULL);