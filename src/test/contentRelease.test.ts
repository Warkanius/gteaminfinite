import { describe, expect, it } from "vitest";
import {
  buildReleasePayload,
  formatHundredths,
  normalizeObjectiveKey,
  normalizeRelease,
  normalizeStatKey,
  normalizeTier,
  oddsTotalHundredths,
  prepareRelease,
  toHundredths,
  validateRelease,
  type ContentReleaseInput,
} from "@/lib/contentRelease";

const TIERS = ["Bronze", "Silver", "Gold", "Emerald", "Sapphire", "Ruby", "Amethyst", "Diamond", "Pink Diamond", "Actolytrene"];

function card(name: string, tier: string, extra: Record<string, unknown> = {}) {
  return { name, gem_tier: tier, rating: 85, stats: { stat_3pt: 85 }, ...extra } as any;
}

function galactic(): ContentReleaseInput {
  const players = Array.from({ length: 11 }, (_, i) => card(`Galactic ${i + 1}`, "Emerald"));
  players.push(card("Galactic Reward", "Diamond", { is_collection_reward: true }));
  return {
    release: { name: "Galactic" },
    collection: {
      name: "Galactic",
      player_cards: players.map((p, i) => ({ player_name: p.name, slot: i + 1, is_reward: !!p.is_collection_reward })),
      reward_player_name: "Galactic Reward",
    },
    players,
    pack: {
      name: "Galactic Pack",
      cost: 5000,
      players: Array.from({ length: 11 }, (_, i) => ({ player_name: `Galactic ${i + 1}`, slot: i + 1 })),
      odds: [
        ...Array.from({ length: 10 }, (_, i) => ({ result_slot: String(i + 1), percentage: 9.09 })),
        { result_slot: "11", percentage: 9.1 },
      ],
    },
    evo_paths: [
      {
        player_name: "Galactic 1",
        steps: [
          {
            from_tier: "Emerald",
            to_tier: "Sapphire",
            step_order: 1,
            objectives: [{ stat: "points", amount: 200 }],
            resulting_version: { rating: 88, stats: { stat_3pt: 88 } },
          },
          {
            from_tier: "Sapphire",
            to_tier: "Ruby",
            step_order: 2,
            objectives: [{ stat: "three_pointers_made", amount: 50 }],
            resulting_version: { rating: 90, stats: { stat_3pt: 91 } },
          },
        ],
      },
    ],
  };
}

const errors = (input: ContentReleaseInput) =>
  validateRelease(input, { tierOrder: TIERS }).filter((v) => v.severity === "error");
const codes = (input: ContentReleaseInput) => errors(input).map((e) => e.code);

describe("normalization", () => {
  it("maps badge tier aliases", () => {
    expect(normalizeTier("Hall of Fame")).toBe("hof");
    expect(normalizeTier("HOF")).toBe("hof");
    expect(normalizeTier("Gold")).toBe("gold");
    expect(normalizeTier(undefined)).toBe("base");
  });

  it("maps stat aliases", () => {
    expect(normalizeStatKey("3PT")).toBe("stat_3pt");
    expect(normalizeStatKey("Mid Range")).toBe("stat_mid");
    expect(normalizeStatKey("stat_ast")).toBe("stat_ast");
  });

  it("maps objective aliases to registry keys", () => {
    expect(normalizeObjectiveKey("Three Pointers Made")).toBe("three_pointers_made");
    expect(normalizeObjectiveKey("PTS")).toBe("points");
    expect(normalizeObjectiveKey("wins")).toBe("games_won");
  });

  it("normalizes nested stats, badges and traits", () => {
    const out = normalizeRelease({
      release: { name: "x" },
      players: [{ name: "A", stats: { "3PT": 90 } as any, badges: ["Deadeye"] as any, traits: [{ trait: "T", target_stat: "3PT" }] as any }],
    });
    expect(out.players?.[0].stats).toEqual({ stat_3pt: 90 });
    expect(out.players?.[0].badges?.[0]).toEqual({ badge: "Deadeye", tier: "base" });
    expect(out.players?.[0].traits?.[0].target_stat).toBe("stat_3pt");
  });
});

describe("fixed-precision odds", () => {
  it("sums decimals exactly", () => {
    expect(oddsTotalHundredths([{ percentage: 33.33 }, { percentage: 33.33 }, { percentage: 33.34 }])).toBe(10000);
    expect(formatHundredths(10000)).toBe("100.00");
  });

  it("rejects more than two decimals", () => {
    expect(Number.isNaN(toHundredths("9.091"))).toBe(true);
  });

  it("flags totals that are not exactly 100", () => {
    const draft = galactic();
    draft.pack!.odds[0].percentage = 9.08;
    expect(codes(draft)).toContain("ODDS_NOT_100");
  });
});

