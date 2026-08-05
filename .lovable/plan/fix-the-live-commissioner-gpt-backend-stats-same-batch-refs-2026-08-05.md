# Fix the live Commissioner GPT backend: stats, same-batch refs, verified end to end

Project reference: `tgcmhmcgxzabimgnzsiu`. Everything below lands in the deployed `actions` edge function plus the database functions that back it, and is then exercised with live zero-write requests against that project.

## What I verified before planning

- The live `openapi.json` (40 operations) already exposes `previewBulkPlayers` / `commitBulkPlayers` with every base stat and every `run_stat_*` field typed as `number`, and the shared numeric parser accepts JSON numbers (it stringifies before parsing, so `1` is valid). So Test A's failure is a runtime/deployment question, not a schema-typing one — the first step is reproducing it live and fixing whatever the real rejection is.
- The live content-release request schema has **no** flat `stat_*` fields, no `run_stat_*` fields and no `run_stats` object on release players. Its normalizer only reads a nested `stats` object of base stats. Runs stats sent by the GPT are silently rejected or dropped — confirmed gap.
- Same-batch evo source binding is genuinely broken **in preview**. `admin_apply_batch` marks a not-yet-written card's temp ref as `pending`, `admin_substitute_refs` then emits `player_card_id_pending` instead of `player_card_id`, and `admin_apply_evo_core` raises `MISSING_SOURCE_CARD`. Commit works; zero-write preview cannot resolve a card created in the same payload.
- Locker codes cannot be part of a release at all: the release input type has no `locker_codes`, and the pack the release builds carries no `temp_ref`, so nothing in the batch can point at it. The batch engine does run `locker_codes` after `packs`, so the ordering is already correct once a ref exists.

## Fixes

1. **Content-release stats (Test B).** Accept base and Runs stats on release players in flat (`stat_3pt`, `run_stat_3pt`), nested (`stats`, `run_stats`) and aliased form; normalize them into one canonical block, range-check 0–99, and carry every value into the built batch payload so it is part of the canonical hash and committed unchanged. Same treatment for evo `resulting_version` Runs stats.

2. **Same-batch evo source (Test C).** Teach the evo path in the batch engine to accept a pending same-batch source: when a source resolves to a pending temp ref during preview, report the source as `pending:<ref>` in `resolved_references` and continue validating the step instead of raising `MISSING_SOURCE_CARD`. Commit behaviour is unchanged (by then the id exists). Document the accepted reference form so the GPT can rely on it.

3. **Same-batch locker code (Test D).** Add a `locker_codes` section to the release input, give the release's pack a `temp_ref`, and emit each code with a `pack_ref` pointing at it. Apply the same pending-ref tolerance in preview for the locker-code reward pack so the plan validates with zero writes.

4. **Bulk numeric stats (Test A).** Reproduce live first. If the deployed function is behind the repo, redeploying fixes it; if a real rejection surfaces, fix it at its source in the shared normalizer, keeping numbers, numeric strings and nested blocks all valid.

5. **Capabilities honesty.** Update the capabilities payload so it describes only what the deployed functions actually do — including the new release stat fields, the documented same-batch reference form, and locker-code-in-release support.

6. **Schema surface for the GPT.** Extend the content-release OpenAPI request schema with the stat fields, the same-batch reference field and the `locker_codes` array so ChatGPT can actually send them, and keep every existing `operationId` unchanged.

## Deploy and verify live

Deploy `actions` (and `admin-api-scheduler` if it shares changed code) to the project above, then run the four requested tests against the deployed endpoints using an authenticated admin session, and prove no writes:

- A: one temp player, nine base stats = 1, nine Runs stats = 1, `rating` = 1, `run_rating` = 1 → expect `wrote_anything: false` and every numeric field present in the normalized payload.
- B: a draft release with one new player carrying all base and Runs stats → expect every stat preserved in the normalized payload and reflected in the payload hash.
- C: a release preview with a new player and an evo path whose source is that same new player → expect the source resolved without a prior commit.
- D: a release preview with a new pack and a locker code referencing it → expect the pack resolved without a prior commit.

Write-proof: capture row counts for `player_cards`, `packs`, `locker_codes`, `evo_paths`, `release_bundles` and `content_audit_log` before and after the four previews and show them unchanged.

## What I will report back

Files changed, deployed function names, deployment timestamp, live project reference, the exact request and response body for each of the four tests, the before/after row counts proving zero writes, and the exact GPT-side action needed (re-import `openapi.json`) with the list of newly sendable fields.

## Technical notes

Files expected to change: `supabase/functions/actions/contentRelease.ts` (stat normalization, locker codes, pack temp ref, evo ref), `supabase/functions/actions/openapi.ts` (release schema fields), `supabase/functions/actions/index.ts` (release routing for the new section), `supabase/functions/_shared/admin-api/normalize.ts` and `capabilities.ts` (only if Test A reveals a real defect / for accurate capability text), plus one database migration for `admin_apply_evo_core` and the locker-code apply path to tolerate pending same-batch refs during preview. Tests in `src/test/` are updated alongside, but the live round-trips are the acceptance criteria.
