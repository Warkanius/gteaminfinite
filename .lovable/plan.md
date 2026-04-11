

# Add Gem Name Input & Clean Up Domination Lineup UI

## Problem

1. **Missing Gem Name input**: The `gem_name` column exists on `player_cards` and the card visual system (`cardVisuals.ts`) already infers colors from it, but the admin player form has no input field to set it. It was likely removed when gem tiers were restructured.

2. **Domination lineup select UI**: The `LineupSelect` component used for Domination has raw unstyled card grid without the same size constraints applied to `GameBoard.tsx` (which already has `max-w-[140px] aspect-[3/4]`).

## Changes

### 1. `src/pages/admin/AdminPlayers.tsx`
- Add a **Gem Name** text input field in the basic info section (near Gem Tier dropdown, around line 467)
- Input bound to `form.gem_name`, placeholder like "e.g. Fire Opal, Blood Ruby"
- Helper text: "Used to auto-infer card colors. See Card Appearance preview below."

### 2. `src/components/game/LineupSelect.tsx`
- Constrain the card grid items with `max-w-[140px] aspect-[3/4] w-full mx-auto` on each `PlayerCard` to match the GameBoard styling
- Tighten the grid layout for consistent card sizing across screen sizes

| File | What |
|------|------|
| `src/pages/admin/AdminPlayers.tsx` | Add gem_name text input after Gem Tier dropdown |
| `src/components/game/LineupSelect.tsx` | Add size constraints to PlayerCard in the grid |

