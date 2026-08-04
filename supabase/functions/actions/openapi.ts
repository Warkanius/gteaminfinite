// OpenAPI 3.1 document for the GTeam Infinite Hub Custom GPT Actions surface.
// Served publicly (schema only, no data) from GET /openapi.json.

const TIERS = ["base", "gold", "hof", "diamond", "actolytrene"];
const STATS = ["stat_3pt", "stat_mid", "stat_fin", "stat_dnk", "stat_ast", "stat_stl", "stat_reb", "stat_blk", "stat_int"];
const RUN_STATS = STATS.map((s) => s.replace("stat_", "run_stat_"));

const intProp = (description: string) => ({ type: "integer", description });
const strProp = (description: string) => ({ type: "string", description });

const statProps = (keys: string[], label: string) =>
  Object.fromEntries(keys.map((k) => [k, { type: "integer", minimum: 0, maximum: 150, description: `${label} ${k}` }]));

const PlanResponse = {
  type: "object",
  description:
    "The validated plan. `applied` is false for preview and true for commit. `destructive_operations` lists every set of rows that would be deleted and re-created (non-player kinds return the same list under `destructive`).",
  properties: {
    kind: { type: "string" },
    mode: { type: "string", enum: ["preview", "commit"] },
    applied: { type: "boolean" },
    operations: { type: "array", items: { type: "object", additionalProperties: true } },
    destructive_operations: { type: "array", items: { type: "object", additionalProperties: true } },
    destructive: { type: "array", items: { type: "object", additionalProperties: true }, description: "Same as destructive_operations for non-player kinds." },
  },
};

const PlayerInput = {
  type: "object",
  required: ["name"],
  description:
    "A player card. `name` is the match key: an existing card with that name is updated, otherwise a new card is created. Only the fields you send are written.",
  properties: {
    name: strProp("Existing card name to edit, or the name of the new card."),
    new_name: strProp("Rename the card to this."),
    gem_tier: strProp("Gem tier name, e.g. Emerald / Diamond. Must already exist."),
    gem_name: strProp("Display gem label on the card."),
    team: strProp("Team name to attach the card to."),
    collection: strProp("Collection name."),
    sub_collection: strProp("Sub-collection name (must belong to the collection)."),
    position1: strProp("Primary position, e.g. PG / SG / SF / PF / C."),
    position2: strProp("Secondary position or null."),
    rating: { type: "number", description: "Overall rating; decimals are preserved, e.g. 87.4." },
    run_rating: intProp("Overall rating used in 3v3 Runs."),
    ...statProps(STATS, "Base"),
    ...statProps(RUN_STATS, "Runs-mode"),
    market_value: intProp("Coin market value."),
    social_handle: strProp("Social feed handle, e.g. @player."),
    avatar_url: strProp("Avatar image URL."),
    is_collection_reward: { type: "boolean", description: "Card is only obtainable as a collection reward." },
    card_color_primary: strProp("HSL string, e.g. '210 90% 55%'."),
    card_color_secondary: strProp("HSL string."),
    card_glow_color: strProp("HSL string."),
    card_animation: strProp("none / pulse / shimmer / glow."),
    badges: {
      type: "array",
      description: "DESTRUCTIVE: replaces ALL badge assignments on this card. Omit to leave assignments untouched.",
      items: {
        type: "object",
        required: ["badge"],
        properties: { badge: strProp("Badge name or abbreviation."), tier: { type: "string", enum: TIERS } },
      },
    },
    traits: {
      type: "array",
      description: "DESTRUCTIVE: replaces ALL signature-trait assignments on this card.",
      items: {
        type: "object",
        required: ["trait"],
        properties: {
          trait: strProp("Signature trait name or abbreviation."),
          tier: { type: "string", enum: TIERS },
          target_stat: { type: "string", enum: STATS, description: "Stat the trait boosts, when the trait needs one." },
        },
      },
    },
  },
};

const TeamInput = {
  type: "object",
  required: ["name"],
  properties: {
    name: strProp("Team name (match key)."),
    category: strProp("domination / run / challenge."),
    unlock_cost: intProp("Coin cost to unlock."),
    roster: {
      type: "array",
      items: { type: "string" },
      description: "DESTRUCTIVE: replaces the whole roster with these existing player card names, in slot order.",
    },
  },
};

