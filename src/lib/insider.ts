import { supabase } from "@/integrations/supabase/client";

/**
 * Client wrapper for the player-facing GTeam Insider API.
 * The same endpoints the GTeam Insider Custom GPT calls, so in-game lineups and
 * GPT-created lineups are always the identical records.
 */
const BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/insider/v1`;

export interface InsiderCard {
  owned_card_id: string;
  player_card_id: string;
  playable_version_id: string | null;
  playable_form: string;
  name: string;
  gem_tier: string | null;
  position1: string | null;
  position2: string | null;
  rating: number | null;
  run_rating: number | null;
  attributes: Record<string, number>;
  run_attributes: Record<string, number>;
  badges: Array<{ name: string; abbreviation: string; tier: string }>;
  traits: Array<{ name: string; abbreviation: string; tier: string }>;
  evo?: Record<string, unknown>;
}

export interface InsiderLineup {
  lineup_id: string;
  name: string;
  mode: string;
  is_default: boolean;
  notes: string | null;
  slot_count: number;
  slots_required: number;
  slots: Array<{
    slot: number;
    owned_card_id: string | null;
    player_card_id: string;
    evo_card_version_id: string | null;
    name?: string;
    gem_tier?: string | null;
    rating?: number | null;
    run_rating?: number | null;
    owned?: boolean;
  }>;
  updated_at?: string;
}

export interface InsiderLegality {
  legal: boolean;
  mode: string;
  slots_required: number;
  cards_provided: number;
  reasons: Array<{ code: string; message: string }>;
  invalid_cards: Array<Record<string, unknown>>;
  summary?: Record<string, unknown>;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in to manage lineups.");
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message ?? `Request failed (${res.status})`);
  return json as T;
}

export const insider = {
  collection: (params: Record<string, string | number | boolean | undefined> = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v));
    return call<{ cards: InsiderCard[]; total: number }>(`/collection?${qs.toString()}`);
  },
  lineups: (mode?: string) =>
    call<{ lineups: InsiderLineup[] }>(`/lineups${mode ? `?mode=${mode}` : ""}`),
  lineup: (lineupId: string) =>
    call<{ lineup: InsiderLineup; legality: InsiderLegality }>(`/lineups/get?lineup_id=${lineupId}`),
  createLineup: (payload: {
    name: string;
    mode: string;
    notes?: string;
    slots: Array<{ slot: number; owned_card_id: string }>;
  }) => call<{ lineup: InsiderLineup; legality: InsiderLegality }>(`/lineups`, { method: "POST", body: JSON.stringify(payload) }),
  updateLineup: (payload: {
    lineup_id: string;
    name?: string;
    notes?: string;
    slots?: Array<{ slot: number; owned_card_id: string }>;
  }) => call<{ lineup: InsiderLineup; legality: InsiderLegality }>(`/lineups/update`, { method: "POST", body: JSON.stringify(payload) }),
  duplicateLineup: (lineup_id: string, name?: string) =>
    call<{ lineup: InsiderLineup }>(`/lineups/duplicate`, { method: "POST", body: JSON.stringify({ lineup_id, name }) }),
  deleteLineup: (lineup_id: string) =>
    call<{ deleted: boolean }>(`/lineups/delete`, { method: "POST", body: JSON.stringify({ lineup_id }) }),
  setDefaultLineup: (lineup_id: string) =>
    call<{ lineup_id: string }>(`/lineups/set-default`, { method: "POST", body: JSON.stringify({ lineup_id }) }),
  validateLineup: (payload: {
    lineup_id?: string;
    cards?: Array<{ slot: number; owned_card_id: string }>;
    mode?: string;
  }) => call<InsiderLegality>(`/lineups/validate`, { method: "POST", body: JSON.stringify(payload) }),
  capabilities: () => call<Record<string, unknown>>(`/capabilities`),
  references: () =>
    call<{
      gem_tiers: Array<{ gem_tier_id: string; name: string; stars: number }>;
      positions: string[];
      badges: Array<{ badge_id: string; name: string; abbreviation: string }>;
      traits: Array<{ trait_id: string; name: string; abbreviation: string }>;
      collections: Array<{ collection_id: string; name: string }>;
    }>(`/references`),
  challenges: () =>
    call<{ challenges: Array<Record<string, unknown>> }>(`/challenges`),
  eligibleCards: (params: { challenge_id?: string; domination_game_id?: string; run_id?: string; mode?: string }) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) qs.set(k, String(v));
    qs.set("limit", "200");
    return call<{
      eligible: InsiderCard[];
      eligible_count: number;
      slots_required: number;
      sufficient: boolean;
      context: Record<string, unknown>;
    }>(`/eligible-cards?${qs.toString()}`);
  },
};
