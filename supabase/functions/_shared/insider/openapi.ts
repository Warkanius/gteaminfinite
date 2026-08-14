// OpenAPI 3.1 schema for the GTeam Insider Custom GPT.
//
// Player-facing ONLY. Nothing here can mutate canonical game content: the whole
// write surface is saved lineups and card preferences, both scoped to the
// authenticated player by RLS.

import { BADGE_TIERS, FILTER_KEYS, INSIDER_API_LIMITS, LINEUP_MODES, RESTRICTION_KEYS } from "./rules.ts";

export const INSIDER_API_VERSION = "1.0.0";

const OBJ = (props: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  type: "object",
  properties: props,
  ...extra,
});

const STR = { type: "string" };
const NUM = { type: "number" };
const INT = { type: "integer" };
const BOOL = { type: "boolean" };

function q(name: string, schema: Record<string, unknown>, description: string, required = false) {
  return { name, in: "query", required, description, schema };
}

const okJson = (schemaRef: string, description = "Success") => ({
  description,
  content: { "application/json": { schema: { $ref: `#/components/schemas/${schemaRef}` } } },
});

const errorResponses = {
  "400": okJson("ErrorResponse", "Validation or ownership failure."),
  "401": okJson("ErrorResponse", "Missing or invalid player session."),
  "404": okJson("ErrorResponse", "Requested lineup, card or game does not exist."),
};

const COLLECTION_FILTER_PARAMS = [
  q("position", STR, "Filter to cards that can play this position (matches position1 or position2)."),
  q("gem_tier", STR, "Gem tier name, e.g. Emerald."),
  q("min_rating", NUM, "Minimum base overall rating."),
  q("max_rating", NUM, "Maximum base overall rating."),
  q("min_run_rating", NUM, "Minimum Runs rating (Runs point scale, 0-139)."),
  q("badge", STR, "Badge name or abbreviation the card must have."),
  q("badge_tier", { type: "string", enum: [...BADGE_TIERS] }, "Required badge tier; combine with badge."),
  q("trait", STR, "Signature trait name or abbreviation the card must have."),
  q("stat_key", STR, "Attribute key for min_stat, e.g. stat_3pt or run_stat_3pt."),
  q("min_stat", NUM, "Minimum value for stat_key."),
  q("evo_active", BOOL, "true = only cards with an in-progress EVO step."),
  q("evo_completed", BOOL, "true = only fully evolved cards."),
  q("evo_destination_tier", STR, "Gem tier this card's EVO leads to."),
  q("collection", STR, "Collection name or id."),
  q("favorite", BOOL, "Only cards the player marked favorite."),
  q("grinding", BOOL, "Only cards the player marked as grinding."),
  q("core_player", BOOL, "Only cards the player marked as core."),
  q("name", STR, "Case-insensitive player-name contains match."),
  q("limit", { type: "integer", maximum: INSIDER_API_LIMITS.max_collection_page_size }, "Page size."),
  q("offset", INT, "Page offset."),
];

