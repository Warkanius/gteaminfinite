// Runs-mode stat scale.
//
// Base card stats live on the STAR scale (0.00 - 6.99+): the OVR is the mean of
// the nine base stats and one whole point equals one star.
//
// Runs-mode stats live on a completely separate POINT scale where every star is
// worth twenty points. Star 0 -> 0..19, star 1 -> 20..39, star 2 -> 40..59, and
// so on. A card with base stat 1.4 therefore has a Runs stat somewhere in
// 20..39 — never 1, and never 88.
//
// Nothing here uses binary floats for comparisons: values are scaled to integer
// hundredths first (see decimal.ts).

import { RUN_STAT_KEYS, STAT_KEYS, scaled, unscaled } from "./decimal.ts";

/** Points of Runs-scale headroom per star of base stat. */
export const RUN_POINTS_PER_STAR = 20;

/** Highest star band that can be generated (Game Over sits at 6). */
export const RUN_MAX_STAR = 6;

/** Absolute accepted Runs-stat range, i.e. the top of the star-6 band. */
export const RUN_STAT_RANGE = { min: 0, max: RUN_POINTS_PER_STAR * (RUN_MAX_STAR + 1) - 1 };

export interface RunBand {
  star: number;
  min: number;
  max: number;
}

/** The Runs-scale band a base (star-scale) stat maps onto. */
export function runBandForBase(baseStat: number | string): RunBand {
  const units = scaled(baseStat, 2);
  const star = Math.min(Math.max(Math.floor(units / 100), 0), RUN_MAX_STAR);
  return { star, min: star * RUN_POINTS_PER_STAR, max: star * RUN_POINTS_PER_STAR + RUN_POINTS_PER_STAR - 1 };
}

export function runBandLabel(band: RunBand): string {
  return `${band.min}-${band.max} (star ${band.star})`;
}

/** True when a Runs stat sits inside the band implied by its base stat. */
export function runStatMatchesBase(baseStat: number | string, runStat: number | string): boolean {
  const band = runBandForBase(baseStat);
  const v = scaled(runStat, 2) / 100;
  return v >= band.min && v <= band.max;
}

/* ---------- deterministic randomisation ---------- */

function hash(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic 0..1 for a seed. Same seed -> same value in preview and commit. */
function rand(seed: string): number {
  let t = (hash(seed) + 0x6d2b79f5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Spread applied around the position implied by the base stat's decimals. */
const JITTER = 6;

/**
 * Maps one base stat onto the Runs scale: correlated with the star value and
 * with its decimals, then randomised inside the band so two 1.0 stats do not
 * always become the same number.
 */
export function deriveRunStat(baseStat: number | string, seed: string): number {
  const band = runBandForBase(baseStat);
  const units = scaled(baseStat, 2);
  const frac = Math.min(Math.max(units - Math.floor(units / 100) * 100, 0), 99) / 99;
  const centre = frac * (RUN_POINTS_PER_STAR - 1);
  const jitter = (rand(seed) * 2 - 1) * JITTER;
  const offset = Math.min(Math.max(Math.round(centre + jitter), 0), RUN_POINTS_PER_STAR - 1);
  return band.min + offset;
}

/** Derives all nine Runs stats from the nine base stats. */
export function deriveRunStats(
  stats: Record<string, unknown>,
  seed: string,
): Record<string, number> {
  const out: Record<string, number> = {};
  STAT_KEYS.forEach((key, i) => {
    const base = stats[key];
    if (base === undefined || base === null || base === "") return;
    out[RUN_STAT_KEYS[i]] = deriveRunStat(base as number | string, `${seed}|${key}`);
  });
  return out;
}

/** Runs rating: mean of the nine Runs stats, on the Runs point scale. */
export function runRatingFromStats(runStats: Record<string, unknown>): string | null {
  let total = 0;
  for (const key of RUN_STAT_KEYS) {
    const v = runStats[key];
    if (v === undefined || v === null || v === "") return null;
    total += scaled(v as number | string, 2);
  }
  return unscaled(Math.round(total / RUN_STAT_KEYS.length), 2);
}

/** Human-readable description used by capabilities and GPT-facing docs. */
export const RUN_SCALE_DOC =
  `Runs-mode stats use a separate scale from base card stats. Base stats are star values (0.00-6.99) and the OVR is their mean. ` +
  `Runs stats are points where each star is worth ${RUN_POINTS_PER_STAR}: star 0 = 0-19, star 1 = 20-39, star 2 = 40-59, star 3 = 60-79, ` +
  `star 4 = 80-99, star 5 = 100-119, star 6 = 120-139. A Runs stat must fall inside the band of its base stat; ` +
  `omit run_stat_* / run_stats and the backend derives them, correlated with the base stat's decimals and randomised inside the band. ` +
  `run_rating is the mean of the nine Runs stats and is derived when omitted.`;
