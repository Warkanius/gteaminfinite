/**
 * Universal atomic content release bundle.
 *
 * A "release" is one JSON payload describing a collection, its player cards,
 * a pack (ordered pool + odds), multi-step evo paths and optional extras.
 * It is validated client-side for fast feedback, then previewed and committed
 * server-side through `public.admin_apply_batch` (one Postgres transaction).
 *
 * Client validation is a convenience only — the database engine re-validates
 * everything and is the single source of truth.
 */

/** UI objective label -> database objective/stat keys. */
export const OBJECTIVE_KEYS = {
  points: { objective_type: "total_stat", stat_key: "stat_pts", label: "Total points" },
  three_pointers: { objective_type: "total_stat", stat_key: "stat_3pt", label: "Three-pointers made" },
  mid_range: { objective_type: "total_stat", stat_key: "stat_mid", label: "Mid-range shots made" },
  dunks: { objective_type: "total_stat", stat_key: "stat_dnk", label: "Dunks made" },
  assists: { objective_type: "total_stat", stat_key: "stat_ast", label: "Assists" },
  steals: { objective_type: "total_stat", stat_key: "stat_stl", label: "Steals" },
  rebounds: { objective_type: "total_stat", stat_key: "stat_reb", label: "Rebounds" },
  blocks: { objective_type: "total_stat", stat_key: "stat_blk", label: "Blocks" },
  games_won: { objective_type: "games_won", stat_key: null, label: "Games won" },
} as const;

export type ObjectiveKey = keyof typeof OBJECTIVE_KEYS;

export const STAT_RANGE = { min: 0, max: 99 };

export interface ReleaseObjective {
  key: string;
  target: number;
  description?: string;
}

export interface ReleaseEvoStep {
  step_order: number;
  from_tier: string;
  to_tier: string;
  objectives: ReleaseObjective[];
  final_stats?: Record<string, number>;
  badges?: unknown[];
  traits?: unknown[];
  status?: "draft" | "active";
}

export interface ReleaseEvoPath {
  player: string;
  final_tier?: string;
  status?: "draft" | "active";
  steps: ReleaseEvoStep[];
}

export interface ReleasePlayer {
  /** Immutable id when editing, otherwise resolved by card_key or exact name. */
  player_id?: string;
  card_key?: string;
  name: string;
  action?: "create" | "update" | "upsert";
  is_reward_card?: boolean;
  badges?: unknown[];
  traits?: unknown[];
  [field: string]: unknown;
}

export interface ReleasePackSlot {
  slot_number: number;
  player: string;
}

export interface ReleasePackOdds {
  dice_roll: string;
  result_slot: string;
  percentage: number;
  description?: string;
}

export interface ReleaseDraft {
  release: {
    name: string;
    version_label?: string;
    version_number?: number;
    status?: "draft" | "active";
    notes?: string;
    parent_release_id?: string;
  };
  collection?: {
    name: string;
    description?: string;
    reward_card?: string;
    members?: string[];
    sub_collections?: Array<Record<string, unknown>>;
  };
  players: ReleasePlayer[];
  pack?: {
    name: string;
    pack_type?: string;
    cost?: number;
    ten_box_cost?: number;
    status?: "draft" | "active";
    pool: ReleasePackSlot[];
    odds: ReleasePackOdds[];
  };
  evo_paths?: ReleaseEvoPath[];
  /** Any additional admin_apply_batch groups passed through untouched. */
  extras?: Record<string, unknown[]>;
  team_link?: string;
}

export interface ValidationIssue {
  scope: string;
  message: string;
  severity: "error" | "warning";
}

export function emptyDraft(): ReleaseDraft {
  return {
    release: { name: "", version_label: "v1", version_number: 1, status: "draft" },
    collection: { name: "", members: [], sub_collections: [] },
    players: [],
    pack: { name: "", pack_type: "standard", cost: 0, ten_box_cost: 0, status: "draft", pool: [], odds: [] },
    evo_paths: [],
  };
}