const RunInput = {
  type: "object",
  required: ["name"],
  properties: {
    name: strProp("Run name (match key)."),
    target_score: intProp("Score the Run races to (default 21)."),
    team: strProp("Optional team name to link the Run to."),
    milestones: {
      type: "array",
      items: { type: "object", additionalProperties: true },
      description: "Replaces runs.milestones, e.g. [{ wins_required, coin_reward, gem_reward, pack_reward }].",
    },
    roster: {
      type: "array",
      items: { type: "string" },
      description: "DESTRUCTIVE: replaces the Run opponent roster with these player card names. Run stats are copied from each card's run_* values.",
    },
    rank_rewards: {
      type: "array",
      description: "DESTRUCTIVE AND GLOBAL: run_rank_rewards is one ladder shared by every Run; sending this replaces the whole ladder.",
      items: {
        type: "object",
        required: ["rank_name", "wins_required"],
        properties: {
          rank_name: { type: "string" },
          wins_required: { type: "integer" },
          coin_reward: { type: "integer" },
          gem_reward: { type: "integer" },
          pack_reward: { type: "string" },
          sort_order: { type: "integer" },
        },
      },
    },
  },
};

const DominationInput = {
  type: "object",
  required: ["road_name", "game_order"],
  properties: {
    road_name: strProp("Road / path the game belongs to."),
    game_order: intProp("Position on the road; unique per road and the target key. Required."),
    domination_game_id: strProp("Immutable id of an existing game — the most precise target."),
    opponent_name: strProp("Opponent display name. NOT a target: the same opponent may appear at several game_orders (rematches)."),
    opponent_team_id: strProp("Optional link to a teams row."),
    difficulty_stars: intProp("1-5."),
    coin_reward: intProp("Coins awarded for winning."),
    pack_reward_id: strProp("Pack reward by immutable id (preferred; pack names repeat). null clears it."),
    pack_reward: strProp("Legacy: pack id or exact unique pack name. Ambiguous names are rejected."),
    roster: { type: "array", items: { type: "string" }, description: "DESTRUCTIVE: replaces this game's roster, in slot order." },
  },
};


const PackInput = {
  type: "object",
  required: ["name"],
  properties: {
    name: strProp("Pack name (match key)."),
    pack_type: strProp("standard / premium / promo."),
    cost: intProp("Coin cost for a single open."),
    ten_box_cost: intProp("Coin cost for a ten-box, or null."),
    players: {
      type: "array",
      items: { type: "string" },
      description: "DESTRUCTIVE: replaces the pack pool. First name becomes slot 1, second slot 2, etc.",
    },
    odds: {
      type: "array",
      description: "DESTRUCTIVE: replaces the odds rows. Percentages must total 100 and each result_slot must be 'player_choice' or an existing pool slot number.",
      items: {
        type: "object",
        required: ["result_slot", "percentage"],
        properties: {
          result_slot: strProp("Pool slot number as a string, or 'player_choice'."),
          percentage: { type: "number" },
          description: { type: "string" },
        },
      },
    },
  },
};

const LockerCodeInput = {
  type: "object",
  required: ["code", "reward_type", "reward_value"],
  properties: {
    code: strProp("The code itself (stored uppercase, matched case-insensitively)."),
    reward_type: { type: "string", enum: ["coins", "gems", "pack", "card"] },
    reward_value: {
      type: "object",
      description: "Payload matching reward_type: { amount } for coins/gems, { pack_name } for pack, { card_name } for card.",
      properties: {
        amount: { type: "integer" },
        pack_name: { type: "string" },
        card_name: { type: "string" },
      },
    },
    max_redemptions: intProp("Redemption cap, or null for unlimited."),
    expires_at: strProp("ISO timestamp, or null."),
  },
};

const ChallengeInput = {
  type: "object",
  required: ["name"],
  properties: {
    name: strProp("Challenge name (match key)."),
    description: { type: "string" },
    challenge_type: strProp("single / series / stat_limit / spotlight."),
    opponent_team: strProp("Team name to face."),
    win_condition: strProp("win / win_by / stat_limit."),
    win_by_amount: { type: "integer" },
    series_length: { type: "integer" },
    series_win_coins: { type: "integer" },
    series_loss_coins: { type: "integer" },
    stat_limit_player: strProp("Player card name the stat limit applies to."),
    stat_limit_stat: { type: "string", enum: STATS },
    stat_limit_value: { type: "integer" },
    coin_reward: { type: "integer" },
    gem_reward: { type: "integer" },
    pack_reward: strProp("Pack name (resolved to its id)."),
    card_reward: strProp("Player card name granted on completion."),
    prerequisite: strProp("Name of the challenge that must be completed first."),
    spotlight_group: { type: "string" },
    sort_order: { type: "integer" },
    lineup_restrictions: { type: "object", additionalProperties: true, description: "positions, badge_ids, trait_ids, gem_tier_ids, team_ids, collection_ids, sub_collection_ids, card_colors." },
    is_repeatable: { type: "boolean" },
    expires_at: strProp("ISO timestamp, or null."),
  },
};

