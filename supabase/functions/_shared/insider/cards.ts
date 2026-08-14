// Player-facing card reads: the authenticated player's owned playable cards,
// their exact evo versions, badges, traits, EVO progress and factual deltas.
//
// Ownership lives in public.user_collections (user_id, player_card_id,
// active_evo_version_id). A card's *playable* form is either the base
// player_cards row or a materialized public.evo_card_versions row, and the two
// are never flattened together: an owned card view always reports both.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { InsiderError } from "./errors.ts";
import { ATTRIBUTE_GROUPS, BASE_STAT_KEYS, INSIDER_API_LIMITS, RUN_STAT_KEYS, round2 } from "./rules.ts";

type Row = Record<string, any>;

const CARD_COLUMNS =
  "id, name, gem_tier_id, gem_name, team_id, position1, position2, rating, run_rating, " +
  BASE_STAT_KEYS.join(", ") + ", " + RUN_STAT_KEYS.join(", ") +
  ", collection_id, sub_collection_id, card_key, card_variant, evo_stage, base_card_id, status, avatar_url, market_value";

const VERSION_COLUMNS =
  "id, evo_path_id, base_player_card_id, version_order, gem_tier_id, gem_name, rating, run_rating, position1, position2, status, " +
  BASE_STAT_KEYS.join(", ") + ", " + RUN_STAT_KEYS.join(", ");

export interface CollectionFilters {
  position?: string;
  gem_tier?: string;
  gem_tier_id?: string;
  min_rating?: number;
  max_rating?: number;
  min_run_rating?: number;
  badge?: string;
  badge_tier?: string;
  trait?: string;
  stat_key?: string;
  min_stat?: number;
  evo_active?: boolean;
  evo_completed?: boolean;
  evo_destination_tier?: string;
  collection?: string;
  favorite?: boolean;
  grinding?: boolean;
  core_player?: boolean;
  name?: string;
  limit?: number;
  offset?: number;
}

export interface CollectionContext {
  gemTiers: Row[];
  badges: Row[];
  traits: Row[];
  collections: Row[];
}

/** Reference data every card view needs. Cheap and cacheable per request. */
export async function loadContext(client: SupabaseClient): Promise<CollectionContext> {
  const [tiers, badges, traits, collections] = await Promise.all([
    client.from("gem_tiers").select("id, name, abbreviation, stars, sort_order, rating_min, rating_max, max_badges, max_traits, color").order("sort_order"),
    client.from("badges").select("id, name, abbreviation, category, effect_type, affected_stat, supported_tiers").order("name"),
    client.from("signature_traits").select("id, name, abbreviation, category, condition_type, requires_target_stat, supported_tiers").order("name"),
    client.from("collections").select("id, name, reward_type").order("name"),
  ]);
  return {
    gemTiers: tiers.data ?? [],
    badges: badges.data ?? [],
    traits: traits.data ?? [],
    collections: collections.data ?? [],
  };
}

/** Raw owned rows for the authenticated player. RLS already scopes these. */
async function loadOwnedRows(client: SupabaseClient, userId: string): Promise<Row[]> {
  const { data, error } = await client
    .from("user_collections")
    .select(`id, player_card_id, acquired_at, is_locked, source, active_evo_version_id, player_cards(${CARD_COLUMNS})`)
    .eq("user_id", userId);
  if (error) throw new InsiderError("INTERNAL_ERROR", error.message);
  return (data ?? []).filter((r: Row) => r.player_cards);
}

async function loadAssignments(client: SupabaseClient, cardIds: string[], versionIds: string[]) {
  const [cb, ct, vb, vt] = await Promise.all([
    cardIds.length
      ? client.from("player_card_badges").select("player_card_id, badge_id, tier").in("player_card_id", cardIds)
      : Promise.resolve({ data: [] as Row[] }),
    cardIds.length
      ? client.from("player_card_traits").select("player_card_id, trait_id, tier, target_stat").in("player_card_id", cardIds)
      : Promise.resolve({ data: [] as Row[] }),
    versionIds.length
      ? client.from("evo_card_version_badges").select("evo_card_version_id, badge_id, tier").in("evo_card_version_id", versionIds)
      : Promise.resolve({ data: [] as Row[] }),
    versionIds.length
      ? client.from("evo_card_version_traits").select("evo_card_version_id, trait_id, tier, target_stat").in("evo_card_version_id", versionIds)
      : Promise.resolve({ data: [] as Row[] }),
  ]);
  return {
    cardBadges: cb.data ?? [],
    cardTraits: ct.data ?? [],
    versionBadges: vb.data ?? [],
    versionTraits: vt.data ?? [],
  };
}

