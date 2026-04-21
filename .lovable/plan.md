
## Goal
Implement the requested bundle with the revised behavior:

1. Copying a team also copies its roster.
2. Evo requirement text auto-fills for single requirements too.
3. RTTR reward games become a separate replay flow inside Domination, and replaying them still follows road order.
4. Add an admin-friendly Dynamic Duo system with custom per-player stat boosts.
5. Make evo versions count as the same card for Gem Market unlock progress.

## What to build

### 1) Team duplication should copy the roster
Current issue:
- In `src/pages/admin/AdminTeams.tsx`, Duplicate only opens a copied team form and creates a blank team.

Implementation:
- Add `duplicateSourceTeamId` state.
- When Duplicate is clicked, store the source team id alongside the copied name/category.
- In `teamSave`, after inserting the new `teams` row, read the source `team_players` rows and insert cloned rows with the new `team_id`, preserving `player_card_id` and `slot`.
- Clear duplication state on save/cancel.
- Invalidate `["admin-teams"]` and `["admin-team-players"]`.

### 2) Evo description auto-fill should work for single requirements
Current issue:
- `src/components/admin/EvoPathEditor.tsx` auto-regenerates description text for compound requirements only.

Implementation:
- Extend the same “replace only if empty or still auto-generated” logic to single-step fields.
- When `challenge_type`, `challenge_stat`, or `challenge_target` changes:
  - compute the previous auto text with `describeChallenge(...)`
  - if the current `challenge_description` is empty or still equals that prior auto text, replace it with the new generated text
  - preserve custom manual descriptions
- Keep this in the shared step update path so it works in player admin, quick edit, and any other evo editor usage.

### 3) RTTR should behave like a separate sub-mode inside Domination
Requested behavior:
- RTTR reward games should only become replayable after finishing the road.
- Replay should still be sequential, not “pick any cleared RTTR node”.
- It should feel like a distinct mode nested inside Domination.

Implementation in `src/pages/Domination.tsx`:
- Load pack metadata for `pack_reward` ids so RTTR packs can be identified by `packs.pack_type === "rttr"`.
- Keep the existing first-clear Domination progression exactly as-is.
- For each road, derive:
  - `roadCompleted`: every node beaten once
  - `rttrNodes`: beaten nodes on that road whose reward pack is RTTR
- Add a mode switch in the selected-road view:
  - `Domination` (default)
  - `Road to the Ring` (only shown/enabled once the road is complete and the road has RTTR reward nodes)
- In Domination mode:
  - unchanged progression UI
  - beaten nodes show Won
  - unbeaten nodes unlock only if the previous node has been beaten
- In RTTR mode:
  - show only the RTTR-eligible nodes from that same road
  - enforce replay order using the road sequence:
    - first RTTR replay node is always available once the road is cleared
    - later RTTR replay nodes unlock only after the previous RTTR node in road order has been replay-won at least once
- Store RTTR replay progress separately from first-clear Domination progress so the two loops don’t interfere.

Backend change:
- Add a new table for RTTR replay progress, e.g. `user_rttr_progress`:
  - `id`
  - `user_id`
  - `road_name`
  - `domination_game_id`
  - `wins`
  - timestamps
- RLS:
  - authenticated users can read/insert/update only their own rows
- On game completion for RTTR replays, write to this table instead of reusing base Domination unlock logic.

Code flow updates:
- `src/pages/Play.tsx`: pass a mode flag like `dominationVariant: "base" | "rttr"` into the match state.
- `src/components/game/GameResults.tsx`:
  - continue logging games normally
  - when in RTTR variant, still grant the pack reward, but record the replay win in `user_rttr_progress`
  - keep “Back to Domination” navigation

### 4) Dynamic Duo should be admin-friendly
Goal:
- Admins can manage pairs without technical friction.
- Duos are defined in admin, readable in gameplay, and applied automatically if both cards are in the same lineup.

Backend:
Create a new table, e.g. `dynamic_duos`:
- `id`
- `name`
- `description`
- `player_card_id_a`
- `player_card_id_b`
- `boosts_a` jsonb
- `boosts_b` jsonb
- `is_active` boolean default true
- timestamps

RLS:
- admins full access
- authenticated read access

