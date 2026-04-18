

## What's actually happening

Looking at your screenshot, the issue isn't just card sizing — the **whole page is rendering wider than the iPhone viewport**, so you're forced to pinch-zoom out to see anything. The collection grid I tightened last round (`grid-cols-4`) is correct, but it's being rendered on a page that's overflowing horizontally, so the cards still look huge.

Two root causes on iOS:

1. **No global `overflow-x` guard.** When any child overflows by a few px, iOS Safari grows the whole page width and forces zoom-out. There's no `overflow-x: hidden` on `html/body`.
2. **iOS auto text-size adjust.** Safari scales text up on rotation/load when `-webkit-text-size-adjust` isn't pinned to `100%`. That's why the "GEM MARKET: ACTOLYTRENE" header looks 2x larger than `text-lg` should be.
3. **Page padding eats mobile width.** `AppLayout`'s content uses `p-6` (24px each side = 48px gone). On a 430px iPhone that leaves only ~382px for cards. Dropping to `p-3` on mobile gives back 24px = bigger room for the same grid.
4. **Filter row can overflow.** `flex flex-wrap gap-3` with a `min-w-[200px]` search + three fixed-width `Select`s (`w-36`, `w-28`, `w-32`) sums to 384px+ which can push the page wider than the viewport on first paint.

## Fix (3 small files, no design change)

### 1. `src/index.css` — pin viewport behavior
Add to the `body` block:
```css
html, body { overflow-x: hidden; max-width: 100vw; }
body { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
```
This kills the iOS auto-zoom-out and stops any rogue child from widening the page.

### 2. `src/components/AppLayout.tsx` — give back mobile space
Line 27, change:
```tsx
<div className="flex-1 p-6 relative">
```
to:
```tsx
<div className="flex-1 p-3 sm:p-6 relative min-w-0">
```
24px reclaimed per side on mobile, `min-w-0` ensures the flex child can shrink instead of pushing the page wider.

### 3. `src/pages/Collection.tsx` — tighten 2 spots
- **Line 739** (search input min-width): `min-w-[200px]` → `min-w-[160px]` so the filter row never forces overflow.
- **Line 869** (collection header title): `text-lg font-bold` → `text-base sm:text-lg font-bold` so "GEM MARKET: ACTOLYTRENE" stops dominating mobile.

## What stays the same
- Grid columns (`grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7`) and gap stay as they are — they were correct, the problem was the page around them.
- `PlayerCard` styling, badges, glows, fonts — untouched.
- All Cards view stays at `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4`.
- No changes to Dashboard, Pack Market, or any other page.

## Files touched

| File | Change |
|---|---|
| `src/index.css` | Add `overflow-x: hidden` + `text-size-adjust: 100%` to `html/body` |
| `src/components/AppLayout.tsx` | `p-6` → `p-3 sm:p-6`, add `min-w-0` to content wrapper |
| `src/pages/Collection.tsx` | Search `min-w-[200px]` → `min-w-[160px]`; collection title `text-lg` → `text-base sm:text-lg` |

## Out of scope
- No grid column changes (already correct from last round).
- No `PlayerCard` changes.
- No changes to other pages — these CSS fixes are scoped to globals + Collection only.