describe("Galactic acceptance case", () => {
  it("validates clean", () => {
    expect(errors(galactic())).toEqual([]);
  });

  it("builds one atomic payload with every group", () => {
    const payload = buildReleasePayload(galactic()) as Record<string, any>;
    expect(payload.release_bundles).toHaveLength(1);
    expect(payload.players).toHaveLength(12);
    expect(payload.collections[0].reward_card_ref).toBe("ref:player:galactic-reward");
    expect(payload.collection_requirements[0].action).toBe("replace");
    expect(payload.collection_requirements[0].requirements).toHaveLength(12);
    expect(payload.packs[0].pool.map((p: any) => p.slot_number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(payload.packs[0].replace_odds).toBe(true);
    expect(payload.evo_paths).toHaveLength(2);
    expect(payload.evo_paths[0].resulting_version.stats).toEqual({ stat_3pt: 88 });
    expect(payload.evo_paths[0].objectives[0].stat_key).toBe("points");
  });

  it("keeps the collection reward out of the pack", () => {
    const draft = galactic();
    draft.pack!.players.push({ player_name: "Galactic Reward", slot: 12 });
    expect(codes(draft)).toContain("REWARD_IN_PACK");
  });

  it("allows only one completion reward", () => {
    const draft = galactic();
    draft.collection!.player_cards![0].is_reward = true;
    expect(codes(draft)).toContain("MULTIPLE_COLLECTION_REWARDS");
  });
});

describe("evo path and materialized versions", () => {
  it("requires a resulting version on every step", () => {
    const draft = galactic();
    delete (draft.evo_paths![0].steps[1] as any).resulting_version;
    expect(codes(draft)).toContain("MISSING_RESULTING_VERSION");
  });

  it("rejects skipped intermediate tiers", () => {
    const draft = galactic();
    draft.evo_paths![0].steps = [
      {
        from_tier: "Emerald",
        to_tier: "Diamond",
        step_order: 1,
        objectives: [{ stat: "points", amount: 100 }],
        resulting_version: { rating: 92, stats: { stat_3pt: 92 } },
      },
    ];
    expect(codes(draft)).toContain("MISSING_INTERMEDIATE_TIER");
  });

  it("allows configured tier skips (Diamond to Actolytrene)", () => {
    const draft = galactic();
    draft.players!.find((p) => p.name === "Galactic 1")!.gem_tier = "Diamond";
    draft.evo_paths![0].steps = [
      {
        from_tier: "Diamond",
        to_tier: "Actolytrene",
        step_order: 1,
        objectives: [{ stat: "points", amount: 500 }],
        resulting_version: { rating: 99, stats: { stat_3pt: 99 } },
      },
    ];
    const found = validateRelease(draft, { tierOrder: TIERS, allowedSkips: ["diamond>actolytrene"] })
      .filter((v) => v.severity === "error")
      .map((v) => v.code);
    expect(found).not.toContain("MISSING_INTERMEDIATE_TIER");
  });

  it("rejects backwards progression and broken chains", () => {
    const draft = galactic();
    draft.evo_paths![0].steps[1].from_tier = "Ruby";
    expect(codes(draft)).toContain("EVO_STEP_CHAIN");
  });

  it("rejects a first step that does not start at the base card tier", () => {
    const draft = galactic();
    draft.evo_paths![0].steps[0].from_tier = "Gold";
    expect(codes(draft)).toContain("EVO_FIRST_STEP_TIER");
  });

  it("rejects unsupported objectives", () => {
    const draft = galactic();
    draft.evo_paths![0].steps[0].objectives = [{ stat: "stat_pts", amount: 10 }];
    expect(codes(draft)).toContain("UNSUPPORTED_OBJECTIVE");
  });
});

describe("safety guards", () => {
  it("rejects duplicate player names without ids", () => {
    const draft = galactic();
    draft.players!.push(card("Galactic 1", "Emerald"));
    expect(codes(draft)).toContain("AMBIGUOUS_PLAYER_NAME");
  });

  it("rejects duplicate pool slots and unknown result slots", () => {
    const draft = galactic();
    draft.pack!.players[1].slot = 1;
    draft.pack!.odds[0].result_slot = "99";
    const found = codes(draft);
    expect(found).toContain("DUPLICATE_POOL_SLOT");
    expect(found).toContain("UNKNOWN_RESULT_SLOT");
  });

  it("rejects out-of-range stats", () => {
    const draft = galactic();
    (draft.players![0].stats as any).stat_3pt = 120;
    expect(codes(draft)).toContain("STAT_OUT_OF_RANGE");
  });

  it("rejects forbidden cross-release links", () => {
    const draft = galactic();
    draft.players![0].collection = "Old Set";
    draft.forbid_existing_links_to = ["Old Set"];
    expect(codes(draft)).toContain("FORBIDDEN_EXISTING_LINK");
  });

  it("rejects duplicate badge assignments", () => {
    const draft = galactic();
    draft.players![0].badges = [{ badge: "Deadeye" }, { badge: "deadeye" }];
    expect(codes(draft)).toContain("DUPLICATE_BADGE_ASSIGNMENT");
  });

  it("prepareRelease reports validity alongside the payload", () => {
    const prepared = prepareRelease(galactic(), { tierOrder: TIERS });
    expect(prepared.valid).toBe(true);
    expect(Object.keys(prepared.payload)).toContain("evo_paths");
  });
});
