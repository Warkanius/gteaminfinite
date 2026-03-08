

# Add Dual Dice Mode: Auto-Roll + Manual Input Toggle

## Overview
Add an automated dice roll as the **default** experience, with a "Got your own dice?" toggle that switches to the existing manual input mode.

## Changes

### `src/components/game/DiceRoll.tsx` (New)
- Animated auto-roll component: shows a dice icon that cycles through values (1-6) rapidly for ~1 second, then lands on a random result
- Uses CSS animation (scale + rotate keyframes) during the roll
- Props: `onComplete(value: number)`, `label: string`
- Displays the final value prominently after landing

### `src/components/game/GameBoard.tsx` (Edit)
- Add `useOwnDice` boolean state (default `false`)
- Add a small toggle/switch at the top: "Got your own dice?" with a `Switch` component
- When `useOwnDice` is false → render two `DiceRoll` components side by side with a "Roll Dice" button that triggers both animations, then calls `handleDiceSubmit` with the random results
- When `useOwnDice` is true → render the existing `DiceInput` manual entry component
- The toggle is only shown/changeable during the `dice` phase

### `src/components/game/DiceInput.tsx` (Keep as-is)
- No changes needed — already works for manual mode

