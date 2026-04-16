

# Display Decimal OVR Everywhere

## Problem
OVR is displayed as a rounded integer (`rating` field) in most places. The user wants the computed decimal average of 9 stats (e.g., `2.4`) shown consistently everywhere.

## Approach
Create a shared `computeOVR` utility function and use it in all locations. Expand database queries where stats aren't currently fetched.

## Utility Function
**New: `src/lib/ovrUtils.ts`**
```ts
const STAT_KEYS = ["stat_3pt","stat_mid","stat_fin","stat_dnk","stat_ast","stat_stl","stat_reb","stat_blk","stat_int"];
export function computeOVR(card: Record<string, any>): string {
  const avg = STAT_KEYS.reduce((s, k) => s + (Number(card[k]) || 0), 0) / STAT_KEYS.length;
  return avg.toFixed(1);
}
```

## Changes by File

| File | Change |
|---|---|
| `src/lib/ovrUtils.ts` | New shared utility |
| `src/pages/admin/AdminPlayers.tsx` | Table column: use `computeOVR(r)` instead of `String(r.rating)` |
| `src/components/admin/PlayerQuickEdit.tsx` | Compute and display decimal OVR from form stats next to the star slider |
| `src/pages/admin/AdminTeams.tsx` | Expand `allPlayersLite` query to include stats; expand `team_players` join to include stats; display `computeOVR()` instead of `rating★` in roster and combobox |
| `src/pages/admin/AdminStarterPacks.tsx` | Expand player queries to include stats; display `computeOVR()` |
| `src/components/admin/RunRosterManager.tsx` | Stats already fetched — use `computeOVR(p)` instead of `p.rating★ OVR` |
| `src/components/admin/PlayerWizard.tsx` | Already uses `.toFixed(1)` — import shared util for consistency; update search result labels |
| `src/components/game/MatchupArrange.tsx` | Use `computeOVR()` for matchup display |
| `src/pages/FeedProfile.tsx` | Use `computeOVR()` for profile subtitle (needs stats in query) |

All locations will show format like `3.2 OVR` or `3.2★` consistently.

