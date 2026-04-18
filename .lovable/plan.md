

## Goal
1. Remove the "Stat Boosts" feature entirely from evolution path management (admin player creation + pack quick edit + anywhere else it appears).
2. Ensure only **original** (non-evolved) cards appear in pack pools — evo versions stay in the DB but are excluded from pack player pickers/admin pack rosters.

## Investigation needed
Let me verify the exact code paths.

- `src/components/admin/EvoPathEditor.tsx` — has `stat_boosts` UI/state
- `src/lib/evoProgressTracker.ts` — applies stat boosts at evolution time
- `src/pages/admin/AdminPacks.tsx` — player picker for packs
- `src/pages/admin/AdminPlayers.tsx` — uses EvoPathEditor; also creates evo versions

An "original" card = a `player_cards` row that is NOT referenced by any `evo_paths.evolves_to_card_id`. That's the cleanest way to identify originals without a schema change.

## Plan

### Part 1 — Remove Stat Boosts everywhere

**`src/components/admin/EvoPathEditor.tsx`**
- Remove the entire "Stat Boosts" section (the 9-stat grid editor per step).
- Remove `stat_boosts` from the local step state shape, default values, and the `onStepsChange` payload.
- Keep the column in `evo_paths` (no migration); just always write `{}`.

**`src/lib/evoProgressTracker.ts`** (and any consumers)
- Remove the code path that reads `evo_paths.stat_boosts` and applies them to the player when an evolution completes. Evolution will now rely solely on `evolves_to_card_id` swap.
- Verify nothing else depends on `stat_boosts`.

**`src/components/admin/PlayerQuickEdit.tsx`**
- Already uses `EvoPathEditor`, so it inherits the removal. No extra change needed beyond confirming.

**`src/pages/admin/AdminPlayers.tsx`**
- Same — inherits removal via `EvoPathEditor`.

### Part 2 — Exclude evo versions from pack pools

**`src/pages/admin/AdminPacks.tsx`**
- In the query that lists selectable players for a pack (e.g. `pack-players-picker` / `admin-all-players-lite` usage in pack context), filter out any `player_card.id` that appears in `evo_paths.evolves_to_card_id`.
- Approach: fetch the set of `evolves_to_card_id` (non-null) once via `useQuery`, then `.filter()` the player list client-side. Lightweight — same dataset is already loaded.
- Apply the same filter to the **starter pack** picker (`AdminStarterPacks.tsx`) and any other "pick a card to put in a pack" UI: search for usages of `pack_players` insertions.

**Out of scope**
- Does not touch `team_players`, `domination_game_players`, `run_players`, `auction_listings`, or `gem_market_listings` — user only asked about packs.
- Does not delete existing `pack_players` rows that already point at evo versions; we'll surface a one-time admin warning in the pack editor if any current pack contains an evo card (badge "Evo version — won't display in pool" next to the row), but won't auto-delete.

### Files to update

| File | Change |
|---|---|
| `src/components/admin/EvoPathEditor.tsx` | Remove Stat Boosts UI + state + payload |
| `src/lib/evoProgressTracker.ts` | Remove stat-boost application at evolution time |
| `src/pages/admin/AdminPacks.tsx` | Filter evo cards out of pack player picker; warn on existing evo rows |
| `src/pages/admin/AdminStarterPacks.tsx` | Same filter for starter pack picker |

### Not changed
- DB schema (column stays, ignored).
- Other admin tools, gameplay, public-facing pages.

