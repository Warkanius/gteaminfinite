// Saved lineups: the only player-owned WRITE surface on the Insider API.
//
// Every write runs under the caller's RLS session, so a lineup can only ever be
// created, edited or deleted for the authenticated player. Card ownership and
// evo-version playability are additionally enforced by a database trigger, so
// even a direct API call cannot smuggle in another player's card.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { InsiderError } from "./errors.ts";
import { INSIDER_API_LIMITS, lineupModeRule } from "./rules.ts";
import { loadCollection, type OwnedCardView } from "./cards.ts";
import { evaluateLineup, type LineupContextRef } from "./legality.ts";

type Row = Record<string, any>;

export interface LineupSlotInput {
  slot?: number;
  owned_card_id?: string;
  player_card_id?: string;
  evo_card_version_id?: string | null;
}

const LINEUP_SELECT =
  "id, name, mode, is_default, notes, created_at, updated_at, " +
  "player_lineup_slots(id, slot, player_card_id, evo_card_version_id, display_order)";

async function ownedIndex(client: SupabaseClient, userId: string) {
  const { cards, ctx } = await loadCollection(client, userId, { detail: false, filters: { limit: 200, offset: 0 } });
  // loadCollection paginates; for lineup resolution we need everything.
  let all = cards;
  if (cards.length === INSIDER_API_LIMITS.max_collection_page_size) {
    const rest: OwnedCardView[] = [];
    let offset = INSIDER_API_LIMITS.max_collection_page_size;
    for (;;) {
      const page = await loadCollection(client, userId, { detail: false, filters: { limit: 200, offset } });
      rest.push(...page.cards);
      if (page.cards.length < 200 || offset + 200 >= page.total) break;
      offset += 200;
    }
    all = [...cards, ...rest];
  }
  return {
    ctx,
    byOwned: new Map(all.map((c) => [c.owned_card_id, c])),
    byCard: new Map(all.map((c) => [c.player_card_id, c])),
    all,
  };
}

/** Resolves loose slot input into concrete owned cards, reporting bad ids. */
export function resolveSlots(
  slots: LineupSlotInput[],
  index: { byOwned: Map<string, OwnedCardView>; byCard: Map<string, OwnedCardView> },
) {
  const resolved: Array<{ slot: number; card: OwnedCardView; evo_card_version_id: string | null }> = [];
  const unresolved: string[] = [];
  slots.forEach((s, i) => {
    const key = s.owned_card_id ?? s.player_card_id ?? "";
    const card = s.owned_card_id
      ? index.byOwned.get(s.owned_card_id)
      : s.player_card_id
        ? index.byCard.get(s.player_card_id)
        : undefined;
    if (!card) {
      unresolved.push(key || `slot_${i + 1}`);
      return;
    }
    resolved.push({
      slot: Number(s.slot ?? i + 1),
      card,
      evo_card_version_id: s.evo_card_version_id ?? card.playable_version_id ?? null,
    });
  });
  return { resolved, unresolved };
}

function lineupView(row: Row, index: Map<string, OwnedCardView>): Row {
  const slots = [...(row.player_lineup_slots ?? [])].sort((a: Row, b: Row) => a.slot - b.slot);
  return {
    lineup_id: row.id,
    name: row.name,
    mode: row.mode,
    is_default: row.is_default,
    notes: row.notes ?? null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    slot_count: slots.length,
    slots_required: lineupModeRule(row.mode).slots,
    slots: slots.map((s: Row) => {
      const card = index.get(s.player_card_id);
      return {
        slot_id: s.id,
        slot: s.slot,
        player_card_id: s.player_card_id,
        evo_card_version_id: s.evo_card_version_id ?? null,
        owned_card_id: card?.owned_card_id ?? null,
        name: card?.name ?? null,
        gem_tier: card?.gem_tier ?? null,
        rating: card?.rating ?? null,
        run_rating: card?.run_rating ?? null,
        position1: card?.position1 ?? null,
        position2: card?.position2 ?? null,
        still_owned: !!card,
      };
    }),
  };
}

export async function listLineups(client: SupabaseClient, userId: string, mode?: string) {
  let q = client.from("player_lineups").select(LINEUP_SELECT).eq("user_id", userId);
  if (mode) q = q.eq("mode", mode);
  const { data, error } = await q.order("is_default", { ascending: false }).order("updated_at", { ascending: false });
  if (error) throw new InsiderError("INTERNAL_ERROR", error.message);
  const index = await ownedIndex(client, userId);
  // Slots are stored by player_card_id, so hydration must use the by-card index.
  return { lineups: (data ?? []).map((r: Row) => lineupView(r, index.byCard)) };
}

