

## What's wrong
`PlayerCard` truncates card names with `truncate` (single line + ellipsis) on both the missing-slot view (line 53) and the regular card view (line 122). At 3-column mobile widths (~130px wide cards), longer names like "Giannis Antetokounmpo" or "Shai Gilgeous-Alexander" get cut to "Giannis Antet…".

## Fix (one file: `src/components/cards/PlayerCard.tsx`)

Swap single-line `truncate` for a 2-line clamp on the name, and let the gem name wrap to 2 lines too. This keeps the card aspect ratio intact (the name area is at the bottom of a fixed `aspect-[3/4]` button) while showing the full name in almost every realistic case.

### Missing slot name (line 53)
```tsx
// from:
<h3 className="text-sm font-semibold text-muted-foreground/80 truncate w-full text-center relative z-10">
// to:
<h3 className="text-[11px] sm:text-sm font-semibold text-muted-foreground/80 w-full text-center relative z-10 leading-tight line-clamp-2 break-words">
```

### Regular card name (line 122)
```tsx
// from:
<h3 className="text-sm font-semibold text-foreground truncate w-full text-center drop-shadow-md">
// to:
<h3 className="text-[11px] sm:text-sm font-semibold text-foreground w-full text-center drop-shadow-md leading-tight line-clamp-2 break-words px-1">
```

### Gem name (line 128)
```tsx
// from:
<p className="text-[10px] text-foreground/70 truncate w-full text-center mt-0.5">
// to:
<p className="text-[10px] text-foreground/70 w-full text-center mt-0.5 leading-tight line-clamp-2 break-words px-1">
```

## Why this works
- `line-clamp-2` lets long names wrap to a second line and only ellipsizes if they exceed 2 lines (rare).
- `text-[11px] sm:text-sm` shrinks the name slightly on mobile so 2 lines comfortably fit in the existing card footer area without changing the card's aspect ratio.
- `break-words` prevents very long single tokens (e.g. hyphenated last names) from overflowing horizontally.
- `px-1` gives the text 4px breathing room from the card edges.
- Tailwind already supports `line-clamp-*` utilities natively (v3.3+), no plugin needed.

## What stays the same
- Card aspect ratio (`aspect-[3/4]`), gradient background, glow, animations.
- Star rating, badge count, duplicate badge, lock icon positions.
- Position / tier chips below the name.
- All other pages and grids.

## Files touched

| File | Change |
|---|---|
| `src/components/cards/PlayerCard.tsx` | Replace `truncate` on name + gem name with 2-line clamp + slightly smaller mobile font |

## Out of scope
- No grid column changes.
- No `index.css` / `AppLayout` changes.
- No changes to other card components (e.g. `RevealCard`).

