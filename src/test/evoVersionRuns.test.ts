import { describe, expect, it } from "vitest";
import { buildReleasePayload, normalizeRelease, prepareRelease } from "@/lib/contentRelease";
import { PLAYABLE_CARD_FIELDS } from "../../supabase/functions/_shared/admin-api/playableCard";
import { RUN_STAT_KEYS, STAT_KEYS } from "../../supabase/functions/_shared/admin-api/decimal";

const tiers = { tierOrder: ["Emerald", "Sapphire", "Ruby", "Amethyst", "Diamond", "Pink Diamond", "Actolytrene", "Game Over"] };

const baseStats = {
  stat_3pt: 1.4,
  stat_mid: 1.2,
  stat_fin: 1.6,
  stat_dnk: 1.1,
  stat_ast: 1.3,
  stat_stl: 1.5,
  stat_reb: 1.2,
  stat_blk: 1.0,
  stat_int: 1.7,
};

function release(overrides: Record<string, unknown> = {}) {
  return {
    release: { name: "Runs Parity", status: "draft" },
    players: [{ name: "Runs Parity Card", gem_tier: "Emerald", rating: 1.33, stats: baseStats }],
    evo_paths: [
      {
        player_name: "Runs Parity Card",
        steps: [
          {
            from_tier: "Emerald",
            to_tier: "Sapphire",
            step_order: 1,
            objectives: [{ stat: "points", amount: 250 }],
            resulting_version: {
              rating: 2.2,
              position1: "SG",
              position2: "SF",
              stats: Object.fromEntries(STAT_KEYS.map((k) => [k, 2.2])),
              ...(overrides.version as Record<string, unknown>),
            },
          },
        ],
      },
    ],
  } as any;
}

describe("evo card versions are complete playable cards", () => {
  it("derives Runs stats and run_rating for a version when they are omitted", () => {
    const normalized = normalizeRelease(release());
    const version: any = normalized.evo_paths![0].steps[0].resulting_version;
    for (const key of RUN_STAT_KEYS) {
      expect(version.run_stats[key]).toBeGreaterThanOrEqual(40);
      expect(version.run_stats[key]).toBeLessThanOrEqual(59);
    }
    expect(version.run_rating).toBeGreaterThanOrEqual(40);
    expect(version.run_rating).toBeLessThanOrEqual(59);
  });

  it("is deterministic across repeated normalization (preview hash === commit)", () => {
    const a: any = normalizeRelease(release()).evo_paths![0].steps[0].resulting_version;
    const b: any = normalizeRelease(release()).evo_paths![0].steps[0].resulting_version;
    expect(a.run_stats).toEqual(b.run_stats);
    expect(a.run_rating).toBe(b.run_rating);
  });

  it("carries Runs data, tier and positions into the committed payload", () => {
    const prepared = prepareRelease(release(), tiers);
    const payload = buildReleasePayload(prepared.payload ? (normalizeRelease(release()) as any) : (release() as any)) as any;
    const version = payload.evo_paths[0].steps[0].resulting_version;
    expect(Object.keys(version.run_stats ?? {})).toHaveLength(9);
    expect(version.run_rating).toBeGreaterThan(0);
    expect(version.gem_tier).toBe("Sapphire");
    expect(version.position1).toBe("SG");
    expect(version.position2).toBe("SF");
  });

  it("accepts explicit in-band Runs stats verbatim", () => {
    const runStats = Object.fromEntries(RUN_STAT_KEYS.map((k, i) => [k, 40 + i]));
    const normalized = normalizeRelease(release({ version: { run_stats: runStats } }));
    const version: any = normalized.evo_paths![0].steps[0].resulting_version;
    expect(version.run_stats).toEqual(runStats);
    const { validations } = prepareRelease(release({ version: { run_stats: runStats } }), tiers);
    expect(validations.some((v) => v.code === "RUN_STAT_SCALE_MISMATCH")).toBe(false);
  });

  it("rejects star-scale Runs values on a version", () => {
    const runStats = Object.fromEntries(RUN_STAT_KEYS.map((k) => [k, 2.2]));
    const { validations } = prepareRelease(release({ version: { run_stats: runStats } }), tiers);
    expect(validations.map((v) => v.code)).toContain("RUN_STAT_SCALE_MISMATCH");
  });

  it("rejects a run_rating that is not the mean of the nine Runs stats", () => {
    const runStats = Object.fromEntries(RUN_STAT_KEYS.map((k) => [k, 45]));
    const { validations } = prepareRelease(release({ version: { run_stats: runStats, run_rating: 2.2 } }), tiers);
    expect(validations.map((v) => v.code)).toContain("RUN_RATING_MISMATCH");
  });

  it("uses one canonical playable-card field list for cards and versions", () => {
    for (const key of [...STAT_KEYS, ...RUN_STAT_KEYS, "rating", "run_rating", "position1", "gem_tier"]) {
      expect(PLAYABLE_CARD_FIELDS).toContain(key);
    }
  });
});
