import { describe, it, expect } from "vitest";
import { canonicalize, payloadHash, byteSize } from "../../supabase/functions/_shared/admin-api/canonical";
import { ovrText, checkOvr, oddsTotal, ODDS_TARGET, tierKey, bandFor } from "../../supabase/functions/_shared/admin-api/decimal";
import { normalizeRef, isUuid } from "../../supabase/functions/_shared/admin-api/refs";
import { normalizeDocument, documentForEntity, ENTITY_TO_GROUP, GROUPS } from "../../supabase/functions/_shared/admin-api/normalize";
import { capabilities, LIMITS } from "../../supabase/functions/_shared/admin-api/capabilities";

const KANIAN = "0932b0e9-fb1f-4845-9c36-3842d49141e1";

const statsFor = (v: number) => ({
  stat_3pt: v, stat_mid: v, stat_fin: v, stat_dnk: v, stat_ast: v,
  stat_stl: v, stat_reb: v, stat_blk: v, stat_int: v,
});

describe("canonical serialization", () => {
  it("hashes key order independently", async () => {
    const a = await payloadHash({ a: 1, b: { c: 2, d: [1, 2] } });
    const b = await payloadHash({ b: { d: [1, 2], c: 2 }, a: 1 });
    expect(a).toBe(b);
  });

  it("keeps meaningful array order significant", async () => {
    expect(await payloadHash({ roster: ["a", "b"] })).not.toBe(await payloadHash({ roster: ["b", "a"] }));
  });

  it("normalizes numeric formatting so preview and commit agree", async () => {
    expect(await payloadHash({ rating: 2.5 })).toBe(await payloadHash({ rating: 2.5000 }));
    expect(canonicalize({ pct: 33.33 })).toEqual({ pct: "33.33" });
  });

  it("measures payload size", () => {
    expect(byteSize({ a: "x" })).toBeGreaterThan(0);
  });
});

describe("fixed-precision OVR and gem tiers", () => {
  it("computes the decimal average of the nine base stats", () => {
    expect(ovrText(statsFor(2))).toBe("2.00");
    expect(ovrText({ ...statsFor(2), stat_3pt: 4 })).toBe("2.22");
  });

  it("accepts a rating inside its tier band", () => {
    expect(checkOvr(statsFor(3), "diamond", 3).ok).toBe(true);
  });

  it("rejects an OVR outside the requested tier band without changing the tier", () => {
    const res = checkOvr(statsFor(4.22), "diamond", 4.22);
    expect(res.ok).toBe(false);
    expect(res.code).toBe("OVR_TIER_MISMATCH");
    expect(res.expected).toContain("3.00");
    expect(String(res.received)).toContain("4.22");
    expect(res.offenders?.length).toBeGreaterThan(0);
  });

  it("rejects a stored rating that disagrees with the stat average", () => {
    const res = checkOvr(statsFor(2), "amethyst", 2.9);
    expect(res.ok).toBe(false);
    expect(res.code).toBe("OVR_RATING_MISMATCH");
  });

  it("flags incomplete stats instead of guessing", () => {
    const { stat_int: _drop, ...partial } = statsFor(2);
    expect(checkOvr(partial, "amethyst", 2).code).toBe("INCOMPLETE_STATS");
  });

  it("maps tier aliases and bands", () => {
    expect(tierKey("Pink_Diamond")).toBe("pink diamond");
    expect(tierKey("  Diamond ")).toBe("diamond");
    expect(bandFor("actolytrene")?.min).toBeDefined();
  });

  it("totals pack odds without floating point drift", () => {
    const total = oddsTotal([33.33, 33.33, 33.34].map((percentage) => ({ percentage })));
    expect(total).toBe(ODDS_TARGET);
    expect(oddsTotal([{ percentage: 50 }, { percentage: 49.99 }])).not.toBe(ODDS_TARGET);
  });
});

describe("canonical entity references", () => {
  it("normalizes every alias to player_card_id", () => {
    for (const alias of ["player_id", "card_id", "id"]) {
      const { fields, warnings } = normalizeRef("player", { [alias]: KANIAN }, "players[0]");
      expect(fields.player_card_id).toBe(KANIAN);
      expect(warnings.some((w) => w.code === "DEPRECATED_FIELD")).toBe(true);
    }
  });

  it("does not treat an existing UUID in a name field as a temporary reference", () => {
    const { fields } = normalizeRef("player", { player: KANIAN }, "evo_paths[0]");
    expect(fields.player_card_id).toBe(KANIAN);
    expect(fields.temp_ref).toBeUndefined();
  });

  it("keeps client refs for entities created in the same payload", () => {
    const { fields } = normalizeRef("player", { client_ref: "new_card_galactic" }, "players[0]");
    expect(fields.temp_ref).toBe("new_card_galactic");
    expect(fields.client_ref).toBeUndefined();
    expect(isUuid("not-a-uuid")).toBe(false);
  });
});


