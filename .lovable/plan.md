

## What happened

You won the Yosen game at 12:14:06 UTC. The reward flow in `GameResults.tsx` did insert the `RTTR: Yosen` pack into your inventory and call `open-pack`. But the RTTR pack has a **17% chance** of rolling the `player_choice` slot — and when that happens, `open-pack` returns `{ player_choice: true, eligible_cards: [...] }` instead of `{ cards: [...] }`.

`GameResults.tsx` only checks `if (data?.cards && data.cards.length > 0)`. So when the response has no `cards` array, the reveal never opens. Meanwhile inside `open-pack`, the player_choice branch already **deleted the inventory row** (line 197) and never inserted into `user_collections` or `pack_purchases`. The pack vanished. DB confirms: zero pack_purchases / collection inserts at 12:14 from the RTTR pack id, but the inventory row is gone.

This affects every reward pack with a `player_choice` slot — not just RTTR — and not just Domination (Challenges have the same code path).

## Fix — three parts

### 1. Handle `player_choice` in `GameResults.tsx`
When `data.player_choice` is true:
- Show the existing `PackReveal` flow in player-choice mode using `data.eligible_cards` and `data.pack_id`, so the user picks a card right inside the post-game results, then we call `open-pack` again with `confirm_choice_card_id`.
- `PackReveal` already supports this on the Pack Market — we'll mirror that wiring (the same `eligible_cards` shape comes back).

### 2. One-time grant for the lost Yosen pack
Add a manual data fix: insert one RTTR Yosen pack back into your `user_pack_inventory` (source `domination_reward`) so you can open it from the Pack Market. We'll do this via the insert tool, not a migration.

### 3. Surface failures so this can't happen silently again
In `GameResults.tsx`:
- Toast + `console.error` when `open-pack` returns `error`, when `data` is null, or when neither `cards` nor `player_choice` is present.
- Don't pre-insert the pack into inventory **before** invoking the function — instead, only insert into inventory if `open-pack` itself fails so the user can retry from the Pack Market. (Currently we insert then call; if anything errors mid-flight the pack is lost.) Actually safer: keep the insert-then-call pattern but, on any unexpected response, leave a toast telling the user "Reward pack added to your inventory — open it from the Pack Market" and **do not** delete the inventory row server-side for the GameResults flow. Simpler approach: rely on the existing inventory item; if `open-pack` fails for any reason, the inventory row stays and the user opens it manually.

To make #3 actually robust, also tweak `open-pack`: on the player_choice branch, **don't delete the inventory item until the user confirms their choice** (currently it's deleted before returning). Move that delete into the `confirm_choice_card_id` branch.

## Files touched

| File | Change |
|---|---|
| `src/components/game/GameResults.tsx` | Handle `player_choice` response: render `PackReveal` in choice mode with `eligible_cards`; surface all error paths via toast + console; treat missing `data.cards` AND missing `data.player_choice` as an error |
| `supabase/functions/open-pack/index.ts` | In the player_choice branch, **don't** delete the inventory row — defer that to the `confirm_choice_card_id` branch so the pack survives if the user backs out or the UI fails |
| `src/components/packs/PackReveal.tsx` | (Likely tiny) accept an optional `playerChoice` mode + `eligibleCards` + `packId` so it can be reused from `GameResults`. If it already supports this from the Pack Market path, just plumb the props through. |
| Data insert (no migration) | Re-grant 1× `RTTR: Yosen` (`528dcfd1-…`) to your `user_pack_inventory` with `source = 'domination_reward'` |

## Out of scope

- Not changing the odds on the RTTR pack.
- Not changing the Domination → Play navigation (already passes `packReward` correctly).
- Not touching the Run / Challenge reveal paths beyond what `GameResults.tsx` already governs (Challenges go through the same component, so they get fixed for free).

