

# Searchable Player Selects + Announcement Notification System

## 1. Searchable Player Combobox

**Problem**: Player dropdowns in AdminPacks (pack player slots) and AdminTeams (domination game players) use plain `<Select>` which becomes unusable with many players.

**Solution**: Build a reusable `PlayerCombobox` component using the existing `cmdk` (Command) primitives + Popover. It provides a search input that filters the player list as you type.

**Files**:
- **New**: `src/components/admin/PlayerCombobox.tsx` — Popover + Command-based searchable select
- **Edit**: `src/pages/admin/AdminPacks.tsx` — Replace the player `<Select>` in the Pack Players tab with `PlayerCombobox`
- **Edit**: `src/pages/admin/AdminTeams.tsx` — Replace any player selects with `PlayerCombobox` (domination game rosters, etc.)

## 2. Scheduled Announcements with Notification System

**Problem**: Announcements go live immediately. There's no way to schedule them or notify players when they appear.

### Database Changes

Add columns to `social_posts`:
- `scheduled_at` (timestamptz, nullable) — when the post should go live; null = immediate
- `is_published` (boolean, default true) — false for scheduled posts not yet live

Add a new `notifications` table:
- `id` (uuid, PK)
- `user_id` (uuid, references auth.users)
- `title` (text)
- `body` (text)
- `link` (text, nullable) — e.g. `/feed`
- `read` (boolean, default false)
- `created_at` (timestamptz)
- RLS: users read/update own notifications

### Scheduled Publishing

Create an edge function `publish-scheduled-posts` that:
1. Queries `social_posts` where `scheduled_at <= now()` and `is_published = false`
2. Sets `is_published = true` and `posted_at = now()`
3. For announcement-type posts, inserts a notification row for every user in `profiles`
4. Scheduled via pg_cron to run every minute

### Feed Filtering

Update `SocialFeed.tsx` and `FeedProfile.tsx` queries to add `.eq("is_published", true)` so scheduled posts don't appear early.

### Admin UI

Update the post creation form in `AdminSocialFeed.tsx`:
- Add a "Schedule" datetime picker (only for announcement type, or all types)
- When a `scheduled_at` value is set, save `is_published = false`

### Notification Bell

Add a notification bell icon to the app header (`AppLayout.tsx`):
- Shows unread count badge
- Dropdown/popover listing recent notifications
- Clicking a notification marks it read and navigates to the link
- Query `notifications` table filtered by current user, ordered by `created_at` desc

### Files Changed

| File | Change |
|------|--------|
| `src/components/admin/PlayerCombobox.tsx` | New searchable player select component |
| `src/pages/admin/AdminPacks.tsx` | Use PlayerCombobox for player slot selection |
| `src/pages/admin/AdminTeams.tsx` | Use PlayerCombobox where players are selected |
| `src/pages/admin/AdminSocialFeed.tsx` | Add scheduled_at datetime picker, set is_published |
| `src/pages/SocialFeed.tsx` | Filter to is_published = true |
| `src/pages/FeedProfile.tsx` | Filter to is_published = true |
| `src/components/AppLayout.tsx` | Add notification bell with unread count + dropdown |
| `supabase/functions/publish-scheduled-posts/index.ts` | Edge function to publish and notify |
| Migration | Add scheduled_at, is_published to social_posts; create notifications table |
| pg_cron | Schedule the edge function every minute |

