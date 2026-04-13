

# Rank Reward Ladder — Coin & Pack Focused

## Approach

No new DB tables. Use a new `run_rank_rewards` table seeded with all 25 ranks, each with coin/gem/pack rewards. Admins can edit rewards via a clean editor in the Admin Teams page. Rewards auto-grant on rank-up in `RunGameBoard`.

## Default Reward Seeding

Coin-heavy with packs at key rank-ups. Gems are sparse.

| Rank | Wins | Coins | Gems | Pack |
|------|------|-------|------|------|
| Nobody I | 1 | 100 | 0 | — |
| Nobody II | 5 | 250 | 0 | — |
| Nobody III | 10 | 500 | 0 | — |
| Nobody IV | 15 | 1,000 | 0 | — |
| Nobody V | 20 | 2,000 | 0 | — |
| Regular I | 25 | 2,500 | 0 | Random Pack |
| Regular II | 35 | 3,000 | 0 | — |
| Regular III | 45 | 3,500 | 0 | — |
| Regular IV | 55 | 4,000 | 0 | — |
| Regular V | 65 | 5,000 | 5 | Random Pack |
| Hooper I | 75 | 6,000 | 0 | — |
| Hooper II | 90 | 7,000 | 0 | — |
| Hooper III | 105 | 8,000 | 0 | Random Pack |
| Hooper IV | 120 | 9,000 | 0 | — |
| Hooper V | 135 | 10,000 | 10 | Random Pack |
| Top Pick I | 150 | 12,000 | 0 | Random Box |
| Top Pick II | 170 | 14,000 | 0 | — |
| Top Pick III | 190 | 16,000 | 0 | Random Pack |
| Top Pick IV | 210 | 18,000 | 0 | — |
| Top Pick V | 230 | 20,000 | 15 | Random Box |
| Legend I | 250 | 25,000 | 0 | Random Box |
| Legend II | 350 | 30,000 | 0 | Random Pack |
| Legend III | 500 | 40,000 | 20 | Random Box |
| Legend IV | 725 | 50,000 | 0 | Random Box |
| Legend V | 1000 | 75,000 | 25 | Random Box |

## Implementation

### 1. DB Migration
- Create `run_rank_rewards` table: `id`, `rank_name` (unique), `wins_required`, `coin_reward`, `gem_reward`, `pack_reward` (text: `""`, `"random_standard"`, `"random_standard_box"`, or pack ID), `sort_order`
- Create `user_rank_claims` table: `id`, `user_id`, `rank_name`, `claimed_at`, with `UNIQUE(user_id, rank_name)` to prevent double-granting
- Seed all 25 rows with the defaults above
- RLS: readable by authenticated, admin-managed, users insert/read own claims

### 2. Admin Rank Reward Editor (`RankRewardEditor.tsx`)
- Fixed 25 rows (no add/remove) in a clean table format
- Each row: rank name (read-only), wins (read-only), coin input, gem input, pack dropdown (None / Random Pack / Random Box / specific packs)
- Batch save button
- Integrated into AdminTeams page as a new tab/section

### 3. Grant Rewards on Rank-Up (`RunGameBoard.tsx`)
- After updating `highest_wins`, compare old vs new highest
- Query `run_rank_rewards` for ranks between old and new thresholds
- Check `user_rank_claims` to skip already-claimed ranks
- Grant coins/gems, add packs/boxes to `user_pack_inventory`
- Insert claim records
- Show rank-up toast with reward summary

### 4. MilestoneEditor Update
- Add `"random_standard_box"` option (🎲 Random Box) to the pack dropdown

## Files

| File | Change |
|------|--------|
| DB migration | Create `run_rank_rewards` + seed, create `user_rank_claims` |
| `src/components/admin/RankRewardEditor.tsx` | New: fixed-row reward table |
| `src/components/admin/MilestoneEditor.tsx` | Add Random Box option |
| `src/components/game/RunGameBoard.tsx` | Rank-up detection + reward granting |
| `src/pages/admin/AdminTeams.tsx` | Integrate RankRewardEditor |

