// Compact, GPT-safe OpenAPI surface.
//
// The full openapi.json exposes every historical route (single-entity upserts,
// duplicate commit aliases, schedule wrappers). ChatGPT Custom GPTs choke on it.
// This module exposes ONLY the stable commissioner-safe operations with small,
// generic response schemas.

const str = (description: string) => ({ type: "string", description });
const anyObj = { type: "object", additionalProperties: true } as const;

const okJson = (description: string) => ({
  "200": { description, content: { "application/json": { schema: anyObj } } },
  "400": { description: "Validation failed. Nothing was written." },
  "401": { description: "Not signed in." },
  "403": { description: "Admin role required." },
  "409": { description: "Preview mismatch, reused token, or already committed. Nothing was written." },
});

export const COMPACT_SCHEMA_VERSION = "gpt-1.0.0";

/** Deterministic non-crypto hash so the GPT can tell whether its import is stale. */
export function schemaHash(schema: unknown) {
  const s = JSON.stringify(schema);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return `${COMPACT_SCHEMA_VERSION}-${h.toString(16)}-${s.length}`;
}

const PLAYER_STATS = [
  "stat_3pt", "stat_mid", "stat_fin", "stat_dnk", "stat_ast", "stat_stl", "stat_reb", "stat_blk", "stat_int",
];

const statProps = Object.fromEntries(
  PLAYER_STATS.flatMap((s) => {
    const short = s.replace("stat_", "");
    return [
      [s, { type: "number", description: `Base stat ${short}.` }],
      [
        `run_stat_${short}`,
        {
          type: "number",
          description:
            `Runs stat ${short} on the Runs point scale (0-139): each star of base stat_${short} is worth 20 points ` +
            `(star 0 = 0-19, star 1 = 20-39 … star 6 = 120-139). Must sit inside the band of the base stat; omit it and the backend derives it.`,
        },
      ],
    ];
  }),
);

const tierEnum = ["base", "gold", "hof", "diamond", "actolytrene"];

const playerItem = {
  type: "object",
  additionalProperties: false,
  properties: {
    temp_ref: str("Reference so later items in the same payload can point at this card."),
    player_card_id: str("Immutable card id. Preferred target."),
    card_key: str("Immutable card key."),
    name: str("Existing card name to target, or the name of a new card."),
    new_name: str("Rename the card."),
    gem_tier: str("Gem tier, e.g. Emerald, Amethyst, Diamond, Pink Diamond, Actolytrene, Game Over."),
    team: str("Team name."),
    collection: str("Collection name."),
    sub_collection: str("Sub-collection name."),
    position1: str("Primary position."),
    position2: str("Secondary position."),
    rating: { type: "number", description: "Decimal OVR; must equal the mean of the nine base stats (tolerance 1e-7)." },
    run_rating: { type: "number", description: "Runs-mode rating." },
    ...statProps,
    market_value: { type: "number", description: "Market value in coins." },
    is_collection_reward: { type: "boolean", description: "Marks the card as a collection reward." },
    badges: {
      type: "array",
      description: "FULL REPLACEMENT of badges. [] clears all; omit to leave untouched.",
      items: {
        type: "object",
        required: ["badge"],
        additionalProperties: false,
        properties: { badge: str("Badge name."), tier: { type: "string", enum: tierEnum } },
      },
    },
    traits: {
      type: "array",
      description: "FULL REPLACEMENT of signature traits. [] clears all; omit to leave untouched.",
      items: {
        type: "object",
        required: ["trait"],
        additionalProperties: false,
        properties: {
          trait: str("Trait name."),
          tier: { type: "string", enum: tierEnum },
          target_stat: { type: "string", enum: PLAYER_STATS, description: "Stat the trait boosts." },
        },
      },
    },
  },
} as const;

const cardRef = (what: string) => ({
  type: "object",
  additionalProperties: false,
  properties: {
    player_card_id: str("Immutable card id. Preferred target."),
    card_key: str("Immutable card key."),
    player_name: str(`Card name — a card created in this same payload, or an existing card. ${what}`),
    slot: { type: "number", description: "1-based ordered slot. Optional: submitted order is used when omitted." },
  },
});

