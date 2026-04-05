import { createClient } from "https://esm.sh/@supabase/supabase-js@2.97.0";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.97.0/cors";

// Web Push helpers (RFC 8291 / RFC 8188)
async function sendWebPush(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: string,
  vapidSubject: string,
  vapidPublicKey: string,
  vapidPrivateKey: string
): Promise<Response> {
  // Import keys
  const pubBytes = base64UrlDecode(vapidPublicKey);
  const privBytes = base64UrlDecode(vapidPrivateKey);

  const vapidKeys = await crypto.subtle.importKey(
    "raw",
    privBytes,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  // Create VAPID JWT
  const audience = new URL(subscription.endpoint).origin;
  const expiry = Math.floor(Date.now() / 1000) + 12 * 60 * 60;
  const header = { typ: "JWT", alg: "ES256" };
  const claims = { aud: audience, exp: expiry, sub: vapidSubject };

  const jwtHeader = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const jwtPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(claims)));
  const unsignedToken = `${jwtHeader}.${jwtPayload}`;

  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    vapidKeys,
    new TextEncoder().encode(unsignedToken)
  );

  // Convert DER signature to raw r||s format (each 32 bytes)
  const rawSig = derToRaw(new Uint8Array(signature));
  const jwt = `${unsignedToken}.${base64UrlEncode(rawSig)}`;

  // Encrypt payload using RFC 8291 (aes128gcm)
  const userPublicKey = base64UrlDecode(subscription.p256dh);
  const userAuth = base64UrlDecode(subscription.auth);

  // Generate local ECDH key pair
  const localKey = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );
  const localPublicKeyRaw = await crypto.subtle.exportKey("raw", localKey.publicKey);

  // Import subscriber's public key
  const subscriberKey = await crypto.subtle.importKey(
    "raw",
    userPublicKey,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  // ECDH shared secret
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: "ECDH", public: subscriberKey },
    localKey.privateKey,
    256
  );

  // Generate 16 byte salt
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // HKDF-based key derivation per RFC 8291
  const authInfo = concatBuffers(
    new TextEncoder().encode("WebPush: info\0"),
    new Uint8Array(userPublicKey),
    new Uint8Array(localPublicKeyRaw)
  );

  const ikm = await hkdfSha256(new Uint8Array(userAuth), new Uint8Array(sharedSecret), authInfo, 32);
  const prk = await hkdfSha256(salt, ikm, new TextEncoder().encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdfSha256(salt, ikm, new TextEncoder().encode("Content-Encoding: nonce\0"), 12);

  // Encrypt with AES-128-GCM
  const aesKey = await crypto.subtle.importKey("raw", prk, "AES-GCM", false, ["encrypt"]);
  const paddedPayload = concatBuffers(new Uint8Array(new TextEncoder().encode(payload)), new Uint8Array([2]));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    aesKey,
    paddedPayload
  );

  // Build aes128gcm header: salt(16) + rs(4) + idlen(1) + keyid(65) + ciphertext
  const rs = new ArrayBuffer(4);
  new DataView(rs).setUint32(0, 4096);
  const localPubBytes = new Uint8Array(localPublicKeyRaw);
  const body = concatBuffers(
    salt,
    new Uint8Array(rs),
    new Uint8Array([localPubBytes.byteLength]),
    localPubBytes,
    new Uint8Array(encrypted)
  );

  const res = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: `vapid t=${jwt}, k=${base64UrlEncode(pubBytes)}`,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "86400",
    },
    body,
  });

  return res;
}

function base64UrlDecode(str: string): Uint8Array {
  const padding = "=".repeat((4 - (str.length % 4)) % 4);
  const base64 = (str + padding).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  return Uint8Array.from([...binary].map((c) => c.charCodeAt(0)));
}

