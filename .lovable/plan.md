

# Domination Mode: Seirin & LFO Paths

## Data Setup

Insert domination games and player assignments for both paths using the data insert tool.

### Seirin High Path (6 games, following KnB storyline progression)
| Order | Opponent | Difficulty | Coin Reward |
|-------|----------|-----------|-------------|
| 1 | Kaijo | 1★ | 50 |
| 2 | Shutoku | 2★ | 75 |
| 3 | Too | 3★ | 100 |
| 4 | Yosen | 3★ | 125 |
| 5 | Rakuzan | 4★ | 150 |
| 6 | Generation of Miracles | 5★ | 250 |

Each game gets 5 `domination_game_players` rows linking to the opponent team's existing player cards.

### LFO Path (6 games against real-world opponents)
Games created against Brainerd 84, Ringgold, Heritage, Georgia Stars, Hamilton Heights, McCallie with escalating difficulty. No player assignments yet (rosters empty — user will add via admin panel later).

## UI Changes

### New page: `src/pages/Domination.tsx`
- Fetches `domination_games` grouped by `road_name` (Seirin High, LFO High School)
- Shows two road paths as vertical timelines of games
- Each game shows: opponent name, difficulty stars, coin reward, lock/unlock state
- Games unlock sequentially — game N+1 locked until game N won (checked via `game_logs` where `opponent_name` matches and `won = true`)
- Clicking an unlocked game enters lineup select → game flow (reuses existing `LineupSelect` → `GameBoard` → `GameResults` pipeline)
- CPU lineup fetched from `domination_game_players` for the selected game (falls back to "no lineup available" message if empty)

### Edit `src/pages/Play.tsx`
- Accept optional `dominationGameId` and `opponentName` props/state (via route state or query param)
- When a domination game is active, `GameResults` awards that game's specific `coin_reward` instead of the flat 100
- Pass `opponent_name` to the `game_logs` insert

### Edit `src/components/game/LineupSelect.tsx`
- Accept optional `cpuLineup` prop — when provided (from domination), skip CPU random selection and use the fixed lineup
- Still show user's collection for their lineup pick

### Edit `src/components/game/GameResults.tsx`
- Accept optional `coinReward` and `opponentName` props to customize reward and log

### Routing
- Add `/domination` route in `App.tsx`
- Add "Domination" nav item in `AppSidebar.tsx` (between Play Game and Pack Market)
- Replace current "Play Game" `/play` with `/domination` as the main game entry point, or keep both

## Implementation Order
1. Insert domination_games rows for both paths (12 games total)
2. Insert domination_game_players for Seirin path opponents (30 rows: 6 games × 5 players)
3. Create `Domination.tsx` page with road map UI
4. Update `Play.tsx`, `LineupSelect.tsx`, `GameResults.tsx` to support domination context
5. Add route and sidebar nav

