

## What's wrong now
After tightening the By-Collection grid to `grid-cols-4` on mobile + adding global `overflow-x: hidden`, slot cards at 430px viewport are now ~85px wide → too small/cramped, and the content gets clipped because `overflow-x: hidden` on `html/body` + `max-width: 100vw` is fighting with the sidebar layout.

The real issue: I overcorrected. 4 columns at 430px is too dense for cards with names + position chips inside. Need to step back to **3 columns on mobile** but keep the viewport overflow guards so iOS doesn't auto-zoom.

## Fix (one file: `src/pages/Collection.tsx`)

**By-Collection grid (line ~941):**
```tsx
// from:
<div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 gap-1.5 sm:gap-2">
// to:
<div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2 sm:gap-3">
```

At 430px - p-3 (24px) = 406px / 3 cols - 2 gaps (16px) = ~130px wide cards. Fits names, badges, position chips cleanly without zoom.

The viewport fixes from last round (`overflow-x: hidden`, `text-size-adjust`, `p-3 sm:p-6`, `min-w-0`) all stay — they're what makes this work without iOS zooming out.

## What stays the same
- All Cards grid: `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4` (untouched).
- `index.css` viewport guards (untouched).
- `AppLayout` padding (untouched).
- `PlayerCard`, fonts, badges, glows (untouched).

## Files touched

| File | Change |
|---|---|
| `src/pages/Collection.tsx` | By-Collection grid: 4/5/6/7 → 3/4/5/6, gap 1.5/2 → 2/3 |

## Out of scope
- No revert of last round's viewport fixes — those are correct and necessary.
- No changes to All Cards view.
- No changes to other pages.