export async function getLineup(
  client: SupabaseClient,
  userId: string,
  lineupId: string,
  ref: LineupContextRef = {},
) {
  const { data, error } = await client.from("player_lineups").select(LINEUP_SELECT).eq("user_id", userId).eq("id", lineupId).maybeSingle();
  if (error) throw new InsiderError("INTERNAL_ERROR", error.message);
  if (!data) throw new InsiderError("LINEUP_NOT_FOUND", `No lineup ${lineupId} for this player.`);
  const index = await ownedIndex(client, userId);
  const view = lineupView(data, index.byCard);

  const cards = (data.player_lineup_slots ?? [])
    .map((s: Row) => index.byCard.get(s.player_card_id))
    .filter(Boolean) as OwnedCardView[];
  const legality = await evaluateLineup(client, cards, { mode: data.mode, ...ref }, index.ctx.gemTiers, {
    unresolvedIds: (data.player_lineup_slots ?? [])
      .filter((s: Row) => !index.byCard.has(s.player_card_id))
      .map((s: Row) => s.player_card_id),
  });
  return { lineup: view, legality };
}

async function writeSlots(
  client: SupabaseClient,
  lineupId: string,
  resolved: Array<{ slot: number; card: OwnedCardView; evo_card_version_id: string | null }>,
) {
  const { error: delErr } = await client.from("player_lineup_slots").delete().eq("lineup_id", lineupId);
  if (delErr) throw new InsiderError("INTERNAL_ERROR", delErr.message);
  if (!resolved.length) return;
  const rows = resolved.map((r, i) => ({
    lineup_id: lineupId,
    slot: r.slot || i + 1,
    player_card_id: r.card.player_card_id,
    evo_card_version_id: r.evo_card_version_id,
    display_order: i,
  }));
  const { error } = await client.from("player_lineup_slots").insert(rows);
  if (error) throw new Error(error.message);
}

export async function createLineup(
  client: SupabaseClient,
  userId: string,
  input: { name: string; mode?: string; notes?: string; is_default?: boolean; slots?: LineupSlotInput[] },
) {
  const name = String(input.name ?? "").trim();
  if (!name) throw new InsiderError("VALIDATION_FAILED", "A lineup name is required.");
  const rule = lineupModeRule(input.mode);

  const { count } = await client.from("player_lineups").select("id", { count: "exact", head: true }).eq("user_id", userId);
  if ((count ?? 0) >= INSIDER_API_LIMITS.max_lineups_per_player) {
    throw new InsiderError("VALIDATION_FAILED", `Lineup limit reached (${INSIDER_API_LIMITS.max_lineups_per_player}).`);
  }

  const index = await ownedIndex(client, userId);
  const { resolved, unresolved } = resolveSlots(input.slots ?? [], index);
  if (unresolved.length) {
    throw new InsiderError("CARD_NOT_OWNED", "One or more cards are not in this player's collection.", 400, { unresolved });
  }
  if (resolved.length > rule.slots) {
    throw new InsiderError("INVALID_LINEUP", `${rule.label} lineups hold at most ${rule.slots} cards.`, 400, { provided: resolved.length });
  }

  const { data, error } = await client
    .from("player_lineups")
    .insert({ user_id: userId, name, mode: rule.mode, notes: input.notes ?? null })
    .select("id")
    .single();
  if (error) throw new InsiderError("INTERNAL_ERROR", error.message);

  try {
    await writeSlots(client, data.id, resolved);
  } catch (e) {
    await client.from("player_lineups").delete().eq("id", data.id);
    throw e;
  }
  if (input.is_default) await setDefaultLineup(client, userId, data.id);
  return await getLineup(client, userId, data.id);
}

