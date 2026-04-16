// Game Engine v2 — NBA-style scoring with star-based multipliers

export const STATS = [
  "stat_3pt", "stat_mid", "stat_fin", "stat_dnk",
  "stat_ast", "stat_stl", "stat_reb", "stat_blk", "stat_int",
] as const;

export type StatKey = typeof STATS[number];

export const STAT_LABELS: Record<StatKey, string> = {
  stat_3pt: "3PT", stat_mid: "MID", stat_fin: "FIN", stat_dnk: "DNK",
  stat_ast: "AST", stat_stl: "STL", stat_reb: "REB", stat_blk: "BLK", stat_int: "INT",
};

export const SCORING_STATS: StatKey[] = ["stat_3pt", "stat_mid", "stat_fin", "stat_dnk", "stat_int"];

/** Maps star rating to roll multiplier (legacy — kept for backward compat) */
export function getStarModifier(stars: number): number {
  const map: Record<number, number> = {
    0: 0, 1: 0.5, 2: 1, 3: 1.5, 4: 2, 5: 2.5,
    6: 3, 7: 3.5, 8: 4, 9: 4.5, 10: 5, 11: 5.5, 12: 6,
  };
  return map[stars] ?? 0;
}

/** Legacy dice count from overall stars — kept for backward compat */
export function getDiceCount(stars: number): 1 | 2 {
  return stars >= 4 ? 2 : 1;
}

// ─── Tabletop Dice Mechanics ───
// Pattern: 0=no roll, 1=1d6×0.5, 2=1d6×1, 3=1d6×1.5, 4=2d6×1, 5=2d6×1.5(+doubles),
// 6=3d6×1, 7=3d6×1.5(+match), 8=4d6×1, 9=4d6×1.5(+match), 10=5d6×1, 11=5d6×1.5(+match), 12=6d6×1

/** Dice count derived from individual stat value (tabletop rules) */
export function getStatDiceCount(statValue: number): number {
  if (statValue <= 0) return 0;
  if (statValue <= 3) return 1;  // 1-3 stars → 1d6
  if (statValue <= 5) return 2;  // 4-5 stars → 2d6
  if (statValue <= 7) return 3;  // 6-7 stars → 3d6
  if (statValue <= 9) return 4;  // 8-9 stars → 4d6
  if (statValue <= 11) return 5; // 10-11 stars → 5d6
  return 6;                       // 12 stars → 6d6
}

/** Roll modifier derived from individual stat value (tabletop rules) */
export function getStatModifier(statValue: number): number {
  if (statValue <= 0) return 0;
  if (statValue === 1) return 0.5;
  // Even stars = ×1, odd stars (3+) = ×1.5
  return statValue % 2 === 0 ? 1 : 1.5;
}

/** Check if at least 2 dice in the array share the same value */
export function hasMatchingDice(dice: number[]): boolean {
  const counts: Record<number, number> = {};
  for (const d of dice) {
    counts[d] = (counts[d] || 0) + 1;
    if (counts[d] >= 2) return true;
  }
  return false;
}

/** Whether matching-dice bonus applies (5+ stars) */
export function hasMatchBonus(statValue: number, dice: number[]): boolean {
  return statValue >= 5 && hasMatchingDice(dice);
}

// ─── Runs Mode (pure stat-driven tabletop dice) ───
//
// The Runs uses individual stat values (0–240+) only. Each stat maps to a
// 0–12 star band: 0–19=0★, 20–39=1★, 40–59=2★, … 240+=12★. Dice count and
// modifier come from those stars via getStatDiceCount / getStatModifier.
// There is NO "Runs OVR" multiplier and no offense-side advantage.

/** Convert a 0–240+ stat value to its 0–12 star band */
export function runStatToStars(value: number): number {
  if (!value || value < 0) return 0;
  return Math.min(12, Math.floor(value / 20));
}

/** @deprecated Kept only so the lineup overlay compiles; carries no gameplay meaning */
export function starStatToRunStat(starStat: number): number {
  return starStat * 20;
}

/** Map an offensive stat to the appropriate defensive stat */
export function getDefenseStat(offenseStat: StatKey): StatKey {
  // Inside moves → BLK (rim protector)
  if (offenseStat === "stat_fin" || offenseStat === "stat_dnk") return "stat_blk";
  // Perimeter → STL (direct matchup)
  return "stat_stl";
}

/** Whether a stat is an "inside" move (defended by slot 3's BLK) */
export function isInsideStat(stat: StatKey): boolean {
  return stat === "stat_fin" || stat === "stat_dnk";
}

/** Pick a rebounder slot using weighted probability: slot 3=60%, slot 2=25%, slot 1=15% */
export function pickRebounderSlot(): number {
  const roll = Math.random();
  if (roll < 0.60) return 2; // slot 3 (0-indexed)
  if (roll < 0.85) return 1; // slot 2
  return 0; // slot 1
}

