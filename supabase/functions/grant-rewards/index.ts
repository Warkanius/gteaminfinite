import { createClient } from "https://esm.sh/@supabase/supabase-js@2.97.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type Admin = ReturnType<typeof createClient>;

/** Reserve a one-time grant. Returns false when it was already granted. */
async function reserve(admin: Admin, userId: string, key: string, coins = 0, gems = 0) {
  const { error } = await admin
    .from("reward_grants")
    .insert({ user_id: userId, grant_key: key, coins, gems });
  if (error) {
    // unique violation => already granted
    if ((error as { code?: string }).code === "23505") return false;
    throw new Error(error.message);
  }
  return true;
}

/** Add coins/gems to a profile using values read from the database. */
async function addCurrency(admin: Admin, userId: string, coins: number, gems: number) {
  if (!coins && !gems) return;
  const { data: profile } = await admin
    .from("profiles")
    .select("coins, gems")
    .eq("user_id", userId)
    .maybeSingle();
  if (!profile) return;
  await admin
    .from("profiles")
    .update({
      coins: (profile.coins ?? 0) + coins,
      gems: (profile.gems ?? 0) + gems,
    })
    .eq("user_id", userId);
}

/**
 * Grant a pack reward. `packReward` is either a pack id, "random_standard"
 * or "random_standard_box". Returns inventory ids plus a display label.
 */
