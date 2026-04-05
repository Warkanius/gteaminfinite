

# Fix Star Visibility on Cards (Front & Back)

## How Stars Work

Your stats (3PT, MID, FIN, etc.) are stored as **star values from 0 to 12**. The overall `rating` is the average of all 9 stats, also on the 0–12 scale. Stars 1–5 are standard; stars 6–12 are "scale-breakers" that show extra stars with glowing effects. In Runs mode, a separate 0–120 numerical scale maps back to 0–6 stars for display.

## Current Problems

- **Front of card (PlayerCard)**: The dark backdrop pill behind stars is ugly. The empty star outlines are too thin (`strokeWidth: 1.5`) and too transparent (`text-foreground/20`), making them invisible on gradient backgrounds.
- **Back of card (CardDetailDialog)**: Individual stat stars use `size="sm"` (12×12px icons) — too small to read. The overall rating stars at `size="lg"` may also be hard to see against the gradient header.

## Changes

### `src/components/cards/StarRating.tsx`
- Increase empty star stroke width from `1.5` to `2.5`
- Change empty star color from `text-foreground/20` to `text-foreground/50` for better contrast
- Add a subtle dark `drop-shadow` on all stars so they pop against any background

### `src/components/cards/PlayerCard.tsx`
- Remove the dark backdrop pill (`bg-background/60 backdrop-blur-sm`) from the star rating container
- Keep the stars positioned top-right but without the background bubble

### `src/components/cards/CardDetailDialog.tsx`
- Increase individual stat star ratings from `size="sm"` to `size="md"` so they're readable in the two-column grid

No database or backend changes needed.

