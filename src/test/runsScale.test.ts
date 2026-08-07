import { describe, expect, it } from "vitest";
import { normalizeDocument } from "../../supabase/functions/_shared/admin-api/normalize.ts";
import {
  deriveRunStat,
  deriveRunStats,
  runBandForBase,
  runRatingFromStats,
  runStatMatchesBase,
  RUN_STAT_RANGE,
} from "../../supabase/functions/_shared/admin-api/runScale.ts";
import { normalizeRelease, validateRelease } from "../../supabase/functions/actions/contentRelease.ts";

const statsFor = (v: number) => ({
  stat_3pt: v, stat_mid: v, stat_fin: v, stat_dnk: v, stat_ast: v,
  stat_stl: v, stat_reb: v, stat_blk: v, stat_int: v,
});

describe("runs point scale", () => {
  it("maps each star to a 20-point band", () => {
    expect(runBandForBase(0.4)).toMatchObject({ star: 0, min: 0, max: 19 });
    expect(runBandForBase(1)).toMatchObject({ star: 1, min: 20, max: 39 });
    expect(runBandForBase(1.9)).toMatchObject({ star: 1, min: 20, max: 39 });
    expect(runBandForBase(3.2)).toMatchObject({ star: 3, min: 60, max: 79 });
    expect(runBandForBase(6.5)).toMatchObject({ star: 6, min: 120, max: 139 });
    expect(RUN_STAT_RANGE.max).toBe(139);
  });

  it("derives runs stats inside the band of their base stat", () => {
    for (const base of [0.2, 1, 1.4, 2.75, 5.99, 6.1]) {
      for (const seed of ["a", "b", "c", "d"]) {
        const v = deriveRunStat(base, seed);
        expect(runStatMatchesBase(base, v)).toBe(true);
      }
    }
  });

  it("does not map every 1 rating to the same number", () => {
    const values = new Set(
      ["LaVine", "Smoove", "Beasley", "Finley", "Hardaway", "Kobe", "Iverson", "Nash"].map((n) =>
        deriveRunStat(1, n),
      ),
    );
    expect(values.size).toBeGreaterThan(1);
    for (const v of values) expect(v).toBeGreaterThanOrEqual(20);
    for (const v of values) expect(v).toBeLessThanOrEqual(39);
  });

  it("is deterministic so preview, hash and commit agree", () => {
    expect(deriveRunStats(statsFor(1.5), "Zach LaVine")).toEqual(deriveRunStats(statsFor(1.5), "Zach LaVine"));
  });

  it("derives runs stats and run_rating for a bulk player that omits them", () => {
    const res = normalizeDocument({ players: [{ name: "Zach LaVine", gem_tier: "emerald", ...statsFor(1.5) }] });
    expect(res.errors).toEqual([]);
    const player = (res.canonical.players as Record<string, unknown>[])[0];
    for (const key of Object.keys(statsFor(1))) {
      const run = player[key.replace("stat_", "run_stat_")] as number;
      expect(run).toBeGreaterThanOrEqual(20);
      expect(run).toBeLessThanOrEqual(39);
    }
    expect(res.warnings.some((w) => w.code === "RUN_STATS_DERIVED")).toBe(true);
    expect(Number(player.run_rating)).toBeGreaterThanOrEqual(20);
  });

  it("rejects star-scale values sent as runs stats", () => {
    const res = normalizeDocument({
      players: [
        {
          name: "Wrong Scale",
          gem_tier: "emerald",
          ...statsFor(1.5),
          run_stats: Object.fromEntries(Object.keys(statsFor(1)).map((k) => [k.replace("stat_", "run_stat_"), 1])),
        },
      ],
    });
    expect(res.errors.some((e) => e.code === "RUN_STAT_SCALE_MISMATCH")).toBe(true);
  });

  it("rejects runs stats from the wrong star band", () => {
    const res = normalizeDocument({
      players: [{ name: "Off Band", gem_tier: "emerald", ...statsFor(1.5), run_stat_3pt: 88 }],
    });
    expect(res.errors.some((e) => e.code === "RUN_STAT_SCALE_MISMATCH")).toBe(true);
  });

  it("accepts runs stats inside their band and validates run_rating as their mean", () => {
    const runStats = Object.fromEntries(
      Object.keys(statsFor(1)).map((k) => [k.replace("stat_", "run_stat_"), 30]),
    );
    const ok = normalizeDocument({
      players: [{ name: "In Band", gem_tier: "emerald", ...statsFor(1.5), ...runStats }],
    });
    expect(ok.errors).toEqual([]);
    expect(runRatingFromStats(runStats)).toBe("30.00");

    const bad = normalizeDocument({
      players: [{ name: "Bad Rating", gem_tier: "emerald", ...statsFor(1.5), ...runStats, run_rating: 3 }],
    });
    expect(bad.errors.some((e) => e.code === "RUN_RATING_MISMATCH")).toBe(true);
  });

  it("derives and validates runs stats in a content release", () => {
    const release = normalizeRelease({
      release: { name: "Runs Scale Test", slug: "runs-scale-test", status: "draft" },
      players: [{ name: "Chris Smoove", gem_tier: "emerald", rating: 1.5, stats: statsFor(1.5) }],
    } as never);
    const derived = release.players?.[0].run_stats as Record<string, number>;
    expect(Object.keys(derived)).toHaveLength(9);
    for (const v of Object.values(derived)) {
      expect(v).toBeGreaterThanOrEqual(20);
      expect(v).toBeLessThanOrEqual(39);
    }
    expect(validateRelease(release).filter((e) => e.code === "RUN_STAT_SCALE_MISMATCH")).toEqual([]);

    const wrong = normalizeRelease({
      release: { name: "Runs Scale Test", slug: "runs-scale-test", status: "draft" },
      players: [
        {
          name: "Michael Beasley",
          gem_tier: "emerald",
          rating: 1.5,
          stats: statsFor(1.5),
          run_stats: Object.fromEntries(
            Object.keys(statsFor(1)).map((k) => [k.replace("stat_", "run_stat_"), 1]),
          ),
        },
      ],
    } as never);
    expect(validateRelease(wrong).some((e) => e.code === "RUN_STAT_SCALE_MISMATCH")).toBe(true);
  });
});
