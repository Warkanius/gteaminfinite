// @vitest-environment node
/**
 * Commissioner operation matrix against the real dumped SQL.
 *
 * Each case answers one question the previous audits got wrong:
 *   - does preview classify an EXISTING record as an update even though the item
 *     carries a same-release link?
 *   - does an evo whole-path replacement update in place, add, and delete?
 *   - is the committed state exactly what the preview promised?
 *   - does a failing item leave nothing behind?
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bootCommissionerDb, IDS, planFor, type CommissionerDb } from "./support/commissionerDb";

let h: CommissionerDb;
const RELEASE_REF = "ref:release:main";

beforeAll(async () => {
  h = await bootCommissionerDb();
}, 180_000);
afterAll(async () => await h?.close());
beforeEach(async () => await h.reset());

const releaseBundle = () => [
  { temp_ref: RELEASE_REF, action: "upsert", name: "Audit Matrix Release", status: "draft" },
];

const objective = (order: number) => ({
  key: "points",
  objective_type: "total_stat",
  stat_key: "points",
  target: 100 * order,
  sort_order: 1,
});

const stepDoc = (order: number, from: string, to: string) => ({
  from_tier: from,
  to_tier: to,
  step_order: order,
  objectives: [objective(order)],
  resulting_version: { rating: 1 + order, gem_name: to, stats: { stat_3pt: 60 + order } },
});

const replacePath = (steps: ReturnType<typeof stepDoc>[]) => ({
  release_bundles: releaseBundle(),
  evo_paths: [
    { action: "replace_path", player_card_id: IDS.cardA, steps, release_bundle_ref: RELEASE_REF },
  ],
});

async function pathRows() {
  return await h.rows<{ id: string; step_order: number; objectives: number; versions: number }>(
    `SELECT p.id, p.step_order,
            (SELECT count(*)::int FROM public.evo_objectives o WHERE o.evo_path_id = p.id) AS objectives,
            (SELECT count(*)::int FROM public.evo_card_versions v WHERE v.evo_path_id = p.id) AS versions
       FROM public.evo_paths p WHERE p.player_card_id = $1 ORDER BY p.step_order`,
    [IDS.cardA],
  );
}

describe("preview classification with same-release links", () => {
  it("classifies an existing player card as an update, not a create", async () => {
    const plan = await h.batch(
      {
        release_bundles: releaseBundle(),
        players: [
          { action: "upsert", player_card_id: IDS.cardA, rating: 1.6, release_bundle_ref: RELEASE_REF },
        ],
      },
      false,
    );

    expect(planFor(plan, "creates", "player_cards")).toHaveLength(0);
    const updates = planFor(plan, "updates", "player_cards");
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe(IDS.cardA);
  });

  it("reports the deferred release link instead of hiding it", async () => {
    const plan = await h.batch(
      {
        release_bundles: releaseBundle(),
        players: [{ action: "upsert", player_card_id: IDS.cardB, rating: 2.2, release_bundle_ref: RELEASE_REF }],
      },
      false,
    );
    const warnings = (plan.warnings as Record<string, unknown>[]) ?? [];
    const deferred = warnings.filter((w) => w.code === "DEFERRED_SAME_BATCH_LINK");
    // Either the link resolved for real (release_bundles run first) or it is
    // explicitly reported as deferred — never silently dropped.
    const resolved = JSON.stringify(plan.resolved_references ?? []);
    expect(deferred.length > 0 || resolved.includes("release")).toBe(true);
  });

  it("still classifies a genuinely new card as a create", async () => {
    const plan = await h.batch(
      {
        release_bundles: releaseBundle(),
        players: [
          { action: "upsert", name: "Brand New Rookie", gem_tier: "Emerald", rating: 1.5, release_bundle_ref: RELEASE_REF },
        ],
      },
      false,
    );
    expect(planFor(plan, "creates", "player_cards")).toHaveLength(1);
    expect(planFor(plan, "updates", "player_cards")).toHaveLength(0);
  });
});

describe("evo whole-path replacement", () => {
  it("updates existing steps in place, adds new ones and deletes leftovers", async () => {
    // three existing steps
    const first = await h.previewThenCommit(
      replacePath([stepDoc(1, "Emerald", "Sapphire"), stepDoc(2, "Sapphire", "Ruby"), stepDoc(3, "Ruby", "Amethyst")]),
    );
    expect(first.commit.applied).toBe(true);
    const before = await pathRows();
    expect(before).toHaveLength(3);

    // authoritative replacement with only two steps
    const plan = await h.batch(
      replacePath([stepDoc(1, "Emerald", "Sapphire"), stepDoc(2, "Sapphire", "Ruby")]),
      false,
    );
    expect(planFor(plan, "creates", "evo_paths")).toHaveLength(0);
    expect(planFor(plan, "updates", "evo_paths")).toHaveLength(2);
    const deletes = planFor(plan, "deletes", "evo_paths");
    expect(deletes).toHaveLength(1);
    expect(deletes[0].id).toBe(before[2].id);

    const commit = await h.batch(
      replacePath([stepDoc(1, "Emerald", "Sapphire"), stepDoc(2, "Sapphire", "Ruby")]),
      true,
      plan.preview_token as string,
    );
    expect(commit.applied).toBe(true);

    const after = await pathRows();
    expect(after.map((r) => r.id)).toEqual([before[0].id, before[1].id]);
    expect(after.map((r) => r.objectives)).toEqual([1, 1]);
    expect(after.map((r) => r.versions)).toEqual([1, 1]);
    // the deleted step took its children with it
    expect(await h.count(`SELECT count(*)::int AS c FROM public.evo_objectives WHERE evo_path_id = $1`, [before[2].id])).toBe(0);
    expect(await h.count(`SELECT count(*)::int AS c FROM public.evo_card_versions WHERE evo_path_id = $1`, [before[2].id])).toBe(0);
  });

  it("never leaves two steps sharing a step_order", async () => {
    await h.previewThenCommit(replacePath([stepDoc(1, "Emerald", "Sapphire"), stepDoc(2, "Sapphire", "Ruby")]));
    await h.previewThenCommit(replacePath([stepDoc(1, "Emerald", "Ruby"), stepDoc(2, "Ruby", "Amethyst")]));
    const rows = await pathRows();
    expect(rows.map((r) => r.step_order)).toEqual([1, 2]);
  });

  it("rejects a duplicated step_order with zero writes", async () => {
    await expect(
      h.batch(replacePath([stepDoc(1, "Emerald", "Sapphire"), stepDoc(1, "Sapphire", "Ruby")]), false),
    ).rejects.toThrow(/DUPLICATE_STEP_ORDER/);
    expect(await pathRows()).toHaveLength(0);
  });

  it("refuses to wipe a path through an empty replacement", async () => {
    await h.previewThenCommit(replacePath([stepDoc(1, "Emerald", "Sapphire")]));
    await expect(h.batch(replacePath([]), false)).rejects.toThrow(/EMPTY_EVO_PATH/);
    expect(await pathRows()).toHaveLength(1);
  });

  it("rolls the whole release back when a later step is invalid", async () => {
    const bad = replacePath([stepDoc(1, "Emerald", "Sapphire"), stepDoc(2, "Sapphire", "No Such Tier")]);
    await expect(h.batch(bad, false)).rejects.toThrow();
    expect(await pathRows()).toHaveLength(0);
  });

  it("commits only the exact approved payload", async () => {
    const payload = replacePath([stepDoc(1, "Emerald", "Sapphire")]);
    const preview = await h.batch(payload, false);
    const tampered = replacePath([stepDoc(1, "Emerald", "Ruby")]);
    await expect(h.batch(tampered, true, preview.preview_token as string)).rejects.toThrow(/PREVIEW_MISMATCH/);
    expect(await pathRows()).toHaveLength(0);
  });

  it("reports every created and updated step id back to the commissioner", async () => {
    const { preview, commit } = await h.previewThenCommit(
      replacePath([stepDoc(1, "Emerald", "Sapphire"), stepDoc(2, "Sapphire", "Ruby")]),
    );
    expect(preview.payload_hash).toBe(commit.payload_hash);
    const rows = await pathRows();
    const reported = JSON.stringify(commit.results);
    for (const row of rows) expect(reported).toContain(row.id);
  });
});
