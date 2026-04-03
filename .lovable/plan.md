

# Phase 1: Gem Market + Starter Packs

## 1. Gem Market — Tiered Gem Shop

### Concept
Players browse player cards organized by gem tier. Tier 1 is always unlocked. Each subsequent tier unlocks when the user owns at least half the cards from the previous tier (from any source — packs, rewards, or gem purchases). Cards are purchased with gems.

### Database
- No new tables needed. `gem_tiers` already has `gem_value` (price), `name`, `sort_order`. `player_cards` has `gem_tier_id`. `user_collections` tracks ownership. `profiles` has `gems`.

### New Edge Function: `supabase/functions/buy-gem-card/index.ts`
- Accepts `{ player_card_id }` from authenticated user
- Validates: card exists, has a `gem_tier_id` with `gem_value > 0`
- Checks tier unlock: counts how many cards in the previous tier the user owns vs total cards in that tier; if < 50%, rejects
- Checks user has enough gems
- Deducts gems from `profiles`, inserts into `user_collections`
- Returns the purchased card data + remaining gems

### New Page: `src/pages/GemMarket.tsx`
- Replace `/gems` Placeholder route
- Shows user's gem balance at top
- Groups cards by gem tier (accordion or tab sections), sorted by `sort_order`
- Each tier section shows: tier name, color, unlock progress bar ("Own 3/6 — Next tier unlocks at 3")
- Locked tiers are visually dimmed with a lock icon and progress indicator
- Each card shows: name, rating, position, gem cost, and "Owned ✓" badge if already in collection
- Purchase button opens a confirm dialog; on success, shows a card reveal animation and refreshes balance
- Cards already owned are non-purchasable (button disabled)

### Route Update: `src/App.tsx`
- Swap `Placeholder` for lazy-loaded `GemMarket` at `/gems`

---

## 2. Starter Packs — Admin-Defined, Player-Chosen

### Concept
Admins create multiple starter packs (e.g., "Guard Starter", "Big Man Starter") with fixed pre-assigned players. New users with an empty collection see a selection screen and pick one pack to claim. One-time only.

### Database
- Use existing `packs` table with `pack_type = 'starter'` and `cost = 0`
- Use existing `pack_players` table to assign specific cards to each starter pack
- Admins create/manage these through the existing AdminPacks interface (already supports adding packs with players)

### New Edge Function: `supabase/functions/claim-starter-pack/index.ts`
- Accepts `{ pack_id }` from authenticated user
- Validates pack exists and has `pack_type = 'starter'`
- Checks user has never claimed a starter pack (query `pack_purchases` for any starter-type purchase by this user)
- Fetches all `pack_players` for that pack, inserts all into `user_collections`
- Logs in `pack_purchases` with `coins_spent = 0`
- Returns the full card data for reveal animation

### Dashboard Integration: `src/pages/Dashboard.tsx`
- On load, check if user has any `pack_purchases` with a starter pack
- If not, show a prominent "Choose Your Starter Pack" banner/modal
- Fetch all packs where `pack_type = 'starter'` and `cost = 0`
- Display each starter pack as a card showing: pack name, list of included players (fetched from `pack_players` joined with `player_cards`)
- User clicks one to claim; triggers the edge function
- On success, show `PackReveal` component with the received cards
- After reveal, banner disappears permanently (state driven by the pack_purchases check)

### Admin Side
- No admin UI changes needed — admins already use AdminPacks to create packs with `pack_type` and assign players via the "Manage > Pack Players" tab
- Starter packs just need `pack_type = 'starter'` and `cost = 0`
- The Pack Market already filters these out (`cost > 0`)

---

## Files Summary

| File | Action |
|------|--------|
| `supabase/functions/buy-gem-card/index.ts` | Create |
| `supabase/functions/claim-starter-pack/index.ts` | Create |
| `src/pages/GemMarket.tsx` | Create |
| `src/pages/Dashboard.tsx` | Modify — add starter pack selection |
| `src/App.tsx` | Modify — swap `/gems` route |

No database migrations required — all needed tables and columns already exist.