function base64UrlEncode(buffer: Uint8Array): string {
  let binary = "";
  for (const byte of buffer) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concatBuffers(...buffers: Uint8Array[]): Uint8Array {
  const totalLen = buffers.reduce((sum, b) => sum + b.byteLength, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const buf of buffers) {
    result.set(buf, offset);
    offset += buf.byteLength;
  }
  return result;
}

function derToRaw(der: Uint8Array): Uint8Array {
  // Parse DER SEQUENCE containing two INTEGERs
  const raw = new Uint8Array(64);
  let offset = 2; // skip SEQUENCE tag + length
  // First INTEGER
  const rLen = der[offset + 1];
  offset += 2;
  const rStart = rLen > 32 ? offset + (rLen - 32) : offset;
  const rDest = rLen < 32 ? 32 - rLen : 0;
  raw.set(der.slice(rStart, offset + rLen), rDest);
  offset += rLen;
  // Second INTEGER
  const sLen = der[offset + 1];
  offset += 2;
  const sStart = sLen > 32 ? offset + (sLen - 32) : offset;
  const sDest = sLen < 32 ? 32 + (32 - sLen) : 32;
  raw.set(der.slice(sStart, offset + sLen), sDest);
  return raw;
}

async function hkdfSha256(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const prk = new Uint8Array(await crypto.subtle.sign("HMAC", 
    await crypto.subtle.importKey("raw", salt.length ? salt : new Uint8Array(32), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
    ikm
  ));
  const prkKey = await crypto.subtle.importKey("raw", prk, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const infoWithCounter = concatBuffers(info, new Uint8Array([1]));
  const okm = new Uint8Array(await crypto.subtle.sign("HMAC", prkKey, infoWithCounter));
  return okm.slice(0, length);
}

// ---- Main handler ----

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Find posts that are scheduled and not yet published
    const { data: pendingPosts, error: fetchErr } = await supabase
      .from("social_posts")
      .select("id, content, post_type")
      .eq("is_published", false)
      .lte("scheduled_at", new Date().toISOString());

    if (fetchErr) throw fetchErr;
    if (!pendingPosts || pendingPosts.length === 0) {
      return new Response(JSON.stringify({ published: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Publish them
    const ids = pendingPosts.map((p: any) => p.id);
    const { error: updateErr } = await supabase
      .from("social_posts")
      .update({ is_published: true, posted_at: new Date().toISOString() })
      .in("id", ids);

    if (updateErr) throw updateErr;

    // Get all user IDs for notifications
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id");

    const announcementPosts = pendingPosts.filter(
      (p: any) => p.post_type === "announcement"
    );

    if (profiles && profiles.length > 0 && announcementPosts.length > 0) {
      // Create in-app notifications
      const notifications = announcementPosts.flatMap((post: any) =>
        profiles.map((profile: any) => ({
          user_id: profile.user_id,
          title: "New Announcement",
          body:
            post.content.length > 100
              ? post.content.slice(0, 100) + "…"
              : post.content,
          link: "/feed",
        }))
      );

      for (let i = 0; i < notifications.length; i += 500) {
        const batch = notifications.slice(i, i + 500);
        const { error: notifErr } = await supabase
          .from("notifications")
          .insert(batch);
        if (notifErr) console.error("Notification insert error:", notifErr);
      }

      // Send web push notifications
      const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
      const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
      const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@gteaminfinite.com";

      if (vapidPublicKey && vapidPrivateKey) {
        const { data: pushSubs } = await supabase
          .from("push_subscriptions")
          .select("id, endpoint, p256dh, auth");

        if (pushSubs && pushSubs.length > 0) {
          const pushPayload = JSON.stringify({
            title: "📢 New Announcement",
            body: announcementPosts[0].content.length > 100
              ? announcementPosts[0].content.slice(0, 100) + "…"
              : announcementPosts[0].content,
            link: "/feed",
          });

          const staleIds: string[] = [];

          await Promise.allSettled(
            pushSubs.map(async (sub: any) => {
              try {
                const res = await sendWebPush(
                  { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
                  pushPayload,
                  vapidSubject,
                  vapidPublicKey,
                  vapidPrivateKey
                );
                if (res.status === 410 || res.status === 404) {
                  staleIds.push(sub.id);
                }
              } catch (err) {
                console.error("Push send error:", err);
              }
            })
          );

          // Clean up stale subscriptions
          if (staleIds.length > 0) {
            await supabase
              .from("push_subscriptions")
              .delete()
              .in("id", staleIds);
          }
        }
      }
    }

    return new Response(
      JSON.stringify({ published: ids.length }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
