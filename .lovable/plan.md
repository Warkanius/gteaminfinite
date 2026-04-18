

## Goal
Make the Collection grid show smaller cards on iPhone so the user doesn't have to zoom out. Keep design identical — only adjust breakpoints and gap.

## What's wrong now
In `src/pages/Collection.tsx`, both grids use:
```
grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4
```
At 430px viewport that's 2 columns → ~195px wide cards (with `aspect-[3/4]` → ~260px tall). Missing/empty slots feel huge because they're nearly half the screen.

## Fix (one-line tweak in two places)

Change both grids to:
```
grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2 sm:gap-3
```

- **3 columns on mobile** → ~125px wide cards, comfortable for a 430px iPhone (and still fine down to 360px).
- Tighter gap (`gap-2`) on mobile to maximize card real estate; `gap-3` from `sm:` up.
- Denser grid on tablet/desktop too so the whole page feels more like a binder.

### Files touched

| File | Lines | Change |
|---|---|---|
| `src/pages/Collection.tsx` | 777 ("All" view grid) | Update grid classes |
| `src/pages/Collection.tsx` | 941 (By‑Collection slot grid) | Same update |

Tab strips, headers, and reward card width (`w-24 sm:w-28`) stay as-is — they already look right.

## Out of scope
- No changes to `PlayerCard` itself (already uses `aspect-[3/4] w-full`, so it scales perfectly with the new column width).
- No changes to other pages (Dashboard, Pack reveal, etc.).
- No font/badge size changes — those already read fine at the smaller card size based on `PlayerCard`'s `text-sm`/`text-[10px]` scale.

