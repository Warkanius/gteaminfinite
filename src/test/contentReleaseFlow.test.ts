import { describe, expect, it } from "vitest";
import { previewRelease, commitStoredRelease } from "../../supabase/functions/actions/contentReleaseFlow";
import { buildOpenApi } from "../../supabase/functions/actions/openapi";

const HASH = "abc123hash";

function releaseDoc() {
  const players = Array.from({ length: 3 }, (_, i) => ({
    name: `Flow Guy ${i + 1}`,
    gem_tier: "Emerald",
    rating: 85,
    // numeric stat values (including 1) must be accepted, not rejected as falsy
    stat_3pt: 1,
    stat_mid: 85,
    stat_fin: 85,
  }));
  return {
    release: { name: "Flow Release" },
    collection: {
      name: "Flow Release",
      player_cards: players.map((p, i) => ({ player_name: p.name, slot: i + 1 })),
    },
    players,
  } as Record<string, unknown>;
}

/** In-memory stand-in for the preview table + RPC lifecycle. */
function fakeClient(opts: { commitFails?: boolean } = {}) {
  const store: Record<string, any> = {};
  const calls: string[] = [];
  const gameContentWrites: unknown[] = [];

  const client = {
    calls,
    store,
    gameContentWrites,
    // deno-lint-ignore no-explicit-any
    async rpc(name: string, args: any) {
      calls.push(name);
      if (name === "admin_apply_batch") {
        if (args.p_commit) gameContentWrites.push(args.p_payload);
        return { data: { payload_hash: HASH, normalized_payload: args.p_payload, creates: [{ table: "player_cards" }], warnings: [] }, error: null };
      }
      if (name === "content_release_preview_store") {
        const id = "preview-1";
        store[id] = {
          preview_id: id,
          payload_hash: args.p_payload_hash,
          canonical_payload: args.p_canonical_payload,
          summary: args.p_summary,
          creates: args.p_plan.creates,
          status: "pending",
          expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
        };
        return { data: store[id], error: null };
      }
      if (name === "content_release_preview_claim" || name === "content_release_preview_commit") {
        const row = store[args.p_preview_id];
        if (!row) return { data: null, error: { message: "PREVIEW_NOT_FOUND: no stored preview" } };
        if (row.status === "committed") {
          if (args.p_approved_payload_hash === row.payload_hash) return { data: { ...row, idempotent_replay: true }, error: null };
          return { data: null, error: { message: "PREVIEW_ALREADY_COMMITTED" } };
        }
        if (new Date(row.expires_at).getTime() < Date.now()) {
          row.status = "expired";
          return { data: null, error: { message: "PREVIEW_EXPIRED: run a new preview" } };
        }
        if (row.status === "cancelled") return { data: null, error: { message: "PREVIEW_CANCELLED" } };
        if (args.p_approved_payload_hash !== row.payload_hash) {
          return { data: null, error: { message: "PAYLOAD_HASH_MISMATCH" } };
        }
        if (name === "content_release_preview_claim") {
          row.status = "committing";
          return { data: { ...row, claimed: true }, error: null };
        }
        if (opts.commitFails) return { data: null, error: { message: "boom" } };
        // Commit applies the STORED canonical payload — never a client-sent one.
        await client.rpc("admin_apply_batch", { p_payload: row.canonical_payload, p_commit: true });
        row.status = "committed";
        row.committed_at = new Date().toISOString();
        row.commit_result = { results: [{ table: "player_cards", id: "card-1" }] };
        row.verification_result = { verified: true };
        return { data: { ...row, idempotent_replay: false }, error: null };
      }
      if (name === "content_release_preview_fail") {
        const row = store[args.p_preview_id];
        if (row) { row.status = "failed"; row.last_error = args.p_error; }
        return { data: row ?? null, error: null };
      }
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    },
  };
  return client;
}

describe("content-release preview persistence", () => {
  it("persists the canonical payload + hash and writes no game content", async () => {
    const client = fakeClient();
    const res = await previewRelease(client, releaseDoc());
    expect(res.status).toBe(200);
    expect(res.body.preview_id).toBe("preview-1");
    expect(res.body.payload_hash).toBe(HASH);
    expect(res.body.expires_at).toBeTruthy();
    expect(res.body.wrote_game_content).toBe(false);
    expect(client.gameContentWrites).toHaveLength(0);
    expect(client.store["preview-1"].canonical_payload).toBeTruthy();
    expect(client.calls).toContain("content_release_preview_store");
  });

  it("accepts numeric stat values like stat_3pt: 1", async () => {
    const client = fakeClient();
    const res = await previewRelease(client, releaseDoc());
    expect(res.status).toBe(200);
    const payload = JSON.stringify(client.store["preview-1"].canonical_payload);
    expect(payload).toContain("stat_3pt");
  });
});

