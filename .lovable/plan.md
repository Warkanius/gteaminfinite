

# Admin Auction House Config & Per-Card Market Values

## What We're Building

1. **Per-card `market_value`** column on `player_cards` — an admin-set base price for each card in the auction house
2. **Dedicated Admin Auction Config page** (`/admin/auction`) with friendly sliders/inputs instead of raw JSON editing
3. **Update `refresh-auction`** to only pull cards that belong to pack-market packs, and to price listings relative to each card's `market_value`
4. **Update player edit form** to include a Market Value field

## Database Changes

### Migration
- Add `market_value integer not null default 500` to `player_cards`

No new tables needed — auction config stays in `rule_config` (key: `auction_config`), just gets a proper UI.

## New Admin Page: `/admin/auction`

A dedicated page with labeled controls (no JSON editing):

| Control | Type | Maps to config key |
|---------|------|--------------------|
| Min Price | Number input | `min_price` |
| Max Price | Number input | `max_price` |
| Snipe Likelihood (%) | Slider 0-100 | `snipe_chance` |
| Snipe Discount Range | Two inputs (min%, max%) | `snipe_discount_min`, `snipe_discount_max` |
| Listings Per Refresh | Number input | `listings_per_refresh` |
| Listing Duration (minutes) | Number input | `listing_duration_minutes` |
| Tier Weights | One slider per gem tier (fetched from `gem_tiers`) | `tier_weights` |
| "Force Refresh Market" button | Calls `refresh-auction` edge function | — |

Reads/writes the `auction_config` row in `rule_config`. Auto-creates the row if missing.

## Player Edit Form Update

Add a "Market Value" number input in the player edit dialog (in `AdminPlayers.tsx`) so admins can set per-card auction pricing.

## Edge Function: `refresh-auction` Updates

1. **Pack-market filter**: Only select cards that appear in `pack_players` for packs where `cost > 0` (i.e., packs visible in the pack market)
2. **Market-value pricing**: Use `card.market_value` as the base price instead of a flat rating formula. Apply random variance (e.g., 0.8x - 1.3x) around market value. Snipe rolls use `snipe_discount_min/max` from config.
3. Keep tier weighting logic intact.

## Files Changed

| File | Action |
|------|--------|
| Migration | Add `market_value` to `player_cards` |
| `src/pages/admin/AdminAuction.tsx` | Create — friendly auction config UI |
| `src/pages/admin/AdminPlayers.tsx` | Add Market Value input to edit form |
| `supabase/functions/refresh-auction/index.ts` | Filter to pack-market cards, use `market_value` for pricing |
| `src/App.tsx` | Add `/admin/auction` route |
| `src/components/AppSidebar.tsx` | Add "Auction House" to admin nav |

