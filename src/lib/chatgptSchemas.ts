/**
 * ChatGPT round-trip schemas + prompt builders.
 *
 * One entry per admin entity. Each entry knows how to:
 *   - build a ChatGPT prompt the user can copy/paste
 *   - validate a JSON blob the user pastes back
 *   - describe each row in the preview table
 *   - commit the validated rows to Supabase (create-new only)
 *
 * All importers are create-new only. They flag any name collision with an
 * existing row and let the user opt-in per row before commit.
 */
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";

export interface ImportContext {
  archetypes: string[];
  badges: { id: string; name: string }[];
  traits: { id: string; name: string }[];
  gemTiers: { id: string; name: string }[];
  locationAccounts: { id: string; name: string; handle: string; personality: string }[];
  existingPlayerNames: string[];
  existingLockerCodes: string[];
  existingTeamNames: string[];
  rules: Record<string, unknown>;
}

export async function loadImportContext(): Promise<ImportContext> {
  const [archResp, badges, traits, gems, locs, players, codes, teams, rules] = await Promise.all([
    Promise.resolve({ data: [] as { name: string }[] }), // archetypes are static (see ARCHETYPES in archetypeEngine)
    supabase.from("badges").select("id,name").order("name"),
    supabase.from("signature_traits").select("id,name").order("name"),
    supabase.from("gem_tiers").select("id,name").order("sort_order"),
    supabase.from("location_accounts").select("id,name,handle,personality").eq("is_active", true),
    supabase.from("player_cards").select("name"),
    supabase.from("locker_codes").select("code"),
    supabase.from("teams").select("name"),
    supabase.from("rule_config").select("key,value"),
  ]);

  const ARCHETYPES = [
    "sharpshooter", "slasher", "playmaker", "lockdown defender", "paint beast",
    "stretch big", "rim protector", "two-way", "inside-out", "post scorer",
    "combo guard", "floor general", "point forward", "glass cleaner", "speedster",
    "showtime", "streetballer", "ankle breaker", "sniper elite", "microwave",
    "clutch scorer", "finesse scorer", "hustle player", "enforcer", "brick wall",
    "tower", "gauntlet boss",
  ];

  const rulesMap: Record<string, unknown> = {};
  (rules.data ?? []).forEach((r: any) => { rulesMap[r.key] = r.value; });

  return {
    archetypes: ARCHETYPES,
    badges: badges.data ?? [],
    traits: traits.data ?? [],
    gemTiers: gems.data ?? [],
    locationAccounts: locs.data ?? [],
    existingPlayerNames: (players.data ?? []).map((p: any) => p.name.toLowerCase()),
    existingLockerCodes: (codes.data ?? []).map((c: any) => c.code.toUpperCase()),
    existingTeamNames: (teams.data ?? []).map((t: any) => t.name.toLowerCase()),
    rules: rulesMap,
  };
}

// ── Zod schemas ──────────────────────────────────────

export const PlayerImportSchema = z.array(z.object({
  name: z.string().min(1).max(120),
  archetype: z.string().optional(),
  position1: z.enum(["PG", "SG", "SF", "PF", "C"]).nullable().optional(),
  position2: z.enum(["PG", "SG", "SF", "PF", "C"]).nullable().optional(),
  stars: z.number().int().min(1).max(5).optional(),
  gem_tier: z.string().nullable().optional(),
  social_handle: z.string().nullable().optional(),
  stat_3pt: z.number().int().min(0).max(99).optional(),
  stat_mid: z.number().int().min(0).max(99).optional(),
  stat_fin: z.number().int().min(0).max(99).optional(),
  stat_dnk: z.number().int().min(0).max(99).optional(),
  stat_ast: z.number().int().min(0).max(99).optional(),
  stat_stl: z.number().int().min(0).max(99).optional(),
  stat_reb: z.number().int().min(0).max(99).optional(),
  stat_blk: z.number().int().min(0).max(99).optional(),
  stat_int: z.number().int().min(0).max(99).optional(),
}));

export const LockerCodeImportSchema = z.array(z.object({
  code: z.string().min(3).max(40).transform((s) => s.toUpperCase()),
  reward_type: z.enum(["coins", "gems", "pack", "card"]).default("coins"),
  reward_value: z.record(z.unknown()).default({}),
  max_redemptions: z.number().int().positive().nullable().optional(),
  expires_at: z.string().nullable().optional(),
  description: z.string().optional(),
}));

