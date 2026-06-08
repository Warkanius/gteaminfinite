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
  existingRunNames: string[];
  existingChallengeNames: string[];
  existingGemTaskTitles: string[];
  existingDuoNames: string[];
  rules: Record<string, unknown>;
}

export async function loadImportContext(): Promise<ImportContext> {
  const [badges, traits, gems, locs, players, codes, teams, runs, challenges, gemTasks, duos, rules] = await Promise.all([
    supabase.from("badges").select("id,name").order("name"),
    supabase.from("signature_traits").select("id,name").order("name"),
    supabase.from("gem_tiers").select("id,name").order("sort_order"),
    supabase.from("location_accounts").select("id,name,handle,personality").eq("is_active", true),
    supabase.from("player_cards").select("name"),
    supabase.from("locker_codes").select("code"),
    supabase.from("teams").select("name"),
    supabase.from("runs").select("name"),
    supabase.from("challenges").select("name"),
    supabase.from("gem_tasks").select("title"),
    supabase.from("dynamic_duos").select("name"),
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

  const lower = (rows: any[] | null, key: string) => (rows ?? []).map((r: any) => String(r[key]).toLowerCase());

  return {
    archetypes: ARCHETYPES,
    badges: badges.data ?? [],
    traits: traits.data ?? [],
    gemTiers: gems.data ?? [],
    locationAccounts: locs.data ?? [],
    existingPlayerNames: lower(players.data, "name"),
    existingLockerCodes: (codes.data ?? []).map((c: any) => c.code.toUpperCase()),
    existingTeamNames: lower(teams.data, "name"),
    existingRunNames: lower(runs.data, "name"),
    existingChallengeNames: lower(challenges.data, "name"),
    existingGemTaskTitles: lower(gemTasks.data, "title"),
    existingDuoNames: lower(duos.data, "name"),
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

// Teams (with optional roster of player names)
export const TeamImportSchema = z.array(z.object({
  name: z.string().min(1).max(120),
  category: z.enum(["domination", "gauntlet", "custom"]).default("domination"),
  unlock_cost: z.number().int().min(0).default(0),
  roster: z.array(z.string()).max(8).optional().default([]),
}));

// Runs (3v3 rosters)
export const RunImportSchema = z.array(z.object({
  name: z.string().min(1).max(120),
  target_score: z.number().int().min(7).max(99).default(21),
  milestones: z.array(z.object({
    score: z.number().int().min(1),
    reward_type: z.enum(["coins", "gems", "pack", "card"]),
    reward_value: z.record(z.unknown()).default({}),
  })).optional().default([]),
  roster: z.array(z.string()).max(5).optional().default([]),
}));

// Challenges
export const ChallengeImportSchema = z.array(z.object({
  name: z.string().min(1).max(160),
  description: z.string().optional(),
  challenge_type: z.enum(["single", "spotlight"]).default("single"),
  win_condition: z.enum(["win", "win_by", "series"]).default("win"),
  win_by_amount: z.number().int().nullable().optional(),
  series_length: z.number().int().nullable().optional(),
  coin_reward: z.number().int().min(0).default(0),
  gem_reward: z.number().int().min(0).default(0),
  spotlight_group: z.string().nullable().optional(),
  sort_order: z.number().int().default(0),
  opponent_team_name: z.string().nullable().optional(),
  is_repeatable: z.boolean().default(true),
}));

// Gem Tasks
export const GemTaskImportSchema = z.array(z.object({
  title: z.string().min(1).max(200),
  description: z.string().nullable().optional(),
  gem_reward: z.number().int().min(1).max(500).default(5),
  cooldown_hours: z.number().int().min(1).max(720).default(24),
  category: z.enum(["daily", "weekly", "fitness", "academic", "creative"]).default("daily"),
  is_active: z.boolean().default(true),
}));

// Dynamic Duos
const DuoBoostShape = z.object({
  stat_3pt: z.number().int().optional(), stat_mid: z.number().int().optional(),
  stat_fin: z.number().int().optional(), stat_dnk: z.number().int().optional(),
  stat_ast: z.number().int().optional(), stat_stl: z.number().int().optional(),
  stat_reb: z.number().int().optional(), stat_blk: z.number().int().optional(),
  stat_int: z.number().int().optional(),
}).partial();

export const DynamicDuoImportSchema = z.array(z.object({
  name: z.string().min(1).max(120),
  description: z.string().nullable().optional(),
  player_a_name: z.string().min(1),
  player_b_name: z.string().min(1),
  boosts_a: DuoBoostShape.default({}),
  boosts_b: DuoBoostShape.default({}),
  is_active: z.boolean().default(true),
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
    reward_value: r.reward_value as any,
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

// ── Additional prompt builders ──────────────────────

export function buildTeamPrompt(ctx: ImportContext, brief: string) {
  return `Generate TEAMS for GTeam Infinite (NBA-style card game).
TASK: ${brief || "3 themed teams with 5-player rosters each"}.

JSON SHAPE (array):
[
  {
    "name": "Cosmic Renegades",
    "category": "domination" | "gauntlet" | "custom",
    "unlock_cost": 0,
    "roster": ["Player Name 1", "Player Name 2", "..."]  // names of EXISTING player_cards. Omit/empty if rosters added later.
  }
]

Existing teams (DO NOT REUSE): ${ctx.existingTeamNames.slice(0, 30).join(", ") || "(none)"}
Existing players you can reference: ${ctx.existingPlayerNames.slice(0, 60).join(", ") || "(none)"}
${jsonRules()}`;
}

export function buildRunPrompt(ctx: ImportContext, brief: string) {
  return `Generate 3v3 RUNS for GTeam Infinite.
TASK: ${brief || "2 themed run ladders with milestone rewards"}.

JSON SHAPE (array):
[
  {
    "name": "Downtown Hustle",
    "target_score": 21,
    "milestones": [
      { "score": 7, "reward_type": "coins", "reward_value": { "amount": 250 } },
      { "score": 14, "reward_type": "gems", "reward_value": { "amount": 10 } },
      { "score": 21, "reward_type": "pack", "reward_value": { "pack_name": "Bronze Pack" } }
    ],
    "roster": ["NPC opponent name 1", "NPC opponent name 2", "NPC opponent name 3"]
  }
]
${jsonRules()}`;
}

export function buildChallengePrompt(ctx: ImportContext, brief: string) {
  return `Generate CHALLENGES for GTeam Infinite.
TASK: ${brief || "5 single challenges + 1 spotlight series"}.

JSON SHAPE (array):
[
  {
    "name": "Beat the Cosmic Renegades",
    "description": "Take down the league's hottest squad.",
    "challenge_type": "single" | "spotlight",
    "win_condition": "win" | "win_by" | "series",
    "win_by_amount": null,
    "series_length": null,
    "coin_reward": 500,
    "gem_reward": 10,
    "spotlight_group": null,
    "sort_order": 0,
    "opponent_team_name": "Cosmic Renegades",  // name of an existing team OR null
    "is_repeatable": true
  }
]

Existing teams: ${ctx.existingTeamNames.slice(0, 30).join(", ") || "(none)"}
${jsonRules()}`;
}

export function buildGemTaskPrompt(_ctx: ImportContext, brief: string) {
  return `Generate REAL-LIFE GEM TASKS for a kids' card game (gems earned by completing real-world tasks).
TASK: ${brief || "8 healthy daily/weekly tasks"}.

JSON SHAPE (array):
[
  {
    "title": "Read for 20 minutes",
    "description": "Any book counts.",
    "gem_reward": 5,
    "cooldown_hours": 24,
    "category": "daily" | "weekly" | "fitness" | "academic" | "creative",
    "is_active": true
  }
]
${jsonRules()}`;
}

export function buildDynamicDuoPrompt(ctx: ImportContext, brief: string) {
  return `Generate DYNAMIC DUOS (player chemistry pairings) for GTeam Infinite.
TASK: ${brief || "5 duo pairings that grant stat boosts when both cards are in a lineup"}.

JSON SHAPE (array):
[
  {
    "name": "Twin Towers",
    "description": "Two paint beasts who dominate the glass together.",
    "player_a_name": "Marcus Vega",
    "player_b_name": "Tyrone Wallace",
    "boosts_a": { "stat_reb": 5, "stat_blk": 3 },
    "boosts_b": { "stat_reb": 5, "stat_blk": 3 },
    "is_active": true
  }
]

Existing players to pair from: ${ctx.existingPlayerNames.slice(0, 60).join(", ") || "(none)"}
Stat keys: stat_3pt, stat_mid, stat_fin, stat_dnk, stat_ast, stat_stl, stat_reb, stat_blk, stat_int (integers, typically +1 to +8).
${jsonRules()}`;
}

// ── Additional commit functions ─────────────────────

async function resolvePlayerIds(names: string[]) {
  if (!names.length) return new Map<string, string>();
  const { data } = await supabase.from("player_cards").select("id,name").in("name", names);
  const map = new Map<string, string>();
  (data ?? []).forEach((p: any) => map.set(p.name.toLowerCase(), p.id));
  return map;
}

export async function commitTeams(rows: z.infer<typeof TeamImportSchema>) {
  const { data: teams, error } = await supabase.from("teams").insert(
    rows.map(r => ({ name: r.name, category: r.category, unlock_cost: r.unlock_cost }))
  ).select("id,name");
  if (error) throw error;

  // Attach rosters where possible
  const allNames = [...new Set(rows.flatMap(r => r.roster ?? []))];
  const playerMap = await resolvePlayerIds(allNames);
  const teamPlayerRows: any[] = [];
  rows.forEach((r, idx) => {
    const team = teams?.[idx];
    if (!team) return;
    (r.roster ?? []).forEach((pname, slot) => {
      const pid = playerMap.get(pname.toLowerCase());
      if (pid) teamPlayerRows.push({ team_id: team.id, player_card_id: pid, slot: slot + 1 });
    });
  });
  if (teamPlayerRows.length) await supabase.from("team_players").insert(teamPlayerRows);
  return teams ?? [];
}

export async function commitRuns(rows: z.infer<typeof RunImportSchema>) {
  const { data: runs, error } = await supabase.from("runs").insert(
    rows.map(r => ({ name: r.name, target_score: r.target_score, milestones: r.milestones as any }))
  ).select("id,name");
  if (error) throw error;

  const allNames = [...new Set(rows.flatMap(r => r.roster ?? []))];
  const playerMap = await resolvePlayerIds(allNames);
  const runPlayerRows: any[] = [];
  rows.forEach((r, idx) => {
    const run = runs?.[idx];
    if (!run) return;
    (r.roster ?? []).forEach((pname, slot) => {
      const pid = playerMap.get(pname.toLowerCase());
      if (pid) runPlayerRows.push({ run_id: run.id, player_card_id: pid, slot: slot + 1 });
    });
  });
  if (runPlayerRows.length) await supabase.from("run_players").insert(runPlayerRows);
  return runs ?? [];
}

export async function commitChallenges(rows: z.infer<typeof ChallengeImportSchema>) {
  const teamNames = [...new Set(rows.map(r => r.opponent_team_name).filter(Boolean) as string[])];
  let teamMap = new Map<string, string>();
  if (teamNames.length) {
    const { data } = await supabase.from("teams").select("id,name").in("name", teamNames);
    (data ?? []).forEach((t: any) => teamMap.set(t.name.toLowerCase(), t.id));
  }
  const toInsert = rows.map(r => ({
    name: r.name,
    description: r.description ?? null,
    challenge_type: r.challenge_type,
    win_condition: r.win_condition,
    win_by_amount: r.win_by_amount ?? null,
    series_length: r.series_length ?? null,
    coin_reward: r.coin_reward,
    gem_reward: r.gem_reward,
    spotlight_group: r.spotlight_group ?? null,
    sort_order: r.sort_order,
    is_repeatable: r.is_repeatable,
    opponent_team_id: r.opponent_team_name ? teamMap.get(r.opponent_team_name.toLowerCase()) ?? null : null,
  }));
  const { error, data } = await supabase.from("challenges").insert(toInsert).select("id,name");
  if (error) throw error;
  return data ?? [];
}

export async function commitGemTasks(rows: z.infer<typeof GemTaskImportSchema>) {
  const { error, data } = await supabase.from("gem_tasks").insert(
    rows.map(r => ({
      title: r.title, description: r.description ?? null,
      gem_reward: r.gem_reward, cooldown_hours: r.cooldown_hours,
      category: r.category, is_active: r.is_active,
    }))
  ).select("id,title");
  if (error) throw error;
  return data ?? [];
}

export async function commitDynamicDuos(rows: z.infer<typeof DynamicDuoImportSchema>) {
  const names = [...new Set(rows.flatMap(r => [r.player_a_name, r.player_b_name]))];
  const playerMap = await resolvePlayerIds(names);
  const toInsert: any[] = [];
  const skipped: string[] = [];
  rows.forEach(r => {
    const a = playerMap.get(r.player_a_name.toLowerCase());
    const b = playerMap.get(r.player_b_name.toLowerCase());
    if (!a || !b || a === b) { skipped.push(r.name); return; }
    toInsert.push({
      name: r.name, description: r.description ?? null,
      player_card_id_a: a, player_card_id_b: b,
      boosts_a: r.boosts_a, boosts_b: r.boosts_b,
      is_active: r.is_active,
    });
  });
  if (!toInsert.length) throw new Error(`No duos created — player names did not resolve. Skipped: ${skipped.join(", ")}`);
  const { error, data } = await supabase.from("dynamic_duos").insert(toInsert).select("id,name");
  if (error) throw error;
  return data ?? [];
}

// ═══════════════════════════════════════════════════════════════════
// UPDATE MODE — edit existing rows by natural key (name / code)
// Only fields ChatGPT returns are written; others are left untouched.
// ═══════════════════════════════════════════════════════════════════

const StatPatch = {
  stat_3pt: z.number().int().min(0).max(99).optional(),
  stat_mid: z.number().int().min(0).max(99).optional(),
  stat_fin: z.number().int().min(0).max(99).optional(),
  stat_dnk: z.number().int().min(0).max(99).optional(),
  stat_ast: z.number().int().min(0).max(99).optional(),
  stat_stl: z.number().int().min(0).max(99).optional(),
  stat_reb: z.number().int().min(0).max(99).optional(),
  stat_blk: z.number().int().min(0).max(99).optional(),
  stat_int: z.number().int().min(0).max(99).optional(),
};

export const PlayerUpdateSchema = z.array(z.object({
  name: z.string().min(1),
  rating: z.number().int().min(0).max(99).optional(),
  position1: z.enum(["PG", "SG", "SF", "PF", "C"]).nullable().optional(),
  position2: z.enum(["PG", "SG", "SF", "PF", "C"]).nullable().optional(),
  social_handle: z.string().nullable().optional(),
  gem_tier: z.string().nullable().optional(),
  ...StatPatch,
}));

export const TeamUpdateSchema = z.array(z.object({
  name: z.string().min(1),
  category: z.enum(["domination", "gauntlet", "custom"]).optional(),
  unlock_cost: z.number().int().min(0).optional(),
}));

export const RunUpdateSchema = z.array(z.object({
  name: z.string().min(1),
  target_score: z.number().int().min(7).max(99).optional(),
  milestones: z.array(z.object({
    score: z.number().int().min(1),
    reward_type: z.enum(["coins", "gems", "pack", "card"]),
    reward_value: z.record(z.unknown()).default({}),
  })).optional(),
}));

export const ChallengeUpdateSchema = z.array(z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  coin_reward: z.number().int().min(0).optional(),
  gem_reward: z.number().int().min(0).optional(),
  win_condition: z.enum(["win", "win_by", "series"]).optional(),
  win_by_amount: z.number().int().nullable().optional(),
  series_length: z.number().int().nullable().optional(),
  is_repeatable: z.boolean().optional(),
}));

export const GemTaskUpdateSchema = z.array(z.object({
  title: z.string().min(1),
  description: z.string().nullable().optional(),
  gem_reward: z.number().int().min(1).max(500).optional(),
  cooldown_hours: z.number().int().min(1).max(720).optional(),
  category: z.enum(["daily", "weekly", "fitness", "academic", "creative"]).optional(),
  is_active: z.boolean().optional(),
}));

export const DynamicDuoUpdateSchema = z.array(z.object({
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  boosts_a: z.object(StatPatch).partial().optional(),
  boosts_b: z.object(StatPatch).partial().optional(),
  is_active: z.boolean().optional(),
}));

export const LockerCodeUpdateSchema = z.array(z.object({
  code: z.string().min(3).transform((s) => s.toUpperCase()),
  reward_type: z.enum(["coins", "gems", "pack", "card"]).optional(),
  reward_value: z.record(z.unknown()).optional(),
  max_redemptions: z.number().int().positive().nullable().optional(),
  expires_at: z.string().nullable().optional(),
}));

// ── Update prompt builders ──────────────────────

function updateRules(naturalKey: string) {
  return `
UPDATE RULES (strict):
- Match rows by "${naturalKey}" (case-insensitive). Use the EXACT existing name/code.
- Include ONLY the fields you want to change. Omit anything that should stay the same.
- Output a JSON array. No prose, no markdown fences.
- Do NOT invent new rows here — this is an UPDATE batch. Names that don't match existing rows will be skipped.`;
}

export function buildPlayerUpdatePrompt(ctx: ImportContext, brief: string) {
  return `You are EDITING existing player cards in GTeam Infinite.

TASK: ${brief || "rebalance these players' ratings and stats"}.

Existing players (use the exact name):
${ctx.existingPlayerNames.slice(0, 120).join(", ")}

JSON SHAPE (array, partial fields):
[
  { "name": "Existing Player Name", "rating": 88, "stat_3pt": 92, "stat_ast": 70 }
]

Stat keys: stat_3pt, stat_mid, stat_fin, stat_dnk, stat_ast, stat_stl, stat_reb, stat_blk, stat_int (0-99).
Positions: PG, SG, SF, PF, C.
${updateRules("name")}`;
}

export function buildTeamUpdatePrompt(ctx: ImportContext, brief: string) {
  return `You are EDITING existing teams in GTeam Infinite.
TASK: ${brief || "adjust unlock costs and categories"}.

Existing teams: ${ctx.existingTeamNames.slice(0, 60).join(", ")}

JSON SHAPE: [{ "name": "Existing Team", "unlock_cost": 250, "category": "domination" }]
${updateRules("name")}`;
}

export function buildRunUpdatePrompt(_ctx: ImportContext, brief: string) {
  return `You are EDITING existing 3v3 runs.
TASK: ${brief || "retune target scores and milestones"}.

JSON SHAPE: [{ "name": "Existing Run", "target_score": 21, "milestones": [ { "score": 7, "reward_type": "coins", "reward_value": { "amount": 250 } } ] }]
${updateRules("name")}`;
}

export function buildChallengeUpdatePrompt(_ctx: ImportContext, brief: string) {
  return `You are EDITING existing challenges.
TASK: ${brief || "rebalance rewards"}.

JSON SHAPE: [{ "name": "Existing Challenge", "coin_reward": 500, "gem_reward": 10 }]
${updateRules("name")}`;
}

export function buildGemTaskUpdatePrompt(_ctx: ImportContext, brief: string) {
  return `You are EDITING existing gem tasks.
TASK: ${brief || "retune rewards and cooldowns"}.

JSON SHAPE: [{ "title": "Existing Task Title", "gem_reward": 8, "cooldown_hours": 24 }]
${updateRules("title")}`;
}

export function buildDynamicDuoUpdatePrompt(_ctx: ImportContext, brief: string) {
  return `You are EDITING existing dynamic duos.
TASK: ${brief || "rebalance boosts"}.

JSON SHAPE: [{ "name": "Existing Duo", "boosts_a": { "stat_reb": 5 }, "boosts_b": { "stat_reb": 5 } }]
${updateRules("name")}`;
}

export function buildLockerCodeUpdatePrompt(ctx: ImportContext, brief: string) {
  return `You are EDITING existing locker codes.
TASK: ${brief || "extend expirations or update rewards"}.

Existing codes: ${ctx.existingLockerCodes.slice(0, 40).join(", ")}
JSON SHAPE: [{ "code": "EXISTING-CODE", "expires_at": "2026-12-31T23:59:59Z", "max_redemptions": 500 }]
${updateRules("code")}`;
}

// ── Update commits (PATCH-style) ───────────────

async function patchByName(table: string, name: string, patch: Record<string, unknown>) {
  // Strip undefined so we don't accidentally null-out columns.
  const clean: Record<string, unknown> = {};
  Object.entries(patch).forEach(([k, v]) => { if (v !== undefined) clean[k] = v; });
  if (!Object.keys(clean).length) return 0;
  const { error, count } = await supabase
    .from(table as any)
    .update(clean as any, { count: "exact" })
    .ilike("name", name);
  if (error) throw error;
  return count ?? 0;
}

export async function updatePlayers(rows: z.infer<typeof PlayerUpdateSchema>, ctx: ImportContext) {
  const gemByName = new Map(ctx.gemTiers.map(g => [g.name.toLowerCase(), g.id]));
  let total = 0;
  for (const r of rows) {
    const { name, gem_tier, ...rest } = r;
    const patch: Record<string, unknown> = { ...rest };
    if (gem_tier !== undefined) patch.gem_tier_id = gem_tier ? gemByName.get(gem_tier.toLowerCase()) ?? null : null;
    total += await patchByName("player_cards", name, patch);
  }
  return total;
}

export async function updateTeams(rows: z.infer<typeof TeamUpdateSchema>) {
  let total = 0;
  for (const r of rows) {
    const { name, ...patch } = r;
    total += await patchByName("teams", name, patch);
  }
  return total;
}

export async function updateRuns(rows: z.infer<typeof RunUpdateSchema>) {
  let total = 0;
  for (const r of rows) {
    const { name, ...patch } = r;
    total += await patchByName("runs", name, patch);
  }
  return total;
}

export async function updateChallenges(rows: z.infer<typeof ChallengeUpdateSchema>) {
  let total = 0;
  for (const r of rows) {
    const { name, ...patch } = r;
    total += await patchByName("challenges", name, patch);
  }
  return total;
}

export async function updateGemTasks(rows: z.infer<typeof GemTaskUpdateSchema>) {
  let total = 0;
  for (const r of rows) {
    const { title, ...patch } = r;
    // gem_tasks uses "title" as natural key
    const clean: Record<string, unknown> = {};
    Object.entries(patch).forEach(([k, v]) => { if (v !== undefined) clean[k] = v; });
    if (!Object.keys(clean).length) continue;
    const { error, count } = await supabase.from("gem_tasks").update(clean as any, { count: "exact" }).ilike("title", title);
    if (error) throw error;
    total += count ?? 0;
  }
  return total;
}

export async function updateDynamicDuos(rows: z.infer<typeof DynamicDuoUpdateSchema>) {
  let total = 0;
  for (const r of rows) {
    const { name, ...patch } = r;
    total += await patchByName("dynamic_duos", name, patch);
  }
  return total;
}

export async function updateLockerCodes(rows: z.infer<typeof LockerCodeUpdateSchema>) {
  let total = 0;
  for (const r of rows) {
    const { code, ...patch } = r;
    const clean: Record<string, unknown> = {};
    Object.entries(patch).forEach(([k, v]) => { if (v !== undefined) clean[k] = v; });
    if (!Object.keys(clean).length) continue;
    const { error, count } = await supabase.from("locker_codes").update(clean as any, { count: "exact" }).ilike("code", code);
    if (error) throw error;
    total += count ?? 0;
  }
  return total;
}

/** Check if a natural key exists in the given list (case-insensitive). */
export function existsInList(value: string, existingLower: string[]) {
  return existingLower.includes(value.toLowerCase());
}