/** Resolve a rebound roll using combined (REB + BLK) / 2 stat */
export function resolveRunReboundRoll(
  reb: number,
  blk: number,
  runRating: number,
  dice: number[],
): number {
  const combinedStat = (reb + blk) / 2;
  const modifier = getRunModifier(runRating);
  const diceTotal = dice.reduce((a, b) => a + b, 0);
  return Math.round(diceTotal * modifier * (combinedStat / 60));
}

/** Resolve a shot contest: offense stat roll vs defense counter stat roll */
export interface ShotContestResult {
  offenseRoll: number;
  defenseRoll: number;
  made: boolean;
  points: number;
  offenseDice: number[];
  defenseDice: number[];
  offenseModifier: number;
  defenseModifier: number;
  offenseStat: StatKey;
  defenseStat: StatKey;
}

/** Offensive advantage applied to all Runs shots (~+15%) — pushes overall make rate to ~60%. */
export const RUNS_OFFENSE_ADVANTAGE = 1.15;
/** Defense roll cannot drop below this fraction of offense roll. */
export const RUNS_DEFENSE_MIN_RATIO = 0.5;
/** Defense roll cannot exceed this fraction of offense roll (caps lucky stops on mismatches). */
export const RUNS_DEFENSE_MAX_RATIO = 1.5;
/** Per-point stat-gap bonus added to offense roll (favours obvious mismatches). */
export const RUNS_STATGAP_BONUS_PER_POINT = 0.04;
/** Threshold (offense stat − defense stat) above which the stat-gap bonus kicks in. */
export const RUNS_STATGAP_THRESHOLD = 15;

export function resolveRunShotContest(
  offenseStat: StatKey,
  offenseStatValue: number,
  offRating: number,
  offDice: number[],
  defenseStat: StatKey,
  defenseStatValue: number,
  defRating: number,
  defDice: number[],
  offenseBonus: number = 0,
  defenseBonus: number = 0,
): ShotContestResult {
  const offMod = getRunModifier(offRating);
  const defMod = getRunModifier(defRating);
  const offTotal = offDice.reduce((a, b) => a + b, 0);
  const defTotal = defDice.reduce((a, b) => a + b, 0);

  // Base rolls
  const baseOffense = offTotal * offMod * (offenseStatValue / 60);
  const baseDefense = defTotal * defMod * (defenseStatValue / 60);

  // Stat-gap bonus: when shooter's stat meaningfully exceeds defender's counter-stat,
  // add a flat +N% per point of gap above the threshold.
  const gap = offenseStatValue - defenseStatValue;
  const gapBonus = gap > RUNS_STATGAP_THRESHOLD
    ? 1 + (gap - RUNS_STATGAP_THRESHOLD) * RUNS_STATGAP_BONUS_PER_POINT
    : 1;

  // Offense gets the universal advantage + the stat-gap multiplier + badge bonus
  let offenseRoll = Math.round(baseOffense * RUNS_OFFENSE_ADVANTAGE * gapBonus) + Math.round(offenseBonus);
  let defenseRoll = Math.round(baseDefense) + Math.round(defenseBonus);

  // Clamp defense roll into a band around offense (prevents lucky-roll shutdowns
  // on obvious mismatches AND prevents trivially easy makes).
  const minDef = Math.round(offenseRoll * RUNS_DEFENSE_MIN_RATIO);
  const maxDef = Math.round(offenseRoll * RUNS_DEFENSE_MAX_RATIO);
  defenseRoll = Math.min(Math.max(defenseRoll, minDef), maxDef);

  const made = offenseRoll > defenseRoll;
  const points = made ? getPointMultiplier(offenseStat) : 0;

  return {
    offenseRoll,
    defenseRoll,
    made,
    points,
    offenseDice: offDice,
    defenseDice: defDice,
    offenseModifier: offMod,
    defenseModifier: defMod,
    offenseStat,
    defenseStat,
  };
}

/** Resolve a stat roll using the Runs 0–120 numerical scale */
export function resolveRunStatRoll(
  stat: StatKey,
  statValue: number,
  runRating: number,
  dice: number[],
): StatRollResult {
  const diceCount = dice.length;
  const diceTotal = dice.reduce((a, b) => a + b, 0);
  const isDoubles = diceCount === 2 && dice[0] === dice[1];
  const baseModifier = getRunModifier(runRating);
  // 120-rated doubles = 3.5x modifier bonus
  const modifier = (runRating >= 120 && isDoubles) ? 3.5 : baseModifier;
  const rollResult = Math.round(diceTotal * modifier);
  const pointMultiplier = getPointMultiplier(stat);
  const points = rollResult * pointMultiplier;
  const stars = runRatingToStars(runRating);

  return {
    stat, statValue, stars, diceCount, dice, diceTotal,
    isDoubles, modifier, rollResult, pointMultiplier, points, matchBonus: false,
  };
}

