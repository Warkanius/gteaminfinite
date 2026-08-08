import { describe, expect, it } from "vitest";
import { normalizeDocument } from "../../supabase/functions/_shared/admin-api/normalize";
import {
  buildReleasePayload,
  validateRelease,
  RELEASE_SECTIONS,
} from "../../supabase/functions/actions/contentRelease";

const road = {
  road_name: "Road to the Ring",
  mode: "merge",
  games: [
    { game_order: 1, opponent_name: "Lockport", difficulty_stars: 2, coin_reward: 500 },
    { game_order: 2, opponent_name: "Northside", difficulty_stars: 3, coin_reward: 750 },
  ],
};

describe("singular `domination` section (GPT Actions shape)", () => {
  it("bulk documents accept it and apply it as domination_roads", () => {
    const res = normalizeDocument({ domination: road });
    expect(res.errors).toEqual([]);
    const roads = res.canonical.domination_roads as Record<string, unknown>[];
    expect(roads).toHaveLength(1);
    expect(roads[0].road_name).toBe("Road to the Ring");
    expect((roads[0].games as unknown[]).length).toBe(2);
    expect(res.canonical.domination).toBeUndefined();
  });

  it("merges with an explicit domination_roads array instead of replacing it", () => {
    const res = normalizeDocument({
      domination_roads: [{ road_name: "Other Road", games: [{ game_order: 1, opponent_name: "A" }] }],
      domination: road,
    });
    expect(res.errors).toEqual([]);
    expect((res.canonical.domination_roads as unknown[]).length).toBe(2);
  });

  it("is a real release section, not an unknown one", () => {
    expect(RELEASE_SECTIONS).toContain("domination");
    const problems = validateRelease({ release: { name: "Ring Season" }, domination: road } as never)
      .filter((v) => v.severity === "error");
    expect(problems).toEqual([]);
  });

  it("forwards into the release payload's domination_roads group", () => {
    const payload = buildReleasePayload({ release: { name: "Ring Season" }, domination: road } as never);
    const roads = payload.domination_roads as Record<string, unknown>[];
    expect(roads).toHaveLength(1);
    expect(roads[0].road_name).toBe("Road to the Ring");
    expect(payload.domination).toBeUndefined();
  });
});
