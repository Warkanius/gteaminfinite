// OAuth bridge for ChatGPT Custom GPT Actions.
// ChatGPT's Actions OAuth client does not send PKCE, but Supabase's OAuth 2.1
// server requires code_challenge/code_verifier. This function injects PKCE on
// behalf of the client and proxies the token exchange.

const AUTH_BASE = "https://tgcmhmcgxzabimgnzsiu.supabase.co/auth/v1";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SELF = `${SUPABASE_URL.replace(".supabase.co", ".supabase.co")}/functions/v1/gpt-oauth`;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function base64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function challengeFor(verifier: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

async function db(path: string, init: RequestInit) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(init.headers ?? {}),
    },
  });
  return res;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const url = new URL(req.url);
  const route = url.pathname.replace(/^.*\/gpt-oauth/, "") || "/";

  // ---------------------------------------------------------------- authorize
  if (route === "/authorize") {
    const clientRedirect = url.searchParams.get("redirect_uri");
    const state = url.searchParams.get("state") ?? crypto.randomUUID();
    const clientId = url.searchParams.get("client_id");
    const scope = url.searchParams.get("scope") ?? "openid email profile";
    if (!clientRedirect || !clientId) {
      return new Response("Missing client_id or redirect_uri", { status: 400, headers: cors });
    }

    const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
    const challenge = await challengeFor(verifier);

    const insert = await db("oauth_bridge_sessions", {
      method: "POST",
      body: JSON.stringify({ state, code_verifier: verifier, client_redirect_uri: clientRedirect }),
    });
    if (!insert.ok) {
      return new Response(`Bridge storage error: ${await insert.text()}`, { status: 500, headers: cors });
    }

    const target = new URL(`${AUTH_BASE}/oauth/authorize`);
    target.searchParams.set("response_type", "code");
    target.searchParams.set("client_id", clientId);
    target.searchParams.set("redirect_uri", `${SELF}/callback`);
    target.searchParams.set("scope", scope);
    target.searchParams.set("state", state);
    target.searchParams.set("code_challenge", challenge);
    target.searchParams.set("code_challenge_method", "S256");

    return new Response(null, { status: 302, headers: { ...cors, Location: target.toString() } });
  }

  // ----------------------------------------------------------------- callback
  if (route === "/callback") {
    const state = url.searchParams.get("state") ?? "";
    const code = url.searchParams.get("code");
    const error = url.searchParams.get("error");

    const lookup = await db(
      `oauth_bridge_sessions?state=eq.${encodeURIComponent(state)}&select=client_redirect_uri`,
      { method: "GET" },
    );
    const rows = lookup.ok ? await lookup.json() : [];
    const clientRedirect = rows?.[0]?.client_redirect_uri;
    if (!clientRedirect) {
      return new Response("Unknown or expired authorization state", { status: 400, headers: cors });
    }

    const back = new URL(clientRedirect);
    back.searchParams.set("state", state);
    if (error) {
      back.searchParams.set("error", error);
      const desc = url.searchParams.get("error_description");
      if (desc) back.searchParams.set("error_description", desc);
    } else if (code) {
      back.searchParams.set("code", code);
      await db(`oauth_bridge_sessions?state=eq.${encodeURIComponent(state)}`, {
        method: "PATCH",
        body: JSON.stringify({ auth_code: code }),
      });
    } else {
      back.searchParams.set("error", "invalid_request");
    }

    return new Response(null, { status: 302, headers: { ...cors, Location: back.toString() } });
  }

  // -------------------------------------------------------------------- token
  if (route === "/token" && req.method === "POST") {
    const raw = await req.text();
    const contentType = req.headers.get("content-type") ?? "";
    const params = new URLSearchParams();
    if (contentType.includes("application/json")) {
      const parsed = JSON.parse(raw || "{}") as Record<string, string>;
      for (const [k, v] of Object.entries(parsed)) if (v != null) params.set(k, String(v));
    } else {
      for (const [k, v] of new URLSearchParams(raw)) params.set(k, v);
    }

    // Basic auth clients: move credentials into the body (client_secret_post).
    const authz = req.headers.get("authorization");
    if (authz?.toLowerCase().startsWith("basic ")) {
      const [id, secret] = atob(authz.slice(6)).split(":");
      if (id) params.set("client_id", id);
      if (secret) params.set("client_secret", secret);
    }

    if (params.get("grant_type") === "authorization_code") {
      const code = params.get("code") ?? "";
      const lookup = await db(
        `oauth_bridge_sessions?auth_code=eq.${encodeURIComponent(code)}&select=code_verifier`,
        { method: "GET" },
      );
      const rows = lookup.ok ? await lookup.json() : [];
      const verifier = rows?.[0]?.code_verifier;
      if (!verifier) {
        return new Response(
          JSON.stringify({ error: "invalid_grant", error_description: "Unknown authorization code" }),
          { status: 400, headers: { ...cors, "Content-Type": "application/json" } },
        );
      }
      params.set("code_verifier", verifier);
      params.set("redirect_uri", `${SELF}/callback`);
    }

    const res = await fetch(`${AUTH_BASE}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", apikey: SERVICE_KEY },
      body: params.toString(),
    });
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: { ...cors, "Content-Type": res.headers.get("content-type") ?? "application/json" },
    });
  }

  return new Response("Not found", { status: 404, headers: cors });
});
