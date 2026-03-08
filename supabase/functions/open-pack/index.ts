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
    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResp({ error: "Unauthorized" }, 401);
    }

    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) {
      return jsonResp({ error: "Unauthorized" }, 401);
    }
    const userId = claimsData.claims.sub as string;

    // Service client for writes
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { pack_id, quantity = 1 } = await req.json();
    if (!pack_id || ![1, 10].includes(quantity)) {
      return jsonResp({ error: "Invalid pack_id or quantity" }, 400);
    }

    // Fetch pack
    const { data: pack, error: packErr } = await admin
      .from("packs")
      .select("*")
      .eq("id", pack_id)
      .single();
    if (packErr || !pack) return jsonResp({ error: "Pack not found" }, 404);

    const totalCost = quantity === 10 && pack.ten_box_cost
      ? pack.ten_box_cost
      : pack.cost * quantity;

    // Fetch user profile + check coins
    const { data: profile, error: profErr } = await admin
      .from("profiles")
      .select("id, coins")
      .eq("user_id", userId)
      .single();
    if (profErr || !profile) return jsonResp({ error: "Profile not found" }, 404);
    if (profile.coins < totalCost) {
      return jsonResp({ error: "Not enough coins", required: totalCost, current: profile.coins }, 400);
    }

    // Fetch odds for this pack type
    const { data: odds } = await admin
      .from("pack_odds")
      .select("*")
      .eq("pack_type", pack.pack_type);
    if (!odds || odds.length === 0) {
      return jsonResp({ error: "No odds configured for this pack type" }, 500);
    }

    // Parse dice ranges: "1-3" → {min:1, max:3}
    const parsedOdds = odds.map((o: any) => {
      const [min, max] = o.dice_roll.split("-").map(Number);
      return { ...o, min, max: max ?? min };
    });

    // Fetch all pack_players grouped by slot
    const { data: allPackPlayers } = await admin
      .from("pack_players")
      .select("slot_number, player_card_id")
      .eq("pack_id", pack_id);

    const slotMap: Record<string, string[]> = {};
    for (const pp of allPackPlayers || []) {
      const key = String(pp.slot_number);
      if (!slotMap[key]) slotMap[key] = [];
      slotMap[key].push(pp.player_card_id);
    }

    // Roll for each pack in quantity
    const pulledCardIds: string[] = [];

    for (let i = 0; i < quantity; i++) {
      // Roll a d20 (1-20)
      const roll = Math.floor(Math.random() * 20) + 1;
      // Find matching odds row
      const matched = parsedOdds.find((o: any) => roll >= o.min && roll <= o.max);
      if (!matched) continue;

      const slot = matched.result_slot;
      // Get cards in that slot
      const candidates = slotMap[slot];
      if (!candidates || candidates.length === 0) {
        // Fallback: pick from slot 1
        const fallback = slotMap["1"];
        if (fallback && fallback.length > 0) {
          pulledCardIds.push(fallback[Math.floor(Math.random() * fallback.length)]);
        }
        continue;
      }
      pulledCardIds.push(candidates[Math.floor(Math.random() * candidates.length)]);
    }

    if (pulledCardIds.length === 0) {
      return jsonResp({ error: "Failed to pull any cards" }, 500);
    }

    // Deduct coins
    await admin
      .from("profiles")
      .update({ coins: profile.coins - totalCost })
      .eq("id", profile.id);

    // Insert into user_collections
    const collectionRows = pulledCardIds.map((cardId) => ({
      user_id: userId,
      player_card_id: cardId,
    }));
    await admin.from("user_collections").insert(collectionRows);

    // Log purchase
    await admin.from("pack_purchases").insert({
      user_id: userId,
      pack_id,
      quantity,
      coins_spent: totalCost,
      cards_pulled: pulledCardIds,
    });

    // Fetch full card data for response
    const { data: cards } = await admin
      .from("player_cards")
      .select("*, gem_tiers(*)")
      .in("id", pulledCardIds);

    return jsonResp({
      cards: cards || [],
      coins_remaining: profile.coins - totalCost,
      coins_spent: totalCost,
    });
  } catch (e) {
    return jsonResp({ error: (e as Error).message }, 500);
  }
});
