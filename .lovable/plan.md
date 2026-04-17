
The user wants a bulk player assignment tool on the **admin** Collections page (or actually the Collection management — let me check). They said "on the collection page". Let me think — they're admin so likely they mean admin collection management. The user-facing Collection page is for viewing owned cards. The admin pages are AdminCollectionSets (which manages collections/sub-collections) and AdminPlayers.

Let me check AdminCollectionSets quickly via context — it's listed in the file tree. The plan should target that admin page.

## Goal
Add a bulk-assign tool inside the admin Collection Sets page so the admin can:
1. Search and multi-select player cards by name with a search bar
2. Import all players from a Pack, Run, or Team in one click
3. Assign the selected batch to a collection OR a sub-collection
4. When assigning to a sub-collection, also auto-set their `collection_id` to the parent collection

## UI changes (`src/pages/admin/AdminCollectionSets.tsx`)

Add a new "Bulk Assign Players" panel with:
- **Target picker**: two selects — Collection (required) + Sub-collection (optional). If sub is chosen, the parent collection auto-fills and is locked.
- **Player picker** with three tabs:
  - **Search**: typeahead search bar over `player_cards.name`, multi-select with checkbox chips for chosen players. Shows running count "12 selected".
  - **Import from Pack**: select a pack → loads `pack_players` → "Add all 30 players" button + per-player checkboxes to deselect any.
  - **Import from Run**: select a run → loads `run_players` → same UX.
  - **Import from Team**: select a team → loads `team_players` → same UX.
- **Selected players staging area**: shows all chosen players (across sources) with × to remove individually + "Clear all" button.
- **Assign button**: writes `collection_id` (and `sub_collection_id` when applicable) on every selected `player_cards` row in one bulk update.

## Logic

- Query keys: reuse `["packs"]`, `["runs"]`, `["teams"]`, plus `["all-player-cards-lite"]` already used elsewhere.
- Bulk update: one `UPDATE player_cards SET collection_id = ?, sub_collection_id = ? WHERE id IN (…)` via `supabase.from("player_cards").update(...).in("id", ids)`.
- **Sub-collection auto-parent rule**: if a sub-collection is picked, set both `collection_id = parent` AND `sub_collection_id = chosen`. Sub-collections already store `collection_id` on the row, so we always derive parent from that.
- Show toast with count: "Added 24 players to Generation of Miracles → Teiko Era".
- Invalidate `["admin-all-cards-lite"]`, `["collections"]`, `["sub-collections"]` after success.

## Files

| File | Change |
|---|---|
| `src/pages/admin/AdminCollectionSets.tsx` | Add Bulk Assign panel: target picker (collection + optional sub-collection), tabbed source picker (search / pack / run / team), staging list, bulk-assign mutation |

## Out of scope
- No changes to the user-facing `src/pages/Collection.tsx`
- No schema changes (existing `player_cards.collection_id` and `sub_collection_id` columns are sufficient)
- No reverse "remove from collection" bulk tool (can add later if needed)
