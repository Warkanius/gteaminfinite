// Machine-readable capability discovery so the GPT never has to learn the
// backend by trial and error.

import { API_VERSION } from "./errors.ts";
import { GROUPS, ENTITY_TO_GROUP, EVO_OBJECTIVE_KEYS } from "./normalize.ts";
import { GEM_TIER_BANDS, STAT_KEYS, bandLabel } from "./decimal.ts";

export const LIMITS = {
  max_items_per_group: 500,
  max_entities_per_request: 1000,
  max_request_bytes: 5_000_000,
  max_inline_preview_bytes: 250_000,
  preview_token_ttl_minutes: 30,
  preview_detail_page_size: 50,
};

const REPLACEMENT_SEMANTICS: Record<string, string> = {
  "players[].badges": "full replacement when present; [] removes all; omit to leave untouched",
  "players[].traits": "full replacement when present; [] removes all; omit to leave untouched",
  "teams[].roster": "full ordered replacement",
  "packs[].players": "full ordered pool replacement",
  "packs[].odds": "full odds table replacement, must total exactly 100.00",
  "collections[].player_cards": "full ordered membership replacement",
  "runs[].roster": "full ordered opponent roster replacement",
  "runs[].rank_rewards": "GLOBAL ladder replacement shared by every Run",
  "domination_roads[].games": "merge by default; mode='replace' deletes unlisted games",
  "evo_paths[].steps": "action='replace_path': the submitted step list is authoritative — existing steps are updated in place by immutable evo_path_id, missing steps are created, leftover steps are DELETED with their objectives and playable versions. Send replace_existing_path:false for additive per-step upserts that never delete.",
  "evo_paths[].steps[].objectives": "full replacement of that step's objectives",
  "evo_paths[].steps[].resulting_version": "the single playable version of that step, replaced in place (badges and traits fully replaced)",
};

/**
 * The exact order admin_apply_batch applies groups in: parents strictly before
 * children, so a zero-write preview resolves real ids instead of guessing.
 * Kept in sync with the SQL by src/test/capabilityTruth.test.ts.
 */
export const GROUP_APPLY_ORDER = [
  "release_bundles", "gem_tiers", "badges", "signature_traits", "players",
  "collections", "sub_collections", "collection_requirements", "teams", "packs", "evo_paths",
  "gem_tasks", "runs", "domination_roads", "domination_games", "challenges", "locker_codes",
  "dynamic_duos", "storylines", "location_accounts", "social_posts",
] as const;

/** How preview reports links that can only resolve inside the commit transaction. */
export const DEFERRED_LINK_CONTRACT = {
  identity_deferred:
    "only when the pending reference decides WHICH record the item is (evo path source card, collection requirement parents) — the item is reported as a create with pending_references and validated on commit",
  link_deferred:
    "any other same-batch link (release bundle, team, collection, pack reward) is stripped for classification, the item is validated and classified as a real update or create, and the link is listed under deferred_references with warning DEFERRED_SAME_BATCH_LINK",
  never: "preview never reports an update as a create just because the item carries a same-release link",
};

const PLAYER_FIELDS = [
  "player_card_id (canonical)",
  "card_key",
  "player_name (input alias, resolved to id)",
  "new_name",
  "name",
  "position1",
  "position2",
  "gem_tier",
  "gem_name",
  "rating (decimal OVR)",
  "run_rating",
  ...STAT_KEYS,
  "run_stat_* (run-mode stats)",
  "team",
  "collection",
  "sub_collection",
  "is_collection_reward",
  "market_value",
  "social_handle",
  "avatar_url",
  "card_color_primary",
  "card_color_secondary",
  "card_animation",
  "status",
  "badges[] (replacement)",
  "traits[] (replacement)",
  "temp_ref / client_ref",
];

const PREVIEW_SECTIONS = [
  "summary",
  "creates",
  "updates",
  "deletes",
  "replacements",
  "destructive_operations",
  "resolved_references",
  "existing_links",
  "cross_release_contamination",
  "ambiguous_matches",
  "unsupported_fields",
  "ovr_checks",
  "operations",
  "warnings",
  "errors",
];

