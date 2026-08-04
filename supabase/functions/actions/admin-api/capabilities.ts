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
  "evo_paths[].steps": "full path replacement including materialized versions",
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

export function capabilities(base: string) {
  return {
    api_version: API_VERSION,
    base_url: `${base}/admin-api/${API_VERSION}`,
    mutation_contract: [
      "POST {entity|bulk}/preview  -> zero writes, canonical payload + payload_hash + single-use preview_token",
      "show creates/updates/deletes/replacements/warnings to the admin and get explicit approval",
      "POST {entity|bulk}/commit   -> byte-identical canonical payload + preview_token (+ optional idempotency_key)",
      "POST schedule               -> approved preview executed later, revalidated at run time",
    ],
    groups: GROUPS,
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
    ovr_rule: "OVR = mean of the nine base stats, decimal, validated against the gem tier band (tolerance 0.05). Tiers are never auto-corrected.",
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
