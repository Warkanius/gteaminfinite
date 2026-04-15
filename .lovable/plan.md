

# Fix: Scrolling, Free Pack Charging, Quicksell Values, and Run Stat Defaults

## Issues Found

1. **Roster/QuickEdit not scrollable**: The `ScrollArea` components have fixed `max-h` values but the content overflows without proper scroll behavior on small viewports. The `PlayerQuickEdit` dialog uses `max-h-[70vh]` which is fine, but the roster section uses `max-h-[320px]` which may clip. The real issue is likely that the `ScrollArea` viewport needs `overflow-y-auto` and the outer containers need bounded height.

2. **Challenge reward pack charges coins**: In `GameResults.tsx` line 99, `open-pack` is called with `{ pack_id: packReward }` — no `inventory_id`. The edge function only sets `isFreeOpen = true` when `inventory_id` is provided. So reward packs deduct coins. Fix: add the pack to inventory first, then open via `inventory_id`, OR modify the edge function to accept a `free: true` flag for reward contexts.

3. **Quicksell uses flat value instead of market_value**: The `quicksell-card` function reads a single `quicksell_coin_value` from `rule_config` and applies the same amount to every card. It should instead read the card's `market_value` from `player_cards`.

4. **STL/BLK default to 0 in Runs**: `randomizeFromStar(0)` returns `0` (line 32). For STL and BLK specifically, a 0 rating makes it impossible to get stops. Fix: for STL and BLK, when stars = 0, default to a random value between 10-19 instead of 0.

## Plan

### 1. Fix ScrollArea in RunRosterManager & PlayerQuickEdit
- Add `overflow-y-auto` styling to the scroll viewport
- Increase roster `max-h` or make it responsive
- Ensure the PlayerQuickEdit `ScrollArea` has proper overflow behavior within the dialog

### 2. Fix challenge reward pack not charging coins
- Modify `GameResults.tsx`: instead of calling `open-pack` with `pack_id`, first insert the pack into `user_pack_inventory` with `source: "challenge_reward"`, then call `open-pack` with `inventory_id`
- This ensures `isFreeOpen = true` in the edge function
- Also update the `open-pack` edge function to set `source` to the inventory item's `source` field rather than hardcoding `"locker_code"` for all inventory opens — so challenge reward cards get `source: "standard_pack"` or similar sellable source

### 3. Quicksell uses card's market_value
- Update `quicksell-card` edge function: after fetching the collection entry, also fetch the `player_cards.market_value` for that card and use it as the coin value instead of the flat `rule_config` value
- Keep `rule_config.quicksell_coin_value` as a fallback if `market_value` is 0 or null

### 4. STL/BLK minimum in Runs
- Update `randomizeFromStar` in `RunRosterManager.tsx`: add a `statKey` parameter. When the stat is `stl` or `blk` and stars = 0, return a random value between 10-19 instead of 0
- Apply the same logic everywhere `randomizeFromStar` is called for these stats

### Files Changed

| File | Change |
|---|---|
| `src/components/admin/RunRosterManager.tsx` | Fix scroll containers; update `randomizeFromStar` for STL/BLK minimum |
| `src/components/admin/PlayerQuickEdit.tsx` | Ensure ScrollArea works properly in dialog |
| `src/components/game/GameResults.tsx` | Insert reward pack into inventory first, then open via `inventory_id` |
| `supabase/functions/open-pack/index.ts` | Use inventory item's `source` field instead of hardcoding `"locker_code"` |
| `supabase/functions/quicksell-card/index.ts` | Use card's `market_value` instead of flat `rule_config` value |

