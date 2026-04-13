

# Challenge System Overhaul

## Overview

Replace the raw JSON editor in AdminChallenges with a structured, admin-friendly form. Add new columns to the `challenges` table for win conditions, opponents, rewards, prerequisites, series per-game payouts, and spotlight grouping.

## Key Addition: Series Per-Game Rewards

For series challenges (best-of-3/5/7), the challenge stores **per-game win coins** and **per-game loss coins** in addition to the main completion reward. Players earn coins for every individual game within the series, with wins paying more than losses.

## DB Migration — ALTER `challenges`

Add these columns:

| Column | Type | Default | Purpose |
|---|---|---|---|
| `opponent_team_id` | uuid, nullable | null | Team to play against |
| `win_condition` | text | `'win'` | `win`, `win_by`, `series`, `stat_limit` |
| `win_by_amount` | int, nullable | null | "Beat by X points" |
| `series_length` | int, nullable | null | 3, 5, or 7 |
| `series_win_coins` | int | 0 | Coins earned per win in a series game |
| `series_loss_coins` | int | 0 | Coins earned per loss in a series game |
| `stat_limit_player_id` | uuid, nullable | null | Player to hold to a stat |
| `stat_limit_stat` | text, nullable | null | Which stat (e.g. `blk`) |
| `stat_limit_value` | int, nullable | null | Max stat value allowed |
| `pack_reward` | text, nullable | null | Pack ID, `random_standard`, or `random_standard_box` |
| `card_reward_id` | uuid, nullable | null | Specific player card reward |
| `prerequisite_id` | uuid, nullable | null | Challenge that must be completed first |
| `spotlight_group` | text, nullable | null | Groups challenges into a spotlight series |
| `sort_order` | int | 0 | Order within a spotlight group |

## Admin UI Rebuild (`AdminChallenges.tsx`)

Replace JSON editor with structured form sections:

1. **Basic Info** — Name, Description, Type dropdown (`single` / `spotlight`), Spotlight group + sort order (conditional)
2. **Opponent** — Team selector dropdown (fetched from `teams` table)
3. **Win Condition** — Dropdown with 4 options, each showing conditional fields:
   - **Win** — just beat the team
   - **Win by X** — shows point margin input
   - **Series (best of N)** — shows series length dropdown (3/5/7) + per-game win coins + per-game loss coins
   - **Stat Limit + Win** — shows player combobox + stat dropdown + max value input
4. **Prerequisite** — Challenge selector (dropdown of other challenges)
5. **Completion Rewards** — Coins, Gems, Pack dropdown (None/Random Pack/Random Box/specific), Player Card combobox

## Data Table Improvements

Show columns: Name, Type, Win Condition (formatted), Rewards summary, Prerequisite name.

## Files Changed

| File | Change |
|---|---|
| DB migration | ALTER `challenges` — add 14 new columns |
| `src/pages/admin/AdminChallenges.tsx` | Full rebuild with structured form, conditional fields, team/player/challenge selectors |

No new component files — reuses existing `PlayerCombobox`, `Select`, `Input`, `Label`.

