import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { ok, fail, adminClient, callFunction } from "../db";

export default defineTool({
  name: "import_storyline_bundle",
  title: "Import a storyline bundle",
  description:
    "Admin only. Creates a storyline plus its linked new players, locker codes and social posts in one atomic request, reusing the app's existing storyline-bundle importer. mode='preview' validates the bundle (duplicate player names, duplicate codes, unknown media handles) and reports what would be created without writing.",
  inputSchema: {
    mode: z
      .enum(["preview", "commit"])
      .default("preview")
      .describe("`preview` validates only. `commit` creates the storyline and its entities atomically."),
    storyline: z
      .object({
        title: z.string().min(1),
        summary: z.string().optional(),
        arc_image_url: z.string().optional(),
        status: z.string().optional().describe("draft / active / archived."),
        starts_at: z.string().optional(),
        ends_at: z.string().optional(),
      })
      .describe("The storyline arc itself."),
    players: z
      .array(
        z.object({
          name: z.string().min(1),
          position1: z.string().optional(),
          position2: z.string().optional(),
          stars: z.number().min(1).max(5).optional().describe("Star tier; converted to a rating by the importer."),
          social_handle: z.string().optional(),
          stat_3pt: z.number().optional(),
          stat_mid: z.number().optional(),
          stat_fin: z.number().optional(),
          stat_dnk: z.number().optional(),
          stat_ast: z.number().optional(),
          stat_stl: z.number().optional(),
          stat_reb: z.number().optional(),
          stat_blk: z.number().optional(),
          stat_int: z.number().optional(),
        }),
      )
      .optional()
      .describe("New player cards created and linked to the storyline."),
    locker_codes: z
      .array(
        z.object({
          code: z.string().min(1),
          reward_type: z.string().optional(),
          reward_value: z.record(z.string(), z.any()).optional(),
          max_redemptions: z.number().int().nullable().optional(),
          expires_at: z.string().nullable().optional(),
        }),
      )
      .optional(),
    posts: z
      .array(
        z.object({
          content: z.string().min(1),
          post_type: z.string().optional(),
          event_type: z.string().optional(),
          location_handle: z.string().optional().describe("Handle of an existing media (location) account."),
          player_name: z.string().optional().describe("Name of a player created in this same bundle."),
          image_url: z.string().optional(),
          scheduled_at: z.string().optional(),
          is_headline: z.boolean().optional(),
          headline_rank: z.number().int().optional(),
          headline_image_url: z.string().optional(),
        }),
      )
      .optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ mode, ...bundle }, ctx) => {
    const { client, error } = await adminClient(ctx);
    if (error) return error;

    const players = bundle.players ?? [];
    const codes = bundle.locker_codes ?? [];
    const posts = bundle.posts ?? [];
    const problems: string[] = [];

    if (players.length) {
      const names = players.map((p) => p.name);
      const { data: existing } = await client.from("player_cards").select("name").in("name", names);
      (existing ?? []).forEach((r: { name: string }) => problems.push(`Player card already exists: "${r.name}"`));
    }
    if (codes.length) {
      const upper = codes.map((c) => c.code.toUpperCase());
      const { data: existing } = await client.from("locker_codes").select("code").in("code", upper);
      (existing ?? []).forEach((r: { code: string }) => problems.push(`Locker code already exists: "${r.code}"`));
    }
    const handles = posts.map((p) => p.location_handle).filter(Boolean) as string[];
    if (handles.length) {
      const { data: accounts } = await client.from("location_accounts").select("handle");
      const known = new Set((accounts ?? []).map((a: { handle: string }) => a.handle.toLowerCase()));
      handles.forEach((h) => {
        if (!known.has(h.toLowerCase())) problems.push(`Unknown media account handle: "${h}"`);
      });
    }
    const newPlayerNames = new Set(players.map((p) => p.name.toLowerCase()));
    posts.forEach((p) => {
      if (p.player_name && !newPlayerNames.has(p.player_name.toLowerCase())) {
        problems.push(`Post references "${p.player_name}", which is not created in this bundle (it will be linked to no card).`);
      }
    });

    const plan = {
      storyline: bundle.storyline.title,
      would_create: { players: players.length, locker_codes: codes.length, posts: posts.length },
      warnings: problems,
    };

    if (mode === "preview") return ok({ mode: "preview", applied: false, ...plan });
    if (problems.some((p) => p.startsWith("Player card already exists") || p.startsWith("Locker code already exists") || p.startsWith("Unknown media account"))) {
      return fail(`Bundle not imported. Fix these first:\n- ${problems.join("\n- ")}`);
    }

    const res = await callFunction(ctx, "import-storyline-bundle", bundle);
    if (!res.okStatus) return fail(`Storyline import failed (nothing was written): ${JSON.stringify(res.body)}`);
    return ok({ mode: "commit", applied: true, ...plan, result: res.body });
  },
});
