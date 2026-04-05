import { createClient } from "https://esm.sh/@supabase/supabase-js@2.97.0";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.97.0/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Find posts that are scheduled and not yet published
    const { data: pendingPosts, error: fetchErr } = await supabase
      .from("social_posts")
      .select("id, content, post_type")
      .eq("is_published", false)
      .lte("scheduled_at", new Date().toISOString());

    if (fetchErr) throw fetchErr;
    if (!pendingPosts || pendingPosts.length === 0) {
      return new Response(JSON.stringify({ published: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Publish them
    const ids = pendingPosts.map((p) => p.id);
    const { error: updateErr } = await supabase
      .from("social_posts")
      .update({ is_published: true, posted_at: new Date().toISOString() })
      .in("id", ids);

    if (updateErr) throw updateErr;

    // Get all user IDs for notifications
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id");

    if (profiles && profiles.length > 0) {
      // Create notifications for announcement posts
      const announcementPosts = pendingPosts.filter(
        (p) => p.post_type === "announcement"
      );

      if (announcementPosts.length > 0) {
        const notifications = announcementPosts.flatMap((post) =>
          profiles.map((profile) => ({
            user_id: profile.user_id,
            title: "New Announcement",
            body:
              post.content.length > 100
                ? post.content.slice(0, 100) + "…"
                : post.content,
            link: "/feed",
          }))
        );

        // Insert in batches of 500
        for (let i = 0; i < notifications.length; i += 500) {
          const batch = notifications.slice(i, i + 500);
          const { error: notifErr } = await supabase
            .from("notifications")
            .insert(batch);
          if (notifErr) console.error("Notification insert error:", notifErr);
        }
      }
    }

    return new Response(
      JSON.stringify({ published: ids.length }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