const packItem = {
  type: "object",
  additionalProperties: false,
  description:
    "Pack. Target an existing pack with pack_id (preferred) or its exact name. `players` is a FULL ordered pool replacement and `odds` a FULL odds-table replacement — omit a key to keep what the pack has today.",
  properties: {
    temp_ref: str("Reference so later items in the same payload can point at this pack."),
    pack_id: str("Immutable pack id. Preferred target for an existing pack."),
    name: str("Pack name (match key when pack_id is absent)."),
    new_name: str("Rename the pack."),
    pack_type: str("standard | premium | promo."),
    cost: { type: "number", description: "Coin cost for a single open." },
    ten_box_cost: { type: ["number", "null"], description: "Coin cost for a ten-box, or null." },
    status: str("draft | scheduled | active | disabled | archived."),
    players: {
      type: "array",
      description: "FULL ORDERED POOL REPLACEMENT. First entry is slot 1 unless `slot` is given.",
      items: cardRef("One entry per pool slot."),
    },
    odds: {
      type: "array",
      description: "FULL ODDS TABLE REPLACEMENT. Percentages must total exactly 100.00 and every entry must be > 0.",
      items: {
        type: "object",
        required: ["result_slot", "percentage"],
        additionalProperties: false,
        properties: {
          result_slot: str("Pool slot number as a string, or `player_choice`."),
          percentage: { type: "number", description: "Chance for this slot; all entries sum to 100.00." },
          description: str("Label shown in the odds table."),
        },
      },
    },
  },
} as const;

const collectionItem = {
  type: "object",
  additionalProperties: false,
  description:
    "Collection. Target with collection_id (preferred) or exact name. `player_cards` is a FULL ordered membership replacement; exactly one entry may be the reward.",
  properties: {
    temp_ref: str("Reference so later items in the same payload can point at this collection."),
    collection_id: str("Immutable collection id. Preferred target."),
    name: str("Collection name (match key when collection_id is absent)."),
    new_name: str("Rename the collection."),
    description: str("Collection description."),
    status: str("draft | scheduled | active | disabled | archived."),
    player_cards: {
      type: "array",
      description: "FULL ORDERED MEMBERSHIP REPLACEMENT. Set is_reward on exactly one entry.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          player_card_id: str("Immutable card id."),
          card_key: str("Immutable card key."),
          player_name: str("Card name, in this payload or already existing."),
          slot: { type: "number", description: "1-based order. Optional." },
          is_reward: { type: "boolean", description: "Marks this card as the collection reward." },
        },
      },
    },
  },
} as const;

const teamItem = {
  type: "object",
  additionalProperties: false,
  description: "Team. Target with team_id or exact name. `roster` is a FULL ordered replacement.",
  properties: {
    temp_ref: str("Reference so later items can point at this team."),
    team_id: str("Immutable team id. Preferred target."),
    name: str("Team name (match key when team_id is absent)."),
    new_name: str("Rename the team."),
    category: str("Team category."),
    unlock_cost: { type: "number", description: "Coin cost to unlock." },
    roster: { type: "array", description: "FULL ORDERED ROSTER REPLACEMENT.", items: cardRef("One entry per roster slot.") },
  },
} as const;

const lockerCodeItem = {
  type: "object",
  additionalProperties: false,
  description: "Locker code, matched case-insensitively on `code`. Rewards are validated and normalised server-side.",
  properties: {
    code: str("The code itself; stored uppercase."),
    reward_type: str("coins | gems | pack | card."),
    reward_payload: {
      type: "object",
      additionalProperties: true,
      description: "Reward payload matching reward_type.",
      properties: {
        amount: { type: "number", description: "For coins / gems." },
        pack_name: str("For a pack reward; resolved to the pack id."),
        card_name: str("For a card reward; resolved to the player card id."),
        player_card_id: str("For a card reward, by immutable id."),
      },
    },
    reward_release_pack: { type: "boolean", description: "Reward the pack created in this same release." },
    max_redemptions: { type: ["number", "null"], description: "Redemption cap, or null for unlimited." },
    activates_at: { type: ["string", "null"], description: "ISO timestamp the code becomes usable, or null." },
    expires_at: { type: ["string", "null"], description: "ISO timestamp, or null for no expiry." },
    status: str("draft | scheduled | active | disabled | archived."),
  },
} as const;

