

# Fix Stat Rolls to Use Individual Stat Values

## Problem
`resolveStatRoll` calculates: `rollResult = diceTotal × starModifier(overallStars)`

The individual stat value (e.g., 3PT=8, MID=3) is passed in but **never used**. A card with 12 in 3PT rolls identically to one with 1 in 3PT if they share the same overall star rating.

## Difficulty Modifier Status
The difficulty modifier (`±10% per star difference`) is working correctly — it compares the card's overall gem tier stars against the game's difficulty stars, which is the intended design.

## Fix: Incorporate `statValue` into the Roll Formula

**Current formula:**
`rollResult = diceTotal × starModifier`

**New formula:**
`rollResult = diceTotal × starModifier × (statValue / 6)`

Using `/6` as the normalizer (stat range 0–12, midpoint 6):
- A stat of 6 → 1.0× (neutral)
- A stat of 12 → 2.0× (double effectiveness)
- A stat of 3 → 0.5× (half effectiveness)
- A stat of 0 → 0× (no output)

This means individual stats now meaningfully differentiate card performance per category while the overall star rating still determines dice count and base modifier.

## Files Changed

| File | Change |
|------|--------|
| `src/lib/gameEngine.ts` | Update `resolveStatRoll` to multiply by `statValue / 6` |

### Single-line change in `resolveStatRoll`:
```
// Before:
let rollResult = Math.round(diceTotal * modifier);

// After:
let rollResult = Math.round(diceTotal * modifier * (statValue / 6));
```

No other files need changes — `GameBoard.tsx` already passes the correct per-stat value (`userBadgeResult.adjustedStat` / `cpuBadgeResult.adjustedStat`) which traces back to `userCard[currentStat]`.

