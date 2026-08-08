// Fixed-precision numeric helpers.
// Binary floating point is never used for comparisons of odds, OVR, or economy
// values: everything is converted to integer (or BigInt) scaled units first.

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

export const RUN_STAT_KEYS = STAT_KEYS.map((k) => k.replace("stat_", "run_stat_")) as unknown as readonly string[];

/** Canonical decimal precision used for hashing and rating comparison. */
export const CANONICAL_DECIMALS = 10;

/** Rating <-> stat-average comparison tolerance, as documented to the GPT. */
export const OVR_TOLERANCE = "0.0000001";
/** The same tolerance expressed in 1e-10 units, multiplied by 9 (see checkOvr). */
export const OVR_TOLERANCE_UNITS = 9_000n;

const NUMERIC = /^-?\d*(\.\d+)?$/;

function parts(value: number | string): { neg: boolean; int: string; frac: string } {
  let raw = String(value).trim();
  if (raw !== "" && /e/i.test(raw)) raw = expand(raw);
  if (raw === "" || raw === "-" || !NUMERIC.test(raw)) throw new Error(`NOT_A_NUMBER: "${raw}"`);
  const neg = raw.startsWith("-");
  const [int = "0", frac = ""] = raw.replace("-", "").split(".");
  return { neg, int: int || "0", frac };
}

/** Expands exponent notation to plain decimal text without float error. */
function expand(raw: string): string {
  const [mantissa, expPart] = raw.split(/e/i);
  const exp = Number(expPart);
  if (!Number.isFinite(exp)) throw new Error(`NOT_A_NUMBER: "${raw}"`);
  const neg = mantissa.startsWith("-");
  const [i = "0", f = ""] = mantissa.replace("-", "").split(".");
  const digits = i + f;
  let point = i.length + exp;
  let out: string;
  if (point <= 0) out = `0.${"0".repeat(-point)}${digits}`;
  else if (point >= digits.length) out = digits + "0".repeat(point - digits.length);
  else out = `${digits.slice(0, point)}.${digits.slice(point)}`;
  return neg ? `-${out}` : out;
}

/** Scales a decimal string/number to integer units of 10^places (Number). */
export function scaled(value: number | string, places = 2): number {
  const { neg, int, frac } = parts(value);
  const f = (frac + "0".repeat(places)).slice(0, places);
  const n = Number(`${int}${f}`);
  return neg ? -n : n;
}

/** Scales to BigInt units of 10^places. Exact for any magnitude/precision. */
export function scaledBig(value: number | string, places = CANONICAL_DECIMALS): bigint {
  const { neg, int, frac } = parts(value);
  const f = (frac + "0".repeat(places)).slice(0, places);
  const n = BigInt(`${int}${f}`);
  return neg ? -n : n;
}

/** Renders scaled integer units back to a canonical fixed-precision string. */
export function unscaled(units: number, places = 2): string {
  const neg = units < 0;
  const s = String(Math.abs(Math.round(units))).padStart(places + 1, "0");
  const out = `${s.slice(0, s.length - places)}.${s.slice(s.length - places)}`;
  return neg ? `-${out}` : out;
}

/** Renders BigInt units back to fixed-precision text, trailing zeros trimmed. */
export function unscaledBig(units: bigint, places = CANONICAL_DECIMALS, trim = true): string {
  const neg = units < 0n;
  const s = (units < 0n ? -units : units).toString().padStart(places + 1, "0");
  let out = `${s.slice(0, s.length - places)}.${s.slice(s.length - places)}`;
  if (trim) out = out.replace(/0+$/, "").replace(/\.$/, "");
  return `${neg ? "-" : ""}${out}`;
}

/**
 * Canonical numeric text: no exponent, no trailing-zero drift, full decimal
 * precision up to CANONICAL_DECIMALS so submitted ratings such as
 * 3.7777777778 survive preview -> hash -> commit without rounding.
 */
export function canonicalNumber(value: number | string): string {
  return unscaledBig(scaledBig(value, CANONICAL_DECIMALS), CANONICAL_DECIMALS);
}

/**
 * Authoritative gem-tier OVR bands, in hundredths.
 * `max` is inclusive of everything strictly below max + 0.01.
 */
export const GEM_TIER_BANDS: Array<{ tier: string; min: number; max: number | null }> = [
  // Gold is a real, playable star-0 tier and a legitimate evolution SOURCE.
  { tier: "gold", min: 0, max: 99 },
  { tier: "emerald", min: 100, max: 199 },
  { tier: "amethyst", min: 200, max: 299 },
  { tier: "diamond", min: 300, max: 399 },
  { tier: "pink diamond", min: 400, max: 499 },
  { tier: "actolytrene", min: 500, max: 599 },
  { tier: "game over", min: 600, max: null },
];

