

# Fix Wizard Reset & Add Signature Trait Slot Limits

## Problems
1. **Wizard doesn't reset between players** — `resetWizard()` only fires when `open` transitions to `true`, but if the wizard is already open or the `editingPlayer` prop changes, stale state persists.
2. **Signature traits are unlimited** — no cap on how many traits can be added.
3. **Mr. Versatile should scale trait slots too** — currently MV only adds badge slots.

## Changes

### `src/components/admin/PlayerWizard.tsx`

**Reset on every open + editingPlayer change:**
- Add a `useEffect` that calls `resetWizard()` when `open` becomes `true` or when `editingPlayer` changes while open. This ensures fresh state per player.

**Trait slot limit:**
- Base trait slots = **1**
- Mr. Versatile adds trait slots using the same tier map as badges: base +1, gold +2, hof +3, diamond +4, actolytrene +5
- Add a `maxTraits` computed value: `1 + mrVersatileSlots`
- Guard `addTrait()` with `result.traits.length >= maxTraits` check
- Hide the "add trait" search when at capacity
- Update the trait label to show `({count}/{maxTraits})`
- Show MV bonus info next to trait label (similar to badge label)

**No changes needed to `AdminPlayers.tsx`** — the wizard is the only place trait limits are enforced during creation.

