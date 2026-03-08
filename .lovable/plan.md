

# Client-Side Player Archetype Generator (No AI Credits)

## Concept
Build a **keyword-based rule engine** entirely in the browser. You type basketball descriptions like *"badge heavy two-way slasher, hidden gem energy, elite finisher"* and it parses the keywords to generate stats and badge assignments -- scaled by gem tier. Zero API calls, zero credits, instant results. You can create hundreds of players in a session.

## How It Works

### Keyword Parser
A utility module (`src/lib/archetypeEngine.ts`) that:

1. **Tokenizes** the input into recognized keywords/phrases
2. **Resolves a base archetype** from terms like: slasher, sharpshooter, playmaker, lockdown, glass cleaner, stretch big, two-way, inside-out, post scorer, 3&D, rim protector, combo guard, point forward, etc.
3. **Applies modifiers** from terms like:
   - **"elite [stat area]"** → pushes that stat category to top of tier range
   - **"hidden gem"** → lower overall but 2-3 stats significantly above tier average, fewer badges but 1-2 at HOF/diamond
   - **"badge heavy"** → 8-12 badges, higher tier distribution
   - **"lights out"** → maxes shooting stats within tier
   - **"athletic freak"** → high FIN/DNK
   - **"high IQ"** → boosts INT/AST
   - **"raw / low floor"** → wider stat variance, some stats well below average
   - **"balanced / complete"** → tighter stat distribution around tier midpoint

4. **Scales to gem tier** using the `stars` field from `gem_tiers`:
   - 1★: stats 45-65, 1-3 badges (mostly base)
   - 2★: stats 55-75, 2-4 badges (base/gold)
   - 3★: stats 65-82, 3-6 badges (base-diamond)
   - 4★: stats 75-90, 5-8 badges (gold-HOF)
   - 5★: stats 85-99, 6-10 badges (diamond-actolytrene)

5. **Selects badges** by matching archetype stat focus areas to each badge's `affected_stat` and `effect_type`. Badge tier distribution follows the gem tier + "badge heavy" / "hidden gem" modifiers.

6. **Suggests positions** based on archetype (e.g., slasher → SG/SF, glass cleaner → PF/C).

7. **Adds slight randomness** (±2-4 points) so generating the same description twice gives similar but not identical results -- useful for creating roster depth.

### Output
Returns `{ stats, badges: [{abbreviation, tier}], positions, summary }` where summary is a short text like "Two-way slasher with elite finishing, badge-heavy build (Ruby tier)".

## UI Changes (`AdminPlayers.tsx`)
- Replace the static "Playstyle Template" dropdown with a **textarea** and **"Generate" button**
- Gem tier must be selected first (the generator needs it for scaling)
- On generate: populate stats, match badge abbreviations to `allBadges`, set positions, show summary toast
- Keep "Copy from Player" as-is
- Add a **"Re-roll" button** that re-generates with same description (new random seed)
- All generated values remain fully editable

## Files

### Create
- `src/lib/archetypeEngine.ts` -- keyword parser, stat generator, badge selector

### Modify
- `src/pages/admin/AdminPlayers.tsx` -- swap template dropdown for generator textarea + buttons

