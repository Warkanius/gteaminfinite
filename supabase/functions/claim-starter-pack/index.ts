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
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResp({ error: "Unauthorized" }, 401);
    }

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return jsonResp({ error: "Unauthorized" }, 401);

    const { pack_id } = await req.json();
    if (!pack_id) return jsonResp({ error: "pack_id required" }, 400);

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

    if (packErr || !pack) return jsonResp({ error: "Starter pack not found" }, 404);

    // Check user hasn't already claimed any starter pack
    const { data: starterPacks } = await admin
      .from("packs")
      .select("id")
      .eq("pack_type", "starter");

    const starterIds = (starterPacks || []).map((p) => p.id);

    if (starterIds.length > 0) {
      const { count } = await admin
        .from("pack_purchases")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .in("pack_id", starterIds);

      if (count && count > 0) {
        return jsonResp({ error: "You have already claimed a starter pack" }, 400);
      }
    }

    // Get pack players
    const { data: packPlayers } = await admin
      .from("pack_players")
      .select("player_card_id")
      .eq("pack_id", pack_id);

    if (!packPlayers || packPlayers.length === 0) {
      return jsonResp({ error: "Starter pack has no players assigned" }, 400);
    }

    const cardIds = packPlayers.map((pp) => pp.player_card_id);

    // Add all cards to user collection
    const collectionInserts = cardIds.map((cid) => ({
      user_id: user.id,
      player_card_id: cid,
    }));

    const { error: insertErr } = await admin
      .from("user_collections")
      .insert(collectionInserts);

    if (insertErr) return jsonResp({ error: "Failed to add cards to collection" }, 500);

    // Log purchase
    await admin.from("pack_purchases").insert({
      user_id: user.id,
      pack_id,
      cards_pulled: cardIds,
      coins_spent: 0,
      quantity: 1,
    });

    // Fetch full card data for reveal
    const { data: cards } = await admin
      .from("player_cards")
      .select("*, gem_tiers(*)")
      .in("id", cardIds);

    return jsonResp({ cards: cards || [] });
  } catch (e) {
    return jsonResp({ error: e.message }, 500);
  }
});
