import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { runBatch, safetyNote } from "../batch";
import { prepareRelease, type ContentReleaseInput } from "../../contentRelease";

const assignment = z.union([
  z.string(),
  z
    .object({
      badge: z.string().optional(),
      badge_id: z.string().optional(),
      trait: z.string().optional(),
      trait_id: z.string().optional(),
      tier: z.string().optional().describe("base | gold | hof | diamond | actolytrene. 'Hall of Fame' is accepted."),
      target_stat: z.string().optional().describe("Trait target stat, e.g. stat_3pt. '3PT' is accepted."),
    })
    .passthrough(),
]);

const cardRef = z.object({
  player_name: z.string().optional(),
  player_card_id: z.string().uuid().optional(),
  slot: z.number().int().positive().optional(),
  is_reward: z.boolean().optional(),
});

const releaseFields = {
  release: z.object({
    name: z.string().min(1),
    slug: z.string().optional(),
    status: z.enum(["draft", "published"]).optional(),
    description: z.string().optional(),
  }),
  collection: z
    .object({
      name: z.string().min(1),
      description: z.string().optional(),
      player_cards: z.array(cardRef).optional().describe("Ordered membership. Exactly one entry may set is_reward."),
      reward_player_name: z.string().optional(),
      reward_player_card_id: z.string().uuid().optional(),
    })
    .optional(),
  players: z
    .array(
      z
        .object({
          name: z.string().min(1),
          player_card_id: z.string().uuid().optional().describe("Immutable target for edits; required when the name is duplicated."),
          new_name: z.string().optional(),
          gem_tier: z.string().optional(),
          rating: z.number().optional(),
          run_rating: z.number().optional(),
          position1: z.string().optional(),
          position2: z.string().nullable().optional(),
          collection: z.string().optional(),
          sub_collection: z.string().optional(),
          team: z.string().optional(),
          is_collection_reward: z.boolean().optional(),
          stats: z.record(z.string(), z.number()).optional().describe("stat_3pt, stat_mid, stat_fin, stat_dnk, stat_ast, stat_stl, stat_reb, stat_blk, stat_int (0-99)."),
          badges: z.array(assignment).optional(),
          traits: z.array(assignment).optional(),
        })
        .passthrough(),
    )
    .optional(),
  team: z
    .object({
      name: z.string().min(1),
      category: z.string().optional(),
      unlock_cost: z.number().optional(),
      roster: z.array(cardRef.extend({ slot: z.number().int().positive() })),
    })
    .optional(),
  pack: z
    .object({
      name: z.string().min(1),
      pack_type: z.enum(["standard", "premium", "promo"]).optional(),
      cost: z.number().optional(),
      ten_box_cost: z.number().nullable().optional(),
      players: z.array(cardRef.extend({ slot: z.number().int().positive() })).describe("Ordered pool; slot order is preserved."),
      odds: z
        .array(
          z.object({
            result_slot: z.string().describe("Pool slot number, or 'player_choice'."),
            percentage: z.union([z.number(), z.string()]).describe("Up to two decimals. All rows must total exactly 100.00."),
            description: z.string().optional(),
          }),
        )
        .describe("Must total exactly 100.00% in fixed precision."),
    })
    .optional(),
  evo_paths: z
    .array(
      z.object({
        player_name: z.string().optional(),
        player_card_id: z.string().uuid().optional(),
        status: z.enum(["draft", "published"]).optional(),
        steps: z.array(
          z.object({
            from_tier: z.string(),
            to_tier: z.string(),
            step_order: z.number().int().positive(),
            objectives: z.array(
              z.object({
                stat: z.string().describe("points, three_pointers_made, mid_range_shots_made, dunks_made, assists, steals, rebounds, blocks, games_won."),
                amount: z.number().positive(),
                description: z.string().optional(),
              }),
            ),
            resulting_version: z
              .object({
                rating: z.number().optional(),
                gem_name: z.string().optional(),
                stats: z.record(z.string(), z.number()),
                badges: z.array(assignment).optional(),
                traits: z.array(assignment).optional(),
              })
              .describe("REQUIRED for every step: the materialized playable card version unlocked by completing it."),
          }),
        ),
      }),
    )
    .optional(),
  forbid_existing_links_to: z
    .array(z.string())
    .optional()
    .describe("Collection names this release must not link cards to (guards against cross-release contamination)."),
} as const;

const KIND = "content_release";

function clientIssues(input: Record<string, unknown>) {
  const { validations, valid, payload } = prepareRelease(input as unknown as ContentReleaseInput);
  return { validations, valid, payload };
}

const previewContentRelease = defineTool({
  name: "preview_content_release",
  title: "Preview: atomic content release",
  description:
    "Admin only. ZERO WRITES. Validates one complete content release — release record, collection with ordered membership and exactly one completion reward, bulk player cards with badge/trait assignments, an optional release team roster, a pack with an ordered pool whose odds total exactly 100.00% in fixed precision, and multi-step evo paths where EVERY step carries a resulting_version that materializes the playable card (tier, rating, stats, badges, traits). Normalizes imported spellings ('Hall of Fame' -> hof, '3PT' -> stat_3pt), enforces tier progression with no skipped tiers, keeps the collection reward out of the pack, rejects ambiguous player names with every candidate listed, and returns the ordered creates/updates/replacements plus a payload_hash and single-use preview_token." +
    safetyNote,
  inputSchema: releaseFields,
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  handler: async (input, ctx) => {
    const { validations, valid, payload } = clientIssues(input as Record<string, unknown>);
    if (!valid) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ ok: false, stage: "validation", validations }, null, 2),
          },
        ],
        isError: true,
      };
    }
    return runBatch(ctx, payload, "preview", undefined, KIND);
  },
});

const commitContentRelease = defineTool({
  name: "commit_content_release",
  title: "Commit: atomic content release",
  description:
    "Admin only. Publishes a previewed and user-approved content release in ONE Postgres transaction — cards, collection, membership, reward, team roster, pack pool and odds, evo steps and every materialized evo card version succeed together or the whole release rolls back. The payload must hash identically to its preview (otherwise PREVIEW_PAYLOAD_MISMATCH / PREVIEW_ALREADY_COMMITTED / PREVIEW_TOKEN_EXPIRED and nothing is written). Returns created/updated ids and a post-commit verification summary.",
  inputSchema: {
    ...releaseFields,
    preview_token: z.string().describe("The preview_token from the matching preview. Single use."),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  handler: async (input, ctx) => {
    const { preview_token, ...rest } = input as Record<string, unknown> & { preview_token: string };
    const { validations, valid, payload } = clientIssues(rest);
    if (!valid) {
      return {
        content: [
          { type: "text" as const, text: JSON.stringify({ ok: false, stage: "validation", validations }, null, 2) },
        ],
        isError: true,
      };
    }
    return runBatch(ctx, payload, "commit", preview_token, KIND);
  },
});

export const contentReleaseTools = [previewContentRelease, commitContentRelease];
