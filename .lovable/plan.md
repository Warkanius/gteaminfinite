## GTeam Infinite Hub — Completion Audit (no files or schema changed)

Verified against the live codebase, the live database policies, `cron.job`, a typecheck, and the test suite. Overall: the product is far more complete than "prototype" — 39 routes, 17 admin pages, 12 edge functions, 45+ tables all with UI. The blockers are concentrated in **economy integrity** and a handful of **dead ends**, not missing features.

---

## P0 — Launch blockers

**1. The entire reward economy is client-authoritative and trivially exploitable (Critical)**
Live policy confirmed by query: `profiles` UPDATE = `USING (auth.uid() = user_id)` with **no `WITH CHECK` and no column restriction**. Every reward grant is a browser-side read-then-write:
- `src/components/game/GameResults.tsx:103-106` (win coins), `:177-181` (gems)
- `src/components/game/RunGameBoard.tsx:223` (milestones), `:284-290` (rank rewards)
- `src/pages/Collection.tsx:494` (collection reward claims)

Any signed-in user can run `supabase.from('profiles').update({coins: 999999999})` from devtools. Contrast: all *spending* paths (`open-pack`, `buy-gem-card`, `buy-auction-card`, `redeem-locker-code`, `quicksell-card`) are correctly server-authoritative. This inconsistency is the single biggest issue.

Related free-reward surfaces, all client-inserted with only `auth.uid() = user_id` checks:
- `user_evo_progress` insert/update — `src/lib/evoProgressTracker.ts:147,214`
- Evolution claim grants the evolved card client-side — `src/components/cards/CardDetailDialog.tsx:210-238`
- `challenge_completions`, `user_rttr_progress` — `GameResults.tsx:194,216`
- `user_rank_claims` — `RunGameBoard.tsx:274`
- `user_collections` self-insert — anyone can grant themselves any card

**Fix shape:** one `grant-rewards` edge function that recomputes rewards server-side from the game log / rank / collection state, plus tightening `profiles` UPDATE to a `WITH CHECK` that forbids coin/gem changes from the client (currency mutable only via service role).

**2. `profiles` is world-readable to all signed-in users** — policy `Profiles viewable by authenticated USING (true)` exposes every player's `display_name`, `team_name`, coins and gems. Fine if intentional for leaderboards; otherwise scope it or move to a public view.

**3. `/admin/*` has no role gate in the router** — `src/App.tsx:58-71` `ProtectedRoute` checks auth only. Any logged-in user can load `/admin/currencies` and every other admin page. DB RLS blocks most admin *writes* (`has_role` policies), but not the `profiles` writes on `AdminCurrencies.tsx:40,51` (see #1). Needs an `AdminRoute` wrapper using `role` from `useAuth`.

**4. Broken redirect: `/play/match` refresh → 404** — `src/pages/Play.tsx:72` navigates to `/game-hub`, a route that does not exist (`App.tsx` defines `/play`). Any refresh or direct visit to a match falls through to `NotFound`.

---

## P1 — Visible incompleteness and journey gaps

**5. No free-play / exhibition 5v5.** `/play/match` is only entered from `Domination.tsx:108` and `Challenges.tsx:58`. `GameHub.tsx` lists only Friends (dead), Runs, Challenges — it does not even link Domination. The headline "5v5 match simulation" has no standalone entry point.

**6. "Play With Friends" is a shipped dead link.** `src/pages/GameHub.tsx:6-12` → `url: "#"`; `src/pages/Dashboard.tsx:25` shows the same card but points at `/play`, so the two behave differently. Either disable both or ship the mode.

**7. Dynamic Duos never apply in Runs.** Resolved in `LineupSelect.tsx:314` and consumed by `GameBoard.tsx:27,36`, but `RunLineupSelect.tsx` / `RunGameBoard.tsx` contain zero references. Admin-configured duos silently do nothing in 3v3.

**8. Nav gaps.** `AppSidebar.tsx:39-53` omits `/challenges` and `/runs` — both only reachable via Dashboard/GameHub cards.

**9. Starter pack silently no-ops.** `Dashboard.tsx:46-104` only offers a starter pack if an admin created a `pack_type="starter"` pack; otherwise a brand-new user lands on an empty collection with no cards, no coins prompt, and no message. Needs a guaranteed onboarding grant.

---

## P2 — Copy, config, hygiene

**10. `index.html` still ships Lovable defaults**: `<!-- TODO: Update og:title... -->`, `og:title="Lovable App"`, `og:description="Lovable Generated Project"`, `twitter:site="@Lovable"`, duplicate `<meta name="author">`. Title/description are correct; social preview is not.

**11. `public/sw.js:14-15`** references `/pwa-192x192.png`, which does not exist — `public/` contains `icon-192.png` / `icon-512.png`. Push notification icons are broken.

**12. PWA is push-only.** `sw.js` has no `fetch` handler, so `display: standalone` in `manifest.json` gives no offline capability. Fine as a decision; worth stating. No `safe-area-inset-bottom` handling anywhere (only top, `AppLayout.tsx:21`) — bottom content can sit under the iOS home indicator.

**13. Dead files:** `src/pages/Index.tsx` (Lovable scaffold) and `src/pages/Placeholder.tsx` ("coming soon") are unrouted and unused.

**14. `supabase/config.toml` sets `verify_jwt = false` on every function.** Each function does re-check auth today, but the systemic risk is that one future function forgets.

**15. Supabase linter: 12 warnings**, mostly `SECURITY DEFINER` functions executable by `anon`/`authenticated` (`has_role`, `sync_gem_tier_collection`, `handle_new_user*`, `trg_gem_market_sync`) plus a public `social-images` bucket that allows listing. `sync_gem_tier_collection` being anon-callable is the one worth revoking.

**16. Build health is good.** Typecheck passes clean; `bunx vitest run` passes but there is exactly **one** test (`src/test/example.test.ts`) — effectively no coverage of `gameEngine.ts`, `badgeEngine.ts`, `traitEngine.ts`, or `evoProgressTracker.ts`.

**Corrections to note:** cron *is* configured — `refresh-auction` every 5 minutes and `publish-scheduled-posts` every minute are both active in `cron.job` (not visible in migrations, hence easy to misread as missing). MCP tooling is correctly admin-gated and `ALLOWED_TABLES` in `src/lib/mcp/db.ts:5-25` properly excludes `profiles` and user-owned tables.

---

## Recommended order of work

1. **Server-authoritative rewards** — new `grant-rewards` edge function; migrate `GameResults`, `RunGameBoard`, `Collection`, `CardDetailDialog` to call it; then tighten `profiles` UPDATE with a `WITH CHECK` and lock evo/claim tables.
2. **`AdminRoute` role gate** on all `/admin/*` routes.
3. **Fix `/game-hub` → `/play`** in `Play.tsx:72`.
4. **Onboarding guarantee** — ensure a starter pack always exists or grant a default; add a fallback message.
5. **Game mode surface** — add Domination + an exhibition 5v5 to GameHub; remove or disable the Friends card; add Challenges and Runs to the sidebar.
6. **Wire Dynamic Duos into Runs** (`RunLineupSelect` / `RunGameBoard`).
7. **Metadata + PWA cleanup** — real OG/Twitter tags, fix the SW icon path, bottom safe-area, delete `Index.tsx`/`Placeholder.tsx`.
8. **Harden the tail** — revoke anon EXECUTE on definer functions, tighten the `social-images` bucket listing policy, decide on `profiles` read scope, add engine unit tests.

Items 1–4 are launch blockers. 5–6 are product completeness. 7–8 are polish and can follow launch.
