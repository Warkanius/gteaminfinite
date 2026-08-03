import { describe, expect, it } from "vitest";
import {
  buildBundlePayload,
  emptyDraft,
  oddsTotal,
  validateDraft,
  type ReleaseDraft,
} from "@/lib/releaseBundle";

const TIERS = ["Gold", "Emerald", "Amethyst", "Diamond", "Pink Diamond", "Actolytrene"];

function galacticDraft(): ReleaseDraft {
  const players = Array.from({ length: 11 }, (_, i) => ({
    name: `Galactic ${i + 1}`,
    card_key: `galactic-${i + 1}`,
    gem_tier: "Diamond",
    rating: 90 + i / 10,
  }));
  players.push({
    name: "Galactic Reward",
    card_key: "galactic-reward",
    gem_tier: "Pink Diamond",
    rating: 96,
    is_reward_card: true,
  } as never);
  return {
    ...emptyDraft(),
    release: { name: "Galactic", version_label: "v1", version_number: 1, status: "draft" },
    collection: { name: "Galactic", reward_card: "Galactic Reward", members: players.map((p) => p.name) },
    players,
    pack: {
      name: "Galactic",
      pack_type: "standard",
      cost: 1000,
      ten_box_cost: 9000,
      status: "draft",
      pool: players.slice(0, 11).map((p, i) => ({ slot_number: i + 1, player: p.name })),
      odds: [
        { dice_roll: "1-5", result_slot: "1", percentage: 50 },
        { dice_roll: "6-9", result_slot: "2", percentage: 30 },
        { dice_roll: "10", result_slot: "3", percentage: 20 },
      ],
    },
    evo_paths: [
      {
        player: "Galactic 1",
        final_tier: "Actolytrene",
        steps: [
          { step_order: 1, from_tier: "Diamond", to_tier: "Pink Diamond", objectives: [{ key: "points", target: 100 }] },
          { step_order: 2, from_tier: "Pink Diamond", to_tier: "Actolytrene", objectives: [{ key: "games_won", target: 5 }] },
        ],
      },
    ],
  };
}

const errors = (d: ReleaseDraft) => validateDraft(d, TIERS).filter((i) => i.severity === "error");

