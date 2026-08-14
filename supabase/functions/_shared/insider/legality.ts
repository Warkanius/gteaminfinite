// Deterministic lineup legality engine.
//
// Restrictions are read from STRUCTURED data only (challenges.lineup_restrictions,
// mode roster rules, ownership). Prose is never interpreted. The same evaluation
// backs the in-game Lineups page and the Insider API so a lineup the GPT calls
// legal is exactly the lineup the game accepts.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { InsiderError } from "./errors.ts";
import { lineupModeRule, summarizeLineup } from "./rules.ts";
import type { OwnedCardView } from "./cards.ts";

type Row = Record<string, any>;

export interface LineupReason {
  code: string;
  message: string;
  detail?: Row;
}

export interface LineupContextRef {
  mode?: string | null;
  challenge_id?: string | null;
  domination_game_id?: string | null;
  run_id?: string | null;
}

export interface LegalityResult {
  legal: boolean;
  mode: string;
  slots_required: number;
  cards_provided: number;
  context: Row;
  restrictions: Row | null;
  reasons: LineupReason[];
  invalid_cards: Row[];
  eligible_card_ids: string[];
  summary: Row;
}

const COLOR_BUCKETS = [
  { name: "red", min: 345, max: 15 },
  { name: "orange", min: 15, max: 45 },
  { name: "gold", min: 45, max: 65 },
  { name: "yellow", min: 65, max: 80 },
  { name: "green", min: 80, max: 160 },
  { name: "teal", min: 160, max: 200 },
  { name: "blue", min: 200, max: 260 },
  { name: "purple", min: 260, max: 300 },
  { name: "pink", min: 300, max: 345 },
] as const;

export function hslToColorBucket(hsl: string | null | undefined): string | null {
  if (!hsl) return null;
  const nums = hsl.match(/[\d.]+/g);
  if (!nums || nums.length < 3) return null;
  const h = parseFloat(nums[0]), s = parseFloat(nums[1]), l = parseFloat(nums[2]);
  if (s < 15) return l > 60 ? "white" : "black";
  if (l < 15) return "black";
  if (l > 90) return "white";
  for (const b of COLOR_BUCKETS) {
    if (b.min > b.max) { if (h >= b.min || h < b.max) return b.name; }
    else if (h >= b.min && h < b.max) return b.name;
  }
  return "red";
}

/**
 * Resolves the game context (mode + structured restrictions) for a validation.
 * Domination games and Runs carry no per-game lineup restrictions today beyond
 * their roster shape; challenges carry lineup_restrictions.
 */
export async function resolveContext(client: SupabaseClient, ref: LineupContextRef) {
  if (ref.challenge_id) {
    const { data, error } = await client
      .from("challenges")
      .select("id, name, challenge_type, win_condition, win_by_amount, series_length, lineup_restrictions, conditions, opponent_team_id, coin_reward, gem_reward, status")
      .eq("id", ref.challenge_id)
      .maybeSingle();
    if (error) throw new InsiderError("INTERNAL_ERROR", error.message);
    if (!data) throw new InsiderError("GAME_NOT_FOUND", `No challenge with id ${ref.challenge_id}`);
    return {
      mode: "5v5",
      context: { type: "challenge", challenge_id: data.id, name: data.name, win_condition: data.win_condition },
      restrictions: (data.lineup_restrictions ?? null) as Row | null,
    };
  }
  if (ref.domination_game_id) {
    const { data, error } = await client
      .from("domination_games")
      .select("id, road_name, opponent_name, game_order, difficulty_stars, coin_reward, status")
      .eq("id", ref.domination_game_id)
      .maybeSingle();
    if (error) throw new InsiderError("INTERNAL_ERROR", error.message);
    if (!data) throw new InsiderError("GAME_NOT_FOUND", `No domination game with id ${ref.domination_game_id}`);
    return {
      mode: "5v5",
      context: {
        type: "domination",
        domination_game_id: data.id,
        road_name: data.road_name,
        opponent_name: data.opponent_name,
        game_order: data.game_order,
        difficulty_stars: data.difficulty_stars,
      },
      restrictions: null as Row | null,
    };
  }
  if (ref.run_id) {
    const { data, error } = await client
      .from("runs")
      .select("id, name, target_score, status")
      .eq("id", ref.run_id)
      .maybeSingle();
    if (error) throw new InsiderError("INTERNAL_ERROR", error.message);
    if (!data) throw new InsiderError("GAME_NOT_FOUND", `No run with id ${ref.run_id}`);
    return {
      mode: "runs",
      context: { type: "run", run_id: data.id, name: data.name, target_score: data.target_score },
      restrictions: null as Row | null,
    };
  }
  return {
    mode: ref.mode ?? "5v5",
    context: { type: "free", mode: ref.mode ?? "5v5" },
    restrictions: null as Row | null,
  };
}

/**
 * Evo-aware inherited-property lookup. An evolved card inherits its chain root's
 * collection / team / tier / colour for restriction checks, exactly like the
 * in-game selector.
 */
