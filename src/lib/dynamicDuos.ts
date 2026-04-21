const DUO_STAT_KEYS = [
  "stat_3pt",
  "stat_mid",
  "stat_fin",
  "stat_dnk",
  "stat_ast",
  "stat_stl",
  "stat_reb",
  "stat_blk",
  "stat_int",
] as const;

export type DuoStatKey = (typeof DUO_STAT_KEYS)[number];
export type DuoBoosts = Partial<Record<DuoStatKey, number>>;

export interface DynamicDuoRow {
  id: string;
  name: string;
  description?: string | null;
  player_card_id_a: string;
  player_card_id_b: string;
  boosts_a: DuoBoosts | null;
  boosts_b: DuoBoosts | null;
  is_active?: boolean;
}

export interface ActiveDynamicDuo {
  id: string;
  name: string;
  description?: string | null;
  cardIds: [string, string];
  cardNames: [string, string];
}

function normalizeBoosts(boosts: DuoBoosts | null | undefined): DuoBoosts {
  const normalized: DuoBoosts = {};
  for (const key of DUO_STAT_KEYS) {
    const value = Number(boosts?.[key] ?? 0);
    if (value !== 0) normalized[key] = value;
  }
  return normalized;
}

function applyBoostsToCard<T extends Record<string, any>>(card: T, boosts: DuoBoosts): T {
  const next: Record<string, any> = { ...card };
  for (const key of DUO_STAT_KEYS) {
    const boost = Number(boosts[key] ?? 0);
    if (!boost) continue;
    next[key] = Number(next[key] ?? 0) + boost;
  }
  return next as T;
}

export function summarizeBoosts(boosts: DuoBoosts | null | undefined) {
  const normalized = normalizeBoosts(boosts);
  return DUO_STAT_KEYS.filter((key) => normalized[key]).map((key) => `${key.replace("stat_", "").toUpperCase()} +${normalized[key]}`);
}

export function resolveActiveDynamicDuos<T extends { id: string; name: string } & Record<string, any>>(
  lineup: T[],
  duos: DynamicDuoRow[],
) {
  const boostedMap = new Map(lineup.map((card) => [card.id, { ...card }]));
  const usedCardIds = new Set<string>();
  const activeDuos: ActiveDynamicDuo[] = [];

  for (const duo of duos) {
    if (duo.is_active === false) continue;
    const cardA = boostedMap.get(duo.player_card_id_a);
    const cardB = boostedMap.get(duo.player_card_id_b);
    if (!cardA || !cardB) continue;
    if (usedCardIds.has(cardA.id) || usedCardIds.has(cardB.id)) continue;

    boostedMap.set(cardA.id, applyBoostsToCard(cardA, normalizeBoosts(duo.boosts_a)));
    boostedMap.set(cardB.id, applyBoostsToCard(cardB, normalizeBoosts(duo.boosts_b)));
    usedCardIds.add(cardA.id);
    usedCardIds.add(cardB.id);

    activeDuos.push({
      id: duo.id,
      name: duo.name,
      description: duo.description ?? null,
      cardIds: [cardA.id, cardB.id],
      cardNames: [cardA.name, cardB.name],
    });
  }

  return {
    lineup: lineup.map((card) => boostedMap.get(card.id) ?? card),
    activeDuos,
  };
}