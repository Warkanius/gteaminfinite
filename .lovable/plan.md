

# Fix Runs Mode: Evo Tracking, Scoring Bug, and Badge Behavior

## Problems Found

1. **No evo progress tracking from Runs games**: `RunGameBoard.handleGameEnd` never calls `trackEvoProgress`. Only the Domination `GameResults` component does.

2. **Scoring bug (5-point shots)**: In `RunGameBoard.tsx` lines 225 and 317, bonus points from badges are added on top of the shot's point value: `result.points + Math.round(offBadge.totalBonus)`. A 3PT shot with a badge bonus of 1.5-2 rounds to 5 points. In basketball, a made shot should only score 2 or 3 (or 1 for INT). Badge bonuses should affect the dice rolls and stat values (influencing whether a shot is made), not add free points after the fact.

3. **Badges need Runs-specific behavior**: The badge `totalBonus` (from reroll flat bonuses and bonus-type badges) is being treated as extra points. In Runs mode, these bonuses should instead be added to the offense roll value before the contest comparison (boosting the chance of making the shot), not to the final score.

## Changes

### `src/components/game/RunGameBoard.tsx`
- **Fix scoring**: Remove `+ Math.round(offBadge.totalBonus)` from point calculations on both player shoot (line 225) and CPU contest (line 317). Points scored = `result.points` only (2 or 3 for made shots).
- **Apply badge bonus to the roll instead**: Pass `offBadge.totalBonus` into `resolveRunShotContest` so it's added to the offense roll value before comparing to defense. This makes badges influence shot success, not inflate scores.
- **Add evo progress tracking**: After a game ends in `handleGameEnd`, build `CardGameResult` objects for each player card and call `trackEvoProgress(userId, userCards, won)`. This requires accumulating per-card stats during the game (points scored, stat values used).

### `src/lib/gameEngine.ts`
- Update `resolveRunShotContest` to accept optional `offenseBonus` and `defenseBonus` parameters that get added to the roll totals before comparison.

### Stat Accumulation for Evo Tracking
- Add state to `RunGameBoard` to accumulate per-card performance (points scored, stat roll values) across all possessions.
- On game end, convert accumulated stats into `CardGameResult` format and pass to `trackEvoProgress`.

| File | What |
|------|------|
| `src/components/game/RunGameBoard.tsx` | Fix scoring, add badge-to-roll, add evo tracking |
| `src/lib/gameEngine.ts` | Add bonus params to `resolveRunShotContest` |

