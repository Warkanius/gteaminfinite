

# Domination Pack Rewards

## What We're Building
When a player wins a domination game that has a `pack_reward`, automatically open that reward pack and show the card reveal screen before returning to results.

## Reference: Pack Odds (from screenshot)
The image confirms the odds tables for the two reward pack types:
- **Dom Pack Odds**: dice range 1-12, slots map to Top through 5th Rated Player
- **RTTR**: dice range 1-6, includes a "Player of Choice" slot

These odds are already stored in `pack_odds` table keyed by `pack_type`. No odds changes needed — just need to verify the data matches. The `open-pack` edge function already handles text-based slot resolution (ranking cards by rating).

## Changes

### 1. Database: Set `pack_reward` on final domination games
SQL migration to update the two final games (game_order 6 for each road) to reference the Team Dom Pack ID. The `pack_reward` column is text, so we store the pack UUID string.

### 2. `Domination.tsx`
Pass `packReward: game.pack_reward` in the route state when navigating to `/play`.

### 3. `Play.tsx`
- Add `packReward?: string` to `DominationState`
- Pass it through to `GameResults`

### 4. `GameResults.tsx`
- Accept new `packReward?: string` prop
- After saving a domination win, if `packReward` is set:
  - Call `supabase.functions.invoke("open-pack", { body: { pack_id: packReward, quantity: 1 } })`
  - Store pulled cards in state
  - Show `PackReveal` overlay with the reward cards
- The edge function already handles cost=0 packs (deducts 0 coins), so no backend function changes needed

### 5. No edge function changes
The `open-pack` function already:
- Supports cost=0 packs (deducts 0 coins)
- Uses text-based slot resolution (Top Rated Player, etc.) when no `pack_players` are assigned
- Works with the existing `pack_odds` table

