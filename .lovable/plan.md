

# Click-to-Reveal Pack Opening + Next Phase

## Part 1: Click-to-Flip Card Reveal

Currently cards auto-reveal on a timer. We'll change to a click-to-flip mechanic with a 3D card flip animation.

### Changes

**`RevealCard.tsx`** — Replace auto-reveal timer with click handler + CSS 3D flip:
- Cards appear face-down (show a card back with a subtle glow hint based on tier)
- On click, card flips 180° on Y-axis revealing the front
- Card back design: dark gradient with a "?" or pack logo, plus a subtle edge glow hinting at the tier color
- Remove the `delay` auto-timer; add `onClick` to trigger `setRevealed(true)`
- Use CSS `perspective`, `transform-style: preserve-3d`, `backface-visibility: hidden` for the flip
- Add a brief "burst" animation on the glow after flip completes

**`PackReveal.tsx`** — Update heading text:
- Change "Revealing..." → "Tap cards to reveal!"
- Add a "Reveal All" button for impatient users that flips remaining cards with staggered delays
- `onRevealed` callback stays the same

**`src/index.css`** — Add `@keyframes card-flip` (rotateY 0→180deg, 600ms ease-out)

### UX Flow
1. Pack opens → all cards appear face-down with a faint tier-colored edge glow
2. Player clicks each card → 3D flip with glow burst
3. Higher tiers get bigger glow + slight screen shake via CSS
4. After all revealed → summary buttons appear

---

## Part 2: Next Phase — Play Game (Dice Mode)

This is the core gameplay loop:

- **Pick Lineup** — select 5 cards from collection for your team
- **Game Screen** — opponent lineup shown; each round picks a stat category
- **Dice Roll** — animated dice roll determines stat modifier
- **Stat Comparison** — your card stat ± dice vs opponent stat ± dice
- **Win/Loss Tracking** — results logged to `game_logs` table
- **Rewards** — coins awarded for wins

This would involve new pages (`/play`, `/play/game`), a game engine edge function, and animated dice/stat comparison UI.

