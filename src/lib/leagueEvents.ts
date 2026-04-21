import { supabase } from "@/integrations/supabase/client";

export type LeagueEventType =
  | "game_result"
  | "appearance"
  | "evolution"
  | "streak"
  | "signing";

export interface LeagueEventPayload {
  event_type: LeagueEventType;
  // Routing
  road_name?: string | null;
  run_id?: string | null;
  // Display fields
  user_display?: string | null;
  opponent?: string | null;
  user_score?: number | null;
  cpu_score?: number | null;
  won?: boolean | null;
  top_scorer_name?: string | null;
  top_scorer_pts?: number | null;
  notable?: string[];
  player_card_id?: string | null;
  player_name?: string | null;
  gem_tier_name?: string | null;
  streak?: number | null;
  from_tier?: string | null;
  to_tier?: string | null;
}

/**
 * Fire-and-forget client wrapper. The server decides whether to actually
 * post anything based on rule_config. Failures are swallowed so this never
 * blocks gameplay.
 */
export async function postLeagueEvent(payload: LeagueEventPayload) {
  try {
    const { error } = await supabase.functions.invoke("post-league-event", { body: payload });
    if (error) console.warn("[postLeagueEvent] non-fatal error", error.message);
  } catch (e) {
    console.warn("[postLeagueEvent] swallow", (e as Error).message);
  }
}

/** Compute a notable-performance string list from the configured thresholds. */
export interface CardLine {
  name: string;
  pts: number;
  ast: number;
  reb: number;
  stl: number;
  blk: number;
}

export interface NotableThresholds {
  points?: number;
  assists?: number;
  rebounds?: number;
  stocks?: number;
  double_double?: boolean;
}

export function computeNotable(cards: CardLine[], t: NotableThresholds | null | undefined): string[] {
  if (!t) return [];
  const out: string[] = [];
  for (const c of cards) {
    const stocks = (c.stl ?? 0) + (c.blk ?? 0);
    if (t.points && c.pts >= t.points) out.push(`${c.name} dropped ${c.pts}`);
    else if (t.assists && c.ast >= t.assists) out.push(`${c.name} dished ${c.ast} dimes`);
    else if (t.rebounds && c.reb >= t.rebounds) out.push(`${c.name} grabbed ${c.reb} boards`);
    else if (t.stocks && stocks >= t.stocks) out.push(`${c.name} ate on D (${stocks} stocks)`);
    else if (t.double_double) {
      const cats = [c.pts >= 10, c.ast >= 10, c.reb >= 10, stocks >= 10].filter(Boolean).length;
      if (cats >= 2) out.push(`${c.name} stuffed the sheet`);
    }
  }
  return out.slice(0, 3);
}

/** Pick the highest-points card. */
export function pickTopScorer(cards: CardLine[]): CardLine | null {
  if (!cards.length) return null;
  return [...cards].sort((a, b) => (b.pts ?? 0) - (a.pts ?? 0))[0];
}
