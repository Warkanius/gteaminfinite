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

// Maps text result_slot to a rank index (0-based)
const SLOT_RANK_MAP: Record<string, number> = {
  "Top Rated Player": 0,
  "2nd Rated Player": 1,
  "3rd Rated Player": 2,
  "4th Rated Player": 3,
  "5th Rated Player": 4,
  "Player of Choice": -1, // special: random from top 10
};

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

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) {
      return jsonResp({ error: "Unauthorized" }, 401);
    }
    const userId = claimsData.claims.sub as string;

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

    // Fetch user profile
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

    // Parse dice values — supports single "5" or range "1-3"
    const parsedOdds = odds.map((o: any) => {
      const parts = o.dice_roll.split("-").map(Number);
      return { ...o, min: parts[0], max: parts.length > 1 ? parts[1] : parts[0] };
    });

    // Determine dice range from odds
    const minDice = Math.min(...parsedOdds.map((o: any) => o.min));
    const maxDice = Math.max(...parsedOdds.map((o: any) => o.max));

    // Check if we have pack_players for numeric slot resolution
    const { data: allPackPlayers } = await admin
      .from("pack_players")
      .select("slot_number, player_card_id")
      .eq("pack_id", pack_id);

    const hasPackPlayers = allPackPlayers && allPackPlayers.length > 0;

    // Build numeric slot map if applicable
    const slotMap: Record<string, string[]> = {};
    if (hasPackPlayers) {
      for (const pp of allPackPlayers!) {
        const key = String(pp.slot_number);
        if (!slotMap[key]) slotMap[key] = [];
        slotMap[key].push(pp.player_card_id);
      }
    }

    // For text-based slots, fetch player cards sorted by rating desc
    let rankedCards: any[] = [];
    if (!hasPackPlayers) {
      const { data: cards } = await admin
        .from("player_cards")
        .select("id, name, rating")
        .order("rating", { ascending: false })
        .limit(100);
      rankedCards = cards || [];
    }

    // Roll for each pack in quantity
    const pulledCardIds: string[] = [];

    for (let i = 0; i < quantity; i++) {
      const roll = Math.floor(Math.random() * maxDice) + 1;
      const matched = parsedOdds.find((o: any) => roll >= o.min && roll <= o.max);
      if (!matched) continue;

      const slot = matched.result_slot;

      if (hasPackPlayers) {
        // Numeric slot resolution
        const candidates = slotMap[slot] || slotMap["1"] || [];
        if (candidates.length > 0) {
          pulledCardIds.push(candidates[Math.floor(Math.random() * candidates.length)]);
        }
      } else {
        // Text-based slot resolution using rating rank
        const rankIndex = SLOT_RANK_MAP[slot];
        if (rankIndex === undefined) continue;

        if (rankIndex === -1) {
          // "Player of Choice" — random from top 10
          const top = rankedCards.slice(0, Math.min(10, rankedCards.length));
          if (top.length > 0) {
            pulledCardIds.push(top[Math.floor(Math.random() * top.length)].id);
          }
        } else if (rankIndex < rankedCards.length) {
          pulledCardIds.push(rankedCards[rankIndex].id);
        } else if (rankedCards.length > 0) {
          // Fallback to random card
          pulledCardIds.push(rankedCards[Math.floor(Math.random() * rankedCards.length)].id);
        }
      }
    }

    if (pulledCardIds.length === 0) {
      return jsonResp({ error: "Failed to pull any cards. Check pack_players or player_cards data." }, 500);
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
