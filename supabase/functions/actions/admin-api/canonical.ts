// Canonical serialization + hashing.
// Preview and commit must hash identically, so every payload is passed through
// the same deterministic normalizer: sorted keys, canonical numeric text,
// stripped undefined/null-noise, stable array order (arrays stay as given —
// their order is meaningful for rosters, pools and evo steps).

import { canonicalNumber } from "./decimal.ts";

export type Json = null | boolean | string | number | Json[] | { [k: string]: Json };

/** Deterministic value normalizer used for both hashing and the returned payload. */
export function canonicalize(value: unknown): Json {
  if (value === undefined) return null;
  if (value === null) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`NOT_A_NUMBER: ${value}`);
    return canonicalNumber(value) as unknown as Json;
  }
  if (typeof value === "boolean" || typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((v) => canonicalize(v));
  if (typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, Json> = {};
    for (const key of Object.keys(src).sort()) {
      if (src[key] === undefined) continue;
      out[key] = canonicalize(src[key]);
    }
    return out;
  }
  throw new Error(`UNSERIALIZABLE: ${typeof value}`);
}

/** Stable JSON text of the canonical form. */
export function canonicalText(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/** sha256 hex of the canonical text. Works in Deno and Node 20+. */
export async function payloadHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalText(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function byteSize(value: unknown): number {
  return new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value)).length;
}

/** Drops undefined keys without changing ordering semantics. */
export function compact<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out;
}
