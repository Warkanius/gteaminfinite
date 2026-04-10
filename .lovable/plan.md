

# Rewrite Dice Engine to Match Tabletop Mechanics

## How It Works (Tabletop Rules)

The stat's star value determines both dice count and multiplier in a repeating pattern:

```text
Stars  Dice  Modifier  Doubles Bonus
  0      —     —        —
  1     1d6   ×0.5      —
  2     1d6   ×1        —
  3     1d6   ×1.5      —
  4     2d6   ×1        —
  5     2d6   ×1.5      ×2 if doubles
  6     3d6   ×1        —
  7     3d6   ×1.5      ×2 if ≥2 dice match
  8     4d6   ×1        —
  9     4d6   ×1.5      ×2 if ≥2 dice match
 10     5d6   ×1        —
 11     5d6   ×1.5      ×2 if ≥2 dice match
 12     6d6   ×1        —
```

**Pattern**: Every even star adds a die. Odd stars (3+) get ×1.5. Star 1 is the exception (×0.5). Doubles/matching bonus kicks in at 5+ stars.

**Overall rating** is no longer used for dice count or roll modifiers — it only matters for difficulty scaling in Domination.

## Changes

### `src/lib/gameEngine.ts`
- Replace `getDiceCount(stars)` with `getStatDiceCount(statValue)` that returns 1–6 dice based on the table above
- Replace `getStarModifier(stars)` with `getStatModifier(statValue)` returning 0.5, 1, or 1.5
- Add `hasMatchingDice(dice)` helper for the ≥2-match bonus at 5+ stars
- Update `resolveStatRoll` to use the stat value for dice count and modifier (not overall stars)
- Update `rollDice` to accept counts up to 6
- Update `StatRollResult.diceCount` type from `1 | 2` to `number`

### `src/components/game/GameBoard.tsx`
- Remove `getDiceCount` import and usage for determining dice count from overall stars
- Dice count per stat roll is now derived from the individual stat value being rolled
- Each stat potentially rolls a different number of dice

### `src/components/game/DiceInput.tsx` & `DiceRoll.tsx`
- Support variable dice counts (1–6) instead of fixed 1 or 2
- Update manual dice input to show the correct number of dice fields per stat

### `src/components/game/RunGameBoard.tsx`
- Update Runs mode similarly if it shares the same dice logic (will verify and align)

