// @vitest-environment node
/**
 * REGRESSION (Germond Neckar): two targeted admin surfaces must behave like safe
 * PATCHes against the REAL database functions.
 *
 *  1. evo_version_updates / evo_step_updates publish and link an existing evo
 *     version without rebuilding the path and without resetting untouched
 *     fields (Runs data, stats, badges) or downgrading status to draft.
 *  2. challenges are fully populated: target_value, win condition, series
 *     fields, rewards (coins/gems/card) and status survive the write, and a
 *     later PATCH that sends one field keeps everything else.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bootCommissionerDb, IDS, type CommissionerDb } from "./support/commissionerDb";

let h: CommissionerDb;

beforeAll(async () => {
  h = await bootCommissionerDb();
}, 180_000);
afterAll(async () => await h?.close());
beforeEach(async () => await h.reset());

/** One draft evo step plus its draft playable version, as the release builder leaves them. */
async function seedGermondStep() {
  const step = await h.one<{ id: string }>(
    `INSERT INTO public.evo_paths (player_card_id, step_order, from_tier_id, to_tier_id, status)
     VALUES ($1, 1, $2, $3, 'draft') RETURNING id`,
    [IDS.cardA, IDS.emerald, IDS.sapphire],
  );
  const version = await h.one<{ id: string }>(
    `INSERT INTO public.evo_card_versions
       (evo_path_id, base_player_card_id, version_order, gem_name, gem_tier_id, rating, run_rating,
        stat_3pt, run_stat_3pt, status)
     VALUES ($1, $2, 1, 'Sapphire', $3, 2.5, 50, 2.5, 50, 'draft') RETURNING id`,
    [step!.id, IDS.cardA, IDS.sapphire],
  );
  return { stepId: step!.id, versionId: version!.id };
}

describe("targeted evo version / step patches", () => {
  it("publishes a version and links the step without touching untouched fields", async () => {
    const { stepId, versionId } = await seedGermondStep();

    const payload = {
      evo_version_updates: [{ evo_version_id: versionId, status: "active" }],
      evo_step_updates: [{ evo_step_id: stepId, evolves_to_version_id: versionId, status: "active" }],
    };

    const preview = await h.batch(payload, false);
    expect(preview.wrote_anything ?? false).toBe(false);
    // Preview must expose both planned writes as updates, never as creates.
    expect(JSON.stringify(preview.updates ?? [])).toContain(versionId);
    expect(JSON.stringify(preview.creates ?? [])).not.toContain(versionId);

    // Nothing was written by the preview.
    const stillDraft = await h.one<{ status: string }>(
      "SELECT status::text AS status FROM public.evo_card_versions WHERE id = $1",
      [versionId],
    );
    expect(stillDraft!.status).toBe("draft");

    await h.batch(payload, true, preview.preview_token);

    const version = await h.one<Record<string, any>>(
      "SELECT status::text AS status, rating, run_rating, stat_3pt, run_stat_3pt FROM public.evo_card_versions WHERE id = $1",
      [versionId],
    );
    expect(version!.status).toBe("active");
    expect(Number(version!.rating)).toBeCloseTo(2.5, 6);
    expect(Number(version!.run_rating)).toBe(50);
    expect(Number(version!.run_stat_3pt)).toBe(50);

    const step = await h.one<Record<string, any>>(
      "SELECT status::text AS status, evolves_to_version_id, step_order FROM public.evo_paths WHERE id = $1",
      [stepId],
    );
    expect(step!.status).toBe("active");
    expect(step!.evolves_to_version_id).toBe(versionId);
    expect(Number(step!.step_order)).toBe(1);
  });

  it("rejects an unknown field and a missing id without writing", async () => {
    const { versionId } = await seedGermondStep();
    await expect(
      h.batch({ evo_version_updates: [{ evo_version_id: versionId, nickname: "Germond" }] }, false),
    ).rejects.toThrow(/UNSUPPORTED_FIELD/);
    await expect(h.batch({ evo_step_updates: [{ status: "active" }] }, false)).rejects.toThrow(
      /EVO_STEP_ID_REQUIRED|UNKNOWN_EVO_STEP/,
    );
  });
});

describe("challenge canonicalization", () => {
  const germondChallenge = {
    action: "upsert",
    name: "Germond Neckar Showcase",
    description: "Beat the Gold squad with Germond in the lineup.",
    challenge_type: "points_scored",
    win_condition: "win_by",
    win_by_amount: 12,
    target_value: 150,
    series_length: 3,
    series_win_coins: 900,
    series_loss_coins: 100,
    coin_reward: 2500,
    gem_reward: 40,
    card_reward_id: IDS.cardA,
    is_repeatable: true,
    sort_order: 4,
    status: "active",
  };

  it("writes every supplied challenge field and keeps the active status", async () => {
    const preview = await h.batch({ challenges: [germondChallenge] }, false);
    expect(JSON.stringify(preview.creates ?? [])).toContain("Germond Neckar Showcase");
    await h.batch({ challenges: [germondChallenge] }, true, preview.preview_token);

    const row = await h.one<Record<string, any>>(
      "SELECT * FROM public.challenges WHERE lower(name) = lower($1)",
      ["Germond Neckar Showcase"],
    );
    expect(row).toBeTruthy();
    expect(String(row!.status)).toBe("active");
    expect(Number(row!.target_value)).toBe(150);
    expect(Number(row!.win_by_amount)).toBe(12);
    expect(Number(row!.series_length)).toBe(3);
    expect(Number(row!.coin_reward)).toBe(2500);
    expect(Number(row!.gem_reward)).toBe(40);
    expect(row!.card_reward_id).toBe(IDS.cardA);
    expect(row!.is_repeatable).toBe(true);
  });

  it("PATCHes one field and preserves the rest", async () => {
    const first = await h.batch({ challenges: [germondChallenge] }, false);
    await h.batch({ challenges: [germondChallenge] }, true, first.preview_token);

    const patch = { challenges: [{ action: "upsert", name: "Germond Neckar Showcase", coin_reward: 3000 }] };
    const preview = await h.batch(patch, false);
    await h.batch(patch, true, preview.preview_token);

    const row = await h.one<Record<string, any>>(
      "SELECT * FROM public.challenges WHERE lower(name) = lower($1)",
      ["Germond Neckar Showcase"],
    );
    expect(Number(row!.coin_reward)).toBe(3000);
    // Untouched fields survive, and status is never forced back to draft.
    expect(String(row!.status)).toBe("active");
    expect(Number(row!.target_value)).toBe(150);
    expect(Number(row!.gem_reward)).toBe(40);
    expect(Number(row!.series_length)).toBe(3);
    expect(row!.card_reward_id).toBe(IDS.cardA);
  });
});