/** All playable evo versions plus path/progress rows for a set of base cards. */
async function loadEvoData(client: SupabaseClient, userId: string, cardIds: string[]) {
  if (!cardIds.length) return { paths: [] as Row[], versions: [] as Row[], objectives: [] as Row[], progress: [] as Row[] };
  const [paths, progress] = await Promise.all([
    client.from("evo_paths")
      .select("id, player_card_id, from_tier_id, to_tier_id, step_order, challenge_description, challenge_type, challenge_target, challenge_stat, compound_challenges, objectives, objective_mode, evolves_to_card_id, evolves_to_version_id, status, final_rating, is_repeatable")
      .in("player_card_id", cardIds)
      .order("step_order"),
    client.from("user_evo_progress")
      .select("id, player_card_id, evo_path_id, current_value, completed, completed_at, claimed, compound_progress")
      .eq("user_id", userId)
      .in("player_card_id", cardIds),
  ]);
  const pathIds = (paths.data ?? []).map((p: Row) => p.id);
  const [versions, objectives] = await Promise.all([
    pathIds.length
      ? client.from("evo_card_versions").select(VERSION_COLUMNS).in("evo_path_id", pathIds).order("version_order")
      : Promise.resolve({ data: [] as Row[] }),
    pathIds.length
      ? client.from("evo_objectives").select("id, evo_path_id, group_key, objective_type, stat_key, scope, target, description, sort_order").in("evo_path_id", pathIds).order("sort_order")
      : Promise.resolve({ data: [] as Row[] }),
  ]);
  return {
    paths: paths.data ?? [],
    versions: (versions.data ?? []).filter((v: Row) => v.status === "active"),
    objectives: objectives.data ?? [],
    progress: progress.data ?? [],
  };
}

function statBlock(row: Row, keys: readonly string[]): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const k of keys) {
    const v = row[k];
    out[k] = v === null || v === undefined ? null : Number(v);
  }
  return out;
}

function assignmentView(rows: Row[], catalog: Row[], idKey: string) {
  const byId = new Map(catalog.map((c) => [c.id, c]));
  return rows.map((r) => {
    const meta = byId.get(r[idKey]) ?? {};
    return {
      [idKey]: r[idKey],
      name: meta.name ?? null,
      abbreviation: meta.abbreviation ?? null,
      tier: r.tier ?? "base",
      category: meta.category ?? null,
      effect_type: meta.effect_type ?? null,
      affected_stat: meta.affected_stat ?? null,
      condition_type: meta.condition_type ?? null,
      target_stat: r.target_stat ?? null,
    };
  });
}

/**
 * Structured objectives for one evo step, in the canonical shape progression is
 * actually stored against: a compound step tracks each requirement by index in
 * user_evo_progress.compound_progress; a single step tracks current_value.
 */
export function stepObjectives(path: Row, progressRow: Row | undefined, normalized: Row[]) {
  const compounds: Row[] = Array.isArray(path.compound_challenges) ? path.compound_challenges : [];
  const compoundProgress: Record<string, number> = (progressRow?.compound_progress ?? {}) as Record<string, number>;

  if (compounds.length) {
    return compounds.map((req, i) => {
      const current = Number(compoundProgress[String(i)] ?? 0);
      const target = Number(req.target ?? 0);
      return {
        objective_index: i,
        objective_id: normalized[i]?.id ?? null,
        objective_type: req.type ?? null,
        stat_key: req.stat ?? null,
        description: req.description ?? normalized[i]?.description ?? null,
        target,
        current_value: current,
        completed: target > 0 ? current >= target : false,
        completion_pct: target > 0 ? round2(Math.min(100, (current / target) * 100)) : 0,
      };
    });
  }

  const target = Number(path.challenge_target ?? 0);
  const current = Number(progressRow?.current_value ?? 0);
  return [
    {
      objective_index: 0,
      objective_id: normalized[0]?.id ?? null,
      objective_type: path.challenge_type ?? null,
      stat_key: path.challenge_stat ?? null,
      description: path.challenge_description ?? normalized[0]?.description ?? null,
      target,
      current_value: current,
      completed: !!progressRow?.completed || (target > 0 && current >= target),
      completion_pct: target > 0 ? round2(Math.min(100, (current / target) * 100)) : 0,
    },
  ];
}

