
## What’s actually wrong
The last tweak changed the slot grid, but the real mobile bug is still in the page shell:

1. The app is still using a **document-level horizontal clamp** (`html, body { overflow-x: hidden; max-width: 100vw; }`), so iPhone is clipping wide content instead of letting the Collection tab rows scroll naturally.
2. The Collection chip rows are not built as a true “outer scroller + inner content” pattern, so long collection lists can get visually cut off.
3. `AppLayout` already has `min-w-0` on the inner content wrapper, but the **`main` flex item itself** still needs `min-w-0`, otherwise wide Collection content can force bad width calculations.

That’s why it feels like “nothing changed”: the grid changed, but the scroll/container bug did not.

## Fix
Keep the current aesthetic and keep the By Collection grid at 3 columns. Change the layout/scroll behavior instead.

### 1. `src/index.css`
Stop clamping the entire document width globally.

- Remove the global `max-width: 100vw`
- Remove the global `overflow-x: hidden` from `html, body`
- Keep `-webkit-text-size-adjust: 100%` / `text-size-adjust: 100%`

Result: iPhone text sizing stays stable, but Collection’s horizontal scrollers won’t get clipped by the document.

### 2. `src/components/AppLayout.tsx`
Move overflow control to the app shell and fix the flex width negotiation.

Change:
```tsx
<div className="min-h-screen flex w-full">
...
<main className="flex-1 flex flex-col">
```

To:
```tsx
<div className="min-h-screen flex w-full overflow-x-hidden">
...
<main className="flex-1 min-w-0 flex flex-col">
```

Result: the app still won’t blow out horizontally, but inner scroll regions can behave correctly.

### 3. `src/pages/Collection.tsx`
Convert both chip rows into explicit horizontal scrollers.

For both:
- Collection tabs
- Sub-collection tabs

Change from a single flex container:
```tsx
<div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
  ...buttons
</div>
```

To a two-layer structure:
```tsx
<div className="w-full min-w-0 overflow-x-auto overflow-y-hidden pb-2">
  <div className="flex w-max gap-2 px-1">
    ...buttons
  </div>
</div>
```

This ensures:
- the row is constrained to the phone width
- the inner chip list can extend naturally
- you can scroll all the way to the last collection
- the row won’t get cut off by the page shell

## What stays the same
- All Cards grid stays reverted to the original layout
- By Collection grid stays at `grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6`
- Same colors, same card visuals, same typography, same overall look
- No changes to Pack Market, Gem Market, Dashboard, etc.

## Files to update
- `src/index.css`
- `src/components/AppLayout.tsx`
- `src/pages/Collection.tsx`

## Expected outcome
After this change:
- you should not need to zoom out on iPhone
- the By Collection slots should fit normally at 3 columns
- the collection/sub-collection chip rows should scroll fully instead of getting cut off
- the page should keep the same aesthetic, just behave correctly on mobile
