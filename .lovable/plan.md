

# Admin Collections, Expanded Archetypes, Auto-Create Reward Packs, and Autofill

## Key Clarification: Two Pack Types

- **Domination Reward Pack** — awarded for any Domination win. 5 slots (the 5 opposing players), no Player's Choice. Odds favor lower-rated players (higher-rated = rarer).
- **RTTR (Road to the Ring) Pack** — awarded for the final 4 games of a Domination road. 6 slots: the 5 opposing players + 1 Player's Choice slot. Odds favor higher-rated players (higher-rated = more common), since these packs are harder to earn.

Both are auto-created from the Domination game's roster.

## Changes

### 1. Admin Collection Editor
- New page `AdminCollections.tsx`: search users, view/add/remove cards from `user_collections`
- DB migration: admin RLS policies on `user_collections` for full CRUD by admins
- Route + sidebar nav link

### 2. Auto-Create Reward Packs (AdminTeams)
Two buttons per Domination game:
- **"Create Reward Pack"** — 5 slots, odds inversely proportional to rating (best player ~8%, worst ~32%)
- **"Create RTTR Pack"** — 6 slots, odds proportional to rating (best player ~25%, worst ~8%), plus a `player_choice` slot (~17%)

Both create a `packs` record, `pack_odds` rows, and `pack_players` entries, then link as `pack_reward` on the game.

### 3. open-pack: Player's Choice Handling
When `result_slot = "player_choice"` is hit, return `{ player_choice: true, eligible_cards: [...] }` instead of a pulled card. Frontend shows a pick UI; user confirms with a second call.

### 4. Expanded Composite Archetypes
Add ~15 new archetypes to `archetypeEngine.ts` inspired by the templates:

- **Streetballer** — Playmaker + Slasher hybrid, flashy handles and finishing
- **Ankle Breaker** — Combo Guard with elite dribble + finishing emphasis
- **Showtime** — Athletic Playmaker, dunks + assists
- **Tower** — Rim Protector + Post Scorer, dominant paint presence
- **Enforcer** — Paint Beast + Lockdown, physical and intimidating
- **Brick Wall** — Glass Cleaner + Lockdown, minimal offense, max defense/rebounding
- **Sniper Elite** — Extreme Sharpshooter, near-zero interior game
- **Floor General** — Playmaker + high defensive IQ
- **Hustle Player** — High steal/rebound/INT, low scoring
- **Finesse Scorer** — Mid-range + finishing artist, no 3PT
- **Microwave** — Combo Guard variant, high variance instant offense
- **Clutch Scorer** — Consistent mid-range + finishing
- **Speedster** — High steal/INT/finishing, low size-based stats
- **Gauntlet Boss** — All-around elite, high floor on every stat

Also add `combineArchetypes(primary, secondary, ratio)` function that blends two archetype weight profiles.

### 5. Tier-Aware Generation
Add `tierOverride` param to `generateFromProfile` so autofill can explicitly set star rating (1-5) per generated player, ensuring the difficulty level matches the template.

### 6. Template Definitions (`src/lib/teamTemplates.ts`)
15 team templates (5 players each) and 10 run templates (3 players each). Each slot defines: archetype, optional secondary archetype + blend ratio, star range. Includes a randomized name generator with basketball-themed name pools.

### 7. Autofill & Per-Player Tools (AdminTeams + RunRosterManager)
- **Autofill** button with template dropdown — generates full roster
- **Quick Add** dropdown — pick any archetype (basic + composite), generates 1 player
- **Change Archetype** — regenerate a player's stats in-place with a new archetype
- **Swap** — replace a roster slot with an existing player via PlayerCombobox
- Star tier slider per slot to control difficulty

### 8. PlayerWizard Integration
- Add all composite archetypes to the archetype dropdown
- Add optional "Secondary Archetype" dropdown + blend ratio slider

## Files

| File | What |
|------|------|
| `src/lib/archetypeEngine.ts` | Add ~15 composite archetypes, `combineArchetypes()`, `tierOverride` |
| `src/lib/teamTemplates.ts` | New: 15 team + 10 run templates, name generator |
| `src/pages/admin/AdminCollections.tsx` | New: admin collection editor |
| `src/pages/admin/AdminTeams.tsx` | Autofill, auto-create reward/RTTR packs, quick-add, swap |
| `src/components/admin/RunRosterManager.tsx` | Autofill, quick-add, swap, change archetype |
| `src/components/admin/PlayerWizard.tsx` | Composite archetypes + secondary blend |
| `supabase/functions/open-pack/index.ts` | Handle `player_choice` slot |
| `src/App.tsx` | Route for AdminCollections |
| `src/components/AppSidebar.tsx` | Nav link |
| DB migration | Admin RLS on `user_collections` |

