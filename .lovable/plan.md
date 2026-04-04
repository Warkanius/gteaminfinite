

# Social Media Feed + PWA Setup

## Feature 1: Fictional Social Media Feed

A scrollable feed of fictional posts that make the game world feel alive. Admins create posts attributed to player cards (using their social handle). Players see a timeline-style feed.

### Database

**`social_posts`** table:
- `id` (uuid), `player_card_id` (uuid, nullable — for "league" posts not tied to a player), `content` (text), `image_url` (text, nullable), `likes_count` (int, default random seed), `comments_count` (int), `post_type` (text: "tweet", "story", "announcement"), `posted_at` (timestamptz, default now), `created_at` (timestamptz)
- RLS: readable by all authenticated, admin manages

**`player_cards`** — add column:
- `social_handle` (text, nullable) — e.g. "@KingJames"

### Admin UI
- New page `/admin/social-feed` — CRUD for posts: pick a player card (auto-fills their handle), write content, optionally add image URL, set post type, set fake likes/comments counts
- Add `social_handle` field to the player edit form in `AdminPlayers.tsx`

### Player UI
- New page `/feed` — timeline-style feed sorted by `posted_at` desc
- Each post shows: player avatar/card color as accent, social handle, content, image if present, like/comment counts (display only), relative timestamp
- Infinite scroll or paginated load

### Files
| File | Action |
|------|--------|
| Migration | Add `social_handle` to `player_cards`, create `social_posts` table |
| `src/pages/SocialFeed.tsx` | Create — player feed UI |
| `src/pages/admin/AdminSocialFeed.tsx` | Create — admin CRUD |
| `src/pages/admin/AdminPlayers.tsx` | Add social_handle input |
| `src/App.tsx` | Add routes |
| `src/components/AppSidebar.tsx` | Add nav links |

---

## Feature 2: PWA (Installable Web App)

Make the app installable from the browser to the home screen. Since you want to discuss the icon, we'll set up the PWA infrastructure with a placeholder icon that you can swap later.

### Approach
- **No service worker / no offline caching** — just a `manifest.json` with `display: "standalone"` for installability. This avoids the complexity and caching issues of full PWA service workers.
- Add mobile-optimized meta tags to `index.html`
- Create `/install` page with instructions for adding to home screen

### Files
| File | Action |
|------|--------|
| `public/manifest.json` | Create — app name, colors, display standalone, placeholder icons |
| `public/icon-192.png` | Placeholder (solid color square) |
| `public/icon-512.png` | Placeholder (solid color square) |
| `index.html` | Add manifest link + mobile meta tags (theme-color, apple-mobile-web-app-capable) |
| `src/pages/Install.tsx` | Create — install instructions page |
| `src/App.tsx` | Add `/install` route |

### Icon Discussion
The placeholder icons will be simple branded squares. You can replace `public/icon-192.png` and `public/icon-512.png` with your actual icon at any time — just tell me what you'd like and I can generate or update them.

---

## Implementation Order
1. Social feed (database + admin + player UI)
2. PWA manifest setup