const DuoInput = {
  type: "object",
  required: ["name"],
  properties: {
    name: strProp("Duo name (match key)."),
    description: { type: "string" },
    player_a: strProp("First player card name (required when creating)."),
    player_b: strProp("Second player card name (required when creating)."),
    boosts_a: { type: "object", additionalProperties: { type: "number" }, description: `Stat boosts for player A keyed by ${STATS.join(", ")}.` },
    boosts_b: { type: "object", additionalProperties: { type: "number" }, description: "Stat boosts for player B." },
    is_active: { type: "boolean" },
  },
};

const BundleInput = {
  type: "object",
  required: ["storyline"],
  properties: {
    storyline: {
      type: "object",
      required: ["title"],
      properties: {
        title: { type: "string" },
        summary: { type: "string" },
        arc_image_url: { type: "string" },
        status: strProp("draft / active / archived."),
        starts_at: { type: "string" },
        ends_at: { type: "string" },
      },
    },
    players: {
      type: "array",
      items: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string" },
          position1: { type: "string" },
          position2: { type: "string" },
          stars: intProp("1-5; converted to a rating by the importer."),
          social_handle: { type: "string" },
          ...statProps(STATS, "Base"),
        },
      },
    },
    locker_codes: { type: "array", items: LockerCodeInput },
    posts: {
      type: "array",
      items: {
        type: "object",
        required: ["content"],
        properties: {
          content: { type: "string" },
          post_type: { type: "string" },
          event_type: { type: "string" },
          location_handle: strProp("Handle of an existing media (location) account."),
          player_name: strProp("Name of a player created in this same bundle."),
          image_url: { type: "string" },
          scheduled_at: { type: "string" },
          is_headline: { type: "boolean" },
          headline_rank: { type: "integer" },
          headline_image_url: { type: "string" },
        },
      },
    },
  },
};

type Kind = {
  path: string;
  id: string;
  label: string;
  schema: Record<string, unknown>;
  destructive: string;
};

const KINDS: Kind[] = [
  { path: "players", id: "Player", label: "player card", schema: PlayerInput, destructive: "Replacing badges or traits deletes every current assignment on that card." },
  { path: "teams", id: "Team", label: "team", schema: TeamInput, destructive: "Sending `roster` replaces the whole team roster." },
  { path: "runs", id: "Run", label: "Run", schema: RunInput, destructive: "Sending `roster` replaces the Run roster; `rank_rewards` replaces the global ladder." },
  { path: "domination-games", id: "DominationGame", label: "Domination game", schema: DominationInput, destructive: "Targeted by road_name + game_order (or domination_game_id), never by opponent name, so rematches stay separate. Sending `roster` replaces that game's roster." },
  { path: "packs", id: "Pack", label: "pack", schema: PackInput, destructive: "Sending `players` or `odds` replaces the whole pool / odds table." },
  { path: "locker-codes", id: "LockerCode", label: "locker code", schema: LockerCodeInput, destructive: "Reward payload is replaced." },
  { path: "challenges", id: "Challenge", label: "challenge", schema: ChallengeInput, destructive: "" },
  { path: "dynamic-duos", id: "DynamicDuo", label: "dynamic duo", schema: DuoInput, destructive: "Boost objects are replaced." },
  { path: "storyline-bundles", id: "StorylineBundle", label: "storyline bundle", schema: BundleInput, destructive: "Creates a storyline plus its linked players, locker codes and posts atomically." },
];

export const READ_TABLE_LIST = [
  "player_cards", "teams", "team_players", "runs", "run_players", "run_rank_rewards",
  "domination_roads", "domination_games", "domination_game_players", "challenges", "gem_tasks", "gem_tiers",
  "gem_market_listings", "dynamic_duos", "collections", "sub_collections", "badges",
  "signature_traits", "player_card_badges", "player_card_traits", "packs", "pack_odds",
  "pack_players", "locker_codes", "evo_paths", "storylines", "storyline_entities",
  "social_creators", "social_posts", "location_accounts", "location_post_templates", "rule_config",
];

