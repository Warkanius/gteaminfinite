

# Fix Pack Opening, Locker Code Rewards, Gem Market Reveals & Data Cleanup

## Changes from previous plan

- **Locker code pack rewards**: When redeemed, the pack opens immediately with the full PackReveal experience right on the Locker Codes page (card flip animation, etc.) — not just added to an inventory to open later.
- **Gem market purchases**: After buying a card with gems, show the same single-card reveal animation instead of silently adding to collection.
- **Unclaimed rewards section**: Below the locker code input, show any pending pack rewards (from `user_pack_inventory`) with an "Open" button that triggers PackReveal.

## Plan

### 1. Database: Create `user_pack_inventory` table (migration)
- Columns: `id`, `user_id`, `pack_id`, `source` text, `created_at`
- RLS: users can SELECT and DELETE their own rows

### 2. Data cleanup (insert tool)
- Delete Hidden Gem cards from `user_collections` for user `37e93387-...`
- Delete the `HIDDEN-GEMS` redemption record from `locker_code_redemptions`

### 3. Update `redeem-locker-code` edge function
- For `reward_type === "pack"`: insert into `user_pack_inventory` instead of dumping all cards into `user_collections`
- Return `pack_id` in response so the UI can immediately trigger pack opening

### 4. Update `open-pack` edge function
- Accept optional `inventory_id` — verify ownership, use its `pack_id`, skip coin deduction, delete inventory row after
- If no odds configured for the pack_type, fall back to uniform random pick from `pack_players`
- Always return exactly 1 card per call (single pack = 1 card)

### 5. Update `LockerCodes.tsx`
- After successful code redemption with a pack reward, immediately call `open-pack` with the new inventory item and show `PackReveal` inline
- Below the code input, query `user_pack_inventory` joined with `packs` — show pending rewards with "Open" button
- Clicking "Open" calls `open-pack` with `inventory_id`, shows PackReveal

### 6. Update `PackMarket.tsx` — sequential 10-box opening
- For quantity=10: loop calling `open-pack` 10 times, showing PackReveal after each with a "Next Pack (X/10)" button
- Single pack: call once, show 1 card in PackReveal

### 7. Update `PackReveal.tsx`
- Add optional `packProgress` prop (`{ current, total }`) for multi-pack flow
- Add `onNextPack` callback for 10-box sequential flow

### 8. Update `GemMarket.tsx` — card reveal on purchase
- After successful `buy-gem-card` call, show `PackReveal` with the single purchased card (the edge function already returns card data)
- Dismiss reveal returns to market

## Files Changed

| File | Change |
|------|--------|
| Migration | Create `user_pack_inventory` + RLS |
| Data cleanup | Remove cards + redemption record |
| `supabase/functions/redeem-locker-code/index.ts` | Pack rewards → inventory, return pack_id |
| `supabase/functions/open-pack/index.ts` | Support `inventory_id`, 1 card per call, odds fallback |
| `src/pages/LockerCodes.tsx` | Immediate pack reveal on redeem + pending packs section |
| `src/pages/PackMarket.tsx` | Sequential 10-box opening |
| `src/components/packs/PackReveal.tsx` | Multi-pack progress support |
| `src/pages/GemMarket.tsx` | Card reveal animation on purchase |

