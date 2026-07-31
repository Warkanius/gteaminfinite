import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { CHALLENGE_TYPES, STAT_KEYS, itemArray, runBatch, safetyNote, type BatchPayload } from "../batch";

type Fields = Record<string, z.ZodTypeAny>;

/**
 * Builds the preview/commit tool pair for one batch shape. Both tools accept the
 * identical payload; only the commit tool takes (and requires) the preview_token.
 */
function pair(opts: {
  base: string;
  title: string;
  kind: string;
  description: string;
  fields: Fields;
  toPayload: (input: Record<string, any>) => BatchPayload;
}) {
  const previewTool = defineTool({
    name: `preview${opts.base}`,
    title: `Preview: ${opts.title}`,
    description: `Admin only. ZERO WRITES. ${opts.description} Returns creates, updates, deletes, replacements, warnings, resolved_references, normalized_payload, payload_hash and a one-time preview_token. ${safetyNote}`,
    inputSchema: opts.fields,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    handler: async (input, ctx) => runBatch(ctx, opts.toPayload(input as any), "preview", undefined, opts.kind),
  });

  const commitTool = defineTool({
    name: `commit${opts.base}`,
    title: `Commit: ${opts.title}`,
    description: `Admin only. Applies a previously previewed and user-approved payload atomically. The payload must be byte-identical to the preview it came from; otherwise the commit is rejected with PREVIEW_MISMATCH and nothing is written.`,
    inputSchema: {
      ...opts.fields,
      preview_token: z.string().describe("The preview_token returned by the matching preview. Single use."),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    handler: async (input, ctx) => {
      const { preview_token, ...rest } = input as any;
      return runBatch(ctx, opts.toPayload(rest), "commit", preview_token, opts.kind);
    },
  });

  return [previewTool, commitTool];
}

const GROUP_KEYS = [
  "players",
  "teams",
  "runs",
  "domination_roads",
  "domination_games",
  "packs",
  "locker_codes",
  "challenges",
  "dynamic_duos",
  "evo_paths",
  "storylines",
] as const;

const groupFields: Fields = Object.fromEntries(
  GROUP_KEYS.map((k) => [
    k,
    z
      .array(z.record(z.string(), z.any()))
      .optional()
      .describe(
        `${k} to create/update. Each item may carry action ('create' | 'update' | 'upsert' | 'replace'), an immutable id (player_id / team_id / run_id / pack_id / challenge_id / domination_game_id / evo_path_id / storyline_id), a temp_ref for later items to reference, and any of the fields the matching single-entity tool accepts.`,
      ),
  ]),
);

const contentBatch = pair({
  base: "ContentBatch",
  title: "mixed content batch",
  kind: "content_batch",
  description:
    "Preview one batch spanning any mix of players, teams, runs, domination roads, domination games, packs, locker codes, challenges, dynamic duos, evo paths and storylines. Groups execute in dependency order (players first, then teams/runs/roads, then evo paths and storylines). Items may declare temp_ref: 'ref:player:my-new-card' and later items may point at it with e.g. destination_player_ref or inside a roster array; those refs resolve inside the same transaction. Names resolve by exact case-insensitive match only — ambiguous player names are rejected with every matching card listed.",
  fields: groupFields,
  toPayload: (input) => input,
});

const playerBatch = pair({
  base: "PlayerBatch",
  title: "player card batch",
  kind: "player_batch",
  description:
    "Preview a batch of player-card creates/updates. Target each card with player_id (preferred), card_key, or an exact name — duplicate display names are allowed, so a name that matches more than one card is rejected with all matches. Supported fields: new_name, new_card_key, card_variant, evo_stage, base_card_id, gem_tier/gem_tier_id, team/team_id, collection(_id), sub_collection(_id), position1/2, rating (decimals kept), run_rating, market_value, social_handle, avatar_url, card colours/animation, all stat_* and run_stat_* keys, plus badges and traits. Sending badges or traits REPLACES every assignment on that card and is reported as a destructive replacement with the removed entries.",
  fields: {
    players: itemArray("Player card entries. Each needs player_id, card_key, or name."),
  },
  toPayload: (input) => ({ players: input.players }),
});

const teamBatch = pair({
  base: "TeamBatch",
  title: "team and roster batch",
  kind: "team_batch",
  description:
    "Preview a batch of team creates/updates, optionally replacing rosters. Target a team with team_id or its exact name. Roster entries may be { player_id }, { card_key } or { player_name } (exact, unique). A supplied roster replaces the WHOLE roster and is only honoured when replace_roster: true (otherwise it is skipped with a ROSTER_IGNORED warning). Slot order follows array order; the preview reports added, removed and reordered cards.",
  fields: {
    teams: itemArray("Team entries: team_id or name, plus category, unlock_cost, roster, replace_roster."),
  },
  toPayload: (input) => ({ teams: input.teams }),
});

const dominationRoad = pair({
  base: "DominationRoad",
  title: "complete Domination road",
  kind: "domination_road",
  description:
    "Preview an entire Domination road in one operation, rematch-safe: every game's game_order, opponent, difficulty stars (1-5), coin/pack rewards and full opponent roster. Games are identified by domination_game_id (preferred) or by road_name + game_order — NEVER by opponent name, so the same opponent may legally appear at several game_orders on one road (e.g. Lockport at 1 and 6) and each stays a separate game with its own id and roster. Validates unique game_order, difficulty range, non-negative rewards, opponent_team_id / pack_reward_id / roster references and complete rosters; errors report the offending game_order and field. With replace_road: true, games on THAT road only whose game_order is absent from the payload are deleted (reported under deletes) while games that are present keep their existing ids.",
  fields: {
    road_name: z.string().min(1).describe("Road the games belong to, e.g. 'Tortuga'."),
    replace_road: z
      .boolean()
      .optional()
      .describe(
        "DESTRUCTIVE: delete games on this road whose game_order is not in `games`. Scoped to this road only; matched games keep their ids.",
      ),
    games: z
      .array(
        z.object({
          domination_game_id: z
            .string()
            .uuid()
            .optional()
            .describe("Immutable id of an existing game — the only fully unambiguous target."),
          game_order: z
            .number()
            .int()
            .min(1)
            .describe("Position on the road; unique per road and used as the fallback target."),
          opponent_name: z.string().optional().describe("Display name only; duplicates across game_orders are allowed."),
          opponent_team_id: z.string().uuid().optional().describe("Optional link to a teams row."),
          difficulty_stars: z.number().int().min(1).max(5).optional(),
          coin_reward: z.number().int().min(0).optional(),
          pack_reward_id: z
            .string()
            .uuid()
            .nullable()
            .optional()
            .describe("Preferred pack reward target; pack names are often duplicated. null clears it."),
          pack_reward: z
            .string()
            .nullable()
            .optional()
            .describe("Legacy: pack id or exact unique pack name. An ambiguous name is rejected with AMBIGUOUS_PACK."),
          roster: z
            .array(z.any())
            .optional()
            .describe(
              "Ordered roster: { player_id } | { card_key } | { player_name } | 'ref:player:...'. DESTRUCTIVE full replacement for THIS game only.",
            ),
        }),
      )
      .min(1),
  },
  toPayload: (input) => ({
    domination_roads: [
      { road_name: input.road_name, replace_road: input.replace_road, games: input.games },
    ],
  }),
});


const evoPathFields: Fields = {
  evo_path_id: z.string().uuid().optional().describe("Update an existing path."),
  source_player_id: z.string().uuid().optional(),
  source_card_key: z.string().optional(),
  destination_player_id: z.string().uuid().optional().describe("The upgraded card this path evolves into."),
  destination_card_key: z.string().optional(),
  from_gem_tier_id: z.string().uuid().optional(),
  from_gem_tier: z.string().optional(),
  to_gem_tier_id: z.string().uuid().optional(),
  to_gem_tier: z.string().optional(),
  step_order: z.number().int().min(1).optional(),
  challenge_description: z.string().optional(),
  challenge_type: z.enum(CHALLENGE_TYPES).optional(),
  challenge_target: z.number().int().min(1).optional(),
  challenge_stat: z.enum(STAT_KEYS).optional().describe("Required for total_stat and single_game_stat."),
  stat_boosts: z.record(z.string(), z.number()).optional().describe("Stat key -> boost, e.g. { stat_3pt: 4 }."),
  new_badges: z.array(z.any()).optional(),
  new_traits: z.array(z.any()).optional(),
  compound_challenges: z.array(z.any()).optional().describe("Required for multi_condition."),
};

const evoPathDescription =
  "Validates that the source card exists, that source and destination differ, that the destination chain does not loop back (CIRCULAR_EVO_CHAIN), that any tier change moves upward, that step_order does not collide with another path on the same card, that challenge_stat is present for total_stat / single_game_stat and compound_challenges for multi_condition, and that badge/trait references resolve.";

const evoPath = pair({
  base: "EvoPath",
  title: "single Evo Path",
  kind: "evo_path",
  description: `Preview one Evo Path create/update. ${evoPathDescription}`,
  fields: evoPathFields,
  toPayload: (input) => ({ evo_paths: [input] }),
});

const evoPathBatch = pair({
  base: "EvoPathBatch",
  title: "Evo Path batch",
  kind: "evo_path_batch",
  description: `Preview many Evo Paths at once, e.g. a whole multi-step chain. ${evoPathDescription}`,
  fields: { evo_paths: itemArray("Evo Path entries, same fields as previewEvoPath.") },
  toPayload: (input) => ({ evo_paths: input.evo_paths }),
});

const evoBundle = pair({
  base: "EvoBundle",
  title: "Evo bundle (new card + path)",
  kind: "evo_bundle",
  description:
    "Preview a complete evolution bundle in ONE transaction: create the upgraded destination card (with its badges and traits), create the Evo Path from the source card to it, and link source -> destination. If any step fails, the whole bundle rolls back. The destination card gets its own immutable card_key, so it may reuse the source card's display name.",
  fields: {
    source_player_id: z.string().uuid().optional().describe("Source card id (preferred)."),
    source_card_key: z.string().optional().describe("Source card_key, if you do not have the id."),
    destination_player: z
      .object({
        name: z.string(),
        card_key: z.string().describe("Unique immutable key for the new card, e.g. 'dan-hanson-vesper-evo-1'."),
        card_variant: z.string().optional(),
        evo_stage: z.number().int().optional(),
        gem_tier: z.string().optional(),
        gem_tier_id: z.string().uuid().optional(),
        team: z.string().optional(),
        team_id: z.string().uuid().optional(),
        rating: z.number().optional(),
        stats: z.record(z.string(), z.number()).optional().describe("Stat key -> value, e.g. { stat_3pt: 92 }."),
        badges: z.array(z.any()).optional(),
        traits: z.array(z.any()).optional(),
      })
      .describe("The upgraded card to create."),
    evo_path: z.object(evoPathFields as never).partial().describe("Evo Path fields; source/destination are wired for you."),
  },
  toPayload: (input) => {
    const { stats, ...dest } = input.destination_player ?? {};
    return {
      players: [
        {
          temp_ref: "ref:player:evo_bundle_destination",
          action: "create",
          ...dest,
          ...(stats ?? {}),
          base_card_id: input.source_player_id,
        },
      ],
      evo_paths: [
        {
          ...(input.evo_path ?? {}),
          source_player_id: input.source_player_id,
          source_card_key: input.source_card_key,
          destination_player_ref: "ref:player:evo_bundle_destination",
        },
      ],
    };
  },
});

export const batchTools = [
  ...contentBatch,
  ...playerBatch,
  ...teamBatch,
  ...dominationRoad,
  ...evoPath,
  ...evoPathBatch,
  ...evoBundle,
];
