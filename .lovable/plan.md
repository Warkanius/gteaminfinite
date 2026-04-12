
Goal: decouple Gem Tier from Gem Market, make Domination reward packs editable per game, swap the requested collection item for the missing rewards, and fix compound evo progress.

1. Separate Gem Tier from Gem Market
- Add a dedicated market-assignment table so market membership is no longer inferred from `player_cards.gem_tier_id`.
- Keep `player_cards.gem_tier_id` and `gem_name` for card tiering, visuals, and stat scaling only.
- Update Admin Gem Market to create/remove market assignments instead of editing the player’s base gem tier.
- Update the Gem Market page and gem purchase backend to read availability, grouping, and pricing from market assignments.
- Preserve the current visible market during migration so the storefront does not go blank, but future tier edits will no longer auto-list cards.

2. Make reward packs truly editable per pack/game
- Change pack odds from `pack_type`-based to pack-specific so every pack can have its own odds table.
- Update pack opening logic to use the selected pack’s own odds/content first, with legacy fallback only where old data still exists.
- Remove the admin restriction that hides odds editing for reward packs.
- Fix Domination reward selection so it stores a real pack ID, shows the pack name, and can jump straight to managing that pack’s contents/odds.
- Audit existing Domination reward values and normalize any bad text values to real pack references.

3. Apply the requested collection/reward data fix
- Identify your signed-in account and verify the owned `Shrive M'Live` entry.
- Remove one owned copy from `user_collections`.
- Look up your Kaijo and Shutoku Domination wins, resolve their configured reward packs, and grant those two packs into your pack inventory so they can be opened normally.
- If those wins already granted something previously, I’ll still add the replacement packs you explicitly requested.

4. Fix compound evo tracking
- Audit compound progress storage versus display.
- Update the evo UI to show per-requirement compound progress from `compound_progress` instead of incorrectly comparing `current_value` to the step’s single `challenge_target`.
- Keep `current_value` as the summary count of completed requirements and use `completed`/`claimed` for claim logic.
- If implementation shows any tracker-side bug in `trackCompoundProgress`, I’ll patch that too and verify with a real compound evo case.

Technical details
- Likely database work:
  - new market-assignment table with admin-write/authenticated-read RLS
  - pack-odds migration to pack-specific records
  - normalization of Domination reward references to real packs
- Main files likely affected:
  - `src/pages/admin/AdminGemMarket.tsx`
  - `src/pages/GemMarket.tsx`
  - `supabase/functions/buy-gem-card/index.ts`
  - `src/pages/admin/AdminPacks.tsx`
  - `src/pages/admin/AdminTeams.tsx`
  - `supabase/functions/open-pack/index.ts`
  - `src/components/cards/CardDetailDialog.tsx`
  - `src/lib/evoProgressTracker.ts`

Why this plan
- The current market bug exists because `gem_tier_id` is still doing two jobs.
- Reward packs are currently blocked by a pack-type odds model and a Domination selector that saves the wrong value shape.
- Compound evos are at least rendered incorrectly today, even if some progress is being stored underneath.