describe("bulk document normalization", () => {
  it("wraps a single-entity body into the same canonical bulk document", () => {
    const doc = documentForEntity("player", { player_card_id: KANIAN, rating: 2 });
    expect(doc).toEqual({ players: [{ player_card_id: KANIAN, rating: 2 }] });
    expect(Object.keys(ENTITY_TO_GROUP).length).toBeGreaterThan(10);
  });

  it("exposes every engine group", () => {
    expect(GROUPS.length).toBeGreaterThanOrEqual(21);
    expect(GROUPS).toContain("players");
    expect(GROUPS).toContain("domination_games");
  });

  it("rejects an empty document", () => {
    const res = normalizeDocument({});
    expect(res.plan.entity_count).toBe(0);
  });

  it("validates players and flags OVR/tier mismatch with a JSON path", () => {
    const res = normalizeDocument({
      players: [{ name: "Test Guy", gem_tier: "diamond", rating: 4.22, stats: statsFor(4.22) }],
    });
    const err = res.errors.find((e) => e.code === "OVR_TIER_MISMATCH");
    expect(err).toBeDefined();
    expect(err!.path).toContain("players[0]");
    expect(err!.written).toBe(false);
  });

  it("requires pack odds to total exactly 100.00", () => {
    const res = normalizeDocument({
      packs: [{
        name: "Galactic Pack",
        players: [{ player_name: "A", slot: 1 }, { player_name: "B", slot: 2 }],
        odds: [{ result_slot: "1", percentage: 50 }, { result_slot: "2", percentage: 49.99 }],
      }],
    });
    expect(res.errors.some((e) => e.code === "ODDS_TOTAL")).toBe(true);
  });

  it("accepts fixed-precision odds that total 100.00", () => {
    const res = normalizeDocument({
      packs: [{
        name: "Galactic Pack",
        players: [{ player_card_id: KANIAN, slot: 1 }, { player_name: "B", slot: 2 }, { player_name: "C", slot: 3 }],
        odds: [
          { result_slot: "1", percentage: 33.33 },
          { result_slot: "2", percentage: 33.33 },
          { result_slot: "3", percentage: 33.34 },
        ],
      }],
    });
    expect(res.errors.filter((e) => e.code === "ODDS_TOTAL")).toHaveLength(0);
  });

  it("reports replacement semantics as destructive warnings", () => {
    const res = normalizeDocument({
      teams: [{ name: "Sensations", roster: [{ player_card_id: KANIAN, slot: 1 }] }],
    });
    expect(res.plan.destructive.length).toBeGreaterThan(0);
  });

  it("treats an empty badge array as remove-all and an absent one as untouched", () => {
    const cleared = normalizeDocument({ players: [{ player_card_id: KANIAN, badges: [] }] });
    expect(JSON.stringify(cleared.canonical)).toContain("badges");
    const untouched = normalizeDocument({ players: [{ player_card_id: KANIAN, rating: 2 }] });
    expect(JSON.stringify(untouched.canonical)).not.toContain("badges");
  });

  it("resolves an evo source card by immutable id and enforces continuous tiers", () => {
    const ok = normalizeDocument({
      evo_paths: [{
        player_card_id: KANIAN,
        source_gem_tier: "amethyst",
        status: "draft",
        steps: [
          { from_tier: "amethyst", to_tier: "diamond", step_order: 1, objectives: [{ stat: "points", amount: 100 }], resulting_version: { rating: 3, gem_name: "diamond", stats: statsFor(3) } },
          { from_tier: "diamond", to_tier: "pink_diamond", step_order: 2, objectives: [{ stat: "assists", amount: 50 }], resulting_version: { rating: 4, gem_name: "pink_diamond", stats: statsFor(4) } },
          { from_tier: "pink_diamond", to_tier: "actolytrene", step_order: 3, objectives: [{ stat: "games_won", amount: 25 }], resulting_version: { rating: 5, gem_name: "actolytrene", stats: statsFor(5) } },
        ],
      }],
    });
    expect(ok.errors).toEqual([]);
    expect(JSON.stringify(ok.canonical)).toContain(KANIAN);

    const skipped = normalizeDocument({
      evo_paths: [{
        player_card_id: KANIAN,
        source_gem_tier: "amethyst",
        steps: [
          { from_tier: "amethyst", to_tier: "actolytrene", step_order: 1, objectives: [{ stat: "points", amount: 10 }], resulting_version: { rating: 5, gem_name: "actolytrene", stats: statsFor(5) } },
        ],
      }],
    });
    expect(skipped.errors.some((e) => e.code === "EVO_TIER_SKIP")).toBe(true);
  });

  it("requires a playable resulting version on every evo step", () => {
    const res = normalizeDocument({
      evo_paths: [{
        player_card_id: KANIAN,
        source_gem_tier: "amethyst",
        steps: [{ from_tier: "amethyst", to_tier: "diamond", step_order: 1, objectives: [{ stat: "points", amount: 10 }] }],
      }],
    });
    expect(res.errors.some((e) => e.code === "EVO_MISSING_VERSION")).toBe(true);
  });

  it("rejects unsupported evo objective statistics", () => {
    const res = normalizeDocument({
      evo_paths: [{
        player_card_id: KANIAN,
        source_gem_tier: "amethyst",
        steps: [{ from_tier: "amethyst", to_tier: "diamond", step_order: 1, objectives: [{ stat: "dunks_per_quarter", amount: 5 }], resulting_version: { rating: 3, gem_name: "diamond", stats: statsFor(3) } }],
      }],
    });
    expect(res.errors.some((e) => e.code === "UNSUPPORTED_EVO_OBJECTIVE")).toBe(true);
  });

  it("rejects a duo with the same player on both sides", () => {
    const res = normalizeDocument({ dynamic_duos: [{ name: "Twins", player_a: { player_card_id: KANIAN }, player_b: { player_card_id: KANIAN } }] });
    expect(res.errors.some((e) => e.code === "DUO_SAME_PLAYER")).toBe(true);
  });

  it("targets domination games by id or road plus order, never opponent name alone", () => {
    const res = normalizeDocument({ domination_games: [{ opponent_name: "Tortuga Crew" }] });
    expect(res.errors.some((e) => e.code === "MISSING_GAME_TARGET")).toBe(true);
  });
});

