# ChatGPT-Powered Content Pipeline + League History Page

## Goal
Make ChatGPT a true co-author by giving every admin section a frictionless copy-prompt → paste-JSON loop, and surface the resulting narrative on a public League History page that looks and reads like NBA.com.

---

## Part 1 — Shared Import/Export Framework

A single reusable system every admin page plugs into.

### New components
- `src/components/admin/ChatGPTExchange.tsx` — One dialog with three tabs:
  1. **Copy prompt** — shows the pre-built prompt, "Copy" button, and an optional "context brief" textarea you can add ("make these all gauntlet-tier villains")
  2. **Paste JSON** — textarea + "Validate" → Zod check → preview table of every row (name, key fields, ✅/⚠️ flags)
  3. **Export** — pretty-printed JSON of current selection, copy/download
- `src/components/admin/ImportPreviewTable.tsx` — Generic preview grid with per-row include/exclude checkboxes. "Create N items" commits only checked + valid rows. **Create-new only**, never overwrites (matches your safety choice).

### New library
- `src/lib/chatgptSchemas.ts` — One Zod schema + one prompt builder per entity. Prompts include:
  - The JSON shape (strict)
  - Live reference data pulled from the DB at open time: archetypes list, badges, traits, gem tiers, existing rules, current evo paths, current templates
  - 1–2 real example rows
  - "Return ONLY a JSON array, no prose, no markdown fences"
- `src/lib/projectBundle.ts` — Builds a "project context bundle" (rules, archetypes, badges, traits, gem tiers, post templates, location accounts) that any prompt can embed so ChatGPT always has fresh reference.

### Where it plugs in
Add an **"AI Import / Export"** button to the header of each page:

| Admin page | Entity schema |
|---|---|
| AdminPlayers | Player cards (name, archetype, stars, stats, optional badges/traits/evo path slug) |
| AdminTeams | Team + 5 player slots (uses existing TemplatePicker preview) |
| AdminRules (Dominations section) | Domination matchups + rank rewards |
| RunRosterManager | 3v3 run rosters + run_rank_rewards |
| AdminChallenges | Challenges (criteria, rewards, dates) |
| AdminLockerCodes | Locker codes (code, contents, expiry, max redemptions) |
| AdminGemTasks | Gem tasks (objective, reward tier, cadence) |
| AdminSocialFeed | Post templates AND ad-hoc social posts (with linked account + scheduled_at) |
| AdminCollections / SubCollections / Sets | Collections + sub-collections |
| AdminDynamicDuos | Duo pairs + bonus rules |

---

## Part 2 — Storyline Bundle Import (Level-1 flavor)

A new admin page `src/pages/admin/AdminStorylines.tsx` that accepts a **single multi-entity JSON bundle** from ChatGPT — e.g. one arc that creates a rookie player, his 3 run opponents, a gauntlet team, and 4 timed social posts.

- One prompt template ("describe a storyline arc, get back a bundle")
- One Zod schema with sub-schemas for each entity type
- Preview screen groups items by type with cross-links shown ("Post #2 references Player: Marcus Hill")
- Single "Create all (N items)" commit, all-or-nothing transaction via an edge function `supabase/functions/import-storyline-bundle/index.ts`
- Stores the arc in a new `storylines` table so the League History page can render it as a narrative

---

## Part 3 — League History Page (public, NBA.com-style)

A polished public page at `/league` (and a nav entry).

### Layout (mobile-first, dark cosmic theme)
```text
┌────────────────────────────────────┐
│  LEAGUE HEADLINES  (big hero card) │  ← top "featured" post
├────────────────────────────────────┤
│  Top Story  │  Story  │  Story     │  ← 3-up secondary
├────────────────────────────────────┤
│  TRENDING NOW (horizontal scroll)  │  ← latest 10 social posts
├────────────────────────────────────┤
│  STORYLINES                        │
│   • Arc cards with progress + CTA  │
├────────────────────────────────────┤
│  RECENT MOVES (signings)           │
│  GAME RESULTS (last 5)             │
│  EVOLUTIONS                        │
└────────────────────────────────────┘
```

### Data sources (all existing)
- `social_posts` — filtered/grouped by event type (signing, game_result, appearance, evolution) and by `is_headline` flag
- `location_accounts` — shown as "publisher" chips
- `storylines` (new) — arc metadata + linked entity ids
- `domination_games`, `runs`, `user_runs` — for results widgets

### New fields
- `social_posts.is_headline boolean default false`
- `social_posts.headline_rank int` (1 = hero, 2–4 = secondary, null = standard)
- `social_posts.headline_image_url text` (optional, for hero treatment)

### New admin controls
In AdminSocialFeed: "Promote to headline" action with rank selector, plus drag-to-reorder of current headlines. ChatGPT prompts for posts include `is_headline` and `headline_rank` so you can ask GPT to draft a full week's front page.

### New components
- `src/pages/LeagueHistory.tsx`
- `src/components/league/HeadlineHero.tsx`
- `src/components/league/StoryGrid.tsx`
- `src/components/league/TrendingRail.tsx`
- `src/components/league/StorylineCard.tsx`
- `src/components/league/ResultsWidget.tsx`

### Profile pages
Player + team names on the league page link to existing `FeedProfile` / future player profile pages so a reader can click from a headline into the card's full history.

---

## Database changes (one migration)

- Add `is_headline`, `headline_rank`, `headline_image_url` to `social_posts`
- Create `storylines` table: title, summary, arc_image_url, status (draft/active/archived), starts_at, ends_at
- Create `storyline_entities` join: storyline_id, entity_type ('player'|'team'|'run'|'domination'|'post'|'locker_code'|'challenge'), entity_id
- RLS: read public for both; write admin-only
- GRANT select to anon for public read

---

## Technical details

- All Zod schemas live in `src/lib/chatgptSchemas.ts` and are reused by both the dialog validator and the storyline bundle.
- Prompts are dynamic — they query the DB at open-time and embed current archetypes/badges/traits/gem tiers/rules so ChatGPT can't suggest nonexistent values.
- Importer enforces **create-new only**: rows whose name+key collide with existing ones are flagged ⚠️ and excluded by default; you can opt-in row-by-row.
- Storyline bundle commit is wrapped in a single Edge Function so partial failure rolls back the whole arc.
- League History fetches via a small RPC `get_league_front_page()` that returns hero + secondary + trending + recent moves in one round-trip for fast first paint.

---

## File summary

**Created**
- `src/components/admin/ChatGPTExchange.tsx`
- `src/components/admin/ImportPreviewTable.tsx`
- `src/lib/chatgptSchemas.ts`
- `src/lib/projectBundle.ts`
- `src/pages/admin/AdminStorylines.tsx`
- `src/pages/LeagueHistory.tsx`
- `src/components/league/*` (5 components)
- `supabase/functions/import-storyline-bundle/index.ts`
- Migration for `storylines`, `storyline_entities`, and headline columns

**Edited**
- All admin pages listed above — add "AI Import / Export" button
- `AdminSocialFeed.tsx` — headline promotion controls
- `AppSidebar.tsx` / `App.tsx` — add `/league` route + admin storylines route

---

## Out of scope (deliberately)
- In-app AI generation via Lovable AI (Level 2) — can layer on later using the same schemas
- Storyline-driven multi-entity AI generation (Level 3)
- Upsert/overwrite imports — locked to create-new per your choice
