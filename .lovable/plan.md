

# Phase 2: Admin Panel — Full Game Customization

## Overview
Build out all 7 admin pages replacing the current placeholder stubs. Each page provides full CRUD (create, read, update, delete) for its game data, accessible only to users with the admin role.

---

## 1. Admin Player Card Manager (`/admin/players`)
**File:** `src/pages/admin/AdminPlayers.tsx`

- Data table listing all player cards with columns: Name, Rating, Gem Tier, Position, Team
- Filter/search bar by name, gem tier, position
- "Add Player" button opens a dialog/drawer form with:
  - Name, Position 1, Position 2
  - 9 stat sliders or number inputs (3PT, MID, FIN, DNK, AST, STL, REB, BLK, INT)
  - Gem tier dropdown (fetched from `gem_tiers` table)
  - Team dropdown (fetched from `teams` table)
  - Collection reward toggle
  - Auto-calculated overall rating displayed live
- Edit button on each row opens the same form pre-filled
- Delete with confirmation dialog
- **Badges & Traits sub-section** on each player form:
  - Multi-select badges from `badges` table, each with a tier dropdown (Base/Gold/Diamond/HOF/Actolytrene)
  - Multi-select traits from `signature_traits` table, each with tier + optional target stat
  - Saves to `player_card_badges` and `player_card_traits` join tables

## 2. Admin Packs & Odds Manager (`/admin/packs`)
**File:** `src/pages/admin/AdminPacks.tsx`

- List of all packs with name, type, cost, 10-box cost
- Add/Edit pack form: name, pack_type, cost, ten_box_cost
- **Pack Players tab**: assign player cards to pack slots (slot_number) via `pack_players` table
- **Odds Table tab**: manage `pack_odds` rows for this pack type — dice_roll range, result_slot, description
- Delete pack with cascade warning

## 3. Admin Teams & Runs (`/admin/teams`)
**File:** `src/pages/admin/AdminTeams.tsx`

- **Teams tab**: list all teams, add/edit (name, category, unlock_cost), assign player cards to team via `player_cards.team_id`
- **Domination tab**: list domination road games, add/edit (road_name, opponent_name, game_order, difficulty_stars, coin_reward, pack_reward)
- **Runs tab**: list runs, add/edit run names

## 4. Admin Badges & Traits (`/admin/badges`)
**File:** `src/pages/admin/AdminBadgesTraits.tsx`

- **Badges tab**: table of all badges with name, abbreviation, effect_type, affected_stat
  - Expand/edit to see all 5 tier descriptions (base, gold, diamond, hof, actolytrene)
- **Signature Traits tab**: table of all traits with name, abbreviation, condition_type
  - Expand/edit to see all 5 tier descriptions

## 5. Admin Challenges (`/admin/challenges`)
**File:** `src/pages/admin/AdminChallenges.tsx`

- List challenges with name, type, coin/gem rewards
- Add/edit form: name, description, challenge_type, coin_reward, gem_reward, conditions (JSON editor or structured form)

## 6. Admin Currencies (`/admin/currencies`)
**File:** `src/pages/admin/AdminCurrencies.tsx`

- View/edit player profiles' coin and gem balances (admin override)
- Summary stats: total coins/gems in circulation
- Manual award form: select user, add coins or gems

## 7. Admin Rules Config (`/admin/rules`)
**File:** `src/pages/admin/AdminRules.tsx`

- List all `rule_config` entries (key, value, description)
- Edit value (JSON editor) and description for each rule
- Add new rule config entries
- Covers: star conversion key, game mode settings, rating roll modifiers, doubles rules

---

## Shared Components

- **`src/components/admin/DataTable.tsx`** — Reusable sortable/filterable table component used across all admin pages
- **`src/components/admin/FormDialog.tsx`** — Reusable dialog wrapper for add/edit forms with save/cancel actions
- **`src/components/admin/StatInput.tsx`** — Number input with label, used for the 9 player stats
- **`src/components/admin/JsonEditor.tsx`** — Simple JSON textarea editor for conditions and rule values

## Routing Update
- Update `src/App.tsx` to import each admin page instead of `Placeholder` for admin routes

## Technical Details
- All data fetching via `@tanstack/react-query` with `supabase` client
- Mutations use `useMutation` with `queryClient.invalidateQueries` for optimistic UI
- No database schema changes needed — all tables and RLS policies already exist
- Admin-only access enforced by existing RLS policies (`has_role(auth.uid(), 'admin')`)
- Client-side role check in sidebar already hides admin nav for non-admins