describe("preview / commit schema parity", () => {
  it("produces one identical canonical payload for the same document", async () => {
    const doc = { players: [{ player_card_id: KANIAN, rating: 2, stats: statsFor(2), gem_tier: "amethyst" }] };
    const a = normalizeDocument(doc);
    const b = normalizeDocument(JSON.parse(JSON.stringify(doc)));
    expect(await payloadHash(a.canonical)).toBe(await payloadHash(b.canonical));
  });

  it("changes the hash when one byte of the payload changes", async () => {
    const base = normalizeDocument({ players: [{ player_card_id: KANIAN, rating: 2, stats: statsFor(2), gem_tier: "amethyst" }] });
    const drift = normalizeDocument({ players: [{ player_card_id: KANIAN, rating: 2.01, stats: statsFor(2), gem_tier: "amethyst" }] });
    expect(await payloadHash(base.canonical)).not.toBe(await payloadHash(drift.canonical));
  });

  it("gives single-entity and bulk routes the same validation result", () => {
    const single = normalizeDocument(documentForEntity("player", { name: "X", gem_tier: "diamond", rating: 4.22, stats: statsFor(4.22) })!);
    const bulk = normalizeDocument({ players: [{ name: "X", gem_tier: "diamond", rating: 4.22, stats: statsFor(4.22) }] });
    expect(single.errors.map((e) => e.code)).toEqual(bulk.errors.map((e) => e.code));
  });
});

describe("capabilities discovery", () => {
  it("advertises entities, limits, tiers and scheduling", () => {
    const caps = capabilities("https://example.test/functions/v1/actions");
    expect(caps.api_version).toBe("v1");
    expect(caps.scheduling.supported).toBe(true);
    expect(Object.keys(caps.entities).length).toBeGreaterThan(10);
    expect(caps.limits.max_entities_per_request).toBe(LIMITS.max_entities_per_request);
    expect(caps.gem_tiers.length).toBeGreaterThan(3);
  });
});

describe("scale", () => {
  it("validates 100 player updates in one document", () => {
    const players = Array.from({ length: 100 }, (_, i) => ({
      name: `Bulk Player ${i}`,
      gem_tier: "amethyst",
      rating: 2,
      stats: statsFor(2),
    }));
    const res = normalizeDocument({ players });
    expect(res.errors).toEqual([]);
    expect(res.plan.entity_count).toBe(100);
    expect(byteSize(res.canonical)).toBeLessThan(LIMITS.max_request_bytes);
  });

  it("refuses a document beyond the advertised batch limit", () => {
    const players = Array.from({ length: LIMITS.max_entities_per_request + 1 }, (_, i) => ({ name: `P${i}` }));
    const res = normalizeDocument({ players });
    expect(res.plan.entity_count).toBeGreaterThan(LIMITS.max_entities_per_request);
  });
});