export async function buildRootResolver(client: SupabaseClient) {
  const { data } = await client
    .from("evo_paths")
    .select("player_card_id, evolves_to_card_id")
    .not("evolves_to_card_id", "is", null);
  const parentOf = new Map<string, string>();
  for (const l of (data ?? []) as Row[]) {
    if (l.player_card_id && l.evolves_to_card_id && l.player_card_id !== l.evolves_to_card_id) {
      parentOf.set(l.evolves_to_card_id, l.player_card_id);
    }
  }
  const rootOf = (id: string) => {
    let cur = id;
    const seen = new Set([cur]);
    while (parentOf.has(cur)) {
      const next = parentOf.get(cur)!;
      if (seen.has(next)) break;
      seen.add(next);
      cur = next;
    }
    return cur;
  };
  const cache = new Map<string, Row>();
  const propertiesFor = async (cardIds: string[]) => {
    const roots = Array.from(new Set(cardIds.map(rootOf))).filter((id) => !cache.has(id));
    if (roots.length) {
      const { data: rows } = await client
        .from("player_cards")
        .select("id, gem_tier_id, team_id, collection_id, sub_collection_id, card_color_primary")
        .in("id", roots);
      for (const r of (rows ?? []) as Row[]) cache.set(r.id, r);
    }
    const out = new Map<string, Row>();
    for (const id of cardIds) out.set(id, cache.get(rootOf(id)) ?? {});
    return out;
  };
  return { rootOf, propertiesFor };
}

function cardEligibility(
  card: OwnedCardView,
  restrictions: Row | null,
  rootProps: Row,
  gemTiers: Row[],
): { eligible: boolean; failed: string[] } {
  if (!restrictions) return { eligible: true, failed: [] };
  const checks: Array<{ key: string; pass: boolean }> = [];

  const positions = restrictions.positions as string[] | undefined;
  if (positions?.length) {
    const mine = [card.position1, card.position2].filter(Boolean).map((p) => String(p).toUpperCase());
    checks.push({ key: "positions", pass: positions.some((p) => mine.includes(String(p).toUpperCase())) });
  }
  const tierIds = restrictions.gem_tier_ids as string[] | undefined;
  if (tierIds?.length) {
    checks.push({ key: "gem_tier_ids", pass: !!rootProps.gem_tier_id && tierIds.includes(rootProps.gem_tier_id) });
  }
  const tierNames = restrictions.gem_tiers as string[] | undefined;
  if (tierNames?.length && !tierIds?.length) {
    const want = tierNames.map((t) => String(t).toLowerCase());
    const rootTier = gemTiers.find((t) => t.id === rootProps.gem_tier_id)?.name ?? card.gem_tier;
    checks.push({ key: "gem_tiers", pass: want.includes(String(rootTier ?? "").toLowerCase()) });
  }
  const teamIds = restrictions.team_ids as string[] | undefined;
  if (teamIds?.length) checks.push({ key: "team_ids", pass: !!rootProps.team_id && teamIds.includes(rootProps.team_id) });

  const colIds = restrictions.collection_ids as string[] | undefined;
  if (colIds?.length) checks.push({ key: "collection_ids", pass: !!rootProps.collection_id && colIds.includes(rootProps.collection_id) });

  const subIds = restrictions.sub_collection_ids as string[] | undefined;
  if (subIds?.length) checks.push({ key: "sub_collection_ids", pass: !!rootProps.sub_collection_id && subIds.includes(rootProps.sub_collection_id) });

  const colors = restrictions.card_colors as string[] | undefined;
  if (colors?.length) {
    const bucket = hslToColorBucket(rootProps.card_color_primary);
    checks.push({ key: "card_colors", pass: !!bucket && colors.includes(bucket) });
  }
  const badgeIds = restrictions.badge_ids as string[] | undefined;
  if (badgeIds?.length) {
    const mine = (card.badges as Row[]).map((b) => b.badge_id);
    checks.push({ key: "badge_ids", pass: badgeIds.some((b) => mine.includes(b)) });
  }
  const traitIds = restrictions.trait_ids as string[] | undefined;
  if (traitIds?.length) {
    const mine = (card.traits as Row[]).map((t) => t.trait_id);
    checks.push({ key: "trait_ids", pass: traitIds.some((t) => mine.includes(t)) });
  }

  if (!checks.length) return { eligible: true, failed: [] };
  // OR semantics across populated categories — mirrors the in-game selector.
  const eligible = checks.some((c) => c.pass);
  return { eligible, failed: eligible ? [] : checks.map((c) => c.key) };
}

/**
 * Filters an owned collection down to the cards eligible for a game context.
 * Excluded cards carry the structured restriction categories they failed.
 */
