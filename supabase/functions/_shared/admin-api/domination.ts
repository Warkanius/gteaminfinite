/**
 * Singular `domination` section support.
 *
 * The Custom GPT Actions schema exposes ONE `domination` object on bulk
 * documents and content releases (`{ road_name, mode, games: [...] }`), while
 * `public.admin_apply_batch` speaks two separate groups: `domination_roads`
 * (the road record) and `domination_games` (its games + rosters). This module
 * is the single translation point so the GPT shape is never silently dropped
 * and never rejected as an unknown group.
 */

const ROAD_SCALAR_KEYS = [
  "road_id",
  "slug",
  "description",
  "sort_order",
  "is_active",
  "mode",
  "expected_game_count",
] as const;

export interface DominationExpansion {
  domination_roads: Record<string, unknown>[];
  domination_games: Record<string, unknown>[];
}

/** True when a value is a plain object or an array of plain objects. */
function asList(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((v) => v && typeof v === "object") as Record<string, unknown>[];
  if (value && typeof value === "object") return [value as Record<string, unknown>];
  return [];
}

/**
 * Expands a singular `domination` section into the road + game groups the batch
 * writer understands. Games inherit their road reference so they can be applied
 * in the same transaction as the road itself.
 */
export function expandDominationSection(value: unknown): DominationExpansion {
  const out: DominationExpansion = { domination_roads: [], domination_games: [] };

  for (const entry of asList(value)) {
    const roadName = String(entry.new_road_name ?? entry.road_name ?? entry.name ?? "").trim();
    const road: Record<string, unknown> = {};
    if (roadName) road.name = roadName;
    if (entry.new_road_name !== undefined && (entry.road_name ?? entry.name) !== undefined) {
      road.match_name = String(entry.road_name ?? entry.name);
    }
    for (const key of ROAD_SCALAR_KEYS) {
      if (entry[key] !== undefined) road[key] = entry[key];
    }
    if (Object.keys(road).length) out.domination_roads.push(road);

    for (const game of asList(entry.games)) {
      const g: Record<string, unknown> = { ...game };
      if (g.road_name === undefined && roadName) g.road_name = roadName;
      if (g.road_id === undefined && entry.road_id !== undefined) g.road_id = entry.road_id;
      out.domination_games.push(g);
    }
  }

  return out;
}

/**
 * Returns a copy of `doc` with any singular `domination` section merged into
 * `domination_roads` / `domination_games`. Existing arrays are preserved and
 * appended to, so a document may use both shapes at once.
 */
export function applyDominationSection<T extends Record<string, unknown>>(doc: T): T {
  if (doc?.domination === undefined || doc.domination === null) return doc;
  const { domination, ...rest } = doc as Record<string, unknown>;
  const expanded = expandDominationSection(domination);
  const merged: Record<string, unknown> = { ...rest };
  for (const group of ["domination_roads", "domination_games"] as const) {
    const incoming = expanded[group];
    if (!incoming.length) continue;
    const existing = Array.isArray(merged[group]) ? (merged[group] as unknown[]) : [];
    merged[group] = [...existing, ...incoming];
  }
  return merged as T;
}
