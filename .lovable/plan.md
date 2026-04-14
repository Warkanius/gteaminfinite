

# Fix Challenge Rewards, Add Non-Repeatable/Expiring Challenges & Interactive Rerolls

## Issues

1. **Pack reward not granted**: `Play.tsx` passes `packReward` to `GameResults`, and that flow works — but `gemReward`, `cardRewardId`, and `challengeId` are never passed, so gem and card rewards are silently lost. The user completed a challenge expecting a pack reward; need to verify the challenge's `pack_reward` value is a valid pack UUID.

2. **No challenge completion tracking**: No mechanism to mark challenges as done or prevent replays.

3. **Rerolls always produce 6s**: The `applyRerolls` function (badgeEngine.ts) rolls N extra times and keeps the best. With 3 rerolls on 1d6, the expected max is ~5.24. This needs to become interactive — player sees both rolls and picks one.

## Plan

### Migration
- Add `is_repeatable` (boolean, default true) and `expires_at` (timestamptz, nullable) to `challenges`
- Create `challenge_completions` table (user_id, challenge_id, completed_at) with unique constraint and RLS

### GameResults.tsx
- Accept new props: `gemReward`, `cardRewardId`, `challengeId`
- On win: grant gems (update `profiles.gems`), grant card reward (insert into `user_collections`), record `challenge_completions` entry
- All rewards already handled: coins, packs — just add the missing gem/card/completion logic

### Play.tsx
- Pass `gemReward`, `cardRewardId`, `challengeId` from `gameState` to `GameResults`

### Challenges.tsx
- Fetch user's `challenge_completions`
- Hide or show "Completed" badge on non-repeatable finished challenges, disable Play button
- Filter out expired challenges (`expires_at < now()`)

### AdminChallenges.tsx
- Add `is_repeatable` toggle and `expires_at` date picker to the challenge form

### Interactive Reroll System
- **badgeEngine.ts**: Split `applyRerolls` into two functions:
  - `getPendingReroll(stat, originalDice, badges)` — returns the reroll dice (or null if no reroll badge)
  - `resolveRerollChoice(originalDice, rerollDice, keepReroll: boolean)` — returns chosen dice
  - CPU auto-resolves by keeping best
- **GameBoard.tsx**: Add a `"reroll"` phase between dice roll and result. After rolling, check if user card has a reroll badge for the current stat. If yes, show the `RerollChoice` component before proceeding.
- **New: RerollChoice.tsx**: Shows original roll vs reroll side by side, player taps to pick one. Timer or simple two-button UI.

### Files Changed

| File | Change |
|---|---|
| Migration | `is_repeatable`, `expires_at` on challenges; `challenge_completions` table |
| `src/components/game/GameResults.tsx` | Accept + handle `gemReward`, `cardRewardId`, `challengeId` |
| `src/pages/Play.tsx` | Pass missing props to GameResults |
| `src/pages/Challenges.tsx` | Fetch completions, filter expired, disable completed non-repeatable |
| `src/pages/admin/AdminChallenges.tsx` | Add repeatable toggle + expiration picker |
| `src/lib/badgeEngine.ts` | Split reroll into interactive check + resolve functions |
| `src/components/game/GameBoard.tsx` | Add reroll phase between dice and result |
| New: `src/components/game/RerollChoice.tsx` | UI for comparing original vs reroll dice |

