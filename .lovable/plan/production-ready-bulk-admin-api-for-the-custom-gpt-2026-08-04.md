# Production-Ready Bulk Admin API for the Custom GPT

## Audit: what exists today

Single GPT-facing surface: `supabase/functions/actions` (OAuth-only, RLS as caller).

| Route | Backend handler | Preview/commit | Bulk? |
| --- | --- | --- | --- |
| `/diagnostics`, `/references`, `/list`, `/entity` | inline queries | read-only | n/a |
| `/players/{preview,commit}` | `admin_apply_player` | ad-hoc, no token | one card |
| `/teams`, `/runs`, `/packs`, `/locker-codes`, `/challenges`, `/dynamic-duos` | `admin_apply_content` | preview flag only, **no preview token** | one entity |
| `/domination-games/*` | `admin_apply_extra` | no token | one game |
| `/domination-roads/{preview,commit,delete}` | `admin_road_bulk` / `admin_road_delete` | token + hash | whole road |
| `/content-release/*` | `prepareRelease` + `admin_apply_batch` | token + hash | multi-entity |
| `/storyline-bundles/*` | `import-storyline-bundle` fn | no token | bundle |

### Confirmed drift and gaps

1. Two mutation architectures: token/hash-verified (`admin_road_bulk`, `admin_apply_batch`) vs unverified `admin_apply_content` / `admin_apply_player` / `admin_apply_extra` — a commit there is just "preview=false", so the approved payload is never enforced.
2. Client-side validation lives in duplicated files (`src/lib/contentRelease.ts` and `supabase/functions/actions/contentRelease.ts`, 932 lines each) — guaranteed drift.
3. Singular endpoints accept fields the bulk release ignores (run stats, market value, social handle, avatar, card colors/animation, sub-collection ordering).
4. Reference resolution is name-first in singular endpoints, ID-first only in release evo paths. Aliases (`player_id`, `player_name`, `card_key`) are not normalized to one canonical `player_card_id`.
5. No idempotency keys, no scheduling layer, no capabilities endpoint, no versioned path, no OVR↔gem-tier validation, no fixed-precision odds/hash normalization guarantees.
6. Audit coverage is partial (`content_audit_log` is written by road/batch paths only).
7. Diagnostics covers a fraction of the requested checks and returns no remediation guidance.

### Risk report (highest first)

- Unverified commits on 8 singular endpoints (approval bypass).
- Duplicated validators drifting between app and edge function.
- No idempotency → GPT/tool retries duplicate packs, locker codes, roads.
- Large payloads: single JSON response, no server-side preview storage or pagination.
- Global side effects (`run_rank_rewards` ladder) reachable without an explicit warning gate.

## Proposed canonical architecture

New versioned surface `/admin-api/v1/*` served by the same `actions` function, built on one pipeline:

```text
request -> resolve refs (IDs canonical) -> validate -> plan -> normalize
        -> hash -> preview token (single use, TTL, admin+op+version bound)
        -> approve -> commit(byte-identical payload + token) -> one transaction -> report
```

- **Shared code**: one `admin-api/` module tree inside `supabase/functions/actions/` (schemas, resolvers, validators, normalizer, planner, errors). The app imports the same files via a thin re-export so app and GPT cannot drift; a CI test asserts hash equality across both entry points.
- **Endpoints**: `POST /admin-api/v1/{entity}/preview|commit` for every entity, plus `POST /admin-api/v1/bulk/preview|commit` accepting the full release document (players, collections, sub-collections, packs, teams, evo paths, roads, challenges, locker codes, duos, runs, storylines, posts). Singular endpoints become thin wrappers over the bulk planner — no separate code path.
- **Preview storage**: previews persisted server-side (`admin_previews`) with `GET /admin-api/v1/previews/{id}?section=&page=` for paginated detail; one hash and one token per operation.
- **Scheduling**: `admin_scheduled_jobs` (UTC timestamps, timezone label, canonical payload, hash, approval record, status) executed by a cron edge function that re-plans and fails on drift instead of applying a stale plan.
- **Idempotency**: `idempotency_key` on every commit, unique per admin+operation, replaying the stored result.
- **Diagnostics/capabilities**: `GET /admin-api/v1/diagnostics` (all requested checks + remediation text) and `GET /admin-api/v1/capabilities` (entities, fields, replacement semantics, tiers, objectives, limits, TTLs, transaction scopes, version).
- **Errors**: uniform `{code, path, entity_type, entity_id, message, expected, received, written, remediation}`.
- **Compatibility**: existing routes stay, normalizing aliases and returning `deprecation` warnings; removal deferred to v2.

## Phased delivery

1. **Foundation** — canonical schema/resolver/validator/normalizer/planner module, fixed-precision decimal helpers, error model, capabilities endpoint, `/admin-api/v1` routing, alias normalization, contract-parity tests.
2. **Preview/commit hardening** — preview-token infra for every entity (including the 8 unverified ones), server-side preview storage + pagination, drift detection, idempotency, audit-log completion, preview/commit parity tests (zero-write assertions on row counts and timestamps).
3. **Bulk coverage** — bulk planner groups for all listed content types with explicit replacement semantics, OVR↔gem-tier validation, odds fixed-precision, reward/contamination guards, road merge/replace, full-release and road test suites.
4. **Scheduling + scale** — scheduled jobs table, cron executor with re-plan, edit/cancel endpoints, timezone handling, scale tests (100 players, 50 packs, 100 challenges, 100 locker codes, large roads), permission matrix for destructive/economy actions.
5. **Cutover** — OpenAPI regeneration under the 300-char operation-description limit, GPT instructions rewrite, migration notes, deprecation warnings, final GPT-driven end-to-end validation.

## Technical notes

- Postgres side: new `admin_api_plan(payload, version)` planner RPC wrapping the existing `admin_apply_batch` groups so one transaction still covers a whole release; `admin_preview_tokens` extended with admin id, operation type, api version, expiry, consumed_at; `admin_scheduled_jobs` and `admin_idempotency` tables with GRANTs and RLS (admin-only via `has_role`).
- Decimals: all ratings/odds/economy values handled as strings in normalization and `numeric` in SQL; hashing uses the canonical string form so preview and commit hashes cannot differ by formatting.
- Response limits: previews over a size threshold return summary + preview id; details fetched page by page.
- Tests: vitest for schemas/normalization/parity, Deno tests hitting the deployed function for transaction and rollback behavior.

Phase 1 lands first and is independently verifiable; each later phase ships behind the same versioned path without breaking the current GPT.
