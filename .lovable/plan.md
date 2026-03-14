

# Swap Diamond and HOF Tier Names

The user wants Diamond to be a higher tier than HOF. The simplest approach: swap the **names** everywhere they appear, keeping all numeric values in place. This means what was called "hof" (level 4) becomes "diamond", and what was called "diamond" (level 3) becomes "hof".

## Affected Files

### 1. `src/lib/badgeEngine.ts`
- Swap `BadgeTier` type: keep the same strings but swap their numeric order in `TIER_ORDER` — `hof: 2, diamond: 3`
- Every per-tier map function (`rerollCount`, `bonusDiceValue`, `bonusTypeDiceValue`, `bonusTypeRerolls`, `debuffAmount`, `boostAmount`, `hiddenGemPenaltyReduction`, `hiddenGemBoostPercent`, `versatileSlots`): swap the values assigned to `diamond` and `hof` keys
- Update comments referencing "Diamond" and "HOF" tiers

### 2. `src/lib/traitEngine.ts`
- Swap `TIER_LEVEL`: `hof: 3, diamond: 4`
- Update Scientist comment

### 3. `src/lib/archetypeEngine.ts` (line 221-225)
- Swap `"diamond"` and `"hof"` in the `badgeTiers` arrays for gem tier stat ranges

### 4. `src/components/cards/CardDetailDialog.tsx` (lines 39-43)
- Swap color assignments: diamond gets the pink-diamond color (higher tier), hof gets the diamond color (lower tier)

### 5. UI tier selectors (order in dropdowns)
- `src/components/admin/PlayerWizard.tsx` line 35 and `src/pages/admin/AdminPlayers.tsx` line 44: change `BADGE_TIERS` array order to `["base", "gold", "hof", "diamond", "actolytrene"]`
- `src/components/admin/PlayerWizard.tsx` line 120: swap tierMap values

## Approach
In every per-tier map, swap the values at the `diamond` and `hof` keys. The string literals stay the same (`"diamond"`, `"hof"`), but their **numeric ordering and effect values** swap so diamond is tier level 4 and hof is tier level 3.

