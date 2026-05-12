## What's still missing

**Event wiring (out of 5 event types):**
- ✅ `game_result` — already fires from `GameResults.tsx` (Domination only)
- ✅ `streak` — already fires from `RunGameBoard.tsx` on personal best
- ✅ `evolution` — already fires from `evoProgressTracker.ts` on path completion
- ❌ `signing` — never fires. Needs to fire after a card lands in inventory from a pack, locker code, gem market, or auction
- ❌ `appearance` — never fires. Needs to fire when a high-tier card actually plays (start of a Run game, start of a Domination game)

**Score/stat post detail:** game_result currently passes top scorer + notable lines, but the Run mode never posts a `game_result` at all (only streak). Per the original rules: Runs games should NOT post scores — that's already correct. So the gap is only Domination, and it's already wired. The reason the user "doesn't see scores/stats" is because no templates exist that include `{score}`, `{top}`, `{topPts}`, `{notable}` placeholders, and because signing/appearance events never fire.

**Team templates UX:** currently the admin picks a template name from a `<Select>` with no idea what the resulting roster will look like. We need to surface the **average star rating** (and per-slot star ranges) before they confirm the autofill.

---

## The fix

### 1. Wire `signing` events (server-side, gated by tier)

Fire after a card is added to a user's collection in any of these places. Each call goes to `post-league-event` with `event_type: "signing"`, `player_card_id`, `player_name`, `gem_tier_name`, and `user_display`. The edge function already enforces `signing_min_gem_tier` + per-account cooldown.

| Edge function | Where |
|---|---|
| `open-pack/index.ts` | After the final `user_collections` insert (both random pull and player's-choice paths) |
| `redeem-locker-code/index.ts` | After granting a `card` reward |
| `buy-auction-card/index.ts` | After transferring ownership |
| `buy-gem-card/index.ts` | After transferring ownership |
| `claim-starter-pack/index.ts` | After the bulk insert (one signing per qualifying card) |

Server-side calls invoke `post-league-event` via `fetch` to the function URL with the service role key, since they have no user JWT. Update `post-league-event` to accept service-role calls (skip the JWT check when the bearer matches `SUPABASE_SERVICE_ROLE_KEY` and trust an explicit `user_id` field in the body).

### 2. Wire `appearance` events (client-side, gated by tier)

- `RunGameBoard.tsx`: on first mount, iterate `playerLineup` and fire one `appearance` event per card whose tier ≥ `runs_appearance_min_gem_tier`, with `run_id`, `player_card_id`, `player_name`, `gem_tier_name`. Server-side cooldown (`appearance_cooldown_hours`, already implemented) prevents spam.
- `GameBoard.tsx` (Domination): same pattern, gated by a new rule `domination_appearance_min_gem_tier` (default `Pink Diamond`), fired with `road_name`.

Add the new rule editor + migration row.

### 3. Make sure templates emit useful posts

Extend the seed templates in `AdminSocialFeed.tsx` so every personality × event_type set includes at least one variant that uses `{score}`, `{top}`, `{topPts}`, and `{notable}` for `game_result`, and `{player}` + `{tier}` for `signing` / `appearance` / `evolution`. The "Re-seed defaults" button stays so admins can refresh after edits.

### 4. Team template preview with avg star rating

Update `src/lib/teamTemplates.ts` to export a helper:
```ts
export function summarizeTemplate(t: TeamTemplate | RunTemplate) {
  const mins = t.slots.map(s => s.starRange[0]);
  const maxs = t.slots.map(s => s.starRange[1]);
  const avgMin = mins.reduce((a,b) => a+b, 0) / mins.length;
  const avgMax = maxs.reduce((a,b) => a+b, 0) / maxs.length;
  return { avgMin, avgMax, slots: t.slots.length };
}
```

Replace the bare `<Select>` autofill picker in:
- `src/pages/admin/AdminTeams.tsx` (team roster + domination-game roster)
- `src/components/admin/RunRosterManager.tsx`

…with a popover/dialog that lists each template as a card showing:
- Template name + description
- **Avg ★ rating** (e.g. "Avg ★ 3.4 – 4.2")
- Per-slot breakdown (archetype + star range)
- "Use this template" button

Optionally add a roll-the-dice "Preview roster" button that runs the same name + star generator without inserting, so the admin can shuffle until they're happy, then confirm to commit.

### 5. Diagnostics

Add a small "Recent media activity" card to `AdminSocialFeed.tsx` showing the last 10 `social_posts` rows with their `event_type` so admins can confirm wiring at a glance.

---

## Files touched

**Event wiring**
- `supabase/functions/open-pack/index.ts` — fire `signing` after grant
- `supabase/functions/redeem-locker-code/index.ts` — fire `signing` after card reward
- `supabase/functions/buy-auction-card/index.ts` — fire `signing`
- `supabase/functions/buy-gem-card/index.ts` — fire `signing`
- `supabase/functions/claim-starter-pack/index.ts` — fire `signing` per card
- `supabase/functions/post-league-event/index.ts` — accept service-role calls + trust body `user_id`
- `src/components/game/RunGameBoard.tsx` — fire `appearance` on mount
- `src/components/game/GameBoard.tsx` — fire `appearance` on mount

**Templates**
- `src/pages/admin/AdminSocialFeed.tsx` — richer seed copy + recent-activity card

**Team template preview**
- `src/lib/teamTemplates.ts` — `summarizeTemplate` helper
- `src/pages/admin/AdminTeams.tsx` — preview UI before autofill (teams + dom games)
- `src/components/admin/RunRosterManager.tsx` — preview UI before autofill

**Migration**
- Add `domination_appearance_min_gem_tier` rule (default `Pink Diamond`)

## Acceptance
1. Opening a Diamond+ pack inserts a `signing` post; redeeming a card locker code does the same.
2. Starting a Run game with a Pink Diamond+ card inserts an `appearance` post (subject to cooldown).
3. Domination win posts a `game_result` mentioning top scorer + notable stat line, using configurable templates.
4. Admin Teams / Runs autofill flows show the **avg star rating** of each template before any players are created.
5. Admin Social Feed shows the last 10 league posts so misfires are obvious.
