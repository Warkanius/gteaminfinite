

# Badge Integration for Both Game Modes

## Current State
- Badges exist in DB with `affected_stat`, `effect_type`, and tiered descriptions
- `player_card_badges` links cards to badges with a `tier` (base/gold/diamond/hof/actolytrene)
- **Neither 5v5 nor The Runs currently use badges during gameplay** — they're display-only in the Collection view
- Badge effects from DB: `reroll` (Sniper, Eraser, Pickpocket, etc.), `bonus` (Limitless Range, Fade Ace), `debuff` (Lockdown, Intimidator), `cancel` (Art of F You), `passive` (Hidden Gem, Mr. Versatile), `boost` (Floor General)

## Badge Effect Mechanics (Tiered)

Each badge tier escalates. The pattern from descriptions:

| Effect Type | Base | Gold | Diamond | HOF | Actolytrene |
|---|---|---|---|---|---|
| **reroll** | 1 reroll | 2nd reroll | +0.5 dice bonus | 3rd reroll | +1 full dice bonus |
| **bonus** | +0.5 dice | reroll the bonus dice | 2nd reroll | +1 full dice | +1.5 dice |
| **debuff** | -1 star / -20 run pts | -2 | -4 | -3 | -5 |
| **cancel** | Cancels equal/lesser tier of target badge | same | same | same | same |
| **boost** (Floor General) | +1 star to teammate stat | +1 more | +1 more | +1 more | +1 more |
| **passive** | Varies per badge | — | — | — | — |

## Implementation Plan

### 1. Shared badge engine — `src/lib/badgeEngine.ts` (new file)
- `CardBadge` type: `{ badgeId, name, abbreviation, affected_stat, effect_type, tier }`
- `applyBadgeRerolls(stat, dice, badges, rating)` — check if any badge with `affected_stat` matching the stat has `effect_type: "reroll"`. If so, re-roll and keep best result, repeated per tier level
- `applyBadgeBonus(stat, dice, badges)` — for `bonus` type, add extra partial/full dice to the roll total
- `applyDebuffs(stat, opponentBadges)` — for `debuff` (Lockdown on 3PT/MID, Intimidator on DNK/FIN), reduce the stat value before rolling
- `checkCancel(defenderBadges, attackerBadges)` — Art of F You cancels Lockdown if tier >= Lockdown tier
- `getFloorGeneralBoost(lineup, targetSlot, stat)` — if any teammate has Floor General, boost target stat
- All functions work with both star-based (5v5) and numerical (Runs) scales, taking a `mode` param or using the raw numbers

### 2. Fetch badges at lineup confirmation
- **`src/components/game/LineupSelect.tsx`** (5v5): After selecting 5 cards, fetch `player_card_badges` joined with `badges` for all 10 cards (5 user + 5 CPU). Attach badge arrays to each card object before passing to GameBoard
- **`src/components/game/RunLineupSelect.tsx`** (Runs): Same — fetch badges for 3 user cards + 3 CPU cards at confirmation time. CPU cards from `run_players` already have card IDs to query against

### 3. Apply badges in 5v5 `GameBoard.tsx`
- Before each `resolveStatRoll`, check for debuffs from opponent (Lockdown/Intimidator reduce stat value), cancels (Art of F You), and boosts (Floor General from teammates)
- After rolling, check for reroll badges (Sniper on 3PT, etc.) — re-roll if applicable per tier
- After rolling, check for bonus badges (Limitless Range, Fade Ace) — add bonus dice value
- Show badge activation in the StatResult display

### 4. Apply badges in Runs `RunGameBoard.tsx`
- Same logic but applied to the possession-based contest:
  - On offense: check shooter's badges for the chosen stat (reroll/bonus)
  - On defense: check defender's badges for STL or BLK (reroll)
  - Debuffs: check if defender has Lockdown/Intimidator affecting the offense stat
  - Show badge activations in play-by-play log

### 5. UI feedback
- When a badge activates, add a log entry like "🏅 Sniper (Gold) activated — rerolling 3PT!"
- In 5v5 StatResult, show a small badge icon/label when a badge modified the roll

### Files to create/modify
- **Create**: `src/lib/badgeEngine.ts` — all badge resolution logic
- **Edit**: `src/components/game/LineupSelect.tsx` — fetch badges for all cards
- **Edit**: `src/components/game/RunLineupSelect.tsx` — fetch badges for all cards
- **Edit**: `src/components/game/GameBoard.tsx` — apply badge effects during 5v5 rolls
- **Edit**: `src/components/game/RunGameBoard.tsx` — apply badge effects during Runs rolls
- **Edit**: `src/lib/gameEngine.ts` — minor updates to accept badge-modified values

