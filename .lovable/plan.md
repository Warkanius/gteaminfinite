

# Game Engine v2: NBA-Style Scoring + Lifetime Stat Tracking

## Scoring Rules (confirmed)
- **3PT**: `dice_result * star_modifier` * **3 points**
- **MID, FIN, DNK**: `dice_result * star_modifier` * **2 points**
- **INT**: `dice_result * star_modifier` * **1 point**
- **AST, STL, REB, BLK**: Same roll formula, tracked but **0 points** toward score
- **Dice count**: 1 die if stars < 4 (modifier < 2x); 2 dice if stars >= 4 (modifier >= 2x). Doubles bonus (3x) at 5 stars when both dice match.
- Winner = team with more total points scored

## Database Changes

### New table: `card_game_stats`
Stores per-card, per-game stat results for lifetime tracking and evolution.

```
card_game_stats:
  id (uuid PK)
  game_log_id (uuid FK -> game_logs.id)
  user_id (uuid, for RLS)
  player_card_id (uuid FK -> player_cards.id)
  side (text: 'user' | 'cpu')
  stat_3pt, stat_mid, stat_fin, stat_dnk, stat_ast, stat_stl, stat_reb, stat_blk, stat_int (numeric each — rolled result value)
  points_scored (numeric — total points this card contributed)
  created_at (timestamptz)
```

RLS: users read/insert own rows (`auth.uid() = user_id`).

### New table: `domination_game_players`
Links player_cards to domination_games as CPU opponents.

```
domination_game_players:
  id (uuid PK)
  domination_game_id (uuid FK -> domination_games.id)
  player_card_id (uuid FK -> player_cards.id)
  slot (integer 1-5)
```

RLS: readable by authenticated, admin manages.

## Code Changes

### `src/lib/gameEngine.ts` (New)
Core scoring logic extracted into pure functions:
- `getStarModifier(stars: number): number` — 0→0, 1→0.5, 2→1, 3→1.5, 4→2, 5→2.5
- `getDiceCount(stars: number): 1 | 2` — returns 2 if stars >= 4
- `rollStat(stars: number): { dice: number[], rawResult: number, isDoubles: boolean }` — rolls appropriate dice count, applies modifier (3x on doubles for 5-star)
- `getPointMultiplier(stat: string): number` — 3PT→3, MID/FIN/DNK→2, INT→1, others→0
- `calculatePoints(stat: string, rollResult: number): number` — `rollResult * pointMultiplier`
- `rollAllStats(card, gemTier)` — rolls all 9 stats, returns per-stat breakdown + total points

### `src/pages/Play.tsx` (Edit)
- Update `GameCard` interface (no changes needed, already has all stats)
- Update `RoundLog` to a new `GameStatLog` type that captures per-card, per-stat detail
- Add new aggregate types for the full game result

### `src/components/game/GameBoard.tsx` (Rewrite)
Complete overhaul of game flow:
- **State**: Track current player index (0-4), current stat index (0-8), and accumulated results
- **Flow**: For each of 5 players, iterate through all 9 stats. Show current player matchup, current stat, and roll.
- **Auto-roll mode**: "Roll" button triggers animated dice for current stat, auto-advances to next stat after brief delay
- **Manual mode**: DiceInput for 1 or 2 dice depending on star rating
- **Running score**: Display running point totals for both teams
- **After all 45 rolls**: Call onComplete with full stat logs and final scores

### `src/components/game/DiceRoll.tsx` (Edit)
- Support displaying 1 or 2 dice based on star rating
- Show both dice values when 2 dice are used, highlight doubles

### `src/components/game/DiceInput.tsx` (Edit)
- Accept `diceCount: 1 | 2` prop
- Show 1 or 2 input fields accordingly for user's roll, plus same for CPU

### `src/components/game/RoundResult.tsx` (Edit)
- Adapt to show per-stat result with point value breakdown (e.g., "3PT: 4 * 2x = 8 * 3 = 24 pts")

### `src/components/game/GameResults.tsx` (Edit)
- Show final score as actual basketball-style points (not win count)
- Per-player stat box scores showing all 9 stats rolled
- Save `card_game_stats` rows for each card
- Update `user_collections.evolution_progress` for relevant stats

### `src/components/game/LineupSelect.tsx` (Edit)
- For now, keep random CPU selection (domination integration comes later once admin populates `domination_game_players`)

## Implementation Order
1. Database migration (2 new tables)
2. `gameEngine.ts` pure logic
3. `GameBoard.tsx` rewrite with new flow
4. Updated `DiceRoll`, `DiceInput`, `RoundResult` components
5. `GameResults.tsx` with stat saving and box score display
6. Update `Play.tsx` types

