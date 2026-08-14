// GTeam Insider API — the player-facing surface used by the separate
// "GTeam Insider" Custom GPT.
//
// Auth: OAuth bearer token only. The authenticated player is resolved from the
// token; no request may name a user id. Every database call runs under that
// player's RLS session, so cross-user reads are impossible by construction and
// no admin/Commissioner mutation is reachable from this function.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

import { InsiderError, insiderErrorBody } from "../_shared/insider/errors.ts";
import { INSIDER_API_LIMITS, LINEUP_MODES, lineupModeRule, round2 } from "../_shared/insider/rules.ts";
import {
  closeToEvolving,
  compareCards,
  evoDelta,
  loadCollection,
  loadContext,
  summarizeCollection,
  type CollectionFilters,
  type OwnedCardView,
} from "../_shared/insider/cards.ts";
import { eligibleCards, evaluateLineup, resolveContext } from "../_shared/insider/legality.ts";
import {
  createLineup,
  deleteLineup,
  duplicateLineup,
  getLineup,
  listLineups,
  setDefaultLineup,
  updateLineup,
  validateLineup,
} from "../_shared/insider/lineups.ts";
import {
  challengeScout,
  dominationScout,
  evoObjectiveOverlap,
  listChallenges,
  listDomination,
  listRuns,
  playNextCandidates,
  progressionOverview,
  runScout,
} from "../_shared/insider/scout.ts";
import { buildInsiderOpenApi, INSIDER_API_VERSION, insiderCapabilities } from "../_shared/insider/openapi.ts";

type Row = Record<string, any>;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
const J = { ...corsHeaders, "Content-Type": "application/json" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body, null, 2), { status, headers: J });

