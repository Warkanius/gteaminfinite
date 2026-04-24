## What's missing

The previous batch shipped the schema (`location_accounts`, `location_post_templates`, `location_records`) and seeded all the rule keys, but **no admin pages exist** to create or manage them. The Rules page has a "Location Account" picker but the dropdown is empty because there's nowhere to add accounts.

Today an admin can only:
- Edit raw rule JSON values at `/admin/rules`
- Manage hand-written social posts at `/admin/social-feed`

Today an admin **cannot**:
- Create a media outlet (e.g. "Court Report LA", `@courtreportla`, hype personality, road)
- Write or edit the post-copy library that drives auto-generated tweets
- See which outlet covers which road/run/league

## Plan: add two admin surfaces

### 1. Add a "Media Accounts" tab to `/admin/social-feed`

Keep the existing Posts + Creators tabs, add a third tab **"Media Accounts"** that manages `location_accounts`. Form fields:

- **Name** (text) — "Court Report LA"
- **Handle** (text, unique) — "courtreportla"
- **Avatar** (upload to `social-images` bucket, same pattern as creators)
- **Accent color** (HSL picker, same component creators use)
- **Personality** (select, options pulled live from `rule_config.personalities_enum` — adding a personality in Rules immediately appears here)
- **Coverage type** (select: `league` / `road` / `run`)
  - If `road`: show **Road name** text input
  - If `run`: show **Run** dropdown (pulled from `runs` table)
  - If `league`: no extra field
- **Active** (switch)

Table columns: avatar+name, handle, personality badge, coverage (e.g. "Road · Sunset Strip" or "Run · Venice Beach"), active toggle, edit/duplicate/delete.

### 2. Add a "Post Templates" tab to `/admin/social-feed`

Manages `location_post_templates` — the copy library that drives auto-generated posts. Form fields:

- **Personality** (select from `personalities_enum`)
- **Event type** (select: `game_result` / `appearance` / `evolution` / `streak` / `signing`)
- **Template text** (textarea, supports `{player}`, `{score}`, `{opponent}`, `{tier}`, `{stat_line}`, `{streak}` placeholders — show the legend below the textarea)
- **Sort order** (number)
- **Active** (switch)

Table grouped/filterable by personality and event type. Show a small "Preview" that substitutes example values so admins see what the tweet will look like.

Add a **"Seed default templates"** button that inserts a starter pack (~3 templates per personality × event type, 75 rows) so the system has copy to draw from on day one. Idempotent — skips rows that already exist.

### 3. Small fixes on `/admin/rules`

- The "Location Account" dropdown for `league_signings_account_id` already exists but is empty. Once tab #1 ships, it auto-populates.
- Add a one-line helper above the picker: *"Create accounts in Social Feed → Media Accounts."*

## Files to add / change

- **edit** `src/pages/admin/AdminSocialFeed.tsx` — wrap existing content in a `Tabs` (`Posts` / `Creators` / `Media Accounts` / `Post Templates`); add the two new tab panels with their own DataTables, FormDialogs, and mutations.
- **add** `src/components/admin/PostTemplatePreview.tsx` — small helper that renders a template with sample substitutions.
- No DB migration needed; tables and RLS already exist.

## Acceptance criteria

1. Admin can create, edit, duplicate, and delete media accounts from `/admin/social-feed → Media Accounts`.
2. Personality dropdown reflects whatever's currently in `rule_config.personalities_enum`.
3. Coverage selector toggles between league / road / run with the right secondary field.
4. Admin can manage post templates per personality × event type, with live placeholder preview.
5. "Seed default templates" populates a baseline copy library and is safe to click twice.
6. The `league_signings_account_id` picker on the Rules page now lists the accounts created in step 1.