export interface OwnedCardView {
  owned_card_id: string;
  player_card_id: string;
  playable_version_id: string | null;
  name: string;
  [k: string]: unknown;
}

/**
 * The single builder for every owned-card payload. `detail` adds EVO chains and
 * per-objective progress; the compact form stays small enough to page through a
 * large collection inside a Custom GPT.
 */
export function buildOwnedCardView(
  owned: Row,
  ctx: CollectionContext,
  a: { cardBadges: Row[]; cardTraits: Row[]; versionBadges: Row[]; versionTraits: Row[] },
  evo: { paths: Row[]; versions: Row[]; objectives: Row[]; progress: Row[] },
  prefs: Row | undefined,
  detail: boolean,
): OwnedCardView {
  const base: Row = owned.player_cards;
  const versionId: string | null = owned.active_evo_version_id ?? null;
  const version = versionId ? evo.versions.find((v) => v.id === versionId) ?? null : null;

  const tierId = version?.gem_tier_id ?? base.gem_tier_id;
  const tier = ctx.gemTiers.find((t) => t.id === tierId) ?? null;

  const badgeRows = version
    ? a.versionBadges.filter((r) => r.evo_card_version_id === version.id)
    : a.cardBadges.filter((r) => r.player_card_id === base.id);
  const traitRows = version
    ? a.versionTraits.filter((r) => r.evo_card_version_id === version.id)
    : a.cardTraits.filter((r) => r.player_card_id === base.id);

  const paths = evo.paths.filter((p) => p.player_card_id === base.id).sort((x, y) => (x.step_order ?? 0) - (y.step_order ?? 0));
  const progressByPath = new Map(evo.progress.map((p) => [p.evo_path_id, p]));
  const activeStep = paths.find((p) => !progressByPath.get(p.id)?.completed) ?? null;
  const completedSteps = paths.filter((p) => progressByPath.get(p.id)?.completed).length;

  const nextVersion = activeStep
    ? evo.versions.find((v) => v.id === activeStep.evolves_to_version_id) ??
      evo.versions.find((v) => v.evo_path_id === activeStep.id) ?? null
    : null;
  const finalPath = paths.length ? paths[paths.length - 1] : null;
  const finalVersion = finalPath
    ? evo.versions.find((v) => v.id === finalPath.evolves_to_version_id) ??
      [...evo.versions].filter((v) => v.evo_path_id === finalPath.id).pop() ?? null
    : null;

  const statSource: Row = version ?? base;

  const view: OwnedCardView = {
    owned_card_id: owned.id,
    player_card_id: base.id,
    playable_version_id: version?.id ?? null,
    playable_form: version ? "evo_card_version" : "player_card",
    name: base.name,
    card_key: base.card_key ?? null,
    gem_tier_id: tierId ?? null,
    gem_tier: tier?.name ?? version?.gem_name ?? base.gem_name ?? null,
    gem_tier_stars: tier?.stars ?? null,
    gem_tier_sort_order: tier?.sort_order ?? null,
    position1: statSource.position1 ?? base.position1 ?? null,
    position2: statSource.position2 ?? base.position2 ?? null,
    rating: statSource.rating === null || statSource.rating === undefined ? null : Number(statSource.rating),
    run_rating: statSource.run_rating === null || statSource.run_rating === undefined ? null : Number(statSource.run_rating),
    attributes: statBlock(statSource, BASE_STAT_KEYS),
    run_attributes: statBlock(statSource, RUN_STAT_KEYS),
    badges: assignmentView(badgeRows, ctx.badges, "badge_id"),
    traits: assignmentView(traitRows, ctx.traits, "trait_id"),
    badge_count: badgeRows.length,
    collection_id: base.collection_id ?? null,
    collection: ctx.collections.find((c) => c.id === base.collection_id)?.name ?? null,
    sub_collection_id: base.sub_collection_id ?? null,
    team_id: base.team_id ?? null,
    evo_stage: base.evo_stage ?? null,
    is_locked: !!owned.is_locked,
    acquired_at: owned.acquired_at ?? null,
    source: owned.source ?? null,
    avatar_url: base.avatar_url ?? null,
    preferences: prefs
      ? {
          favorite: !!prefs.favorite,
          grinding: !!prefs.grinding,
          core_player: !!prefs.core_player,
          do_not_recommend: !!prefs.do_not_recommend,
          evo_priority: prefs.evo_priority ?? null,
          notes: prefs.notes ?? null,
        }
      : null,
    evo: {
      has_evo_path: paths.length > 0,
      total_steps: paths.length,
      completed_steps: completedSteps,
      fully_evolved: paths.length > 0 && completedSteps === paths.length,
      active_step_id: activeStep?.id ?? null,
      active_step_order: activeStep?.step_order ?? null,
      next_version_id: nextVersion?.id ?? null,
      next_version_tier: nextVersion?.gem_name ?? null,
      final_version_id: finalVersion?.id ?? null,
      final_version_tier: finalVersion?.gem_name ?? null,
    },
  };

  if (detail) {
    const normalizedFor = (pathId: string) => evo.objectives.filter((o) => o.evo_path_id === pathId);
    (view.evo as Row).steps = paths.map((p) => {
      const prog = progressByPath.get(p.id);
      const objectives = stepObjectives(p, prog, normalizedFor(p.id));
      const target = evo.versions.find((v) => v.id === p.evolves_to_version_id) ??
        evo.versions.find((v) => v.evo_path_id === p.id) ?? null;
      const done = objectives.filter((o) => o.completed).length;
      return {
        evo_step_id: p.id,
        step_order: p.step_order,
        status: p.status,
        objective_mode: p.objective_mode ?? (Array.isArray(p.compound_challenges) && p.compound_challenges.length ? "compound" : "single"),
        completed: !!prog?.completed,
        claimed: !!prog?.claimed,
        stage_completion_pct: objectives.length
          ? round2(objectives.reduce((s, o) => s + o.completion_pct, 0) / objectives.length)
          : 0,
        objectives_completed: done,
        objectives_total: objectives.length,
        objectives,
        from_gem_tier: ctx.gemTiers.find((t) => t.id === p.from_tier_id)?.name ?? null,
        to_gem_tier: ctx.gemTiers.find((t) => t.id === p.to_tier_id)?.name ?? null,
        target_version_id: target?.id ?? null,
        target_player_card_id: p.evolves_to_card_id ?? null,
        target_rating: target?.rating ?? p.final_rating ?? null,
      };
    });
    (view.evo as Row).playable_versions = evo.versions
      .filter((v) => paths.some((p) => p.id === v.evo_path_id))
      .map((v) => ({
        evo_card_version_id: v.id,
        evo_step_id: v.evo_path_id,
        version_order: v.version_order,
        gem_tier: v.gem_name ?? ctx.gemTiers.find((t) => t.id === v.gem_tier_id)?.name ?? null,
        rating: v.rating === null ? null : Number(v.rating),
        run_rating: v.run_rating === null ? null : Number(v.run_rating),
        position1: v.position1 ?? null,
        position2: v.position2 ?? null,
        attributes: statBlock(v, BASE_STAT_KEYS),
        run_attributes: statBlock(v, RUN_STAT_KEYS),
        badges: assignmentView(a.versionBadges.filter((r) => r.evo_card_version_id === v.id), ctx.badges, "badge_id"),
        traits: assignmentView(a.versionTraits.filter((r) => r.evo_card_version_id === v.id), ctx.traits, "trait_id"),
      }));
  }

  return view;
}