/** Point multiplier per stat type (like real basketball) */
export function getPointMultiplier(stat: StatKey): number {
  if (stat === "stat_3pt") return 3;
  if (stat === "stat_mid" || stat === "stat_fin" || stat === "stat_dnk") return 2;
  if (stat === "stat_int") return 1;
  return 0; // AST, STL, REB, BLK — tracked, no points
}

export interface DiceResult {
  dice: number[];
  diceTotal: number;
  isDoubles: boolean;
}

/** Roll dice (auto mode) — supports 1-6 dice */
export function rollDice(count: number): DiceResult {
  const dice = Array.from({ length: count }, () => Math.floor(Math.random() * 6) + 1);
  const isDoubles = count === 2 && dice[0] === dice[1];
  return { dice, diceTotal: dice.reduce((a, b) => a + b, 0), isDoubles };
}

export interface StatRollResult {
  stat: StatKey;
  statValue: number;       // card's base stat value (for display)
  stars: number;
  diceCount: number;
  dice: number[];
  diceTotal: number;
  isDoubles: boolean;
  modifier: number;         // stat modifier used
  rollResult: number;       // diceTotal * modifier (×2 on matching dice for 5+ stars)
  pointMultiplier: number;  // 3, 2, 1, or 0
  points: number;           // rollResult * pointMultiplier
  matchBonus: boolean;      // whether matching dice bonus was applied
}

/**
 * Get difficulty modifier for a player based on their star rating vs game difficulty.
 * Returns a multiplier (e.g. 1.2 = +20% boost, 0.8 = -20% penalty).
 * ±10% per star of difference. Applied to USER cards (compares user star vs difficulty).
 */
export function getDifficultyModifier(playerStars: number, difficultyStars: number): number {
  const diff = playerStars - difficultyStars;
  return 1 + diff * 0.1;
}

/**
 * Get CPU difficulty modifier — opponents get STRONGER as difficulty rises.
 * Difficulty stars represent the opponent's effective level. Each star above 1 adds +10%.
 * E.g. 2★ difficulty → CPU rolls ×1.1, 5★ difficulty → CPU rolls ×1.4.
 */
export function getCpuDifficultyModifier(difficultyStars: number): number {
  return 1 + Math.max(0, difficultyStars - 1) * 0.1;
}

/** Calculate a single stat roll result given dice values (tabletop rules) */
export function resolveStatRoll(
  stat: StatKey,
  statValue: number,
  stars: number,
  dice: number[],
  difficultyStars?: number,
  cpuDifficultyBoost?: number,
): StatRollResult {
  const diceCount = dice.length;
  const diceTotal = dice.reduce((a, b) => a + b, 0);
  const isDoubles = diceCount === 2 && dice[0] === dice[1];
  
  // Tabletop modifier from the individual stat value
  const modifier = getStatModifier(statValue);
  let rollResult = Math.round(diceTotal * modifier);
  
  // Matching dice bonus: ×2 for 5+ star stats
  const matchBonus = hasMatchBonus(statValue, dice);
  if (matchBonus) {
    rollResult *= 2;
  }

  // Apply difficulty scaling (user cards only — caller decides when to pass difficultyStars)
  if (difficultyStars != null) {
    const diffMod = getDifficultyModifier(stars, difficultyStars);
    rollResult = Math.max(0, Math.round(rollResult * diffMod));
  }

  // Apply CPU-side difficulty boost (passed only for CPU cards)
  if (cpuDifficultyBoost != null && cpuDifficultyBoost !== 1) {
    rollResult = Math.max(0, Math.round(rollResult * cpuDifficultyBoost));
  }

  const pointMultiplier = getPointMultiplier(stat);
  const points = rollResult * pointMultiplier;

  return {
    stat, statValue, stars, diceCount, dice, diceTotal,
    isDoubles, modifier, rollResult, pointMultiplier, points, matchBonus,
  };
}

export interface CardGameResult {
  playerCardId: string;
  cardName: string;
  side: "user" | "cpu";
  statResults: StatRollResult[];
  totalPoints: number;
  // Per-stat roll results for DB storage
  statValues: Record<StatKey, number>;
}

/** Compute full card result from all 9 stat rolls */
export function buildCardResult(
  cardId: string,
  cardName: string,
  side: "user" | "cpu",
  statResults: StatRollResult[],
): CardGameResult {
  const totalPoints = statResults.reduce((sum, r) => sum + r.points, 0);
  const statValues = {} as Record<StatKey, number>;
  for (const r of statResults) {
    statValues[r.stat] = r.rollResult;
  }
  return { playerCardId: cardId, cardName, side, statResults, totalPoints, statValues };
}
