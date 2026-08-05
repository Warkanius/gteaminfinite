// Canonical structured error model for the versioned GPT admin API.
// Every failure the GPT can see must be expressible here: stable code, JSON path,
// entity, expected vs received, whether anything was written, and remediation.

export const API_VERSION = "v1";

export interface AdminApiError {
  code: string;
  message: string;
  path?: string;
  entity_type?: string;
  entity_id?: string;
  input_ref?: string;
  expected?: unknown;
  received?: unknown;
  matches?: Array<Record<string, unknown>>;
  written: boolean;
  remediation?: string;
  /** Stable public alias so clients can branch on a small, documented set of codes. */
  alias?: string;
}

export interface AdminApiWarning {
  code: string;
  message: string;
  path?: string;
  entity_type?: string;
  entity_id?: string;
  severity: "warning" | "info" | "destructive" | "deprecation";
  remediation?: string;
}


/**
 * Public alias codes. The internal code stays specific; the alias is one of the
 * four documented families a client (the Custom GPT) is expected to branch on.
 */
export const ERROR_ALIASES: Record<string, string> = {
  PREVIEW_EXPIRED: "TOKEN_EXPIRED",
  PREVIEW_ALREADY_COMMITTED: "TOKEN_EXPIRED",
  UNKNOWN_PREVIEW_TOKEN: "TOKEN_EXPIRED",
  UNKNOWN_PREVIEW: "TOKEN_EXPIRED",
  PREVIEW_REQUIRED: "PREVIEW_MISMATCH",
  PREVIEW_MISMATCH: "PREVIEW_MISMATCH",
  PREVIEW_OPERATION_MISMATCH: "PREVIEW_MISMATCH",
  PREVIEW_OWNER_MISMATCH: "PREVIEW_MISMATCH",
  PREVIEW_STALE: "PREVIEW_MISMATCH",
  IDEMPOTENCY_MISMATCH: "PREVIEW_MISMATCH",
};

export function aliasFor(code: string, stage: Failure["stage"]): string {
  if (ERROR_ALIASES[code]) return ERROR_ALIASES[code];
  if (stage === "commit") return "COMMIT_FAILED";
  return "VALIDATION_FAILED";
}

export function apiError(code: string, message: string, extra: Partial<AdminApiError> = {}): AdminApiError {
  return { code, message, written: false, ...extra };
}

export function apiWarning(
  code: string,
  message: string,
  extra: Partial<AdminApiWarning> = {},
): AdminApiWarning {
  return { code, message, severity: "warning", ...extra };
}

export interface Failure {
  ok: false;
  api_version: string;
  operation?: string;
  stage: "auth" | "validation" | "resolution" | "preview" | "commit" | "schedule";
  /** One of PREVIEW_MISMATCH | TOKEN_EXPIRED | VALIDATION_FAILED | COMMIT_FAILED. */
  error_code: string;
  wrote_anything: false;
  errors: AdminApiError[];
  warnings?: AdminApiWarning[];
}

export function failure(
  stage: Failure["stage"],
  errors: AdminApiError[],
  operation?: string,
  warnings: AdminApiWarning[] = [],
): Failure {
  const withAlias = errors.map((e) => ({ ...e, alias: e.alias ?? aliasFor(e.code, stage) }));
  return {
    ok: false,
    api_version: API_VERSION,
    operation,
    stage,
    error_code: withAlias[0]?.alias ?? (stage === "commit" ? "COMMIT_FAILED" : "VALIDATION_FAILED"),
    wrote_anything: false,
    errors: withAlias,
    warnings,
  };
}


const CODE_HINTS: Record<string, string> = {
  NOT_AUTHENTICATED: "Sign in to GTeam Infinite Hub and retry; the action token expired.",
  FORBIDDEN: "This operation requires the admin role on the signed-in account.",
  PREVIEW_REQUIRED: "Call the matching /preview endpoint, show the plan, get approval, then commit with its preview_token.",
  UNKNOWN_PREVIEW_TOKEN: "The token is unknown for this admin. Run a fresh preview.",
  PREVIEW_ALREADY_COMMITTED: "Preview tokens are single use. Run a fresh preview.",
  PREVIEW_EXPIRED: "The preview expired. Run a fresh preview and get approval again.",
  PREVIEW_MISMATCH: "Commit the byte-identical payload that was previewed; re-preview after any edit.",
  PREVIEW_STALE: "Underlying records changed after approval. Run a fresh preview.",
  UNKNOWN_GROUP: "Use only groups listed by GET /admin-api/v1/capabilities.",
  AMBIGUOUS_PLAYER_NAME: "Send player_card_id for the exact card instead of a name.",
  UNRESOLVED_REFERENCE: "Check spelling, or create the entity in the same payload with a client_ref.",
  OVR_TIER_MISMATCH: "Adjust the nine base stats or request a different gem tier explicitly.",
  ODDS_TOTAL: "Pack odds must total exactly 100.00 in fixed precision.",
  EVO_TIER_SKIP: "Evo steps must progress one tier at a time with no gaps.",
  EVO_MISSING_VERSION: "Every evo step needs a resulting_version so the unlocked card is playable.",
  IDEMPOTENCY_MISMATCH: "This idempotency key was already used with a different payload. Use a new key.",
  PAYLOAD_TOO_LARGE: "Split the request, or use the paginated preview detail endpoints.",
};

/** Turns a Postgres engine error into the canonical error shape. */
export function fromDbError(message: string, stage: Failure["stage"], operation?: string): Failure {
  const codeMatch = message.match(/^([A-Z_]{3,}):\s*([\s\S]*)$/);
  let code = codeMatch ? codeMatch[1] : "ENGINE_REJECTED";
  let text = codeMatch ? codeMatch[2] : message;
  let detail: Record<string, unknown> = {};

  const d = text.match(/\s*detail=(\{[\s\S]*\})\s*$/);
  if (d) {
    try {
      detail = JSON.parse(d[1]);
      text = text.slice(0, d.index).trim();
    } catch {
      /* keep raw */
    }
  }
  const m = text.match(/matches=(\[[\s\S]*\])\s*$/);
  if (m) {
    try {
      detail.matches = JSON.parse(m[1]);
      text = text.slice(0, m.index).trim();
    } catch {
      /* keep raw */
    }
  }
  if (code === "MISSING_SOURCE_CARD") code = "UNRESOLVED_REFERENCE";

  const { matches, path, entity_type, entity_id, field, ...rest } = detail as Record<string, unknown>;
  return failure(
    stage,
    [
      {
        code,
        message: text.trim(),
        written: false,
        path: (path as string) ?? (field ? String(field) : undefined),
        entity_type: entity_type as string | undefined,
        entity_id: entity_id as string | undefined,
        matches: matches as Array<Record<string, unknown>> | undefined,
        remediation: CODE_HINTS[code],
        ...(Object.keys(rest).length ? { received: rest } : {}),
      },
    ],
    operation,
  );
}

export function hintFor(code: string) {
  return CODE_HINTS[code];
}