/** Fully-hydrated owned collection for the authenticated player. */
export async function loadCollection(
  client: SupabaseClient,
  userId: string,
  opts: { detail?: boolean; filters?: CollectionFilters } = {},
): Promise<{ cards: OwnedCardView[]; total: number; ctx: CollectionContext }> {
  const ctx = await loadContext(client);
  const owned = await loadOwnedRows(client, userId);
  const cardIds = owned.map((o) => o.player_card_id);
  const versionIds = owned.map((o) => o.active_evo_version_id).filter(Boolean) as string[];

  const evo = await loadEvoData(client, userId, cardIds);
  const allVersionIds = Array.from(new Set([...versionIds, ...evo.versions.map((v) => v.id)]));
  const assignments = await loadAssignments(client, cardIds, allVersionIds);
  const { data: prefRows } = await client
    .from("player_card_preferences")
    .select("player_card_id, favorite, grinding, core_player, do_not_recommend, evo_priority, notes")
    .eq("user_id", userId);
  const prefByCard = new Map((prefRows ?? []).map((p: Row) => [p.player_card_id, p]));

  let cards = owned.map((o) =>
    buildOwnedCardView(o, ctx, assignments, evo, prefByCard.get(o.player_card_id), !!opts.detail),
  );

  cards = applyFilters(cards, opts.filters ?? {}, ctx);
  const total = cards.length;
  const offset = Math.max(0, Number(opts.filters?.offset ?? 0));
  const limit = Math.min(
    INSIDER_API_LIMITS.max_collection_page_size,
    Math.max(1, Number(opts.filters?.limit ?? INSIDER_API_LIMITS.default_collection_page_size)),
  );
  cards = cards
    .sort((a, b) => Number(b.rating ?? 0) - Number(a.rating ?? 0) || String(a.name).localeCompare(String(b.name)))
    .slice(offset, offset + limit);

  return { cards, total, ctx };
}

