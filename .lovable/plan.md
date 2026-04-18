

## Two issues to fix

### 1. Quick Edit dialog cuts off at the bottom
`PlayerQuickEdit.tsx` wraps content in a `ScrollArea` with `max-h-[70vh]` *inside* `FormDialog`, which already provides its own `flex-1 overflow-y-auto` body. The nested scroll + viewport-based max height clips the bottom on small screens.

**Fix**: Remove the inner `ScrollArea` wrapper. Let `FormDialog`'s built-in scrollable body handle scrolling. Keep the inner `space-y-5 pr-2` div as the content container.

### 2. Evo path editor + Create Evo Version not in Quick Edit
The earlier plan to embed these was approved but the implementation pivoted to removing Stat Boosts and was never actually added. Add them now:

**`src/components/admin/PlayerQuickEdit.tsx`**
- Fetch the player's `gem_tier_id` (extend the player select).
- Add `pendingEvoSteps` state.
- Render `<EvoPathEditor>` after the Traits section, passing `playerId`, `playerGemTierId`, `playerStats` (from form), `playerBadges` (active + new), and `onStepsChange={setPendingEvoSteps}`.
- In `save` mutation, after badges/traits: `delete from evo_paths where player_card_id = playerId`, then insert `pendingEvoSteps` (with `stat_boosts: {}` to satisfy the column).
- Invalidate `["evo-paths", playerId]`.
- Add a "Create Evo Version" button in the dialog header area:
  - Computes next gem tier (by `sort_order` after current tier).
  - Clones `player_cards` row (copy stats/positions/colors, set new `gem_tier_id` + `rating` from next tier).
  - Clones `player_card_badges` and `player_card_traits` rows.
  - Auto-links: finds first `evo_paths` row for source where `evolves_to_card_id IS NULL` (lowest `step_order`), sets it to new card id.
  - Calls `onSwitchPlayer?.(newId)` to refocus the dialog on the new card.
- Add optional prop `onSwitchPlayer?: (id: string) => void`.

**`src/pages/admin/AdminPacks.tsx`**, **`src/pages/admin/AdminTeams.tsx`**, **`src/components/admin/RunRosterManager.tsx`**
- Pass `onSwitchPlayer={setQuickEditPlayerId}` (or equivalent setter) to `<PlayerQuickEdit>`.

## Files touched
| File | Change |
|---|---|
| `src/components/admin/PlayerQuickEdit.tsx` | Remove inner ScrollArea; embed EvoPathEditor; add Create Evo Version; expose onSwitchPlayer |
| `src/pages/admin/AdminPacks.tsx` | Wire onSwitchPlayer |
| `src/pages/admin/AdminTeams.tsx` | Wire onSwitchPlayer |
| `src/components/admin/RunRosterManager.tsx` | Wire onSwitchPlayer |

## Out of scope
- No DB schema changes (`stat_boosts` column stays, written as `{}`).
- No changes to `EvoPathEditor` itself or other admin pages.

