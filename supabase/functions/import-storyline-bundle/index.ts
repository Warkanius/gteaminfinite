// Storyline bundle importer — atomic create-new across players, locker codes, and posts.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify caller is admin
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: userResp } = await admin.auth.getUser(token);
    if (!userResp?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const { data: roleRow } = await admin.from("user_roles").select("role").eq("user_id", userResp.user.id).eq("role", "admin").maybeSingle();
    if (!roleRow) {
      return new Response(JSON.stringify({ error: "Admin only" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json();
    const { storyline, players = [], locker_codes = [], posts = [] } = body;
    if (!storyline?.title) {
      return new Response(JSON.stringify({ error: "Missing storyline.title" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 1) Insert storyline
    const { data: storyRow, error: storyErr } = await admin.from("storylines").insert({
      title: storyline.title,
      summary: storyline.summary ?? null,
      arc_image_url: storyline.arc_image_url ?? null,
      status: storyline.status ?? "draft",
      starts_at: storyline.starts_at ?? null,
      ends_at: storyline.ends_at ?? null,
    }).select("id").single();
    if (storyErr) throw storyErr;
    const storylineId = storyRow.id;
    const links: { entity_type: string; entity_id: string; note?: string }[] = [];

    // 2) Players
    const playerNameToId = new Map<string, string>();
    if (players.length) {
      const toInsert = players.map((r: any) => {
        const stars = r.stars ?? 3;
        return {
          name: r.name,
          position1: r.position1 ?? null,
          position2: r.position2 ?? null,
          rating: stars * 20 - 10,
          social_handle: r.social_handle ?? null,
          stat_3pt: r.stat_3pt ?? 50, stat_mid: r.stat_mid ?? 50, stat_fin: r.stat_fin ?? 50,
          stat_dnk: r.stat_dnk ?? 50, stat_ast: r.stat_ast ?? 50, stat_stl: r.stat_stl ?? 50,
          stat_reb: r.stat_reb ?? 50, stat_blk: r.stat_blk ?? 50, stat_int: r.stat_int ?? 50,
        };
      });
      const { data: pData, error: pErr } = await admin.from("player_cards").insert(toInsert).select("id,name");
      if (pErr) throw pErr;
      (pData ?? []).forEach((p: any) => {
        playerNameToId.set(p.name.toLowerCase(), p.id);
        links.push({ entity_type: "player", entity_id: p.id });
      });
    }

    // 3) Locker codes
    if (locker_codes.length) {
      const toInsert = locker_codes.map((r: any) => ({
        code: String(r.code).toUpperCase(),
        reward_type: r.reward_type ?? "coins",
        reward_value: r.reward_value ?? {},
        max_redemptions: r.max_redemptions ?? null,
        expires_at: r.expires_at ?? null,
      }));
      const { data: cData, error: cErr } = await admin.from("locker_codes").insert(toInsert).select("id");
      if (cErr) throw cErr;
      (cData ?? []).forEach((c: any) => links.push({ entity_type: "locker_code", entity_id: c.id }));
    }

    // 4) Posts (look up location handles + player names)
    if (posts.length) {
      const { data: locs } = await admin.from("location_accounts").select("id,handle");
      const handleMap = new Map<string, string>();
      (locs ?? []).forEach((l: any) => handleMap.set(l.handle.toLowerCase(), l.id));

      const toInsert = posts.map((r: any) => ({
        content: r.content,
        post_type: r.post_type ?? "tweet",
        event_type: r.event_type ?? null,
        location_account_id: r.location_handle ? handleMap.get(String(r.location_handle).toLowerCase()) ?? null : null,
        player_card_id: r.player_name ? playerNameToId.get(String(r.player_name).toLowerCase()) ?? null : null,
        image_url: r.image_url ?? null,
        scheduled_at: r.scheduled_at ?? null,
        is_published: !r.scheduled_at,
        is_headline: r.is_headline ?? false,
        headline_rank: r.headline_rank ?? null,
        headline_image_url: r.headline_image_url ?? null,
      }));
      const { data: postData, error: postErr } = await admin.from("social_posts").insert(toInsert).select("id");
      if (postErr) throw postErr;
      (postData ?? []).forEach((p: any) => links.push({ entity_type: "post", entity_id: p.id }));
    }

    // 5) Link everything to the storyline
    if (links.length) {
      const linkRows = links.map((l) => ({ storyline_id: storylineId, entity_type: l.entity_type, entity_id: l.entity_id }));
      const { error: linkErr } = await admin.from("storyline_entities").insert(linkRows);
      if (linkErr) throw linkErr;
    }

    return new Response(JSON.stringify({
      storyline_id: storylineId,
      created: {
        players: playerNameToId.size,
        locker_codes: locker_codes.length,
        posts: posts.length,
        links: links.length,
      },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
