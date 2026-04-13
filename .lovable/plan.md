

# UI Polish Pass — Ready for Players

## Issues Found

### 1. Number inputs are nearly invisible
The core issue you flagged. The `Input` component uses `bg-background` which on this dark theme is `260 60% 4%` — almost black. Combined with `border-input` at `260 40% 20%` (barely visible dark purple) and light foreground text, number values disappear into the background. This affects:
- **DiceInput** (the dice entry boxes during gameplay)
- **Admin stat inputs, coin/gem fields**
- **Auth page** inputs use `bg-secondary` which is slightly better but still very dark

### 2. Input border too subtle everywhere
`--input: 260 40% 20%` is nearly invisible against `--background: 260 60% 4%`. Every text field across the app has this issue — search bars, filters, form fields.

### 3. Number input spinner arrows invisible on dark backgrounds
Browser-native `type="number"` spinner arrows are nearly invisible on this dark theme.

### 4. Muted foreground too dim
`--muted-foreground: 250 20% 70%` — secondary text and labels are readable but could be brighter for better contrast, especially on mobile screens.

### 5. Card stat display during gameplay is tiny
In `GameBoard.tsx`, stat values like `"3PT: ★★★"` use `text-xs` — hard to read during the heat of gameplay.

### 6. Box score table too cramped on mobile
`GameResults.tsx` uses a wide table with `text-xs` that requires horizontal scrolling. On phone this is tedious.

### 7. StatResult formula is dense and hard to parse
The dice formula `[3+5] × 1.2x = 10 × 3 = 30pts` in `StatResult.tsx` is all inline `text-xs font-mono` — hard for a new player to understand.

### 8. DiceInput boxes too narrow
Each dice box is only `w-14` (56px) with `text-sm` — tight for fat fingers on mobile.

### 9. "Play With Friends" quick action links to `#` (dead link)
On the Dashboard, the "Play With Friends" card navigates to `#` — clicking it does nothing. Confusing for a new player.

### 10. "The Runs" sidebar link goes to `/runs` but the page component is at `/runs`
This is fine, just confirming it works. No issue here.

## Plan

### A. Global Input Visibility Fix (`src/index.css` + `src/components/ui/input.tsx`)
- Bump `--input` border from `260 40% 20%` to `260 40% 30%` — visible but not harsh
- Add a slightly lighter background to all inputs: change Input component default to include `bg-muted/50` instead of `bg-background`
- Bump `--muted-foreground` from `250 20% 70%` to `250 20% 78%` for better label contrast
- Add `--input-background: 260 40% 10%` custom variable for inputs specifically

### B. DiceInput Usability (`src/components/game/DiceInput.tsx`)
- Increase dice box width from `w-14` to `w-16`
- Increase text size from `text-sm` to `text-base`
- Add explicit background styling to make values pop

### C. GameBoard Stat Readability (`src/components/game/GameBoard.tsx`)
- Bump stat display text from `text-xs` to `text-sm`
- Make the dice count indicator slightly larger

### D. StatResult Clarity (`src/components/game/StatResult.tsx`)
- Break the formula into a clearer layout with labeled segments instead of one long line
- Increase font size slightly from `text-xs` to `text-sm` for the core numbers

### E. Box Score Mobile Fix (`src/components/game/GameResults.tsx`)
- Add a "scroll hint" shadow on the table container
- Slightly increase padding and font size for touch targets

### F. Disable Dead Link (`src/pages/Dashboard.tsx`)
- Change "Play With Friends" quick action to show "Coming Soon" or point to `/play`

### G. Auth Page Input Contrast (`src/pages/Auth.tsx`)
- Use the improved input styles (will inherit from global fix)

### H. Textarea Match (`src/components/ui/textarea.tsx`)
- Apply same background/border improvements as Input

## Files Changed

| File | Change |
|---|---|
| `src/index.css` | Bump `--input`, `--muted-foreground`, add input background var |
| `src/components/ui/input.tsx` | Add default `bg-muted/50` background class |
| `src/components/ui/textarea.tsx` | Match input background styling |
| `src/components/game/DiceInput.tsx` | Wider boxes, larger text, better backgrounds |
| `src/components/game/GameBoard.tsx` | Larger stat text, better contrast |
| `src/components/game/StatResult.tsx` | Clearer formula layout |
| `src/components/game/GameResults.tsx` | Better mobile table + scroll hint |
| `src/pages/Dashboard.tsx` | Fix dead "Play With Friends" link |

