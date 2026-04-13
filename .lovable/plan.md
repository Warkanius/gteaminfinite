

# Fix Quick Edit Traits, Star Updates, Autofill Behavior & Cleanup

## Issues Found

1. **Trait search not working in Quick Edit**: The `rating` field from `player_cards` is type `numeric` (returned as a string by Supabase). The `form.rating` comparison `gemTiers.find(g => g.stars === form.rating)` may fail due to type mismatch. More critically, the trait search UI code exists but the trait search results dropdown may not be rendering due to a subtle issue — need to verify. Will add explicit `Number()` coercion throughout.

2. **Star rating not updating in real-time**: The `PlayerQuickEdit` dialog doesn't have a star/rating slider at all — only individual stat inputs. There's no way to change the overall star rating from quick edit. Need to add a rating slider.

3. **Autofill template fills ALL slots, ignoring existing roster**: Both `autofillTeamRoster` (AdminTeams line 200) and `autofillRoster` (RunRosterManager line 299) call `DELETE` to clear the entire roster before generating new players. Should instead only fill remaining empty slots.

4. **Generated players not cleaned up when discarded**: When autofill creates `player_cards` rows but the user discards pending players or doesn't save, those cards remain as orphans in the database. Need to delete the `player_cards` entries when discarding.

## Plan

### 1. PlayerQuickEdit — Add Star Rating Slider + Fix Type Coercion
**File**: `src/components/admin/PlayerQuickEdit.tsx`
- Add a star rating slider (0–6) between Name/Position and Stats sections
- Coerce `playerRes.data.rating` to `Number()` when loading
- Ensure gem tier auto-correct uses `Number()` comparison

### 2. Autofill — Fill Only Remaining Slots
**File**: `src/pages/admin/AdminTeams.tsx`
- In `autofillTeamRoster`: remove the `DELETE` call. Calculate how many slots are already filled (`currentTeamRoster.length`). Only generate cards for `template.slots.slice(existingCount)`. Assign slot numbers starting from `existingCount + 1`.

**File**: `src/components/admin/RunRosterManager.tsx`  
- In `autofillRoster`: remove the `DELETE` call. Calculate filled slots from `rosterCardIds.size`. Only generate for remaining template slots. Insert only the new `run_players` rows.

### 3. Delete Orphan Players on Discard
**File**: `src/components/admin/RunRosterManager.tsx`
- When user clicks "Discard All" on pending players, also delete the `player_cards` rows for any pending players that were auto-generated (track which pending players were generated vs. existing)
- When user removes individual pending players, delete the card if it was auto-generated
- Same logic for `autofillRoster` — if the mutation itself fails mid-way, clean up created cards

**File**: `src/pages/admin/AdminTeams.tsx`
- Same pattern: when removing a player from a team roster, delete the `player_cards` row if it has no other references (team_players, run_players, user_collections, etc.)
- Simpler approach: add a "Delete player too?" option, or always delete orphaned generated cards

### 4. Verify Trait UI Works
**File**: `src/components/admin/PlayerQuickEdit.tsx`
- The trait search/add code exists. Will verify the `allTraits` query returns data and the filter logic is correct. Add a fallback message if no traits exist in the database.

## Files Changed

| File | Change |
|---|---|
| `src/components/admin/PlayerQuickEdit.tsx` | Add star rating slider, fix `Number()` coercion on rating, verify trait UI |
| `src/components/admin/RunRosterManager.tsx` | Autofill fills only remaining slots; discard deletes orphan player_cards |
| `src/pages/admin/AdminTeams.tsx` | Autofill fills only remaining slots; cleanup orphan cards on removal |