export function oddsTotal(odds: ReleasePackOdds[] | undefined): number {
  return Number(
    (odds ?? []).reduce((sum, row) => sum + (Number(row.percentage) || 0), 0).toFixed(4),
  );
}

/**
 * Validates a draft. Collects every problem instead of failing on the first,
 * so the commissioner can fix a whole release in one pass.
 */
export function validateDraft(draft: ReleaseDraft, knownTiers: string[] = []): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (scope: string, message: string) => issues.push({ scope, message, severity: "error" });
  const warn = (scope: string, message: string) => issues.push({ scope, message, severity: "warning" });

  if (!draft.release?.name?.trim()) err("release", "Release name is required.");

  const names = new Map<string, number>();
  draft.players.forEach((p, i) => {
    const key = (p.card_key ?? p.name ?? "").trim().toLowerCase();
    if (!p.name?.trim() && !p.player_id) err(`players[${i}]`, "Each card needs a name, card_key or player_id.");
    if (key) names.set(key, (names.get(key) ?? 0) + 1);
    for (const [field, value] of Object.entries(p)) {
      if (field.startsWith("stat_") && typeof value === "number") {
        if (value < STAT_RANGE.min || value > STAT_RANGE.max) {
          err(`players[${i}].${field}`, `Stat must be between ${STAT_RANGE.min} and ${STAT_RANGE.max}.`);
        }
      }
    }
  });
  for (const [key, count] of names) {
    if (count > 1) {
      err("players", `"${key}" appears ${count} times in this release — use card_key or player_id to disambiguate.`);
    }
  }

  const rewardCards = draft.players.filter((p) => p.is_reward_card);
  if (draft.collection?.name) {
    if (rewardCards.length > 1) {
      err("collection.reward", "Exactly one card may be the collection reward.");
    }
    const rewardName = draft.collection.reward_card ?? rewardCards[0]?.name;
    if (rewardName && !draft.players.some((p) => sameName(p, rewardName))) {
      err("collection.reward", `Reward card "${rewardName}" is not part of this release.`);
    }
    if (draft.collection.members?.length) {
      const missing = draft.collection.members.filter((m) => !draft.players.some((p) => sameName(p, m)));
      if (missing.length) err("collection.members", `Not in this release: ${missing.join(", ")}.`);
    }
  }

  const pack = draft.pack;
  if (pack && (pack.name?.trim() || pack.pool.length || pack.odds.length)) {
    if (!pack.name?.trim()) err("pack", "Pack name is required when a pack is included.");
    const slots = new Set<number>();
    pack.pool.forEach((slot, i) => {
      if (slots.has(slot.slot_number)) err(`pack.pool[${i}]`, `Duplicate slot ${slot.slot_number}.`);
      slots.add(slot.slot_number);
      if (!draft.players.some((p) => sameName(p, slot.player))) {
        err(`pack.pool[${i}]`, `Pool card "${slot.player}" is not part of this release.`);
      }
      const target = draft.players.find((p) => sameName(p, slot.player));
      if (target?.is_reward_card) {
        err(`pack.pool[${i}]`, `"${slot.player}" is the collection reward and cannot be pullable from the pack.`);
      }
    });
    const sorted = [...pack.pool].map((s) => s.slot_number).sort((a, b) => a - b);
    sorted.forEach((n, i) => {
      if (n !== i + 1) warn("pack.pool", `Slot order is not contiguous starting at 1 (found ${n} at position ${i + 1}).`);
    });
    const total = oddsTotal(pack.odds);
    if (pack.odds.length && total !== 100) err("pack.odds", `Odds total ${total}% — must be exactly 100%.`);
    pack.odds.forEach((row, i) => {
      const slotRef = Number(row.result_slot);
      if (Number.isFinite(slotRef) && !slots.has(slotRef)) {
        err(`pack.odds[${i}]`, `result_slot ${row.result_slot} does not exist in the pool.`);
      }
      if (!(Number(row.percentage) > 0)) err(`pack.odds[${i}]`, "Percentage must be greater than 0.");
    });
  }

  const tierIndex = new Map(knownTiers.map((t, i) => [t.toLowerCase(), i]));
  (draft.evo_paths ?? []).forEach((path, pi) => {
    const scope = `evo_paths[${pi}]`;
    if (!path.player?.trim()) err(scope, "Evo path needs a player card.");
    if (!path.steps?.length) err(scope, "Evo path needs at least one step.");
    const steps = [...(path.steps ?? [])].sort((a, b) => a.step_order - b.step_order);
    steps.forEach((step, si) => {
      const sScope = `${scope}.steps[${step.step_order}]`;
      if (step.step_order !== si + 1) err(sScope, `Step order must be continuous from 1 (expected ${si + 1}).`);
      if (!step.from_tier || !step.to_tier) err(sScope, "Both from_tier and to_tier are required.");
      if (knownTiers.length) {
        if (step.from_tier && !tierIndex.has(step.from_tier.toLowerCase())) err(sScope, `Unknown tier "${step.from_tier}".`);
        if (step.to_tier && !tierIndex.has(step.to_tier.toLowerCase())) err(sScope, `Unknown tier "${step.to_tier}".`);
        const from = tierIndex.get((step.from_tier ?? "").toLowerCase());
        const to = tierIndex.get((step.to_tier ?? "").toLowerCase());
        if (from != null && to != null) {
          if (to <= from) err(sScope, `"${step.to_tier}" does not advance past "${step.from_tier}".`);
          else if (to - from > 1) err(sScope, `Step skips intermediate tier(s) between "${step.from_tier}" and "${step.to_tier}".`);
        }
      }
      if (si > 0 && steps[si - 1].to_tier && step.from_tier && steps[si - 1].to_tier !== step.from_tier) {
        err(sScope, `Step must start from "${steps[si - 1].to_tier}" (previous step's target tier).`);
      }
      if (!step.objectives?.length) err(sScope, "Each step needs at least one objective.");
      (step.objectives ?? []).forEach((obj, oi) => {
        if (!(obj.key in OBJECTIVE_KEYS)) err(`${sScope}.objectives[${oi}]`, `Unsupported objective "${obj.key}".`);
        if (!Number.isInteger(obj.target) || obj.target <= 0) {
          err(`${sScope}.objectives[${oi}]`, "Objective target must be a positive integer.");
        }
      });
      Object.entries(step.final_stats ?? {}).forEach(([k, v]) => {
        if (typeof v !== "number" || v < STAT_RANGE.min || v > STAT_RANGE.max) {
          err(`${sScope}.final_stats.${k}`, `Stat must be between ${STAT_RANGE.min} and ${STAT_RANGE.max}.`);
        }
      });
    });
    const last = steps[steps.length - 1];
    if (path.final_tier && last?.to_tier && last.to_tier.toLowerCase() !== path.final_tier.toLowerCase()) {
      err(scope, `Final step ends at "${last.to_tier}" but declared final tier is "${path.final_tier}".`);
    }
  });

  return issues;
}

