import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { runBatch, safetyNote } from "../batch";
import { adminClient, ok, fail } from "../db";

const bundleFields = {
  release: z
    .record(z.string(), z.any())
    .optional()
    .describe("Release record: name, version_label, version_number, parent_release_id, notes, status."),
  players: z.array(z.record(z.string(), z.any())).optional().describe("Player cards to create/update."),
  collections: z.array(z.record(z.string(), z.any())).optional(),
  sub_collections: z.array(z.record(z.string(), z.any())).optional(),
  collection_requirements: z
    .array(z.record(z.string(), z.any()))
    .optional()
    .describe("Collection membership. action:'replace' replaces the whole membership list (destructive)."),
  packs: z
    .array(z.record(z.string(), z.any()))
    .optional()
    .describe("Packs with ordered pool + odds. replace_pool / replace_odds are destructive replacements."),
  evo_paths: z.array(z.record(z.string(), z.any())).optional().describe("Evo steps; one row per step_order."),
  badges: z.array(z.record(z.string(), z.any())).optional(),
  signature_traits: z.array(z.record(z.string(), z.any())).optional(),
  gem_tiers: z.array(z.record(z.string(), z.any())).optional(),
  teams: z.array(z.record(z.string(), z.any())).optional(),
  runs: z.array(z.record(z.string(), z.any())).optional(),
  domination_roads: z.array(z.record(z.string(), z.any())).optional(),
  domination_games: z.array(z.record(z.string(), z.any())).optional(),
  challenges: z.array(z.record(z.string(), z.any())).optional(),
  locker_codes: z.array(z.record(z.string(), z.any())).optional(),
  dynamic_duos: z.array(z.record(z.string(), z.any())).optional(),
  storylines: z.array(z.record(z.string(), z.any())).optional(),
  social_posts: z.array(z.record(z.string(), z.any())).optional(),
  release_bundles: z.array(z.record(z.string(), z.any())).optional(),
  notes: z.string().optional(),
} as const;

const KIND = "content_bundle";

const previewContentBundle = defineTool({
  name: "preview_content_bundle",
  title: "Preview: complete content release bundle",
  description:
    "Admin only. ZERO WRITES. Validates one complete content release (release record, collection + membership + reward, bulk player cards with badge/trait replacements, pack with ordered pool and odds totalling 100%, multi-step evo paths with objectives, and optional teams/runs/domination/challenges/locker codes/duos/storylines/social posts). Resolves every name to an exact id and REJECTS ambiguous player/badge/trait/collection/pack/tier/team matches with all candidates listed. Returns the ordered creates, updates, replacements, deletes and links, flags destructive replacements, and returns payload_hash plus a single-use preview_token." +
    safetyNote,
  inputSchema: bundleFields,
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  handler: async (input, ctx) => runBatch(ctx, input as Record<string, unknown>, "preview", undefined, KIND),
});

const commitContentBundle = defineTool({
  name: "commit_content_bundle",
  title: "Commit: complete content release bundle",
  description:
    "Admin only. Applies a previewed and user-approved content bundle in ONE Postgres transaction — every operation succeeds or the whole release rolls back, so a release is never partially published. The payload must hash identically to the preview it came from, otherwise the commit is rejected (PREVIEW_MISMATCH / PREVIEW_ALREADY_COMMITTED / PREVIEW_EXPIRED) and nothing is written. Returns created and updated ids plus a post-commit verification summary.",
  inputSchema: {
    ...bundleFields,
    preview_token: z.string().describe("The preview_token from the matching preview. Single use."),
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  handler: async (input, ctx) => {
    const { preview_token, ...rest } = input as Record<string, unknown> & { preview_token: string };
    return runBatch(ctx, rest, "commit", preview_token, KIND);
  },
});

const setContentStatus = defineTool({
  name: "setContentStatus",
  title: "Publish / archive / restore content",
  description:
    "Admin only. Moves one content entity through its lifecycle (draft, scheduled, active, disabled, archived) with dependency validation. mode='preview' reports the intended change and any blocking dependants without writing.",
  inputSchema: {
    entity_type: z.string().describe("e.g. player_cards, packs, collections, evo_paths, release_bundles."),
    entity_id: z.string().uuid(),
    status: z.enum(["draft", "scheduled", "active", "disabled", "archived"]),
    publish_at: z.string().optional(),
    starts_at: z.string().optional(),
    ends_at: z.string().optional(),
    override: z.boolean().optional().describe("Bypass soft dependency warnings."),
    mode: z.enum(["preview", "commit"]).default("preview"),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async (input, ctx) => {
    const { client, error } = await adminClient(ctx);
    if (error) return error;
    const i = input as Record<string, any>;
    const { data, error: dbError } = await client.rpc("admin_lifecycle_apply", {
      p_entity_type: i.entity_type,
      p_entity_id: i.entity_id,
      p_status: i.status,
      p_dates: {
        publish_at: i.publish_at ?? null,
        starts_at: i.starts_at ?? null,
        ends_at: i.ends_at ?? null,
      } as never,
      p_commit: i.mode === "commit",
      p_override: !!i.override,
    });
    if (dbError) return fail(dbError.message);
    return ok(data);
  },
});

const getContentUsage = defineTool({
  name: "getContentUsage",
  title: "Where is this content used?",
  description:
    "Admin only. Read-only. Lists every reference to a content entity (packs, collections, evo paths, rosters, rewards) so you can tell what a rename, archive or delete would affect.",
  inputSchema: {
    entity_type: z.string().describe("e.g. player_cards, packs, collections, teams."),
    entity_id: z.string().uuid(),
  },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  handler: async (input, ctx) => {
    const { client, error } = await adminClient(ctx);
    if (error) return error;
    const i = input as Record<string, any>;
    const { data, error: dbError } = await client.rpc("admin_usage", {
      p_entity_type: i.entity_type,
      p_entity_id: i.entity_id,
    });
    if (dbError) return fail(dbError.message);
    return ok(data);
  },
});

const getUnusedPlayers = defineTool({
  name: "getUnusedPlayers",
  title: "Cards not used anywhere",
  description:
    "Admin only. Read-only. Lists player cards that no pack, collection, roster, evo path or reward references — useful before archiving or cleaning up a release.",
  inputSchema: { by_name: z.boolean().optional().describe("Group duplicates by display name.") },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  handler: async (input, ctx) => {
    const { client, error } = await adminClient(ctx);
    if (error) return error;
    const { data, error: dbError } = await client.rpc("admin_unused_players", {
      p_by_name: !!(input as Record<string, any>).by_name,
    });
    if (dbError) return fail(dbError.message);
    return ok(data);
  },
});

export const releaseBundleTools = [
  previewContentBundle,
  commitContentBundle,
  setContentStatus,
  getContentUsage,
  getUnusedPlayers,
];
