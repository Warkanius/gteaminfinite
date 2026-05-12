import { createClient } from "https://esm.sh/@supabase/supabase-js@2.97.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonResp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type EventType =
  | "game_result"
  | "appearance"
  | "evolution"
  | "streak"
  | "signing"
  | "record_broken";

interface EventPayload {
  event_type: EventType;
  user_id?: string;
  // Routing keys (any/all may be set)
  road_name?: string | null;
  run_id?: string | null;
  // Stat / context fields, all optional and resolved per event_type
  user_display?: string | null;
  opponent?: string | null;
  user_score?: number | null;
  cpu_score?: number | null;
  won?: boolean | null;
  top_scorer_name?: string | null;
  top_scorer_pts?: number | null;
  notable?: string[];
  player_card_id?: string | null;
  player_name?: string | null;
  gem_tier_name?: string | null;
  streak?: number | null;
  // For evolution
  from_tier?: string | null;
  to_tier?: string | null;
}

function fillTemplate(t: string, ctx: Record<string, string | number | null | undefined>) {
  return t.replace(/\{(\w+)\}/g, (_, k) => {
    const v = ctx[k];
    if (v === undefined || v === null || v === "") return "";
    return String(v);
  }).replace(/\s{2,}/g, " ").trim();
}

async function getRule(admin: ReturnType<typeof createClient>, key: string): Promise<any> {
  const { data } = await admin.from("rule_config").select("value").eq("key", key).maybeSingle();
  return data?.value ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return jsonResp({ error: "Unauthorized" }, 401);

    const token = authHeader.replace("Bearer ", "");
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

    const payload = (await req.json()) as EventPayload;
    if (!payload?.event_type) return jsonResp({ error: "event_type required" }, 400);

    // Allow trusted server-to-server calls (signings from edge functions) using service-role key.
    let userId: string;
    if (token === serviceKey) {
      if (!payload.user_id) return jsonResp({ error: "user_id required for service calls" }, 400);
      userId = payload.user_id;
    } else {
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
      if (claimsErr || !claimsData?.claims) return jsonResp({ error: "Unauthorized" }, 401);
      userId = claimsData.claims.sub as string;
    }

    // ── Load configurable rules ─────────────────────────────────
    const [
      signingMinTier,
      runsAppearanceMinTier,
      dominationAppearanceMinTier,
      notableThresholds,
      signingCooldownMin,
      appearanceCooldownHr,
      leagueAccountId,
    ] = await Promise.all([
      getRule(admin, "signing_min_gem_tier"),
      getRule(admin, "runs_appearance_min_gem_tier"),
      getRule(admin, "domination_appearance_min_gem_tier"),
      getRule(admin, "notable_performance_thresholds"),
      getRule(admin, "signing_post_cooldown_minutes"),
      getRule(admin, "appearance_cooldown_hours"),
      getRule(admin, "league_signings_account_id"),
    ]);

    // Resolve gem tier sort orders
    const { data: tiers } = await admin.from("gem_tiers").select("name, sort_order");
    const tierSort = (name: string | null | undefined): number | null => {
      if (!name) return null;
      const t = (tiers || []).find((x: any) => x.name === name);
      return t ? (t.sort_order ?? 0) : null;
    };

    // ── Resolve location account ────────────────────────────────
    const resolveAccount = async (): Promise<any | null> => {
      // Per-road first
      if (payload.road_name) {
        const { data } = await admin
          .from("location_accounts")
          .select("*")
          .eq("road_name", payload.road_name)
          .eq("is_active", true)
          .limit(1)
          .maybeSingle();
        if (data) return data;
      }
      // Per-run
      if (payload.run_id) {
        const { data } = await admin
          .from("location_accounts")
          .select("*")
          .eq("run_id", payload.run_id)
          .eq("is_active", true)
          .limit(1)
          .maybeSingle();
        if (data) return data;
      }
      // League fallback (signings + orphan events)
      if (leagueAccountId && typeof leagueAccountId === "string") {
        const { data } = await admin
          .from("location_accounts")
          .select("*")
          .eq("id", leagueAccountId)
          .eq("is_active", true)
          .maybeSingle();
        if (data) return data;
      }
      return null;
    };

    const account = await resolveAccount();
    if (!account) return jsonResp({ skipped: true, reason: "no_location_account" });

    // ── Per-event gating ────────────────────────────────────────
    const ctx: Record<string, string | number | null | undefined> = {
      user: payload.user_display ?? "A challenger",
      opponent: payload.opponent ?? "the opposition",
      score: payload.user_score != null && payload.cpu_score != null
        ? `${payload.user_score}-${payload.cpu_score}`
        : null,
      top: payload.top_scorer_name ?? null,
      topPts: payload.top_scorer_pts ?? null,
      notable: (payload.notable ?? []).join(", ") || null,
      player: payload.player_name ?? null,
      tier: payload.gem_tier_name ?? null,
      streak: payload.streak ?? null,
      venue: account.name,
      from: payload.from_tier ?? null,
      to: payload.to_tier ?? null,
    };

    let shouldPost = true;

    if (payload.event_type === "signing") {
      const min = tierSort(signingMinTier);
      const cur = tierSort(payload.gem_tier_name);
      if (min == null || cur == null || cur < min) shouldPost = false;

      // Per-user cooldown
      if (shouldPost && typeof signingCooldownMin === "number" && signingCooldownMin > 0) {
        const cutoff = new Date(Date.now() - signingCooldownMin * 60_000).toISOString();
        const { data: recent } = await admin
          .from("social_posts")
          .select("id")
          .eq("event_type", "signing")
          .eq("location_account_id", account.id)
          .gte("posted_at", cutoff)
          .limit(1);
        // Use a sentinel field to scope to user — we re-check via player+account+window.
        // We don't store user_id on social_posts; treat the cooldown as per-account window.
        if (recent && recent.length > 0) shouldPost = false;
      }
    } else if (payload.event_type === "appearance") {
      // Use domination rule when posting to a road account; runs rule when posting to a run account.
      const isDomination = !!payload.road_name;
      const tierRule = isDomination ? dominationAppearanceMinTier : runsAppearanceMinTier;
      const min = tierSort(tierRule);
      const cur = tierSort(payload.gem_tier_name);
      if (min == null || cur == null || cur < min) {
        console.warn("[post-league-event] appearance skipped: tier_below_min", { tierRule, gem: payload.gem_tier_name });
        shouldPost = false;
      }

      if (shouldPost && typeof appearanceCooldownHr === "number" && appearanceCooldownHr > 0 && payload.player_card_id) {
        const cutoff = new Date(Date.now() - appearanceCooldownHr * 3_600_000).toISOString();
        const { data: recent } = await admin
          .from("social_posts")
          .select("id")
          .eq("event_type", "appearance")
          .eq("location_account_id", account.id)
          .eq("player_card_id", payload.player_card_id)
          .gte("posted_at", cutoff)
          .limit(1);
        if (recent && recent.length > 0) shouldPost = false;
      }
    }

    // ── game_result: also update location_records and chain a record_broken post ──
    let recordBroken: { kind: string; value: number } | null = null;
    if (payload.event_type === "game_result" && payload.user_score != null && payload.cpu_score != null) {
      const won = !!payload.won;
      const score = payload.user_score;
      const margin = Math.abs(payload.user_score - payload.cpu_score);

      const { data: existing } = await admin
        .from("location_records")
        .select("*")
        .eq("user_id", userId)
        .eq("location_account_id", account.id)
        .maybeSingle();

      if (existing) {
        const newCurrentStreak = won ? (existing.current_streak || 0) + 1 : 0;
        const newLongest = Math.max(existing.longest_win_streak || 0, newCurrentStreak);
        const newHigh = Math.max(existing.high_score || 0, score);
        const newBlowout = won ? Math.max(existing.biggest_blowout || 0, margin) : (existing.biggest_blowout || 0);

        if (newHigh > (existing.high_score || 0)) recordBroken = { kind: "high_score", value: newHigh };
        else if (won && newBlowout > (existing.biggest_blowout || 0)) recordBroken = { kind: "biggest_blowout", value: newBlowout };
        else if (newLongest > (existing.longest_win_streak || 0)) recordBroken = { kind: "longest_streak", value: newLongest };

        await admin.from("location_records").update({
          games_played: (existing.games_played || 0) + 1,
          wins: (existing.wins || 0) + (won ? 1 : 0),
          losses: (existing.losses || 0) + (won ? 0 : 1),
          current_streak: newCurrentStreak,
          longest_win_streak: newLongest,
          high_score: newHigh,
          biggest_blowout: newBlowout,
          last_played_at: new Date().toISOString(),
        }).eq("id", existing.id);
      } else {
        await admin.from("location_records").insert({
          user_id: userId,
          location_account_id: account.id,
          games_played: 1,
          wins: won ? 1 : 0,
          losses: won ? 0 : 1,
          current_streak: won ? 1 : 0,
          longest_win_streak: won ? 1 : 0,
          high_score: score,
          biggest_blowout: won ? margin : 0,
          last_played_at: new Date().toISOString(),
        });
        if (won) recordBroken = { kind: "first_win", value: 1 };
      }
    }

    // ── Pick a template + insert post ──────────────────────────
    const insertPostFor = async (eventType: string, extraCtx: Record<string, any> = {}) => {
      const { data: templates } = await admin
        .from("location_post_templates")
        .select("template_text")
        .eq("personality", account.personality)
        .eq("event_type", eventType)
        .eq("is_active", true);
      if (!templates || templates.length === 0) return null;
      const tmpl = templates[Math.floor(Math.random() * templates.length)].template_text as string;
      const filled = fillTemplate(tmpl, { ...ctx, ...extraCtx });
      if (!filled) return null;

      const { data: inserted, error } = await admin.from("social_posts").insert({
        location_account_id: account.id,
        event_type: eventType,
        post_type: "tweet",
        content: filled,
        likes_count: Math.floor(Math.random() * 400) + 20,
        comments_count: Math.floor(Math.random() * 60) + 2,
        is_published: true,
        player_card_id: payload.player_card_id ?? null,
      }).select("id").single();
      if (error) {
        console.error("[post-league-event] insert failed", error);
        return null;
      }
      return inserted?.id ?? null;
    };

    // honor notable thresholds for game_result top-line
    if (payload.event_type === "game_result" && notableThresholds && typeof notableThresholds === "object") {
      // Already pre-computed by client; nothing to do server-side beyond passing through.
    }

    let mainPostId: string | null = null;
    if (shouldPost) {
      mainPostId = await insertPostFor(payload.event_type);
    }

    let recordPostId: string | null = null;
    if (recordBroken) {
      recordPostId = await insertPostFor("record_broken", { record: recordBroken.kind, value: recordBroken.value });
    }

    return jsonResp({
      posted: !!mainPostId,
      record_post: !!recordPostId,
      account_id: account.id,
    });
  } catch (e) {
    console.error("[post-league-event] exception", e);
    return jsonResp({ error: (e as Error).message }, 500);
  }
});
