

# GTeam Infinite — Companion App

## Overview
A basketball card-game companion app with two roles: **Admin** (game master who customizes everything) and **Player** (immersive gameplay tools). Dark, sporty 2K-style design with bold gem-tier accent colors. Backed by Supabase for multi-user sync.

---

## Phase 1: Foundation & Data Layer

### Authentication & Roles
- Login/signup via email (Supabase Auth)
- Admin vs Player roles stored in a `user_roles` table
- Admin dashboard and Player dashboard are separate views based on role

### Database & Pre-loaded Data
- Design the full Supabase schema: Players (cards), Badges, Signature Traits, Gem Tiers, Star Conversion Key, Packs, Pack Odds, Teams, Runs/Rosters, Challenges, Currencies, and Rule Config
- Pre-load all player cards from the PDF (~60+ players with full stats, badges, traits, gem tier)
- Pre-load badges (16 badges × 5 tiers), signature traits (8 traits × 5 tiers), star conversion key, pack odds tables, teams, and domination road maps

### Dark & Sporty UI Shell
- Dark background with gem-tier accent colors (Gold, Emerald, Amethyst, Diamond, Pink Diamond, Actolytrene)
- Sidebar navigation with role-based menu items
- Responsive layout for desktop and mobile

---

## Phase 2: Admin Panel — Full Game Customization

### Player Card Manager
- Create, edit, delete player cards with all 9 skill stats (3PT, MID, FIN, DNK, AST, STL, REB, BLK, INT)
- Assign gem tier, badges (with tier level), signature traits (with tier level), positions
- Auto-calculate overall rating from stats

### Packs & Odds Manager
- Create/edit packs: name, cost, available players
- Configure odds tables (dice roll → which player slot wins)
- Support multiple pack types (Dom Pack, RTTR Pack, Sensations, etc.)

### Teams, Runs & Rosters Manager
- Create teams with rosters of player cards
- Configure Domination road maps (sequence of opponents, difficulty stars, rewards)
- Set up Runs (3v3 locations with rosters)

### Badges, Traits & Rules Config
- Edit badge definitions and effects at each tier
- Edit signature trait definitions and effects at each tier
- Configure star conversion key, game modes (5v5, 3v3), and gameplay rule parameters

### Challenges & Currencies
- Create spotlight challenges with custom conditions
- Manage currency types (coins, gems) and reward amounts

---

## Phase 3: Player Experience — Collection & Card View

### My Collection
- Grid/list view of all owned player cards with gem-tier color borders
- Tap a card to see full detail: stats radar/bar chart, badges, signature traits, bio
- Filter/sort by gem tier, position, rating, badge

### Evolution Tracker
- Each card shows evolution progress toward the next gem tier
- Manual stat input or auto-tracked from game logs
- Visual progress bar with milestones

### Card Design
- Styled card components with gem-tier color gradients
- Star ratings displayed visually
- Badge and trait icons/chips on card face

---

## Phase 4: Gameplay — Dice Roll Simulator

### User Game Simulator (5v5 & 3v3)
- Select 5 (or 3) players from collection to form lineup
- For each player + each skill: roll dice, apply star modifier from conversion key
- Automatically apply badge effects (rerolls, bonus half-dice, stat cancellations)
- Apply signature trait effects based on game context (home/away, key game, underdog)
- Apply opponent badge effects (Lockdown reducing stars, Intimidator reducing stars)
- Sum totals per player and team; show final score comparison

### CPU Roller
- Select opponent team → load their roster
- Auto-determine CPU shooter and shot type based on their strongest stat and the dice-roll rules (3PT if 1-2-3 rolled and strongest in 3PT, etc.)
- Roll for CPU skill check with all badge/trait modifiers applied
- Compare against user's defensive stats to determine success/failure

### Game Log
- Record each game result (user score, CPU score, individual player stats)
- Feed stats into evolution tracker automatically
- Win/loss record per mode

---

## Phase 5: Markets — Packs & Rings

### Pack Market
- Browse available packs with cost in coins
- Purchase a pack → dice-roll animation to determine which player you pull (using the odds table)
- "Feel-good" reveal: card flips over with gem-tier glow effect, better tiers get bigger visual feedback (screen flash, color burst)
- 10-box option for bulk opening

### Ring Market
- Browse and purchase rings/rewards with coins or gems
- Currency balance displayed in header

### Collection Rewards
- When all players from a pack set are collected, unlock the collection reward card automatically
- Notification and special reveal for collection completion

---

## Design & UX Notes
- **Color palette**: Dark navy/charcoal background, with gem-tier accents — Gold (#FFD700), Emerald (#50C878), Amethyst (#9966CC), Diamond (#B9F2FF), Pink Diamond (#FF69B4), Actolytrene (iridescent gradient)
- **Card feel**: Each card has a subtle border glow matching its gem tier
- **Pack opening**: Simple flip reveal with color burst matching the pull's tier — no complex 3D animations, just satisfying visual feedback
- **Typography**: Bold, athletic-feeling headings; clean body text

