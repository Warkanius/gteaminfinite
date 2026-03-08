

# Plan: Sample 8-Star Card + Stat Tooltips + Badge Check

## 1. Create sample "DeWayne Watkins" 8-star card via DB migration

Insert a player card into `player_cards` with:
- `name`: "DeWayne Watkins"
- `rating`: 8 (breaks the 5-star scale — will show 8 stars)
- `gem_tier_id`: Game Over tier (`b8288815-bded-4a9b-892f-2acf418a1e3a`)
- `gem_name`: "Fire Onyx" (dramatic combo from the visual system)
- Stats all cranked up (5-6 range)
- `card_animation`: "holographic"
- Position: SG/SF

Also insert it into `user_collections` for the current user so it appears in the collection. We'll need to insert for a specific user — I'll use a subquery to grab a user, or we can insert the card and you add it manually. Better approach: insert the card, then insert a `pack_players` entry or `user_collections` entry. Let me check the user_collections schema.

Actually, we need to add it to the logged-in user's collection. I'll insert the card and add a `user_collections` row. Since we don't know the user ID at migration time, I'll insert the card and add it to ALL existing users' collections (there's likely just you).

## 2. Add Recharts Tooltip to stat bars in CardDetailDialog

Add a `<Tooltip>` component from Recharts to the `BarChart` so hovering a bar shows the numeric stat value. Simple addition — import `Tooltip` from recharts and add it inside the `BarChart`.

## 3. Badges on PlayerCard thumbnails

Currently badges only show in `CardDetailDialog`. The `PlayerCard` component does NOT display badges — it only shows name, stars, gem name, position, and tier. The card is already small, so showing full badges would clutter it. Options:
- Show a small badge count indicator (e.g., a tiny shield icon with a number)
- Show nothing on the thumbnail (current behavior — badges visible on click)

I'll add a small badge count indicator on the card if badges exist, which means the Collection page needs to fetch badge counts per card. This requires joining `player_card_badges` in the collection query or doing a separate count query.

## Changes

### DB Migration
- Insert "DeWayne Watkins" into `player_cards` with rating 8, Game Over tier, Fire Onyx gem, high stats, holographic animation
- Insert into `user_collections` for all existing users
- Optionally add a couple badges to the card

### `CardDetailDialog.tsx`
- Import `Tooltip` from recharts
- Add `<Tooltip>` inside the `BarChart` with a custom formatter showing the stat value

### `Collection.tsx`
- Update the collection query to also fetch badge count (join `player_card_badges`)
- Pass `badgeCount` to `PlayerCard`

### `PlayerCard.tsx`
- Accept optional `badgeCount` prop
- If > 0, show a small shield icon with count in the bottom-left corner

