

## Bug confirmed (Domination roster mismatch)

**Root cause**: Race condition in `LineupSelect.tsx` `handleStart`. When a user clicks "Start Game" on a domination match before `domCpuLineup` finishes loading, the code falls through to the **random CPU branch** because the `dominationGameId && domCpuLineup && domCpuLineup.length > 0` guard fails when `domCpuLineup` is `undefined`. It then pulls 5 random players from the cached `allCards` query (cached from any prior 5v5 visit) — which is how the user ended up with Akashi/Hayama/Mibuchi/Nebuya/Mayuzumi in a "Shutoku" game. The match is then logged as Shutoku because the opponent name comes from props, not from the actual CPU cards.

**Verified in DB**: Most recent Shutoku game (`a0707a78`, game_order 5) has Midorima/Takao/Otsobo/Miyaji/Kimura assigned in `domination_game_players`, but the `game_logs.player_stats` for that match shows the Rakuzan roster as the CPU side.

## Fix

### `src/components/game/LineupSelect.tsx`
1. **Block the Start button until the right CPU lineup has loaded**:
   - When `dominationGameId` is set, disable Start until `domCpuLineup !== undefined`.
   - When `challengeTeamId` is set, disable Start until `challengeCpuLineup !== undefined`.
   - Add a small "Loading opponent…" hint next to the button while waiting.
2. **Hard-fail in `handleStart` instead of silently falling through**:
   - If `dominationGameId` is set but `domCpuLineup` is empty/undefined, show a toast (`"Opponent roster not ready — try again in a moment"`) and return. Same for challenge.
   - Random-CPU branch should only run when neither `dominationGameId` nor `challengeTeamId` is set.
3. **Disable the cached random pool from leaking in**:
   - Add `dominationGameId/challengeTeamId` into the `allCards` query key, or skip even reading it when those are set. Cleanest: keep `enabled: !dominationGameId && !challengeTeamId` and rewrite the random branch behind an explicit `else if (!dominationGameId && !challengeTeamId)` guard.

### `src/pages/Play.tsx` (defensive)
- If `location.state` is missing entirely (page refresh on `/play/match`), redirect to `/domination` or show "Pick a game first" instead of starting an unconfigured 5v5.

### Out of scope
- Empty Rakuzan slot at game_order 7 (separate admin cleanup — flag in chat).
- Duplicate Takao handling (next pass, per your "Domination first" choice).

## Files touched

| File | Change |
|---|---|
| `src/components/game/LineupSelect.tsx` | Disable Start while expected CPU lineup is loading; fail loudly instead of falling through to random; only run random branch when no dominationGameId/challengeTeamId |
| `src/pages/Play.tsx` | Bail out if `location.state` is missing on `/play/match` |

