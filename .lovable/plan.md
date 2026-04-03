

# Collection Tab Revamp

Two parts: (1) clear your current collection data, (2) rebuild the Collection page with better visuals, stats/progress tracking, and duplicate management.

## 1. Clear Collection

Delete all 6 rows from `user_collections` for your user via the database insert tool.

## 2. Revamped Collection Page

### Stats & Progress Header
A summary bar at the top showing:
- **Total cards owned** / total cards in game (e.g., "6 / 134")
- **Tier breakdown**: mini progress bars for each gem tier showing owned vs available (e.g., "Gold: 2/10"), color-coded to match tier colors from `gem_tiers.color`
- **Collection completion percentage** as a prominent number

### Better Card Visuals
- Larger card thumbnails (fewer columns: 2 on mobile, 3-4 on desktop instead of up to 6)
- Add a subtle "owned count" overlay for duplicates (e.g., "×2" badge in corner)
- Cards get a slight border glow using their gem tier color for better visual hierarchy
- Locked/favorite indicator icons on the card thumbnail

### Duplicate & Quicksell Management
- Duplicate cards show a "×N" count badge on the thumbnail
- Query groups `user_collections` by `player_card_id` and counts entries per card
- Card detail dialog gets a new "Quicksell" button when duplicates > 1
  - Sells one copy for coins (configurable via `rule_config` key `quicksell_coin_value`, default 50 coins per card)
  - Deletes one `user_collections` row (needs a DELETE RLS policy added)
  - Updates `profiles.coins`
- **Card locking**: Add `is_locked` boolean column to `user_collections`
  - Lock icon on card thumbnail; locked cards cannot be quicksold
  - Toggle via the detail dialog

### Database Changes
1. **Migration**: Add `is_locked boolean default false` to `user_collections`
2. **Migration**: Add DELETE RLS policy on `user_collections` for own records
3. **Edge function** `quicksell-card`: accepts `{ collection_id }`, validates ownership, checks not locked, checks duplicates > 1, deletes the row, adds coins to profile, returns updated coin balance

### Files Changed
| File | Action |
|------|--------|
| `user_collections` | Clear data (insert tool) |
| `user_collections` | Migration: add `is_locked`, add DELETE policy |
| `supabase/functions/quicksell-card/index.ts` | Create |
| `src/pages/Collection.tsx` | Rewrite with stats header, larger cards, duplicate counts, lock toggles |
| `src/components/cards/PlayerCard.tsx` | Add duplicate count + lock icon props |
| `src/components/cards/CardDetailDialog.tsx` | Add quicksell button + lock toggle |

