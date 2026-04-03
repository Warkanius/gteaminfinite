

# Three New Features: Locker Codes, Auction House, Evo Paths

## Feature 1: Locker Codes

Admin creates codes with attached rewards (coins, gems, specific packs, or specific cards). Players enter codes on a new page to redeem them.

### Database
- **`locker_codes`** table: `id`, `code` (unique text), `reward_type` (coins/gems/pack/card), `reward_value` (jsonb — amount or card/pack id), `max_redemptions` (int, nullable for unlimited), `expires_at` (timestamptz, nullable), `created_at`
- **`locker_code_redemptions`** table: `id`, `user_id`, `locker_code_id`, `redeemed_at` — unique constraint on (user_id, locker_code_id) to prevent double-use
- RLS: codes readable by all authenticated; redemptions scoped to own user_id

### Edge Function
- **`redeem-locker-code`**: validates code exists, not expired, not already redeemed by user, not over max redemptions. Distributes reward (update coins/gems on profile, insert into user_collections, or trigger pack open). Returns reward description.

### UI
- **Player page** `/locker-codes`: text input, submit button, animated reward reveal on success
- **Admin page** `/admin/locker-codes`: CRUD table for creating/editing codes with reward type picker
- Add both routes to App.tsx and sidebar nav

### Files
| File | Action |
|------|--------|
| Migration | Create `locker_codes` + `locker_code_redemptions` tables |
| `supabase/functions/redeem-locker-code/index.ts` | Create |
| `src/pages/LockerCodes.tsx` | Create — player redemption UI |
| `src/pages/admin/AdminLockerCodes.tsx` | Create — admin CRUD |
| `src/App.tsx` | Add routes |
| `src/components/AppSidebar.tsx` | Add nav links |

---

## Feature 2: Auction House with Bot Listings

A marketplace where cards appear at various prices. Bot listings are generated automatically; admin controls market tendencies (price ranges, card quality distribution, snipe frequency).

### Database
- **`auction_listings`** table: `id`, `player_card_id`, `seller_type` (bot/user — future-proof), `price` (integer, in coins), `listed_at`, `expires_at`, `bought_by` (uuid, nullable), `bought_at` (timestamptz, nullable), `is_active` (boolean default true)
- **`auction_config`** row in `rule_config`: jsonb with keys like `min_price`, `max_price`, `snipe_chance` (% of listings priced well below market), `refresh_interval_minutes`, `listings_per_refresh`, `tier_weights` (which gem tiers appear more often)
- RLS: listings readable by all authenticated; only the edge function (service role) inserts bot listings

### Edge Function
- **`refresh-auction`**: called on a cron schedule (every 5-10 min via pg_cron). Reads `auction_config` from `rule_config`, expires old listings, generates N new bot listings by picking random player_cards weighted by tier_weights, pricing them using min/max range with a `snipe_chance` roll for below-market prices. Marks expired unsold listings inactive.
- **`buy-auction-card`**: validates listing is active + not expired, deducts coins from buyer profile, sets `bought_by`/`bought_at`, inserts into `user_collections`, marks listing inactive.

### Admin UI
- Add an "Auction Config" section to the existing Admin Rules page (or a dedicated admin page) with sliders/inputs for min price, max price, snipe chance %, refresh interval, listings per refresh, and tier weight sliders
- A "Force Refresh" button that manually triggers the refresh function

### Player UI
- **`/auction`** page: grid of active listings showing card name, tier color, price, time remaining. Search/filter by tier. "Buy Now" button opens confirm dialog. "Snipe" badge on underpriced cards (optional visual flair).

### Files
| File | Action |
|------|--------|
| Migration | Create `auction_listings` table |
| Insert tool | Seed `auction_config` in `rule_config` |
| pg_cron setup | Schedule `refresh-auction` every 5 min |
| `supabase/functions/refresh-auction/index.ts` | Create |
| `supabase/functions/buy-auction-card/index.ts` | Create |
| `src/pages/AuctionHouse.tsx` | Create |
| `src/pages/admin/AdminRules.tsx` | Add auction config section |
| `src/App.tsx` | Add route |
| `src/components/AppSidebar.tsx` | Add nav link |

---

## Feature 3: Evo Paths with Admin Generator

Cards evolve tier-to-tier (Gold → Emerald → Amethyst → ...) by completing challenges at each stage. Evo paths are editable in the admin player editing suite (not inside the wizard), and an auto-generator creates reasonable paths so you don't have to design them manually.

### Database
- **`evo_paths`** table: `id`, `player_card_id` (references player_cards), `from_tier_id` (gem_tiers), `to_tier_id` (gem_tiers), `step_order` (int), `challenge_description` (text — e.g., "Score 50 points with this card"), `challenge_type` (text — games_won, points_scored, stat_threshold), `challenge_target` (int — the number to hit), `stat_boosts` (jsonb — e.g., `{"stat_3pt": +1, "stat_fin": +2}`), `new_badges` (jsonb — badge ids + tiers to add on completion), `created_at`
- RLS: readable by all authenticated, admin manages

### Evo Path Generator (Client-side, in Admin)
- A new component `EvoPathEditor` added to the player edit dialog in `AdminPlayers.tsx` (as a collapsible section or tab)
- **"Auto-Generate Evo Path"** button that:
  - Looks at the card's current gem tier and generates steps to reach the highest tier
  - For each step, picks a challenge type (rotate between games_won, points_scored, stat_threshold) with scaled targets (harder at higher tiers)
  - Calculates stat boosts per step (distribute remaining stat points to reach tier ceiling)
  - Suggests badge upgrades (promote existing badges to next tier level)
- Admin can then tweak any generated step: edit challenge text, adjust stat boosts, add/remove badges
- Works for existing players without changing their current ratings — it only defines the *path forward*

### Player-Facing UI
- In `CardDetailDialog.tsx`, add an "Evolution" tab/section showing the card's evo path as a vertical timeline
- Current step highlighted, completed steps checked off, future steps shown but locked
- Progress bar for current challenge (e.g., "12/50 points scored")

### Evo Progress Tracking
- **`user_evo_progress`** table: `id`, `user_id`, `player_card_id`, `evo_path_id`, `current_value` (int — progress toward challenge_target), `completed` (boolean), `completed_at`
- Game engine updates progress after each game (increment points_scored, games_won, etc.)

### Files
| File | Action |
|------|--------|
| Migration | Create `evo_paths` + `user_evo_progress` tables |
| `src/components/admin/EvoPathEditor.tsx` | Create — generator + manual edit UI |
| `src/pages/admin/AdminPlayers.tsx` | Add EvoPathEditor to player edit dialog |
| `src/components/cards/CardDetailDialog.tsx` | Add evo timeline section |
| `src/lib/evoGenerator.ts` | Create — client-side path generation logic |
| `src/lib/gameEngine.ts` | Update — increment evo progress after games |

---

## Implementation Order

These are three large features. Recommended order:
1. **Locker Codes** — smallest scope, standalone, quick win
2. **Evo Paths** — medium scope, enriches existing card system
3. **Auction House** — largest scope, requires cron jobs and ongoing bot simulation

Each feature will be implemented as a separate batch of changes.

