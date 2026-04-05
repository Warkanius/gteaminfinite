

# Dynamic Odds Templates Based on Pack Player Count

## Problem
The current odds templates have hardcoded slot counts (3, 4, or 5 slots). But packs can have any number of players, so the templates need to generate odds rows dynamically based on how many players are actually in the pack.

## Solution
Replace the fixed-slot templates with **distribution functions** that take the current player count (from `packPlayers.length`) and generate the appropriate number of odds rows with percentages that sum to 100%.

### Templates (now distribution strategies)
- **Standard (top-heavy)**: Higher odds for lower slots, tapering down. e.g. for 8 players, slot 1 gets the most %, slot 8 the least.
- **Equal**: Even split across all slots (100 / N, remainder added to last slot).
- **Heavy Hitter (bottom-heavy)**: Inverse of standard — higher-numbered slots get better odds.
- **Bell Curve**: Middle slots get highest odds, edges get lowest.

### How it works
1. When admin clicks a template, it reads `packPlayers.length` to determine how many slots to generate.
2. If no players exist yet, show a message: "Add players first before applying a template."
3. Each template function receives `N` (number of slots) and returns an array of `{ result_slot, percentage, description }`.
4. The `applyTemplateMut` clears existing odds and inserts the generated rows.

### Files Changed
| File | Change |
|------|--------|
| `src/pages/admin/AdminPacks.tsx` | Replace `ODDS_TEMPLATES` static object with distribution generator functions; pass `packPlayers.length` to template application; disable template buttons when no players exist |