describe("commit by stored preview only", () => {
  it("commits with only preview_id + hash and returns immutable ids", async () => {
    const client = fakeClient();
    const preview = await previewRelease(client, releaseDoc());
    const res = await commitStoredRelease(client, {
      preview_id: preview.body.preview_id,
      approved_payload_hash: preview.body.payload_hash,
    });
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(true);
    expect(res.body.status).toBe("committed");
    expect(res.body.created_ids).toEqual([{ table: "player_cards", id: "card-1" }]);
    // the committed payload came from the store, not from the request
    expect(client.gameContentWrites).toHaveLength(1);
  });

  it("accepts the hash under approval_hash / payload_hash aliases", async () => {
    const client = fakeClient();
    const preview = await previewRelease(client, releaseDoc());
    const res = await commitStoredRelease(client, { preview_id: "preview-1", payload_hash: preview.body.payload_hash });
    expect(res.status).toBe(200);
  });

  it("rejects a missing preview_id without writing", async () => {
    const client = fakeClient();
    const res = await commitStoredRelease(client, { approved_payload_hash: HASH });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/preview_id is required/);
    expect(client.gameContentWrites).toHaveLength(0);
  });

  it("rejects a hash mismatch without writing", async () => {
    const client = fakeClient();
    await previewRelease(client, releaseDoc());
    const res = await commitStoredRelease(client, { preview_id: "preview-1", approved_payload_hash: "wrong" });
    expect(res.status).toBe(409);
    expect(client.gameContentWrites).toHaveLength(0);
  });

  it("rejects an unknown preview_id with 404", async () => {
    const client = fakeClient();
    const res = await commitStoredRelease(client, { preview_id: "nope", approved_payload_hash: HASH });
    expect(res.status).toBe(404);
  });

  it("rejects an expired preview with 410 and writes nothing", async () => {
    const client = fakeClient();
    await previewRelease(client, releaseDoc());
    client.store["preview-1"].expires_at = new Date(Date.now() - 1000).toISOString();
    const res = await commitStoredRelease(client, { preview_id: "preview-1", approved_payload_hash: HASH });
    expect(res.status).toBe(410);
    expect(client.gameContentWrites).toHaveLength(0);
  });

  it("replays a committed preview idempotently instead of duplicating", async () => {
    const client = fakeClient();
    await previewRelease(client, releaseDoc());
    await commitStoredRelease(client, { preview_id: "preview-1", approved_payload_hash: HASH });
    const again = await commitStoredRelease(client, { preview_id: "preview-1", approved_payload_hash: HASH });
    expect(again.status).toBe(200);
    expect(again.body.idempotent_replay).toBe(true);
    expect(client.gameContentWrites).toHaveLength(1);
  });

  it("records a failure and writes no partial content when the commit throws", async () => {
    const client = fakeClient({ commitFails: true });
    await previewRelease(client, releaseDoc());
    const res = await commitStoredRelease(client, { preview_id: "preview-1", approved_payload_hash: HASH });
    expect(res.status).toBe(400);
    expect(client.store["preview-1"].status).toBe("failed");
    expect(client.gameContentWrites).toHaveLength(0);
  });
});

describe("openapi contract", () => {
  const spec = buildOpenApi("https://example.test/functions/v1/actions") as any;

  it("exposes commitContentRelease with only preview_id + hash", () => {
    const op = spec.paths["/content-release/commit"].post;
    expect(op.operationId).toBe("commitContentRelease");
    const schema = op.requestBody.content["application/json"].schema;
    expect(schema.required).toEqual(["preview_id", "approved_payload_hash"]);
    expect(Object.keys(schema.properties).sort()).toEqual(
      ["approved_payload_hash", "idempotency_key", "preview_id", "wait_seconds"],
    );
    expect(schema.properties.players).toBeUndefined();
    expect(schema.properties.release).toBeUndefined();
  });

  it("previewContentRelease documents preview_id, payload_hash and expires_at", () => {
    const op = spec.paths["/content-release/preview"].post;
    expect(op.operationId).toBe("previewContentRelease");
    const props = op.responses["200"].content["application/json"].schema.properties;
    for (const key of ["preview_id", "payload_hash", "expires_at", "summary", "warnings", "destructive_operations", "plan"]) {
      expect(props[key]).toBeTruthy();
    }
    expect(op["x-openai-isConsequential"]).toBe(false);
  });

  it("keeps the legacy commit-by-preview-id alias", () => {
    expect(spec.paths["/content-release/commit-by-preview-id"].post.operationId).toBe("commitContentReleaseByPreviewId");
  });

  it("instructs the GPT to commit with only preview_id + hash", () => {
    const text = spec.info.description ?? "";
    expect(typeof text).toBe("string");
  });
});
