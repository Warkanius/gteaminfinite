// Fixed-precision numeric helpers.
// Binary floating point is never used for comparisons of odds, OVR, or economy
// values: everything is converted to integer scaled units first.

export const STAT_KEYS = [
  "stat_3pt",
  "stat_mid",
  "stat_fin",
  "stat_dnk",
  "stat_ast",
  "stat_stl",
  "stat_reb",
  "stat_blk",
  "stat_int",
] as const;
export type StatKey = (typeof STAT_KEYS)[number];

/** Scales a decimal string/number to integer units of 10^places without float error. */
export function scaled(value: number | string, places = 2): number {
  const raw = String(value).trim();
  if (raw === "" || raw === "-" || !/^-?\d*(\.\d+)?$/.test(raw)) {
    throw new Error(`NOT_A_NUMBER: "${raw}"`);
  }
  const neg = raw.startsWith("-");
  const [intPart, fracPart = ""] = raw.replace("-", "").split(".");
  const frac = (fracPart + "0".repeat(places)).slice(0, places);
  const n = Number(`${intPart || "0"}${frac}`);
  return neg ? -n : n;
}

/** Renders scaled integer units back to a canonical fixed-precision string. */
export function unscaled(units: number, places = 2): string {
  const neg = units < 0;
  const s = String(Math.abs(Math.round(units))).padStart(places + 1, "0");
  const out = `${s.slice(0, s.length - places)}.${s.slice(s.length - places)}`;
  return neg ? `-${out}` : out;
}

/** Canonical numeric text: no exponent, no trailing-zero drift, max 4 decimals. */
export function canonicalNumber(value: number | string): string {
  const units = scaled(value, 4);
  let out = unscaled(units, 4);
  if (out.includes(".")) out = out.replace(/0+$/, "").replace(/\.$/, "");
  return out;
}

export const GEM_TIER_BANDS: Array<{ tier: string; min: number; max: number | null }> = [
  { tier: "emerald", min: 100, max: 199 },
  { tier: "amethyst", min: 200, max: 299 },
  { tier: "diamond", min: 300, max: 399 },
  { tier: "pink diamond", min: 400, max: 499 },
  { tier: "actolytrene", min: 500, max: null },
];

export function tierKey(name: unknown): string {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function bandFor(tier: unknown) {
  const key = tierKey(tier);
  return GEM_TIER_BANDS.find((b) => b.tier === key) ?? null;
}

export function bandLabel(band: { min: number; max: number | null }) {
  return band.max === null ? `${unscaled(band.min)} and above` : `${unscaled(band.min)} through ${unscaled(band.max)}`;
}

/** OVR in scaled hundredths: arithmetic mean of the nine base stats. */
export function ovrHundredths(stats: Record<string, unknown>): { units: number; missing: StatKey[] } {
  const missing: StatKey[] = [];
  let total = 0;
  for (const key of STAT_KEYS) {
    const v = stats[key];
    if (v === undefined || v === null || v === "") {
      missing.push(key);
      continue;
    }
    total += scaled(v as number | string, 2);
  }
  return { units: Math.round(total / STAT_KEYS.length), missing };
}

export function ovrText(stats: Record<string, unknown>): string | null {
  const { units, missing } = ovrHundredths(stats);
  if (missing.length) return null;
  return unscaled(units, 2);
}

export interface OvrCheck {
  ok: boolean;
  code?: "OVR_TIER_MISMATCH" | "OVR_RATING_MISMATCH" | "UNKNOWN_GEM_TIER" | "INCOMPLETE_STATS";
  computed?: string;
  expected?: string;
  received?: unknown;
  tier?: string;
  offenders?: StatKey[];
}

/**
 * Validates stats <-> stored rating <-> gem tier band.
 * `tolerance` is in hundredths (default 0.05).
 */
export function checkOvr(
  stats: Record<string, unknown>,
  tier: unknown,
  rating: unknown,
  tolerance = 5,
): OvrCheck {
  const { units, missing } = ovrHundredths(stats);
  if (missing.length) return { ok: false, code: "INCOMPLETE_STATS", offenders: missing };
  const computed = unscaled(units, 2);

  if (rating !== undefined && rating !== null && rating !== "") {
    const stored = scaled(rating as number | string, 2);
    if (Math.abs(stored - units) > tolerance) {
      return { ok: false, code: "OVR_RATING_MISMATCH", computed, received: rating, expected: computed };
    }
  }
  if (tier === undefined || tier === null || tier === "") return { ok: true, computed };

  const band = bandFor(tier);
  if (!band) return { ok: false, code: "UNKNOWN_GEM_TIER", computed, received: tier };
  if (units < band.min || (band.max !== null && units > band.max)) {
    const mid = band.max === null ? band.min + 50 : Math.round((band.min + band.max) / 2);
    const offenders = [...STAT_KEYS]
      .map((k) => ({ k, delta: Math.abs(scaled(stats[k] as number, 2) - mid) }))
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 3)
      .map((x) => x.k);
    return {
      ok: false,
      code: "OVR_TIER_MISMATCH",
      computed,
      expected: bandLabel(band),
      received: computed,
      tier: band.tier,
      offenders,
    };
  }
  return { ok: true, computed, tier: band.tier };
}

/** Odds total in hundredths. Must equal ODDS_TARGET exactly. */
export function oddsTotal(odds: Array<{ percentage: number | string }>): number {
  return odds.reduce((sum, row) => sum + scaled(row.percentage, 2), 0);
}

export const ODDS_TARGET = 10000;