export function buildInsiderOpenApi(baseUrl: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: "GTeam Insider API",
      version: INSIDER_API_VERSION,
      description:
        "Player-facing read and saved-lineup API for GTeam Infinite. Every personal operation resolves the player from the OAuth session; never send a user id. Cards are identified by owned_card_id (the player's owned instance) and a playable_version_id when an evolved version is active. This API cannot modify game content.",
    },
    servers: [{ url: baseUrl }],
    security: [{ OAuth2: [] }],
    paths: {
      "/v1/health": {
        get: {
          operationId: "getInsiderHealth",
          summary: "Connectivity, auth and API version check.",
          security: [],
          responses: { "200": okJson("Health") },
        },
      },
      "/v1/capabilities": {
        get: {
          operationId: "getInsiderCapabilities",
          summary: "Live description of available operations, lineup rules, filters and limits.",
          responses: { "200": okJson("Generic"), ...errorResponses },
        },
      },
      "/v1/references": {
        get: {
          operationId: "getInsiderReferences",
          summary: "Canonical gem tiers, positions, badges, traits, game modes and collections used by filters.",
          responses: { "200": okJson("Generic"), ...errorResponses },
        },
      },
      "/v1/collection": {
        get: {
          operationId: "getMyCollection",
          summary: "The authenticated player's owned playable cards with attributes, Runs attributes, badges, traits and EVO state.",
          parameters: [q("detail", BOOL, "Include full EVO step objectives and every playable EVO version."), ...COLLECTION_FILTER_PARAMS],
          responses: { "200": okJson("CollectionResponse"), ...errorResponses },
        },
      },
      "/v1/collection/summary": {
        get: {
          operationId: "getMyCollectionSummary",
          summary: "Compact collection overview: counts by tier and position, EVO counts, top cards, trait spread.",
          responses: { "200": okJson("Generic"), ...errorResponses },
        },
      },
      "/v1/card": {
        get: {
          operationId: "getMyCard",
          summary: "Full detail for one owned card, including EVO chain, objective progress and next/final playable versions.",
          parameters: [
            q("owned_card_id", STR, "Owned card instance id from getMyCollection."),
            q("player_card_id", STR, "Alternative: canonical player card id the player owns."),
          ],
          responses: { "200": okJson("CardResponse"), ...errorResponses },
        },
      },
      "/v1/cards/compare": {
        get: {
          operationId: "compareMyCards",
          summary: "Factual side-by-side comparison of 2 or more owned cards.",
          parameters: [q("owned_card_ids", STR, "Comma-separated owned card ids (2-6).", true)],
          responses: { "200": okJson("Generic"), ...errorResponses },
        },
      },
      "/v1/evo/progress": {
        get: {
          operationId: "getMyEvoProgress",
          summary: "EVO progress for every owned card that has an EVO path.",
          responses: { "200": okJson("EvoProgressResponse"), ...errorResponses },
        },
      },
      "/v1/evo/active": {
        get: {
          operationId: "getMyActiveEvos",
          summary: "Only in-progress EVO steps with per-objective current/target values and stage completion.",
          responses: { "200": okJson("EvoProgressResponse"), ...errorResponses },
        },
      },
      "/v1/evo/card": {
        get: {
          operationId: "getMyEvoCard",
          summary: "One card's EVO chain plus factual current-to-next version deltas (attributes, badges, traits, tier, rating).",
          parameters: [q("owned_card_id", STR, "Owned card instance id.", true)],
          responses: { "200": okJson("Generic"), ...errorResponses },
        },
      },
      "/v1/evo/overlap": {
        get: {
          operationId: "getMyEvoObjectiveOverlap",
          summary: "Which active EVO objectives can be progressed in the same games, and which conflict.",
          responses: { "200": okJson("Generic"), ...errorResponses },
        },
      },
      "/v1/lineups": {
        get: {
          operationId: "getMyLineups",
          summary: "All saved lineups for the authenticated player.",
          parameters: [q("mode", { type: "string", enum: Object.keys(LINEUP_MODES) }, "Filter by lineup mode.")],
          responses: { "200": okJson("LineupListResponse"), ...errorResponses },
        },
        post: {
          operationId: "createMyLineup",
          summary: "Create a saved lineup from owned cards.",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/CreateLineupRequest" } } },
          },
          responses: { "200": okJson("LineupResponse"), ...errorResponses },
        },
      },
      "/v1/lineups/get": {
        get: {
          operationId: "getMyLineup",
          summary: "One saved lineup with its exact cards and legality.",
          parameters: [
            q("lineup_id", STR, "Saved lineup id.", true),
            q("challenge_id", STR, "Optional: evaluate legality against this challenge."),
            q("domination_game_id", STR, "Optional: evaluate legality against this Domination game."),
            q("run_id", STR, "Optional: evaluate legality against this Run."),
          ],
          responses: { "200": okJson("LineupResponse"), ...errorResponses },
        },
      },
      "/v1/lineups/update": {
        post: {
          operationId: "updateMyLineup",
          summary: "Replace a saved lineup's name, notes and/or full slot list.",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/UpdateLineupRequest" } } },
          },
          responses: { "200": okJson("LineupResponse"), ...errorResponses },
        },
      },
      "/v1/lineups/rename": {
        post: {
          operationId: "renameMyLineup",
          summary: "Rename a saved lineup.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: OBJ({ lineup_id: STR, name: STR }, { required: ["lineup_id", "name"] }),
              },
            },
          },
          responses: { "200": okJson("LineupResponse"), ...errorResponses },
        },
      },
      "/v1/lineups/duplicate": {
        post: {
          operationId: "duplicateMyLineup",
          summary: "Duplicate a saved lineup, optionally under a new name.",
          requestBody: {
            required: true,
            content: {
              "application/json": { schema: OBJ({ lineup_id: STR, name: STR }, { required: ["lineup_id"] }) },
            },
          },
          responses: { "200": okJson("LineupResponse"), ...errorResponses },
        },
      },
      "/v1/lineups/delete": {
        post: {
          operationId: "deleteMyLineup",
          summary: "Delete a saved lineup.",
          requestBody: {
            required: true,
            content: { "application/json": { schema: OBJ({ lineup_id: STR }, { required: ["lineup_id"] }) } },
          },
          responses: { "200": okJson("Generic"), ...errorResponses },
        },
      },
      "/v1/lineups/set-default": {
        post: {
          operationId: "setDefaultLineup",
          summary: "Mark one saved lineup as the default for its mode.",
          requestBody: {
            required: true,
            content: { "application/json": { schema: OBJ({ lineup_id: STR }, { required: ["lineup_id"] }) } },
          },
          responses: { "200": okJson("Generic"), ...errorResponses },
        },
      },
      "/v1/lineups/validate": {
        post: {
          operationId: "validateMyLineup",
          summary: "Deterministically check whether a saved or proposed lineup is legal for a mode or a specific game.",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/ValidateLineupRequest" } } },
          },
          responses: { "200": okJson("LegalityResponse"), ...errorResponses },
        },
      },
      "/v1/eligible-cards": {
        get: {
          operationId: "getMyEligibleCards",
          summary: "Only the owned cards eligible for a specific game, with reasons for exclusions.",
          parameters: [
            q("challenge_id", STR, "Challenge to test eligibility against."),
            q("domination_game_id", STR, "Domination game to test eligibility against."),
            q("run_id", STR, "Run to test eligibility against."),
            q("mode", { type: "string", enum: Object.keys(LINEUP_MODES) }, "Mode when no specific game is given."),
            q("include_excluded", BOOL, "Include excluded cards with failed restriction categories."),
            q("limit", { type: "integer", maximum: INSIDER_API_LIMITS.max_collection_page_size }, "Page size."),
          ],
          responses: { "200": okJson("EligibleCardsResponse"), ...errorResponses },
        },
      },
      "/v1/challenges": {
        get: {
          operationId: "listChallenges",
          summary: "Playable challenges with rules, structured restrictions, rewards and this player's completion state.",
          responses: { "200": okJson("Generic"), ...errorResponses },
        },
      },
      "/v1/domination": {
        get: {
          operationId: "listDomination",
          summary: "Domination roads and games with difficulty, rewards and this player's progress.",
          responses: { "200": okJson("Generic"), ...errorResponses },
        },
      },
      "/v1/runs": {
        get: {
          operationId: "listRuns",
          summary: "Runs with target scores, rank rewards and this player's win progress.",
          responses: { "200": okJson("Generic"), ...errorResponses },
        },
      },
      "/v1/scout/challenge": {
        get: {
          operationId: "getChallengeScout",
          summary: "One payload with a challenge's rules, restrictions, full opponent roster and rewards.",
          parameters: [q("challenge_id", STR, "Challenge id.", true)],
          responses: { "200": okJson("ScoutResponse"), ...errorResponses },
        },
      },
      "/v1/scout/domination": {
        get: {
          operationId: "getDominationScout",
          summary: "One payload with a Domination game's difficulty, full opponent roster and rewards.",
          parameters: [q("domination_game_id", STR, "Domination game id.", true)],
          responses: { "200": okJson("ScoutResponse"), ...errorResponses },
        },
      },
      "/v1/scout/run": {
        get: {
          operationId: "getRunScout",
          summary: "One payload with a Run's rules, Runs-scale opponent roster and rank rewards.",
          parameters: [q("run_id", STR, "Run id.", true)],
          responses: { "200": okJson("ScoutResponse"), ...errorResponses },
        },
      },
      "/v1/progression": {
        get: {
          operationId: "getMyProgression",
          summary: "Completed and open challenges, Domination road progress and Runs progress.",
          responses: { "200": okJson("Generic"), ...errorResponses },
        },
      },
      "/v1/play-next": {
        get: {
          operationId: "getPlayNextCandidates",
          summary: "Structured candidates for what to play next, plus the player's active EVO objectives.",
          responses: { "200": okJson("Generic"), ...errorResponses },
        },
      },
      "/v1/preferences": {
        get: {
          operationId: "getMyCardPreferences",
          summary: "The player's own card preferences (favorite, grinding, core, do-not-recommend, EVO priority).",
          responses: { "200": okJson("Generic"), ...errorResponses },
        },
        post: {
          operationId: "setMyCardPreference",
          summary: "Set or clear preference flags on one owned card.",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { $ref: "#/components/schemas/PreferenceRequest" } } },
          },
          responses: { "200": okJson("Generic"), ...errorResponses },
        },
      },
    },
    components: {
      securitySchemes: {
        OAuth2: {
          type: "oauth2",
          flows: {
            authorizationCode: {
              authorizationUrl: "https://REPLACE_WITH_PROJECT_AUTH/authorize",
              tokenUrl: "https://REPLACE_WITH_PROJECT_AUTH/token",
              scopes: { openid: "Sign in", email: "Email address", profile: "Basic profile" },
            },
          },
        },
      },
      schemas: {
        ErrorResponse: OBJ({
          error: OBJ({
            code: {
              type: "string",
              enum: [
                "AUTH_REQUIRED", "FORBIDDEN", "NOT_FOUND", "CARD_NOT_OWNED", "CARD_NOT_ELIGIBLE",
                "LINEUP_NOT_FOUND", "INVALID_LINEUP", "INVALID_CARD_VERSION", "INSUFFICIENT_ELIGIBLE_CARDS",
                "EVO_NOT_FOUND", "GAME_NOT_FOUND", "VALIDATION_FAILED", "READ_ONLY_SURFACE", "RATE_LIMIT", "INTERNAL_ERROR",
              ],
            },
            message: STR,
            detail: OBJ({}, { additionalProperties: true, nullable: true }),
          }),
        }),
        Generic: OBJ({}, { additionalProperties: true, description: "Structured JSON payload." }),
        Health: OBJ({
          ok: BOOL,
          api: STR,
          version: STR,
          authenticated: BOOL,
          player_access: BOOL,
        }),
        AttributeMap: OBJ({}, { additionalProperties: NUM, description: "Attribute key to value." }),
        Assignment: OBJ({
          badge_id: STR, trait_id: STR, name: STR, abbreviation: STR, tier: STR,
          category: STR, effect_type: STR, affected_stat: STR, condition_type: STR, target_stat: STR,
        }),
        OwnedCard: OBJ({
          owned_card_id: STR,
          player_card_id: STR,
          playable_version_id: { type: "string", nullable: true },
          playable_form: { type: "string", enum: ["player_card", "evo_card_version"] },
          name: STR,
          card_key: STR,
          gem_tier: STR,
          gem_tier_id: STR,
          gem_tier_stars: NUM,
          position1: STR,
          position2: STR,
          rating: NUM,
          run_rating: NUM,
          attributes: { $ref: "#/components/schemas/AttributeMap" },
          run_attributes: { $ref: "#/components/schemas/AttributeMap" },
          badges: { type: "array", items: { $ref: "#/components/schemas/Assignment" } },
          traits: { type: "array", items: { $ref: "#/components/schemas/Assignment" } },
          badge_count: INT,
          collection: STR,
          collection_id: STR,
          evo: OBJ({}, { additionalProperties: true }),
          preferences: OBJ({}, { additionalProperties: true, nullable: true }),
        }),
        CollectionResponse: OBJ({
          total: INT,
          returned: INT,
          limit: INT,
          offset: INT,
          cards: { type: "array", items: { $ref: "#/components/schemas/OwnedCard" } },
        }),
        CardResponse: OBJ({ card: { $ref: "#/components/schemas/OwnedCard" } }),
        EvoProgressResponse: OBJ({
          evos: {
            type: "array",
            items: OBJ({
              owned_card_id: STR,
              player_card_id: STR,
              name: STR,
              current_gem_tier: STR,
              evo_step_id: STR,
              step_order: INT,
              from_gem_tier: STR,
              to_gem_tier: STR,
              target_version_id: STR,
              stage_completion_pct: NUM,
              objectives: {
                type: "array",
                items: OBJ({
                  objective_index: INT, objective_id: STR, objective_type: STR, stat_key: STR,
                  description: STR, target: NUM, current_value: NUM, completed: BOOL, completion_pct: NUM,
                }),
              },
              future_steps: { type: "array", items: OBJ({}, { additionalProperties: true }) },
              final_version_id: STR,
              final_version_tier: STR,
            }),
          },
        }),
        LineupSlotInput: OBJ(
          {
            slot: INT,
            owned_card_id: STR,
            player_card_id: STR,
            evo_card_version_id: { type: "string", nullable: true },
          },
          { description: "Identify the exact card: owned_card_id is preferred. evo_card_version_id pins a specific evolved version." },
        ),
        Lineup: OBJ({
          lineup_id: STR,
          name: STR,
          mode: { type: "string", enum: Object.keys(LINEUP_MODES) },
          is_default: BOOL,
          notes: STR,
          slot_count: INT,
          slots_required: INT,
          slots: { type: "array", items: OBJ({}, { additionalProperties: true }) },
          created_at: STR,
          updated_at: STR,
        }),
        LineupListResponse: OBJ({ lineups: { type: "array", items: { $ref: "#/components/schemas/Lineup" } } }),
        LineupResponse: OBJ({
          lineup: { $ref: "#/components/schemas/Lineup" },
          legality: { $ref: "#/components/schemas/LegalityResponse" },
        }),
        CreateLineupRequest: OBJ(
          {
            name: STR,
            mode: { type: "string", enum: Object.keys(LINEUP_MODES) },
            notes: STR,
            is_default: BOOL,
            slots: { type: "array", items: { $ref: "#/components/schemas/LineupSlotInput" } },
          },
          { required: ["name", "slots"] },
        ),
        UpdateLineupRequest: OBJ(
          {
            lineup_id: STR,
            name: STR,
            notes: STR,
            mode: { type: "string", enum: Object.keys(LINEUP_MODES) },
            is_default: BOOL,
            slots: { type: "array", items: { $ref: "#/components/schemas/LineupSlotInput" } },
          },
          { required: ["lineup_id"] },
        ),
        ValidateLineupRequest: OBJ(
          {
            lineup_id: STR,
            cards: { type: "array", items: { $ref: "#/components/schemas/LineupSlotInput" } },
            mode: { type: "string", enum: Object.keys(LINEUP_MODES) },
            challenge_id: STR,
            domination_game_id: STR,
            run_id: STR,
          },
          { description: "Provide lineup_id OR cards. Add a game id to validate against that game's restrictions." },
        ),
        LegalityResponse: OBJ({
          legal: BOOL,
          mode: STR,
          slots_required: INT,
          cards_provided: INT,
          context: OBJ({}, { additionalProperties: true }),
          restrictions: OBJ({}, { additionalProperties: true, nullable: true }),
          reasons: {
            type: "array",
            items: OBJ({ code: STR, message: STR, detail: OBJ({}, { additionalProperties: true, nullable: true }) }),
          },
          invalid_cards: { type: "array", items: OBJ({}, { additionalProperties: true }) },
          eligible_card_ids: { type: "array", items: STR },
          summary: OBJ({}, { additionalProperties: true }),
        }),
        EligibleCardsResponse: OBJ({
          context: OBJ({}, { additionalProperties: true }),
          slots_required: INT,
          eligible_count: INT,
          eligible: { type: "array", items: { $ref: "#/components/schemas/OwnedCard" } },
          excluded: { type: "array", items: OBJ({}, { additionalProperties: true }) },
        }),
        ScoutResponse: OBJ({
          game: OBJ({}, { additionalProperties: true }),
          rules: OBJ({}, { additionalProperties: true }),
          difficulty: OBJ({}, { additionalProperties: true, nullable: true }),
          restrictions: OBJ({}, { additionalProperties: true, nullable: true }),
          opponent: OBJ({}, { additionalProperties: true }),
          rewards: OBJ({}, { additionalProperties: true }),
          user_progress: OBJ({}, { additionalProperties: true }),
        }),
        PreferenceRequest: OBJ(
          {
            owned_card_id: STR,
            player_card_id: STR,
            favorite: BOOL,
            grinding: BOOL,
            core_player: BOOL,
            do_not_recommend: BOOL,
            evo_priority: { type: "integer", minimum: 1, maximum: 99, nullable: true },
            notes: STR,
          },
          { description: "Identify the card by owned_card_id or player_card_id; only supplied flags change." },
        ),
      },
    },
  };
}