function clientFor(token: string) {
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function bool(v: string | null): boolean | undefined {
  if (v === null) return undefined;
  if (/^(1|true|yes)$/i.test(v)) return true;
  if (/^(0|false|no)$/i.test(v)) return false;
  return undefined;
}
function numOrUndef(v: string | null): number | undefined {
  if (v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function filtersFromQuery(url: URL): CollectionFilters {
  const g = (k: string) => url.searchParams.get(k);
  return {
    position: g("position") ?? undefined,
    gem_tier: g("gem_tier") ?? undefined,
    gem_tier_id: g("gem_tier_id") ?? undefined,
    min_rating: numOrUndef(g("min_rating")),
    max_rating: numOrUndef(g("max_rating")),
    min_run_rating: numOrUndef(g("min_run_rating")),
    badge: g("badge") ?? undefined,
    badge_tier: g("badge_tier") ?? undefined,
    trait: g("trait") ?? undefined,
    stat_key: g("stat_key") ?? undefined,
    min_stat: numOrUndef(g("min_stat")),
    evo_active: bool(g("evo_active")),
    evo_completed: bool(g("evo_completed")),
    evo_destination_tier: g("evo_destination_tier") ?? undefined,
    collection: g("collection") ?? undefined,
    favorite: bool(g("favorite")),
    grinding: bool(g("grinding")),
    core_player: bool(g("core_player")),
    name: g("name") ?? undefined,
    limit: numOrUndef(g("limit")),
    offset: numOrUndef(g("offset")),
  };
}

/** Whole owned collection (all pages) with EVO detail. */
async function loadAllDetailed(client: any, userId: string): Promise<{ cards: OwnedCardView[]; ctx: any }> {
  const page = INSIDER_API_LIMITS.max_collection_page_size;
  const out: OwnedCardView[] = [];
  let offset = 0;
  let ctx: any = null;
  for (;;) {
    const res = await loadCollection(client, userId, { detail: true, filters: { limit: page, offset } });
    ctx = res.ctx;
    out.push(...res.cards);
    offset += page;
    if (out.length >= res.total || res.cards.length === 0) break;
  }
  return { cards: out, ctx };
}

/** Canonical EVO progress rows built from detailed card views. */
function evoRows(cards: OwnedCardView[], activeOnly: boolean): Row[] {
  const rows: Row[] = [];
  for (const c of cards) {
    const evo = c.evo as Row;
    const steps = (evo.steps ?? []) as Row[];
    if (!steps.length) continue;
    const target = activeOnly ? steps.filter((s) => !s.completed).slice(0, 1) : steps;
    for (const s of target) {
      rows.push({
        owned_card_id: c.owned_card_id,
        player_card_id: c.player_card_id,
        playable_version_id: c.playable_version_id,
        name: c.name,
        current_gem_tier: c.gem_tier,
        evo_step_id: s.evo_step_id,
        step_order: s.step_order,
        from_gem_tier: s.from_gem_tier,
        to_gem_tier: s.to_gem_tier,
        target_version_id: s.target_version_id,
        target_player_card_id: s.target_player_card_id,
        completed: s.completed,
        claimed: s.claimed,
        stage_completion_pct: s.stage_completion_pct,
        objectives_completed: s.objectives_completed,
        objectives_total: s.objectives_total,
        objectives: s.objectives,
        future_steps: steps
          .filter((x) => Number(x.step_order ?? 0) > Number(s.step_order ?? 0))
          .map((x) => ({
            evo_step_id: x.evo_step_id,
            step_order: x.step_order,
            to_gem_tier: x.to_gem_tier,
            target_version_id: x.target_version_id,
            objectives_total: x.objectives_total,
          })),
        final_version_id: evo.final_version_id,
        final_version_tier: evo.final_version_tier,
      });
    }
  }
  return rows;
}

function findCard(cards: OwnedCardView[], url: URL, body: Row = {}): OwnedCardView {
  const ownedId = url.searchParams.get("owned_card_id") ?? body.owned_card_id;
  const cardId = url.searchParams.get("player_card_id") ?? body.player_card_id;
  const found = ownedId
    ? cards.find((c) => c.owned_card_id === ownedId)
    : cardId
      ? cards.find((c) => c.player_card_id === cardId)
      : undefined;
  if (!found) {
    throw new InsiderError("CARD_NOT_OWNED", "That card is not in this player's collection.", 400, {
      owned_card_id: ownedId ?? null,
      player_card_id: cardId ?? null,
    });
  }
  return found;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const base = `https://${url.host}/functions/v1/insider`;
  const path =
    url.pathname
      .replace(/^\/functions\/v1/, "")
      .replace(/^\/insider-api/, "")
      .replace(/^\/insider/, "")
      .replace(/\/+$/, "") || "/";

  // ---- public, data-free ----
  if (path === "/" || path === "/openapi.json" || path === "/v1/openapi.json") {
    return json(buildInsiderOpenApi(base));
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (path === "/v1/health" || path === "/health") {
    let authenticated = false;
    if (token) {
      const { data } = await clientFor(token).auth.getUser(token);
      authenticated = !!data?.user;
    }
    return json({
      ok: true,
      api: "gteam-insider",
      version: INSIDER_API_VERSION,
      authenticated,
      player_access: authenticated,
      surface: "player-facing",
    });
  }

  if (!token) {
    return json({ error: { code: "AUTH_REQUIRED", message: "Sign in to GTeam Infinite to use the Insider API.", detail: null } }, 401);
  }
  const client = clientFor(token);
  const { data: userData, error: userErr } = await client.auth.getUser(token);
  if (userErr || !userData?.user) {
    return json({ error: { code: "AUTH_REQUIRED", message: "Invalid or expired session.", detail: null } }, 401);
  }
  const userId = userData.user.id;

  let body: Row = {};
  if (req.method === "POST") {
    try {
      body = (await req.json()) ?? {};
    } catch {
      body = {};
    }
  }
  // The authenticated player is always derived from the token.
  delete body.user_id;

  try {
    // ───────────── meta ─────────────
    if (path === "/v1/capabilities" && req.method === "GET") {
      return json(insiderCapabilities(base, true));
    }
    if (path === "/v1/references" && req.method === "GET") {
      const ctx = await loadContext(client);
      const { data: positions } = await client.from("player_cards").select("position1, position2").limit(1000);
      const posSet = new Set<string>();
      for (const p of (positions ?? []) as Row[]) {
        if (p.position1) posSet.add(p.position1);
        if (p.position2) posSet.add(p.position2);
      }
      return json({
        gem_tiers: ctx.gemTiers.map((t) => ({ gem_tier_id: t.id, name: t.name, abbreviation: t.abbreviation, stars: t.stars, sort_order: t.sort_order, max_badges: t.max_badges, max_traits: t.max_traits })),
        positions: Array.from(posSet).sort(),
        badges: ctx.badges.map((b) => ({ badge_id: b.id, name: b.name, abbreviation: b.abbreviation, category: b.category, effect_type: b.effect_type, affected_stat: b.affected_stat, supported_tiers: b.supported_tiers })),
        badge_tiers: ["base", "gold", "hof", "diamond", "actolytrene"],
        traits: ctx.traits.map((t) => ({ trait_id: t.id, name: t.name, abbreviation: t.abbreviation, condition_type: t.condition_type, requires_target_stat: t.requires_target_stat, supported_tiers: t.supported_tiers })),
        trait_tiers: ["base", "gold", "hof", "diamond", "actolytrene"],
        collections: ctx.collections.map((c) => ({ collection_id: c.id, name: c.name, reward_type: c.reward_type })),
        game_modes: LINEUP_MODES,
        lineup_slot_types: "No fixed positional slots: any owned card may occupy any slot unless a game's structured restrictions say otherwise.",
      });
    }

    // ───────────── collection ─────────────
    if (path === "/v1/collection" && req.method === "GET") {
      const filters = filtersFromQuery(url);
      const detail = bool(url.searchParams.get("detail")) ?? false;
      const { cards, total } = await loadCollection(client, userId, { detail, filters });
      return json({
        total,
        returned: cards.length,
        limit: filters.limit ?? INSIDER_API_LIMITS.default_collection_page_size,
        offset: filters.offset ?? 0,
        cards,
      });
    }

    if (path === "/v1/collection/summary" && req.method === "GET") {
      const { cards } = await loadAllDetailed(client, userId);
      return json({ ...summarizeCollection(cards), cards_close_to_evolving: closeToEvolving(cards) });
    }

    if (path === "/v1/card" && req.method === "GET") {
      const { cards } = await loadAllDetailed(client, userId);
      return json({ card: findCard(cards, url) });
    }

    if (path === "/v1/cards/compare" && req.method === "GET") {
      const ids = (url.searchParams.get("owned_card_ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      if (ids.length < 2) throw new InsiderError("VALIDATION_FAILED", "Provide at least two owned_card_ids.");
      if (ids.length > INSIDER_API_LIMITS.max_compare_cards) {
        throw new InsiderError("VALIDATION_FAILED", `At most ${INSIDER_API_LIMITS.max_compare_cards} cards can be compared.`);
      }
      const { cards } = await loadAllDetailed(client, userId);
      const picked = ids.map((id) => {
        const c = cards.find((x) => x.owned_card_id === id || x.player_card_id === id);
        if (!c) throw new InsiderError("CARD_NOT_OWNED", `Card ${id} is not in this player's collection.`, 400, { id });
        return c;
      });
      return json(compareCards(picked));
    }

    // ───────────── evo ─────────────
    if ((path === "/v1/evo/progress" || path === "/v1/evo/active") && req.method === "GET") {
      const { cards } = await loadAllDetailed(client, userId);
      return json({ evos: evoRows(cards, path.endsWith("/active")) });
    }

    if (path === "/v1/evo/card" && req.method === "GET") {
      const { cards } = await loadAllDetailed(client, userId);
      const card = findCard(cards, url);
      const evo = card.evo as Row;
      const versions = (evo.playable_versions ?? []) as Row[];
      const nextVersion = versions.find((v) => v.evo_card_version_id === evo.next_version_id) ?? null;
      const finalVersion = versions.find((v) => v.evo_card_version_id === evo.final_version_id) ?? null;
      return json({
        card,
        evo_steps: evo.steps ?? [],
        playable_versions: versions,
        next_version: nextVersion,
        final_version: finalVersion,
        next_version_delta: evoDelta(card as Row, nextVersion),
        final_version_delta: evoDelta(card as Row, finalVersion),
      });
    }

    if (path === "/v1/evo/overlap" && req.method === "GET") {
      const { cards } = await loadAllDetailed(client, userId);
      return json(evoObjectiveOverlap(evoRows(cards, true)));
    }

    // ───────────── lineups (player-owned writes) ─────────────
    if (path === "/v1/lineups" && req.method === "GET") {
      return json(await listLineups(client, userId, url.searchParams.get("mode") ?? undefined));
    }
    if (path === "/v1/lineups" && req.method === "POST") {
      return json(await createLineup(client, userId, body as any));
    }
    if (path === "/v1/lineups/get" && req.method === "GET") {
      const lineupId = url.searchParams.get("lineup_id");
      if (!lineupId) throw new InsiderError("VALIDATION_FAILED", "lineup_id is required.");
      return json(await getLineup(client, userId, lineupId, {
        challenge_id: url.searchParams.get("challenge_id"),
        domination_game_id: url.searchParams.get("domination_game_id"),
        run_id: url.searchParams.get("run_id"),
      }));
    }
    if (path === "/v1/lineups/update" && req.method === "POST") {
      if (!body.lineup_id) throw new InsiderError("VALIDATION_FAILED", "lineup_id is required.");
      return json(await updateLineup(client, userId, body.lineup_id, body as any));
    }
    if (path === "/v1/lineups/rename" && req.method === "POST") {
      if (!body.lineup_id || !body.name) throw new InsiderError("VALIDATION_FAILED", "lineup_id and name are required.");
      return json(await updateLineup(client, userId, body.lineup_id, { name: body.name }));
    }
    if (path === "/v1/lineups/duplicate" && req.method === "POST") {
      if (!body.lineup_id) throw new InsiderError("VALIDATION_FAILED", "lineup_id is required.");
      return json(await duplicateLineup(client, userId, body.lineup_id, body.name));
    }
    if (path === "/v1/lineups/delete" && req.method === "POST") {
      if (!body.lineup_id) throw new InsiderError("VALIDATION_FAILED", "lineup_id is required.");
      return json(await deleteLineup(client, userId, body.lineup_id));
    }
    if (path === "/v1/lineups/set-default" && req.method === "POST") {
      if (!body.lineup_id) throw new InsiderError("VALIDATION_FAILED", "lineup_id is required.");
      return json(await setDefaultLineup(client, userId, body.lineup_id));
    }
    if (path === "/v1/lineups/validate" && req.method === "POST") {
      return json(await validateLineup(client, userId, body as any));
    }

    // ───────────── eligibility ─────────────
    if (path === "/v1/eligible-cards" && req.method === "GET") {
      const ref = {
        mode: url.searchParams.get("mode"),
        challenge_id: url.searchParams.get("challenge_id"),
        domination_game_id: url.searchParams.get("domination_game_id"),
        run_id: url.searchParams.get("run_id"),
      };
      const resolved = await resolveContext(client, ref);
      const { cards, ctx } = await loadAllDetailed(client, userId);
      const { eligible, excluded } = await eligibleCards(client, cards, resolved.restrictions, ctx.gemTiers);
      const includeExcluded = bool(url.searchParams.get("include_excluded")) ?? false;
      const limit = Math.min(
        INSIDER_API_LIMITS.max_collection_page_size,
        Number(url.searchParams.get("limit") ?? INSIDER_API_LIMITS.max_collection_page_size),
      );
      const rule = lineupModeRule(resolved.mode);
      return json({
        context: resolved.context,
        restrictions: resolved.restrictions,
        slots_required: rule.slots,
        eligible_count: eligible.length,
        sufficient: eligible.length >= rule.slots,
        eligible: eligible
          .sort((a, b) => Number(b.rating ?? 0) - Number(a.rating ?? 0))
          .slice(0, limit),
        excluded: includeExcluded ? excluded : [],
      });
    }

    // ───────────── game content ─────────────
    if (path === "/v1/challenges" && req.method === "GET") return json(await listChallenges(client, userId));
    if (path === "/v1/domination" && req.method === "GET") return json(await listDomination(client, userId));
    if (path === "/v1/runs" && req.method === "GET") return json(await listRuns(client, userId));

    if (path === "/v1/scout/challenge" && req.method === "GET") {
      const id = url.searchParams.get("challenge_id");
      if (!id) throw new InsiderError("VALIDATION_FAILED", "challenge_id is required.");
      return json(await challengeScout(client, userId, id));
    }
    if (path === "/v1/scout/domination" && req.method === "GET") {
      const id = url.searchParams.get("domination_game_id");
      if (!id) throw new InsiderError("VALIDATION_FAILED", "domination_game_id is required.");
      return json(await dominationScout(client, userId, id));
    }
    if (path === "/v1/scout/run" && req.method === "GET") {
      const id = url.searchParams.get("run_id");
      if (!id) throw new InsiderError("VALIDATION_FAILED", "run_id is required.");
      return json(await runScout(client, userId, id));
    }

    if (path === "/v1/progression" && req.method === "GET") return json(await progressionOverview(client, userId));

    if (path === "/v1/play-next" && req.method === "GET") {
      const { cards } = await loadAllDetailed(client, userId);
      return json(await playNextCandidates(client, userId, evoRows(cards, true)));
    }

    // ───────────── preferences (player-owned writes) ─────────────
    if (path === "/v1/preferences" && req.method === "GET") {
      const { data, error } = await client
        .from("player_card_preferences")
        .select("id, player_card_id, favorite, grinding, core_player, do_not_recommend, evo_priority, notes, updated_at")
        .eq("user_id", userId);
      if (error) throw new InsiderError("INTERNAL_ERROR", error.message);
      return json({ preferences: data ?? [] });
    }
    if (path === "/v1/preferences" && req.method === "POST") {
      const { cards } = await loadAllDetailed(client, userId);
      const card = findCard(cards, url, body);
      const patch: Row = { user_id: userId, player_card_id: card.player_card_id };
      for (const k of ["favorite", "grinding", "core_player", "do_not_recommend"]) {
        if (body[k] !== undefined) patch[k] = !!body[k];
      }
      if (body.evo_priority !== undefined) patch.evo_priority = body.evo_priority === null ? null : Number(body.evo_priority);
      if (body.notes !== undefined) patch.notes = body.notes;
      const { data, error } = await client
        .from("player_card_preferences")
        .upsert(patch, { onConflict: "user_id,player_card_id" })
        .select("id, player_card_id, favorite, grinding, core_player, do_not_recommend, evo_priority, notes, updated_at")
        .single();
      if (error) throw new InsiderError("INTERNAL_ERROR", error.message);
      return json({ preference: data });
    }

    // ───────────── lineup summary helper ─────────────
    if (path === "/v1/lineups/analyze" && req.method === "POST") {
      const result = await validateLineup(client, userId, body as any);
      return json({ ...result, analysis_method: result.summary?.method ?? null });
    }

    return json(
      {
        error: {
          code: "NOT_FOUND",
          message: `Unknown Insider route ${req.method} ${path}. Call GET /v1/capabilities for the current operation list.`,
          detail: null,
        },
      },
      404,
    );
  } catch (e) {
    const { body: errBody, status } = insiderErrorBody(e);
    return json(errBody, status);
  }
});
