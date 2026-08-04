// Reference normalization: names are accepted as input, immutable IDs are canonical.
//
// Every alias the GPT (or older tool schemas) may send is folded into one shape
// per entity. Deprecated aliases produce a deprecation warning instead of a hard
// failure, so existing conversations keep working inside v1.

import type { AdminApiWarning } from "./errors.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): boolean {
  return typeof value === "string" && UUID.test(value.trim());
}

export interface RefSpec {
  /** canonical id field name, e.g. player_card_id */
  idField: string;
  /** canonical name field name, e.g. player_name */
  nameField: string;
  /** aliases accepted for the id */
  idAliases: string[];
  /** aliases accepted for the name */
  nameAliases: string[];
  /** optional stable slug field */
  keyField?: string;
  entity: string;
}

export const REF_SPECS: Record<string, RefSpec> = {
  player: {
    entity: "player_card",
    idField: "player_card_id",
    nameField: "player_name",
    keyField: "card_key",
    idAliases: ["player_id", "card_id", "id", "player_card", "playerCardId"],
    nameAliases: ["name", "player", "card_name"],
  },
  team: {
    entity: "team",
    idField: "team_id",
    nameField: "team_name",
    idAliases: ["id"],
    nameAliases: ["team", "name"],
  },
  collection: {
    entity: "collection",
    idField: "collection_id",
    nameField: "collection_name",
    idAliases: ["id"],
    nameAliases: ["collection", "name"],
  },
  sub_collection: {
    entity: "sub_collection",
    idField: "sub_collection_id",
    nameField: "sub_collection_name",
    idAliases: [],
    nameAliases: ["sub_collection"],
  },
  pack: {
    entity: "pack",
    idField: "pack_id",
    nameField: "pack_name",
    idAliases: ["id"],
    nameAliases: ["pack", "name", "pack_reward"],
  },
  road: {
    entity: "domination_road",
    idField: "road_id",
    nameField: "road_name",
    idAliases: ["domination_road_id", "id"],
    nameAliases: ["road", "name"],
  },
  challenge: {
    entity: "challenge",
    idField: "challenge_id",
    nameField: "challenge_name",
    idAliases: ["id"],
    nameAliases: ["challenge", "name"],
  },
  run: {
    entity: "run",
    idField: "run_id",
    nameField: "run_name",
    idAliases: ["id"],
    nameAliases: ["run", "name"],
  },
};

export interface NormalizedRef {
  fields: Record<string, unknown>;
  warnings: AdminApiWarning[];
}

/**
 * Folds aliases into the canonical id/name/key fields for one reference object.
 * A UUID found in a name field is promoted to the id field (a common GPT slip).
 */
export function normalizeRef(
  kind: keyof typeof REF_SPECS | string,
  input: Record<string, unknown>,
  path: string,
): NormalizedRef {
  const spec = REF_SPECS[kind];
  const warnings: AdminApiWarning[] = [];
  if (!spec) return { fields: { ...input }, warnings };

  const out: Record<string, unknown> = { ...input };
  const deprecate = (alias: string, canonical: string) => {
    warnings.push({
      code: "DEPRECATED_FIELD",
      severity: "deprecation",
      message: `"${alias}" is a v1 alias for "${canonical}" and will be removed in a future API version.`,
      path: `${path}.${alias}`,
      entity_type: spec.entity,
      remediation: `Send "${canonical}" instead.`,
    });
  };

  for (const alias of spec.idAliases) {
    if (out[alias] !== undefined && out[spec.idField] === undefined) {
      if (isUuid(out[alias])) {
        out[spec.idField] = String(out[alias]).trim();
        deprecate(alias, spec.idField);
      }
    }
    if (alias !== spec.idField) delete out[alias];
  }
  for (const alias of spec.nameAliases) {
    if (out[alias] === undefined) continue;
    const value = out[alias];
    if (isUuid(value) && out[spec.idField] === undefined) {
      out[spec.idField] = String(value).trim();
      deprecate(alias, spec.idField);
    } else if (out[spec.nameField] === undefined && typeof value === "string") {
      out[spec.nameField] = value.trim();
      if (alias !== spec.nameField) deprecate(alias, spec.nameField);
    }
    if (alias !== spec.nameField) delete out[alias];
  }
  if (spec.keyField && typeof out[spec.keyField] === "string") {
    out[spec.keyField] = String(out[spec.keyField]).trim().toLowerCase();
  }
  if (typeof out[spec.nameField] === "string") out[spec.nameField] = String(out[spec.nameField]).trim();

  // client_ref links to an entity created in the same payload.
  if (out.client_ref !== undefined && out.temp_ref === undefined) {
    out.temp_ref = out.client_ref;
  }
  if (typeof out.temp_ref === "string" && !String(out.temp_ref).startsWith("ref:")) {
    out.temp_ref = String(out.temp_ref).trim();
  }
  delete out.client_ref;

  return { fields: out, warnings };
}

/** True when a reference object carries any usable target. */
export function hasTarget(kind: string, fields: Record<string, unknown>): boolean {
  const spec = REF_SPECS[kind];
  if (!spec) return true;
  return Boolean(
    fields[spec.idField] ||
      fields[spec.nameField] ||
      (spec.keyField && fields[spec.keyField]) ||
      fields.temp_ref,
  );
}
