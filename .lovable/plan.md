

# Fix Card Grid "Soup" — Overlapping Cards in All Game Modes

## Problem
On mobile (430px viewport), the 3-column card grid causes player cards to overlap horizontally and vertically. The `PlayerCard` component has no fixed height/aspect-ratio, and the grid cells are too narrow at `grid-cols-3` with only 3px gaps, causing the cards to bleed into each other.

## Root Cause
- `PlayerCard` is a flex button with no explicit height — its height varies based on content (name length, badges, gem tier chips)
- The grids use `grid-cols-3` with `gap-3` (12px) which is too tight for 140px cards on a ~400px screen
- Cards have `hover:scale-105` which compounds the overlap

## Fix

### 1. Add fixed aspect ratio to PlayerCard
Add `aspect-[3/4]` and `w-full` to the card button so all cards are uniformly sized regardless of content. This prevents variable heights from breaking the grid.

### 2. Fix grid sizing across all lineup screens
Replace `grid-cols-3` with `grid-cols-2 sm:grid-cols-3` on mobile for the collection grids, and increase gap to `gap-4`. Remove `max-w-[140px]` constraint that fights with the grid.

### Files Changed

| File | Change |
|---|---|
| `src/components/cards/PlayerCard.tsx` | Add `aspect-[3/4] w-full` to root button, ensure content is positioned at bottom via `justify-end` |
| `src/components/game/LineupSelect.tsx` | Grid: `grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4`, remove `max-w-[140px]` |
| `src/components/game/RunLineupSelect.tsx` | Same grid fix for the collection section |
| `src/pages/Collection.tsx` | Same grid fix if it uses the same pattern |

