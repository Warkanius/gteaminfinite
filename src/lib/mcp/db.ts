import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ToolContext } from "@lovable.dev/mcp-js";

/**
 * Content tables the MCP server may READ.
 * Never include per-user / economy tables (profiles, user_collections, currencies,
 * reward claims, redemptions, game logs, push subscriptions, auth tables).
 */
export const READ_TABLES = [
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
  "sub_collections",
  "badges",
  "signature_traits",
  "player_card_badges",
  "player_card_traits",
  "packs",
  "pack_odds",
  "pack_players",
  "locker_codes",
  "evo_paths",
  "storylines",
  "storyline_entities",
  "social_creators",
  "social_posts",
  "location_accounts",
  "location_post_templates",
  "rule_config",
] as const;

/**
 * Tables the generic create/update/delete tools may write.
 * Deliberately narrower than READ_TABLES: everything covered by a dedicated
 * upsert_* tool (teams, runs, dominations, packs, locker codes, challenges, duos
 * and their join tables) is excluded so composite writes stay atomic.
 */
export const WRITE_TABLES = [
  "player_cards",
  "gem_tiers",
  "gem_tasks",
  "gem_market_listings",
  "collections",
  "sub_collections",
  "badges",
  "signature_traits",
  "player_card_badges",
  "player_card_traits",
  "evo_paths",
  "storylines",
  "storyline_entities",
  "social_creators",
  "social_posts",
  "location_accounts",
  "location_post_templates",
  "rule_config",
] as const;

export type ReadTable = (typeof READ_TABLES)[number];
export type WriteTable = (typeof WRITE_TABLES)[number];

/** Text column used for `search` on each readable table. */
export const SEARCH_COLUMN: Partial<Record<ReadTable, string>> = {
  player_cards: "name",
  teams: "name",
  runs: "name",
  run_rank_rewards: "rank_name",
  domination_games: "opponent_name",
  challenges: "name",
  gem_tasks: "title",
  gem_tiers: "name",
  dynamic_duos: "name",
  collections: "name",
  sub_collections: "name",
  badges: "name",
  signature_traits: "name",
  packs: "name",
  locker_codes: "code",
  storylines: "title",
  social_creators: "name",
  social_posts: "content",
  location_accounts: "name",
  location_post_templates: "template_text",
  rule_config: "key",
};

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

/** Drop undefined values so the SQL engine can tell "absent" from "set to null". */
export function clean<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out;
}

/**
 * Runs the atomic admin content engine (`public.admin_apply_content`).
 * Preview validates and returns the exact plan; commit applies the same plan.
 * All multi-table work happens inside one database transaction.
 */
export async function applyContent(
  ctx: ToolContext,
  kind: string,
  payload: Record<string, unknown>,
  mode: "preview" | "commit",
) {
  const { client, error } = await adminClient(ctx);
  if (error) return error;
  const { data, error: dbError } = await client.rpc("admin_apply_content", {
    p_kind: kind,
    p_payload: clean(payload),
    p_commit: mode === "commit",
  });
  if (dbError) return fail(`${mode === "commit" ? "Commit" : "Preview"} failed (nothing was written): ${dbError.message}`);
  return ok(data);
}

/** Calls one of the app's own edge functions as the signed-in MCP caller. */
export async function callFunction(ctx: ToolContext, name: string, body: unknown) {
  const res = await fetch(`${process.env.SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ctx.getToken()}`,
      apikey: process.env.SUPABASE_PUBLISHABLE_KEY ?? "",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep raw text */
  }
  return { status: res.status, okStatus: res.ok, body: parsed };
}
