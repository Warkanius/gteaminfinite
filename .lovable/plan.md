

# The Runs — Basketball Possession System Overhaul

## Current Problems
- Each roll resolves as a simultaneous same-stat contest (5v5 style) instead of a proper basketball possession
- No distinct offense/defense mechanic — both sides roll the same stat
- No rebound system
- No badge integration
- "Attack" terminology doesn't fit basketball
- Players auto-rotate instead of user choosing shooter

## New Game Flow

Each possession follows this sequence:

```text
1. OFFENSE CHOOSES
   → Player picks which of their 3 cards shoots
   → Player picks a scoring stat (3PT, MID, FIN, DNK, INT)

2. SHOT CONTEST
   → Offense rolls dice × modifier using their chosen stat
   → Defense rolls dice × modifier using counter stat:
       • 3PT / MID / INT → defender's STL (direct slot matchup)
       • FIN / DNK       → slot 3's BLK (rim protector)

3. RESOLUTION
   → Offense roll > Defense roll = BUCKET (points per stat: 3PT=3, MID/FIN/DNK=2, INT=1)
   → Defense roll ≥ Offense roll = MISS → triggers REBOUND

4. REBOUND (on miss only)
   → Each team randomly selects a rebounder:
       Slot 3 = 60% chance, Slot 2 = 25%, Slot 1 = 15%
   → Each selected rebounder rolls using (REB + BLK) / 2 as their stat
   → Higher roll wins possession
   → Winner's team gets next possession (breaks normal alternation)

5. POSSESSION CHANGE
   → On a made basket: possession goes to the other team
   → On a miss: possession goes to the rebound winner
```

CPU offense mirrors this: CPU randomly picks a card and stat, player's matching slot defends with STL (perimeter) or slot 3 BLK (inside).

## Technical Changes

### 1. `src/lib/gameEngine.ts` — New helpers
- `resolveRunShotContest(offenseStat, offenseValue, offRating, offDice, defenseStat, defenseValue, defRating, defDice)` — offense vs defense with different stats
- `resolveRunRebound(teamSlots: {reb: number, blk: number}[], rating: number, dice: number[])` — combined (REB+BLK)/2 roll
- `pickRebounder()` — weighted random: slot 3 = 60%, slot 2 = 25%, slot 1 = 15%
- `getDefenseStat(offenseStat)` — returns `"stat_stl"` for perimeter, `"stat_blk"` for inside

### 2. `src/components/game/RunGameBoard.tsx` — Full rewrite of game logic
- **State**: Replace `playerIndex`/`cpuIndex` rotation with `possession: "player" | "cpu"` and free card selection
- **Offense UI (player's turn)**: Player picks card (from 3), picks stat, clicks "Shoot" (not "Attack")
- **Defense UI (CPU's turn)**: Show which CPU card is shooting and what stat. Player clicks "Contest" to roll defense
- **Shot resolution**: Offense stat vs defense counter stat (STL or slot 3 BLK)
- **Rebound phase**: On miss, show rebound animation/log. Weighted slot pick → both rebounders roll → winner gets possession
- **Badge integration**: Before resolving rolls, check if shooter/defender has relevant badges from `player_card_badges` table. Apply badge modifiers (reroll, stat boost) based on badge tier

### 3. Badge Integration
- Fetch badges for all 6 cards (3 player + 3 CPU) via `player_card_badges` joined with `badges` at lineup confirmation time
- During shot resolution, check if the shooter has a badge with `affected_stat` matching the chosen stat
- During defense, check if defender has a badge affecting STL or BLK
- Apply badge effects per their `effect_type` (e.g., reroll = roll again and take better result)

### 4. UI Terminology
- "Attack" → "Shoot"
- "Defend" → "Contest"
- "Your Attack" → "Your Possession"
- "CPU Attack" → "CPU Possession"
- Add card selector UI: 3 small card thumbnails the player taps to pick their shooter

### Files to modify
- **`src/lib/gameEngine.ts`** — Add defense stat mapping, rebound helpers, shot contest resolver
- **`src/components/game/RunGameBoard.tsx`** — Full rewrite of possession/roll/rebound logic and UI
- **`src/components/game/RunLineupSelect.tsx`** — Fetch badges for selected cards and pass them through

