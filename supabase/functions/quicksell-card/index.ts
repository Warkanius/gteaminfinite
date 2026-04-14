import { createClient } from "https://esm.sh/@supabase/supabase-js@2.97.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DEFAULT_QUICKSELL_VALUE = 50;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing auth" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: userErr } = await supabaseUser.auth.getUser();
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { collection_id } = await req.json();
    if (!collection_id) {
      return new Response(JSON.stringify({ error: "collection_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Fetch the collection entry
    const { data: entry, error: entryErr } = await supabaseAdmin
      .from("user_collections")
      .select("*")
      .eq("id", collection_id)
      .eq("user_id", user.id)
      .single();

    if (entryErr || !entry) {
      return new Response(JSON.stringify({ error: "Card not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (entry.is_locked) {
      return new Response(JSON.stringify({ error: "Card is locked" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Block selling reward cards (only standard_pack cards can be sold)
    if (entry.source && entry.source !== "standard_pack") {
      return new Response(JSON.stringify({ error: "Cannot sell reward cards" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Get quicksell value from rule_config
    const { data: ruleRow } = await supabaseAdmin
      .from("rule_config")
      .select("value")
      .eq("key", "quicksell_coin_value")
      .single();

    const coinValue = typeof ruleRow?.value === "number" ? ruleRow.value : DEFAULT_QUICKSELL_VALUE;

    // Delete the collection entry
    const { error: delErr } = await supabaseAdmin
      .from("user_collections")
      .delete()
      .eq("id", collection_id);

    if (delErr) throw delErr;

    // Add coins to profile
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("coins")
      .eq("user_id", user.id)
      .single();

    const newCoins = (profile?.coins ?? 0) + coinValue;

    await supabaseAdmin
      .from("profiles")
      .update({ coins: newCoins })
      .eq("user_id", user.id);

    return new Response(JSON.stringify({ success: true, coins: newCoins, coin_value: coinValue }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
