/**
 * Integration regression tests for the evo-objective write + post-commit
 * verification path.
 *
 * These run the REAL production SQL bodies (pulled from the live database and
 * checked in under src/test/sql) inside an embedded Postgres (PGlite) with the
 * real table definitions, defaults, foreign keys and plpgsql semantics — not a
 * mocked repository.
 *
 * The regression they guard: admin_apply_evo_core used to report the evo PATH id
 * under `table: "evo_objectives"`, so content_release_verify looked those ids up
 * in evo_objectives, never found them, and rolled back a healthy release.
 */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const SQL_DIR = join(process.cwd(), "src/test/sql");
const file = (n: string) => readFileSync(join(SQL_DIR, n), "utf8");

const CARD_ONE = "bbbbbbbb-0000-0000-0000-000000000001";
const CARD_TWO = "bbbbbbbb-0000-0000-0000-000000000002";

let db: PGlite;

/** One evo step: 3 objectives + a materialized playable version. */
function evoStep(cardId: string, stepOrder = 1) {
  return {
    player_card_id: cardId,
    from_tier: "Emerald",
    to_tier: "Sapphire",
    step_order: stepOrder,
    objectives: [
      { objective_type: "stat_total", stat_key: "stat_3pt", target: 50, sort_order: 1 },
      { objective_type: "stat_total", stat_key: "stat_ast", target: 30, sort_order: 2 },
      { objective_type: "games_won", target: 10, sort_order: 3 },
    ],
    resulting_version: { rating: 85, gem_name: "Sapphire", stats: { stat_3pt: 85, stat_ast: 80 } },
  };
}

async function applyEvo(item: unknown, commit: boolean) {
  const res = await db.query<{ r: Record<string, any> }>("SELECT public.admin_apply_evo($1::jsonb, $2) AS r", [
    JSON.stringify(item),
    commit,
  ]);
  return res.rows[0].r;
}

/** Wraps operation results the way admin_apply_batch hands them to the verifier. */
async function verify(results: unknown[]) {
  const res = await db.query<{ v: Record<string, any> }>("SELECT public.content_release_verify($1::jsonb) AS v", [
    JSON.stringify({ results }),
  ]);
  return res.rows[0].v;
}

function objectiveOps(result: Record<string, any>) {
  return (result.operations as any[]).filter((o) => o.table === "evo_objectives");
}

beforeAll(async () => {
  db = new PGlite();
  for (const f of ["bootstrap.sql", "ddl.sql", "seed.sql", "helpers.sql", "evo.sql"]) {
    await db.exec(file(f));
  }
}, 120_000);

afterAll(async () => {
  await db?.close();
});

