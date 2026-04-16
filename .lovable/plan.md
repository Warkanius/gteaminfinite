

## Problem Diagnosis

The user reported three concrete issues with The Runs:
1. **"Too many possessions back and forth with no make"** — math is too defense-favoured
2. **"In 5v5 we see badge effects and dice rolls — in The Runs we do not"** — Runs jumps straight from "SHOOT" button → result text in the log, no contest visualization
3. **Possession flow is confusing** — hard to tell what's happening turn-to-turn

### Why misses chain so often
The current `resolveRunShotContest` is symmetrical: `offenseRoll = diceTotal × (rating/40) × (statValue/60) + badgeBonus`. With equal cards, that's a coin-flip. After a miss, the rebound is *also* a coin-flip. After a defensive rebound, the CPU shoots — another coin-flip. So 3+ empty possessions in a row is very common (12.5% chance of a miss → defensive board → CPU miss alone, and chains compound from there).

## Fix: Three Targeted Changes

### 1. Rebalance scoring math (less stalemate)

In `src/lib/gameEngine.ts` → `resolveRunShotContest`:
- Add an **offensive advantage**: shots tilted slightly toward the shooter (offense gets +15% on roll). Real basketball averages ~50% FG, but Runs has rebounds chaining empty possessions, so we need ~60% make rate per shot.
- Add a **stat-gap floor**: when shooter's stat is meaningfully higher than defender's counter-stat (e.g. 90 FIN vs 50 BLK), guarantee ~75%+ make rate by adding a stat-differential bonus.
- Cap defensive variance by clamping defenseRoll to `[0.5×offenseRoll, 1.5×offenseRoll]` so a CPU lucky-roll doesn't shut down obvious mismatches.

### 2. Add contest visualization (parity with 5v5)

Insert a "rolling" / "result" phase between SHOOT and the next possession, mirroring how `GameBoard.tsx` uses `<DiceRoll>` and `<StatResult>`:
- After SHOOT/CONTEST: brief animated dice roll showing both sides' dice
- Then a result panel showing: shooter card, defender card, both rolls, badges/traits that activated, and MADE/MISSED verdict
- "Next Possession" button to continue (auto-advance after 3s)
- Same UI used for the Rebound contest

This reuses `<DiceRoll>`, `<ActivationBanner>`, and a new lightweight `<RunContestResult>` panel.

### 3. Clearer possession flow

- Big possession indicator banner above the action area: "🏀 YOUR BALL — Pick Shot" / "🛡️ CPU HAS THE BALL — Contest Their Shot"
- Mini "Possessions: 7" + "Last play: ✅ MAKE / ❌ MISS / 🏀 REB" chip on the scoreboard
- Pulse animation on whoever has the ball

## Files Changed

| File | Change |
|---|---|
| `src/lib/gameEngine.ts` | Rebalance `resolveRunShotContest`: offense advantage, stat-gap floor, defense-roll clamp |
| `src/components/game/RunGameBoard.tsx` | Add `rolling` and `result` phases; show DiceRoll + contest result panel + activations between SHOOT and next possession; add possession banner + last-play chip |
| `src/components/game/RunContestResult.tsx` | New component — visualizes shooter vs defender, dice, badges/traits, verdict |

## Out of Scope (not changing)

- Manual pick flow (user wants to keep it)
- Target score / win-by-2 rules
- 4d6 opponent roll selection
- The display-card / game-card split (already fixed)

