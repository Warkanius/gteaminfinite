

## Goal
Ship the location-aware media accounts system with **everything configurable from the admin UI** — no hardcoded thresholds, no hidden copy, no magic numbers in code.

## Posting behavior (recap)
- **Domination games**: every game posts a final-score tweet that names the top scorer + any notable stat lines.
- **Runs games**: NO score posts. Only `appearance` (high-tier card shows up), `evolution`, and `streak` (new personal high) posts.
- **Signings**: high-tier cards entering `user_collections` post under a league-wide signings account.

## Schema

New tables:
- `location_accounts` — `id, name, handle, avatar_url, accent_color, personality, location_type ('road'|'run'|'league'), road_name?, run_id?, is_active, created_at, updated_at`. RLS: admins manage, authenticated read.
- `location_records` — per `(user_id, location_account_id)`: games_played, wins, losses, current_streak, longest_win_streak, high_score, biggest_blowout, last_played_at. RLS: users read/write own; admins read all.
- `location_post_templates` — `id, personality, event_type, template_text, is_active, sort_order`. Admin-managed copy library. RLS: admins manage, authenticated read.

Extend `social_posts` with `location_account_id uuid null` and `event_type text null`.

## Admin-configurable surfaces

Everything below lives in the admin UI — zero hardcoded values in app code.

### 1) `AdminRules.tsx` — new keys (all editable, with helpful descriptions)
- `signing_min_gem_tier` — gem tier name; cards at/above this tier trigger a signing post. Default `Diamond`.
- `runs_appearance_min_gem_tier` — gem tier name; cards at/above this tier trigger an appearance post. Default `Pink Diamond`.
- `notable_performance_thresholds` — JSON: `{ points: 25, assists: 10, rebounds: 10, stocks: 6, double_double: true }`.
- `signing_post_cooldown_minutes` — per-user cooldown. Default `5`.
- `appearance_cooldown_hours` — per-card-per-run cooldown. Default `24`.
- `league_signings_account_id` — which `location_accounts` row to use as the league fallback for signings/orphan events.
- `personalities_enum` — JSON array of allowed personality keys. Default `["hype","analyst","trash_talker","historian","meme"]`.

The Rules editor already supports JSON values via `JsonEditor`. Add inline tier-dropdowns when the key matches one of the tier rules so admins don't have to type names.

### 2) `AdminSocialFeed.tsx` — new "Location Accounts" panel
DataTable + add/edit dialog:
- Name, handle, avatar upload (uses existing `social-images` bucket), accent color (`HslColorPicker`).
- `location_type` radio: Road | Run | League.
- If Road: dropdown of distinct `road_name` values from `domination_games`.
- If Run: dropdown of `runs` rows.
- Personality select sourced from the `personalities_enum` rule (so admins can extend it).
- Active toggle.
- "Generate accounts for all locations" bulk button — creates a default account for any road/run that lacks one (admin can edit afterward).
- Posts list gains a Location column + filter by location account + filter by `event_type`.

### 3) New "Post Templates" panel in `AdminSocialFeed.tsx`
Full CRUD over `location_post_templates`:
- Filter by personality + event_type.
- Edit `template_text` with placeholder reference shown inline (`{user}`, `{opponent}`, `{score}`, `{top}`, `{topPts}`, `{notable}`, `{player}`, `{tier}`, `{streak}`, `{venue}`).
- Toggle active.
- "Seed defaults" button to insert a starter pack of templates per personality × event_type the first time.

This means the entire voice of the league is editable — admins can rewrite, delete, or add new personalities + templates without touching code.

## Edge function

`supabase/functions/post-league-event/index.ts` (verify_jwt = false, validates JWT in code, uses service role for inserts):

- Reads all thresholds, cooldowns, and the league fallback account id from `rule_config` at call time (no env vars, no constants).
- Resolves `location_accounts` by `road_name` / `run_id`; falls back to `league_signings_account_id` for orphan events; silently no-ops if no account is configured and no league fallback exists.
- Updates `location_records` for `game_result`; chains a `record_broken` post when a high is set.
- Picks a random row from `location_post_templates` matching the resolved account's personality + event_type; fills placeholders; inserts into `social_posts`.
- Enforces cooldowns by reading the latest matching post's `posted_at`.

## Wiring (thin client wrapper)

`src/lib/leagueEvents.ts` — typed `postLeagueEvent(payload)` calling the edge function. Used by:
- `GameResults.tsx` → `game_result` (Domination only) with computed `top_scorer` + `notable[]`.
- `RunGameBoard.tsx` → `appearance` on lineup confirm, `streak` after `user_runs` upsert when new high set.
- `CardDetailDialog.tsx` → `evolution` on grant.
- `open-pack`, `claim-starter-pack`, `buy-auction-card`, `redeem-locker-code` → `signing` after collection insert.

Client never enforces thresholds — it just sends the event; the edge function decides whether to post.

## Dashboard

Replace the dead "Recent Games" / "Collection Progress" cards in `src/pages/Dashboard.tsx` with a single "League Feed" card showing the latest 4 `social_posts` (descending `posted_at`), with a "View all" link to `/feed`. Tweet/announcement renderers extracted from `SocialFeed.tsx` into `src/components/social/PostCard.tsx` for reuse. Empty state: "Play a game to make headlines."

## Files

### New
- DB migration: `location_accounts`, `location_records`, `location_post_templates`, `social_posts.location_account_id`, `social_posts.event_type`
- Seed `rule_config` rows: 7 keys listed above
- `supabase/functions/post-league-event/index.ts`
- `src/lib/leagueEvents.ts`
- `src/components/social/PostCard.tsx`

### Modified
- `src/pages/admin/AdminSocialFeed.tsx` (Location Accounts panel, Post Templates panel, posts filters)
- `src/pages/admin/AdminRules.tsx` (tier-aware editor for new keys)
- `src/pages/Dashboard.tsx`
- `src/pages/SocialFeed.tsx` (use shared `PostCard`, show location account when present)
- `src/components/game/GameResults.tsx`
- `src/components/game/RunGameBoard.tsx`
- `src/components/cards/CardDetailDialog.tsx`
- `supabase/functions/open-pack/index.ts`
- `supabase/functions/claim-starter-pack/index.ts`
- `supabase/functions/buy-auction-card/index.ts`
- `supabase/functions/redeem-locker-code/index.ts`
- `src/pages/Play.tsx`, `src/pages/RunPlay.tsx` (pass `runId` / `roadName` through)

## Validation
1. Admin can create/edit/delete location accounts and bulk-generate one per road/run.
2. Admin can edit every threshold, cooldown, and the personality enum from the Rules page.
3. Admin can write/edit/disable post copy templates per personality × event type.
4. Domination games post a score with top scorer and notable line when applicable.
5. Runs games post only appearances, evolutions, and streak records — never scores.
6. Signings only post for cards at/above the configured tier, respecting cooldown.
7. Dashboard shows latest 4 posts with working "View all" link; no broken inserts when a location lacks an account.