export const SocialPostImportSchema = z.array(z.object({
  content: z.string().min(1).max(600),
  post_type: z.enum(["tweet", "story", "highlight", "headline"]).default("tweet"),
  event_type: z.string().nullable().optional(),
  location_handle: z.string().nullable().optional(),
  player_name: z.string().nullable().optional(),
  image_url: z.string().url().nullable().optional(),
  scheduled_at: z.string().nullable().optional(),
  is_headline: z.boolean().optional(),
  headline_rank: z.number().int().min(1).max(4).nullable().optional(),
  headline_image_url: z.string().url().nullable().optional(),
}));

export const StorylineBundleSchema = z.object({
  storyline: z.object({
    title: z.string().min(1).max(160),
    summary: z.string().optional(),
    arc_image_url: z.string().url().nullable().optional(),
    status: z.enum(["draft", "active", "archived"]).default("draft"),
    starts_at: z.string().nullable().optional(),
    ends_at: z.string().nullable().optional(),
  }),
  players: PlayerImportSchema.optional().default([]),
  locker_codes: LockerCodeImportSchema.optional().default([]),
  posts: SocialPostImportSchema.optional().default([]),
});

// ── Prompt builders ──────────────────────────────────

function jsonRules() {
  return `
RESPONSE RULES (strict):
- Output ONLY valid JSON. No prose. No markdown fences. No commentary.
- If asked for a list, return a JSON array at the top level.
- Use null (not "") for unknown optional fields.
- All string values use straight quotes.`;
}

export function buildPlayerPrompt(ctx: ImportContext, brief: string) {
  return `You are generating roster data for an NBA-inspired card game called GTeam Infinite.

TASK: Generate ${brief || "5 to 10 unique player cards"}.

ALLOWED ARCHETYPES (use these slugs exactly, lowercase): ${ctx.archetypes.join(", ")}
ALLOWED GEM TIERS (use the tier name exactly, or null): ${ctx.gemTiers.map(g => g.name).join(", ") || "(none configured)"}
ALLOWED POSITIONS: PG, SG, SF, PF, C
STARS: integer 1-5. Higher = stronger card. Most cards 3-4, gauntlet bosses 5.

JSON SHAPE (array of objects):
[
  {
    "name": "First Last",
    "archetype": "one of the slugs above",
    "position1": "PG",
    "position2": null,
    "stars": 4,
    "gem_tier": null,
    "social_handle": "@firstlast",
    "stat_3pt": 70, "stat_mid": 65, "stat_fin": 78, "stat_dnk": 60,
    "stat_ast": 55, "stat_stl": 50, "stat_reb": 40, "stat_blk": 30, "stat_int": 60
  }
]

Names must be ORIGINAL fictional players (not real NBA stars). Stat lines (0-99) should match the archetype: sharpshooters high 3PT/MID, paint beasts high FIN/DNK/REB/BLK, etc.
${jsonRules()}`;
}

export function buildLockerCodePrompt(ctx: ImportContext, brief: string) {
  return `You are generating LOCKER CODES for a card-collection game.

TASK: Generate ${brief || "5 thematic locker codes for an upcoming event"}.

JSON SHAPE (array):
[
  {
    "code": "ALL-CAPS-HYPHENATED",
    "reward_type": "coins" | "gems" | "pack" | "card",
    "reward_value": { "amount": 5000 }  // for coins/gems; for pack use {"pack_id": "..."}; for card use {"card_name": "..."}
    "max_redemptions": 100,
    "expires_at": "2026-12-31T23:59:59Z",
    "description": "internal note (admin only)"
  }
]

Existing codes (DO NOT REUSE): ${ctx.existingLockerCodes.slice(0, 30).join(", ") || "(none)"}
${jsonRules()}`;
}

export function buildSocialPostPrompt(ctx: ImportContext, brief: string) {
  const locs = ctx.locationAccounts.map(l => `${l.handle} (${l.personality})`).join(", ");
  return `You are a sports media writer staffing the league feed for GTeam Infinite (NBA-style card game).

TASK: Write ${brief || "5 social posts for this week's narrative"}.

ALLOWED LOCATION ACCOUNTS (use handle): ${locs || "(none — leave location_handle null)"}
EVENT TYPES: signing, game_result, appearance, evolution, news, hype, drama, recap

JSON SHAPE (array):
[
  {
    "content": "Punchy tweet/post copy. 1-3 sentences.",
    "post_type": "tweet",
    "event_type": "news",
    "location_handle": "@gteam_league",
    "player_name": null,
    "image_url": null,
    "scheduled_at": null,
    "is_headline": false,
    "headline_rank": null
  }
]

For LEAGUE HEADLINES, set is_headline=true and headline_rank=1 (hero) or 2-4 (secondary). Limit to one rank=1 per batch.
${jsonRules()}`;
}

