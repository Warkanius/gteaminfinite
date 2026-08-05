// REST / OpenAPI surface for ChatGPT Custom GPT Actions.
// OAuth only: every request (except the public schema/instructions) must carry a
// Supabase-issued bearer token. All database work runs under RLS as that caller;
// there is no service-role path.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { buildOpenApi, GPT_INSTRUCTIONS, READ_TABLE_LIST } from "./openapi.ts";
import { prepareRelease, type ContentReleaseInput } from "./contentRelease.ts";
import { handleAdminApi } from "../_shared/admin-api/router.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;

const J = { ...corsHeaders, "Content-Type": "application/json" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body, null, 2), { status, headers: J });
const err = (message: string, status: number) => json({ error: message }, status);

const SEARCH_COLUMN: Record<string, string> = {
  player_cards: "name", teams: "name", runs: "name", run_rank_rewards: "rank_name",
  domination_roads: "name", domination_games: "opponent_name", challenges: "name", gem_tasks: "title", gem_tiers: "name",
  dynamic_duos: "name", collections: "name", sub_collections: "name", badges: "name",
  signature_traits: "name", packs: "name", locker_codes: "code", storylines: "title",
  social_creators: "name", social_posts: "content", location_accounts: "name",
  location_post_templates: "template_text", rule_config: "key",
};

const APPLY_KIND: Record<string, string> = {
  teams: "team", runs: "run", "domination-games": "domination_game", packs: "pack",
  "locker-codes": "locker_code", challenges: "challenge", "dynamic-duos": "dynamic_duo",
};

