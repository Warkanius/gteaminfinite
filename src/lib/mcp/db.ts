import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ToolContext } from "@lovable.dev/mcp-js";

/** Tables the MCP server is allowed to read/write. */
export const ALLOWED_TABLES = [
  "player_cards",
  "teams",
  "team_players",
  "runs",
  "run_players",
  "run_rank_rewards",
  "domination_games",
  "domination_game_players",
  "challenges",
  "gem_tasks",
  "gem_tiers",
  "gem_market_listings",
  "dynamic_duos",
  "collections",
  "badges",
  "locker_codes",
  "evo_paths",
  "location_accounts",
  "location_post_templates",
] as const;

export type AllowedTable = (typeof ALLOWED_TABLES)[number];

/** Supabase client acting as the signed-in MCP caller (RLS applies). */
export function db(ctx: ToolContext): SupabaseClient {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function ok(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload as Record<string, unknown>,
  };
}

export function fail(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

/** Returns a client if the caller is a signed-in admin, otherwise an error result. */
export async function adminClient(ctx: ToolContext) {
  if (!ctx.isAuthenticated()) return { error: fail("Not authenticated. Sign in to this app first.") };
  const client = db(ctx);
  const { data, error } = await client.rpc("has_role", { _user_id: ctx.getUserId(), _role: "admin" });
  if (error) return { error: fail(`Could not verify admin role: ${error.message}`) };
  if (!data) return { error: fail("Admin role required for this tool.") };
  return { client };
}

/** Read-only access still requires a signed-in user (RLS decides visibility). */
export async function userClient(ctx: ToolContext) {
  if (!ctx.isAuthenticated()) return { error: fail("Not authenticated. Sign in to this app first.") };
  return { client: db(ctx) };
}