export async function eligibleCards(
  client: SupabaseClient,
  cards: OwnedCardView[],
  restrictions: Row | null,
  gemTiers: Row[],
): Promise<{ eligible: OwnedCardView[]; excluded: Row[] }> {
  const resolver = await buildRootResolver(client);
  const props = await resolver.propertiesFor(cards.map((c) => c.player_card_id));
  const eligible: OwnedCardView[] = [];
  const excluded: Row[] = [];
  for (const c of cards) {
    const res = cardEligibility(c, restrictions, props.get(c.player_card_id) ?? {}, gemTiers);
    if (res.eligible) eligible.push(c);
    else excluded.push({ owned_card_id: c.owned_card_id, name: c.name, gem_tier: c.gem_tier, reason: "CARD_NOT_ELIGIBLE", failed_restrictions: res.failed });
  }
  return { eligible, excluded };
}

/**
 * The single legality decision. `cards` must already be resolved owned-card
 * views for the authenticated player (ownership is proven by construction; an
 * unresolved id is reported as CARD_NOT_OWNED by the caller).
 */
export async function evaluateLineup(
  client: SupabaseClient,
  cards: OwnedCardView[],
  ref: LineupContextRef,
  gemTiers: Row[],
  opts: { unresolvedIds?: string[] } = {},
): Promise<LegalityResult> {
  const resolved = await resolveContext(client, ref);
  const rule = lineupModeRule(resolved.mode);
  const reasons: LineupReason[] = [];
  const invalid: Row[] = [];

  for (const id of opts.unresolvedIds ?? []) {
    invalid.push({ id, reason: "CARD_NOT_OWNED" });
    reasons.push({ code: "card_not_owned", message: `Card ${id} is not in this player's collection.`, detail: { id } });
  }

  if (cards.length + (opts.unresolvedIds?.length ?? 0) !== rule.slots) {
    reasons.push({
      code: "roster_size_incorrect",
      message: `${rule.label} lineups require exactly ${rule.slots} cards; ${cards.length + (opts.unresolvedIds?.length ?? 0)} provided.`,
      detail: { required: rule.slots, provided: cards.length + (opts.unresolvedIds?.length ?? 0) },
    });
  }

  if (!rule.allow_duplicate_players) {
    const seen = new Set<string>();
    for (const c of cards) {
      if (seen.has(c.player_card_id)) {
        invalid.push({ owned_card_id: c.owned_card_id, name: c.name, reason: "DUPLICATE" });
        reasons.push({ code: "duplicate_player_not_allowed", message: `${c.name} appears more than once.`, detail: { player_card_id: c.player_card_id } });
      }
      seen.add(c.player_card_id);
    }
  }

  const { eligible, excluded } = await eligibleCards(client, cards, resolved.restrictions, gemTiers);
  for (const ex of excluded) {
    invalid.push(ex);
    reasons.push({
      code: "card_not_eligible",
      message: `${ex.name} does not satisfy this game's lineup restrictions (${(ex.failed_restrictions ?? []).join(", ")}).`,
      detail: ex,
    });
  }

  // Hard requirements (optional, additive structured keys).
  const r = resolved.restrictions ?? {};
  const requiredCards = (r.required_player_card_ids ?? []) as string[];
  for (const need of requiredCards) {
    if (!cards.some((c) => c.player_card_id === need)) {
      reasons.push({ code: "missing_required_card", message: `This game requires card ${need} in the lineup.`, detail: { player_card_id: need } });
    }
  }
  const requiredPositions = (r.required_positions ?? []) as string[];
  for (const pos of requiredPositions) {
    const has = cards.some((c) => [c.position1, c.position2].some((p) => String(p ?? "").toUpperCase() === pos.toUpperCase()));
    if (!has) reasons.push({ code: `missing_${pos.toLowerCase()}`, message: `No card in the lineup can play ${pos}.`, detail: { position: pos } });
  }
  if (r.min_gem_tier) {
    const min = gemTiers.find((t) => String(t.name).toLowerCase() === String(r.min_gem_tier).toLowerCase());
    if (min) {
      for (const c of cards) {
        if (Number(c.gem_tier_sort_order ?? -1) < Number(min.sort_order)) {
          reasons.push({ code: "gem_tier_below_minimum", message: `${c.name} is below the minimum ${min.name} tier.`, detail: { owned_card_id: c.owned_card_id } });
        }
      }
    }
  }
  if (r.min_eligible_count && eligible.length < Number(r.min_eligible_count)) {
    reasons.push({
      code: "insufficient_eligible_cards",
      message: `Only ${eligible.length} eligible cards present; ${r.min_eligible_count} required.`,
      detail: { eligible: eligible.length, required: Number(r.min_eligible_count) },
    });
  }

  return {
    legal: reasons.length === 0,
    mode: rule.mode,
    slots_required: rule.slots,
    cards_provided: cards.length,
    context: resolved.context,
    restrictions: resolved.restrictions,
    reasons,
    invalid_cards: invalid,
    eligible_card_ids: eligible.map((c) => c.owned_card_id),
    summary: summarizeLineup(
      cards.map((c) => ({
        ...(c.attributes as Row),
        ...(c.run_attributes as Row),
        rating: c.rating,
        run_rating: c.run_rating,
        position1: c.position1,
        position2: c.position2,
      })),
      rule.scale,
    ),
  };
}