export function applyFilters(cards: OwnedCardView[], f: CollectionFilters, ctx: CollectionContext): OwnedCardView[] {
  return cards.filter((c) => {
    const evo = c.evo as Row;
    if (f.position) {
      const p = f.position.toUpperCase();
      if (String(c.position1 ?? "").toUpperCase() !== p && String(c.position2 ?? "").toUpperCase() !== p) return false;
    }
    if (f.gem_tier_id && c.gem_tier_id !== f.gem_tier_id) return false;
    if (f.gem_tier && String(c.gem_tier ?? "").toLowerCase() !== f.gem_tier.toLowerCase()) return false;
    if (f.min_rating != null && Number(c.rating ?? 0) < Number(f.min_rating)) return false;
    if (f.max_rating != null && Number(c.rating ?? 0) > Number(f.max_rating)) return false;
    if (f.min_run_rating != null && Number(c.run_rating ?? 0) < Number(f.min_run_rating)) return false;
    if (f.name && !String(c.name).toLowerCase().includes(f.name.toLowerCase())) return false;
    if (f.badge) {
      const want = f.badge.toLowerCase();
      const hit = (c.badges as Row[]).find(
        (b) => String(b.name ?? "").toLowerCase() === want || String(b.abbreviation ?? "").toLowerCase() === want,
      );
      if (!hit) return false;
      if (f.badge_tier && String(hit.tier).toLowerCase() !== f.badge_tier.toLowerCase()) return false;
    } else if (f.badge_tier) {
      if (!(c.badges as Row[]).some((b) => String(b.tier).toLowerCase() === f.badge_tier!.toLowerCase())) return false;
    }
    if (f.trait) {
      const want = f.trait.toLowerCase();
      if (!(c.traits as Row[]).some(
        (t) => String(t.name ?? "").toLowerCase() === want || String(t.abbreviation ?? "").toLowerCase() === want,
      )) return false;
    }
    if (f.stat_key && f.min_stat != null) {
      const v = (c.attributes as Record<string, number | null>)[f.stat_key] ??
        (c.run_attributes as Record<string, number | null>)[f.stat_key];
      if (v == null || v < Number(f.min_stat)) return false;
    }
    if (f.evo_active === true && !evo.active_step_id) return false;
    if (f.evo_active === false && evo.active_step_id) return false;
    if (f.evo_completed === true && !evo.fully_evolved) return false;
    if (f.evo_completed === false && evo.fully_evolved) return false;
    if (f.evo_destination_tier) {
      const want = f.evo_destination_tier.toLowerCase();
      const tiers = [evo.next_version_tier, evo.final_version_tier].map((t) => String(t ?? "").toLowerCase());
      if (!tiers.includes(want)) return false;
    }
    if (f.collection) {
      const want = f.collection.toLowerCase();
      const byName = String(c.collection ?? "").toLowerCase() === want;
      const byId = c.collection_id === f.collection;
      if (!byName && !byId) return false;
    }
    if (f.favorite && !(c.preferences as Row)?.favorite) return false;
    if (f.grinding && !(c.preferences as Row)?.grinding) return false;
    if (f.core_player && !(c.preferences as Row)?.core_player) return false;
    return true;
  });
}

