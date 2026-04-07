

# Fix Gem Market: Dedicated Admin Interface

## Problem
Players are appearing in the Gem Market because `gem_tier_id` is set directly on the player card form/wizard. There's no dedicated Gem Market admin -- any time an admin edits a player and sets a gem tier, they show up. This has led to 14 players in Gold and Emerald instead of the intended 10.

## Solution
Create a dedicated **Admin Gem Market** page where admins explicitly manage which players appear in each tier. Remove `gem_tier_id` controls from the player editor to prevent accidental assignments.

## Plan

### 1. Create Admin Gem Market page (`src/pages/admin/AdminGemMarket.tsx`)
- Show each gem tier as a section with its current players listed
- Each tier section has an "Add Player" button that opens a player search/combobox (reuse `PlayerCombobox`)
- Each player in a tier has a remove button to unassign them (`gem_tier_id = null`)
- Adding a player sets their `gem_tier_id` to that tier and allows setting an optional `gem_name`
- Show player count per tier (e.g. "Gold - 14/10 players") with a warning if over the recommended 10
- Allow drag or manual reordering within a tier (optional, low priority)

### 2. Remove gem tier controls from PlayerWizard and AdminPlayers form
- Remove the `gem_tier_id` and `gem_name` fields from the player card editor
- These should only be managed through the dedicated Gem Market admin

### 3. Add route and sidebar link
- Add `/admin/gem-market` route in `App.tsx`
- Add sidebar entry under admin section in `AppSidebar.tsx`

### 4. Clean up existing data
- Optionally: no code change needed, the admin can use the new UI to remove the extra 4 players from Gold and Emerald

### Files Changed

| File | Change |
|------|--------|
| `src/pages/admin/AdminGemMarket.tsx` | New -- tier-based player management UI |
| `src/App.tsx` | Add route |
| `src/components/AppSidebar.tsx` | Add admin nav link |
| `src/components/admin/PlayerWizard.tsx` | Remove gem_tier_id / gem_name fields |
| `src/pages/admin/AdminPlayers.tsx` | Remove gem_tier_id / gem_name from form |

