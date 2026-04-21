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

/**
 * Build a chain-root resolver from evo_paths so any evolved variant of a card
 * resolves back to its base/root id. Owning any version of a player counts as
 * owning the card for collection-progress and tier-unlock checks.
 */
async function buildChainRootResolver(admin: any) {
  const { data: links } = await admin
    .from("evo_paths")
    .select("player_card_id, evolves_to_card_id")
    .not("evolves_to_card_id", "is", null);

  const parentOf = new Map<string, string>();
  for (const link of (links ?? []) as any[]) {
    const from = link.player_card_id as string;
    const to = link.evolves_to_card_id as string;
    if (!from || !to || from === to) continue;
    parentOf.set(to, from);
  }

  const cache = new Map<string, string>();
  return (id: string): string => {
    if (cache.has(id)) return cache.get(id)!;
    let cur = id;
    const seen = new Set<string>([cur]);
    while (parentOf.has(cur)) {
      const next = parentOf.get(cur)!;
      if (seen.has(next)) break;
      seen.add(next);
      cur = next;
    }
    cache.set(id, cur);
    return cur;
  };
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

    const { player_card_id } = await req.json();
    if (!player_card_id) return jsonResp({ error: "player_card_id required" }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Check if card is listed in gem market
    const { data: listing, error: listingErr } = await admin
      .from("gem_market_listings")
      .select("id, gem_tier_id, gem_value")
      .eq("player_card_id", player_card_id)
      .single();

    if (listingErr || !listing) return jsonResp({ error: "Card is not available in Gem Market" }, 404);
    if (listing.gem_value <= 0) return jsonResp({ error: "Card not purchasable" }, 400);

    // Fetch the card data for response
    const { data: card, error: cardErr } = await admin
      .from("player_cards")
      .select("id, name, rating, position1, position2, gem_name, card_color_primary, card_color_secondary, card_glow_color, card_animation")
      .eq("id", player_card_id)
      .single();

    if (cardErr || !card) return jsonResp({ error: "Card not found" }, 404);

    const resolveRoot = await buildChainRootResolver(admin);
    const targetRoot = resolveRoot(player_card_id);

    // Build set of chain roots the user already owns (any evo version counts)
    const { data: userCollection } = await admin
      .from("user_collections")
      .select("player_card_id")
      .eq("user_id", user.id);

    const ownedRoots = new Set<string>();
    for (const row of (userCollection ?? []) as any[]) {
      ownedRoots.add(resolveRoot(row.player_card_id));
    }

    if (ownedRoots.has(targetRoot)) {
      return jsonResp({ error: "You already own this card (or an evolved version)" }, 400);
    }

    // Tier unlock check using chain roots
    const { data: allTiers } = await admin
      .from("gem_tiers")
      .select("id, sort_order")
      .order("sort_order", { ascending: true });

    if (allTiers && allTiers.length > 0) {
      const currentTierIndex = allTiers.findIndex((t) => t.id === listing.gem_tier_id);
      if (currentTierIndex > 0) {
        const prevTier = allTiers[currentTierIndex - 1];

        const { data: prevListings } = await admin
          .from("gem_market_listings")
          .select("player_card_id")
          .eq("gem_tier_id", prevTier.id);

        const prevRoots = Array.from(
          new Set((prevListings ?? []).map((l: any) => resolveRoot(l.player_card_id))),
        );
        const totalPrev = prevRoots.length;

        const ownedInPrev = prevRoots.filter((r) => ownedRoots.has(r)).length;
        const required = Math.ceil(totalPrev / 2);

        if (ownedInPrev < required) {
          return jsonResp({
            error: `You need to own at least ${required} cards from the previous tier to unlock this tier`,
          }, 403);
        }
      }
    }

    // Check user has enough gems
    const { data: profile } = await admin
      .from("profiles")
      .select("id, gems")
      .eq("user_id", user.id)
      .single();

    if (!profile) return jsonResp({ error: "Profile not found" }, 404);
    if (profile.gems < listing.gem_value) {
      return jsonResp({ error: "Not enough gems" }, 400);
    }

    // Deduct gems
    const { error: updateErr } = await admin
      .from("profiles")
      .update({ gems: profile.gems - listing.gem_value })
      .eq("id", profile.id);

    if (updateErr) return jsonResp({ error: "Failed to deduct gems" }, 500);

    // Add to collection
    const { error: insertErr } = await admin
      .from("user_collections")
      .insert({ user_id: user.id, player_card_id, source: "gem_market" });

    if (insertErr) {
      // Rollback gems
      await admin.from("profiles").update({ gems: profile.gems }).eq("id", profile.id);
      return jsonResp({ error: "Failed to add card to collection" }, 500);
    }

    return jsonResp({
      card,
      remaining_gems: profile.gems - listing.gem_value,
    });
  } catch (e) {
    return jsonResp({ error: (e as Error).message }, 500);
  }
});
