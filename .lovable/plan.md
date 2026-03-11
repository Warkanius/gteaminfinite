

## Problem

The `RunRosterManager` renders **every player in the database** as individual DOM rows with checkboxes, badges, and labels. If there are hundreds or thousands of players, this creates a massive DOM that causes Chrome to lag/freeze — especially inside a dialog with scroll areas.

## Solution: Virtualize the player list and limit initial render

1. **Paginate/limit the visible player list** — Show only the first ~50 results at a time, with a "Load More" button or render more as the user scrolls. This avoids rendering hundreds of DOM nodes.

2. **Debounce the search input** — Currently every keystroke triggers a re-filter and re-sort of the entire list, causing re-renders. Add a 300ms debounce.

3. **Limit the sorted list output** — Cap `sorted` to 50 items and add a "Showing X of Y" indicator with a "Show More" button.

### Files to modify

- **`src/components/admin/RunRosterManager.tsx`**
  - Add a `displayLimit` state (default 50), increment by 50 on "Show More"
  - Slice `sorted` to `displayLimit` before mapping to JSX
  - Debounce `search` with a `useEffect` + `setTimeout` pattern (no new deps needed)
  - Reset `displayLimit` to 50 when search changes
  - Show count indicator: "Showing 50 of 312 players"

This is a lightweight fix — no new dependencies, just pagination and debounce to keep the DOM small.