export async function updateLineup(
  client: SupabaseClient,
  userId: string,
  lineupId: string,
  input: { name?: string; notes?: string; mode?: string; slots?: LineupSlotInput[]; is_default?: boolean },
) {
  const { data: existing, error: exErr } = await client
    .from("player_lineups").select("id, mode").eq("user_id", userId).eq("id", lineupId).maybeSingle();
  if (exErr) throw new InsiderError("INTERNAL_ERROR", exErr.message);
  if (!existing) throw new InsiderError("LINEUP_NOT_FOUND", `No lineup ${lineupId} for this player.`);

  const patch: Row = {};
  if (input.name !== undefined) {
    const n = String(input.name).trim();
    if (!n) throw new InsiderError("VALIDATION_FAILED", "A lineup name cannot be empty.");
    patch.name = n;
  }
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.mode !== undefined) patch.mode = lineupModeRule(input.mode).mode;
  if (Object.keys(patch).length) {
    const { error } = await client.from("player_lineups").update(patch).eq("id", lineupId).eq("user_id", userId);
    if (error) throw new InsiderError("INTERNAL_ERROR", error.message);
  }

  if (input.slots) {
    const rule = lineupModeRule(patch.mode ?? existing.mode);
    const index = await ownedIndex(client, userId);
    const { resolved, unresolved } = resolveSlots(input.slots, index);
    if (unresolved.length) {
      throw new InsiderError("CARD_NOT_OWNED", "One or more cards are not in this player's collection.", 400, { unresolved });
    }
    if (resolved.length > rule.slots) {
      throw new InsiderError("INVALID_LINEUP", `${rule.label} lineups hold at most ${rule.slots} cards.`, 400, { provided: resolved.length });
    }
    await writeSlots(client, lineupId, resolved);
  }
  if (input.is_default) await setDefaultLineup(client, userId, lineupId);
  return await getLineup(client, userId, lineupId);
}

export async function duplicateLineup(client: SupabaseClient, userId: string, lineupId: string, name?: string) {
  const { data, error } = await client.from("player_lineups").select(LINEUP_SELECT).eq("user_id", userId).eq("id", lineupId).maybeSingle();
  if (error) throw new InsiderError("INTERNAL_ERROR", error.message);
  if (!data) throw new InsiderError("LINEUP_NOT_FOUND", `No lineup ${lineupId} for this player.`);
  return await createLineup(client, userId, {
    name: (name ?? `${data.name} (copy)`).slice(0, 60),
    mode: data.mode,
    notes: data.notes ?? undefined,
    slots: (data.player_lineup_slots ?? []).map((s: Row) => ({
      slot: s.slot,
      player_card_id: s.player_card_id,
      evo_card_version_id: s.evo_card_version_id,
    })),
  });
}

export async function deleteLineup(client: SupabaseClient, userId: string, lineupId: string) {
  const { data, error } = await client.from("player_lineups").delete().eq("user_id", userId).eq("id", lineupId).select("id");
  if (error) throw new InsiderError("INTERNAL_ERROR", error.message);
  if (!data?.length) throw new InsiderError("LINEUP_NOT_FOUND", `No lineup ${lineupId} for this player.`);
  return { deleted: true, lineup_id: lineupId };
}

export async function setDefaultLineup(client: SupabaseClient, userId: string, lineupId: string) {
  const { data, error } = await client.rpc("set_default_lineup", { p_lineup_id: lineupId });
  if (error) {
    if (/LINEUP_NOT_FOUND/.test(error.message)) throw new InsiderError("LINEUP_NOT_FOUND", `No lineup ${lineupId} for this player.`);
    throw new InsiderError("INTERNAL_ERROR", error.message);
  }
  return data ?? { lineup_id: lineupId, is_default: true };
}

/** Validate a saved lineup or an ad-hoc proposal against a game context. */
export async function validateLineup(
  client: SupabaseClient,
  userId: string,
  input: { lineup_id?: string; cards?: LineupSlotInput[]; mode?: string; challenge_id?: string; domination_game_id?: string; run_id?: string },
) {
  const ref: LineupContextRef = {
    mode: input.mode,
    challenge_id: input.challenge_id,
    domination_game_id: input.domination_game_id,
    run_id: input.run_id,
  };
  if (input.lineup_id) {
    const res = await getLineup(client, userId, input.lineup_id, ref);
    return { lineup_id: input.lineup_id, ...res.legality };
  }
  const index = await ownedIndex(client, userId);
  const { resolved, unresolved } = resolveSlots(input.cards ?? [], index);
  const legality = await evaluateLineup(client, resolved.map((r) => r.card), ref, index.ctx.gemTiers, { unresolvedIds: unresolved });
  return { lineup_id: null, ...legality };
}

export { ownedIndex };
