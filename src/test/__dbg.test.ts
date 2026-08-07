// @vitest-environment node
import { beforeAll, describe, it } from "vitest";
import { bootCommissionerDb, IDS, type CommissionerDb } from "/dev-server/src/test/support/commissionerDb";
let h: CommissionerDb;
beforeAll(async () => { h = await bootCommissionerDb(); }, 180_000);
describe("dbg", () => {
  it("commit one new step", async () => {
    const payload = { evo_paths: [{ action: "replace_path", player_card_id: IDS.cardA, steps: [
      { from_tier: "Emerald", to_tier: "Sapphire", step_order: 1,
        objectives: [{ key: "points", objective_type: "total_stat", stat_key: "points", target: 100, sort_order: 1 }],
        resulting_version: { rating: 2, gem_name: "Sapphire", stats: { stat_3pt: 61 } } }] }] };
    const p = await h.batch(payload, false);
    console.log("PREVIEW", JSON.stringify({creates:p.creates, warnings:p.warnings}, null, 1).slice(0, 2500));
    const c = await h.batch(payload, true, p.preview_token as string);
    console.log("COMMIT", JSON.stringify({applied:c.applied, results:c.results}, null, 1).slice(0, 3000));
    console.log("ROWS", JSON.stringify(await h.rows("SELECT id, step_order FROM public.evo_paths")));
    await h.close();
  });
});
