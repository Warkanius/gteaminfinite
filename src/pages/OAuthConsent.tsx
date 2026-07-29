import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldCheck } from "lucide-react";

type OAuthApi = {
  getAuthorizationDetails: (id: string) => Promise<{ data: any; error: any }>;
  approveAuthorization: (id: string) => Promise<{ data: any; error: any }>;
  denyAuthorization: (id: string) => Promise<{ data: any; error: any }>;
};

const oauth = () => (supabase.auth as unknown as { oauth: OAuthApi }).oauth;

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!authorizationId) {
        setError("Missing authorization_id.");
        return;
      }
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        const next = window.location.pathname + window.location.search;
        window.location.href = `/auth?next=${encodeURIComponent(next)}`;
        return;
      }
      setEmail(sess.session.user.email ?? null);
      try {
        const { data, error: err } = await oauth().getAuthorizationDetails(authorizationId);
        if (!active) return;
        if (err) {
          setError(err.message);
          return;
        }
        const immediate = data?.redirect_url ?? data?.redirect_to;
        if (immediate && !data?.client) {
          window.location.href = immediate;
          return;
        }
        setDetails(data);
      } catch (e: any) {
        if (active) setError(e?.message ?? "Could not load this authorization request.");
      }
    })();
    return () => {
      active = false;
    };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    setBusy(true);
    try {
      const { data, error: err } = approve
        ? await oauth().approveAuthorization(authorizationId)
        : await oauth().denyAuthorization(authorizationId);
      if (err) {
        setError(err.message);
        return;
      }
      const target = data?.redirect_url ?? data?.redirect_to;
      if (!target) {
        setError("No redirect returned by the authorization server.");
        return;
      }
      window.location.href = target;
    } finally {
      setBusy(false);
    }
  }

  const clientName = details?.client?.name ?? details?.client?.client_name ?? "this app";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md border-border/50">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2 text-xl">
            <ShieldCheck className="h-5 w-5 text-primary" />
            {error ? "Authorization problem" : details ? `Connect ${clientName}` : "Loading…"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <p className="text-sm text-destructive">{error}</p>}
          {!error && !details && (
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          )}
          {!error && details && (
            <>
              <p className="text-sm text-muted-foreground">
                This lets <span className="text-foreground">{clientName}</span> use GTeam Infinite as you.
              </p>
              {email && (
                <p className="text-xs text-muted-foreground">
                  Signed in as <span className="text-foreground">{email}</span>
                </p>
              )}
              {details?.client?.redirect_uri && (
                <p className="break-all text-xs text-muted-foreground">
                  Redirects to {details.client.redirect_uri}
                </p>
              )}
              <ul className="space-y-1 text-xs text-muted-foreground">
                <li>· Share your basic profile and email address</li>
                <li>· Read and edit game content the tools expose</li>
              </ul>
              <p className="text-xs text-muted-foreground">
                This does not bypass this app's permissions — admin-only tools still require an admin account.
              </p>
              <div className="flex gap-2 pt-2">
                <Button className="flex-1" disabled={busy} onClick={() => decide(true)}>
                  Approve
                </Button>
                <Button variant="outline" className="flex-1" disabled={busy} onClick={() => decide(false)}>
                  Cancel connection
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