/** Tier progression order for evolution paths. */
export const GEM_TIER_ORDER = GEM_TIER_BANDS.map((b) => b.tier);

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

/** Exact stat total in 1e-10 units, plus any missing stat keys. */
export function statTotalExact(stats: Record<string, unknown>): { total: bigint; missing: StatKey[] } {
  const missing: StatKey[] = [];
  let total = 0n;
  for (const key of STAT_KEYS) {
    const v = stats[key];
    if (v === undefined || v === null || v === "") {
      missing.push(key);
      continue;
    }
    total += scaledBig(v as number | string, CANONICAL_DECIMALS);
  }
  return { total, missing };
}

export function ovrText(stats: Record<string, unknown>): string | null {
  const { units, missing } = ovrHundredths(stats);
  if (missing.length) return null;
  return unscaled(units, 2);
}

/** Exact OVR text (up to 10 decimals) from the nine base stats. */
export function ovrExactText(stats: Record<string, unknown>): string | null {
  const { total, missing } = statTotalExact(stats);
  if (missing.length) return null;
  return unscaledBig(total / 9n, CANONICAL_DECIMALS);
}

export interface OvrCheck {
  ok: boolean;
  code?: "OVR_TIER_MISMATCH" | "OVR_RATING_MISMATCH" | "UNKNOWN_GEM_TIER" | "INCOMPLETE_STATS";
  /** Hundredths-rounded OVR, for human-readable output. */
  computed?: string;
  /** Exact OVR (stat total / 9) with full decimal precision. */
  computed_exact?: string;
  expected?: string;
  received?: unknown;
  tier?: string;
  offenders?: StatKey[];
  tolerance?: string;
}

/**
 * Validates stats <-> submitted rating <-> gem-tier band with exact integer
 * arithmetic. The gem tier is authoritative and is never silently changed.
 *
 * `toleranceUnits` is expressed in 1e-10 units already multiplied by nine,
 * because the comparison is `|9 * rating - statTotal|`. The default equals an
 * absolute rating difference of 0.0000001.
 */
export function checkOvr(
  stats: Record<string, unknown>,
  tier: unknown,
  rating: unknown,
  toleranceUnits: bigint = OVR_TOLERANCE_UNITS,
): OvrCheck {
  const { total, missing } = statTotalExact(stats);
  if (missing.length) return { ok: false, code: "INCOMPLETE_STATS", offenders: missing };
  const exact = unscaledBig(total / 9n, CANONICAL_DECIMALS);
  const computed = unscaled(ovrHundredths(stats).units, 2);
  const base = { computed, computed_exact: exact, tolerance: OVR_TOLERANCE };

  if (rating !== undefined && rating !== null && rating !== "") {
    let submitted: bigint;
    try {
      submitted = scaledBig(rating as number | string, CANONICAL_DECIMALS);
    } catch {
      return { ok: false, code: "OVR_RATING_MISMATCH", ...base, received: rating, expected: exact };
    }
    const diff = submitted * 9n - total;
    if ((diff < 0n ? -diff : diff) > toleranceUnits) {
      return { ok: false, code: "OVR_RATING_MISMATCH", ...base, received: rating, expected: exact };
    }
  }
  if (tier === undefined || tier === null || tier === "") return { ok: true, ...base };

  const band = bandFor(tier);
  if (!band) return { ok: false, code: "UNKNOWN_GEM_TIER", ...base, received: tier };

  // Exact band comparison in 1e-10 units: [min, max + 0.01) inclusive/exclusive.
  const ovr = total / 9n;
  const min = BigInt(band.min) * 100_000_000n;
  const maxExclusive = band.max === null ? null : BigInt(band.max + 1) * 100_000_000n;
  if (ovr < min || (maxExclusive !== null && ovr >= maxExclusive)) {
    const mid = band.max === null ? band.min + 50 : Math.round((band.min + band.max) / 2);
    const offenders = [...STAT_KEYS]
      .map((k) => ({ k, delta: Math.abs(scaled(stats[k] as number, 2) - mid) }))
      .sort((a, b) => b.delta - a.delta)
      .slice(0, 3)
      .map((x) => x.k);
    return {
      ok: false,
      code: "OVR_TIER_MISMATCH",
      ...base,
      expected: bandLabel(band),
      received: computed,
      tier: band.tier,
      offenders,
    };
  }
  return { ok: true, ...base, tier: band.tier };
}

/** Odds total in hundredths. Must equal ODDS_TARGET exactly. */
export function oddsTotal(odds: Array<{ percentage: number | string }>): number {
  return odds.reduce((sum, row) => sum + scaled(row.percentage, 2), 0);
}

export const ODDS_TARGET = 10000;
