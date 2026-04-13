

# Fix Card Grid Layout, Auction Prices & Pack Filter

## 1. Card Grid Layout Cleanup (LineupSelect + RunLineupSelect)

**Problem**: Cards render at inconsistent sizes. `LineupSelect` uses `max-w-[140px]` with `mx-auto` in a responsive grid, but `RunLineupSelect` uses `flex-wrap gap-4` with `w-32 sm:w-36` inline — no grid, no uniform sizing.

**Fix**: Apply the same uniform grid layout to both:
- **LineupSelect.tsx** (line 161): Already has a proper grid with `max-w-[140px]`. Looks correct. Will verify the aspect ratio wrapper is applied.
- **RunLineupSelect.tsx** (line 242): Replace the `flex flex-wrap gap-4` collection grid with the same `grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-3` layout and wrap each card in `max-w-[140px] w-full mx-auto` — identical to `LineupSelect`.
- Also fix the selected lineup row (line 173) and CPU lineup row (line 204): use consistent `w-[120px] sm:w-[140px]` sizing instead of `w-32 sm:w-36` which creates uneven widths.

## 2. Auction House Prices Too Low

**Problem**: The only standard pack costs 5,000 coins. The current auction config has `min_price: 200, max_price: 5000`. Prices based on `market_value` with 0.8x–1.3x variance can land as low as 200 coins — far below what players pay for packs.

**Fix**: Update `refresh-auction/index.ts`:
- Raise `DEFAULT_CONFIG.min_price` to `1000` and `max_price` to `10000`.
- Adjust the price variance to `0.9x–1.5x` of `market_value` (instead of 0.8x–1.3x), so prices cluster higher.
- Snipe prices should still be discounted but capped at a higher floor (e.g., `500` instead of `50`).

## 3. Only Standard Packs in Auction

**Problem**: The current filter uses `.gt("cost", 0)` which catches reward packs with artificially high costs (e.g., "Shutoku I" at 9999 coins, "Hidden Gem" at 99999). These are reward packs, not standard packs.

**Fix**: Change the pack query in `refresh-auction/index.ts` from:
```
.from("packs").select("id").gt("cost", 0)
```
to:
```
.from("packs").select("id").eq("pack_type", "standard")
```

This ensures only cards from standard packs appear in the auction house.

## Files Changed

| File | Change |
|------|--------|
| `src/components/game/RunLineupSelect.tsx` | Uniform grid layout for collection cards, consistent card widths |
| `supabase/functions/refresh-auction/index.ts` | Filter by `pack_type = 'standard'`, raise min/max prices, adjust variance |

