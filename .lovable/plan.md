

# Add Web Push Notifications for Announcements

The app already has a PWA manifest and in-app notifications. We need to add the Web Push API so players get lock-screen alerts when announcements go live, even if the app is closed.

## Architecture

```text
Admin schedules announcement
        ↓
pg_cron triggers publish-scheduled-posts edge function
        ↓
Edge function publishes post + creates in-app notifications
        ↓  (NEW)
Edge function sends web-push to all subscribed users
        ↓
Player sees native push notification on their device
```

## Database Changes

**New table: `push_subscriptions`**
- `id` uuid PK
- `user_id` uuid (references auth.users)
- `endpoint` text (push service URL)
- `p256dh` text (encryption key)
- `auth` text (auth secret)
- `created_at` timestamptz
- RLS: users insert/read/delete own subscriptions
- Unique constraint on `(user_id, endpoint)` to prevent duplicates

## Secrets Needed

**VAPID keys** — a public/private key pair for Web Push authentication:
- `VAPID_PUBLIC_KEY` — stored as a Vite env var (public, safe for client)
- `VAPID_PRIVATE_KEY` — stored as a backend secret (edge function only)
- `VAPID_SUBJECT` — mailto or URL identifier (e.g. `mailto:admin@gteaminfinite.com`)

I will generate these keys via a script and configure them.

## Implementation

### 1. Service Worker (`public/sw.js`)
A minimal service worker that listens for `push` events and displays native notifications. Clicking the notification opens the app to the linked route.

### 2. Push Subscription Hook (`src/hooks/usePushNotifications.ts`)
- Checks browser support for `PushManager`
- Requests notification permission
- Subscribes to push using the VAPID public key
- Saves the subscription (endpoint, keys) to `push_subscriptions` table
- Provides `subscribed` state and `subscribe()`/`unsubscribe()` functions

### 3. UI — Enable Push Button
Add a "Enable Push Notifications" prompt in the notification bell popover or on the Dashboard. When clicked, triggers the permission flow and saves the subscription.

### 4. Edge Function Update (`publish-scheduled-posts`)
After inserting in-app notifications for announcements, also:
- Query `push_subscriptions` for all users
- Send web-push to each subscription using the `web-push` library (Deno-compatible)
- Remove stale subscriptions that return 410 Gone

### 5. Service Worker Registration (`src/main.tsx`)
Register `sw.js` only in production and not inside iframes (to avoid breaking Lovable preview).

## Files

| File | Action |
|------|--------|
| `public/sw.js` | Create — push event listener + notification click handler |
| `src/hooks/usePushNotifications.ts` | Create — subscription management hook |
| `src/components/AppLayout.tsx` | Edit — add push notification opt-in UI in bell popover |
| `src/main.tsx` | Edit — register service worker in production |
| `supabase/functions/publish-scheduled-posts/index.ts` | Edit — send web-push after publishing announcements |
| Migration | Create `push_subscriptions` table with RLS |
| Secrets | Generate and store VAPID keys |

