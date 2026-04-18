

## Goal
- **Revert** the All Cards grid back to the original `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4` (your original aesthetic).
- **Keep "By Collection" denser, but go one step tighter** so the missing-card slots fit on iPhone without zooming.

## Why your iPhone still feels cramped
At 430px viewport, the current "By Collection" grid (`grid-cols-3 ... gap-2`) makes each slot ~125px wide. With `aspect-[3/4]`, that's ~167px tall — so a typical iPhone screen shows roughly 3×3 = 9 slots before the slot label, button group, and headers eat the rest. For collections with 5–10 missing slots, you scroll a lot, and the "missing" frames still feel chunky next to the dense top header.

Going to **4 columns on mobile** drops each slot to ~93px wide (~124px tall) — you'll see ~12–16 slots per screen, and the binder feel comes through without any zoom.

## Changes (one file: `src/pages/Collection.tsx`)

**1. Revert "All Cards" grid (line 777)**
```tsx
// from:
<div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2 sm:gap-3">
// back to:
<div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
```

**2. Tighten "By Collection" slot grid (line 941)**
```tsx
// from:
<div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2 sm:gap-3">
// to:
<div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 gap-1.5 sm:gap-2">
```

This keeps the design (same `PlayerCard`, `aspect-[3/4]`, badges, glow) — just shrinks the slot tile so missing cards stop dominating the screen.

## Files touched

| File | Lines | Change |
|---|---|---|
| `src/pages/Collection.tsx` | 777 | Revert All Cards grid to original 2/3/4 cols, gap-4 |
| `src/pages/Collection.tsx` | 941 | By Collection grid → 4/5/6/7 cols, gap-1.5/2 |

## Out of scope
- No changes to `PlayerCard` styling, fonts, or badges.
- No changes to the tier breakdown grid (top of page) or the tab strip.
- No changes to other pages (Pack Market, Gem Market, Dashboard, etc.).