function sameName(player: ReleasePlayer, ref: string) {
  const r = ref.trim().toLowerCase();
  return (
    player.name?.trim().toLowerCase() === r ||
    player.card_key?.trim().toLowerCase() === r ||
    player.player_id === ref
  );
}

const refFor = (name: string) => `ref:player:${slug(name)}`;

function slug(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

/**
 * Turns a draft into an `admin_apply_batch` payload. Cross-entity links use
 * temp_refs so cards, collection, pack and evo paths resolve in one transaction.
 */
export function buildBundlePayload(draft: ReleaseDraft): Record<string, unknown> {
  const releaseRef = "ref:release:main";
  const collectionRef = "ref:collection:main";
  const payload: Record<string, unknown> = {
    release_bundles: [
      {
        temp_ref: releaseRef,
        action: "upsert",
        name: draft.release.name,
        version_label: draft.release.version_label ?? null,
        version_number: draft.release.version_number ?? 1,
        parent_release_id: draft.release.parent_release_id ?? null,
        notes: draft.release.notes ?? null,
        status: draft.release.status ?? "draft",
      },
    ],
  };

  const players = draft.players.map((p) => {
    const { is_reward_card, ...rest } = p;
    return {
      temp_ref: p.player_id ? undefined : refFor(p.card_key ?? p.name),
      action: p.action ?? (p.player_id || p.card_key ? "upsert" : "create"),
      ...rest,
      ...(draft.collection?.name ? { collection: draft.collection.name } : {}),
      release_bundle_ref: releaseRef,
    };
  });
  if (players.length) payload.players = players;

  if (draft.collection?.name) {
    const rewardName =
      draft.collection.reward_card ?? draft.players.find((p) => p.is_reward_card)?.name;
    payload.collections = [
      {
        temp_ref: collectionRef,
        action: "upsert",
        name: draft.collection.name,
        description: draft.collection.description ?? null,
        release_bundle_ref: releaseRef,
        ...(rewardName ? { reward_card_ref: playerRef(draft, rewardName) } : {}),
      },
    ];
    if (draft.collection.sub_collections?.length) {
      payload.sub_collections = draft.collection.sub_collections.map((s) => ({
        action: "upsert",
        collection_ref: collectionRef,
        ...s,
      }));
    }
    const members = draft.collection.members?.length
      ? draft.collection.members
      : draft.players.map((p) => p.name);
    payload.collection_requirements = [
      {
        action: "replace",
        collection_ref: collectionRef,
        requirements: members.map((m, i) => ({
          player_ref: playerRef(draft, m),
          sort_order: i + 1,
          is_reward_card: !!draft.players.find((p) => sameName(p, m))?.is_reward_card,
        })),
      },
    ];
  }

  const pack = draft.pack;
  if (pack?.name?.trim()) {
    payload.packs = [
      {
        action: "upsert",
        name: pack.name,
        pack_type: pack.pack_type ?? "standard",
        cost: pack.cost ?? 0,
        ten_box_cost: pack.ten_box_cost ?? 0,
        status: pack.status ?? "draft",
        release_bundle_ref: releaseRef,
        ...(draft.collection?.name ? { collection_ref: collectionRef } : {}),
        replace_pool: true,
        pool: [...pack.pool]
          .sort((a, b) => a.slot_number - b.slot_number)
          .map((s) => ({ slot_number: s.slot_number, player_ref: playerRef(draft, s.player) })),
        replace_odds: true,
        odds: pack.odds.map((o) => ({
          dice_roll: o.dice_roll,
          result_slot: o.result_slot,
          percentage: o.percentage,
          description: o.description ?? null,
          pack_type: pack.pack_type ?? "standard",
        })),
      },
    ];
  }

  if (draft.evo_paths?.length) {
    payload.evo_paths = draft.evo_paths.flatMap((path) =>
      [...path.steps]
        .sort((a, b) => a.step_order - b.step_order)
        .map((step) => ({
          action: "upsert",
          source_player_ref: playerRef(draft, path.player),
          from_gem_tier: step.from_tier,
          to_gem_tier: step.to_tier,
          step_order: step.step_order,
          status: step.status ?? path.status ?? "draft",
          objective_mode: "structured",
          objectives: step.objectives.map((o, i) => ({
            ...OBJECTIVE_KEYS[o.key as ObjectiveKey],
            target: o.target,
            description: o.description ?? null,
            sort_order: i + 1,
          })),
          ...(step.final_stats ? { final_stats: step.final_stats } : {}),
          ...(step.badges ? { new_badges: step.badges } : {}),
          ...(step.traits ? { new_traits: step.traits } : {}),
          release_bundle_ref: releaseRef,
        })),
    );
  }

  if (draft.team_link) payload.teams = [{ action: "upsert", name: draft.team_link, release_bundle_ref: releaseRef }];

  for (const [group, items] of Object.entries(draft.extras ?? {})) {
    if (Array.isArray(items) && items.length) payload[group] = items;
  }

  return payload;
}

function playerRef(draft: ReleaseDraft, ref: string) {
  const match = draft.players.find((p) => sameName(p, ref));
  if (match?.player_id) return match.player_id;
  return refFor(match?.card_key ?? match?.name ?? ref);
}
