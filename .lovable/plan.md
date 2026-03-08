

# Phase 4: Pack Market and Opening Experience

## Overview
Build the `/packs` page where players browse available packs, purchase them with coins, and experience a feel-good card reveal with tier-specific visual feedback.

## How It Works

1. **Pack Market page** (`src/pages/PackMarket.tsx`) — displays all packs from the `packs` table as purchasable cards showing name, type, cost, and 10-box cost
2. **Purchase flow** — player clicks "Buy" or "Buy 10-Box", coin balance is checked against `profiles.coins`, then deducted via an edge function that handles the transaction atomically
3. **Pack opening logic** (edge function `open-pack`) — server-side to prevent manipulation:
   - Deducts coins from `profiles`
   - Rolls dice against `pack_odds` for the pack's `pack_type`
   - Maps result slots to player cards via `pack_players`
   - Inserts pulled cards into `user_collections`
   - Returns the pulled cards + their gem tier info
4. **Reveal experience** — client receives pulled cards and shows them one-by-one with tier-specific glow/color burst animations using the existing `cardVisuals.ts` system, then a summary screen

## Database Changes
- **New table: `pack_purchases`** — tracks purchase history (user_id, pack_id, cards_pulled JSON, purchased_at) with RLS for users to read own records
- RLS: users can SELECT own purchases; no direct INSERT (edge function uses service role)

## Edge Function: `open-pack`
- Accepts `{ pack_id, quantity: 1 | 10 }` + auth token
- Validates user has enough coins
- For each pack: rolls random number, looks up `pack_odds` by `pack_type` + dice range, resolves `result_slot` to a random card from `pack_players` for that slot
- Deducts coins, inserts into `user_collections`, logs to `pack_purchases`
- Returns array of pulled card objects with gem tier data

## New Files
- `src/pages/PackMarket.tsx` — pack grid, buy buttons, coin balance display
- `src/components/packs/PackCard.tsx` — single pack display tile
- `src/components/packs/PackReveal.tsx` — sequential card reveal animation with tier-specific glows
- `src/components/packs/RevealCard.tsx` — individual card flip/reveal with animation
- `supabase/functions/open-pack/index.ts` — server-side pack opening logic

## Routing
- Replace `/packs` Placeholder route with `PackMarket`

## UI Flow
1. Player sees pack grid with their coin balance in the header
2. Clicks "Open Pack" → loading state while edge function runs
3. Cards appear one at a time with a brief delay — each card uses its `resolveCardVisuals` colors for the reveal glow
4. Higher-tier cards get more dramatic animations (bigger glow, screen flash)
5. Summary screen shows all pulled cards with "Open Another" / "View Collection" buttons

