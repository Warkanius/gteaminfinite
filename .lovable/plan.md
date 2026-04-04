

# YouTube Post Type + Creator Handles

## Overview
Add a YouTube-style post type to the social feed and introduce "creators" — non-player personalities who make content about the league (commentators, analysts, fan channels, etc.).

## Database Changes

### New table: `social_creators`
| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| name | text | Display name (e.g. "HoopsTakeTV") |
| handle | text | YouTube-style handle (e.g. "@HoopsTakeTV") |
| accent_color | text | HSL color for avatar circle |
| created_at | timestamp | |

RLS: admins full CRUD, authenticated can read.

## Feed Changes (`SocialFeed.tsx`)

### New `YouTubePost` component
- Large thumbnail image (16:9 aspect ratio) with a play button overlay and duration badge
- Below: title text (bold, 2-line clamp) + creator avatar circle + creator name + view count + time ago
- Clean, minimal YouTube card style
- Post `content` = video title, `image_url` = thumbnail, `likes_count` repurposed as view count

### Data: query joins `social_creators` alongside `player_cards`

## Admin Changes (`AdminSocialFeed.tsx`)

### Creator management
- Add a small "Manage Creators" section or button that opens a sub-dialog to add/edit/delete creators
- Each creator has: name, handle, accent color

### Post form updates
- Add "youtube" to POST_TYPES
- When post type is "youtube": show a "Creator" dropdown (from `social_creators`) instead of "Player"
- Relabel "Content" → "Video Title" and "Image" → "Thumbnail" contextually

## Files Changed

| File | Change |
|------|--------|
| Migration SQL | Create `social_creators` table + RLS |
| `src/pages/SocialFeed.tsx` | Add YouTubePost component, fetch creators, route "youtube" post_type |
| `src/pages/admin/AdminSocialFeed.tsx` | Add creator CRUD, "youtube" post type, contextual form fields |

## YouTube Card Layout
```text
┌─────────────────────────────┐
│ ┌─────────────────────────┐ │
│ │                         │ │
│ │    THUMBNAIL (16:9)     │ │
│ │         ▶  12:34        │ │
│ └─────────────────────────┘ │
│ 🔴 Why Team X Will Win...   │
│    HoopsTakeTV · 24K views  │
│    · 3 hours ago            │
└─────────────────────────────┘
```

