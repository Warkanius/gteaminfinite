

# Fix Star Ratings, Scientist Trait, and Trait Application

## Issues Found

### 1. Star values in pack reveals and card details
- `RevealCard.tsx` line 112: `StarRating rating={card.rating}` — uses stored rating (rounded), not `computeStars(card)`
- `CardDetailDialog.tsx` line 87: Same issue — `StarRating rating={card.rating}`
- `CardDetailDialog.tsx` line 104: Individual stat star ratings use raw stat values (these are correct — they ARE the star values)

### 2. Scientist trait not working
- `getEvolutionMultiplier()` is defined in `traitEngine.ts` but **never called** anywhere
- `evoProgressTracker.ts` computes raw increments without applying the Scientist multiplier
- Fix: In `trackEvoProgress`, fetch traits for the cards, compute the Scientist multiplier, and apply it to the increment before updating progress

### 3. Other signature traits not working in games
- The trait system IS wired into `GameBoard.tsx` (lines 213-240) and resolves correctly
- However, the `gameContext` in `Play.tsx` sets `isKeyGame: false` always, and `isHome`/`isAway` are based on domination mode
- The likely issue: traits with `condition_type` like `underdog` compare `opponentRating` (the card's `rating` field) vs `cardRating` — but since `rating` was recently changed to `Math.floor`, and `resolveTraitBoosts` passes `cpuCard.rating` / `userCard.rating`, this should still work
- Real problem: The evo progress numbers match exact game stats because the Scientist multiplier isn't applied — the user sees evo progress = exact game output, confirming the multiplier is missing

## Plan

### File Changes

| File | Change |
|---|---|
| `src/components/packs/RevealCard.tsx` | Import `computeStars` from `ovrUtils`, use `computeStars(card)` instead of `card.rating` for StarRating |
| `src/components/cards/CardDetailDialog.tsx` | Import `computeStars`, use `computeStars(card)` for the header StarRating |
| `src/lib/evoProgressTracker.ts` | Import `fetchTraitsForCards` and `getEvolutionMultiplier`; after computing increment, fetch traits for the card and multiply increment by the Scientist multiplier |

### Detail: Evo Tracker Scientist Integration

In `trackEvoProgress`:
1. Fetch traits for all card IDs via `fetchTraitsForCards(supabase, cardIds)`
2. In `trackSingleProgress` and `trackCompoundProgress`, pass the card's traits
3. Multiply the computed increment by `getEvolutionMultiplier(traits)` before applying
4. Round the result to avoid fractional progress