async function grantPack(admin: Admin, userId: string, packReward: string, source: string) {
  if (packReward === "random_standard") {
    const { data: packs } = await admin.from("packs").select("id, name").eq("pack_type", "standard");
    if (!packs?.length) return null;
    const picked = packs[Math.floor(Math.random() * packs.length)];
    const { data: inv } = await admin
      .from("user_pack_inventory")
      .insert({ user_id: userId, pack_id: picked.id, source })
      .select("id")
      .single();
    return { inventory_ids: inv ? [inv.id] : [], label: `📦 ${picked.name}` };
  }

  if (packReward === "random_standard_box") {
    const { data: packs } = await admin
      .from("packs")
      .select("id, name")
      .eq("pack_type", "standard")
      .not("ten_box_cost", "is", null);
    if (!packs?.length) return null;
    const picked = packs[Math.floor(Math.random() * packs.length)];
    const rows = Array.from({ length: 10 }, () => ({ user_id: userId, pack_id: picked.id, source }));
    const { data: inv } = await admin.from("user_pack_inventory").insert(rows).select("id");
    return {
      inventory_ids: (inv ?? []).map((r: { id: string }) => r.id),
      label: `📦 ${picked.name} Box (10x)`,
    };
  }

  const { data: packInfo } = await admin.from("packs").select("name").eq("id", packReward).maybeSingle();
  if (!packInfo) return null;
  const { data: inv } = await admin
    .from("user_pack_inventory")
    .insert({ user_id: userId, pack_id: packReward, source })
    .select("id")
    .single();
  return { inventory_ids: inv ? [inv.id] : [], label: `📦 ${packInfo.name}` };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Missing auth" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const asUser = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userErr } = await asUser.auth.getUser();
    if (userErr || !user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json();
    const action = body?.action as string;

    // ---------------------------------------------------------------- game
    if (action === "game_result") {
      const { game_log_id, challenge_id, domination_game_id } = body;
      if (!game_log_id) return json({ error: "game_log_id required" }, 400);

      const { data: log } = await admin
        .from("game_logs")
        .select("id, won, user_id")
        .eq("id", game_log_id)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!log) return json({ error: "Game log not found" }, 404);
      if (!log.won) return json({ coins: 0, gems: 0, skipped: "loss" });

      let coins = 0;
      let gems = 0;
      let cardRewardId: string | null = null;
      let packReward: string | null = null;
      let repeatable = true;

      if (challenge_id) {
        const { data: ch } = await admin
          .from("challenges")
          .select("coin_reward, gem_reward, card_reward_id, pack_reward, is_repeatable")
          .eq("id", challenge_id)
          .maybeSingle();
        if (!ch) return json({ error: "Challenge not found" }, 404);

        repeatable = ch.is_repeatable !== false;
        if (!repeatable) {
          const { data: done } = await admin
            .from("challenge_completions")
            .select("id")
            .eq("user_id", user.id)
            .eq("challenge_id", challenge_id)
            .maybeSingle();
          if (done) return json({ coins: 0, gems: 0, already_granted: true });
        }

        coins = ch.coin_reward ?? 0;
        gems = ch.gem_reward ?? 0;
        cardRewardId = ch.card_reward_id ?? null;
        packReward = ch.pack_reward ?? null;
      } else if (domination_game_id) {
        const { data: dg } = await admin
          .from("domination_games")
          .select("coin_reward, pack_reward")
          .eq("id", domination_game_id)
          .maybeSingle();
        if (!dg) return json({ error: "Domination game not found" }, 404);
        coins = dg.coin_reward ?? 0;
        packReward = dg.pack_reward ?? null;
      }

      // One grant per game log, always.
      const fresh = await reserve(admin, user.id, `game_log:${game_log_id}`, coins, gems);
      if (!fresh) return json({ coins: 0, gems: 0, already_granted: true });

      await addCurrency(admin, user.id, coins, gems);

      if (cardRewardId) {
        await admin.from("user_collections").insert({
          user_id: user.id,
          player_card_id: cardRewardId,
          source: "challenge_reward",
        });
      }

      if (challenge_id) {
        await admin
          .from("challenge_completions")
          .insert({ user_id: user.id, challenge_id })
          .select("id")
          .maybeSingle();
      }

      let pack = null;
      if (packReward) {
        pack = await grantPack(
          admin,
          user.id,
          packReward,
          challenge_id ? "challenge_reward" : "domination_reward",
        );
      }

      return json({
        coins,
        gems,
        card_granted: !!cardRewardId,
        pack_inventory_id: pack?.inventory_ids?.[0] ?? null,
        pack_label: pack?.label ?? null,
      });
    }

    // ----------------------------------------------------------------- run
    if (action === "run_result") {
      const { run_id, won } = body;
      if (!run_id) return json({ error: "run_id required" }, 400);

      const { data: run } = await admin
        .from("runs")
        .select("id, milestones")
        .eq("id", run_id)
        .maybeSingle();
      if (!run) return json({ error: "Run not found" }, 404);

      const { data: userRun } = await admin
        .from("user_runs")
        .select("id, current_wins, highest_wins")
        .eq("run_id", run_id)
        .eq("user_id", user.id)
        .maybeSingle();

      const oldHighest = userRun?.highest_wins ?? 0;
      const currentWins = won ? (userRun?.current_wins ?? 0) + 1 : 0;
      const highestWins = Math.max(currentWins, oldHighest);

      if (userRun) {
        await admin
          .from("user_runs")
          .update({ current_wins: currentWins, highest_wins: highestWins, updated_at: new Date().toISOString() })
          .eq("id", userRun.id);
      } else {
        await admin.from("user_runs").insert({
          user_id: user.id,
          run_id,
          current_wins: currentWins,
          highest_wins: highestWins,
        });
      }

      const milestoneParts: string[] = [];
      const rankParts: string[] = [];
      let rankName: string | null = null;

      // --- per-run milestone (one grant per run + win count) ---
      const milestones = Array.isArray(run.milestones) ? (run.milestones as Record<string, number | string>[]) : [];
      const reached = won ? milestones.find((m) => Number(m.wins_required) === currentWins) : undefined;
      if (reached) {
        const mCoins = Number(reached.coin_reward ?? 0) || 0;
        const mGems = Number(reached.gem_reward ?? 0) || 0;
        const fresh = await reserve(admin, user.id, `run:${run_id}:milestone:${currentWins}`, mCoins, mGems);
        if (fresh) {
          await addCurrency(admin, user.id, mCoins, mGems);
          if (mCoins) milestoneParts.push(`${mCoins} Coins`);
          if (mGems) milestoneParts.push(`${mGems} Gems`);
          if (reached.pack_reward) {
            const pack = await grantPack(admin, user.id, String(reached.pack_reward), "run_milestone");
            if (pack) milestoneParts.push(pack.label);
          }
        }
      }

      // --- global rank ladder (one grant per rank, ever) ---
      let totalCoins = 0;
      let totalGems = 0;
      if (won && highestWins > oldHighest) {
        const { data: rankRewards } = await admin
          .from("run_rank_rewards")
          .select("*")
          .gt("wins_required", oldHighest)
          .lte("wins_required", highestWins)
          .order("sort_order");

        for (const reward of rankRewards ?? []) {
          const { data: claimed } = await admin
            .from("user_rank_claims")
            .select("id")
            .eq("user_id", user.id)
            .eq("rank_name", reward.rank_name)
            .maybeSingle();
          if (claimed) continue;

          const fresh = await reserve(
            admin,
            user.id,
            `rank:${reward.rank_name}`,
            reward.coin_reward ?? 0,
            reward.gem_reward ?? 0,
          );
          if (!fresh) continue;

          await admin.from("user_rank_claims").insert({ user_id: user.id, rank_name: reward.rank_name });
          totalCoins += reward.coin_reward ?? 0;
          totalGems += reward.gem_reward ?? 0;
          rankName = reward.rank_name;

          if (reward.pack_reward) {
            const pack = await grantPack(admin, user.id, reward.pack_reward, "rank_reward");
            if (pack) rankParts.push(pack.label);
          }
        }

        await addCurrency(admin, user.id, totalCoins, totalGems);
        if (totalCoins) rankParts.unshift(`${totalCoins.toLocaleString()} Coins`);
        if (totalGems) rankParts.unshift(`${totalGems} Gems`);
      }

      return json({
        current_wins: currentWins,
        highest_wins: highestWins,
        new_best: won && highestWins > oldHighest,
        milestone_parts: milestoneParts,
        rank_name: rankName,
        rank_parts: rankParts,
      });
    }

    // --------------------------------------------------------- collections
    if (action === "collection_claim") {
      const { collection_id, sub_collection_id } = body;
      if (!collection_id && !sub_collection_id) return json({ error: "Missing claim target" }, 400);

      const table = sub_collection_id ? "sub_collections" : "collections";
      const targetId = sub_collection_id ?? collection_id;
      const { data: target } = await admin
        .from(table)
        .select("id, name, reward_type, reward_coins, reward_gems, reward_pack_id")
        .eq("id", targetId)
        .maybeSingle();
      if (!target) return json({ error: "Collection not found" }, 404);

      // Verify the set is actually complete before paying out.
      let cardQuery = admin.from("player_cards").select("id, is_collection_reward");
      if (sub_collection_id) {
        cardQuery = cardQuery.eq("sub_collection_id", sub_collection_id);
      } else {
        cardQuery = cardQuery.eq("collection_id", collection_id).is("sub_collection_id", null);
      }
      const { data: setCards } = await cardQuery;
      const required = (setCards ?? []).filter((c) => !c.is_collection_reward).map((c) => c.id);
      if (required.length === 0) return json({ error: "Collection has no cards" }, 400);

      const { data: owned } = await admin
        .from("user_collections")
        .select("player_card_id")
        .eq("user_id", user.id)
        .in("player_card_id", required);
      const ownedSet = new Set((owned ?? []).map((o) => o.player_card_id));
      if (required.some((id) => !ownedSet.has(id))) {
        return json({ error: "Collection is not complete yet" }, 400);
      }

      const rewardType = target.reward_type as string | null;
      const claimKey = `${sub_collection_id ? "sub" : "col"}:${targetId}:${rewardType ?? "none"}`;
      const fresh = await reserve(
        admin,
        user.id,
        claimKey,
        target.reward_coins ?? 0,
        target.reward_gems ?? 0,
      );
      if (!fresh) return json({ error: "Reward already claimed" }, 400);

      await admin.from("user_collection_claims").insert({
        user_id: user.id,
        collection_id: sub_collection_id ? null : collection_id,
        sub_collection_id: sub_collection_id ?? null,
        reward_type: rewardType,
      });

      if (rewardType === "card") {
        const rewardCard = (setCards ?? []).find((c) => c.is_collection_reward);
        if (!rewardCard) return json({ error: "No reward card configured" }, 400);
        await admin.from("user_collections").insert({
          user_id: user.id,
          player_card_id: rewardCard.id,
          source: "collection_reward",
        });
        return json({ reward_type: "card" });
      }

      if (rewardType === "coins" || rewardType === "gems") {
        const coins = rewardType === "coins" ? target.reward_coins ?? 0 : 0;
        const gems = rewardType === "gems" ? target.reward_gems ?? 0 : 0;
        await addCurrency(admin, user.id, coins, gems);
        return json({ reward_type: rewardType, amount: coins || gems });
      }

      if (rewardType === "pack") {
        if (!target.reward_pack_id) return json({ error: "No pack configured" }, 400);
        const pack = await grantPack(admin, user.id, target.reward_pack_id, "collection_reward");
        return json({ reward_type: "pack", pack_label: pack?.label ?? null });
      }

      return json({ error: "Unsupported reward type" }, 400);
    }

    // ---------------------------------------------------------- evolutions
    if (action === "evo_claim") {
      const { progress_id } = body;
      if (!progress_id) return json({ error: "progress_id required" }, 400);

      const { data: progress } = await admin
        .from("user_evo_progress")
        .select("id, user_id, player_card_id, evo_path_id, completed, claimed")
        .eq("id", progress_id)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!progress) return json({ error: "Progress not found" }, 404);
      if (!progress.completed) return json({ error: "Evolution is not complete yet" }, 400);
      if (progress.claimed) return json({ error: "Evolution already claimed" }, 400);

      const { data: path } = await admin
        .from("evo_paths")
        .select("evolves_to_card_id")
        .eq("id", progress.evo_path_id)
        .maybeSingle();
      if (!path?.evolves_to_card_id) return json({ error: "No evolution target configured" }, 400);

      const { data: copies } = await admin
        .from("user_collections")
        .select("id")
        .eq("user_id", user.id)
        .eq("player_card_id", progress.player_card_id)
        .limit(1);
      if (!copies?.length) return json({ error: "You no longer own the base card" }, 400);

      const fresh = await reserve(admin, user.id, `evo:${progress_id}`);
      if (!fresh) return json({ error: "Evolution already claimed" }, 400);

      await admin.from("user_collections").insert({
        user_id: user.id,
        player_card_id: path.evolves_to_card_id,
        source: "evolution",
      });
      await admin.from("user_collections").delete().eq("id", copies[0].id);
      await admin.from("user_evo_progress").update({ claimed: true }).eq("id", progress_id);

      return json({ evolved_card_id: path.evolves_to_card_id });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.error("[grant-rewards]", e);
    return json({ error: (e as Error).message }, 500);
  }
});
