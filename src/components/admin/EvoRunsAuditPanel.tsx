import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "@/hooks/use-toast";
import { Loader2, Activity, Wrench } from "lucide-react";

type Issue = { code: string; field?: string; value?: number; expected_band?: number[]; expected?: number; base?: number };
type Flagged = {
  evo_card_version_id: string;
  player_name?: string | null;
  version_order?: number | null;
  gem_name?: string | null;
  issues: Issue[];
};
type Audit = { checked: number; flagged: number; versions: Flagged[] };

/**
 * Runs data quality for evo card versions. Every version is a complete playable
 * card, so its Runs stats must sit on the Runs point scale (20 points per star)
 * and run_rating must be their mean.
 */
export default function EvoRunsAuditPanel() {
  const [audit, setAudit] = useState<Audit | null>(null);
  const [plan, setPlan] = useState<Record<string, any> | null>(null);
  const [busy, setBusy] = useState<"audit" | "preview" | "commit" | null>(null);

  async function run(kind: "audit" | "preview" | "commit") {
    setBusy(kind);
    try {
      if (kind === "audit") {
        const { data, error } = await supabase.rpc("admin_evo_version_audit");
        if (error) throw error;
        setAudit(data as unknown as Audit);
        setPlan(null);
      } else {
        const { data, error } = await supabase.rpc("admin_repair_evo_version_runs", {
          p_commit: kind === "commit",
          p_version_id: null,
        });
        if (error) throw error;
        setPlan(data as Record<string, any>);
        if (kind === "commit") {
          const { data: fresh } = await supabase.rpc("admin_evo_version_audit");
          setAudit(fresh as unknown as Audit);
          toast({ title: "Runs data repaired", description: "Versions re-derived on the Runs point scale." });
        }
      }
    } catch (e) {
      toast({ title: "Runs audit failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Evo version Runs data</CardTitle>
        {audit && (
          <Badge variant={audit.flagged ? "destructive" : "secondary"}>
            {audit.flagged}/{audit.checked} flagged
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Runs stats use their own point scale — every star of a base stat is worth 20 points (star 1 = 20-39, star 2 = 40-59,
          … star 6 = 120-139) and run_rating is the mean of the nine Runs stats.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => run("audit")} disabled={busy !== null}>
            {busy === "audit" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Activity className="mr-2 h-4 w-4" />}
            Audit versions
          </Button>
          <Button size="sm" variant="outline" onClick={() => run("preview")} disabled={busy !== null}>
            {busy === "preview" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Preview repair
          </Button>
          <Button size="sm" onClick={() => run("commit")} disabled={busy !== null || !plan}>
            {busy === "commit" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wrench className="mr-2 h-4 w-4" />}
            Repair Runs data
          </Button>
        </div>

        {audit && !audit.flagged && <p className="text-sm text-muted-foreground">Every evo version has valid Runs data.</p>}

        {!!audit?.versions?.length && (
          <ScrollArea className="h-[240px]">
            <div className="space-y-2 pr-3">
              {audit.versions.map((v) => (
                <div key={v.evo_card_version_id} className="rounded-md border border-border/60 p-2 text-xs">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{v.player_name ?? "Unknown card"}</span>
                    <Badge variant="outline" className="font-mono text-[10px]">
                      v{v.version_order ?? "?"} · {v.gem_name ?? "—"}
                    </Badge>
                  </div>
                  <ul className="mt-1 space-y-0.5 text-muted-foreground">
                    {v.issues.map((issue, i) => (
                      <li key={i} className="font-mono text-[10px]">
                        {issue.code}
                        {issue.field ? ` ${issue.field}` : ""}
                        {issue.value !== undefined ? ` = ${issue.value}` : ""}
                        {issue.expected_band ? ` (expected ${issue.expected_band[0]}-${issue.expected_band[1]})` : ""}
                        {issue.expected !== undefined ? ` (expected ${issue.expected})` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        {plan && (
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2 font-mono text-[10px]">
            {JSON.stringify(plan, null, 2)}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}
