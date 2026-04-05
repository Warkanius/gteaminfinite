

# Create Evo Form from Existing Card

## What It Does

Adds a "Create Evo Form" button to each player row in the admin table. Clicking it duplicates the card (name, info, stats, badges, traits, visuals) into the editor as a new card, appends a tier suffix to the name (e.g. "LeBron → LeBron Emerald"), and after saving the new card, automatically links it as the `evolves_to_card_id` on the next unlinked evo step of the source card.

## User Flow

1. Admin clicks the new **Evo Form** button (DNA/copy icon) on a player row
2. The system loads the player's full data (stats, badges, traits) and opens the editor as a **new card** (no `editId`)
3. Name is pre-filled as `"{Original Name} Evo"` — admin adjusts it
4. Admin tweaks stats, badges, gem tier, etc., then saves
5. On save, the system finds the first evo step on the **source card** where `evolves_to_card_id` is null and sets it to the newly created card's ID
6. Toast confirms: "Evo form created and linked to {source name}"

## Technical Changes

### `src/pages/admin/AdminPlayers.tsx`

**New state**: `evoSourceId` — tracks which card we're creating an evo form for (null for normal creates/edits).

**New function `createEvoForm(player)`**:
- Calls `loadPlayerData(player)` to get badges/traits
- Sets form with all data but `name: "{player.name} Evo"`, `id: undefined`
- Sets `editId = null` (new card mode)
- Sets `evoSourceId = player.id`
- Opens dialog

**Modify `saveMut`**: After a successful insert (not update), if `evoSourceId` is set:
- Query `evo_paths` for `player_card_id = evoSourceId` where `evolves_to_card_id IS NULL`, ordered by `step_order`, limit 1
- Update that row's `evolves_to_card_id` to the new card's ID
- Reset `evoSourceId` to null
- Show appropriate toast

**Add button to row actions**: New icon button (e.g. `Copy` or `GitBranch`) next to Edit/Wizard/Delete with title "Create Evo Form"

### No other files changed

The existing `EvoPathEditor`, `PlayerCombobox`, and save logic remain untouched. The auto-link is a single update query after insert.