/** Compact whole-collection summary for broad questions. */
export function summarizeCollection(cards: OwnedCardView[]): Record<string, unknown> {
  const byTier: Record<string, number> = {};
  const byPosition: Record<string, number> = {};
  const traitCounts: Record<string, number> = {};
  let activeEvos = 0;
  let completedEvos = 0;
  const closeToEvolving: Row[] = [];

  for (const c of cards) {
    const tier = String(c.gem_tier ?? "Unknown");
    byTier[tier] = (byTier[tier] ?? 0) + 1;
    for (const p of [c.position1, c.position2]) {
      if (typeof p === "string" && p) byPosition[p] = (byPosition[p] ?? 0) + 1;
    }
    for (const t of c.traits as Row[]) {
      const key = `${t.name} (${t.tier})`;
      traitCounts[key] = (traitCounts[key] ?? 0) + 1;
    }
    const evo = c.evo as Row;
    if (evo.active_step_id) activeEvos++;
    if (evo.fully_evolved) completedEvos++;
  }

  const rank = (key: "rating" | "run_rating") =>
    [...cards]
      .filter((c) => c[key] != null)
      .sort((a, b) => Number(b[key]) - Number(a[key]))
      .slice(0, 10)
      .map((c) => ({ owned_card_id: c.owned_card_id, name: c.name, gem_tier: c.gem_tier, [key]: c[key] }));

  return {
    total_playable_cards: cards.length,
    count_by_gem_tier: byTier,
    count_by_position: byPosition,
    active_evo_count: activeEvos,
    completed_evo_count: completedEvos,
    cards_close_to_evolving: closeToEvolving,
    highest_rated: rank("rating"),
    highest_run_rated: rank("run_rating"),
    badge_heavy_cards: [...cards]
      .sort((a, b) => Number(b.badge_count ?? 0) - Number(a.badge_count ?? 0))
      .slice(0, 10)
      .map((c) => ({ owned_card_id: c.owned_card_id, name: c.name, gem_tier: c.gem_tier, badge_count: c.badge_count })),
    trait_distribution: traitCounts,
    position_depth: byPosition,
  };
}

/** Attach "close to evolving" using detailed step progress. */
export function closeToEvolving(cards: OwnedCardView[], threshold = 70): Row[] {
  const out: Row[] = [];
  for (const c of cards) {
    const steps = ((c.evo as Row).steps ?? []) as Row[];
    const active = steps.find((s) => !s.completed);
    if (active && Number(active.stage_completion_pct) >= threshold) {
      out.push({
        owned_card_id: c.owned_card_id,
        name: c.name,
        evo_step_id: active.evo_step_id,
        stage_completion_pct: active.stage_completion_pct,
        to_gem_tier: active.to_gem_tier,
      });
    }
  }
  return out.sort((a, b) => Number(b.stage_completion_pct) - Number(a.stage_completion_pct));
}

