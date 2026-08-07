/**
 * Capability metadata must be executable truth, not documentation.
 *
 * The advertised group apply order and the advertised evo/deferred-reference
 * semantics are asserted against the actual SQL that the live database runs
 * (dumped into src/test/sql/live-functions.sql by scripts/dump-live-schema.sh).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFERRED_LINK_CONTRACT,
  GROUP_APPLY_ORDER,
  capabilities,
} from "../../supabase/functions/_shared/admin-api/capabilities";

const sql = readFileSync(join(process.cwd(), "src/test/sql/live-functions.sql"), "utf8");

/** The v_groups array literal inside admin_apply_batch, in declaration order. */
function sqlGroupOrder(): string[] {
  const fn = sql.slice(sql.indexOf("FUNCTION public.admin_apply_batch"));
  const marker = "v_groups text[] := ARRAY[";
  const decl = fn.slice(fn.indexOf(marker) + marker.length);
  const literal = decl.slice(0, decl.indexOf("]"));
  return literal
    .split(",")
    .map((s) => s.trim().replace(/^'|'$/g, ""))
    .filter(Boolean);
}

describe("capability metadata is executable truth", () => {
  it("advertises the exact group order the database applies", () => {
    expect(sqlGroupOrder()).toEqual([...GROUP_APPLY_ORDER]);
  });

  it("applies parents strictly before the children that reference them", () => {
    const order = sqlGroupOrder();
    const before = (parent: string, child: string) =>
      expect(order.indexOf(parent)).toBeLessThan(order.indexOf(child));
    before("release_bundles", "players");
    before("release_bundles", "evo_paths");
    before("gem_tiers", "players");
    before("players", "collections");
    before("players", "teams");
    before("players", "packs");
    before("players", "evo_paths");
    before("collections", "sub_collections");
    before("domination_roads", "domination_games");
    before("packs", "locker_codes");
  });

  it("exposes replace_path as a real action implemented by a real function", () => {
    expect(sql).toContain("create|update|upsert|replace|replace_path");
    expect(sql).toContain("FUNCTION public.admin_apply_evo_path");
    expect(sql).toContain("admin_apply_evo_path(v_item, p_commit)");
    expect(capabilities("https://x.test").exposed_operations.content_release.evo_path_semantics).toContain(
      "replace_path",
    );
  });

  it("backs the deferred-reference contract with the code paths it claims", () => {
    expect(sql).toContain("admin_identity_pending");
    expect(sql).toContain("admin_strip_pending");
    expect(sql).toContain("DEFERRED_SAME_BATCH_LINK");
    expect(DEFERRED_LINK_CONTRACT.link_deferred).toContain("DEFERRED_SAME_BATCH_LINK");
    expect(capabilities("https://x.test").deferred_reference_contract).toBe(DEFERRED_LINK_CONTRACT);
  });

  it("lists every advertised group as a group the batch function accepts", () => {
    const advertised = capabilities("https://x.test").group_apply_order;
    expect(new Set(advertised).size).toBe(advertised.length);
    for (const g of advertised) expect(sqlGroupOrder()).toContain(g);
  });
});
