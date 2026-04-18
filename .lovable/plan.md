

## Goal
Add the `PlayerQuickEdit` flow into the Pack manager so admins can tweak a player's stats/badges/traits without leaving the pack editor — same UX as in `AdminTeams` and `RunRosterManager`.

## Where it goes
`src/pages/admin/AdminPacks.tsx` — inside the "Pack Players" tab of the **Manage** dialog. Each player row currently shows: `#slot | name | X (remove)`. We'll insert a **pencil** button between the name and the remove button.

## Changes (one file: `src/pages/admin/AdminPacks.tsx`)

1. **Imports**: add `PlayerQuickEdit` and the `Pencil` icon (Pencil already imported).
2. **State**: add `const [quickEditPlayerId, setQuickEditPlayerId] = useState<string | null>(null);`
3. **Player row** (around line 315–321): add a pencil button:
   ```
   <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setQuickEditPlayerId(pp.player_card_id)}>
     <Pencil className="h-4 w-4" />
   </Button>
   ```
4. **Mount the dialog** at the bottom of the component (alongside the existing `ConfirmDialog`):
   ```
   <PlayerQuickEdit playerId={quickEditPlayerId} onClose={() => setQuickEditPlayerId(null)} />
   ```
5. **Invalidation**: `PlayerQuickEdit` already invalidates `admin-all-players-lite` / `admin-team-players` / `admin-dom-game-players`. Add `pack-players` to that list inside `PlayerQuickEdit.tsx`'s `onSuccess` so the row re-fetches and the new name shows immediately. Also add `player-cards-list` so the combobox at the top of the pack editor reflects renames.

## Files touched

| File | Change |
|---|---|
| `src/pages/admin/AdminPacks.tsx` | Add quick-edit state, pencil button on each player row, mount `PlayerQuickEdit` |
| `src/components/admin/PlayerQuickEdit.tsx` | Add `pack-players` and `player-cards-list` to the `onSuccess` query invalidation list |

## Out of scope
- No layout changes to the player row beyond adding one icon button.
- No change to the player combobox or odds tab.
- Not adding "create new player" from inside the pack editor — only edit existing.