const previewStored = {
  type: "object",
  additionalProperties: true,
  properties: {
    ok: { type: "boolean" },
    wrote_game_content: { type: "boolean", description: "Always false for a preview." },
    preview_id: str("Durable id to commit with."),
    payload_hash: str("Hash of the canonical payload; echo it back as approved_payload_hash."),
    expires_at: str("ISO-8601 expiry of the stored preview."),
    status: str("pending | committing | committed | failed | cancelled | expired."),
    summary: anyObj,
    creates: anyObj,
    updates: anyObj,
    replacements: anyObj,
    deletes: anyObj,
    warnings: anyObj,
    destructive_operations: anyObj,
  },
} as const;

export function buildCompactOpenApi(baseUrl: string) {
  const paths: Record<string, unknown> = {};

  paths["/health"] = {
    get: {
      operationId: "getGptActionHealth",
      summary: "Health check for this Actions connector",
      description:
        "Tiny read-only probe. Returns ok, api version, schema_version and schema_hash, whether the caller is signed in and has the admin role, and the list of available operations. Call this first in a session before any other action.",
      "x-openai-isConsequential": false,
      responses: {
        "200": {
          description: "Health",
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: true,
                properties: {
                  ok: { type: "boolean" },
                  version: str("API version."),
                  schema_version: str("Compact schema version."),
                  schema_hash: str("Hash of the compact schema currently served."),
                  authenticated: { type: "boolean" },
                  is_admin: { type: "boolean" },
                  operations: { type: "array", items: { type: "string" } },
                },
              },
            },
          },
        },
      },
    },
  };

  paths["/admin-api/v1/capabilities"] = {
    get: {
      operationId: "getAdminApiCapabilities",
      summary: "Backend capabilities",
      description:
        "Supported entities, bulk groups, mutable fields, replacement semantics, gem tier OVR bands, batch limits and preview TTL. Call before bulk work instead of guessing.",
      "x-openai-isConsequential": false,
      responses: okJson("Capabilities"),
    },
  };

  paths["/admin-api/v1/diagnostics"] = {
    get: {
      operationId: "getAdminApiDiagnostics",
      summary: "Content health audit",
      description:
        "Invalid OVR, tier mismatches, ambiguous names, broken collection links, odds off 100.00, empty rosters, broken evo sources, skipped tiers, missing evo versions. Filter and page.",
      "x-openai-isConsequential": false,
      parameters: [
        { name: "scope", in: "query", required: false, schema: { type: "string" }, description: "player_card, pack, collection, team, evo_path…" },
        { name: "player_card_ids", in: "query", required: false, schema: { type: "string" }, description: "Comma-separated card ids." },
        { name: "codes", in: "query", required: false, schema: { type: "string" }, description: "Comma-separated finding codes." },
        { name: "release_slug", in: "query", required: false, schema: { type: "string" } },
        { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 200 } },
        { name: "cursor", in: "query", required: false, schema: { type: "string" } },
      ],
      responses: okJson("Diagnostics"),
    },
  };

  const evoVersionPatchItem = {
    type: "object",
    additionalProperties: false,
    properties: {
      evo_version_id: str("Immutable evo_card_versions id to patch. Required."),
      status: str("draft | scheduled | active | disabled | archived. Set 'active' to publish the version; an omitted status is preserved."),
      rating: { type: "number", description: "Star-scale OVR (mean of the nine base stats)." },
      run_rating: { type: "number", description: "Runs point-scale rating (0-139)." },
      gem_name: str("Gem tier name of this version."),
      position1: str("Primary position."),
      position2: str("Secondary position."),
      evo_stage: { type: "integer", description: "Version order inside the path." },
      ...statProps,
      badges: {
        type: "array",
        description: "Full replacement of this version's badges when supplied; omit to keep them.",
        items: { type: "object", properties: { badge: str("Badge name."), tier: { type: "string", enum: tierEnum } } },
      },
      traits: {
        type: "array",
        description: "Full replacement of this version's traits when supplied; omit to keep them.",
        items: {
          type: "object",
          properties: { trait: str("Trait name."), tier: { type: "string", enum: tierEnum }, target_stat: str("Stat the trait boosts.") },
        },
      },
    },
    required: ["evo_version_id"],
  };

  const evoStepPatchItem = {
    type: "object",
    additionalProperties: false,
    properties: {
      evo_step_id: str("Immutable evo_paths (step) id to patch. Required."),
      evolves_to_version_id: str("Publish this step by linking it to an existing evo_card_versions id."),
      evolves_to_card_id: str("Link the step to a real player card instead; send null to clear."),
      status: str("draft | scheduled | active | disabled | archived. Omitted keeps the current status."),
      step_order: { type: "integer", description: "Position of the step in the path." },
    },
    required: ["evo_step_id"],
  };

  const evoPatchBody = (versions: boolean, steps: boolean) => ({
    required: true,
    content: {
      "application/json": {
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            ...(versions ? { evo_version_updates: { type: "array", items: evoVersionPatchItem } } : {}),
            ...(steps ? { evo_step_updates: { type: "array", items: evoStepPatchItem } } : {}),
            preview_token: str("Required on commit: the preview_token returned by the identical preview."),
          },
        },
      },
    },
  });

  paths["/evo/versions"] = {
    get: {
      operationId: "listEvoVersions",
      summary: "List evo card versions",
      description:
        "Lists evo card versions with their id, path, order, tier, both ratings, status and the id of the step that publishes them (linked_step_id). Filter with player_card_id, evo_path_id or status.",
      "x-openai-isConsequential": false,
      parameters: [
        { name: "player_card_id", in: "query", required: false, schema: { type: "string" } },
        { name: "evo_path_id", in: "query", required: false, schema: { type: "string" } },
        { name: "status", in: "query", required: false, schema: { type: "string" } },
      ],
      responses: okJson("Evo versions"),
    },
  };

  paths["/evo/version/get"] = {
    post: {
      operationId: "getEvoVersion",
      summary: "Read one evo card version",
      description:
        "Full playable snapshot of one evo card version: identity, both ratings, base stats, Runs stats, badges, traits and the step it is linked to.",
      "x-openai-isConsequential": false,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { type: "object", properties: { evo_version_id: str("Evo card version id.") }, required: ["evo_version_id"] },
          },
        },
      },
      responses: okJson("Evo version"),
    },
  };

  paths["/evo/versions/preview"] = {
    post: {
      operationId: "previewEvoVersionUpdates",
      summary: "Preview targeted evo version patches (zero writes)",
      description:
        "PATCH semantics: only the submitted fields change, omitted fields are preserved, and status is never forced back to draft. Nothing is written. Show the plan, get approval, then call commitEvoVersionUpdates with the identical body plus the preview_token.",
      "x-openai-isConsequential": false,
      requestBody: evoPatchBody(true, false),
      responses: okJson("Patch plan"),
    },
  };

  paths["/evo/versions/commit"] = {
    post: {
      operationId: "commitEvoVersionUpdates",
      summary: "Commit approved evo version patches",
      description: "Applies the approved evo version patches atomically. Requires the single-use preview_token from the matching preview.",
      "x-openai-isConsequential": true,
      requestBody: evoPatchBody(true, false),
      responses: okJson("Patch result"),
    },
  };

  paths["/evo/steps/preview"] = {
    post: {
      operationId: "previewEvoStepUpdates",
      summary: "Preview targeted evo step patches (zero writes)",
      description:
        "Publishes or relinks individual evo steps without rebuilding the path. Only the submitted fields change. Nothing is written.",
      "x-openai-isConsequential": false,
      requestBody: evoPatchBody(false, true),
      responses: okJson("Patch plan"),
    },
  };

  paths["/evo/steps/commit"] = {
    post: {
      operationId: "commitEvoStepUpdates",
      summary: "Commit approved evo step patches",
      description: "Applies the approved evo step patches atomically. Requires the single-use preview_token from the matching preview.",
      "x-openai-isConsequential": true,
      requestBody: evoPatchBody(false, true),
      responses: okJson("Patch result"),
    },
  };

  paths["/evo/runs-audit"] = {
    get: {
      operationId: "auditEvoVersionRuns",
      summary: "Audit Runs data on evo card versions",
      description:
        "Lists evo card versions whose Runs data is missing or on the wrong scale: run_rating null, run_stat_* null, or Runs stats outside the band implied by their base star stat (20 points per star).",
      "x-openai-isConsequential": false,
      responses: okJson("Evo Runs audit"),
    },
  };

  paths["/evo/runs-repair"] = {
    post: {
      operationId: "repairEvoVersionRuns",
      summary: "Repair Runs data on evo card versions",
      description:
        "Deterministically re-derives run_stat_* and run_rating from each version's base stats using the 20-points-per-star scale. Defaults to a zero-write preview; send commit: true to write. Optional version_id limits it to one version.",
      "x-openai-isConsequential": true,
      requestBody: {
        required: false,
        content: {
          "application/json": {
            schema: {
              type: "object",
              properties: {
                commit: { type: "boolean", description: "false (default) previews; true writes." },
                version_id: str("Limit the repair to one evo_card_versions id."),
              },
            },
          },
        },
      },
      responses: okJson("Repair plan or result"),
    },
  };


  paths["/references"] = {
    get: {
      operationId: "getReferences",
      summary: "Exact reference names",
      description:
        "Gem tiers, teams, packs, collections, sub-collections, badges, traits, storylines, challenges, Runs, Domination roads and rule keys. Only use names returned here.",
      "x-openai-isConsequential": false,
      responses: okJson("References"),
    },
  };

  paths["/list"] = {
    post: {
      operationId: "listRows",
      summary: "List rows from an exposed table",
      description: "Read current values before proposing changes. Optional case-insensitive search on the table's main text column.",
      "x-openai-isConsequential": false,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["table"],
              additionalProperties: false,
              properties: {
                table: str("Exposed table name, e.g. player_cards, teams, packs, collections, locker_codes."),
                search: str("Substring match on the table's main text column."),
                columns: str("Comma-separated column list; defaults to all."),
                limit: { type: "integer", minimum: 1, maximum: 500 },
              },
            },
            example: { table: "player_cards", search: "galactic", limit: 25 },
          },
        },
      },
      responses: okJson("Rows"),
    },
  };

  paths["/entity"] = {
    post: {
      operationId: "getEntity",
      summary: "Get one entity with its relations",
      description: "Full detail for a single player card, team, Run, pack, collection, challenge or locker code, targeted by id or exact name.",
      "x-openai-isConsequential": false,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["kind"],
              additionalProperties: false,
              properties: {
                kind: str("player | team | run | pack | collection | challenge | locker_code | domination_game."),
                id: str("Immutable id (preferred)."),
                name: str("Exact name when no id is available."),
              },
            },
            example: { kind: "player", name: "Player Name" },
          },
        },
      },
      responses: okJson("Entity detail"),
    },
  };

  paths["/content-release/preview"] = {
    post: {
      operationId: "previewContentRelease",
      summary: "Validate a complete atomic content release (zero game-content writes)",
      description:
        "Validates a full release document (players, collection, reward, team, pack pool and odds, evo paths and playable evo versions, objectives, locker codes) and stores the canonical payload server-side. Creates NO game content. Returns preview_id, payload_hash, expires_at, summary, warnings, destructive_operations and the plan. Commit later with preview_id + approved_payload_hash only.",
      "x-openai-isConsequential": false,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              additionalProperties: true,
              description:
                "Release document. Common groups: release {name,slug,status}, players[], collection{}, team{}, pack{}, evo_paths[], locker_codes[], challenges[], dynamic_duos[], domination{}. Use temp_ref on a new item and reference it from later items in the same document.",
              properties: {
                release: anyObj,
                players: { type: "array", items: anyObj },
                collection: collectionItem,
                team: teamItem,
                pack: packItem,
                evo_paths: { type: "array", items: anyObj },
                locker_codes: { type: "array", items: lockerCodeItem },
                challenges: { type: "array", items: anyObj },
                dynamic_duos: { type: "array", items: anyObj },
                domination: anyObj,
                preview_ttl_minutes: { type: "integer", minimum: 5, maximum: 120 },
              },
            },
            example: {
              release: { name: "Galactic", status: "draft" },
              players: [{ name: "New Card", gem_tier: "Diamond", stat_3pt: 1 }],
            },
          },
        },
      },
      responses: {
        "200": { description: "Stored preview plan", content: { "application/json": { schema: previewStored } } },
        "400": { description: "Validation failed. Nothing was written." },
        "401": { description: "Not signed in." },
        "403": { description: "Admin role required." },
      },
    },
  };

  paths["/content-release/commit"] = {
    post: {
      operationId: "commitContentRelease",
      summary: "Commit an approved stored release preview",
      description:
        "Applies the stored canonical payload for preview_id atomically. Send ONLY preview_id and approved_payload_hash — never the release payload. Retrying with the same pair safely replays the original result. A 202 with status 'committing' means it is still publishing: poll getContentReleasePreview instead of re-committing.",
      "x-openai-isConsequential": true,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["preview_id", "approved_payload_hash"],
              additionalProperties: false,
              properties: {
                preview_id: str("preview_id from previewContentRelease."),
                approved_payload_hash: str("payload_hash you showed the user for approval."),
                idempotency_key: str("Optional key making a retry safe."),
                wait_seconds: { type: "integer", minimum: 5, maximum: 40, description: "Optional inline wait before switching to polling." },
              },
            },
            example: { preview_id: "uuid", approved_payload_hash: "sha256-hash" },
          },
        },
      },
      responses: {
        ...okJson("Commit report with verification and created ids"),
        "202": { description: "Still committing; poll getContentReleasePreview.", content: { "application/json": { schema: anyObj } } },
        "404": { description: "Unknown preview_id." },
        "410": { description: "Preview expired or cancelled. Nothing was written." },
      },
    },
  };

  paths["/content-release/preview/get"] = {
    post: {
      operationId: "getContentReleasePreview",
      summary: "Re-read a stored release preview",
      description: "Returns the stored plan, status and verification for a preview_id. Use it to re-show a plan in a later turn or to poll a commit that answered 'committing'.",
      "x-openai-isConsequential": false,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { type: "object", required: ["preview_id"], additionalProperties: false, properties: { preview_id: str("Stored preview id.") } },
          },
        },
      },
      responses: { "200": { description: "Stored preview", content: { "application/json": { schema: previewStored } } }, "404": { description: "Unknown preview_id." } },
    },
  };

  paths["/content-release/preview/cancel"] = {
    post: {
      operationId: "cancelContentReleasePreview",
      summary: "Cancel a stored release preview",
      description: "Discards a pending preview so it can never be committed. Writes no game content.",
      "x-openai-isConsequential": true,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { type: "object", required: ["preview_id"], additionalProperties: false, properties: { preview_id: str("Stored preview id.") } },
          },
        },
      },
      responses: { "200": { description: "Cancelled", content: { "application/json": { schema: previewStored } } }, "404": { description: "Unknown preview_id." } },
    },
  };

  paths["/admin-api/v1/bulk-players/preview"] = {
    post: {
      operationId: "previewBulkPlayers",
      summary: "Preview bulk player-card changes (zero writes)",
      description:
        "Validates up to 500 player-card creates or updates with zero writes: immutable ids, nine base stats, Runs stats, decimal ratings, gem tiers, positions and full badge/trait replacement. Returns the plan plus a single-use preview_token.",
      "x-openai-isConsequential": false,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["players"],
              additionalProperties: false,
              properties: {
                players: { type: "array", minItems: 1, maxItems: 500, items: playerItem },
                notes: str("Optional note stored with the preview."),
              },
            },
            example: { players: [{ player_card_id: "uuid", rating: 3.7777777778, stat_3pt: 6 }] },
          },
        },
      },
      responses: okJson("Bulk player preview plan"),
    },
  };

  paths["/admin-api/v1/bulk-players/commit"] = {
    post: {
      operationId: "commitBulkPlayers",
      summary: "Commit an approved bulk player preview atomically",
      description:
        "Applies the exact previewed bulk-player payload. Requires the single-use preview_token and an identical players array. All cards commit together or roll back together.",
      "x-openai-isConsequential": true,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["preview_token", "players"],
              additionalProperties: false,
              properties: {
                preview_token: str("Token from the matching previewBulkPlayers response."),
                idempotency_key: str("Optional key making a retry safe."),
                notes: str("Must match the previewed payload."),
                players: { type: "array", minItems: 1, maxItems: 500, items: playerItem },
              },
            },
          },
        },
      },
      responses: okJson("Bulk player commit report"),
    },
  };

  paths["/admin-api/v1/bulk/preview"] = {
    post: {
      operationId: "previewBulk",
      summary: "Preview any bulk change (zero writes)",
      description:
        "One document may contain players, collections, teams, packs, pack odds, evo_paths, challenges, locker_codes, dynamic_duos, runs, domination roads and games. Writes nothing. Returns the plan, canonical_payload, payload_hash and a single-use preview_token.",
      "x-openai-isConsequential": false,
      requestBody: {
        required: true,
        content: { "application/json": { schema: anyObj, example: { players: [{ player_card_id: "uuid", rating: 2.11 }] } } },
      },
      responses: okJson("Preview plan"),
    },
  };

  paths["/admin-api/v1/bulk/commit"] = {
    post: {
      operationId: "commitBulk",
      summary: "Commit an approved bulk preview atomically",
      description:
        "Send the identical canonical_payload from the preview plus its preview_token. Optional idempotency_key makes retries safe. The whole scope applies in one transaction or rolls back.",
      "x-openai-isConsequential": true,
      requestBody: {
        required: true,
        content: { "application/json": { schema: anyObj, example: { preview_token: "tok", players: [{ player_card_id: "uuid", rating: 2.11 }] } } },
      },
      responses: okJson("Commit report"),
    },
  };

  paths["/domination-roads"] = {
    get: {
      operationId: "listDominationRoads",
      summary: "List Domination roads",
      description: "Every road with road_id, name, description, sort order, active flag, game count and game orders.",
      "x-openai-isConsequential": false,
      responses: okJson("Roads"),
    },
  };

  paths["/domination-roads/export"] = {
    post: {
      operationId: "exportDominationRoad",
      summary: "Export a whole Domination road",
      description: "Returns one road exactly in the shape the road import expects: settings plus every game in game_order with rosters and rewards.",
      "x-openai-isConsequential": false,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: { type: "object", additionalProperties: false, properties: { road_id: str("Immutable road id (preferred)."), road_name: str("Exact road name.") } },
            example: { road_name: "Tortuga" },
          },
        },
      },
      responses: okJson("Road payload"),
    },
  };

  const roadBody = {
    type: "object",
    additionalProperties: true,
    properties: {
      road_id: str("Immutable road id (preferred target)."),
      road_name: str("Exact road name; also names a new road."),
      new_road_name: str("Rename the road."),
      description: str("Road description."),
      sort_order: { type: "integer" },
      is_active: { type: "boolean" },
      mode: { type: "string", enum: ["merge", "replace"], description: "'merge' touches only the game_orders sent. 'replace' DELETES games on that road whose game_order is absent." },
      expected_game_count: { type: "integer", description: "Safety check for mode='replace'." },
      games: { type: "array", items: anyObj, description: "Games targeted by domination_game_id or game_order, never opponent name." },
      preview_token: str("Commit only: token from the matching preview."),
    },
  } as const;

  paths["/domination-roads/preview"] = {
    post: {
      operationId: "previewDominationRoad",
      summary: "Validate a bulk Domination road import (zero writes)",
      description: "Full validation with zero writes. Returns road_creates, road_updates, game_operations, destructive_operations and warnings plus a single-use preview_token.",
      "x-openai-isConsequential": false,
      requestBody: { required: true, content: { "application/json": { schema: roadBody } } },
      responses: okJson("Road plan"),
    },
  };

  paths["/domination-roads/commit"] = {
    post: {
      operationId: "commitDominationRoad",
      summary: "Apply an approved Domination road import atomically",
      description: "Applies the previewed road import in one transaction. Requires the single-use preview_token and a byte-identical body. In mode='replace' omitted games are DELETED.",
      "x-openai-isConsequential": true,
      requestBody: { required: true, content: { "application/json": { schema: roadBody } } },
      responses: okJson("Road commit report"),
    },
  };

  return {
    openapi: "3.1.0",
    info: {
      title: "GTeam Commissioner API (compact)",
      version: "1.0.0",
      description:
        "Compact commissioner surface for GTeam Infinite Hub. Every mutation is a preview (validate only, zero writes) followed by an atomic commit. Writes require the admin role.",
    },
    servers: [{ url: baseUrl }],
    paths,
    components: {
      securitySchemes: {
        oauth2: {
          type: "oauth2",
          flows: {
            authorizationCode: {
              authorizationUrl: `${new URL(baseUrl).origin}/functions/v1/gpt-oauth/authorize`,
              tokenUrl: `${new URL(baseUrl).origin}/functions/v1/gpt-oauth/token`,
              scopes: { openid: "Sign in", email: "Email address", profile: "Basic profile" },
            },
          },
        },
      },
    },
    security: [{ oauth2: ["openid", "email", "profile"] }],
  };
}

