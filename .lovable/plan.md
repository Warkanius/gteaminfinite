

## What's likely happening

Your brother is on the Dashboard, the "Choose Your Starter Pack" dialog appears, he picks one — and the app appears frozen. Looking at the code + DB:

1. **Edge function logs show zero invocations of `claim-starter-pack`**, and only one user has ever successfully claimed a starter pack (you, on Apr 5). So every other attempt has either never reached the function or failed silently.
2. The picker dialog is **inescapable** — `onOpenChange={() => {}}` and `onPointerDownOutside={preventDefault}` mean if anything goes wrong, the dialog can never be dismissed.
3. The claim handler in `Dashboard.tsx` has a silent-failure path: if `data` comes back undefined but `error` is also undefined (e.g. CORS preflight, timeout, network blip on mobile), the code falls through with **no toast**, no logging, and the picker stays open — looks like a freeze.
4. If the function does return, `setRevealCards(data.cards)` runs; if `data.cards` is missing/empty the whole `PackReveal` overlay will render in a weird state with no cards.
5. There is no error visibility — no `console.error`, no surfaced server message.

## Fix

### 1. Make the picker dismissable + always recover

In `src/pages/Dashboard.tsx`:

- Change `onOpenChange={() => {}}` to allow closing the dialog (e.g. `onOpenChange={(open) => { if (!claiming) setShowStarterPicker(open); }}`) so a failed claim doesn't trap the user.
- Add an explicit "Close" / "Skip for now" button on the picker so it's never a dead end.
- In `claimPack`, log every error to `console.error` and **always** toast on failure paths, including the `data == null` path. Also handle `data?.cards` being missing or empty as an error rather than passing it to `PackReveal`.

### 2. Make the edge function fail loudly + correctly

In `supabase/functions/claim-starter-pack/index.ts`:

- Add `console.log` / `console.error` at every branch (auth fail, no pack, already claimed, no players, insert error) so future attempts produce log entries we can read.
- Surface the actual Postgres error message in the JSON response when `insertErr` happens (currently it just returns a generic "Failed to add cards to collection" with no detail).
- Make the inserts atomic-enough: insert collection rows first, then `pack_purchases`, then fetch reveal cards. If `pack_purchases` insert fails, also remove the just-added collection rows so a retry isn't blocked by the "already claimed" check.
- After all DB work succeeds, return `cards: cards ?? []` and a clear `success: true`.

### 3. Defensive PackReveal

In `src/pages/Dashboard.tsx`, only enter the reveal flow when `data.cards.length > 0`. Otherwise toast "Something went wrong, please try again" and re-open the picker.

## Files touched

| File | Change |
|---|---|
| `src/pages/Dashboard.tsx` | Allow picker to close, surface all errors, add "Skip for now" button, guard against empty `data.cards` |
| `supabase/functions/claim-starter-pack/index.ts` | Add `console.log`/`console.error` at every branch, return real Postgres error messages, roll back collection inserts on later failure |

## Out of scope

- Not changing the starter pack data (it's correct: 4 packs × 5 players each).
- Not changing `open-pack` or the pack market flow — this is specifically the Dashboard claim flow.
- Not adding a server-side "claim again later" — once it's a real success it should still be one-time.

