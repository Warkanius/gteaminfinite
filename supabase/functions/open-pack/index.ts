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

function pickSlotByPercentage(odds: any[]): string | null {
  const hasPercentages = odds.some((o) => (o.percentage ?? 0) > 0);

  if (hasPercentages) {
    const total = odds.reduce((s: number, o: any) => s + (o.percentage ?? 0), 0);
    if (total <= 0) return null;
    const rand = Math.random() * total;
    let cumulative = 0;
    for (const o of odds) {
      cumulative += o.percentage ?? 0;
      if (rand < cumulative) return o.result_slot;
    }
    return odds[odds.length - 1].result_slot;
  }

  // Legacy dice-roll fallback
  const parsed = odds.map((o: any) => {
    const parts = o.dice_roll.split("-").map(Number);
    return { ...o, min: parts[0], max: parts.length > 1 ? parts[1] : parts[0] };
  });
  const minDice = Math.min(...parsed.map((o: any) => o.min));
  const maxDice = Math.max(...parsed.map((o: any) => o.max));
  const roll = Math.floor(Math.random() * (maxDice - minDice + 1)) + minDice;
  const matched = parsed.find((o: any) => roll >= o.min && roll <= o.max);
  return matched?.result_slot ?? null;
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

    const body = await req.json();
    const { inventory_id, confirm_choice_card_id } = body;
    let { pack_id } = body;
    let isFreeOpen = false;

    // If confirming a player's choice selection
    if (confirm_choice_card_id && pack_id) {
      // Validate the card is in the pack's player pool
      const { data: packPlayers } = await admin
        .from("pack_players")
        .select("player_card_id")
        .eq("pack_id", pack_id);

      const validIds = (packPlayers || []).map((p: any) => p.player_card_id);
      if (!validIds.includes(confirm_choice_card_id)) {
        return jsonResp({ error: "Invalid card selection" }, 400);
      }

      // Insert into user_collections
      await admin.from("user_collections").insert({
        user_id: userId,
        player_card_id: confirm_choice_card_id,
        source: isFreeOpen ? "locker_code" : "standard_pack",
      });

      // Fetch card data
      const { data: cards } = await admin
        .from("player_cards")
        .select("*, gem_tiers(*)")
        .in("id", [confirm_choice_card_id]);

      return jsonResp({ cards: cards || [], player_choice_confirmed: true });
    }

    // If opening from inventory, resolve pack_id and skip coins
    if (inventory_id) {
      const { data: inv, error: invErr } = await admin
        .from("user_pack_inventory")
        .select("*")
        .eq("id", inventory_id)
        .eq("user_id", userId)
        .single();
      if (invErr || !inv) return jsonResp({ error: "Inventory item not found" }, 404);
      pack_id = inv.pack_id;
      isFreeOpen = true;
    }

    if (!pack_id) {
      return jsonResp({ error: "pack_id or inventory_id required" }, 400);
    }

    // Fetch pack
    const { data: pack, error: packErr } = await admin
      .from("packs")
      .select("*")
      .eq("id", pack_id)
      .single();
    if (packErr || !pack) return jsonResp({ error: "Pack not found" }, 404);

    const totalCost = isFreeOpen ? 0 : pack.cost;

    // Fetch user profile
    const { data: profile, error: profErr } = await admin
      .from("profiles")
      .select("id, coins")
      .eq("user_id", userId)
      .single();
    if (profErr || !profile) return jsonResp({ error: "Profile not found" }, 404);

    if (!isFreeOpen && profile.coins < totalCost) {
      return jsonResp({ error: "Not enough coins", required: totalCost, current: profile.coins }, 400);
    }

    // Fetch odds
    let odds: any[] = [];
    const { data: packSpecificOdds } = await admin
      .from("pack_odds")
      .select("*")
      .eq("pack_id", pack_id);
    
    if (packSpecificOdds && packSpecificOdds.length > 0) {
      odds = packSpecificOdds;
    } else {
      const { data: typeOdds } = await admin
        .from("pack_odds")
        .select("*")
        .eq("pack_type", pack.pack_type)
        .is("pack_id", null);
      odds = typeOdds || [];
    }

    // Fetch pack_players
    const { data: allPackPlayers } = await admin
      .from("pack_players")
      .select("slot_number, player_card_id")
      .eq("pack_id", pack_id);

    const hasPackPlayers = allPackPlayers && allPackPlayers.length > 0;
    const hasOdds = odds.length > 0;

    let pulledCardId: string | null = null;
    let isPlayerChoice = false;
    let eligibleCards: any[] = [];

    if (hasOdds && hasPackPlayers) {
      const slotMap: Record<string, string[]> = {};
      for (const pp of allPackPlayers!) {
        const key = String(pp.slot_number);
        if (!slotMap[key]) slotMap[key] = [];
        slotMap[key].push(pp.player_card_id);
      }

      const slot = pickSlotByPercentage(odds);

      // Handle player_choice slot
      if (slot === "player_choice") {
        isPlayerChoice = true;
        // Deduct coins first
        if (!isFreeOpen) {
          await admin
            .from("profiles")
            .update({ coins: profile.coins - totalCost })
            .eq("id", profile.id);
        }
        if (isFreeOpen && inventory_id) {
          await admin.from("user_pack_inventory").delete().eq("id", inventory_id);
        }

        // Return eligible cards for user to pick from
        const cardIds = allPackPlayers!.map(p => p.player_card_id);
        const { data: cards } = await admin
          .from("player_cards")
          .select("*, gem_tiers(*)")
          .in("id", cardIds);

        return jsonResp({
          player_choice: true,
          eligible_cards: cards || [],
          pack_id,
          coins_remaining: isFreeOpen ? profile.coins : profile.coins - totalCost,
          coins_spent: totalCost,
        });
      }

      if (slot) {
        const candidates = slotMap[slot] || slotMap["1"] || [];
        if (candidates.length > 0) {
          pulledCardId = candidates[Math.floor(Math.random() * candidates.length)];
        }
      }
    } else if (hasPackPlayers) {
      const idx = Math.floor(Math.random() * allPackPlayers!.length);
      pulledCardId = allPackPlayers![idx].player_card_id;
    } else if (hasOdds) {
      const { data: rankedCards } = await admin
        .from("player_cards")
        .select("id, name, rating")
        .order("rating", { ascending: false })
        .limit(100);

      const slot = pickSlotByPercentage(odds);
      if (slot && rankedCards && rankedCards.length > 0) {
        const SLOT_RANK_MAP: Record<string, number> = {
          "Top Rated Player": 0,
          "2nd Rated Player": 1,
          "3rd Rated Player": 2,
          "4th Rated Player": 3,
          "5th Rated Player": 4,
          "Player of Choice": -1,
        };
        const rankIndex = SLOT_RANK_MAP[slot];
        if (rankIndex === -1) {
          const top = rankedCards.slice(0, Math.min(10, rankedCards.length));
          pulledCardId = top[Math.floor(Math.random() * top.length)].id;
        } else if (rankIndex !== undefined && rankIndex < rankedCards.length) {
          pulledCardId = rankedCards[rankIndex].id;
        } else {
          pulledCardId = rankedCards[Math.floor(Math.random() * rankedCards.length)].id;
        }
      }
    }

    if (!pulledCardId) {
      return jsonResp({ error: "Failed to pull a card. Check pack_players or player_cards data." }, 500);
    }

    // Deduct coins (if not free)
    if (!isFreeOpen) {
      await admin
        .from("profiles")
        .update({ coins: profile.coins - totalCost })
        .eq("id", profile.id);
    }

    // Insert into user_collections
    await admin.from("user_collections").insert({
      user_id: userId,
      player_card_id: pulledCardId,
      source: isFreeOpen ? "locker_code" : "standard_pack",
    });

    // Log purchase
    await admin.from("pack_purchases").insert({
      user_id: userId,
      pack_id,
      quantity: 1,
      coins_spent: totalCost,
      cards_pulled: [pulledCardId],
    });

    // Delete inventory item if this was a free open
    if (isFreeOpen && inventory_id) {
      await admin.from("user_pack_inventory").delete().eq("id", inventory_id);
    }

    // Fetch full card data for response
    const { data: cards } = await admin
      .from("player_cards")
      .select("*, gem_tiers(*)")
      .in("id", [pulledCardId]);

    return jsonResp({
      cards: cards || [],
      coins_remaining: isFreeOpen ? profile.coins : profile.coins - totalCost,
      coins_spent: totalCost,
    });
  } catch (e) {
    return jsonResp({ error: (e as Error).message }, 500);
  }
});