/** Truthful capability description, generated from the same declarations. */
export function insiderCapabilities(baseUrl: string, authenticated: boolean) {
  const schema = buildInsiderOpenApi(baseUrl);
  const reads: string[] = [];
  const writes: string[] = [];
  for (const [path, ops] of Object.entries(schema.paths as Record<string, Record<string, any>>)) {
    for (const [method, op] of Object.entries(ops)) {
      if (!op?.operationId) continue;
      (method === "get" ? reads : writes).push(op.operationId);
    }
  }
  return {
    api: "gteam-insider",
    version: INSIDER_API_VERSION,
    authenticated,
    base_url: baseUrl,
    surface: "player-facing",
    can_mutate_game_content: false,
    read_operations: reads.sort(),
    player_owned_write_operations: writes.sort(),
    player_owned_write_scope: ["player_lineups", "player_lineup_slots", "player_card_preferences"],
    lineup_modes: LINEUP_MODES,
    restriction_keys: RESTRICTION_KEYS,
    restriction_semantics:
      "Populated restriction categories are OR-ed: a card qualifies when it satisfies at least one. Evolved cards inherit their chain root's gem tier, team, collection, sub-collection and card colour.",
    filters: FILTER_KEYS,
    evo_support: {
      exposes_playable_versions: true,
      exposes_objective_progress: true,
      exposes_version_deltas: true,
      progression_source: "public.user_evo_progress (canonical); never recomputed from game logs.",
    },
    attribute_scales: {
      base: "Nine star-scale attributes, 0.00-6.99, used by 5v5 play.",
      runs: "Nine Runs attributes on a separate point scale, 20 points per star, 0-139, used by The Runs.",
    },
    limits: INSIDER_API_LIMITS,
    separate_from: "The Commissioner admin API (/functions/v1/actions) — no admin operation is reachable here.",
  };
}
