import { describe, expect, it } from "vitest";
import {
  buildCompactOpenApi,
  compactOperationIds,
  schemaHash,
  GPT_COMPACT_INSTRUCTIONS,
} from "../../supabase/functions/actions/openapiGpt";

const BASE = "https://example.supabase.co/functions/v1/actions";
const schema = buildCompactOpenApi(BASE) as any;

const EXPECTED = [
  "getGptActionHealth",
  "getAdminApiCapabilities",
  "getAdminApiDiagnostics",
  "getReferences",
  "listRows",
  "getEntity",
  "previewContentRelease",
  "commitContentRelease",
  "getContentReleasePreview",
  "cancelContentReleasePreview",
  "previewBulkPlayers",
  "commitBulkPlayers",
  "previewBulk",
  "commitBulk",
  "listDominationRoads",
  "exportDominationRoad",
  "previewDominationRoad",
  "commitDominationRoad",
  "auditEvoVersionRuns",
  "repairEvoVersionRuns",
];

describe("compact GPT OpenAPI", () => {
  it("builds and exposes exactly the safe operations", () => {
    const ids = compactOperationIds(BASE);
    expect(ids.sort()).toEqual([...EXPECTED].sort());
  });

  it("has no duplicate operationIds", () => {
    const ids = compactOperationIds(BASE);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("excludes deprecated aliases, debug and low-level routes", () => {
    const json = JSON.stringify(schema);
    for (const banned of [
      "commitContentReleaseByPreviewId",
      "commit-by-preview-id",
      "importStorylineBundle",
      "scheduleApprovedPreview",
      "cancelScheduledJob",
      "rescheduleJob",
      "getPreviewDetail",
      "previewPlayer",
      "commitPlayer",
    ]) {
      expect(json).not.toContain(banned);
    }
  });

  it("keeps commitContentRelease to preview_id + hash only", () => {
    const body = schema.paths["/content-release/commit"].post.requestBody.content["application/json"].schema;
    expect(body.required).toEqual(["preview_id", "approved_payload_hash"]);
    expect(Object.keys(body.properties).sort()).toEqual(
      ["approved_payload_hash", "idempotency_key", "preview_id", "wait_seconds"].sort(),
    );
    expect(body.additionalProperties).toBe(false);
    const json = JSON.stringify(body);
    for (const field of ["players", "collection", "evo_paths", "pack", "release"]) {
      expect(json).not.toContain(`"${field}"`);
    }
  });

  it("previewContentRelease response exposes preview_id, payload_hash, expires_at", () => {
    const res = schema.paths["/content-release/preview"].post.responses["200"].content["application/json"].schema;
    for (const key of ["preview_id", "payload_hash", "expires_at"]) {
      expect(res.properties[key]).toBeTruthy();
    }
  });

  it("stays compact with shallow response schemas", () => {
    const size = JSON.stringify(schema).length;
    expect(size).toBeLessThan(60_000);

    const depth = (v: unknown, d = 0): number =>
      v && typeof v === "object"
        ? Math.max(d, ...Object.values(v as Record<string, unknown>).map((x) => depth(x, d + 1)))
        : d;
    for (const [p, methods] of Object.entries<any>(schema.paths)) {
      for (const op of Object.values<any>(methods)) {
        for (const [code, res] of Object.entries<any>(op.responses)) {
          const s = res?.content?.["application/json"]?.schema;
          if (s) expect(depth(s), `${p} ${code}`).toBeLessThan(6);
        }
      }
    }
  });

  it("marks only commits as consequential", () => {
    for (const methods of Object.values<any>(schema.paths)) {
      for (const op of Object.values<any>(methods)) {
        const consequential = op["x-openai-isConsequential"];
        const isWrite = /^(commit|cancel|repair)/.test(op.operationId);
        expect(consequential).toBe(isWrite);
      }
    }
  });

  it("exposes oauth security and a stable schema hash", () => {
    expect(schema.security[0].oauth2).toBeTruthy();
    expect(schema.components.securitySchemes.oauth2.type).toBe("oauth2");
    expect(schemaHash(schema)).toBe(schemaHash(buildCompactOpenApi(BASE)));
  });

  it("instructions order health -> preview -> approval -> commit", () => {
    const t = GPT_COMPACT_INSTRUCTIONS;
    expect(t.indexOf("getGptActionHealth")).toBeGreaterThan(-1);
    expect(t.indexOf("getGptActionHealth")).toBeLessThan(t.indexOf("previewContentRelease"));
    expect(t.indexOf("previewContentRelease")).toBeLessThan(t.indexOf("commitContentRelease"));
    expect(t).toContain("{ preview_id, approved_payload_hash }");
  });
});