function clientFor(token: string) {
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const base = `https://${url.host}/functions/v1/actions`;
  const path = url.pathname
    .replace(/^\/functions\/v1/, "")
    .replace(/^\/actions/, "")
    .replace(/\/+$/, "") || "/";

  // ---- public, data-free ----
  if (path === "/openapi.json" || path === "/") {
    return json(buildOpenApi(base));
  }
  if (path === "/gpt-instructions") {
    return new Response(GPT_INSTRUCTIONS, { headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" } });
  }

  // ---- everything else requires a signed-in GTeam user ----
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return err("Unauthorized: sign in to GTeam Infinite Hub.", 401);
  const token = authHeader.slice(7);
  const supabase = clientFor(token);
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user) return err("Unauthorized: invalid or expired session.", 401);

  try {
    // Canonical versioned admin API (preview -> approve -> atomic commit, bulk + scheduling).
    const v1 = await handleAdminApi(path, req, { client: supabase, adminId: userData.user.id, base });
    if (v1) return v1;

    if (path === "/diagnostics" && req.method === "GET") return json(await diagnostics(supabase));
    if (path === "/references" && req.method === "GET") return json(await references(supabase));

    if (path === "/list" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const table = String(body.table ?? "");
      if (!READ_TABLE_LIST.includes(table)) return err(`Unknown or not-exposed table "${table}".`, 400);
      let q = supabase.from(table).select(body.columns || "*").limit(Math.min(Number(body.limit) || 100, 500));
      if (body.search) {
        const col = SEARCH_COLUMN[table];
        if (!col) return err(`Table "${table}" has no searchable text column.`, 400);
        q = q.ilike(col, `%${body.search}%`);
      }
      const { data, error } = await q;
      if (error) return err(error.message, 400);
      return json({ table, count: data?.length ?? 0, rows: data ?? [] });
    }

    if (path === "/entity" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      return await entity(supabase, body);
    }

    // ------------------------------------------------------ Domination roads
    if (path === "/domination-roads" && req.method === "GET") {
      const { data: roads, error } = await supabase
        .from("domination_roads")
        .select("id,name,slug,description,sort_order,is_active")
        .order("sort_order");
      if (error) return err(error.message, 400);
      const { data: games } = await supabase.from("domination_games").select("road_id,game_order");
      return json({
        roads: (roads ?? []).map((r: any) => {
          const mine = (games ?? []).filter((g: any) => g.road_id === r.id);
          return {
            road_id: r.id, road_name: r.name, slug: r.slug, description: r.description,
            sort_order: r.sort_order, is_active: r.is_active,
            game_count: mine.length,
            game_orders: mine.map((g: any) => g.game_order).sort((a: number, b: number) => a - b),
          };
        }),
      });
    }

    if (path === "/domination-roads/export" && req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      return await rpcResult(supabase.rpc("admin_road_export", { p_ref: body }));
    }

    const roadMatch = path.match(/^\/domination-roads\/(preview|commit)$/);
    if (roadMatch && req.method === "POST") {
      const commit = roadMatch[1] === "commit";
      const { preview_token, ...payload } = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      if (commit && !preview_token) return err("preview_token is required to commit: preview the same body first.", 400);
      return await rpcResult(
        supabase.rpc("admin_road_bulk", { p_payload: payload, p_commit: commit, p_preview_token: preview_token ?? null }),
      );
    }

    const roadDelete = path.match(/^\/domination-roads\/delete\/(preview|commit)$/);
    if (roadDelete && req.method === "POST") {
      const commit = roadDelete[1] === "commit";
      const { preview_token, ...payload } = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      if (commit && !preview_token) return err("preview_token is required to commit: preview the same body first.", 400);
      return await rpcResult(
        supabase.rpc("admin_road_delete", { p_payload: payload, p_commit: commit, p_preview_token: preview_token ?? null }),
      );
    }

    // ------------------------------------------------- atomic content release
    // Collections + ordered membership + reward, bulk cards, team, pack pool/odds
    // and multi-step evo paths with materialized versions — one transaction.
    // Previews are persisted server-side and approved/committed by preview_id, so
    // the token and canonical payload never have to survive a chat turn.
    if (path === "/content-release/preview" && req.method === "POST") {
      const raw = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const r = await previewRelease(supabase, raw);
      return json(r.body, r.status);
    }



    if (path === "/content-release/preview/get" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      if (!body.preview_id) return err("preview_id is required.", 400);
      const { data, error } = await supabase.rpc("content_release_preview_get", { p_preview_id: body.preview_id });
      if (error) return rpcError(error);
      return json(slimPreview(data as Record<string, any>));
    }

    if (path === "/content-release/preview/cancel" && req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      if (!body.preview_id) return err("preview_id is required.", 400);
      const { data, error } = await supabase.rpc("content_release_preview_cancel", { p_preview_id: body.preview_id });
      if (error) return rpcError(error);
      return json(slimPreview(data as Record<string, any>));
    }

    if (
      (path === "/content-release/commit" || path === "/content-release/commit-by-preview-id") &&
      req.method === "POST"
    ) {
      const raw = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      const r = await commitStoredRelease(supabase, raw, {
        waitUntil: (p) => { try { (globalThis as any).EdgeRuntime?.waitUntil?.(p); } catch { /* noop */ } },
      });
      return json(r.body, r.status);
    }




    const m = path.match(/^\/([a-z-]+)\/(preview|commit)$/);
    if (m && req.method === "POST") {
      const [, group, mode] = m;
      const commit = mode === "commit";
      const payload = await req.json().catch(() => ({}));

      if (group === "players") return await rpcResult(supabase.rpc("admin_apply_player", { p_payload: payload, p_commit: commit }));
      if (group === "storyline-bundles") return await bundle(supabase, token, payload, commit);
      if (group === "domination-games") {
        const { road_name, ...game } = payload as Record<string, unknown>;
        if (!road_name) return err("`road_name` is required.", 400);
        if (game.game_order === undefined && !game.domination_game_id) {
          return err(
            "`game_order` (or `domination_game_id`) is required: opponents may repeat on a road, so a rematch cannot be targeted by name.",
            400,
          );
        }
        return await rpcResult(
          supabase.rpc("admin_apply_extra", {
            p_kind: "domination_road",
            p_payload: { road_name, games: [game] },
            p_commit: commit,
          }),
        );
      }
      const kind = APPLY_KIND[group];
      if (kind) return await rpcResult(supabase.rpc("admin_apply_content", { p_kind: kind, p_payload: payload, p_commit: commit }));

    }

    return err(`Unknown operation ${req.method} ${path}`, 404);
  } catch (e) {
    return err(`Request failed (nothing was written): ${(e as Error).message}`, 400);
  }
});

