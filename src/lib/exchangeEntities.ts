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
