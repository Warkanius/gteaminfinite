

# Phase 3: Collection & Card View with Smart Color Inference + Admin Override

## Color Inference Strategy

Given gem names like "Blood Sapphire", "Sky Emerald", "Fire Opal", "Midnight Pearl", etc., the system parses **both** color-modifier words and base gem-stone words to infer card colors.

**Priority chain:** Admin Override fields → Gem Name inference → Gem Tier default color → Hardcoded fallback

### Gem Name Parsing (`src/lib/cardVisuals.ts`)

Two keyword dictionaries:

**Color modifiers** (prefixes like "Blood", "Sky", "Fire", "Midnight", "Pink", "Purple", "Blue", "Orange", "Star", "Rainbow", "White", "Sunflower", "Watermelon", "Iridescent", "Lemon", "Turquoise", "Mutated", "Cybertronian", "Flame", "Imperial"):
- Each maps to a hue shift or specific color override for primary/glow

**Base gem stones** (e.g., "Ruby" → red, "Sapphire" → blue, "Opal" → iridescent, "Pearl" → white/cream, "Emerald" → green, "Garnet" → deep red, "Onyx" → dark, "Topaz" → amber, "Tourmaline" → teal, "Jade" → green, "Moonstone" → silver-blue, "Quartz" → clear/white, "Tanzanite" → violet, "Platinum" → silver, etc.):
- Each maps to a base `{ primary, secondary, glow }` palette

When both are present (e.g., "Blood Sapphire"), the base stone provides the secondary color and the modifier shifts the primary/glow. When only a base stone exists (e.g., "Ruby"), it provides the full palette. Unknown names fall through to gem tier color.

## Database Migration

Same as before — 4 nullable override columns on `player_cards`:
- `card_color_primary`, `card_color_secondary`, `card_glow_color` (HSL text)
- `card_animation` (shimmer / pulse / holographic / null)

## Components

1. **`src/lib/cardVisuals.ts`** — `resolveCardVisuals(card, gemTier)` returns `{ primary, secondary, glow, animation }`
2. **`src/components/cards/PlayerCard.tsx`** — Grid tile with dynamic gradient border, glow, animation, OVR badge, position chips
3. **`src/components/cards/CardDetailDialog.tsx`** — Full stats (recharts bar chart), badges, traits, team info
4. **`src/pages/Collection.tsx`** — Filterable/sortable grid of user's cards from `user_collections`

## Admin Form Update

Add "Card Appearance" section to `AdminPlayers.tsx`:
- 3 HSL color inputs (primary, secondary, glow) + animation dropdown
- Live preview swatch
- Label: "Leave blank to auto-infer from gem name"

## CSS Animations

Add shimmer, pulse, holographic keyframes to `index.css`.

## Routing

Wire `/collection` to new Collection page.

