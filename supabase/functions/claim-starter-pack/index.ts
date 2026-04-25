import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("[claim-starter-pack] invoked", { method: req.method });

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      console.error("[claim-starter-pack] missing/invalid Authorization header");
      return jsonResp({ error: "Unauthorized" }, 401);
    }

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      console.error("[claim-starter-pack] auth.getUser failed", authError);
      return jsonResp({ error: "Unauthorized" }, 401);
    }
    console.log("[claim-starter-pack] authenticated user", { user_id: user.id });

    let body: any = null;
    try {
      body = await req.json();
    } catch (parseErr) {
      console.error("[claim-starter-pack] invalid JSON body", parseErr);
      return jsonResp({ error: "Invalid JSON body" }, 400);
    }

    const pack_id = body?.pack_id;
    if (!pack_id) {
      console.error("[claim-starter-pack] missing pack_id", body);
      return jsonResp({ error: "pack_id required" }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Validate pack is a starter pack
    const { data: pack, error: packErr } = await admin
      .from("packs")
      .select("*")
      .eq("id", pack_id)
      .eq("pack_type", "starter")
      .single();

    if (packErr || !pack) {
      console.error("[claim-starter-pack] starter pack lookup failed", { pack_id, packErr });
      return jsonResp({ error: "Starter pack not found", detail: packErr?.message }, 404);
    }
    console.log("[claim-starter-pack] pack ok", { pack_id, name: pack.name });

    // Check user hasn't already claimed any starter pack
    const { data: starterPacks, error: starterListErr } = await admin
      .from("packs")
      .select("id")
      .eq("pack_type", "starter");

    if (starterListErr) {
      console.error("[claim-starter-pack] failed to list starter packs", starterListErr);
      return jsonResp({ error: "Failed to list starter packs", detail: starterListErr.message }, 500);
    }

    const starterIds = (starterPacks || []).map((p) => p.id);

    if (starterIds.length > 0) {
      const { count, error: countErr } = await admin
        .from("pack_purchases")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .in("pack_id", starterIds);

      if (countErr) {
        console.error("[claim-starter-pack] failed to check prior claims", countErr);
        return jsonResp({ error: "Failed to verify prior claims", detail: countErr.message }, 500);
      }

      if (count && count > 0) {
        console.log("[claim-starter-pack] user already claimed a starter pack", { user_id: user.id, count });
        return jsonResp({ error: "You have already claimed a starter pack" }, 400);
      }
    }

    // Get pack players
    const { data: packPlayers, error: ppErr } = await admin
      .from("pack_players")
      .select("player_card_id")
      .eq("pack_id", pack_id);

    if (ppErr) {
      console.error("[claim-starter-pack] failed to fetch pack players", ppErr);
      return jsonResp({ error: "Failed to fetch pack players", detail: ppErr.message }, 500);
    }

    if (!packPlayers || packPlayers.length === 0) {
      console.error("[claim-starter-pack] starter pack has no players", { pack_id });
      return jsonResp({ error: "Starter pack has no players assigned" }, 400);
    }

    const cardIds = packPlayers.map((pp) => pp.player_card_id);
    console.log("[claim-starter-pack] adding cards to collection", { count: cardIds.length });

    // Add all cards to user collection
    const collectionInserts = cardIds.map((cid) => ({
      user_id: user.id,
      player_card_id: cid,
      source: "starter_pack",
    }));

    const { data: insertedCollection, error: insertErr } = await admin
      .from("user_collections")
      .insert(collectionInserts)
      .select("id");

    if (insertErr) {
      console.error("[claim-starter-pack] user_collections insert failed", insertErr);
      return jsonResp(
        { error: "Failed to add cards to collection", detail: insertErr.message, code: insertErr.code },
        500
      );
    }

    const insertedIds = (insertedCollection || []).map((r) => r.id);
    console.log("[claim-starter-pack] inserted collection rows", { count: insertedIds.length });

    // Log purchase
    const { error: purchaseErr } = await admin.from("pack_purchases").insert({
      user_id: user.id,
      pack_id,
      cards_pulled: cardIds,
      coins_spent: 0,
      quantity: 1,
    });

    if (purchaseErr) {
      console.error("[claim-starter-pack] pack_purchases insert failed, rolling back collection", purchaseErr);
      // Roll back collection inserts so user isn't blocked from retrying
      if (insertedIds.length > 0) {
        const { error: rollbackErr } = await admin
          .from("user_collections")
          .delete()
          .in("id", insertedIds);
        if (rollbackErr) {
          console.error("[claim-starter-pack] rollback failed", rollbackErr);
        }
      }
      return jsonResp(
        { error: "Failed to log starter pack claim", detail: purchaseErr.message, code: purchaseErr.code },
        500
      );
    }

    // Fetch full card data for reveal
    const { data: cards, error: fetchErr } = await admin
      .from("player_cards")
      .select("*, gem_tiers(*)")
      .in("id", cardIds);

    if (fetchErr) {
      console.error("[claim-starter-pack] failed to fetch cards for reveal", fetchErr);
      // Claim is already complete; return success with empty cards rather than rolling back
      return jsonResp({ success: true, cards: [], warning: "Cards claimed but reveal data unavailable" });
    }

    console.log("[claim-starter-pack] success", { user_id: user.id, pack_id, cards: cards?.length ?? 0 });
    return jsonResp({ success: true, cards: cards ?? [] });
  } catch (e) {
    console.error("[claim-starter-pack] unhandled exception", e);
    return jsonResp({ error: (e as Error)?.message ?? "Unknown error" }, 500);
  }
});
