

# Teams Tab Cleanup + Auto-Roster on Team Selection

## Changes

### 1. Remove Unlock Cost from Team Form
- Remove `unlock_cost` from `teamForm` state, the team dialog, and the team table columns
- The column stays in the DB (no migration needed) but is hidden from the UI

### 2. Create `team_players` Table
A new join table so teams own a reusable roster:

| Column | Type |
|---|---|
| `id` | uuid PK |
| `team_id` | uuid FK → teams |
| `player_card_id` | uuid FK → player_cards |
| `slot` | integer |
| `created_at` | timestamptz |

Unique on `(team_id, player_card_id)`. RLS: authenticated reads, admin manages.

### 3. Add Roster Management to Teams Tab
When editing a team (after first save), show a roster section with:
- Current players list with remove buttons
- Autofill from template (same Wand2 dropdown already used in Domination)
- Quick Add (archetype + star slider)
- These reuse the same `createPlayerFromSlot` helper already in the file

### 4. Auto-Populate Roster When Selecting Team for Domination Game
In the Domination game form, change the Opponent Team field from a free-text input to a proper team `Select` dropdown. When a team is selected:
- Copy that team's `team_players` roster into `domination_game_players` for the game
- The admin can still customize the roster afterward via the existing domination roster tools

## Files Changed

| File | Change |
|---|---|
| DB migration | Create `team_players` table with RLS |
| `src/pages/admin/AdminTeams.tsx` | Remove unlock_cost from form/table, add roster UI to team dialog, change opponent field to team selector with auto-roster copy |

