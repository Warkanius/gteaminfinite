## What's actually broken

After tracing both issues end-to-end, here's what I found:

### A. Card glows aren't showing — real CSS bug
Every card component builds box-shadow like:
```ts
boxShadow: `0 0 18px 3px ${bg(visuals.glow)}40`
```
where `bg()` returns `hsl(270 70% 50%)`. The `40` is meant as alpha hex, but the result is the string `hsl(270 70% 50%)40` — **invalid CSS**, so the browser drops the entire box-shadow. That's why no glow renders, on any tier.

Affected files: `PlayerCard.tsx`, `RevealCard.tsx`, `CardDetailDialog.tsx`.

### B. Shimmer animation also broken
`.animate-shimmer` relies on `background-size: 200% 100%`. The cards set inline `background: linear-gradient(...)` which is the **shorthand**, so it resets `background-size` to `auto` and the shimmer keyframes have nothing to slide across. Pulse and holographic use `filter` so they're fine — but shimmer never actually moves.

### C. Media posts aren't appearing — three combined causes
1. `location_post_templates` is **empty in the database** (0 rows). The "Seed defaults" button in admin was never clicked. The edge function bails out silently when no templates match `(personality, event_type)`.
2. There are only 2 `location_accounts` and both are `location_type = 'road'`. There's no `league` account, and `league_signings_account_id` rule is `null` — so any event without a `road_name` or `run_id` (signings, generic evolutions, etc.) gets skipped with `no_location_account`.
3. Three event types are wired in code but **never actually called**: `signing` (no trigger on pack open / locker code), `evolution` (no trigger when an evo path completes), `appearance` (no trigger when a Run game starts).

### D. Admin can't tell something is misconfigured
The Templates / Media Accounts tabs work, but admins land on an empty list with no nudge to seed defaults or create a league account. The `league_signings_account_id` rule still expects a hand-typed UUID.

---

## The fix

### 1. Card glow + shimmer (visual)
Replace the broken alpha pattern in all 4 spots with a helper that emits valid `hsla(...)`:

```ts
// in src/lib/cardVisuals.ts
export function withAlpha(color: string, alpha: number): string {
  // alpha 0-1; supports "H S% L%" tokens, hsl(...), hex, named
  if (/^\d+\s+\d+%?\s+\d+%?$/.test(color)) return `hsla(${color} / ${alpha})`;
  if (color.startsWith("hsl(") && !color.startsWith("hsla(")) {
    return color.replace(/^hsl\(/, "hsla(").replace(/\)$/, ` / ${alpha})`);
  }
  // hex/named: fall back to color-mix where supported
  return `color-mix(in srgb, ${color} ${Math.round(alpha * 100)}%, transparent)`;
}
```

Then in the 4 components:
```ts
boxShadow: `0 0 18px 3px ${withAlpha(visuals.glow, 0.25)}, inset 0 1px 0 ${withAlpha(visuals.glow, 0.12)}`,
```

For the shimmer override, set `backgroundImage` (not the `background` shorthand) on the cards, and let the CSS class own `background-size`:
```ts
style={{ backgroundImage: `linear-gradient(135deg, ${bg(visuals.primary)}, ${bg(visuals.secondary)})`, ... }}
```

After this, glows render on every card and shimmer actually slides.

### 2. Make the media system work out of the box
- **Auto-seed templates on first load** of the Templates tab when the table is empty (one-time, idempotent), AND keep the manual "Re-seed defaults" button. Cover all 5 event types × 3 personalities (hype, analyst, troll) so something always matches.
- **Auto-create a default League account** on first visit to the Media Accounts tab if no `league` account exists (`name: "GTeam League"`, `handle: "@GTeamLeague"`, `personality: "hype"`, `location_type: "league"`).
- **Auto-set `league_signings_account_id`** to that league account's ID if the rule is null. Replace the text-input rule editor with an account-picker dropdown sourced from `location_accounts WHERE location_type = 'league'`.

### 3. Wire the missing event triggers (admin-friendly, configurable)
Each trigger is gated by a rule that's already in `rule_config` (or that we'll add):

| Event | Where to fire | Existing rule gate |
|---|---|---|
| `signing` | `open-pack` edge function (server-side) and `redeem-locker-code` after a card is granted | `signing_min_gem_tier` (already exists) |
| `evolution` | `evoProgressTracker.ts` after an evo path completes (client) | new rule `evolution_post_min_gem_tier` (default: `Diamond`) |
| `appearance` | `RunGameBoard.tsx` when a high-tier card enters a Run lineup | `runs_appearance_min_gem_tier` (already exists) |

Server-side triggers (signings) call the same `post-league-event` function with a service-role auth path so they don't need a user JWT.

### 4. Better admin diagnostics
- Add a small "System Status" banner at the top of `AdminSocialFeed.tsx` that shows: templates count, league account configured?, signing rule configured?, with one-click "Fix" buttons for each missing piece.
- In `post-league-event` edge function, add `console.warn` lines for each skip reason (`no_template_match`, `tier_below_min`, `cooldown_active`, `no_location_account`) so logs explain silence.

---

## Files touched

**Visual fix (4 files):**
- `src/lib/cardVisuals.ts` — add `withAlpha` helper
- `src/components/cards/PlayerCard.tsx` — use `withAlpha` + `backgroundImage`
- `src/components/packs/RevealCard.tsx` — same
- `src/components/cards/CardDetailDialog.tsx` — same

**Media system fix:**
- `src/pages/admin/AdminSocialFeed.tsx` — auto-seed templates, auto-create league account, system-status banner
- `src/pages/admin/AdminRules.tsx` — replace `league_signings_account_id` text input with account-picker; add `evolution_post_min_gem_tier` rule editor
- `supabase/functions/post-league-event/index.ts` — add diagnostic logs, accept service-role calls for `signing` events
- `supabase/functions/open-pack/index.ts` — fire `signing` event after granting a card at/above the gate tier
- `supabase/functions/redeem-locker-code/index.ts` — same for card-reward locker codes
- `src/lib/evoProgressTracker.ts` — fire `evolution` event when a path completes
- `src/components/game/RunGameBoard.tsx` — fire `appearance` event for qualifying cards on lineup lock

**Migration:** add `evolution_post_min_gem_tier` rule row (default `Diamond`).

## Acceptance
1. Every card shows a visible colored glow and shimmer cards visibly shimmer.
2. After approval, Admin → Social Feed shows a populated Templates tab and a "GTeam League" account exists automatically.
3. Opening a Diamond+ pack inserts a `signing` post; completing an evo path inserts an `evolution` post; locking a Pink Diamond+ card into a Run lineup inserts an `appearance` post.
4. Domination wins continue to post `game_result` with top scorer + notable lines.
5. Admin Rules page shows the league account in a dropdown — no UUIDs to copy.
