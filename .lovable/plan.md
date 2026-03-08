

# Improve Player Creation/Editing UX

## 1. Color Picker for Card Colors
Replace the raw HSL text inputs (Primary, Secondary, Glow) with a visual color picker component. Build a reusable `HslColorPicker` that shows a color swatch + popover with hue/saturation/lightness sliders, outputting HSL strings in the existing format. The preview card updates live as before.

## 2. "Use as Template" on Existing Players
Add a "Copy from Player" dropdown/search at the top of the Add Player form. Selecting a player loads their stats, badges, traits, positions, gem tier, and card appearance into the form -- but leaves name blank. This lets admins clone an existing player as a starting point for a new one.

Implementation: Add a `Select` or `Combobox` at the top of the form dialog. On selection, fetch that player's badges/traits (same as `openEdit`) and populate the form state, but keep `editId = null` so it creates a new record.

## 3. Playstyle Templates
Add predefined stat templates for common archetypes (e.g. "Sharpshooter", "Slasher", "Lockdown Defender", "Playmaker", "Glass Cleaner", "Two-Way"). Each template sets default stat distributions. Implemented as a simple constant map in the component -- selecting one fills in the 9 stat fields with preset values. Admins can then tweak from there.

## 4. Bulk Badge Import via Abbreviations
Add a text area in the Badges section where admins can paste a comma-separated list of badge abbreviations with optional tier, e.g.:
```
HG:gold, DS:hof, QFS:base
```
Parsing logic: split by comma, match each abbreviation against `allBadges` by the `abbreviation` field, resolve tier (default to "base" if omitted). Matched badges get appended to the form's badge list. Show a toast for any unrecognized abbreviations.

## Technical Approach

All changes are in `src/pages/admin/AdminPlayers.tsx` plus a new `src/components/admin/HslColorPicker.tsx` component. No database changes needed -- this is purely UI/UX improvement on the admin form.

### Files to create:
- `src/components/admin/HslColorPicker.tsx` -- popover with H/S/L sliders, swatch preview, outputs HSL string

### Files to modify:
- `src/pages/admin/AdminPlayers.tsx`:
  - Add playstyle templates constant + selector dropdown
  - Add "Copy from Player" combobox
  - Replace 3 HSL text inputs with `HslColorPicker`
  - Add bulk badge import textarea + parse button