describe("evo objectives: identity, insertion and verification", () => {
  it("preview writes nothing and fabricates no objective ids", async () => {
    await db.exec("BEGIN");
    const res = await applyEvo(evoStep(CARD_ONE), false);
    const ops = objectiveOps(res);
    expect(ops).toHaveLength(1);
    expect(ops[0].action).toBe("planned_replace");
    expect(ops[0].id).toBeUndefined();
    expect(ops[0].expected_count).toBe(3);

    const counts = await db.query<{ p: number; o: number; v: number }>(
      "SELECT (SELECT count(*) FROM evo_paths)::int p, (SELECT count(*) FROM evo_objectives)::int o, (SELECT count(*) FROM evo_card_versions)::int v",
    );
    expect(counts.rows[0]).toEqual({ p: 0, o: 0, v: 0 });
    await db.exec("ROLLBACK");
  });

  it("commits one path + one version + three objectives with consistent ids and passes verification", async () => {
    await db.exec("BEGIN");
    const res = await applyEvo(evoStep(CARD_ONE), true);
    const pathId = res.id as string;
    const versionId = (res.evo_card_version.operations as any[]).find((o) => o.table === "evo_card_versions")?.id;
    expect(pathId).toBeTruthy();
    expect(versionId).toBeTruthy();

    const ops = objectiveOps(res);
    expect(ops).toHaveLength(3);

    // ids reported by the commit == ids returned by the insert readback
    const reportedIds = ops.map((o) => o.id).sort();
    const insertedIds = (res.evo_objectives as any[]).map((o) => o.id).sort();
    expect(insertedIds).toEqual(reportedIds);

    // ids reported by the commit == ids actually stored, with the right parent
    const rows = await db.query<{ id: string; evo_path_id: string; objective_type: string; target: string; sort_order: number }>(
      "SELECT id, evo_path_id, objective_type, target::text, sort_order FROM evo_objectives ORDER BY sort_order",
    );
    expect(rows.rows.map((r) => r.id).sort()).toEqual(reportedIds);
    expect(rows.rows.every((r) => r.evo_path_id === pathId)).toBe(true);
    expect(rows.rows.map((r) => r.objective_type)).toEqual(["stat_total", "stat_total", "games_won"]);
    expect(rows.rows.map((r) => Number(r.target))).toEqual([50, 30, 10]);
    expect(rows.rows.map((r) => r.sort_order)).toEqual([1, 2, 3]);

    // every objective op carries the true parent foreign key column value
    expect(ops.every((o) => o.parent_id === pathId && o.parent_table === "evo_paths")).toBe(true);
    expect(ops.every((o) => o.fields.evo_path_id === pathId)).toBe(true);

    const v = await verify([{ result: res }]);
    expect(v.verification_errors).toEqual([]);
    expect(v.verified).toBe(true);
    expect((v.evo_objective_ids as string[]).sort()).toEqual(reportedIds);
    expect(v.evo_path_ids).toContain(pathId);
    expect(v.evo_version_ids).toContain(versionId);
    await db.exec("ROLLBACK");
  });

  it("verifies successfully through a fresh read after the transaction commits", async () => {
    await db.exec("BEGIN");
    const res = await applyEvo(evoStep(CARD_ONE), true);
    await db.exec("COMMIT");

    // fresh statement / new implicit transaction, exactly like a post-commit read
    const v = await verify([{ result: res }]);
    expect(v.verified).toBe(true);
    const stored = await db.query<{ c: number }>("SELECT count(*)::int c FROM evo_objectives WHERE evo_path_id = $1", [
      res.id,
    ]);
    expect(stored.rows[0].c).toBe(3);
    await db.exec("DELETE FROM evo_paths");
  });

  it("commits multiple players' paths, versions and objectives atomically in one release", async () => {
    await db.exec("BEGIN");
    const a = await applyEvo(evoStep(CARD_ONE), true);
    const b = await applyEvo(evoStep(CARD_TWO), true);
    const v = await verify([{ result: a }, { result: b }]);
    expect(v.verified).toBe(true);
    expect(v.evo_objective_ids).toHaveLength(6);
    expect(new Set(v.evo_objective_ids as string[]).size).toBe(6);

    const perPath = await db.query<{ evo_path_id: string; c: number }>(
      "SELECT evo_path_id, count(*)::int c FROM evo_objectives GROUP BY evo_path_id ORDER BY 2",
    );
    expect(perPath.rows.map((r) => r.c)).toEqual([3, 3]);
    expect(perPath.rows.map((r) => r.evo_path_id).sort()).toEqual([a.id, b.id].sort());
    await db.exec("ROLLBACK");
  });

  it("re-applying the same step is idempotent: 3 objectives, no duplicates", async () => {
    await db.exec("BEGIN");
    const first = await applyEvo(evoStep(CARD_ONE), true);
    const second = await applyEvo(evoStep(CARD_ONE), true);
    expect(second.id).toBe(first.id);

    const rows = await db.query<{ c: number; d: number }>(
      "SELECT count(*)::int c, count(DISTINCT (objective_type, stat_key, target, sort_order))::int d FROM evo_objectives WHERE evo_path_id = $1",
      [first.id],
    );
    expect(rows.rows[0].c).toBe(3);
    expect(rows.rows[0].d).toBe(3);
    expect(await verify([{ result: second }]).then((v) => v.verified)).toBe(true);
    await db.exec("ROLLBACK");
  });

  it("a real objective insert failure rolls the whole release back", async () => {
    await db.exec(`CREATE OR REPLACE FUNCTION public.block_objectives() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'simulated objective insert failure'; END $$;
      CREATE TRIGGER block_objectives BEFORE INSERT ON public.evo_objectives FOR EACH ROW EXECUTE FUNCTION public.block_objectives();`);
    await db.exec("BEGIN");
    await expect(applyEvo(evoStep(CARD_ONE), true)).rejects.toThrow(/simulated objective insert failure/);
    await db.exec("ROLLBACK");
    await db.exec("DROP TRIGGER block_objectives ON public.evo_objectives");

    const left = await db.query<{ p: number; o: number; v: number }>(
      "SELECT (SELECT count(*) FROM evo_paths)::int p, (SELECT count(*) FROM evo_objectives)::int o, (SELECT count(*) FROM evo_card_versions)::int v",
    );
    expect(left.rows[0]).toEqual({ p: 0, o: 0, v: 0 });
  });

  it("reports precise diagnostics for a genuine verification mismatch", async () => {
    await db.exec("BEGIN");
    const res = await applyEvo(evoStep(CARD_ONE), true);
    const ops = objectiveOps(res);

    // missing row (this is exactly the shape the old bug produced: a path id
    // reported under the evo_objectives table)
    const missing = await verify([
      { result: { operations: [{ ...ops[0], id: res.id }] } },
    ]);
    expect(missing.verified).toBe(false);
    const e1 = (missing.verification_errors as any[])[0];
    expect(e1.code).toBe("VERIFICATION_ROW_MISSING");
    expect(e1.stage).toBe("verification_query");
    expect(e1.table).toBe("evo_objectives");
    expect(e1.expected_id).toBe(res.id);
    expect(e1.found_id).toBeNull();
    expect(e1.expected_parent_id).toBe(res.id);
    expect(e1.columns).toEqual(["id", "evo_path_id"]);

    // value mismatch on a row that does exist
    const wrong = await verify([
      { result: { operations: [{ ...ops[0], fields: { ...ops[0].fields, target: 999 } }] } },
    ]);
    const e2 = (wrong.verification_errors as any[])[0];
    expect(wrong.verified).toBe(false);
    expect(e2.code).toBe("VERIFICATION_MISMATCH");
    expect(e2.stage).toBe("verification_compare");
    expect(e2.expected.target).toBe(999);
    expect(Number(e2.found.target)).toBe(Number(ops[0].fields.target));
    expect(e2.found_parent_id).toBe(res.id);

    // count mismatch (an objective disappeared behind the verifier's back)
    await db.query("DELETE FROM evo_objectives WHERE evo_path_id = $1 AND sort_order = 3", [res.id]);
    const count = await verify([{ result: { operations: [ops[0]] } }]);
    const e3 = (count.verification_errors as any[])[0];
    expect(count.verified).toBe(false);
    expect(e3.code).toBe("VERIFICATION_COUNT_MISMATCH");
    expect(e3.expected_count).toBe(3);
    expect(e3.found_count).toBe(2);
    await db.exec("ROLLBACK");
  });

  it("catches a parent foreign-key mismatch", async () => {
    await db.exec("BEGIN");
    const one = await applyEvo(evoStep(CARD_ONE), true);
    const two = await applyEvo(evoStep(CARD_TWO), true);
    const ops = objectiveOps(one);
    const mismatched = await verify([{ result: { operations: [{ ...ops[0], parent_id: two.id }] } }]);
    const err = (mismatched.verification_errors as any[])[0];
    expect(mismatched.verified).toBe(false);
    expect(err.code).toBe("VERIFICATION_PARENT_MISMATCH");
    expect(err.expected_parent_id).toBe(two.id);
    expect(err.found_parent_id).toBe(one.id);
    await db.exec("ROLLBACK");
  });
});
