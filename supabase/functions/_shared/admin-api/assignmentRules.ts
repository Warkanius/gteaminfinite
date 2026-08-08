// Canonical badge / signature-trait assignment rules.
//
// A card carries at most five badges and one signature trait. The only way past
// that is Mr. Versatile, which exists both as a badge and as a signature trait:
// its tier grants extra badge AND trait slots (base +1 ... actolytrene +5).
//
// The SAME rules are enforced by the bulk player API, the content-release engine
// and the admin wizard, so no surface can accept a card the others reject.

export const BASE_MAX_BADGES = 5;
export const BASE_MAX_TRAITS = 1;

/** Assignment tiers, lowest to highest. */
export const ASSIGNMENT_TIER_ORDER = ["base", "gold", "hof", "diamond", "actolytrene"] as const;

/** Extra badge and trait slots granted by each Mr. Versatile tier. */
export const MR_VERSATILE_SLOTS: Record<string, number> = {
  base: 1,
  gold: 2,
  hof: 3,
  diamond: 4,
  actolytrene: 5,
};

const MR_VERSATILE_NAMES = ["mr. versatile", "mr versatile", "mrversatile", "mv"];

/**
 * Any assignment shape accepted by the write surfaces: a bare name, or a row
 * carrying badge/trait/name/abbreviation plus an optional tier. Kept structurally
 * loose on purpose so the bulk normalizer, the release engine and the admin UI
 * can all hand their own row types to the same rule check.
 */
type Row = string | Record<string, unknown> | object;

const field = (row: object, key: string): unknown => (row as Record<string, unknown>)[key];

function label(row: Row, kind: "badge" | "trait"): string {
  if (typeof row === "string") return row.trim().toLowerCase();
  const value = field(row, kind) ?? field(row, "name") ?? field(row, "abbreviation") ?? "";
  return String(value).trim().toLowerCase();
}

function tierOf(row: Row): string {
  if (typeof row === "string") return "base";
  return String(field(row, "tier") ?? "base").trim().toLowerCase();
}

/** True when this assignment is Mr. Versatile (badge or signature trait). */
export function isMrVersatile(row: Row, kind: "badge" | "trait"): boolean {
  return MR_VERSATILE_NAMES.includes(label(row, kind));
}

export interface AssignmentAllowance {
  max_badges: number;
  max_traits: number;
  mr_versatile_tier: string | null;
  extra_slots: number;
}

/**
 * Effective badge/trait allowance for one card, given the assignments being
 * written. Mr. Versatile counts toward its own list, so a card with the
 * actolytrene badge may hold 5 + 5 = 10 badges in total.
 */
export function assignmentAllowance(
  badges: readonly Row[] | undefined,
  traits: readonly Row[] | undefined,
): AssignmentAllowance {
  let tier: string | null = null;
  let extra = 0;
  const consider = (row: Row, kind: "badge" | "trait") => {
    if (!isMrVersatile(row, kind)) return;
    const slots = MR_VERSATILE_SLOTS[tierOf(row)] ?? 0;
    if (slots > extra) {
      extra = slots;
      tier = tierOf(row);
    }
  };
  (badges ?? []).forEach((b) => consider(b, "badge"));
  (traits ?? []).forEach((t) => consider(t, "trait"));
  return {
    max_badges: BASE_MAX_BADGES + extra,
    max_traits: BASE_MAX_TRAITS + extra,
    mr_versatile_tier: tier,
    extra_slots: extra,
  };
}

export interface AssignmentLimitIssue {
  code: "TOO_MANY_BADGES" | "TOO_MANY_TRAITS";
  field: "badges" | "traits";
  message: string;
  allowed: number;
  received: number;
}

/** Limit check shared by every write surface. Returns [] when the card is legal. */
export function checkAssignmentLimits(
  badges: readonly Row[] | undefined,
  traits: readonly Row[] | undefined,
): AssignmentLimitIssue[] {
  const allowance = assignmentAllowance(badges, traits);
  const issues: AssignmentLimitIssue[] = [];
  const explain = allowance.extra_slots
    ? ` (${BASE_MAX_BADGES} base + ${allowance.extra_slots} from the ${allowance.mr_versatile_tier} Mr. Versatile)`
    : " — add Mr. Versatile to raise the cap";
  if (badges && badges.length > allowance.max_badges) {
    issues.push({
      code: "TOO_MANY_BADGES",
      field: "badges",
      message: `A card may hold ${allowance.max_badges} badge(s)${explain}, received ${badges.length}.`,
      allowed: allowance.max_badges,
      received: badges.length,
    });
  }
  if (traits && traits.length > allowance.max_traits) {
    issues.push({
      code: "TOO_MANY_TRAITS",
      field: "traits",
      message: `A card may hold ${allowance.max_traits} signature trait(s)${
        allowance.extra_slots
          ? ` (${BASE_MAX_TRAITS} base + ${allowance.extra_slots} from the ${allowance.mr_versatile_tier} Mr. Versatile)`
          : " — add Mr. Versatile to raise the cap"
      }, received ${traits.length}.`,
      allowed: allowance.max_traits,
      received: traits.length,
    });
  }
  return issues;
}

/** Human-readable rule used by capabilities and GPT-facing docs. */
export const ASSIGNMENT_RULE_DOC =
  `A card holds up to ${BASE_MAX_BADGES} badges and ${BASE_MAX_TRAITS} signature trait. Mr. Versatile (available as a badge or a signature trait) raises both caps by its tier: ` +
  Object.entries(MR_VERSATILE_SLOTS)
    .map(([tier, slots]) => `${tier} +${slots}`)
    .join(", ") +
  `. Supplying badges or traits always replaces the whole set; [] clears it; omitting the field leaves existing assignments untouched.`;
