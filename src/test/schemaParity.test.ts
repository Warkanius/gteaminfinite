import { describe, expect, it } from "vitest";
import { buildCompactOpenApi } from "../../supabase/functions/actions/openapiGpt";
import { capabilities } from "../../supabase/functions/_shared/admin-api/capabilities";

const BASE = "https://example.supabase.co/functions/v1/actions";
const schema = buildCompactOpenApi(BASE) as any;
const caps = capabilities(BASE) as any;

/** Strips the documentation noise capabilities uses, e.g. "odds[] {a,b}". */
const fieldName = (raw: string) =>
  raw
    .replace(/\(.*?\)/g, "")
    .replace(/\{.*?\}/g, "")
    .replace(/\[\]/g, "")
    .trim();

/** Fields capabilities lists as documentation, not writable payload keys. */
const IGNORED: Record<string, string[]> = {
  players: ["run_stat_*", "client_ref", "gem_name", "avatar_url", "social_handle", "card_color_primary", "card_color_secondary", "card_animation", "market_value", "sub_collection", "is_collection_reward"],
  collections: [],
  packs: [],
  teams: [],
  locker_codes: ["reward_payload"],
};

/** Follows a `$ref` into components.schemas so parity checks see real fields. */
const deref = (node: any): any => {
  if (!node || typeof node !== "object") return node;
  if (typeof node.$ref === "string") {
    const name = node.$ref.split("/").pop() as string;
    return schema.components.schemas[name];
  }
  return node;
};

const bodySchema = (path: string) =>
  deref(schema.paths[path].post.requestBody.content["application/json"].schema);

const groupProps = (group: string) => {
  const bulk = deref(bodySchema("/admin-api/v1/bulk/preview").properties[group]);
  return deref(bulk?.items)?.properties ?? bulk?.properties ?? {};
};

describe("capabilities <-> GPT schema parity", () => {
  it("exposes pack pool and odds as structured fields", () => {
    const pack = groupProps("packs");
    expect(Object.keys(pack)).toEqual(expect.arrayContaining(["pack_id", "name", "players", "odds", "cost", "ten_box_cost"]));
    expect(pack.players.items.properties).toHaveProperty("player_card_id");
    expect(Object.keys(pack.odds.items.properties).sort()).toEqual(["description", "percentage", "result_slot"]);
  });

  it("exposes the release pack, collection, team and locker code schemas", () => {
    const release = bodySchema("/content-release/preview").properties;
    expect(deref(release.pack).properties).toHaveProperty("odds");
    expect(deref(release.pack).properties).toHaveProperty("players");
    expect(deref(release.collection).properties).toHaveProperty("player_cards");
    expect(deref(release.team).properties).toHaveProperty("roster");
    expect(deref(release.locker_codes.items).properties).toHaveProperty("reward_payload");
  });

  for (const group of ["players", "packs", "collections", "teams", "locker_codes"]) {
    it(`every writable ${group} field capabilities claims is visible to the GPT`, () => {
      const claimed = (caps.fields[group] as string[]).map(fieldName).filter(Boolean);
      const visible = new Set(Object.keys(groupProps(group)));
      const missing = claimed.filter(
        (f) => !visible.has(f) && !IGNORED[group].includes(f) && !f.includes(" "),
      );
      expect(missing, `capabilities.fields.${group} claims fields absent from the GPT schema`).toEqual([]);
    });
  }
});
