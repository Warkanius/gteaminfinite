

# Trait Engine — Signature Trait Resolution for 5v5 and Runs

## Trait Data Summary

From the `signature_traits` table, there are 8 traits with these `condition_type` values:

| Trait | Abbr | condition_type | Effect |
|---|---|---|---|
| Home Hero | HH | `home` | +1 star/tier to target_stat if home game |
| Road Dawg | RD | `away` | +1 star/tier to target_stat if away game |
| Prime Time | PT | `key_game` | +1 star/tier to target_stat if key game |
| Underdog | UD | `underdog` | +1 star/tier to target_stat if opponent is higher rated |
| Underrated | Und | `low_stat` | +1 star/tier to target_stat if that stat is below average |
| _____ these _____s | FTN | `teammate` | +1 star/tier to a teammate's target_stat |
| Mr. Versatile | MV | `passive` | Adds a Badge slot per tier |
| Scientist | Sci | `passive` | Accelerates evolution progress (non-gameplay) |

The `player_card_traits` junction has a `target_stat` column specifying which stat receives the boost, and a `tier` (base/gold/diamond/hof/actolytrene).

## Key Design Decisions

- **Conditional traits** (home/away/key_game/underdog/low_stat) all follow the same pattern: +1 star per tier to `target_stat` when the condition is met
- **Teammate trait** (FTN) boosts a teammate's stat — similar to Floor General but trait-based
- **Mr. Versatile** adds badge slots — already handled in badgeEngine; traitEngine just exposes the same check
- **Scientist** is non-gameplay (evolution) — noted but not applied during rolls
- **Game context** (home/away/key_game) needs to be passed into the engine. For Runs, all games can default to "away" or we can add context flags later. For 5v5 Domination, the game metadata can indicate home/away/key status

## Implementation

### 1. Create `src/lib/traitEngine.ts`

```typescript
// Types
CardTrait { traitId, name, abbreviation, condition_type, target_stat, tier }
TraitActivation { traitName, abbreviation, tier, effect }
GameContext { isHome, isAway, isKeyGame }

// Core functions:
- fetchTraitsForCards(supabaseClient, cardIds[]) → Record<cardId, CardTrait[]>
- resolveTraitBoosts(stat, statValue, traits, context, opponentRating?, cardRating?, mode)
  → { adjustedStat, activations[] }
  // Checks each trait's condition_type against context/matchup
  // Adds +1 star (5v5) or +20 points (runs) per tier level
- resolveTeammateTraitBoosts(stat, statValue, teammateTraits[], mode)
  → { adjustedStat, activations[] }
  // FTN trait: if any teammate has it targeting this stat, apply boost
- getTraitBadgeSlots(traits) → number
  // Mr. Versatile: returns extra badge slots
- getEvolutionMultiplier(traits) → number
  // Scientist: returns multiplier (1.0 = no boost)
```

Boost per tier: base=1, gold=2, diamond=3, hof=4, actolytrene=5 (stars for 5v5, ×20 for runs).

### 2. Fetch traits at lineup confirmation

**`src/components/game/LineupSelect.tsx`** and **`src/components/game/RunLineupSelect.tsx`**: fetch `player_card_traits` joined with `signature_traits` alongside badges. Pass a `traitMap: Record<string, CardTrait[]>` to the game boards.

### 3. Apply traits in game boards

**`src/components/game/GameBoard.tsx`** (5v5): Before badge resolution, apply trait boosts to the stat value. Order: traits → debuffs → boosts → roll → rerolls → bonuses.

**`src/components/game/RunGameBoard.tsx`** (Runs): Same — apply trait boosts to shooter/defender stat before badge resolution.

### 4. Game context

Pass a `GameContext` object to game boards. For Domination 5v5, derive from game metadata. For Runs, default to `{ isHome: false, isAway: true, isKeyGame: false }`. The underdog/low_stat conditions are derived from card data at resolution time.

### Files to create/modify
- **Create**: `src/lib/traitEngine.ts`
- **Edit**: `src/components/game/LineupSelect.tsx` — fetch traits
- **Edit**: `src/components/game/RunLineupSelect.tsx` — fetch traits
- **Edit**: `src/pages/Play.tsx` — pass traitMap state
- **Edit**: `src/pages/RunPlay.tsx` — pass traitMap state
- **Edit**: `src/components/game/GameBoard.tsx` — apply trait boosts before badge resolution
- **Edit**: `src/components/game/RunGameBoard.tsx` — apply trait boosts before badge resolution

