

# Fix Challenge Play Button + Add Lineup Restrictions + Collection System

## Three changes

### 1. Play Button Does Nothing
The `Challenges.tsx` Play button has no `onClick`. Need to navigate to `/play/match` passing challenge state (opponent team, win condition, rewards) similar to how Domination does it.

**File**: `src/pages/Challenges.tsx` — add `onClick={() => navigate("/play/match", { state: { challengeId: c.id, opponentTeamId: c.opponent_team_id, ... } })}` to each Play button.

**File**: `src/pages/Play.tsx` — extend `DominationState` to include challenge fields. When `challengeId` is present, use the challenge's opponent team to load CPU lineup (same pattern as domination).

**File**: `src/components/game/LineupSelect.tsx` — accept `challengeTeamId` prop and load CPU from `team_players` for that team, plus support lineup restriction filters.

### 2. Lineup Restrictions on Challenges
Add a `lineup_restrictions` JSONB column to the `challenges` table. This stores an object like:
```json
{
  "positions": ["PG", "SG"],
  "badge_ids": ["uuid"],
  "trait_ids": ["uuid"],
  "gem_tier_ids": ["uuid"],
  "team_ids": ["uuid"],
  "collection_ids": ["uuid"],
  "sub_collection_ids": ["uuid"],
  "card_colors": ["red", "blue", "gold"]
}
```
All fields optional. When present, only cards matching ALL specified restrictions are selectable.

**Migration**: `ALTER TABLE challenges ADD COLUMN lineup_restrictions jsonb DEFAULT NULL`

**Admin UI** (`AdminChallenges.tsx`): Add a "Lineup Restrictions" section with multi-select pickers for each restriction type. Card color uses broad color buckets derived from card_color_primary HSL hue (red, orange, gold, green, blue, purple, pink, white, black).

**LineupSelect.tsx**: Filter user's collection based on active challenge restrictions before rendering.

**Challenges.tsx**: Display restriction badges (e.g. "PG/SG only", "Gold cards only") on each challenge card.

### 3. Collection & Sub-Collection System
New tables:
- `collections` — `id`, `name`, `description`, `created_at`
- `sub_collections` — `id`, `collection_id`, `name`, `created_at`

Add `collection_id` and `sub_collection_id` columns to `player_cards` so cards can be assigned to a collection/sub-collection.

**Admin page**: Create `AdminCollectionSets.tsx` (or extend existing admin) for managing collection and sub-collection definitions. In `AdminPlayers.tsx` (or PlayerQuickEdit), add dropdowns to assign a card to a collection/sub-collection.

**Example**: Collection = "Kuroko no Basuke", Sub-collection = "Kaijo High". A card assigned to both can be filtered by either.

## Files Changed

| File | Change |
|---|---|
| Migration | Add `lineup_restrictions` to challenges; create `collections` + `sub_collections` tables; add `collection_id`/`sub_collection_id` to `player_cards` |
| `src/pages/Challenges.tsx` | Wire Play button to navigate with challenge state; show restriction badges |
| `src/pages/Play.tsx` | Extend state to accept challenge fields; pass to LineupSelect |
| `src/components/game/LineupSelect.tsx` | Accept challenge restrictions; filter user cards; load CPU from challenge team |
| `src/pages/admin/AdminChallenges.tsx` | Add lineup restrictions section with multi-selects |
| `src/pages/admin/AdminPlayers.tsx` or `PlayerQuickEdit.tsx` | Add collection/sub-collection assignment dropdowns |
| New: admin page for collections/sub-collections | CRUD for collection sets and sub-collections |

