
The user wants the user-facing Collection page (`src/pages/Collection.tsx`) to be reorganized to mimic NBA 2K17 MyTeam's collection page system. Let me think about what that looked like:

NBA 2K17 MyTeam collections had:
- A tabbed/paged structure where each "page" represented a collection (e.g. team, theme set)
- Each collection page showed ALL slots (owned + missing), with missing slots shown as silhouettes/empty
- The reward card was prominently displayed at the top of each collection page
- Progress counter "X / Y collected"
- Tabs/dropdown to switch between collections

I need to look at the current Collection.tsx more carefully — it currently shows a flat grid of owned cards only, with collection rewards as a small list at the top. The new design should be page-based per collection.

Let me check the structure of collections vs sub_collections — collections are top-level, sub_collections nest under them.

## Proposed redesign

Replace the flat grid with a **paginated collection browser**:

### Top-level structure
- Add a new "View mode" toggle: **All Cards** (current behavior) | **By Collection** (new MyTeam-style view)
- In "By Collection" mode, show a horizontal scrollable tab/chip bar listing every collection that has cards assigned (e.g. "Generation of Miracles", "Seirin High", etc.)
- A second-level chip bar appears beneath when the selected collection has sub-collections (e.g. "Teiko Era", "Current Era")

### Per-collection page layout
- **Header card**: collection name + progress bar "12/20 collected (60%)" + the **reward card** displayed prominently (with claim button if completed, locked silhouette if not)
- **Card grid**: shows ALL `player_cards` in that collection (excluding the reward card itself), with:
  - Owned cards: rendered normally with `PlayerCard`
  - Missing cards: rendered as a greyscale/silhouette tile showing only name + position + tier color stripe (so the user knows what to chase)
- Sort missing cards last, owned cards first by rating

### Data needs (already mostly fetched)
- `collections`, `sub_collections`, `allPlayerCards`, `ownedCardIds` — all already queried
- Just need to extend `allPlayerCards` query to include the fields needed to render missing-card placeholders (`name, position1, gem_tier_id, rating`)

### Files touched
| File | Change |
|---|---|
| `src/pages/Collection.tsx` | Add view-mode toggle, collection/sub-collection tab navigation, per-collection page with reward header + full slot grid (owned + missing placeholders) |
| `src/components/cards/PlayerCard.tsx` | Add `missing` prop that renders a greyscale silhouette variant (name + position + tier color bar only) |

### Out of scope
- No schema changes
- "All Cards" flat view stays as-is (toggle preserves the existing UX)
- No changes to filters in the new view (per-collection pages don't need tier/position filters since they're already scoped)