/** Factual current -> next-version deltas. No strategy judgement. */
export function evoDelta(current: Row, next: Row | null): Record<string, unknown> | null {
  if (!next) return null;
  const attrDelta: Record<string, number> = {};
  for (const k of BASE_STAT_KEYS) {
    const a = Number((current.attributes as Row)?.[k] ?? 0);
    const b = Number((next.attributes as Row)?.[k] ?? 0);
    if (round2(b - a) !== 0) attrDelta[k] = round2(b - a);
  }
  const runDelta: Record<string, number> = {};
  for (const k of RUN_STAT_KEYS) {
    const a = Number((current.run_attributes as Row)?.[k] ?? 0);
    const b = Number((next.run_attributes as Row)?.[k] ?? 0);
    if (round2(b - a) !== 0) runDelta[k] = round2(b - a);
  }
  const key = (x: Row) => `${x.badge_id ?? x.trait_id}`;
  const curBadges = new Map((current.badges as Row[] ?? []).map((b) => [key(b), b]));
  const nextBadges = new Map((next.badges as Row[] ?? []).map((b) => [key(b), b]));
  const curTraits = new Map((current.traits as Row[] ?? []).map((t) => [key(t), t]));
  const nextTraits = new Map((next.traits as Row[] ?? []).map((t) => [key(t), t]));

  const added_badges: Row[] = [];
  const upgraded_badges: Row[] = [];
  const removed_badges: Row[] = [];
  for (const [k, b] of nextBadges) {
    const prev = curBadges.get(k);
    if (!prev) added_badges.push({ name: b.name, tier: b.tier });
    else if (prev.tier !== b.tier) upgraded_badges.push({ name: b.name, from_tier: prev.tier, to_tier: b.tier });
  }
  for (const [k, b] of curBadges) if (!nextBadges.has(k)) removed_badges.push({ name: b.name, tier: b.tier });

  const added_traits: Row[] = [];
  const upgraded_traits: Row[] = [];
  const removed_traits: Row[] = [];
  for (const [k, t] of nextTraits) {
    const prev = curTraits.get(k);
    if (!prev) added_traits.push({ name: t.name, tier: t.tier, target_stat: t.target_stat });
    else if (prev.tier !== t.tier) upgraded_traits.push({ name: t.name, from_tier: prev.tier, to_tier: t.tier });
  }
  for (const [k, t] of curTraits) if (!nextTraits.has(k)) removed_traits.push({ name: t.name, tier: t.tier });

  return {
    target_version_id: next.evo_card_version_id ?? next.id ?? null,
    gem_tier_change: { from: current.gem_tier ?? null, to: next.gem_tier ?? null },
    rating_change: round2(Number(next.rating ?? 0) - Number(current.rating ?? 0)),
    run_rating_change: round2(Number(next.run_rating ?? 0) - Number(current.run_rating ?? 0)),
    position_change:
      current.position1 !== next.position1 || current.position2 !== next.position2
        ? { from: [current.position1, current.position2], to: [next.position1, next.position2] }
        : null,
    attribute_changes: attrDelta,
    run_attribute_changes: runDelta,
    added_badges, upgraded_badges, removed_badges,
    added_traits, upgraded_traits, removed_traits,
  };
}

/** Deterministic side-by-side comparison of owned cards. */
export function compareCards(cards: OwnedCardView[]): Record<string, unknown> {
  const groups: Record<string, Record<string, number>> = {};
  for (const [group, keys] of Object.entries(ATTRIBUTE_GROUPS)) {
    groups[group] = {};
    for (const c of cards) {
      let total = 0;
      for (const k of keys) total += Number((c.attributes as Row)[k] ?? 0);
      groups[group][c.owned_card_id] = round2(total);
    }
  }
  const attributeMatrix: Record<string, Record<string, number | null>> = {};
  for (const k of [...BASE_STAT_KEYS, ...RUN_STAT_KEYS]) {
    attributeMatrix[k] = {};
    for (const c of cards) {
      const src = k.startsWith("run_") ? (c.run_attributes as Row) : (c.attributes as Row);
      attributeMatrix[k][c.owned_card_id] = src[k] ?? null;
    }
  }
  return {
    cards: cards.map((c) => ({
      owned_card_id: c.owned_card_id,
      player_card_id: c.player_card_id,
      playable_version_id: c.playable_version_id,
      name: c.name,
      gem_tier: c.gem_tier,
      rating: c.rating,
      run_rating: c.run_rating,
      position1: c.position1,
      position2: c.position2,
      badge_count: c.badge_count,
      badges: c.badges,
      traits: c.traits,
      evo: c.evo,
    })),
    attribute_matrix: attributeMatrix,
    group_totals: groups,
    note: "Factual values only. Group totals are unweighted sums of their member attributes.",
  };
}