async function rpcResult(p: Promise<{ data: unknown; error: { message: string } | null }>) {
  const { data, error } = await p;
  if (error) {
    const msg = error.message || "";
    if (/Admin role required/i.test(msg)) return err("Admin role required for this operation.", 403);
    if (/Not authenticated/i.test(msg)) return err("Unauthorized.", 401);
    return err(`Rejected, nothing was written: ${msg}`, 400);
  }
  return json(data);
}




/** Maps admin_error / preview lifecycle codes to HTTP statuses. */
function rpcError(error: { message: string }) {
  const msg = error.message || "";
  if (/Admin role required/i.test(msg)) return err("Admin role required for this operation.", 403);
  if (/Not authenticated/i.test(msg) || /UNAUTHORIZED/.test(msg)) return err(`Unauthorized: ${msg}`, 401);
  if (/PREVIEW_NOT_FOUND/.test(msg)) return err(msg, 404);
  if (/PREVIEW_ALREADY_COMMITTED/.test(msg)) return err(msg, 409);
  if (/PAYLOAD_HASH_MISMATCH/.test(msg)) return err(msg, 409);
  if (/PREVIEW_EXPIRED|PREVIEW_CANCELLED|PREVIEW_TOKEN_INVALID/.test(msg)) return err(msg, 410);
  return err(`Rejected, nothing was written: ${msg}`, 400);
}


async function requireAdmin(supabase: ReturnType<typeof clientFor>, userId: string) {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error) return `Could not verify admin role: ${error.message}`;
  if (!data) return "Admin role required for this operation.";
  return null;
}

// ---------------------------------------------------------------- storyline bundle
async function bundle(supabase: ReturnType<typeof clientFor>, token: string, payload: any, commit: boolean) {
  const { data: u } = await supabase.auth.getUser(token);
  const denied = await requireAdmin(supabase, u!.user!.id);
  if (denied) return err(denied, denied.startsWith("Admin") ? 403 : 400);

  const players = payload.players ?? [];
  const codes = payload.locker_codes ?? [];
  const posts = payload.posts ?? [];
  const problems: string[] = [];

  if (players.length) {
    const { data } = await supabase.from("player_cards").select("name").in("name", players.map((p: any) => p.name));
    (data ?? []).forEach((r: any) => problems.push(`Player card already exists: "${r.name}"`));
  }
  if (codes.length) {
    const { data } = await supabase.from("locker_codes").select("code").in("code", codes.map((c: any) => String(c.code).toUpperCase()));
    (data ?? []).forEach((r: any) => problems.push(`Locker code already exists: "${r.code}"`));
  }
  const handles = posts.map((p: any) => p.location_handle).filter(Boolean);
  if (handles.length) {
    const { data } = await supabase.from("location_accounts").select("handle");
    const known = new Set((data ?? []).map((a: any) => String(a.handle).toLowerCase()));
    handles.forEach((h: string) => { if (!known.has(h.toLowerCase())) problems.push(`Unknown media account handle: "${h}"`); });
  }
  const newNames = new Set(players.map((p: any) => String(p.name).toLowerCase()));
  posts.forEach((p: any) => {
    if (p.player_name && !newNames.has(String(p.player_name).toLowerCase())) {
      problems.push(`Post references "${p.player_name}", which is not created in this bundle.`);
    }
  });

  const plan = {
    kind: "storyline_bundle",
    mode: commit ? "commit" : "preview",
    applied: false,
    operations: [
      { table: "storylines", action: "insert", match: payload.storyline?.title },
      { table: "player_cards", action: "insert", new_rows: players.length },
      { table: "locker_codes", action: "insert", new_rows: codes.length },
      { table: "social_posts", action: "insert", new_rows: posts.length },
    ],
    destructive_operations: [],
    warnings: problems,
  };

  if (!commit) return json(plan);
  if (problems.some((p) => p.startsWith("Player card already") || p.startsWith("Locker code already") || p.startsWith("Unknown media account"))) {
    return err(`Bundle not imported (nothing was written):\n- ${problems.join("\n- ")}`, 400);
  }

  const res = await fetch(`${SUPABASE_URL}/functions/v1/import-storyline-bundle`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, apikey: ANON_KEY },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let parsed: unknown = text;
  try { parsed = JSON.parse(text); } catch { /* raw */ }
  if (!res.ok) return err(`Storyline import failed (nothing was written): ${JSON.stringify(parsed)}`, 400);
  return json({ ...plan, applied: true, result: parsed });
}

