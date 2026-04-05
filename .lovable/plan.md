

# Linked Card Versions for Evolution

## Current State

Right now, evolution steps define `stat_boosts` and `new_badges` but there's no target card. When a step completes, `completed = true` is set in `user_evo_progress` and nothing else happens. The card stays the same.

## Design: Linked Card Versions

Each evolution step will point to a **separate player card** that the user receives upon completion. For example, "LeBron Gold" has an evo path where step 1 leads to "LeBron Emerald" (a distinct card in `player_cards`). When the challenge is completed, the old card is swapped for the new one in the user's collection.

## Database Changes

**Add column to `evo_paths`:**
```sql
ALTER TABLE public.evo_paths ADD COLUMN evolves_to_card_id uuid;
```
This references the destination `player_cards` entry. The existing `stat_boosts` and `new_badges` columns remain for display purposes (showing what's different) but the actual evolved card is a pre-built card with those stats/badges already set.

## Admin UI Changes (`EvoPathEditor.tsx`)

- Add a **"Evolves To" player card selector** on each evo step (using the existing `PlayerCombobox` component)
- The admin creates the evolved card version first (e.g., "LeBron Emerald" with higher stats), then links it as the evolution target
- Update save logic to persist `evolves_to_card_id`

## Evolution Claim Flow

**New "Claim Evolution" button** on `CardDetailDialog.tsx`:
- Appears when an evo step is completed but not yet claimed
- Add a `claimed` boolean to `user_evo_progress` (or use `completed` + check if the card was swapped)
- On claim: insert the new card (`evolves_to_card_id`) into `user_collections` and remove the old card
- Show a brief congratulatory animation/toast

**Progress tracker (`evoProgressTracker.ts`):**
- No changes needed — it already marks steps as completed. The claim is a separate user action.

## Card Detail UI (`CardDetailDialog.tsx`)

- On each completed-but-unclaimed step, show a **"Claim Evolution"** button with the target card name
- When claimed, show the step as fully done and the next step becomes active

## Files to Change

| File | Change |
|------|--------|
| Migration | Add `evolves_to_card_id` column to `evo_paths`, add `claimed` column to `user_evo_progress` |
| `src/components/admin/EvoPathEditor.tsx` | Add player card selector for "Evolves To" on each step |
| `src/components/cards/CardDetailDialog.tsx` | Add "Claim Evolution" button that swaps cards in collection |
| `src/lib/evoGenerator.ts` | Update `EvoStep` type to include `evolves_to_card_id` |

