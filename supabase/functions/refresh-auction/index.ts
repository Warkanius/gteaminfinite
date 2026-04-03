import { createClient } from "https://esm.sh/@supabase/supabase-js@2.97.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_CONFIG = {
  min_price: 200,
  max_price: 5000,
  snipe_chance: 10,
  listings_per_refresh: 5,
  listing_duration_minutes: 60,
  tier_weights: {} as Record<string, number>,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Load auction config
    const { data: configRow } = await supabase.from("rule_config").select("value").eq("key", "auction_config").single();
    const config = { ...DEFAULT_CONFIG, ...(configRow?.value as any ?? {}) };

    // Expire old listings
    await supabase
      .from("auction_listings")
      .update({ is_active: false })
      .eq("is_active", true)
      .lt("expires_at", new Date().toISOString());

    // Count current active listings
    const { count: activeCount } = await supabase
      .from("auction_listings")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true)
      .is("bought_by", null);

    const toGenerate = Math.max(0, config.listings_per_refresh - (activeCount ?? 0));
    if (toGenerate === 0) {
      return new Response(JSON.stringify({ message: "Market is full", active: activeCount }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch all player cards with gem tier info
    const { data: cards } = await supabase
      .from("player_cards")
      .select("id, name, rating, gem_tier_id, gem_tiers(name, sort_order)")
      .eq("is_collection_reward", false);

    if (!cards || cards.length === 0) {
      return new Response(JSON.stringify({ message: "No cards available" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Weight cards by tier if weights are configured
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

      // Price based on rating, with snipe discount
      const ratingFactor = (card.rating ?? 50) / 50;
      let price = Math.round(config.min_price + (config.max_price - config.min_price) * ratingFactor * (0.7 + Math.random() * 0.6));
      price = Math.max(config.min_price, Math.min(config.max_price, price));

      if (isSnipe) {
        price = Math.round(price * (0.15 + Math.random() * 0.25)); // 15-40% of normal price
        price = Math.max(50, price);
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
