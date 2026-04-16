const STAT_KEYS = [
  "stat_3pt", "stat_mid", "stat_fin", "stat_dnk",
  "stat_stl", "stat_blk", "stat_ast", "stat_reb", "stat_int",
] as const;

/** Compute decimal OVR from 9 stats, e.g. "2.4" */
export function computeOVR(card: Record<string, any>): string {
  const avg = STAT_KEYS.reduce((s, k) => s + (Number(card[k]) || 0), 0) / STAT_KEYS.length;
  return avg.toFixed(1);
}

/** Floor-based star count: 1.8 → 1 star, 3.2 → 3 stars */
export function computeStars(card: Record<string, any>): number {
  const avg = STAT_KEYS.reduce((s, k) => s + (Number(card[k]) || 0), 0) / STAT_KEYS.length;
  return Math.floor(avg);
}
