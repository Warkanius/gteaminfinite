// @vitest-environment node
/**
 * REGRESSION: preview must classify an evo-step replacement as an update of the
 * existing steps, never as three fresh creates.
 *
 * This reproduces the Zach LaVine repair case: a card that already owns three
 * evo steps receives a full replacement payload shaped exactly like the one the
 * content-release builder produces (every item carries release_bundle_ref).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bootCommissionerDb, IDS, planFor, type CommissionerDb } from "./support/commissionerDb";

let h: CommissionerDb;

const RELEASE_REF = "ref:release:main";

function step(order: number, from: string, to: string) {
  return {
    action: "upsert",
    player_card_id: IDS.cardA,
    from_tier: from,
    to_tier: to,
    step_order: order,
    objectives: [{ objective_type: "points_scored", target: 200 + order, sort_order: 1 }],
    resulting_version: { rating: 2 + order, gem_name: to, stats: { stat_3pt: 70 + order } },
    release_bundle_ref: RELEASE_REF,
  };
}

const releasePayload = () => ({
  release_bundles: [{ temp_ref: RELEASE_REF, action: "upsert", name: "Matrix Release", status: "draft" }],
  evo_paths: [step(1, "Emerald", "Sapphire"), step(2, "Sapphire", "Ruby"), step(3, "Ruby", "Amethyst")],
});

beforeAll(async () => {
  h = await bootCommissionerDb();
}, 180_000);
afterAll(async () => await h?.close());
beforeEach(async () => await h.reset());

/** Puts three pre-existing (corrupt, objective-less) steps on the card. */
async function seedExistingPath() {
  const ids: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const r = await h.one<{ id: string }>(
      `INSERT INTO public.evo_paths (player_card_id, step_order, from_tier_id, to_tier_id)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [IDS.cardA, i, IDS.emerald, IDS.sapphire],
    );
    ids.push(r!.id);
  }
  return ids;
}

describe("evo step replacement classification", () => {
  it("classifies a replacement of three existing steps as updates, not creates", async () => {
    const existing = await seedExistingPath();
    const plan = await h.batch(releasePayload(), false);

    const creates = planFor(plan, "creates", "evo_paths");
    const updates = planFor(plan, "updates", "evo_paths");

    expect(creates).toHaveLength(0);
    expect(updates).toHaveLength(3);
    expect(updates.map((u) => u.id).sort()).toEqual([...existing].sort());
  });

  it("commits the replacement in place: same ids, no duplicate step orders", async () => {
    const existing = await seedExistingPath();
    const { commit } = await h.previewThenCommit(releasePayload());
    expect(commit.applied).toBe(true);

    const steps = await h.rows<{ id: string; step_order: number }>(
      "SELECT id, step_order FROM public.evo_paths WHERE player_card_id=$1 ORDER BY step_order",
      [IDS.cardA],
    );
    expect(steps).toHaveLength(3);
    expect(steps.map((s) => s.id).sort()).toEqual([...existing].sort());
    expect(steps.map((s) => s.step_order)).toEqual([1, 2, 3]);

    const objectives = await h.count(
      `SELECT count(*)::int c FROM public.evo_objectives o
        JOIN public.evo_paths p ON p.id=o.evo_path_id WHERE p.player_card_id=$1`,
      [IDS.cardA],
    );
    expect(objectives).toBe(3);

    const versions = await h.count(
      "SELECT count(*)::int c FROM public.evo_card_versions WHERE base_player_card_id=$1",
      [IDS.cardA],
    );
    expect(versions).toBe(3);
  });

  it("a brand-new path on a card without steps is classified as creates", async () => {
    const plan = await h.batch(releasePayload(), false);
    expect(planFor(plan, "creates", "evo_paths")).toHaveLength(3);
    expect(planFor(plan, "updates", "evo_paths")).toHaveLength(0);
  });
});