export function buildStorylinePrompt(ctx: ImportContext, brief: string) {
  return `You are a sports narrative director for GTeam Infinite. Create a complete STORYLINE BUNDLE.

TASK: Build a storyline arc: ${brief || "describe a rookie's rise through the league"}.

Return a SINGLE JSON object combining a storyline + supporting players + locker codes + social posts.

JSON SHAPE:
{
  "storyline": {
    "title": "The Rise of Marcus Vega",
    "summary": "2-3 sentence pitch shown on League Headlines.",
    "arc_image_url": null,
    "status": "active",
    "starts_at": null,
    "ends_at": null
  },
  "players": [ ${"/* objects matching the Player JSON shape */"} ],
  "locker_codes": [ ${"/* objects matching the Locker Code JSON shape */"} ],
  "posts": [ ${"/* objects matching the Social Post JSON shape, ideally referencing player_name */"} ]
}

ALLOWED ARCHETYPES: ${ctx.archetypes.join(", ")}
ALLOWED LOCATION HANDLES: ${ctx.locationAccounts.map(l => l.handle).join(", ") || "(none)"}
GEM TIERS: ${ctx.gemTiers.map(g => g.name).join(", ") || "(none)"}

Make the posts feel like a real beat — opening tease, mid-arc drama, climax, recap. Promote at least one post to is_headline=true (rank 1).
${jsonRules()}`;
}

// ── Commit functions (create-new only) ──────────────

export async function commitPlayers(rows: z.infer<typeof PlayerImportSchema>, ctx: ImportContext) {
  const gemByName = new Map(ctx.gemTiers.map(g => [g.name.toLowerCase(), g.id]));
  const toInsert = rows.map((r) => {
    const stars = r.stars ?? 3;
    const rating = stars * 20 - 10; // crude default; admin can refine in editor
    return {
      name: r.name,
      position1: r.position1 ?? null,
      position2: r.position2 ?? null,
      rating,
      gem_tier_id: r.gem_tier ? gemByName.get(r.gem_tier.toLowerCase()) ?? null : null,
      social_handle: r.social_handle ?? null,
      stat_3pt: r.stat_3pt ?? 50, stat_mid: r.stat_mid ?? 50, stat_fin: r.stat_fin ?? 50,
      stat_dnk: r.stat_dnk ?? 50, stat_ast: r.stat_ast ?? 50, stat_stl: r.stat_stl ?? 50,
      stat_reb: r.stat_reb ?? 50, stat_blk: r.stat_blk ?? 50, stat_int: r.stat_int ?? 50,
    };
  });
  const { error, data } = await supabase.from("player_cards").insert(toInsert).select("id,name");
  if (error) throw error;
  return data ?? [];
}

export async function commitLockerCodes(rows: z.infer<typeof LockerCodeImportSchema>) {
  const toInsert = rows.map((r) => ({
    code: r.code,
    reward_type: r.reward_type,
    reward_value: r.reward_value,
    max_redemptions: r.max_redemptions ?? null,
    expires_at: r.expires_at ?? null,
  }));
  const { error, data } = await supabase.from("locker_codes").insert(toInsert).select("id,code");
  if (error) throw error;
  return data ?? [];
}

export async function commitSocialPosts(rows: z.infer<typeof SocialPostImportSchema>, ctx: ImportContext) {
  // Resolve handles & player names to ids
  const handleToId = new Map(ctx.locationAccounts.map(l => [l.handle.toLowerCase(), l.id]));
  const playerNames = new Set<string>();
  rows.forEach(r => { if (r.player_name) playerNames.add(r.player_name); });
  let playerMap = new Map<string, string>();
  if (playerNames.size) {
    const { data } = await supabase.from("player_cards").select("id,name").in("name", [...playerNames]);
    (data ?? []).forEach((p: any) => playerMap.set(p.name.toLowerCase(), p.id));
  }

  const toInsert = rows.map((r) => ({
    content: r.content,
    post_type: r.post_type,
    event_type: r.event_type ?? null,
    location_account_id: r.location_handle ? handleToId.get(r.location_handle.toLowerCase()) ?? null : null,
    player_card_id: r.player_name ? playerMap.get(r.player_name.toLowerCase()) ?? null : null,
    image_url: r.image_url ?? null,
    scheduled_at: r.scheduled_at ?? null,
    is_published: !r.scheduled_at,
    is_headline: r.is_headline ?? false,
    headline_rank: r.headline_rank ?? null,
    headline_image_url: r.headline_image_url ?? null,
  }));

  const { error, data } = await supabase.from("social_posts").insert(toInsert).select("id");
  if (error) throw error;
  return data ?? [];
}

// ── Collision detection ─────────────────────────────

export function flagCollision(value: string, existing: string[]) {
  return existing.includes(value.toLowerCase()) || existing.includes(value.toUpperCase());
}
