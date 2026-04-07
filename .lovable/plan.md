

# Show Badge & Trait Activations During Gameplay

## Current State
- **5v5 (`GameBoard.tsx`)**: Activations are collected and shown after each stat roll as tiny `Badge` chips — but they're small, unstyled, and use a generic emoji. No distinction between badges vs traits, or between tiers.
- **Runs (`RunGameBoard.tsx`)**: Activations are logged into the play-by-play log as plain text lines with a 🏅 prefix. No visual flair.

Both modes already collect all activation data — the issue is purely **presentation**.

## Plan

### 1. Create `ActivationBanner` component
A new reusable component (`src/components/game/ActivationBanner.tsx`) that renders a list of badge/trait activations with visual distinction:

- **Badge activations**: Shield icon, tier-colored background (Base=gray, Gold=amber, HOF=magenta, Diamond=cyan, Actolytrene=deep purple)
- **Trait activations**: Zap/lightning icon, same tier color scheme
- Each activation shows: abbreviation, tier label, and effect text
- Animate in with a subtle slide-up + fade entrance
- Compact layout for 430px mobile viewport

### 2. Update `StatResult.tsx`
- Accept an `activations` prop
- Render `ActivationBanner` below the dice math, inside the result card — so badge/trait effects appear contextually with the roll they affected

### 3. Update `GameBoard.tsx` (5v5)
- Pass `lastBadgeActivations` to `StatResult` instead of rendering separate `Badge` chips below it
- Remove the existing plain badge chip rendering

### 4. Update `RunGameBoard.tsx` (Runs)
- Keep activations in the play-by-play log but enhance the badge log entries with tier-colored left borders and icons matching the `ActivationBanner` style
- Add a brief toast-style popup when activations fire during a possession, so players see them before they scroll away in the log

## Files Changed

| File | Change |
|------|--------|
| `src/components/game/ActivationBanner.tsx` | New component — tier-colored activation display |
| `src/components/game/StatResult.tsx` | Accept + render activations prop |
| `src/components/game/GameBoard.tsx` | Pass activations to StatResult, remove old chips |
| `src/components/game/RunGameBoard.tsx` | Enhanced badge log styling + popup on activation |