// ---------------------------------------------------------------- entity detail
async function entity(supabase: ReturnType<typeof clientFor>, body: any) {
  const name = String(body.name ?? "").trim();
  if (!name) return err("`name` is required.", 400);
  const type = String(body.type ?? "");

  const one = async (table: string, col: string, value: string) => {
    const { data } = await supabase.from(table).select("*").ilike(col, value).limit(2);
    return data ?? [];
  };

  if (type === "player") {
    const rows = await one("player_cards", "name", name);
    if (!rows.length) return err(`No player card named "${name}".`, 404);
    if (rows.length > 1) return err(`Ambiguous player card name "${name}".`, 400);
    const card: any = rows[0];
    const [badges, traits, tier, team] = await Promise.all([
      supabase.from("player_card_badges").select("tier, badges(name, abbreviation)").eq("player_card_id", card.id),
      supabase.from("player_card_traits").select("tier, target_stat, signature_traits(name, abbreviation)").eq("player_card_id", card.id),
      card.gem_tier_id ? supabase.from("gem_tiers").select("name, stars").eq("id", card.gem_tier_id).maybeSingle() : Promise.resolve({ data: null }),
      card.team_id ? supabase.from("teams").select("name").eq("id", card.team_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    return json({ type, player: card, gem_tier: tier.data, team: team.data, badges: badges.data ?? [], traits: traits.data ?? [] });
  }

  if (type === "team") {
    const rows = await one("teams", "name", name);
    if (!rows.length) return err(`No team named "${name}".`, 404);
    const t: any = rows[0];
    const { data: roster } = await supabase.from("team_players").select("slot, player_cards(name, rating)").eq("team_id", t.id).order("slot");
    return json({ type, team: t, roster: roster ?? [] });
  }

  if (type === "run") {
    const rows = await one("runs", "name", name);
    if (!rows.length) return err(`No Run named "${name}".`, 404);
    const r: any = rows[0];
    const [roster, ranks] = await Promise.all([
      supabase.from("run_players").select("run_rating, player_cards(name)").eq("run_id", r.id),
      supabase.from("run_rank_rewards").select("*").order("sort_order"),
    ]);
    return json({ type, run: r, roster: roster.data ?? [], rank_rewards: ranks.data ?? [] });
  }

  if (type === "domination_game") {
    const road = String(body.road_name ?? "").trim();
    if (!road) return err("`road_name` is required for domination_game.", 400);
    const { data } = await supabase.from("domination_games").select("*").ilike("road_name", road).ilike("opponent_name", name).limit(2);
    if (!data?.length) return err(`No Domination game "${name}" on road "${road}".`, 404);
    const g: any = data[0];
    const { data: roster } = await supabase.from("domination_game_players").select("slot, player_cards(name, rating)").eq("domination_game_id", g.id).order("slot");
    return json({ type, domination_game: g, roster: roster ?? [] });
  }

  if (type === "pack") {
    const rows = await one("packs", "name", name);
    if (!rows.length) return err(`No pack named "${name}".`, 404);
    const p: any = rows[0];
    const [pool, odds] = await Promise.all([
      supabase.from("pack_players").select("slot_number, player_cards(name, rating)").eq("pack_id", p.id).order("slot_number"),
      supabase.from("pack_odds").select("*").or(`pack_id.eq.${p.id},and(pack_id.is.null,pack_type.eq.${p.pack_type})`),
    ]);
    return json({ type, pack: p, pool: pool.data ?? [], odds: odds.data ?? [] });
  }

  if (type === "storyline") {
    const rows = await one("storylines", "title", name);
    if (!rows.length) return err(`No storyline titled "${name}".`, 404);
    const s: any = rows[0];
    const { data: entities } = await supabase.from("storyline_entities").select("*").eq("storyline_id", s.id);
    return json({ type, storyline: s, entities: entities ?? [] });
  }

  if (type === "challenge" || type === "dynamic_duo" || type === "locker_code") {
    const table = type === "challenge" ? "challenges" : type === "dynamic_duo" ? "dynamic_duos" : "locker_codes";
    const col = type === "locker_code" ? "code" : "name";
    const rows = await one(table, col, name);
    if (!rows.length) return err(`No ${type} "${name}".`, 404);
    return json({ type, [type]: rows[0] });
  }

  return err(`Unknown entity type "${type}".`, 400);
}

// ---------------------------------------------------------------- diagnostics / references
async function diagnostics(supabase: ReturnType<typeof clientFor>) {
  const [players, teams, teamPlayers, runs, runPlayers, doms, domPlayers, packs, packPlayers, packOdds, codes, storylines, links] =
    await Promise.all([
      supabase.from("player_cards").select("id, name, rating, stat_3pt, stat_fin, stat_mid"),
      supabase.from("teams").select("id, name"),
      supabase.from("team_players").select("team_id"),
      supabase.from("runs").select("id, name"),
      supabase.from("run_players").select("run_id"),
      supabase.from("domination_games").select("id, road_name, opponent_name"),
      supabase.from("domination_game_players").select("domination_game_id"),
      supabase.from("packs").select("id, name, pack_type"),
      supabase.from("pack_players").select("pack_id, slot_number"),
      supabase.from("pack_odds").select("pack_id, pack_type, result_slot, percentage"),
      supabase.from("locker_codes").select("id, code, reward_type, reward_value"),
      supabase.from("storylines").select("id, title"),
      supabase.from("storyline_entities").select("storyline_id, entity_type, entity_id"),
    ]);

  const countBy = (rows: any[] | null, key: string) => {
    const map = new Map<string, number>();
    (rows ?? []).forEach((r) => map.set(r[key], (map.get(r[key]) ?? 0) + 1));
    return map;
  };
  const teamCounts = countBy(teamPlayers.data, "team_id");
  const runCounts = countBy(runPlayers.data, "run_id");
  const domCounts = countBy(domPlayers.data, "domination_game_id");

  const poolSlots = new Map<string, Set<number>>();
  (packPlayers.data ?? []).forEach((r: any) => {
    if (!poolSlots.has(r.pack_id)) poolSlots.set(r.pack_id, new Set());
    poolSlots.get(r.pack_id)!.add(r.slot_number);
  });
  const oddsByPack = new Map<string, any[]>();
  const oddsByType = new Map<string, any[]>();
  (packOdds.data ?? []).forEach((r: any) => {
    const bucket = r.pack_id ? oddsByPack : oddsByType;
    const key = r.pack_id ?? r.pack_type;
    if (!key) return;
    if (!bucket.has(key)) bucket.set(key, []);
    bucket.get(key)!.push(r);
  });

  const brokenPacks = (packs.data ?? []).map((p: any) => {
    const slots = poolSlots.get(p.id) ?? new Set<number>();
    const odds = oddsByPack.get(p.id) ?? oddsByType.get(p.pack_type) ?? [];
    const issues: string[] = [];
    if (slots.size === 0) issues.push("no player pool");
    if (odds.length === 0) issues.push("no odds rows");
    if (odds.length) {
      const total = odds.reduce((s: number, o: any) => s + Number(o.percentage ?? 0), 0);
      if (Math.abs(total - 100) > 0.01) issues.push(`odds total ${total} instead of 100`);
      odds.forEach((o: any) => {
        const slot = String(o.result_slot ?? "");
        if (slot !== "player_choice" && /^[0-9]+$/.test(slot) && slots.size && !slots.has(Number(slot))) issues.push(`odds slot ${slot} has no cards`);
        if (slot !== "player_choice" && !/^[0-9]+$/.test(slot)) issues.push(`invalid result_slot "${slot}"`);
      });
    }
    return { name: p.name, issues };
  }).filter((p) => p.issues.length);

  const malformedCodes = (codes.data ?? []).map((c: any) => {
    const v = c.reward_value ?? {};
    const issues: string[] = [];
    if (!["coins", "gems", "pack", "card"].includes(c.reward_type)) issues.push(`unknown reward_type "${c.reward_type}"`);
    if (["coins", "gems"].includes(c.reward_type) && !(Number(v.amount) > 0)) issues.push("missing reward_value.amount");
    if (c.reward_type === "pack" && !v.pack_id) issues.push("missing reward_value.pack_id");
    if (c.reward_type === "card" && !v.player_card_id) issues.push("missing reward_value.player_card_id");
    return { code: c.code, issues };
  }).filter((c) => c.issues.length);

  const known: Record<string, Set<string>> = {
    player: new Set((players.data ?? []).map((p: any) => p.id)),
    locker_code: new Set((codes.data ?? []).map((c: any) => c.id)),
  };
  const storyNames = new Map((storylines.data ?? []).map((s: any) => [s.id, s.title]));
  const brokenLinks: any[] = [];
  (links.data ?? []).forEach((l: any) => {
    const set = known[l.entity_type];
    if (set && !set.has(l.entity_id)) brokenLinks.push({ storyline: storyNames.get(l.storyline_id) ?? l.storyline_id, entity_type: l.entity_type, entity_id: l.entity_id });
  });

  const payload = {
    unrated_players: (players.data ?? []).filter((p: any) => !p.rating && !p.stat_3pt && !p.stat_fin && !p.stat_mid).map((p: any) => p.name),
    incomplete_team_rosters: (teams.data ?? []).map((t: any) => ({ name: t.name, cards: teamCounts.get(t.id) ?? 0 })).filter((t) => t.cards < 3),
    incomplete_runs: (runs.data ?? []).map((r: any) => ({ name: r.name, opponents: runCounts.get(r.id) ?? 0 })).filter((r) => r.opponents < 3),
    incomplete_domination_paths: (doms.data ?? []).map((d: any) => ({ road: d.road_name, opponent: d.opponent_name, cards: domCounts.get(d.id) ?? 0 })).filter((d) => d.cards < 3),
    broken_packs: brokenPacks,
    malformed_locker_codes: malformedCodes,
    broken_storyline_links: brokenLinks,
  };
  return {
    ...payload,
    summary: Object.fromEntries(Object.entries(payload).map(([k, v]) => [k, (v as any[]).length])),
  };
}

async function references(supabase: ReturnType<typeof clientFor>) {
  const [tiers, teams, packs, collections, subs, badges, traits, accounts, storylines, challenges, runs, doms, rules, players] =
    await Promise.all([
      supabase.from("gem_tiers").select("name, stars, gem_value, sort_order").order("sort_order"),
      supabase.from("teams").select("name, category, unlock_cost").order("name"),
      supabase.from("packs").select("name, pack_type, cost, ten_box_cost").order("name"),
      supabase.from("collections").select("name, reward_type").order("name"),
      supabase.from("sub_collections").select("name, collection_id").order("name"),
      supabase.from("badges").select("name, abbreviation, effect_type").order("name"),
      supabase.from("signature_traits").select("name, abbreviation, condition_type").order("name"),
      supabase.from("location_accounts").select("name, handle, personality, location_type, is_active").order("name"),
      supabase.from("storylines").select("title, status").order("title"),
      supabase.from("challenges").select("name, challenge_type").order("name"),
      supabase.from("runs").select("name, target_score").order("name"),
      supabase.from("domination_games").select("road_name, opponent_name, game_order").order("road_name"),
      supabase.from("rule_config").select("key, description").order("key"),
      supabase.from("player_cards").select("name, rating, gem_name").order("name").limit(2000),
    ]);
  return {
    gem_tiers: tiers.data ?? [], teams: teams.data ?? [], packs: packs.data ?? [],
    collections: collections.data ?? [], sub_collections: subs.data ?? [], badges: badges.data ?? [],
    signature_traits: traits.data ?? [], media_accounts: accounts.data ?? [], storylines: storylines.data ?? [],
    challenges: challenges.data ?? [], runs: runs.data ?? [], domination_games: doms.data ?? [],
    rule_config_keys: rules.data ?? [], player_cards: players.data ?? [],
    badge_and_trait_tiers: ["base", "gold", "hof", "diamond", "actolytrene"],
  };
}
