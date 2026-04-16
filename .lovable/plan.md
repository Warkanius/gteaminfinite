

## Problem

In `RunLineupSelect.tsx`, both the player lineup and CPU lineup objects have their `stat_*` fields **overwritten** with run-stat values (0–120 numerical) before being passed to `<PlayerCard>` and `<RevealCard>`. 

`PlayerCard` calls `computeStars(card)` which averages the 9 stat fields and floors. With run stats (avg ~60), it returns 60 "stars" — completely broken display. It also affects `card.rating`, which is replaced with `runRatingToStars(run_rating)` — another OVR-like value.

The card art (`resolveCardVisuals`) also doesn't get `gem_tiers` because the spread loses it, and it isn't passed as the `gemTier` prop.

## Fix

Keep two separate objects per card:
1. **Display card** = the raw `player_cards` row (with star stats 0–6, original `rating`, and `gem_tiers`) — passed to all `<PlayerCard>` / `<RevealCard>` renders.
2. **Game card** = the run-stat-overlaid version (with `_runRating`, numerical stats) — passed only to `RunGameBoard` for engine logic.

### Changes

**`src/components/game/RunLineupSelect.tsx`**
- `cpuRoster` query: return objects with `displayCard` (raw player_card incl. gem_tiers) + `gameCard` (run-stat overlay). Render `displayCard` in `<RevealCard>`; pass `gameCard` array to `onLineupConfirmed`.
- `selectedCards` (display): keep raw collection cards as-is for `<PlayerCard>` render.
- `playerLineup` (game): build separate run-stat overlay version, pass to `onLineupConfirmed`.
- Remove `rating: runRatingToStars(...)` / stat overwrites from anything used for rendering.

**`src/components/game/RunGameBoard.tsx`**
- The `playerLineup` / `cpuLineup` it receives are now game-cards (with `_runRating` + numerical stats) — game logic stays the same.
- For the in-board `<PlayerCard>` renders (shooter selection, contest screen), use a parallel `displayLineup` derived from each game card's preserved `_displayCard` reference, OR attach a `_displayCard` field to each game card and render that.

### Implementation detail

Each game-card object will carry a `_displayCard` field pointing to the unmodified `player_cards` row (with original star stats + `gem_tiers`). `RunGameBoard` renders `<PlayerCard card={card._displayCard ?? card} />`.

This guarantees:
- Stars: correct (0–6 from real star stats)
- Card colors: correct (gem_name + gem_tiers preserved)
- OVR in detail dialog: correct (computed on real star stats)
- Engine: untouched (still uses `_runRating` + numerical stats)

### Files

| File | Change |
|---|---|
| `src/components/game/RunLineupSelect.tsx` | Split display vs. game card objects; attach `_displayCard` to each game card; render display cards |
| `src/components/game/RunGameBoard.tsx` | Render `card._displayCard ?? card` in all `<PlayerCard>` instances |

