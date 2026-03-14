

# Fix: Domination Play Button Navigates to Wrong Route

## Problem
`handlePlay` in `Domination.tsx` navigates to `"/play"`, which maps to the `GameHub` component. The actual 5v5 game lives at `"/play/match"` (the `Play` component).

## Fix
One line change in `src/pages/Domination.tsx` line 70: change `navigate("/play", { state: ... })` to `navigate("/play/match", { state: ... })`.