/** operationIds served by the compact schema, in call order. */
export function compactOperationIds(baseUrl = "https://example.com") {
  const schema = buildCompactOpenApi(baseUrl) as { paths: Record<string, Record<string, { operationId: string }>> };
  const ids: string[] = [];
  for (const methods of Object.values(schema.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      if (["get", "post", "put", "patch", "delete"].includes(method) && op?.operationId) ids.push(op.operationId);
    }
  }
  return ids;
}

export const GPT_COMPACT_INSTRUCTIONS = `You are the GTeam Commissioner. You manage game content through the compact GTeam Commissioner API.

Session start:
1. Call getGptActionHealth first. If ok is false, or authenticated/is_admin is false, tell the commissioner to sign in to GTeam Infinite Hub (or that they lack the admin role) and stop.
2. Call getAdminApiCapabilities and getReferences before proposing content. Only use names that appear in getReferences — never invent a gem tier, team, badge, trait, pack or player name. Use listRows / getEntity / getAdminApiDiagnostics to read current values before changing them.

Every mutation follows preview -> approval -> commit:
- PREVIEW writes nothing. Show the returned creates / updates / deletes and, in bold, every destructive_operations entry (roster, pool, odds, badge/trait replacements) with how many rows would be deleted.
- WAIT for explicit approval of that specific plan. Never commit on your own initiative.
- COMMIT applies the approved plan in one transaction or rolls it all back.

Content releases (collection + reward + team + pack + odds + evo paths + playable evo versions):
- previewContentRelease validates and stores the canonical payload server-side, returning preview_id, payload_hash and expires_at. It creates no game content.
- After approval, the VERY NEXT write call must be commitContentRelease with ONLY { preview_id, approved_payload_hash } (optionally idempotency_key, wait_seconds). Never resend the release payload, and do not re-preview, re-normalize or re-read diagnostics between approval and commit.
- If you no longer have preview_id or payload_hash, say so and run a new preview. Never claim you can commit without them.
- Retrying commitContentRelease with the same preview_id + hash safely returns the original result. If the commit answers 202 with status 'committing', tell the user it is publishing and poll getContentReleasePreview about every 15 seconds until status is 'committed' or 'failed'. Use cancelContentReleasePreview to discard a plan.

Player edits only: previewBulkPlayers -> approval -> commitBulkPlayers with the identical players array plus the preview_token. Never loop a single-player call and never wrap plain card edits in a release.
Mixed documents (packs, collections, evo paths, challenges, locker codes, dynamic duos, Domination): previewBulk -> approval -> commitBulk with the identical canonical_payload and its preview_token.
Domination roads: listDominationRoads / exportDominationRoad to read, previewDominationRoad -> approval -> commitDominationRoad to write. Always target games by domination_game_id or road + game_order, never by opponent name — rematches are legal.

Rules:
- Ratings are decimals: preserve exact values, and OVR must equal the mean of the nine base stats.
- Sending badges or traits on a card REPLACES all of that card's assignments; omit them to leave them alone.
- A failed preview or commit writes nothing; fix the input and preview again.
- Never fabricate ids, hashes or results. If an action errors, report the error verbatim.`;
