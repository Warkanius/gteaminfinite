

# Fix: Wizard Accept Doesn't Apply Stats to Player

## Problem

When the wizard's "Accept" is clicked:

- **New player path** (line 261–272): Works correctly — sets form, opens the dialog (`setDialogOpen(true)`), user clicks Save.
- **Edit player path** (line 250–259): Sets `form` state but **never sets `editId`** and **never opens the dialog**. The form state updates silently in the background with no way for the user to save it.

## Fix

In `handleWizardAccept`, when `wizardEditPlayer` is truthy:

1. Set `editId` to `wizardEditPlayer.id` so the save mutation knows it's an update
2. Set `dialogOpen(true)` so the form dialog opens with the wizard-applied stats pre-filled
3. The user can then review and click Save as normal

**File:** `src/pages/admin/AdminPlayers.tsx` — lines 250–258

Change from:
```typescript
if (wizardEditPlayer) {
  setForm(f => ({
    ...f,
    ...result.stats,
    position1: result.positions[0],
    position2: result.positions[1],
    badges: result.badges,
    traits: result.traits,
  }));
  toast.success(`Wizard applied: ${result.summary}`);
```

To:
```typescript
if (wizardEditPlayer) {
  const playerData = await loadPlayerData(wizardEditPlayer);
  setForm({
    ...playerData,
    ...result.stats,
    position1: result.positions[0],
    position2: result.positions[1],
    badges: result.badges,
    traits: result.traits,
  });
  setEditId(wizardEditPlayer.id);
  setDialogOpen(true);
  toast.success(`Wizard applied: ${result.summary}`);
```

This loads the existing player's full data first (gem tier, team, colors, etc.), overlays the wizard results, then opens the edit dialog so the user can review and save.

The function signature also needs to become `async` since `loadPlayerData` is async.