export function capabilities(base: string) {
  return {
    api_version: API_VERSION,
    base_url: `${base}/admin-api/${API_VERSION}`,
    exposed_operations: {
      bulk_players: {
        preview_operation: "previewBulkPlayers",
        commit_operation: "commitBulkPlayers",
        preview_path: `POST ${base}/admin-api/${API_VERSION}/bulk-players/preview`,
        commit_path: `POST ${base}/admin-api/${API_VERSION}/bulk-players/commit`,
        scope: "player cards only — releases, collections, packs, teams, evo paths and every other group are rejected with PLAYERS_ONLY_SCOPE",
        max_players_per_batch: LIMITS.max_items_per_group,
        max_payload_bytes: LIMITS.max_request_bytes,
        supported_fields: PLAYER_FIELDS,
        immutable_targeting: "player_card_id is authoritative; card_key next; a name that matches several cards is rejected with every candidate id listed; duplicate targets in one payload are rejected",
        badge_semantics: "full replacement when present; [] clears; omit to leave untouched",
        trait_semantics: "full replacement when present; [] clears; omit to leave untouched; target_stat validated",
        rating_precision: "decimal, up to 10 places, preserved exactly through hashing and commit",
        stat_range: "0-99 for the nine base stats and the nine run_stat_* stats",
        ovr_tolerance: "|rating - stat_total/9| <= 0.0000001 using exact integer arithmetic",
        gem_tier_bands: GEM_TIER_BANDS.map((b) => ({ tier: b.tier, ovr_band: bandLabel(b) })),
        atomicity: "all listed cards, badges and traits commit in one Postgres transaction or none do",
        preview_token_lifetime_minutes: LIMITS.preview_token_ttl_minutes,
        paged_preview: true,
        preview_sections: PREVIEW_SECTIONS,
      },
      content_release: {
        preview_operation: "previewContentRelease",
        commit_operation: "commitContentRelease",
        preview_path: `POST ${base}/admin-api/${API_VERSION}/bulk/preview`,
        commit_path: `POST ${base}/admin-api/${API_VERSION}/bulk/commit`,
        sections: ["release", "players", "collection", "collection membership", "collection reward", "team", "team roster", "pack", "pack pool", "pack odds", "evo_paths", "evo objectives", "playable resulting evo versions", "badges", "traits"],
        player_stat_support: "all nine base stats and all nine run_stat_* stats, identical to bulk_players",
        evo_path_semantics: REPLACEMENT_SEMANTICS["evo_paths[].steps"],
        evo_source_identifiers: ["player_card_id", "card_key", "player_name"],
        evo_objective_stats: EVO_OBJECTIVE_KEYS,
        resulting_version_fields: ["rating", "gem_name/tier", "nine base stats", "nine run stats", "positions", "presentation fields", "badges (replacement)", "traits (replacement + target_stat)", "evo stage", "status"],
        tier_order: GEM_TIER_BANDS.map((b) => b.tier),
        game_over_supported: true,
        collection_semantics: "ordered membership replacement, exactly one reward, reward never silently overwritten",
        pack_semantics: "ordered pool replacement, odds replacement totalling exactly 100.00 in fixed precision",
        team_semantics: "ordered roster replacement with explicit slots",
        cross_release_protection: "forbid_existing_links_to blocks preview-token issuance on contaminated cards",
        atomicity: "the whole release commits in one Postgres transaction or nothing is written",
        preview_token_lifetime_minutes: LIMITS.preview_token_ttl_minutes,
        paged_preview: true,
        preview_sections: PREVIEW_SECTIONS,
      },
    },
    mutation_contract: [
      "POST {entity|bulk|bulk-players}/preview  -> zero writes, canonical payload + payload_hash + single-use preview_token",
      "show creates/updates/deletes/replacements/warnings to the admin and get explicit approval",
      "POST {entity|bulk|bulk-players}/commit   -> byte-identical canonical payload + preview_token (+ optional idempotency_key)",
      "POST schedule               -> approved preview executed later, revalidated at run time",
    ],
    groups: GROUPS,
    group_apply_order: GROUP_APPLY_ORDER,
    deferred_reference_contract: DEFERRED_LINK_CONTRACT,
    entities: Object.keys(ENTITY_TO_GROUP).sort(),
    single_and_bulk_share_schema: true,
    fields: {
      players: PLAYER_FIELDS,
      collections: ["collection_id", "name", "new_name", "description", "player_cards[] (ordered, one is_reward)", "status", "temp_ref"],
      sub_collections: ["sub_collection_id", "name", "collection", "player_cards[]", "status"],
      packs: ["pack_id", "name", "new_name", "pack_type", "cost", "ten_box_cost", "players[] (ordered pool)", "odds[] {result_slot, percentage, description}", "status"],
      teams: ["team_id", "name", "new_name", "category", "unlock_cost", "roster[] (ordered)"],
      evo_paths: ["player_card_id (canonical source)", "card_key", "player_name", "source_gem_tier", "status", "steps[] {from_tier, to_tier, step_order, objectives[], resulting_version{rating, gem_name, stats, badges[], traits[]}}"],
      domination_roads: ["road_id", "name", "new_name", "mode (merge|replace)", "description", "sort_order", "games[]"],
      domination_games: ["domination_game_id", "road_id | road_name", "game_order (required target)", "opponent_name", "difficulty", "coin_reward", "gem_reward", "pack_reward", "roster[]"],
      challenges: ["challenge_id", "name", "challenge_type", "target_value", "series_length", "win_by", "stat_limits", "spotlight_player", "rewards", "prerequisite_challenge", "repeatable", "expires_at", "sort_order", "status"],
      locker_codes: ["code (upper-cased)", "reward_type", "reward_payload", "max_redemptions", "expires_at", "activates_at", "status"],
      dynamic_duos: ["name", "player_a", "player_b", "description", "is_active", "boost"],
      runs: ["run_id", "name", "target_score", "team", "milestones[]", "roster[]", "rank_rewards[] (GLOBAL)"],
      storylines: ["title", "description", "status", "entities[]", "players[]", "locker_codes[]", "posts[]"],
      social_posts: ["location_account", "content", "image_url", "scheduled_for", "status"],
    },
    replacement_semantics: REPLACEMENT_SEMANTICS,
    canonical_reference_fields: {
      player_card: "player_card_id",
      team: "team_id",
      collection: "collection_id",
      pack: "pack_id",
      domination_road: "road_id",
      domination_game: "domination_game_id",
      run: "run_id",
      challenge: "challenge_id",
      new_entities: "temp_ref / client_ref, resolved to real ids inside the commit transaction",
    },
    deprecated_aliases: {
      player_card_id: ["player_id", "card_id", "id", "name (uuid value)"],
      note: "Aliases are accepted in v1 and returned with a DEPRECATED_FIELD warning.",
    },
    evo_objective_stats: EVO_OBJECTIVE_KEYS,
    gem_tiers: GEM_TIER_BANDS.map((b) => ({ tier: b.tier, ovr_band: bandLabel(b) })),
    ovr_rule: "OVR = mean of the nine base stats, decimal, validated against the gem tier band with exact integer arithmetic (tolerance 0.0000001). Tiers are never auto-corrected.",
    stats: STAT_KEYS,
    fixed_precision: {
      odds: "hundredths, must total exactly 100.00",
      ovr: "hundredths",
      hashing: "canonical numeric text, so preview and commit hashes cannot drift on formatting",
    },
    limits: LIMITS,
    scheduling: {
      supported: true,
      timestamps: "stored UTC, optional timezone label echoed back",
      stale_payload_policy: "revalidated at execution; a changed plan fails the job instead of applying a stale payload",
    },
    atomic_transaction_scopes: [
      "one bulk document = one Postgres transaction across all groups",
      "one domination road (road + games + rosters + deletions)",
      "one storyline bundle (storyline + players + locker codes + posts)",
    ],
    permissions: ["read", "preview", "commit", "publish", "schedule", "delete", "manage_locker_codes", "manage_rewards", "manage_economy", "manage_global_run_rewards"],
    diagnostics_endpoint: `${base}/admin-api/${API_VERSION}/diagnostics`,
  };
}