describe("release bundle validation", () => {
  it("accepts 11 pack cards plus one excluded collection reward", () => {
    expect(errors(galacticDraft())).toEqual([]);
  });

  it("rejects the reward card appearing in the pack pool", () => {
    const d = galacticDraft();
    d.pack!.pool.push({ slot_number: 12, player: "Galactic Reward" });
    expect(errors(d).some((e) => /collection reward/i.test(e.message))).toBe(true);
  });

  it("requires odds to total exactly 100%", () => {
    const d = galacticDraft();
    d.pack!.odds[0].percentage = 49;
    expect(errors(d).some((e) => /must be exactly 100/.test(e.message))).toBe(true);
  });

  it("rejects duplicate pack slots", () => {
    const d = galacticDraft();
    d.pack!.pool[1].slot_number = 1;
    expect(errors(d).some((e) => /Duplicate slot/.test(e.message))).toBe(true);
  });

  it("rejects odds pointing at a slot outside the pool", () => {
    const d = galacticDraft();
    d.pack!.odds[0].result_slot = "99";
    expect(errors(d).some((e) => /does not exist in the pool/.test(e.message))).toBe(true);
  });

  it("rejects ambiguous duplicate card references in one release", () => {
    const d = galacticDraft();
    d.players.push({ name: "Galactic 1", card_key: "galactic-1" });
    expect(errors(d).some((e) => /disambiguate/.test(e.message))).toBe(true);
  });

  it("rejects more than one collection reward", () => {
    const d = galacticDraft();
    d.players[0].is_reward_card = true;
    expect(errors(d).some((e) => /Exactly one card/.test(e.message))).toBe(true);
  });

  it("rejects a reward card that is not part of the release", () => {
    const d = galacticDraft();
    d.collection!.reward_card = "Nobody";
    expect(errors(d).some((e) => /not part of this release/.test(e.message))).toBe(true);
  });

  it("rejects an unsupported evo objective key", () => {
    const d = galacticDraft();
    d.evo_paths![0].steps[0].objectives = [{ key: "vibes", target: 5 }];
    expect(errors(d).some((e) => /Unsupported objective/.test(e.message))).toBe(true);
  });

  it("rejects non-positive-integer objective targets", () => {
    const d = galacticDraft();
    d.evo_paths![0].steps[0].objectives = [{ key: "points", target: 0 }];
    expect(errors(d).some((e) => /positive integer/.test(e.message))).toBe(true);
  });

  it("rejects a skipped intermediate evo tier", () => {
    const d = galacticDraft();
    d.evo_paths![0].steps = [
      { step_order: 1, from_tier: "Diamond", to_tier: "Actolytrene", objectives: [{ key: "points", target: 10 }] },
    ];
    d.evo_paths![0].final_tier = "Actolytrene";
    expect(errors(d).some((e) => /skips intermediate/.test(e.message))).toBe(true);
  });

  it("rejects an unknown tier and an out-of-range stat", () => {
    const d = galacticDraft();
    d.evo_paths![0].steps[0].from_tier = "Obsidian";
    d.evo_paths![0].steps[1].final_stats = { stat_3pt: 140 };
    const found = errors(d).map((e) => e.message).join(" ");
    expect(found).toMatch(/Unknown tier/);
    expect(found).toMatch(/between 0 and 99/);
  });

  it("rejects discontinuous step order and a final tier mismatch", () => {
    const d = galacticDraft();
    d.evo_paths![0].steps[1].step_order = 3;
    d.evo_paths![0].final_tier = "Diamond";
    const found = errors(d).map((e) => e.message).join(" ");
    expect(found).toMatch(/continuous from 1/);
    expect(found).toMatch(/declared final tier/);
  });

  it("sums odds precisely", () => {
    expect(oddsTotal([{ dice_roll: "", result_slot: "1", percentage: 33.33 }, { dice_roll: "", result_slot: "2", percentage: 66.67 }])).toBe(100);
  });
});

describe("release bundle payload", () => {
  it("preserves pack slot order and evo step order", () => {
    const payload = buildBundlePayload(galacticDraft()) as Record<string, any>;
    expect(payload.packs[0].pool.map((s: any) => s.slot_number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(payload.evo_paths.map((p: any) => p.step_order)).toEqual([1, 2]);
    expect(payload.evo_paths[0].objectives[0]).toMatchObject({ objective_type: "total_stat", stat_key: "stat_pts", target: 100 });
  });

  it("marks pool, odds and membership as destructive replacements", () => {
    const payload = buildBundlePayload(galacticDraft()) as Record<string, any>;
    expect(payload.packs[0].replace_pool).toBe(true);
    expect(payload.packs[0].replace_odds).toBe(true);
    expect(payload.collection_requirements[0].action).toBe("replace");
  });

  it("keeps the collection reward out of the pack pool and flags it in membership", () => {
    const payload = buildBundlePayload(galacticDraft()) as Record<string, any>;
    const refs = payload.packs[0].pool.map((s: any) => s.player_ref);
    expect(refs).not.toContain("ref:player:galactic-reward");
    const reward = payload.collection_requirements[0].requirements.find((r: any) => r.player_ref === "ref:player:galactic-reward");
    expect(reward.is_reward_card).toBe(true);
  });

  it("only ever emits groups for the content in the draft (no unrelated releases touched)", () => {
    const d = emptyDraft();
    d.release.name = "Empty";
    const payload = buildBundlePayload(d) as Record<string, any>;
    expect(Object.keys(payload)).toEqual(["release_bundles"]);
    expect(payload.release_bundles[0].name).toBe("Empty");
  });
});
