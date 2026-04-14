

# Prevent Selling Reward Cards

## Problem
Currently any unlocked card can be quicksold. The user wants to block selling for:
- **Collection reward** cards (`is_collection_reward = true`)
- **Gem Market** purchases
- **Locker code reward pack** pulls

## Approach
Add a `source` column to `user_collections` to track how each card was acquired. Only cards with `source = 'standard_pack'` can be quicksold.

### 1. Database Migration
Add column `source text NOT NULL DEFAULT 'standard_pack'` to `user_collections`. Possible values: `standard_pack`, `gem_market`, `collection_reward`, `locker_code`, `starter_pack`.

### 2. Update Acquisition Flows
Set `source` when inserting into `user_collections`:

| Edge Function / Flow | Source Value |
|---|---|
| `open-pack` (standard purchase) | `'standard_pack'` |
| `open-pack` (from `user_pack_inventory` / reward) | `'locker_code'` |
| `buy-gem-card` | `'gem_market'` |
| `claim-starter-pack` | `'starter_pack'` |
| `redeem-locker-code` (direct card reward) | `'locker_code'` |
| Collection reward grants | `'collection_reward'` |

### 3. Block Quicksell in Edge Function
In `quicksell-card/index.ts`, after fetching the entry, check `entry.source !== 'standard_pack'` and return 400 "Cannot sell reward cards".

### 4. Hide Quicksell Button in UI
In `Collection.tsx`, track source per card. In `CardDetailDialog`, disable/hide the quicksell button when the card's source is not `standard_pack`.

## Files Changed

| File | Change |
|---|---|
| Migration | Add `source` column to `user_collections` |
| `supabase/functions/quicksell-card/index.ts` | Block non-standard_pack cards |
| `supabase/functions/open-pack/index.ts` | Pass source based on whether it's from inventory |
| `supabase/functions/buy-gem-card/index.ts` | Set `source: 'gem_market'` |
| `supabase/functions/claim-starter-pack/index.ts` | Set `source: 'starter_pack'` |
| `supabase/functions/redeem-locker-code/index.ts` | Set `source: 'locker_code'` for direct card rewards |
| `src/pages/Collection.tsx` | Track source, pass `canSell` to dialog |
| `src/components/cards/CardDetailDialog.tsx` | Accept + use `canSell` prop to show/hide quicksell |

