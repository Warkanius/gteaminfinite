

# Fix Handle Links + Creator Management

## Issues Found

1. **Handles not clickable in FeedProfile.tsx**: The `TweetPost` and `InstagramPost` components in `FeedProfile.tsx` were never updated to be creator-aware. They only read from `post.player_cards`, so creator-attributed posts show as "GTeam League" with no link.

2. **Creator dialog missing overflow styles**: The `FormDialog` for creators passes `className="max-w-md"`, which *replaces* the default `"max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"` class. This means the creator dialog loses its flex layout and scroll behavior, potentially making the Save button unreachable or the dialog behaving unexpectedly.

3. **Creators can only be attributed to YouTube posts**: The save mutation hard-codes `creator_id` to `null` for non-YouTube types and the form only shows the Creator dropdown for YouTube. Creators should be available for tweet/instagram posts too.

## Plan

### 1. Fix FeedProfile.tsx post components
Update `TweetPost` and `InstagramPost` in `FeedProfile.tsx` to resolve attribution from `post.social_creators` first, then `post.player_cards` — matching the logic already in `SocialFeed.tsx`.

### 2. Fix creator dialog className
Change the `FormDialog` className to `"max-w-md max-h-[85vh] flex flex-col overflow-hidden"` so it keeps the scroll/layout behavior.

### 3. Allow creators on all post types
- Update the admin post form to show a "Creator or Player" attribution section for all post types, not just YouTube
- Update `saveMut` to send `creator_id` for non-YouTube posts too
- When a creator is selected, clear `player_card_id` and vice versa

### Files Changed

| File | Change |
|------|--------|
| `src/pages/FeedProfile.tsx` | Make TweetPost/InstagramPost creator-aware |
| `src/pages/admin/AdminSocialFeed.tsx` | Fix dialog className, allow creators on all post types |

