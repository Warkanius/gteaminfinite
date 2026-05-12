import { createClient } from "https://esm.sh/@supabase/supabase-js@2.97.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Missing auth" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const supabaseUser = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });

    const { data: { user }, error: userErr } = await supabaseUser.auth.getUser();
    if (userErr || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { listing_id } = await req.json();
    if (!listing_id) return new Response(JSON.stringify({ error: "listing_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Fetch listing
    const { data: listing, error: listErr } = await supabaseAdmin
      .from("auction_listings")
      .select("*")
      .eq("id", listing_id)
      .eq("is_active", true)
      .is("bought_by", null)
      .single();

    if (listErr || !listing) return new Response(JSON.stringify({ error: "Listing not available" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Check not expired
    if (new Date(listing.expires_at) < new Date()) {
      await supabaseAdmin.from("auction_listings").update({ is_active: false }).eq("id", listing_id);
      return new Response(JSON.stringify({ error: "Listing expired" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Check buyer has enough coins
    const { data: profile } = await supabaseAdmin.from("profiles").select("coins").eq("user_id", user.id).single();
    if (!profile || profile.coins < listing.price) {
      return new Response(JSON.stringify({ error: "Not enough coins" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Deduct coins
    await supabaseAdmin.from("profiles").update({ coins: profile.coins - listing.price }).eq("user_id", user.id);

    // Mark listing as bought
    await supabaseAdmin.from("auction_listings").update({
      bought_by: user.id,
      bought_at: new Date().toISOString(),
      is_active: false,
    }).eq("id", listing_id);

    // Add card to user collection
    await supabaseAdmin.from("user_collections").insert({
      user_id: user.id,
      player_card_id: listing.player_card_id,
    });

    // Fire signing event (server gates by tier + cooldown)
    try {
      const { data: cardInfo } = await supabaseAdmin
        .from("player_cards").select("name, gem_tiers(name)").eq("id", listing.player_card_id).maybeSingle();
      const { data: prof } = await supabaseAdmin
        .from("profiles").select("display_name, team_name").eq("user_id", user.id).maybeSingle();
      await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/post-league-event`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({
          event_type: "signing", user_id: user.id,
          player_card_id: listing.player_card_id,
          player_name: cardInfo?.name ?? null,
          gem_tier_name: (cardInfo as any)?.gem_tiers?.name ?? null,
          user_display: prof?.team_name ?? prof?.display_name ?? "A challenger",
        }),
      });
    } catch (e) { console.warn("[buy-auction-card] signing swallow", (e as Error).message); }

    return new Response(JSON.stringify({
      success: true,
      coins_remaining: profile.coins - listing.price,
      player_card_id: listing.player_card_id,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
