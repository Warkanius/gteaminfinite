import { describe, it, expect } from "vitest";
import { handleAdminApi } from "../../supabase/functions/_shared/admin-api/router";

// ---------------------------------------------------------------- fake backend
type Row = Record<string, any>;

function fakeDb() {
  const tables: Record<string, Row[]> = { admin_api_previews: [], admin_api_idempotency: [] };
  const writes: Array<{ table: string; row: Row }> = [];

  function from(table: string) {
    const state = { action: "select", payload: null as any, filters: [] as Array<[string, any]>, single: false };
    const exec = async () => {
      const rows = (tables[table] ??= []);
      if (state.action === "insert" || state.action === "upsert") {
        const row = { id: crypto.randomUUID(), ...state.payload };
        rows.push(row);
        if (table !== "admin_api_previews" && table !== "admin_api_idempotency") writes.push({ table, row });
        return { data: state.single ? row : [row], error: null };
      }
      const matched = rows.filter((r) => state.filters.every(([c, v]) => r[c] === v));
      if (state.action === "update") {
        matched.forEach((r) => Object.assign(r, state.payload));
        return { data: matched, error: null };
      }
      return { data: state.single ? (matched[0] ?? null) : matched, error: null };
    };
    const api: any = {
      insert(row: Row) { state.action = "insert"; state.payload = row; return api; },
      upsert(row: Row) { state.action = "upsert"; state.payload = row; return api; },
      update(row: Row) { state.action = "update"; state.payload = row; return api; },
      select() { return api; },
      eq(col: string, val: unknown) { state.filters.push([col, val]); return api; },
      limit() { return api; },
      order() { return api; },
      single() { state.single = true; return api; },
      then(ok: any, err: any) { return exec().then(ok, err); },
    };
    return api;
  }

  return { tables, writes, from };
}

/** Stands in for the atomic admin_apply_batch engine function. */
function engine(opts: { failCommitWith?: string } = {}) {
  const calls: Array<Record<string, any>> = [];
  const rpc = async (_name: string, args: Record<string, any>) => {
    calls.push(args);
    const players = (args.p_payload?.players ?? []) as Row[];
    if (args.p_commit) {
      if (opts.failCommitWith) return { data: null, error: { message: opts.failCommitWith } };
      return {
        data: {
          updated_ids: players.map((p) => p.player_card_id).filter(Boolean),
          created_ids: players.filter((p) => !p.player_card_id).map(() => crypto.randomUUID()),
          updates: players,
          audit_operation_id: "audit-1",
        },
        error: null,
      };
    }
    return { data: { preview_token: `tok-${calls.length}`, updates: players, creates: [] }, error: null };
  };
  return { rpc, calls };
}

function harness(opts: { failCommitWith?: string } = {}) {
  const db = fakeDb();
  const eng = engine(opts);
  const client = { from: db.from, rpc: eng.rpc };
  const ctx = { client: client as any, adminId: "admin-1", base: "https://api.test/functions/v1/actions" };
  const call = async (path: string, body: unknown) => {
    const res = await handleAdminApi(
      path,
      new Request(`https://api.test/functions/v1/actions${path}`, { method: "POST", body: JSON.stringify(body) }),
      ctx,
    );
    return { status: res!.status, json: await res!.json() };
  };
  return { db, engine: eng, call };
}

const PREVIEW = "/admin-api/v1/bulk-players/preview";
const COMMIT = "/admin-api/v1/bulk-players/commit";

const statsFor = (v: number) => ({
  stat_3pt: v, stat_mid: v, stat_fin: v, stat_dnk: v, stat_ast: v,
  stat_stl: v, stat_reb: v, stat_blk: v, stat_int: v,
});

const sixPlayers = () =>
  Array.from({ length: 6 }, (_, i) => ({
    player_card_id: `0932b0e9-fb1f-4845-9c36-38423d4910${String(10 + i)}`,
    name: `Bulk Player ${i}`,
    gem_tier: "diamond",
    rating: 3,

    position1: "SG",
    is_collection_reward: false,
    ...statsFor(3),
    badges: [{ badge: "Walking Bucket", tier: "diamond" }],
    traits: [{ trait: "Prime Time", tier: "gold", target_stat: "stat_3pt" }],
  }));