Admin UI:
Create `src/pages/admin/AdminDynamicDuos.tsx` and add route/sidebar entry.
Make it admin-friendly by using the same editing style as the existing admin pages:
- searchable list/table of duos
- add/edit dialog using player comboboxes
- separate stat editors for Player A boosts and Player B boosts
- simple per-stat numeric inputs for the 9 gameplay stats
- active/inactive toggle
- validation:
  - prevent same card on both sides
  - prevent duplicate mirrored pairs (A+B equals B+A)
- helpful display:
  - show both player names
  - show total boost summary
  - allow duplicate/copy existing duo definitions for fast setup

Gameplay integration:
- Fetch all active duos once lineups are finalized.
- Build a `duoBoostMap` for both user and CPU lineups.
- Apply boosts before traits/badges so duo bonuses act like temporary lineup-based base-stat buffs.

Files:
- `src/components/game/LineupSelect.tsx`
- `src/components/game/RunLineupSelect.tsx`
- `src/pages/Play.tsx`
- `src/pages/RunPlay.tsx`
- `src/components/game/GameBoard.tsx`
- `src/components/game/RunGameBoard.tsx`

Data flow:
- Lineup selection computes active duo definitions for the chosen lineup and passes:
  - `userDuoBoostMap`
  - `cpuDuoBoostMap`
  - `activeDuoSummary`
- Game boards add the relevant duo boost to the current stat before trait/badge resolution.
- Show activation messaging so players can tell a duo is live.

Stacking rule:
- One active duo per card at a time.
- If multiple definitions could match the same card, keep the first valid pair consistently and ignore additional overlaps. This avoids runaway stacking and keeps admin expectations simple.

### 5) Evo versions should count as the same card for Gem Market unlocking
Current issue:
- `src/pages/GemMarket.tsx` and `supabase/functions/buy-gem-card/index.ts` check ownership by exact `player_card_id`, so owning an evolved version does not count toward Gem Market progression.

Implementation:
Reuse the same evo-chain concept already present in `src/pages/Collection.tsx`.

Frontend (`src/pages/GemMarket.tsx`):
- Load evo links from `evo_paths`.
- Build `chainRootOf` for cards in the market.
- Convert owned cards into `ownedChainRoots` instead of exact owned ids.
- Update:
  - tier progress counts
  - tier unlock checks
  - Owned badge/checkmark display
- Rule:
  - if the user owns any card in the same evo chain, that market slot counts as owned.

Backend (`supabase/functions/buy-gem-card/index.ts`):
- Before checking duplicate ownership or previous-tier unlock counts:
  - load evo links
  - resolve each market card to its root/base chain id
  - resolve the user’s owned collection to owned chain roots
- Use chain-root logic for:
  - “You already own this card”
  - previous tier 50% unlock checks
- This keeps server-side enforcement aligned with the UI.

## Files likely touched

### Existing
- `src/pages/admin/AdminTeams.tsx`
- `src/components/admin/EvoPathEditor.tsx`
- `src/pages/Domination.tsx`
- `src/pages/Play.tsx`
- `src/components/game/GameResults.tsx`
- `src/pages/GemMarket.tsx`
- `src/components/game/LineupSelect.tsx`
- `src/components/game/GameBoard.tsx`
- `src/components/game/RunLineupSelect.tsx`
- `src/components/game/RunGameBoard.tsx`
- `src/pages/RunPlay.tsx`
- `src/App.tsx`
- `src/components/AppSidebar.tsx`
- `supabase/functions/buy-gem-card/index.ts`

### New
- `src/pages/admin/AdminDynamicDuos.tsx`
- database migration for `dynamic_duos`
- database migration for `user_rttr_progress`

## Technical notes
- No schema change is needed for the evo autofill fix or team copy fix.
- Dynamic Duo and RTTR replay sequencing both need backend tables.
- RTTR replay progress should be separate from first-clear domination wins so replay order can exist without breaking the main Domination road.
- Gem Market ownership logic should follow the chain-root pattern already used in Collection to avoid inconsistent behavior.

## Validation
1. Duplicating a team creates a new team with the same roster.
2. Single evo requirements auto-update their text unless an admin has manually customized it.
3. A finished road exposes an RTTR tab/mode only when applicable.
4. RTTR replays must still be completed in sequence within that road.
5. RTTR wins grant rewards without disturbing first-clear Domination completion.
6. Admins can create, edit, search, and disable Dynamic Duos comfortably.
7. A configured duo activates in 5v5 and Runs and changes gameplay stats.
8. Owning an evo version counts for Gem Market owned state and tier unlock progress.
