

# Distinct Social Post Types — Instagram + Tweet Style

## Problem
Right now every post renders with the same generic card layout regardless of `post_type`. The feed feels flat and repetitive.

## Solution
Redesign the feed so each post type has a visually distinct layout mimicking real social platforms:

### Tweet Style (`post_type: "tweet"`)
- Compact text-first layout with Twitter/X-like styling
- Handle displayed as `@handle` with a subtle verified-style check icon
- Content text is prominent, no image border treatment
- Retweet count added alongside likes/comments
- Light top-border accent using player's card color

### Instagram Style (`post_type: "story"` or new type `"instagram"`)
- Image-forward layout: large image taking full card width with no rounded corners inside
- Username + avatar row at top (Instagram header style)
- Action row below image: heart, comment, share icons in a row
- Likes shown as "Liked by X and Y others" text style
- Caption shown below with handle bolded inline

### Announcement Style (`post_type: "announcement"`)
- Full-width banner with gradient background using primary/accent colors
- Megaphone icon prominent, "LEAGUE ANNOUNCEMENT" label
- Bolder typography, centered text
- No engagement metrics (likes/comments hidden) — feels official

### Admin Changes
- Add `"instagram"` to the post type options in admin form
- Add optional fields: `retweet_count` (for tweets), `caption` (separate from content for Instagram posts) — but we can reuse existing columns to avoid a migration:
  - `content` = caption/text for all types
  - `image_url` = required for instagram, optional for others
  - `likes_count` / `comments_count` already exist

No database migration needed — just UI changes.

## Files Changed

| File | Change |
|------|--------|
| `src/pages/SocialFeed.tsx` | Rewrite to render 3 distinct post layouts based on `post_type` |
| `src/pages/admin/AdminSocialFeed.tsx` | Add `"instagram"` to POST_TYPES array |

## Feed Page Structure

```text
┌─────────────────────────┐
│ 🐦 Tweet Post           │
│ @handle  ·  2h ago      │
│ "Just dropped 40 on..." │
│ ♥ 1.2k  💬 89  🔁 340   │
└─────────────────────────┘

┌─────────────────────────┐
│ 📸 Instagram Post       │
│ handle  ·  avatar       │
│ ┌─────────────────────┐ │
│ │                     │ │
│ │    FULL IMAGE       │ │
│ │                     │ │
│ └─────────────────────┘ │
│ ♥ 💬 ➤  icons row       │
│ 2,340 likes             │
│ handle Game day 🔥      │
└─────────────────────────┘

╔═════════════════════════╗
║ 📢 LEAGUE ANNOUNCEMENT ║
║ Season 3 tips off...    ║
╚═════════════════════════╝
```

