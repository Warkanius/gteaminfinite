

# Fix Evolution System, Player Combobox, Star Ratings

## Issues to Address

### 1. Stars still use rounded-up `rating` field
**Root cause**: In `AdminPlayers.tsx` line 137, `rating` is saved as `Math.round(avg)`. The `PlayerCard` component passes `card.rating` to `StarRating`, which does `Math.floor(rating)`. Since `Math.round(1.8) = 2`, a 1.8 OVR card shows 2 stars instead of 1.

**Fix**: Change `Math.round()` to use the raw decimal average when computing `rating` for storage, OR change `PlayerCard` to compute stars from the 9 stats directly using `computeStars()` instead of relying on the stored `rating` field.

Best approach: Use `computeStars(card)` in `PlayerCard.tsx` and `StarRating` wherever stars are displayed. Keep saving `rating` as the floor value for backward compatibility.

### 2. Player Combobox doesn't differentiate card versions
**Root cause**: `PlayerCombobox` only shows `name`. Two cards named "Tetsuya Kuroko" are indistinguishable.

**Fix**: Expand the query in `EvoPathEditor` to fetch `gem_tier_id` and join tier name. Display as `"Name (Tier — OVR X.X)"` in the combobox.

### 3. "Create Evo Form" button creates unhelpful copy
**Root cause**: `createEvoForm()` copies all data and appends " Evo" to the name, then tries to auto-link to the first null `evolves_to_card_id` step. The user has to manually clean up the name, and the linking is fragile.

**Fix**: Pre-populate the name as the player's name without " Evo" suffix. Apply stat boosts from the next pending evo step automatically. The auto-link logic on save is fine — just fix the name.

### 4. Auto-generated evo paths always start from "base" tier
**Root cause**: `generateEvoPath()` starts from index 0 (lowest tier) regardless of the card's current tier. If `playerGemTierId` matches a tier, it finds that index but still generates from there to the end.

**Fix**: Rework `generateEvoPath` to generate a **single next step** instead of the full remaining path. It should:
- Start from the card's current tier
- Generate only one step to the next tier
- Use the card's actual stats, traits, and badges to create a relevant challenge

### 5. Auto-generate button creates all steps at once
**Fix**: Change the "Auto-Generate" button to "Generate Next Step" — it generates one step at a time based on current tier, stats, and existing steps.

## File Changes

| File | Change |
|---|---|
| `src/lib/ovrUtils.ts` | Already has `computeStars` using `Math.floor` — no change needed |
| `src/components/cards/PlayerCard.tsx` | Use `computeStars(card)` instead of `card.rating` for StarRating |
| `src/pages/admin/AdminPlayers.tsx` | Change `Math.round()` to `Math.floor()` in save mutation for `rating`; remove " Evo" suffix from `createEvoForm` |
| `src/lib/evoGenerator.ts` | Add `generateSingleEvoStep()` function that creates one context-aware step |
| `src/components/admin/EvoPathEditor.tsx` | Use `generateSingleEvoStep`; expand player query to include tier info; show tier + OVR in combobox |
| `src/components/admin/PlayerCombobox.tsx` | Support optional subtitle/detail display |

