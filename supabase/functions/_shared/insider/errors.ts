// Structured errors for the player-facing Insider API.
//
// Every failure the GTeam Insider Custom GPT can hit has a stable machine code
// so the model can branch on it instead of parsing prose.

export const INSIDER_ERROR_CODES = [
  "AUTH_REQUIRED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CARD_NOT_OWNED",
  "CARD_NOT_ELIGIBLE",
  "LINEUP_NOT_FOUND",
  "INVALID_LINEUP",
  "INVALID_CARD_VERSION",
  "INSUFFICIENT_ELIGIBLE_CARDS",
  "EVO_NOT_FOUND",
  "GAME_NOT_FOUND",
  "VALIDATION_FAILED",
  "READ_ONLY_SURFACE",
  "RATE_LIMIT",
  "INTERNAL_ERROR",
] as const;

export type InsiderErrorCode = (typeof INSIDER_ERROR_CODES)[number];

export class InsiderError extends Error {
  code: InsiderErrorCode;
  status: number;
  detail?: unknown;

  constructor(code: InsiderErrorCode, message: string, status?: number, detail?: unknown) {
    super(message);
    this.code = code;
    this.status = status ?? defaultStatus(code);
    this.detail = detail;
  }
}

function defaultStatus(code: InsiderErrorCode): number {
  switch (code) {
    case "AUTH_REQUIRED":
      return 401;
    case "FORBIDDEN":
    case "READ_ONLY_SURFACE":
      return 403;
    case "NOT_FOUND":
    case "LINEUP_NOT_FOUND":
    case "EVO_NOT_FOUND":
    case "GAME_NOT_FOUND":
      return 404;
    case "RATE_LIMIT":
      return 429;
    case "INTERNAL_ERROR":
      return 500;
    default:
      return 400;
  }
}

export function insiderErrorBody(e: unknown): { body: Record<string, unknown>; status: number } {
  if (e instanceof InsiderError) {
    return {
      status: e.status,
      body: { error: { code: e.code, message: e.message, detail: e.detail ?? null } },
    };
  }
  const message = e instanceof Error ? e.message : String(e);

  // Database-level guards raise "CODE: message"; surface the code faithfully.
  const match = /^([A-Z_]{4,40}):\s*(.*)$/.exec(message);
  if (match && (INSIDER_ERROR_CODES as readonly string[]).includes(match[1])) {
    const code = match[1] as InsiderErrorCode;
    return { status: defaultStatus(code), body: { error: { code, message: match[2], detail: null } } };
  }
  if (/duplicate key value.*no_duplicate_card/i.test(message)) {
    return {
      status: 400,
      body: {
        error: {
          code: "INVALID_LINEUP",
          message: "The same card cannot appear twice in one lineup.",
          detail: null,
        },
      },
    };
  }
  return { status: 500, body: { error: { code: "INTERNAL_ERROR", message, detail: null } } };
}
