// Canonical playable-card model.
//
// A "playable card snapshot" is the set of fields that make a card usable in a
// game: identity (tier/name/positions), the nine base gameplay stats on the star
// scale, the nine Runs stats on the Runs point scale, both ratings, and the
// badge/trait assignments.
//
// The SAME model backs three surfaces so they cannot drift:
//   1. public.player_cards            (normal cards)
//   2. evo resulting_version payloads (Commissioner input)
//   3. public.evo_card_versions       (materialized playable evo states)
//
// Nothing here writes or reads the database: it only normalizes and derives.

import { RUN_STAT_KEYS, STAT_KEYS } from "./decimal.ts";
import { deriveRunStats, runRatingFromStats } from "./runScale.ts";

/** Identity/presentation fields every playable snapshot supports. */
export const PLAYABLE_IDENTITY_FIELDS = [
  "gem_tier",
  "gem_name",
  "position1",
  "position2",
  "rating",
  "run_rating",
  "status",
  "evo_stage",
] as const;

/** Nine base gameplay stats (star scale, 0.00 - 6.99). */
export const PLAYABLE_STAT_FIELDS = [...STAT_KEYS] as readonly string[];

/** Nine Runs stats (point scale, 20 points per star, 0 - 139). */
export const PLAYABLE_RUN_STAT_FIELDS = [...RUN_STAT_KEYS] as readonly string[];

/** Collections layered on top of the scalar fields. */
export const PLAYABLE_ASSIGNMENT_FIELDS = ["badges", "traits"] as const;

/**
 * The single canonical field list. Used by the release payload builder, by the
 * OpenAPI schemas and by the parity test that keeps player_cards and
 * evo_card_versions describing the same playable card.
 */
export const PLAYABLE_CARD_FIELDS: readonly string[] = [
  ...PLAYABLE_IDENTITY_FIELDS,
  ...PLAYABLE_STAT_FIELDS,
  ...PLAYABLE_RUN_STAT_FIELDS,
  ...PLAYABLE_ASSIGNMENT_FIELDS,
];

/** Columns an evo version adds on top of the shared playable-card fields. */
export const EVO_VERSION_ONLY_FIELDS = [
  "id",
  "evo_path_id",
  "base_player_card_id",
  "version_order",
] as const;

/**
 * Fills in the nine Runs stats when a caller omitted them, using the shared
 * 20-points-per-star derivation. Explicitly supplied values are preserved
 * verbatim — they are validated elsewhere, never silently replaced.
 */
export function completeRunStats(
  stats: Record<string, unknown>,
  runStats: Record<string, unknown>,
  seed: string,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(runStats ?? {})) {
    if (v !== undefined && v !== null && v !== "") out[k] = Number(v);
  }
  const baseComplete = STAT_KEYS.every((k) => {
    const v = (stats ?? {})[k];
    return v !== undefined && v !== null && v !== "";
  });
  if (baseComplete) {
    const derived = deriveRunStats(stats ?? {}, seed || "release");
    for (const key of RUN_STAT_KEYS) if (out[key] === undefined) out[key] = derived[key];
  }
  return out;
}

/** run_rating = mean of the nine Runs stats, or null when incomplete. */
export function completeRunRating(
  runStats: Record<string, unknown>,
  supplied?: number | string | null,
): number | null {
  if (supplied !== undefined && supplied !== null && supplied !== "") return Number(supplied);
  const mean = runRatingFromStats(runStats ?? {});
  return mean === null ? null : Number(mean);
}
