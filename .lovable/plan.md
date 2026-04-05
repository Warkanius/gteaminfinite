

# Fix Star Colors & Consistent Rating Display

## Changes

### `src/components/cards/StarRating.tsx`
- Change filled star `fill` and `stroke` from `glowColor` to **white** (`"#ffffff"`)
- Remove the half-star logic — use **floor rounding**: `Math.floor(rating)` full stars, no partial fills
- This ensures: 0–0.99 = 0 stars, 1–1.99 = 1 star, 2–2.99 = 2 stars, etc.
- Keep the scale-breaker glow effect on the container for ratings > 5, but filled stars themselves stay white
- Keep the empty star styling (thick border, drop-shadow) as-is

### `src/components/cards/PlayerCard.tsx`
- No changes needed — already passes `card.rating` and uses `size="md"`

### `src/components/cards/CardDetailDialog.tsx`
- No changes needed — overall rating (line 85) uses `card.rating` with `size="lg"`, individual stats (line 102) use the stat values with `size="md"`. Both go through the same `StarRating` component so they'll be consistent after the fix above.

### Summary of StarRating logic after fix
```
fullStars = Math.floor(rating)
totalStars = max(5, fullStars)
Filled stars: white fill, white stroke, with drop-shadow for scale-breakers
Empty stars: foreground/50 outline, strokeWidth 2.5
```

No database or backend changes.

