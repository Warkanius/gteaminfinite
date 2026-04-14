

# Multiple Fixes & Features

## Summary of Issues & Requests

1. **Clean up empty/duplicate packs** — Several packs have 0 players or duplicate names
2. **Reuse domination packs by team name** — When creating domination games, reuse existing packs instead of creating new ones
3. **5v5 matchup selection** — Let players arrange their lineup order against CPU to defend star players
4. **Team name + username customization** — Players should be able to set a personal username and team name
5. **Sensations pack card not sellable** — Need to investigate; the quicksell function only allows `source: "standard_pack"` cards, and challenge-won pack cards should be opened with that source
6. **Collection rewards not working** — The `is_collection_reward` flag exists on player_cards but there's zero logic to grant these rewards when a user completes a collection/sub-collection

## Findings

**Empty/duplicate packs to clean up (will confirm with you first):**
- `RTTR Pack` (0 players)
- `Team Dom Pack` (0 players)
- `Tortuga Starter Pack` (0 players)
- `Tree Hill Starter Pack` (0 players)
- 2x `vs Kaijo Reward` duplicates (same name, both have 5 players)
- 2x `vs Shutoku Reward` duplicates (same name, both have 5 players)

**Quicksell issue:** The `open-pack` edge function sets source to `"standard_pack"` when called directly (not from inventory). All your Sensations cards show `source: standard_pack` in the database, so they should be sellable. The issue may be that the `collectionIdMap` picks a locked entry's ID. Need to verify the quicksell flow in the UI more carefully — could also be a UI-side filtering issue.

**Collection rewards:** The `is_collection_reward` flag on `player_cards` and the badge in `CardDetailDialog` exist, but there is absolutely no logic anywhere that: (a) checks if a user has completed a collection/sub-collection, (b) grants the reward card automatically. This needs to be built from scratch.

## Plan

### 1. Pack Cleanup (data operation — will confirm list with you)
- Delete the 4 empty packs and deduplicate the Kaijo/Shutoku reward packs
- Check which domination games reference the duplicates and reassign to the surviving pack

### 2. Domination Pack Reuse
- In `AdminTeams.tsx` or wherever domination games are created, when assigning a pack reward, search for existing packs matching `vs {teamName} Reward` before creating a new one

### 3. 5v5 Matchup Selection
- After lineup selection, show a new **matchup arrangement** screen where the user sees CPU lineup and can drag/reorder their 5 players to set head-to-head pairings
- Each slot shows the opponent card so users can strategically defend against star players
- Update `GameBoard` to respect this user-defined order rather than the default index order

### 4. Team Name + Username
- **Migration:** Add `team_name` column to `profiles` table
- **Auth page:** Add optional team name field during signup
- **Settings/Profile page:** Allow editing display name and team name (currently no settings page exists — add a simple one)
- Show team name in game results and dashboard

### 5. Fix Quicksell for Standard Pack Cards
- Debug the exact quicksell flow — the data shows source is correct, so the issue is likely in the UI (locked card selected, or wrong collection entry ID passed)
- Ensure `collectionIdMap` always picks an unlocked, sellable entry first
- Add better error messaging in the quicksell UI

### 6. Collection Rewards System
- **Collection page:** For each collection/sub-collection, check if the user owns all non-reward cards in that group
- When complete, show a "Claim Reward" button
- On claim, insert the reward card into `user_collections` with `source: "collection_reward"`
- The reward card must have `collection_id` (or `sub_collection_id`) set so the system knows which collection it belongs to
- Show completion progress per collection/sub-collection in the Collection page
- Reward cards marked `is_collection_reward` should be excluded from the "cards needed" count

### Files Changed

| File | Change |
|---|---|
| Migration | Add `team_name` to `profiles` |
| Data cleanup | Delete empty/duplicate packs (after confirmation) |
| `src/pages/Collection.tsx` | Add collection completion tracking + reward claiming |
| `src/pages/Auth.tsx` | Add team name field to signup |
| New: `src/pages/Settings.tsx` | Profile editing (display name, team name) |
| `src/App.tsx` | Add Settings route |
| `src/components/AppSidebar.tsx` | Add Settings nav link |
| `src/components/game/LineupSelect.tsx` | Add matchup arrangement step |
| `src/components/game/GameBoard.tsx` | Respect user-defined matchup order |
| `src/components/game/GameResults.tsx` | Show team name |
| `src/pages/admin/AdminPlayers.tsx` | Ensure collection_id is set on reward cards |
| Quicksell fix | Fix `collectionIdMap` logic + edge function source check |