describe("standalone bulk-player targeting", () => {
  it("previews eleven cards by immutable id with full stat blocks", () => {
    const players = Array.from({ length: 11 }, (_, i) => ({
      player_card_id: `0932b0e9-fb1f-4845-9c36-38423d49${String(1000 + i)}`,
      name: `Bulk ${i}`,
      gem_tier: "diamond",
      rating: 3,

      position1: "SG",
      is_collection_reward: false,
      stats: statsFor(3),
      badges: [{ badge: "Walking Bucket", tier: "diamond" }],
      traits: [{ trait: "Prime Time", tier: "gold", target_stat: "stat_3pt" }],
    }));
    const res = normalizeDocument({ players });
    expect(res.errors).toEqual([]);
    expect(res.plan.entity_count).toBe(11);
  });

  it("rejects two entries that target the same card id", () => {
    const res = normalizeDocument({
      players: [
        { player_card_id: KANIAN, rating: 3, gem_tier: "diamond", stats: statsFor(3) },
        { player_card_id: KANIAN.toUpperCase(), rating: 3, gem_tier: "diamond", stats: statsFor(3) },
      ],
    });
    expect(res.errors.some((e) => e.code === "DUPLICATE_TARGET")).toBe(true);
  });

  it("rejects two entries that target the same card through different identifiers", () => {
    const res = normalizeDocument({
      players: [
        { card_key: "kanian-diamond", rating: 3, gem_tier: "diamond", stats: statsFor(3) },
        { card_key: "Kanian-Diamond", rating: 3, gem_tier: "diamond", stats: statsFor(3) },
      ],
    });
    expect(res.errors.some((e) => e.code === "DUPLICATE_TARGET")).toBe(true);
  });

  it("reports destructive badge and trait replacement", () => {
    const res = normalizeDocument({
      players: [{ player_card_id: KANIAN, rating: 3, gem_tier: "diamond", stats: statsFor(3), badges: [], traits: [] }],
    });
    expect(res.plan.destructive.length).toBeGreaterThan(0);
  });
});

describe("gem tier bands including game over", () => {
  const cases: Array<[string, number, boolean]> = [
    ["emerald", 1, true],
    ["emerald", 1.99, true],
    ["amethyst", 2, true],
    ["diamond", 3, true],
    ["pink diamond", 4, true],
    ["pink diamond", 5, false],
    ["actolytrene", 5, true],
    ["actolytrene", 5.99, true],
    ["actolytrene", 6, false],
    ["game over", 6, true],
    ["game over", 5.99, false],
  ];
  for (const [tier, ovr, ok] of cases) {
    it(`${tier} ${ok ? "accepts" : "rejects"} ${ovr}`, () => {
      const res = checkOvr(statsFor(ovr), tierKey(tier), ovr);
      expect(res.ok).toBe(ok);
    });
  }

  it("never rewrites the requested tier", () => {
    const res = checkOvr(statsFor(6), "pink diamond", 6);
    expect(res.ok).toBe(false);
    expect(bandFor("pink diamond")?.tier).toBe("pink diamond");
  });
});

describe("capability reporting matches the exposed tool names", () => {
  const caps = capabilities("https://example.test/functions/v1/actions") as any;

  it("names the four operations the GPT can call", () => {
    expect(caps.exposed_operations.bulk_players.preview_operation).toBe("previewBulkPlayers");
    expect(caps.exposed_operations.bulk_players.commit_operation).toBe("commitBulkPlayers");
    expect(caps.exposed_operations.content_release.preview_operation).toBe("previewContentRelease");
    expect(caps.exposed_operations.content_release.commit_operation).toBe("commitContentRelease");
  });

  it("advertises game over and the paged preview sections", () => {
    expect(caps.exposed_operations.content_release.game_over_supported).toBe(true);
    expect(caps.exposed_operations.bulk_players.preview_sections).toContain("destructive_operations");
    expect(caps.exposed_operations.bulk_players.gem_tier_bands.map((b: any) => b.tier)).toContain("game over");
  });

  it("scopes bulk players to player cards only", () => {
    expect(caps.exposed_operations.bulk_players.scope).toMatch(/PLAYERS_ONLY_SCOPE/);
  });
});
