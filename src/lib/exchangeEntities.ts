/**
 * Per-entity ExchangeEntity configurations: wires the schemas, prompt builders,
 * preview rows, and commit functions from chatgptSchemas.ts into the
 * <ChatGPTExchange/> component.
 */
import { supabase } from "@/integrations/supabase/client";
import type { ExchangeEntity } from "@/components/admin/ChatGPTExchange";
import {
  PlayerImportSchema, LockerCodeImportSchema, SocialPostImportSchema,
  buildPlayerPrompt, buildLockerCodePrompt, buildSocialPostPrompt,
  commitPlayers, commitLockerCodes, commitSocialPosts, flagCollision,
} from "@/lib/chatgptSchemas";

export const PlayersExchange: ExchangeEntity<typeof PlayerImportSchema> = {
  schema: PlayerImportSchema,
  buildPrompt: buildPlayerPrompt,
  toPreviewRows: (rows, ctx) => rows.map((r, i) => ({
    key: `player-${i}-${r.name}`,
    label: r.name,
    detail: `${r.archetype ?? "—"} · ★${r.stars ?? 3} · ${r.position1 ?? "?"}${r.position2 ? "/" + r.position2 : ""}`,
    collides: flagCollision(r.name, ctx.existingPlayerNames),
  })),
  commit: async (rows, ctx) => {
    const created = await commitPlayers(rows, ctx);
    return created.length;
  },
  exportData: async () => {
    const { data } = await supabase
      .from("player_cards")
      .select("name,position1,position2,rating,stat_3pt,stat_mid,stat_fin,stat_dnk,stat_ast,stat_stl,stat_reb,stat_blk,stat_int,social_handle")
      .order("name");
    return data ?? [];
  },
};

export const LockerCodesExchange: ExchangeEntity<typeof LockerCodeImportSchema> = {
  schema: LockerCodeImportSchema,
  buildPrompt: buildLockerCodePrompt,
  toPreviewRows: (rows, ctx) => rows.map((r, i) => ({
    key: `code-${i}-${r.code}`,
    label: r.code,
    detail: `${r.reward_type} · ${JSON.stringify(r.reward_value)}${r.expires_at ? ` · exp ${r.expires_at}` : ""}`,
    collides: flagCollision(r.code, ctx.existingLockerCodes),
  })),
  commit: async (rows) => {
    const created = await commitLockerCodes(rows);
    return created.length;
  },
  exportData: async () => {
    const { data } = await supabase.from("locker_codes").select("*").order("created_at", { ascending: false });
    return data ?? [];
  },
};

export const SocialPostsExchange: ExchangeEntity<typeof SocialPostImportSchema> = {
  schema: SocialPostImportSchema,
  buildPrompt: buildSocialPostPrompt,
  toPreviewRows: (rows) => rows.map((r, i) => ({
    key: `post-${i}`,
    label: r.content.slice(0, 60) + (r.content.length > 60 ? "…" : ""),
    detail: `${r.event_type ?? "—"} · ${r.location_handle ?? "no account"}${r.is_headline ? ` · HEADLINE #${r.headline_rank ?? "?"}` : ""}`,
    collides: false,
  })),
  commit: async (rows, ctx) => {
    const created = await commitSocialPosts(rows, ctx);
    return created.length;
  },
  exportData: async () => {
    const { data } = await supabase
      .from("social_posts")
      .select("content,post_type,event_type,is_headline,headline_rank,scheduled_at")
      .order("posted_at", { ascending: false })
      .limit(100);
    return data ?? [];
  },
};

import {
  TeamImportSchema, RunImportSchema, ChallengeImportSchema, GemTaskImportSchema, DynamicDuoImportSchema,
  buildTeamPrompt, buildRunPrompt, buildChallengePrompt, buildGemTaskPrompt, buildDynamicDuoPrompt,
  commitTeams, commitRuns, commitChallenges, commitGemTasks, commitDynamicDuos,
} from "@/lib/chatgptSchemas";

export const TeamsExchange: ExchangeEntity<typeof TeamImportSchema> = {
  schema: TeamImportSchema,
  buildPrompt: buildTeamPrompt,
  toPreviewRows: (rows, ctx) => rows.map((r, i) => ({
    key: `team-${i}-${r.name}`,
    label: r.name,
    detail: `${r.category} · unlock ${r.unlock_cost}c · roster: ${r.roster?.length ?? 0}`,
    collides: flagCollision(r.name, ctx.existingTeamNames),
  })),
  commit: async (rows) => (await commitTeams(rows)).length,
  exportData: async () => (await supabase.from("teams").select("name,category,unlock_cost").order("name")).data ?? [],
};

export const RunsExchange: ExchangeEntity<typeof RunImportSchema> = {
  schema: RunImportSchema,
  buildPrompt: buildRunPrompt,
  toPreviewRows: (rows) => rows.map((r, i) => ({
    key: `run-${i}-${r.name}`,
    label: r.name,
    detail: `target ${r.target_score} · ${r.milestones?.length ?? 0} milestones · ${r.roster?.length ?? 0} opp.`,
    collides: false,
  })),
  commit: async (rows) => (await commitRuns(rows)).length,
  exportData: async () => (await supabase.from("runs").select("name,target_score,milestones").order("name")).data ?? [],
};

export const ChallengesExchange: ExchangeEntity<typeof ChallengeImportSchema> = {
  schema: ChallengeImportSchema,
  buildPrompt: buildChallengePrompt,
  toPreviewRows: (rows) => rows.map((r, i) => ({
    key: `chal-${i}-${r.name}`,
    label: r.name,
    detail: `${r.challenge_type} · ${r.win_condition} · ${r.coin_reward}c/${r.gem_reward}g${r.opponent_team_name ? ` · vs ${r.opponent_team_name}` : ""}`,
    collides: false,
  })),
  commit: async (rows) => (await commitChallenges(rows)).length,
  exportData: async () => (await supabase.from("challenges").select("name,challenge_type,win_condition,coin_reward,gem_reward,spotlight_group").order("sort_order")).data ?? [],
};

export const GemTasksExchange: ExchangeEntity<typeof GemTaskImportSchema> = {
  schema: GemTaskImportSchema,
  buildPrompt: buildGemTaskPrompt,
  toPreviewRows: (rows) => rows.map((r, i) => ({
    key: `gt-${i}-${r.title}`,
    label: r.title,
    detail: `${r.category} · ${r.gem_reward}💎 · cd ${r.cooldown_hours}h`,
    collides: false,
  })),
  commit: async (rows) => (await commitGemTasks(rows)).length,
  exportData: async () => (await supabase.from("gem_tasks").select("title,description,gem_reward,cooldown_hours,category,is_active").order("category")).data ?? [],
};

export const DynamicDuosExchange: ExchangeEntity<typeof DynamicDuoImportSchema> = {
  schema: DynamicDuoImportSchema,
  buildPrompt: buildDynamicDuoPrompt,
  toPreviewRows: (rows) => rows.map((r, i) => ({
    key: `duo-${i}-${r.name}`,
    label: r.name,
    detail: `${r.player_a_name} + ${r.player_b_name}`,
    collides: false,
  })),
  commit: async (rows) => (await commitDynamicDuos(rows)).length,
  exportData: async () => (await supabase.from("dynamic_duos").select("name,description,player_card_id_a,player_card_id_b,boosts_a,boosts_b,is_active").order("name")).data ?? [],
};
