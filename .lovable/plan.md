

# Fix iPhone Safe Area + Pack Type Categorization

## Issue 1: Header hidden behind iPhone status bar

The sticky header (`h-14`, `top-0`) sits behind the iPhone notch/status bar. The app already uses `viewport-fit=cover` and `apple-mobile-web-app-status-bar-style=black-translucent`, but doesn't apply safe-area padding.

**Fix in `src/components/AppLayout.tsx`:**
- Add `pt-[env(safe-area-inset-top)]` to the header so it pushes below the status bar on iPhones
- Adjust the header to use padding-top for the safe area while keeping its content vertically centered

**Fix in `src/index.css`:**
- Add `padding-top: env(safe-area-inset-top)` as a fallback on the body or root element, or apply it directly via the header's styles

## Issue 2: Pack type categorization

Currently the `packs` table has a `pack_type` text field with no enforced categories. The Pack Market filters by `cost > 0` to hide reward packs, which is fragile.

**Establish three categories:**
1. **Standard** — purchasable in the Pack Market with coins
2. **Reward** — granted by locker codes, challenges, or domination wins; not in the market
3. **Starter** — one-time starter packs for new users; not in the market

**Changes:**

| File | Change |
|------|--------|
| `src/components/AppLayout.tsx` | Add safe-area-inset-top padding to the header |
| `src/pages/PackMarket.tsx` | Filter packs to only show `pack_type = 'standard'` instead of `cost > 0` |
| `src/pages/admin/AdminPacks.tsx` | Update the pack_type dropdown to offer exactly three options: `standard`, `reward`, `starter` |

No database migration needed — `pack_type` is already a text field. The filtering change from `gt("cost", 0)` to `eq("pack_type", "standard")` properly enforces which packs appear in the market.

