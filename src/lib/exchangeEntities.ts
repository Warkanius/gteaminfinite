/**
 * Per-entity ExchangeEntity configurations: wires the schemas, prompt builders,
 * preview rows, and commit functions from chatgptSchemas.ts into the
 * <ChatGPTExchange/> component.
 *
 * Each entity may also declare an optional `update` block, enabling the
 * "Update existing" mode in the dialog (PATCH by natural key).
 */
import { supabase } from "@/integrations/supabase/client";
import type { ExchangeEntity } from "@/components/admin/ChatGPTExchange";
import {
  // Create
  PlayerImportSchema, LockerCodeImportSchema, SocialPostImportSchema,
  TeamImportSchema, RunImportSchema, ChallengeImportSchema, GemTaskImportSchema, DynamicDuoImportSchema,
  buildPlayerPrompt, buildLockerCodePrompt, buildSocialPostPrompt,
  buildTeamPrompt, buildRunPrompt, buildChallengePrompt, buildGemTaskPrompt, buildDynamicDuoPrompt,
  commitPlayers, commitLockerCodes, commitSocialPosts,
  commitTeams, commitRuns, commitChallenges, commitGemTasks, commitDynamicDuos,
  flagCollision, existsInList,
  // Update
  PlayerUpdateSchema, TeamUpdateSchema, RunUpdateSchema, ChallengeUpdateSchema,
  GemTaskUpdateSchema, DynamicDuoUpdateSchema, LockerCodeUpdateSchema,
  buildPlayerUpdatePrompt, buildTeamUpdatePrompt, buildRunUpdatePrompt, buildChallengeUpdatePrompt,
  buildGemTaskUpdatePrompt, buildDynamicDuoUpdatePrompt, buildLockerCodeUpdatePrompt,
  updatePlayers, updateTeams, updateRuns, updateChallenges, updateGemTasks, updateDynamicDuos, updateLockerCodes,
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
  commit: async (rows, ctx) => (await commitPlayers(rows, ctx)).length,
  exportData: async () => {
    const { data } = await supabase
      .from("player_cards")
      .select("name,position1,position2,rating,stat_3pt,stat_mid,stat_fin,stat_dnk,stat_ast,stat_stl,stat_reb,stat_blk,stat_int,social_handle")
      .order("name");
    return data ?? [];
  },
  update: {
    schema: PlayerUpdateSchema,
    buildPrompt: buildPlayerUpdatePrompt,
    toPreviewRows: (rows, ctx) => rows.map((r, i) => {
      const found = existsInList(r.name, ctx.existingPlayerNames);
      const changes = Object.entries(r).filter(([k, v]) => k !== "name" && v !== undefined);
      return {
        key: `pu-${i}-${r.name}`,
        label: r.name,
        detail: changes.length ? changes.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" · ") : "(no changes)",
        status: found ? "exists" : "missing",
      };
    }),
    commit: async (rows, ctx) => updatePlayers(rows, ctx),
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
  commit: async (rows) => (await commitLockerCodes(rows)).length,
  exportData: async () => (await supabase.from("locker_codes").select("*").order("created_at", { ascending: false })).data ?? [],
  update: {
    schema: LockerCodeUpdateSchema,
    buildPrompt: buildLockerCodeUpdatePrompt,
    toPreviewRows: (rows, ctx) => rows.map((r, i) => {
      const found = ctx.existingLockerCodes.includes(r.code.toUpperCase());
      const changes = Object.entries(r).filter(([k, v]) => k !== "code" && v !== undefined);
      return {
        key: `lcu-${i}-${r.code}`,
        label: r.code,
        detail: changes.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" · ") || "(no changes)",
        status: found ? "exists" : "missing",
      };
    }),
    commit: async (rows) => updateLockerCodes(rows),
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
  commit: async (rows, ctx) => (await commitSocialPosts(rows, ctx)).length,
  exportData: async () => (await supabase.from("social_posts").select("content,post_type,event_type,is_headline,headline_rank,scheduled_at").order("posted_at", { ascending: false }).limit(100)).data ?? [],
};

function changeDetail(r: Record<string, any>, keyField: string) {
  const changes = Object.entries(r).filter(([k, v]) => k !== keyField && v !== undefined);
  return changes.map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`).join(" · ") || "(no changes)";
}

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
  update: {
    schema: TeamUpdateSchema,
    buildPrompt: buildTeamUpdatePrompt,
    toPreviewRows: (rows, ctx) => rows.map((r, i) => ({
      key: `tu-${i}-${r.name}`,
      label: r.name,
      detail: changeDetail(r, "name"),
      status: existsInList(r.name, ctx.existingTeamNames) ? "exists" : "missing",
    })),
    commit: async (rows) => updateTeams(rows),
  },
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
  update: {
    schema: RunUpdateSchema,
    buildPrompt: buildRunUpdatePrompt,
    toPreviewRows: (rows, ctx) => rows.map((r, i) => ({
      key: `ru-${i}-${r.name}`,
      label: r.name,
      detail: changeDetail(r, "name"),
      status: existsInList(r.name, ctx.existingRunNames) ? "exists" : "missing",
    })),
    commit: async (rows) => updateRuns(rows),
  },
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
  update: {
    schema: ChallengeUpdateSchema,
    buildPrompt: buildChallengeUpdatePrompt,
    toPreviewRows: (rows, ctx) => rows.map((r, i) => ({
      key: `cu-${i}-${r.name}`,
      label: r.name,
      detail: changeDetail(r, "name"),
      status: existsInList(r.name, ctx.existingChallengeNames) ? "exists" : "missing",
    })),
    commit: async (rows) => updateChallenges(rows),
  },
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
  update: {
    schema: GemTaskUpdateSchema,
    buildPrompt: buildGemTaskUpdatePrompt,
    toPreviewRows: (rows, ctx) => rows.map((r, i) => ({
      key: `gtu-${i}-${r.title}`,
      label: r.title,
      detail: changeDetail(r, "title"),
      status: existsInList(r.title, ctx.existingGemTaskTitles) ? "exists" : "missing",
    })),
    commit: async (rows) => updateGemTasks(rows),
  },
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
  update: {
    schema: DynamicDuoUpdateSchema,
    buildPrompt: buildDynamicDuoUpdatePrompt,
    toPreviewRows: (rows, ctx) => rows.map((r, i) => ({
      key: `duu-${i}-${r.name}`,
      label: r.name,
      detail: changeDetail(r, "name"),
      status: existsInList(r.name, ctx.existingDuoNames) ? "exists" : "missing",
    })),
    commit: async (rows) => updateDynamicDuos(rows),
  },
};
