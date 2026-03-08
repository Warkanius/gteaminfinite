

# Expand Domination Roads + Add RTTR Pack Rewards

## Current State
- 6 games per road (12 total), only final games have Team Dom Pack reward
- RTTR Pack (`7feeb04c...`) exists but is unassigned

## What the Document Shows
Each road should have **11 games**, with **every game** awarding a pack. Games 1-7 award **Team Dom Pack**, games 8-11 award **RTTR Pack**.

### LFO High School
| # | Opponent | Coins | Pack |
|---|----------|-------|------|
| 1 | Ringgold I | 750 | Team Dom Pack |
| 2 | Heritage I | 750 | Team Dom Pack |
| 3 | McCallie I | 1000 | Team Dom Pack |
| 4 | Hamilton Heights I | 1000 | Team Dom Pack |
| 5 | Ringgold II | 1000 | Team Dom Pack |
| 6 | Heritage II | 1000 | Team Dom Pack |
| 7 | Brainerd '84 | 1000 | Team Dom Pack |
| 8 | McCallie II | 2000 | RTTR Pack |
| 9 | Hamilton Heights II | 2000 | RTTR Pack |
| 10 | Brainerd '84 II | 2000 | RTTR Pack |
| 11 | Georgia Stars | 4000 | RTTR Pack |

### Seirin High
| # | Opponent | Coins | Pack |
|---|----------|-------|------|
| 1 | Kaijo I | 750 | Team Dom Pack |
| 2 | Shutoku I | 750 | Team Dom Pack |
| 3 | Toō I | 1000 | Team Dom Pack |
| 4 | Yosen I | 1000 | Team Dom Pack |
| 5 | Shutoku II | 1000 | Team Dom Pack |
| 6 | Kaijo II | 1000 | Team Dom Pack |
| 7 | Rakuzan | 1000 | Team Dom Pack |
| 8 | Toō II | 2000 | RTTR Pack |
| 9 | Yosen II | 2000 | RTTR Pack |
| 10 | Rakuzan II | 2000 | RTTR Pack |
| 11 | Generation of Miracles | 4000 | RTTR Pack |

Difficulty stars: roughly 1★ for game 1, scaling up to 5★ for game 11 (matching the `*`/`**`/`***` markers).

## Changes

### 1. Update existing 12 domination games
Use data update tool to rename opponents, adjust coin rewards, and assign pack rewards to match the document for games 1-6 of each road.

### 2. Insert 10 new games
Add games 7-11 for each road (5 new games per road) with correct opponents, coin rewards, difficulty stars, and pack rewards (Team Dom Pack for game 7, RTTR Pack for games 8-11).

### 3. No code changes needed
`Domination.tsx`, `Play.tsx`, and `GameResults.tsx` already handle `pack_reward` correctly — the reward flow triggers for any game with a non-null `pack_reward`.

