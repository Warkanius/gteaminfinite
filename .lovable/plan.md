

# Fix Domination Repeat Opponents

## Problem
Domination tracks wins by `opponent_name` only (via `game_logs` table). When the same opponent appears multiple times at different difficulties (e.g., Kaijo at game 1 and game 6), winning game 1 marks both as completed.

## Root Cause
- `Domination.tsx` queries `game_logs` for `opponent_name` where `won = true`
- Uses a `Set<string>` of opponent names to check completion
- No way to distinguish Kaijo (game 1, 1★) from Kaijo (game 6, 3★)

## Solution
Track wins by `domination_game_id` instead of `opponent_name`.

### 1. Add `domination_game_id` column to `game_logs`
- New nullable UUID column referencing `domination_games(id)`
- Nullable so non-domination game logs aren't affected

### 2. Update `GameResults.tsx`
- Accept `dominationGameId` prop and insert it into `game_logs` when saving

### 3. Update `Domination.tsx`
- Query wins as `domination_game_id` instead of `opponent_name`
- Build `wonSet` as `Set<string>` of game IDs
- Check `wonSet.has(game.id)` instead of `wonSet.has(game.opponent_name)`
- `isUnlocked` checks `wonSet.has(road[index - 1].id)` instead of opponent name

### 4. Update `Play.tsx` / match routing
- Pass `dominationGameId` through to `GameResults` from the navigation state

### Files Changed
| File | Change |
|---|---|
| Migration | `ALTER TABLE game_logs ADD COLUMN domination_game_id UUID REFERENCES domination_games(id)` |
| `src/components/game/GameResults.tsx` | Accept + insert `dominationGameId` |
| `src/pages/Domination.tsx` | Query by `domination_game_id`, check unlocks by game ID |
| `src/pages/Play.tsx` | Pass `dominationGameId` to GameResults |

