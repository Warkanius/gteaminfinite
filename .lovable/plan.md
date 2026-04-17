
## The bug

The lineup restriction filter in `src/components/game/LineupSelect.tsx` was correctly switched to OR logic last round — that part works. The reason 5 LFO Starter Pack players still fail the "Finally Free" challenge is a **separate, evolution-related data problem**.

The challenge restricts to four sub-collections including `LFO Starter Pack` (`1536ce55-…`). I queried the DB:

- The four base LFO cards (Louis Courvoisier, Sky Kim, Mon Callaham, Ethan Wofford, etc.) correctly have `sub_collection_id = 1536ce55…`.
- But every **evolved** variant created via `evo_paths` (`Sky Kim` evolved, `Mon Callaham` evolved, `Ethan Wofford` evolved, `Louis Courvoisier` evolved) was inserted with `sub_collection_id = NULL`.

So if the user owns any **evolved** version of an LFO card, that card row fails the sub-collection filter even though it logically belongs to LFO. The OR check inspects each card individually and has no idea it's the evolved form of a base card that does belong.

Last session we made the *Collection page* treat evo-linked cards as one slot (they count toward completion). The lineup picker was never updated to do the same.

## Two fixes — both needed

### 1. Make the lineup filter evo-aware (code)

In `src/components/game/LineupSelect.tsx`:
- Add a query for `evo_paths` (just `player_card_id`, `evolves_to_card_id`).
- Build a `chainRootOf` map: every evolved card id → its base card id.
- For the `collection_id`, `sub_collection_id`, `team_id`, `gem_tier_id`, and `card_color` checks, resolve the card to its **chain root** version of `player_cards` and read the property from there. (Positions and badges/traits should still use the actual evolved card since those are stat/ability driven.)
- Concretely: build a `cardById` lookup over the unioned set of `rawCollection` cards + their roots (fetch missing root cards in a second query if any root id isn't already in the user's collection), then in each restriction check do `const root = cardById[chainRootOf.get(card.id) ?? card.id] ?? card;` and check `root.sub_collection_id`, etc.

Result: an evolved Sky Kim now passes the LFO sub-collection check via its base card.

### 2. Backfill evolved cards' collection metadata (data)

The deeper root cause is that the `evoGenerator` / admin "Generate evolution" flow doesn't copy `collection_id` and `sub_collection_id` from the base card to the new evolved card row. We should:
- **One-time migration**: for every `player_cards` row that is the `evolves_to_card_id` of an `evo_paths` entry and has NULL `collection_id`/`sub_collection_id`, copy those two fields from the chain root.
- **Going forward**: update `src/lib/evoGenerator.ts` (and any admin evo creation path it feeds) to inherit `collection_id` and `sub_collection_id` from the base card when generating an evolved variant.

This keeps every existing query (admin filters, gem-market sync, By Collection page filtering, etc.) working without each one needing its own evo-resolution logic.

## Files touched

| File | Change |
|---|---|
| `src/components/game/LineupSelect.tsx` | Add evo_paths query + chainRoot map; resolve collection/sub-collection/team/tier/color checks via the base card |
| `src/lib/evoGenerator.ts` | When generating an evolved card row, copy `collection_id` and `sub_collection_id` from the base |
| New migration `supabase/migrations/…_backfill_evo_collections.sql` | `UPDATE player_cards e SET collection_id = b.collection_id, sub_collection_id = b.sub_collection_id FROM evo_paths ep JOIN player_cards b ON b.id = ep.player_card_id WHERE e.id = ep.evolves_to_card_id AND (e.collection_id IS NULL OR e.sub_collection_id IS NULL);` |

## Out of scope

- No change to OR vs AND logic — that's already correct.
- No change to the Collection page (already treats evo as one slot).
- Not changing badge/trait/position checks to use the base card — those should reflect the *actual* card being fielded.
