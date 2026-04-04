

# Make All Posts Link to Their Profile

## Problem
Tweet and Instagram posts only check `player_card_id` for attribution. Posts attributed to creators (via `creator_id`) show as unlinked "GTeam League" text instead of linking to the creator's profile.

## Fix (`src/pages/SocialFeed.tsx`)

Update `TweetPost` and `InstagramPost` to resolve attribution from **either** `player_cards` or `social_creators`:

- Check `post.social_creators` in addition to `post.player_cards`
- If a creator exists, use `creator.handle`, `creator.name`, `creator.accent_color`, and `creator.avatar_url`
- If a player exists, use player fields as before
- Only fall back to static "GTeam League" text when **neither** is set

This is a single-file change — just updating the attribution logic in both post components to be creator-aware (the YouTube post already does this correctly).