// ------------------------------------------------------------------- preview
describe("bulk-players preview", () => {
  it("previews six player cards with zero writes and returns a token plus hash", async () => {
    const h = harness();
    const { status, json } = await h.call(PREVIEW, { players: sixPlayers() });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.operation).toBe("bulk_players");
    expect(json.wrote_anything).toBe(false);
    expect(json.preview_token).toBeTruthy();
    expect(json.payload_hash).toHaveLength(64);
    expect(json.summary.entity_count).toBe(6);
    expect(json.preview_token_lifetime_minutes).toBe(30);
    // engine was called in preview mode only, and nothing outside the preview store was written
    expect(h.engine.calls.every((c) => c.p_commit === false)).toBe(true);
    expect(h.db.writes).toEqual([]);
  });

  it("rejects an invalid badge assignment tier", async () => {
    const players = sixPlayers();
    players[2].badges = [{ badge: "Walking Bucket", tier: "mythic" as any }];
    const { status, json } = await harness().call(PREVIEW, { players });
    expect(status).toBe(400);
    expect(json.error_code).toBe("VALIDATION_FAILED");
    expect(json.errors.some((e: any) => e.code === "UNKNOWN_ASSIGNMENT_TIER")).toBe(true);
    expect(json.wrote_anything).toBe(false);
  });

  it("rejects an unknown gem tier", async () => {
    const players = sixPlayers();
    players[0].gem_tier = "obsidian";
    const { status, json } = await harness().call(PREVIEW, { players });
    expect(status).toBe(400);
    expect(json.errors.some((e: any) => e.code === "UNKNOWN_GEM_TIER")).toBe(true);
  });

  it("rejects duplicate player names targeting the same card", async () => {
    const players = sixPlayers().map((p) => {
      const { player_card_id, ...rest } = p;
      return { ...rest, name: "Twin Card" };
    });
    const { status, json } = await harness().call(PREVIEW, { players });
    expect(status).toBe(400);
    expect(json.error_code).toBe("VALIDATION_FAILED");
    expect(json.errors.some((e: any) => e.code === "DUPLICATE_TARGET")).toBe(true);
  });

  it("rejects foreign groups and over-sized batches", async () => {
    const scoped = await harness().call(PREVIEW, { players: sixPlayers(), collections: [{ name: "Galactic" }] });
    expect(scoped.status).toBe(400);
    expect(scoped.json.errors[0].code).toBe("PLAYERS_ONLY_SCOPE");

    const tooMany = await harness().call(PREVIEW, { players: Array.from({ length: 501 }, (_, i) => ({ name: `P${i}` })) });
    expect(tooMany.status).toBe(413);
    expect(tooMany.json.errors[0].code).toBe("BATCH_LIMIT_EXCEEDED");
  });
});

