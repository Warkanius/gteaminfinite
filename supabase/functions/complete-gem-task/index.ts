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

    const { task_id } = await req.json();
    if (!task_id) return new Response(JSON.stringify({ error: "task_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Fetch task
    const { data: task, error: taskErr } = await supabaseAdmin
      .from("gem_tasks")
      .select("*")
      .eq("id", task_id)
      .eq("is_active", true)
      .single();

    if (taskErr || !task) return new Response(JSON.stringify({ error: "Task not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    // Check cooldown — find most recent completion
    const { data: lastCompletion } = await supabaseAdmin
      .from("gem_task_completions")
      .select("completed_at")
      .eq("user_id", user.id)
      .eq("gem_task_id", task_id)
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastCompletion) {
      const cooldownMs = task.cooldown_hours * 60 * 60 * 1000;
      const timeSince = Date.now() - new Date(lastCompletion.completed_at).getTime();
      if (timeSince < cooldownMs) {
        const remainingMs = cooldownMs - timeSince;
        const remainingHrs = Math.ceil(remainingMs / 3600000);
        return new Response(JSON.stringify({ error: `On cooldown. Available in ${remainingHrs}h` }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // Record completion
    await supabaseAdmin.from("gem_task_completions").insert({ user_id: user.id, gem_task_id: task_id });

    // Award gems
    const { data: profile } = await supabaseAdmin.from("profiles").select("gems").eq("user_id", user.id).single();
    const newGems = (profile?.gems ?? 0) + task.gem_reward;
    await supabaseAdmin.from("profiles").update({ gems: newGems }).eq("user_id", user.id);

    return new Response(JSON.stringify({ success: true, gems_earned: task.gem_reward, total_gems: newGems }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
