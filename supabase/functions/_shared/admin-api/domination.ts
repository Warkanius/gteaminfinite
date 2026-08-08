/**
 * Singular `domination` section support.
 *
 * The Custom GPT Actions schema exposes ONE `domination` object on bulk
 * documents and content releases (`{ road_name, mode, games: [...] }`), while
 * `public.admin_apply_batch` speaks the `domination_roads` group, whose writer
 * (`admin_apply_extra('domination_road', ...)`) takes exactly that road shape:
 * `road_name` plus its `games` array with rosters and rewards.
 *
 * This module is the single translation point, so the GPT shape is never
 * silently dropped and never rejected as an unknown group.
 */

export interface DominationExpansion {
  domination_roads: Record<string, unknown>[];
}

/** Accepts one road object or an array of them; ignores anything else. */
function asList(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((v) => v && typeof v === "object") as Record<string, unknown>[];
  if (value && typeof value === "object") return [value as Record<string, unknown>];
  return [];
}

/**
 * Normalizes a singular `domination` section into `domination_roads` items.
 * `name` is accepted as an alias for `road_name` so callers can use either.
 */
export function expandDominationSection(value: unknown): DominationExpansion {
  const roads: Record<string, unknown>[] = [];
  for (const entry of asList(value)) {
    const road: Record<string, unknown> = { ...entry };
    if (road.road_name === undefined && road.name !== undefined) road.road_name = road.name;
    delete road.name;
    roads.push(road);
  }
  return { domination_roads: roads };
}

/**
 * Returns a copy of `doc` with any singular `domination` section merged into the
 * `domination_roads` group. An existing `domination_roads` array is preserved
 * and appended to, so a document may use both shapes at once.
 */
export function applyDominationSection<T extends Record<string, unknown>>(doc: T): T {
  if (!doc || doc.domination === undefined || doc.domination === null) return doc;
  const { domination, ...rest } = doc as Record<string, unknown>;
  const { domination_roads } = expandDominationSection(domination);
  const merged: Record<string, unknown> = { ...rest };
  if (domination_roads.length) {
    const existing = Array.isArray(merged.domination_roads) ? (merged.domination_roads as unknown[]) : [];
    merged.domination_roads = [...existing, ...domination_roads];
  }
  return merged as T;
}
