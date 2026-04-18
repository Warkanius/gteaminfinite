

## Goal
Change the Run autofill so it **always adds 3 fresh players** per click, regardless of existing roster size. The pool keeps expanding in batches of 3. Domination + Team autofill stays untouched.

## What's wrong now
`src/components/admin/RunRosterManager.tsx` line 305-312:
```ts
const existingCount = rosterCardIds.size;
const remainingSlots = template.slots.slice(existingCount);
if (remainingSlots.length === 0) {
  toast.info("Roster is already full for this template.");
  return [];
}
```
This caps the run roster at 3. After the first autofill, every subsequent click does nothing.

## Fix (one block in `RunRosterManager.tsx`)
Replace lines 305-312 with:
```ts
// Always add a fresh batch of all template slots (3 players)
const remainingSlots = template.slots;
```
Result: each "Autofill Template…" pick adds 3 brand-new generated players to the run pool. Picking the same template twice = 6 players total. Picking a different template adds 3 more from that template's archetypes.

## Out of scope
- `AdminTeams.tsx` autofill (Domination + Team) — unchanged, keeps the "fill remaining slots" behavior.
- Quick Add — already adds one at a time, untouched.
- No UI changes — same dropdown, same "Autofill Template…" label.
- No changes to `RUN_TEMPLATES` — still 3 slots each, just applied repeatedly.

## Files touched

| File | Change |
|---|---|
| `src/components/admin/RunRosterManager.tsx` | Lines 305-312: drop the `slice(existingCount)` cap and the "already full" early return so every click fills the full 3-slot template |

