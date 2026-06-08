// Human-readable explanation of how the game systems connect.
// This is shipped to ChatGPT alongside the live DB snapshot so it has full context.

export const SYSTEM_DOCS_MARKDOWN = `# G-Team Infinite — System Reference

## Overview
A collectible-card sports sim. Players (cards) belong to **Teams**, which appear in
**Dominations** (3v3 boss-style matchups) and **Runs** (ladder of 3v3 opponent sets).
Cards are acquired via **Packs**, the **Gem Market**, the **Auction House**, and
**Locker Codes**. Cards evolve via **Evo Paths**, gain **Badges** and **Signature Traits**,
and pair into **Dynamic Duos** for stat boosts. Progress is tracked via **Collections**,
**Sub-Collections**, and **Challenges**. A **Social Feed** + **League History** page
present narrative events authored as **Storylines**.

## Entities

### player_cards
The atomic unit. Fields include name, archetype, overall, per-stat ratings,
rarity, image_url, collection_id/sub_collection_id, plus evo lineage pointers.

### teams + team_players
A roster of player_cards. Categories: \`domination\`, \`run\`, \`challenge\`.
\`unlock_cost_gems\` gates Domination teams; Run teams ladder by rank.

### runs + run_players + run_rank_rewards
A **Run** is a 3v3 ladder. Each rank tier has opponent rosters (run_players)
and rewards (run_rank_rewards: gems, packs, specific cards).

### dominations (domination_games + domination_game_players)
Boss matchups. Beating a Domination team usually grants its signature card.

### challenges + challenge_completions
Win-condition objectives (e.g., "win with 3 sharpshooters"). Reward packs/gems/cards.

### packs + pack_odds + pack_players
A pack has odds per rarity and a pool of eligible players. Opens 1 card per call
via the \`open-pack\` edge function.

### gem_tiers + gem_market_listings
Tiered storefront. Buying a gem-market card auto-syncs it into the tier's collection
(see \`sync_gem_tier_collection\` trigger).

### auction_listings
User-driven marketplace. Bid/buy-now via \`buy-auction-card\` edge function.

### locker_codes + locker_code_redemptions
Promo codes redeemable for packs/gems/cards via \`redeem-locker-code\`.

### gem_tasks + gem_task_completions
Real-world or in-app tasks awarding gems on cooldown.

### dynamic_duos
Pairs of player_cards. When both are on the same lineup, both receive stat boosts.

### badges + signature_traits + player_card_(badges|traits)
Modifiers attached to cards. Badges are universal; signature_traits are unique flavor.

### evo_paths + user_evo_progress
Upgrade lanes. Hitting milestones evolves a card into its next form.

### collections + sub_collections + user_collections + user_collection_claims
Hierarchical sets. Completing one awards rewards. Gem-market collections are
auto-managed (do not edit manually).

### social_posts + social_creators
Tweet-style feed. \`is_headline\` + \`headline_rank\` promote a post to the
**League History** hero. Linked to storylines via storyline_entities.

### storylines + storyline_entities
Narrative arcs that bundle players, locker codes, and social posts into one
atomically-imported package (\`import-storyline-bundle\` edge function).

### profiles + user_roles
\`user_roles\` is the single source of truth for admin/player permissions
(checked via \`has_role()\`). Never store role on profile.

## Game Loop (TL;DR)
1. User opens **Packs** / buys from **Gem Market** / wins **Auctions** → gains cards.
2. Builds lineups → plays **Runs** (3v3 ladder) and **Dominations** (boss 3v3 / 5v5).
3. Completes **Challenges** + **Gem Tasks** for currency.
4. Currency feeds back into Packs, evolves cards (**Evo Paths**), pairs **Duos**.
5. **Social Posts** + **Storylines** narrate the meta on the **League History** page.

## Conventions (when authoring with ChatGPT)
- **Names must be unique** within an entity type — collisions are rejected at import.
- **Archetypes, gem tiers, opponent team names** must match values already in the DB
  (the snapshot below lists them).
- **Roster references** use player names exactly — the importer resolves to IDs.
- **Cards** are styled \`aspect-[3/4] w-full\`, image_url should match.
- **Rewards** are JSON: \`{ gems?: number, pack_id?: uuid, card_id?: uuid }\`.
- **Storylines** can bundle players + locker_codes + social_posts in one JSON.
- **Ratings are decimals** (numeric, e.g. \`87.4\`) — preserve to one decimal place. Do not round.

## Diagnostics block (read this FIRST)
The snapshot includes a top-level \`diagnostics\` object listing what is incomplete:
- \`diagnostics.unrated_players\` — players with no rating or all-zero stats. When asked
  to "rate unrated players", iterate this list exclusively.
- \`diagnostics.incomplete_team_rosters\` — teams with fewer than 3 player slots filled
  (category included so you know whether it's a domination / run / challenge team).
- \`diagnostics.incomplete_runs\` — runs missing opponent cards, milestones, or target_score.
- \`diagnostics.incomplete_domination_paths\` — domination games whose roster has < 3 cards.

When the user gives a broad brief like "finish the missing rosters" or "rate the unrated
players", emit JSON ONLY for the items listed in the matching diagnostics array.

## How to use the snapshot below with ChatGPT
1. Paste the README + the JSON snapshot as a single system message in ChatGPT.
2. Ask for content (e.g., "Rate every player in diagnostics.unrated_players" or
   "Generate 10 new sharpshooters for 'East Coast Era'"). ChatGPT will respect existing
   names + enums and target only what's incomplete.
3. Paste its JSON output into the matching Admin page's "AI Import / Export" tab
   (use **Update existing** mode for edits, **Create** mode for new content).
`;