// -------------------------------------------------------------------- commit
describe("bulk-players commit", () => {
  it("commits the six previewed cards atomically and receipts their ids", async () => {
    const h = harness();
    const players = sixPlayers();
    const preview = await h.call(PREVIEW, { players });
    const { status, json } = await h.call(COMMIT, { preview_token: preview.json.preview_token, players });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.mode).toBe("commit");
    expect(json.wrote_anything).toBe(true);
    expect(json.payload_hash).toBe(preview.json.payload_hash);
    expect(json.updated_ids).toHaveLength(6);
    const commitCall = h.engine.calls.find((c) => c.p_commit);
    expect(commitCall.p_kind).toBe("player_bulk");
    expect(commitCall.p_payload.players).toHaveLength(6);
  });

  it("refuses a commit with no preview token", async () => {
    const { status, json } = await harness().call(COMMIT, { players: sixPlayers() });
    expect(status).toBe(400);
    expect(json.errors[0].code).toBe("PREVIEW_REQUIRED");
    expect(json.error_code).toBe("PREVIEW_MISMATCH");
  });

  it("refuses an unknown token as TOKEN_EXPIRED", async () => {
    const { status, json } = await harness().call(COMMIT, { preview_token: "nope", players: sixPlayers() });
    expect(status).toBe(400);
    expect(json.errors[0].code).toBe("UNKNOWN_PREVIEW_TOKEN");
    expect(json.error_code).toBe("TOKEN_EXPIRED");
  });

  it("rejects a commit after the 30 minute token lifetime", async () => {
    const h = harness();
    const players = sixPlayers();
    const preview = await h.call(PREVIEW, { players });
    h.db.tables.admin_api_previews[0].expires_at = new Date(Date.now() - 60_000).toISOString();
    const { status, json } = await h.call(COMMIT, { preview_token: preview.json.preview_token, players });
    expect(status).toBe(410);
    expect(json.errors[0].code).toBe("PREVIEW_EXPIRED");
    expect(json.error_code).toBe("TOKEN_EXPIRED");
    expect(json.wrote_anything).toBe(false);
    expect(h.db.writes).toEqual([]);
  });

  it("rejects a payload that differs from the approved preview", async () => {
    const h = harness();
    const players = sixPlayers();
    const preview = await h.call(PREVIEW, { players });
    const reordered = [...players.slice(1), players[0]];
    const { status, json } = await h.call(COMMIT, { preview_token: preview.json.preview_token, players: reordered });
    expect(status).toBe(409);
    expect(json.errors[0].code).toBe("PREVIEW_MISMATCH");
    expect(json.error_code).toBe("PREVIEW_MISMATCH");
    expect(h.db.writes).toEqual([]);
  });

  it("burns the preview token after a successful commit", async () => {
    const h = harness();
    const players = sixPlayers();
    const preview = await h.call(PREVIEW, { players });
    await h.call(COMMIT, { preview_token: preview.json.preview_token, players });
    const replay = await h.call(COMMIT, { preview_token: preview.json.preview_token, players });
    expect(replay.status).toBe(409);
    expect(replay.json.errors[0].code).toBe("PREVIEW_ALREADY_COMMITTED");
    expect(replay.json.error_code).toBe("TOKEN_EXPIRED");
  });

  it("rolls the whole batch back when one player fails, leaving no partial records", async () => {
    const h = harness({ failCommitWith: "COMMIT_FAILED: players[3] rating 3 does not fit diamond" });
    const players = sixPlayers();
    const preview = await h.call(PREVIEW, { players });
    const { status, json } = await h.call(COMMIT, { preview_token: preview.json.preview_token, players });
    expect(status).toBe(400);
    expect(json.ok).toBe(false);
    expect(json.stage).toBe("commit");
    expect(json.wrote_anything).toBe(false);
    expect(json.error_code).toBe("COMMIT_FAILED");
    expect(json.errors[0].written).toBe(false);
    // no player rows persisted, and the approved preview is still unconsumed for a retry
    expect(h.db.writes.filter((w) => w.table === "player_cards")).toEqual([]);
    expect(h.db.tables.admin_api_previews[0].consumed_at ?? null).toBe(null);
  });
});

// ------------------------------------------- evo versions in one bulk payload
describe("bulk-players evo versions", () => {
  const twinCards = () => [
    {
      name: "Kyle Sabre",
      action: "create",
      gem_tier: "actolytrene",
      rating: 5,
      position1: "SG",
      ...statsFor(5),
    },
    {
      name: "Kyle Sabre",
      action: "create",
      temp_ref: "kyle_evo_1",
      gem_tier: "actolytrene",
      rating: 5,
      position1: "SG",
      ...statsFor(5),
    },
  ];

  it("accepts two brand-new cards that intentionally share a name", async () => {
    const h = harness();
    const { status, json } = await h.call(PREVIEW, { players: twinCards() });
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.summary.entity_count).toBe(2);
    expect(h.db.writes).toEqual([]);
  });

  it("still rejects same-named entries without explicit create intent", async () => {
    const players = twinCards().map(({ action, ...rest }) => rest);
    const { status, json } = await harness().call(PREVIEW, { players });
    expect(status).toBe(400);
    expect(json.errors.some((e: any) => e.code === "DUPLICATE_TARGET")).toBe(true);
  });

  it("keeps whole-number stats castable through canonicalization", async () => {
    const h = harness();
    await h.call(PREVIEW, { players: twinCards() });
    const sent = h.engine.calls[0].p_payload.players[0];
    expect(Number(sent.stat_3pt)).toBe(5);
  });

  it("accepts evo paths and version/step patches in the same bulk payload", async () => {
    const h = harness();
    const { status, json } = await h.call(PREVIEW, {
      players: twinCards(),
      evo_paths: [
        {
          player_name: "Kyle Sabre",
          source_gem_tier: "actolytrene",
          steps: [
            {
              step_order: 1,
              from_tier: "actolytrene",
              to_tier: "game over",
              objectives: [{ stat: "points", amount: 100 }],
            },
          ],
        },
      ],
    });
    if (status !== 200) console.log(JSON.stringify(json.errors, null, 1));
    expect(status).toBe(200);
    expect(json.ok).toBe(true);
    expect(h.engine.calls[0].p_payload.evo_paths).toHaveLength(1);
  });
});
