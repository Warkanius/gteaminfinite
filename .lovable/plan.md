

# Run Roster Manager — Split Layout + Quick Edit Visibility

## Problem
The current RunRosterManager shows everything in a single mixed list — roster players, pending players, and the entire selection pool are interleaved. This makes it hard to see who's actually in the run vs. who's available. Quick edit buttons exist but are buried in the list.

## Plan

### Restructure into Two Clear Sections

**Section 1: "Current Roster" (top)**
- Dedicated panel showing only players currently in `run_players` for this run
- Each row shows: name (clickable for quick edit), pencil icon, position, rating, run stats summary, and a remove button
- Shows the count prominently (e.g. "5 Players in Roster")
- Clear All button stays here

**Section 2: "Add Players" (bottom, collapsible)**
- Contains the search bar, autofill templates, quick add, mass import
- Player list here shows ONLY players NOT already in the roster
- Checking a player adds them to pending review (existing flow)
- Pending review section stays between the two as it is now

### Quick Edit Integration
- Both sections get clickable player names + pencil icons that open `PlayerQuickEdit`
- Roster section names are more prominent (not buried in a checkbox list)

### File Changed
| File | Change |
|---|---|
| `src/components/admin/RunRosterManager.tsx` | Split single list into "Current Roster" panel + "Add Players" panel; roster section shows only rostered players with edit buttons; selection pool excludes rostered players |

