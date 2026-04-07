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

    const { code } = await req.json();
    if (!code || typeof code !== "string") return new Response(JSON.stringify({ error: "code required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Find the locker code
    const { data: lockerCode, error: lcErr } = await supabaseAdmin
      .from("locker_codes")
      .select("*")
      .eq("code", code.trim().toUpperCase())
      .single();

    if (lcErr || !lockerCode) return new Response(JSON.stringify({ error: "Invalid code" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Check expiry
    if (lockerCode.expires_at && new Date(lockerCode.expires_at) < new Date()) {
      return new Response(JSON.stringify({ error: "Code has expired" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Check if already redeemed by user
    const { data: existing } = await supabaseAdmin
      .from("locker_code_redemptions")
      .select("id")
      .eq("user_id", user.id)
      .eq("locker_code_id", lockerCode.id)
      .maybeSingle();

    if (existing) return new Response(JSON.stringify({ error: "Already redeemed" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Check max redemptions
    if (lockerCode.max_redemptions != null) {
      const { count } = await supabaseAdmin
        .from("locker_code_redemptions")
        .select("id", { count: "exact", head: true })
        .eq("locker_code_id", lockerCode.id);

      if ((count ?? 0) >= lockerCode.max_redemptions) {
        return new Response(JSON.stringify({ error: "Code fully redeemed" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Distribute reward
    const rewardType = lockerCode.reward_type;
    const rewardValue = lockerCode.reward_value as any;
    let rewardDescription = "";
    let inventoryId: string | null = null;
    let packId: string | null = null;

    if (rewardType === "coins") {
      const amount = rewardValue.amount ?? 100;
      const { data: profile } = await supabaseAdmin.from("profiles").select("coins").eq("user_id", user.id).single();
      await supabaseAdmin.from("profiles").update({ coins: (profile?.coins ?? 0) + amount }).eq("user_id", user.id);
      rewardDescription = `${amount} Coins`;
    } else if (rewardType === "gems") {
      const amount = rewardValue.amount ?? 10;
      const { data: profile } = await supabaseAdmin.from("profiles").select("gems").eq("user_id", user.id).single();
      await supabaseAdmin.from("profiles").update({ gems: (profile?.gems ?? 0) + amount }).eq("user_id", user.id);
      rewardDescription = `${amount} Gems`;
    } else if (rewardType === "card") {
      const cardId = rewardValue.player_card_id;
      if (cardId) {
        await supabaseAdmin.from("user_collections").insert({ user_id: user.id, player_card_id: cardId });
        const { data: card } = await supabaseAdmin.from("player_cards").select("name").eq("id", cardId).single();
        rewardDescription = `Card: ${card?.name ?? "Unknown"}`;
      }
    } else if (rewardType === "pack") {
      packId = rewardValue.pack_id;
      if (packId) {
        // Insert into user_pack_inventory instead of dumping cards directly
        const { data: inv } = await supabaseAdmin
          .from("user_pack_inventory")
          .insert({ user_id: user.id, pack_id: packId, source: "locker_code" })
          .select("id")
          .single();
        inventoryId = inv?.id ?? null;
        const { data: packData } = await supabaseAdmin.from("packs").select("name").eq("id", packId).single();
        rewardDescription = `Pack: ${packData?.name ?? "Unknown"}`;
      }
    }

    // Record redemption
    await supabaseAdmin.from("locker_code_redemptions").insert({ user_id: user.id, locker_code_id: lockerCode.id });

    return new Response(JSON.stringify({
      success: true,
      reward_type: rewardType,
      reward_description: rewardDescription,
      pack_id: packId,
      inventory_id: inventoryId,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