export function buildOpenApi(baseUrl: string) {
  const paths: Record<string, unknown> = {};

  for (const kind of KINDS) {
    for (const mode of ["preview", "commit"] as const) {
      const isCommit = mode === "commit";
      paths[`/${kind.path}/${mode}`] = {
        post: {
          operationId: `${mode}${kind.id}`,
          summary: `${isCommit ? "Apply" : "Validate"} a ${kind.label}`,
          description: (isCommit
            ? `Applies the previously previewed ${kind.label} atomically. Only call after previewing the identical body and getting explicit approval. ${kind.destructive}`
            : `Validates a ${kind.label} with ZERO writes and returns the create/update/replace plan. Always call first. ${kind.destructive}`).slice(0, 295),

          "x-openai-isConsequential": isCommit,
          requestBody: {
            required: true,
            content: { "application/json": { schema: kind.schema } },
          },
          responses: {
            "200": { description: "Plan", content: { "application/json": { schema: PlanResponse } } },
            "400": { description: "Validation failed; nothing was written." },
            "401": { description: "Not signed in." },
            "403": { description: "Signed in but not an admin." },
          },
        },
      };
    }
  }

  // ---------------------------------------------------------- Domination roads
  const roadTarget = {
    road_id: strProp("Immutable road id (preferred target)."),
    road_name: strProp("Case-insensitive exact road name. Also used to name a new road."),
  };

  paths["/domination-roads"] = {
    get: {
      operationId: "listDominationRoads",
      summary: "List Domination roads",
      description: "Every road with its road_id, name, description, sort order, active flag and game count.",
      "x-openai-isConsequential": false,
      responses: { "200": { description: "Roads", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } }, "401": { description: "Not signed in." } },
    },
  };

  paths["/domination-roads/export"] = {
    post: {
      operationId: "exportDominationRoad",
      summary: "Export a whole Domination road",
      description:
        "Returns one road exactly in the shape the road import body expects: road settings plus every game in game_order with its domination_game_id, opponent, opponent_team_id, difficulty stars, coin reward, pack_reward_id and full ordered roster, plus a rematch summary and warnings.",
      "x-openai-isConsequential": false,
      requestBody: {
        required: true,
        content: { "application/json": { schema: { type: "object", properties: roadTarget }, example: { road_name: "Tortuga" } } },
      },
      responses: { "200": { description: "Road payload", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } }, "401": { description: "Not signed in." }, "404": { description: "Unknown road." } },
    },
  };

  const RoadBulkInput = {
    type: "object",
    description:
      "Bulk import or replacement of one Domination road. Create or rename the road, set its metadata, and create / update / reorder / delete its games and rosters in a single transaction.",
    properties: {
      ...roadTarget,
      new_road_name: strProp("Rename the road; every game on it follows."),
      description: strProp("Road description."),
      sort_order: intProp("Display order among roads."),
      is_active: { type: "boolean" },
      mode: { type: "string", enum: ["merge", "replace"], description: "'merge' touches only the game_orders sent. 'replace' DESTRUCTIVELY makes the road match the payload exactly: games on that road whose game_order is absent are deleted; matched games keep their ids." },
      games: { type: "array", items: DominationInput, description: "Every game to create or update. Targeted by domination_game_id or game_order, never by opponent name." },
      preview_token: strProp("Commit only: the token returned by the matching preview."),
    },
  };

  for (const mode of ["preview", "commit"] as const) {
    const isCommit = mode === "commit";
    paths[`/domination-roads/${mode}`] = {
      post: {
        operationId: `${mode}DominationRoad`,
        summary: `${isCommit ? "Apply" : "Validate"} a bulk Domination road import`,
        description: isCommit
          ? "Applies a previously previewed road import atomically. Requires the single-use preview_token and a byte-identical body; a differing body is rejected with PREVIEW_MISMATCH and writes nothing. In mode='replace' games omitted from the payload are DELETED."
          : "Full validation with ZERO writes. Returns road_creates, road_updates, game_operations, destructive_operations and warnings plus a single-use preview_token. Always call this first and show the destructive operations to the user.",
        "x-openai-isConsequential": isCommit,
        requestBody: { required: true, content: { "application/json": { schema: RoadBulkInput } } },
        responses: {
          "200": { description: "Plan", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
          "400": { description: "Rejected; nothing was written." },
          "401": { description: "Not signed in." },
          "403": { description: "Signed in but not an admin." },
        },
      },
    };

    paths[`/domination-roads/delete/${mode}`] = {
      post: {
        operationId: `${mode}DeleteDominationRoad`,
        summary: `${isCommit ? "Delete" : "Preview deleting"} a whole Domination road`,
        description: isCommit
          ? "DESTRUCTIVE. Deletes the road with all of its games and rosters. Requires the preview_token from the matching preview. Player cards are never deleted."
          : "Reports every game and roster row that deleting the whole road would remove. Writes nothing and returns a single-use preview_token.",
        "x-openai-isConsequential": isCommit,
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", properties: { ...roadTarget, preview_token: strProp("Commit only.") } } } },
        },
        responses: {
          "200": { description: "Plan", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
          "400": { description: "Rejected; nothing was written." },
          "401": { description: "Not signed in." },
          "403": { description: "Signed in but not an admin." },
        },
      },
    };
  }

  const CardRef = {
    type: "object",
    properties: {
      player_name: strProp("Card display name."),
      player_card_id: strProp("Immutable card id; required when a name is duplicated."),
      slot: intProp("1-based ordering slot."),
      is_reward: { type: "boolean", description: "Collection-completion reward card (exactly one per collection)." },
    },
  };

  const Assignment = {
    type: "object",
    properties: {
      badge: strProp("Badge name (badge assignments)."),
      trait: strProp("Signature trait name (trait assignments)."),
      tier: strProp("base | gold | hof | diamond | actolytrene. 'Hall of Fame' is accepted."),
      target_stat: strProp("Trait target stat, e.g. stat_3pt. '3PT' is accepted."),
    },
  };

  const ReleaseInput = {
    type: "object",
    required: ["release"],
    description:
      "One complete content release: the release record, a collection with ordered membership and exactly one completion reward, bulk player cards with badge/trait assignments, an optional team, a pack whose odds total exactly 100.00%, and multi-step evo paths where EVERY step carries a resulting_version.",
    properties: {
      release: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string" },
          slug: { type: "string" },
          status: strProp("draft | published."),
          description: { type: "string" },
        },
      },
      collection: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          player_cards: { type: "array", items: CardRef, description: "Ordered membership. Exactly one entry may set is_reward." },
          reward_player_name: strProp("Completion reward card name."),
          reward_player_card_id: strProp("Completion reward card id."),
        },
      },
      players: {
        type: "array",
        description: "Bulk create/update of the release's cards. Ratings are decimals and preserved exactly.",
        items: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string" },
            player_card_id: strProp("Immutable target for edits; required when the name is duplicated."),
            new_name: strProp("Rename the card."),
            gem_tier: strProp("Gem tier name."),
            rating: { type: "number" },
            run_rating: { type: "number" },
            position1: { type: "string" },
            position2: { type: "string" },
            collection: { type: "string" },
            sub_collection: { type: "string" },
            team: { type: "string" },
            is_collection_reward: { type: "boolean" },
            stats: { type: "object", additionalProperties: { type: "number" }, description: "stat_3pt, stat_mid, stat_fin, stat_dnk, stat_ast, stat_stl, stat_reb, stat_blk, stat_int (0-99)." },
            badges: { type: "array", items: Assignment, description: "REPLACES every current badge assignment on the card." },
            traits: { type: "array", items: Assignment, description: "REPLACES every current trait assignment on the card." },
          },
        },
      },
      team: {
        type: "object",
        required: ["name", "roster"],
        properties: {
          name: { type: "string" },
          category: { type: "string" },
          unlock_cost: { type: "number" },
          roster: { type: "array", items: CardRef, description: "Ordered roster; REPLACES the whole team roster." },
        },
      },
      pack: {
        type: "object",
        required: ["name", "players", "odds"],
        properties: {
          name: { type: "string" },
          pack_type: strProp("standard | premium | promo."),
          cost: { type: "number" },
          ten_box_cost: { type: "number" },
          players: { type: "array", items: CardRef, description: "Ordered pool; REPLACES the pool." },
          odds: {
            type: "array",
            description: "REPLACES the odds table. Must total exactly 100.00 in fixed precision.",
            items: {
              type: "object",
              required: ["result_slot", "percentage"],
              properties: {
                result_slot: strProp("Pool slot number, or 'player_choice'."),
                percentage: { type: "number", description: "Up to two decimals." },
                description: { type: "string" },
              },
            },
          },
        },
      },
      evo_paths: {
        type: "array",
        description: "Multi-step evolution paths. Tier progression must be continuous (no skipped tiers) and every step must materialize a playable version.",
        items: {
          type: "object",
          required: ["steps"],
          properties: {
            player_name: { type: "string" },
            player_card_id: strProp("Immutable card id of an EXISTING source card (preferred). The card is not modified."),
            card_key: strProp("Slug of an existing source card."),
            source_gem_tier: strProp("Current tier of the source card; must equal the first step's from_tier."),
            rating: { type: "number" },
            collection: { type: "string" },
            sub_collection: { type: "string" },
            team: { type: "string" },
            card_variant: { type: "string" },
            evo_stage: { type: "integer" },
            status: strProp("draft | published."),

            steps: {
              type: "array",
              items: {
                type: "object",
                required: ["from_tier", "to_tier", "step_order", "objectives", "resulting_version"],
                properties: {
                  from_tier: { type: "string" },
                  to_tier: { type: "string" },
                  step_order: { type: "integer" },
                  objectives: {
                    type: "array",
                    items: {
                      type: "object",
                      required: ["stat", "amount"],
                      properties: {
                        stat: strProp("points, three_pointers_made, mid_range_shots_made, dunks_made, assists, steals, rebounds, blocks, games_won."),
                        amount: { type: "number" },
                        description: { type: "string" },
                      },
                    },
                  },
                  resulting_version: {
                    type: "object",
                    required: ["stats"],
                    description: "REQUIRED on every step: the playable card version unlocked by completing it.",
                    properties: {
                      rating: { type: "number" },
                      gem_name: strProp("Gem tier of the unlocked version."),
                      stats: { type: "object", additionalProperties: { type: "number" } },
                      badges: { type: "array", items: Assignment },
                      traits: { type: "array", items: Assignment },
                    },
                  },
                },
              },
            },
          },
        },
      },
      forbid_existing_links_to: {
        type: "array",
        items: { type: "string" },
        description: "Collection names this release must not link cards to (guards against cross-release contamination).",
      },
      preview_token: strProp("Commit only: the single-use token returned by the matching preview."),
    },
  };

  for (const mode of ["preview", "commit"] as const) {
    const isCommit = mode === "commit";
    paths[`/content-release/${mode}`] = {
      post: {
        operationId: `${mode}ContentRelease`,
        summary: `${isCommit ? "Publish" : "Validate"} a complete atomic content release`,
        description: isCommit
          ? "Publishes an approved release in ONE transaction: cards, collection, membership, reward, team, pack pool and odds, evo steps and evo card versions all succeed or roll back. Requires the preview_token and an identical body."
          : "Validates a whole release (collections AND evo paths together) with ZERO writes. Normalizes spellings, checks tier progression, evo versions, odds totalling 100.00, and returns a payload_hash plus preview_token.",

        "x-openai-isConsequential": isCommit,
        requestBody: { required: true, content: { "application/json": { schema: ReleaseInput } } },
        responses: {
          "200": { description: "Plan", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } },
          "400": { description: "Rejected; nothing was written." },
          "401": { description: "Not signed in." },
          "403": { description: "Signed in but not an admin." },
        },
      },
    };
  }


  paths["/diagnostics"] = {
    get: {
      operationId: "getDiagnostics",
      summary: "List incomplete or broken content",
      description:
        "Unrated players, teams with fewer than 3 cards, Runs and Domination games with no roster, packs with no pool / no odds / odds that do not total 100, malformed locker code rewards, and storylines with broken entity links. Call this first when asked to fill gaps.",
      "x-openai-isConsequential": false,
      responses: { "200": { description: "Diagnostics", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } }, "401": { description: "Not signed in." } },
    },
  };

  paths["/references"] = {
    get: {
      operationId: "getReferences",
      summary: "Exact names every write operation accepts",
      description:
        "Gem tiers, teams, packs, collections, sub-collections, badges, signature traits, media accounts, storylines, challenges, Runs, Domination roads, rule_config keys and all player card names. Call this before any write so every name resolves.",
      "x-openai-isConsequential": false,
      responses: { "200": { description: "Reference names", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } }, "401": { description: "Not signed in." } },
    },
  };

  paths["/list"] = {
    post: {
      operationId: "listRows",
      summary: "List rows from a content table",
      description: "Filtered read of any non-user content table. Use before writing to see current values.",
      "x-openai-isConsequential": false,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["table"],
              properties: {
                table: { type: "string", enum: READ_TABLE_LIST },
                search: strProp("Case-insensitive match against the table's name/title/code column."),
                columns: strProp("Comma-separated column list. Defaults to all."),
                limit: { type: "integer", minimum: 1, maximum: 500 },
              },
            },
            example: { table: "player_cards", search: "iso", limit: 25 },
          },
        },
      },
      responses: { "200": { description: "Rows", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } }, "401": { description: "Not signed in." } },
    },
  };

  paths["/entity"] = {
    post: {
      operationId: "getEntity",
      summary: "Get one entity with its linked rows",
      description:
        "Full detail for a single entity looked up by name (or road_name + opponent_name for Domination): a player with its badges/traits, a team or Run or Domination game with its roster, a pack with pool and odds, a storyline with its entities, plus challenges, locker codes and duos.",
      "x-openai-isConsequential": false,
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: {
              type: "object",
              required: ["type", "name"],
              properties: {
                type: { type: "string", enum: ["player", "team", "run", "domination_game", "pack", "storyline", "challenge", "locker_code", "dynamic_duo"] },
                name: strProp("Entity name / code / title. For domination_game pass the opponent name."),
                road_name: strProp("Required for domination_game."),
              },
            },
            example: { type: "player", name: "Marcus Vale" },
          },
        },
      },
      responses: { "200": { description: "Entity detail", content: { "application/json": { schema: { type: "object", additionalProperties: true } } } }, "401": { description: "Not signed in." }, "404": { description: "Not found." } },
    },
  };

  // ---------------------------------------------------------------- v1 bulk API
  const anyObj = { type: "object", additionalProperties: true } as const;
  const okJson = (description: string) => ({
    "200": { description, content: { "application/json": { schema: anyObj } } },
    "400": { description: "Validation failed. Nothing was written." },
    "401": { description: "Not signed in." },
    "403": { description: "Admin role required." },
    "409": { description: "Preview mismatch, reused token, or idempotency conflict. Nothing was written." },
  });

  paths["/admin-api/v1/capabilities"] = {
    get: {
      operationId: "getAdminApiCapabilities",
      summary: "Machine-readable backend capabilities",
      description:
        "Supported entities, bulk groups, mutable fields, replacement semantics, evo objective statistics, gem tier OVR bands, badges/traits rules, batch and payload limits, preview token TTL, scheduling support and API version. Call this before bulk work instead of guessing.",
      "x-openai-isConsequential": false,
      responses: okJson("Capabilities"),
    },
  };

  paths["/admin-api/v1/diagnostics"] = {
    get: {
      operationId: "getAdminApiDiagnostics",
      summary: "Full content health audit (v1)",
      description:
        "Invalid OVR, OVR/tier mismatches, duplicate and ambiguous names, broken collection links, reward contamination, packs missing pools or odds not totalling 100.00, empty rosters, duplicate game orders, broken evo sources, skipped tiers, missing evo versions and stale scheduled jobs — each with remediation.",
      "x-openai-isConsequential": false,
      responses: okJson("Diagnostics"),
    },
  };

  paths["/admin-api/v1/bulk/preview"] = {
    post: {
      operationId: "previewBulk",
      summary: "Preview any bulk change (zero writes)",
      description:
        "One canonical document may contain players, collections, sub_collections, teams, packs, evo_paths, challenges, locker_codes, dynamic_duos, runs, domination_roads, domination_games, storylines and social_posts. Writes nothing. Returns the plan, canonical_payload, payload_hash and a single-use preview_token.",
      "x-openai-isConsequential": false,
      requestBody: { required: true, content: { "application/json": { schema: anyObj, example: { players: [{ player_card_id: "uuid", rating: 2.11 }] } } } },
      responses: okJson("Preview plan"),
    },
  };

  paths["/admin-api/v1/bulk/commit"] = {
    post: {
      operationId: "commitBulk",
      summary: "Commit an approved bulk preview atomically",
      description:
        "Send the identical canonical_payload from the preview plus its preview_token. Optional idempotency_key makes retries safe. The whole scope is applied in one transaction or fully rolled back. Requires explicit user approval of the preview first.",
      "x-openai-isConsequential": true,
      requestBody: {
        required: true,
        content: { "application/json": { schema: anyObj, example: { preview_token: "tok", idempotency_key: "release-galactic-1", players: [{ player_card_id: "uuid", rating: 2.11 }] } } },
      },
      responses: okJson("Commit report"),
    },
  };

  paths["/admin-api/v1/previews/{preview_id}"] = {
    get: {
      operationId: "getPreviewDetail",
      summary: "Paged detail for a stored preview",
      description: "Reads a large preview plan server-side. Omit section for the summary and section list; pass section and page for paged rows. The payload_hash and preview_token stay the same for the whole operation.",
      "x-openai-isConsequential": false,
      parameters: [
        { name: "preview_id", in: "path", required: true, schema: { type: "string" } },
        { name: "section", in: "query", required: false, schema: { type: "string" } },
        { name: "page", in: "query", required: false, schema: { type: "integer", minimum: 1 } },
      ],
      responses: okJson("Preview detail"),
    },
  };

  paths["/admin-api/v1/schedule"] = {
    get: {
      operationId: "listScheduledJobs",
      summary: "List scheduled content jobs",
      description: "Every scheduled, running, succeeded, failed or cancelled job with its run time, timezone, payload hash and last error.",
      "x-openai-isConsequential": false,
      responses: okJson("Scheduled jobs"),
    },
    post: {
      operationId: "scheduleApprovedPreview",
      summary: "Schedule an approved preview for later",
      description:
        "Stores the approved canonical payload and runs it at run_at (ISO-8601, stored in UTC; timezone is for display). At execution the payload is re-previewed and the plan compared with the approved plan — a changed plan fails the job instead of writing.",
      "x-openai-isConsequential": true,
      requestBody: {
        required: true,
        content: { "application/json": { schema: anyObj, example: { preview_token: "tok", run_at: "2026-08-10T18:00:00Z", timezone: "America/New_York", label: "Galactic drop" } } },
      },
      responses: okJson("Scheduled job"),
    },
  };

  paths["/admin-api/v1/schedule/{job_id}/cancel"] = {
    post: {
      operationId: "cancelScheduledJob",
      summary: "Cancel a scheduled job",
      description: "Cancels a job that has not executed yet. Already running or executed jobs cannot be cancelled.",
      "x-openai-isConsequential": true,
      parameters: [{ name: "job_id", in: "path", required: true, schema: { type: "string" } }],
      responses: okJson("Cancelled"),
    },
  };

  paths["/admin-api/v1/schedule/{job_id}/reschedule"] = {
    post: {
      operationId: "rescheduleJob",
      summary: "Change a scheduled job's run time",
      description: "Moves a scheduled job to a new run_at (ISO-8601) and optionally updates its timezone or label. The approved payload and its drift check stay unchanged.",
      "x-openai-isConsequential": true,
      parameters: [{ name: "job_id", in: "path", required: true, schema: { type: "string" } }],
      requestBody: { required: true, content: { "application/json": { schema: anyObj, example: { run_at: "2026-08-11T18:00:00Z", timezone: "UTC" } } } },
      responses: okJson("Rescheduled"),
    },
  };

  return {
    openapi: "3.1.0",
    info: {
      title: "GTeam Infinite Hub Content API",
      version: "1.0.0",
      description:
        "Admin content-management API for GTeam Infinite Hub. Reads require a signed-in GTeam user; every write requires the admin role and runs server-side under row-level security. Every mutation exists as a preview (validate only, no writes) and a commit (apply the validated plan atomically).",
    },
    servers: [{ url: baseUrl }],
    paths,
    components: {
      schemas: { Plan: PlanResponse },
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

export const GPT_INSTRUCTIONS = `You manage game content for GTeam Infinite Hub through the GTeam Infinite Hub Content API.

Workflow — follow it every time:
1. INSPECT FIRST. Call getDiagnostics and getReferences before proposing anything, and listRows / getEntity to read the current values of whatever you are about to change. Only use names that appear in getReferences; never invent a gem tier, team, badge, trait, pack or player name.
2. PREVIEW EVERY MUTATION. Call the preview* operation with the exact body you intend to commit. Preview never writes.
3. SHOW THE PLAN. Present the returned operations and, in bold, every entry in destructive_operations (roster, pool, odds, badge/trait or rank-reward replacements) including how many existing rows would be deleted.
4. WAIT FOR EXPLICIT APPROVAL. Do not call any commit* operation until the user says yes to that specific plan.
5. COMMIT. Call the matching commit* operation with the identical body, then report what changed.

Rules:
- If a preview returns an error, fix the input and preview again. A failed preview or commit writes nothing.
- Ratings are decimals — preserve the exact value (87.4 stays 87.4).
- Sending badges or traits on a player replaces ALL of that card's assignments; omit them to leave them alone.
- run_rank_rewards is one global ladder shared by every Run.
- For anything spanning more than one entity — a collection plus its cards, a pack, a team and evo paths — use previewBulk / commitBulk (the versioned /admin-api/v1 surface). Call getAdminApiCapabilities first to see supported fields and limits; never infer them from failed writes. previewContentRelease / commitContentRelease remain as the older release-only path.
- Bulk workflow: previewBulk -> show creates/updates/deletes/replacements and every warning -> explicit approval -> commitBulk with the identical canonical_payload, its preview_token and an idempotency_key. For large plans use getPreviewDetail to page through the sections.
- To publish later, approve a preview and then call scheduleApprovedPreview with run_at; use listScheduledJobs, rescheduleJob and cancelScheduledJob to manage it. A scheduled job that no longer matches its approved plan fails instead of writing.
- OVR is the average of the nine base stats and must sit inside the gem tier band (Emerald 1.00-1.99, Amethyst 2.00-2.99, Diamond 3.00-3.99, Pink Diamond 4.00-4.99, Actolytrene 5.00+). Never silently change a requested tier; fix the stats or ask.
- This API only edits game content. It cannot and must not be used to modify app code, user accounts, balances, or anyone's collection. If asked, say so and stop.`;
