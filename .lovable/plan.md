

# Fix: Runs Mode Rating System

## Problems Identified

There are two core issues with how The Runs handles ratings:

1. **Visual: PlayerCard treats `run_rating` (0–120) as star count.** When CPU cards get `rating: run_rating` (e.g. 80), the `StarRating` component renders 80 stars with scale-breaker glow. It expects 0–6.

2. **Gameplay: Player lineup cards don't use run stats.** The user's cards come straight from `user_collections → player_cards` with standard star-based stats (0–6). Only CPU cards get run stats overlaid. The game engine then treats run numerical stats (0–120) and star stats (0–6) identically in `resolveStatRoll`, producing nonsensical results.

3. **Game engine mismatch.** `RunGameBoard` calls `resolveStatRoll` which uses `getStarModifier(stars)` — a lookup table for 0–5. But it feeds in `getStars(run_rating)` which converts 0–120 back to 0–5 poorly. The stat values themselves (0–120 for CPU, 0–6 for player) are also incompatible.

## Plan

### 1. Convert run_rating to display stars for PlayerCard

Add a utility to convert the 0–120 numerical scale back to star display:
- `run_rating / 20` gives the star equivalent (e.g. 80 → 4 stars, 100 → 5 stars)
- In `RunLineupSelect` and `RunGameBoard`, pass a display-friendly version of the card to `PlayerCard` with `rating` converted to stars, while keeping the raw numerical values for game logic

### 2. Overlay run stats on player lineup cards

In `RunLineupSelect`, when the user selects cards from their collection, check `player_cards.run_*` columns. If those exist, overlay them onto the card data before passing to the game board — same pattern already used for CPU cards. If a user's card has no `run_*` stats, fall back to a conversion: `star_stat * 20`.

### 3. Adapt RunGameBoard engine for numerical scale

Rewrite the roll logic in `RunGameBoard.handleRoll` to work natively with the 0–120 numerical scale instead of trying to convert back to stars:
- **Dice count**: 2 dice if `run_rating >= 80` (equivalent to old 4-star threshold), else 1
- **Modifier**: Use `run_rating / 40` as a continuous modifier (so 80 → 2.0x, 100 → 2.5x, 120 → 3.0x) — mirrors the old star modifier table but works on the numerical scale
- **Stat value display**: Show the 0–120 numerical stat in the stat selector dropdown

### Files to modify

- **`src/components/game/RunLineupSelect.tsx`** — Overlay `run_*` stats on player cards; convert `rating` to stars for display
- **`src/components/game/RunGameBoard.tsx`** — Rewrite roll logic for 0–120 scale; convert rating to stars before passing to `PlayerCard`
- **`src/lib/gameEngine.ts`** — Add `getRunStarModifier(runRating: number)` and `getRunDiceCount(runRating: number)` helpers for the numerical scale

