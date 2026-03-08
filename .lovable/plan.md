

# Replace Stat Bars with Star Ratings

Replace the Recharts bar chart in `CardDetailDialog` with a clean grid of stat labels + `StarRating` components (reusing the existing one). Each stat is on a 0–6 scale, so stars will naturally show 5 or 6 stars with the glow effect for 5+ values.

## Layout

A two-column grid of stat rows, each showing:
```text
3PT  ★★★★★★   MID  ★★★★★
FIN  ★★★★★★   DNK  ★★★★★★
AST  ★★★★★    STL  ★★★★★
REB  ★★★★     BLK  ★★★★★
         INT  ★★★★★★
```

## Changes

### `CardDetailDialog.tsx`
- Remove the Recharts imports (`BarChart`, `Bar`, `XAxis`, `YAxis`, `ResponsiveContainer`, `Cell`, `Tooltip`)
- Remove the `chartData` computation and the entire `<div className="h-48">` block
- Replace with a `grid grid-cols-2 gap-x-6 gap-y-2` div containing stat rows
- Each row: stat label (text-xs, uppercase, muted) + `<StarRating rating={value} glowColor={bg(visuals.glow)} size="sm" />`
- Stars at 5+ will automatically get the scale-breaking glow from `StarRating`

Single file change, removes a dependency on the chart, cleaner look matching the user's preference.

