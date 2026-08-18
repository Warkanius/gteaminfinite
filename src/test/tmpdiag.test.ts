import { describe, it, expect } from "vitest";
import { normalizeDocument } from "../../supabase/functions/_shared/admin-api/normalize";
describe("x", () => { it("y", () => {
  const r = normalizeDocument({ players: [{ name: "Kyle Sabre", action: "create", gem_tier: "diamond", rating: 5, position1: "SG", stat_3pt:5,stat_mid:5,stat_fin:5,stat_dnk:5,stat_ast:5,stat_stl:5,stat_reb:5,stat_blk:5,stat_int:5 }] });
  console.log(JSON.stringify(r.errors, null, 1));
})});
