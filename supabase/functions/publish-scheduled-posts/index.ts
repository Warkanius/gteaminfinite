import { createClient } from "https://esm.sh/@supabase/supabase-js@2.97.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Web Push helpers (RFC 8291 / RFC 8188)
async function sendWebPush(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: string,
  vapidSubject: string,
  vapidPublicKey: string,
  vapidPrivateKey: string
): Promise<Response> {
  const pubBytes = base64UrlDecode(vapidPublicKey);
  const privBytes = base64UrlDecode(vapidPrivateKey);

  // Import VAPID private key — wrap raw 32-byte key in PKCS8 structure for P-256
  const pkcs8Header = new Uint8Array([
    0x30, 0x41, 0x02, 0x01, 0x00, 0x30, 0x13, 0x06,
    0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
    0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03,
    0x01, 0x07, 0x04, 0x27, 0x30, 0x25, 0x02, 0x01,
    0x01, 0x04, 0x20,
  ]);
  const pkcs8Key = concatBuffers(pkcs8Header, privBytes);

  const vapidKey = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8Key,
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
    vapidKey,
    new TextEncoder().encode(unsignedToken)
  );

  const rawSig = derToRaw(new Uint8Array(signature));
  const jwt = `${unsignedToken}.${base64UrlEncode(rawSig)}`;

  // Encrypt payload using RFC 8291 (aes128gcm)
  const userPublicKey = base64UrlDecode(subscription.p256dh);
  const userAuth = base64UrlDecode(subscription.auth);

  const localKey = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );
  const localPublicKeyRaw = await crypto.subtle.exportKey("raw", localKey.publicKey);

  const subscriberKey = await crypto.subtle.importKey(
    "raw",
    userPublicKey,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  const sharedSecret = await crypto.subtle.deriveBits(
    { name: "ECDH", public: subscriberKey },
    localKey.privateKey,
    256
  );

  const salt = crypto.getRandomValues(new Uint8Array(16));

  // HKDF per RFC 8291 — extract step uses salt as HMAC key, IKM as data
  const authInfo = concatBuffers(
    new TextEncoder().encode("WebPush: info\0"),
    new Uint8Array(userPublicKey),
    new Uint8Array(localPublicKeyRaw)
  );

  const ikm = await hkdfSha256(new Uint8Array(userAuth), new Uint8Array(sharedSecret), authInfo, 32);
  const contentKey = await hkdfSha256(salt, ikm, new TextEncoder().encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdfSha256(salt, ikm, new TextEncoder().encode("Content-Encoding: nonce\0"), 12);

  const aesKey = await crypto.subtle.importKey("raw", contentKey, "AES-GCM", false, ["encrypt"]);
  const paddedPayload = concatBuffers(new Uint8Array(new TextEncoder().encode(payload)), new Uint8Array([2]));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    aesKey,
    paddedPayload
  );

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
  const raw = new Uint8Array(64);
  let offset = 2;
  const rLen = der[offset + 1];
  offset += 2;
  const rStart = rLen > 32 ? offset + (rLen - 32) : offset;
  const rDest = rLen < 32 ? 32 - rLen : 0;
  raw.set(der.slice(rStart, offset + rLen), rDest);
  offset += rLen;
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
  // HKDF-Extract: PRK = HMAC-SHA256(salt, IKM) — salt is the key, IKM is the data
  const saltKey = await crypto.subtle.importKey(
    "raw",
    salt.length ? salt : new Uint8Array(32),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const prk = new Uint8Array(await crypto.subtle.sign("HMAC", saltKey, ikm));

  // HKDF-Expand: OKM = HMAC-SHA256(PRK, info || 0x01)
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

    const ids = pendingPosts.map((p: any) => p.id);
    const { error: updateErr } = await supabase
      .from("social_posts")
      .update({ is_published: true, posted_at: new Date().toISOString() })
      .in("id", ids);

    if (updateErr) throw updateErr;

    const { data: profiles } = await supabase.from("profiles").select("user_id");

    const announcementPosts = pendingPosts.filter(
      (p: any) => p.post_type === "announcement"
    );

    if (profiles && profiles.length > 0 && announcementPosts.length > 0) {
      const notifications = announcementPosts.flatMap((post: any) =>
        profiles.map((profile: any) => ({
          user_id: profile.user_id,
          title: "New Announcement",
          body: post.content.length > 100 ? post.content.slice(0, 100) + "…" : post.content,
          link: "/feed",
        }))
      );

      for (let i = 0; i < notifications.length; i += 500) {
        const batch = notifications.slice(i, i + 500);
        const { error: notifErr } = await supabase.from("notifications").insert(batch);
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
          console.log(`Sending push to ${pushSubs.length} subscriptions`);
          const pushPayload = JSON.stringify({
            title: "📢 New Announcement",
            body: announcementPosts[0].content.length > 100
              ? announcementPosts[0].content.slice(0, 100) + "…"
              : announcementPosts[0].content,
            link: "/feed",
          });

          const staleIds: string[] = [];

          const results = await Promise.allSettled(
            pushSubs.map(async (sub: any) => {
              try {
                const res = await sendWebPush(
                  { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
                  pushPayload,
                  vapidSubject,
                  vapidPublicKey,
                  vapidPrivateKey
                );
                console.log(`Push to ${sub.endpoint.slice(0, 60)}... status: ${res.status}`);
                if (res.status === 410 || res.status === 404) {
                  staleIds.push(sub.id);
                }
                if (!res.ok) {
                  const body = await res.text();
                  console.error(`Push failed (${res.status}): ${body}`);
                }
              } catch (err) {
                console.error("Push send error:", err);
              }
            })
          );

          console.log(`Push results: ${results.filter(r => r.status === 'fulfilled').length} ok, ${results.filter(r => r.status === 'rejected').length} failed`);

          if (staleIds.length > 0) {
            await supabase.from("push_subscriptions").delete().in("id", staleIds);
          }
        }
      } else {
        console.warn("VAPID keys not configured, skipping push notifications");
      }
    }

    return new Response(
      JSON.stringify({ published: ids.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("publish-scheduled-posts error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
