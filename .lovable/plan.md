

# Fix Evolution Tracking, Expand Challenge Types, Fix Push Notifications, Improve Card Stars

Four issues to address:

---

## 1. Evolution Progress is Never Tracked

**Problem**: The `user_evo_progress` table exists and the `CardDetailDialog` reads from it, but **no code ever writes to it**. After a game finishes (`GameResults.tsx`), game stats are saved to `card_game_stats` and `game_logs`, but evo progress is never updated.

**Fix**: After saving game results in `GameResults.tsx`, query the active evo path for each user card, compute progress increments based on the challenge type, and upsert into `user_evo_progress`.

---

## 2. Evo Challenges Need Per-Stat Targeting

**Problem**: Current challenge types are generic (`points_scored`, `games_won`, `stat_threshold`). You want challenges like "Record 100 rebounds", "Record 20 rebounds in a game", "Record 20 games with 20+ rebounds".

**Changes**:

**Database** — Add `challenge_stat` column to `evo_paths`:
```sql
ALTER TABLE public.evo_paths ADD COLUMN challenge_stat text;
```
This stores which stat the challenge targets (e.g., `stat_reb`, `stat_stl`, `stat_3pt`).

**Expand challenge types** to support:
- `total_stat` — accumulate a stat across all games (e.g., "Record 100 rebounds")
- `single_game_stat` — hit a stat threshold in one game (e.g., "Record 20 rebounds in a game")
- `stat_game_count` — count games where a stat exceeds a threshold (e.g., "Record 20 games with 20+ rebounds")
- Keep existing `points_scored` and `games_won`

**Admin UI** (`EvoPathEditor.tsx`) — Add a stat selector dropdown that appears when challenge type is stat-based. Update the auto-generator to use the new types.

**Progress tracker** — After each game, evaluate each card's active evo step against the new challenge types and update `user_evo_progress`.

---

## 3. Push Notifications Not Sending

**Problem**: The `publish-scheduled-posts` edge function has a custom Web Push implementation using raw `crypto.subtle` for RFC 8291 encryption. The VAPID private key import uses `"raw"` format, but ECDSA P-256 private keys need `"pkcs8"` format — `importKey("raw", ...)` will fail silently. Also the CORS headers import may be wrong for the SDK version used.

**Fix**:
- Fix the VAPID key import to use `"pkcs8"` or properly handle the raw 32-byte private key by constructing PKCS8 wrapper bytes
- Fix HKDF implementation (the current code imports `ikm` as HMAC key but the HKDF extract step should use `salt` as the key and `ikm` as the data)
- Add better error logging to diagnose push failures
- Consider using a proven Deno web-push library instead of custom crypto

---

## 4. Card Stars Not Visible in Collection

**Problem**: `PlayerCard` renders `StarRating` at `size="sm"` (3x3px stars) in the top-right corner with `text-foreground/20` empty stars — nearly invisible on gradient backgrounds. The `rating` passed may also be the raw numeric rating rather than a star count.

**Fix**:
- Increase star size to `"md"` in the card thumbnail
- Add a dark backdrop behind the stars for contrast (similar to the badge count pill)
- Move stars to a more prominent position or add a numeric rating badge
- Ensure the `rating` value correctly maps to the star scale (the `rating` column is numeric, not necessarily 0-5)

---

## Files to Change

| File | Change |
|------|--------|
| Migration | Add `challenge_stat` column to `evo_paths` |
| `src/components/admin/EvoPathEditor.tsx` | Add stat selector, expand challenge types |
| `src/lib/evoGenerator.ts` | Update auto-generator with new challenge types |
| `src/components/game/GameResults.tsx` | Add evo progress tracking after game save |
| `supabase/functions/publish-scheduled-posts/index.ts` | Fix VAPID key import and HKDF crypto |
| `src/components/cards/PlayerCard.tsx` | Improve star visibility with backdrop and larger size |
| `src/components/cards/StarRating.tsx` | No changes needed (already supports sizes) |

