import { createClient } from "https://esm.sh/@supabase/supabase-js@2.97.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DEFAULT_CONFIG = {
  min_price: 1000,
  max_price: 10000,
  snipe_chance: 10,
  snipe_discount_min: 15,
  snipe_discount_max: 40,
  listings_per_refresh: 5,
  listing_duration_minutes: 60,
  tier_weights: {} as Record<string, number>,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Check for force parameter
    let force = false;
    try {
      const body = await req.json();
      force = body?.force === true;
    } catch {
      // No body or invalid JSON — not forced
    }

    // Load auction config
    const { data: configRow } = await supabase.from("rule_config").select("value").eq("key", "auction_config").single();
    const config = { ...DEFAULT_CONFIG, ...(configRow?.value as any ?? {}) };

    if (force) {
      // Deactivate ALL active listings when force-refreshing
      await supabase
        .from("auction_listings")
        .update({ is_active: false })
        .eq("is_active", true);
    } else {
      // Expire old listings only
      await supabase
        .from("auction_listings")
        .update({ is_active: false })
        .eq("is_active", true)
        .lt("expires_at", new Date().toISOString());
    }

    // Count current active listings
    const { count: activeCount } = await supabase
      .from("auction_listings")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true)
      .is("bought_by", null);

    const toGenerate = force
      ? config.listings_per_refresh
      : Math.max(0, config.listings_per_refresh - (activeCount ?? 0));

    if (toGenerate === 0) {
      return new Response(JSON.stringify({ message: "Market is full", active: activeCount }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get card IDs that belong to paid packs (cost > 0)
    const { data: packs } = await supabase.from("packs").select("id").eq("pack_type", "standard");
    const packIds = (packs ?? []).map((p: any) => p.id);

    if (packIds.length === 0) {
      return new Response(JSON.stringify({ message: "No paid packs found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: packPlayerRows } = await supabase
      .from("pack_players")
      .select("player_card_id")
      .in("pack_id", packIds);

    const eligibleCardIds = [...new Set((packPlayerRows ?? []).map((r: any) => r.player_card_id))];

    if (eligibleCardIds.length === 0) {
      return new Response(JSON.stringify({ message: "No eligible cards in paid packs" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch eligible player cards with gem tier info and market_value
    const { data: cards } = await supabase
      .from("player_cards")
      .select("id, name, rating, market_value, gem_tier_id, gem_tiers(name, sort_order)")
      .in("id", eligibleCardIds);

    if (!cards || cards.length === 0) {
      return new Response(JSON.stringify({ message: "No cards available" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Weight cards by tier
    const tierWeights = config.tier_weights;
    const weightedCards = cards.map((c: any) => {
      const tierName = c.gem_tiers?.name?.toLowerCase() ?? "base";
      const weight = tierWeights[tierName] ?? 1;
      return { card: c, weight };
    });

    const totalWeight = weightedCards.reduce((s: number, w: any) => s + w.weight, 0);

    function pickRandomCard() {
      let roll = Math.random() * totalWeight;
      for (const wc of weightedCards) {
        roll -= wc.weight;
        if (roll <= 0) return wc.card;
      }
      return weightedCards[weightedCards.length - 1].card;
    }

    // Generate listings
    const expiresAt = new Date(Date.now() + config.listing_duration_minutes * 60 * 1000).toISOString();
    const listings = [];

    for (let i = 0; i < toGenerate; i++) {
      const card = pickRandomCard();
      const isSnipe = Math.random() * 100 < config.snipe_chance;

      // Use market_value as base price with 0.9x–1.5x variance
      const baseValue = card.market_value ?? 1500;
      let price = Math.round(baseValue * (0.9 + Math.random() * 0.6));
      price = Math.max(config.min_price, Math.min(config.max_price, price));

      if (isSnipe) {
        const discMin = (config.snipe_discount_min ?? 15) / 100;
        const discMax = (config.snipe_discount_max ?? 40) / 100;
        price = Math.round(baseValue * (discMin + Math.random() * (discMax - discMin)));
        price = Math.max(500, price);
      }

      listings.push({
        player_card_id: card.id,
        seller_type: "bot",
        price,
        expires_at: expiresAt,
        is_active: true,
      });
    }

    if (listings.length > 0) {
      await supabase.from("auction_listings").insert(listings);
    }

    return new Response(JSON.stringify({ success: true, generated: listings.length, active: (activeCount ?? 0) + listings.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
