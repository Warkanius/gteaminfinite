import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "@/hooks/use-toast";
import { Loader2, ShieldCheck, TriangleAlert, Rocket } from "lucide-react";
import {
  prepareRelease,
  formatHundredths,
  oddsTotalHundredths,
  type ContentReleaseInput,
  type ValidationResult,
} from "@/lib/contentRelease";

// Deliberately uses raw import spellings ("Hall of Fame", "3PT") to show normalization.
const SAMPLE = {
  release: { name: "Galactic", status: "draft", description: "11 pack cards + collection reward" },
  collection: { name: "Galactic", reward_player_name: "Galactic Reward Card" },
  players: [
    {
      name: "Galactic Card 1",
      gem_tier: "Emerald",
      rating: 88,
      position1: "PG",
      stats: { stat_3pt: 88, stat_ast: 85, stat_stl: 80 },
      badges: [{ badge: "Deadeye", tier: "Hall of Fame" }],
      traits: [{ trait: "Sniper", target_stat: "3PT" }],
    },
    { name: "Galactic Reward Card", gem_tier: "Diamond", rating: 95, is_collection_reward: true, stats: { stat_3pt: 95 } },
  ],
  pack: {
    name: "Galactic Pack",
    cost: 5000,
    players: [{ player_name: "Galactic Card 1", slot: 1 }],
    odds: [{ result_slot: "1", percentage: 100 }],
  },
  evo_paths: [
    {
      player_name: "Galactic Card 1",
      steps: [
        {
          from_tier: "Emerald",
          to_tier: "Diamond",
          step_order: 1,
          objectives: [{ stat: "points", amount: 250 }],
          resulting_version: { rating: 92, stats: { stat_3pt: 93, stat_ast: 88 }, badges: [{ badge: "Deadeye", tier: "hof" }] },
        },
      ],
    },
  ],
} as unknown as ContentReleaseInput;

type PreviewPlan = Record<string, any> | null;

export default function AdminContentRelease() {
  const [text, setText] = useState(() => JSON.stringify(SAMPLE, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);
  const [tierOrder, setTierOrder] = useState<string[]>([]);
  const [plan, setPlan] = useState<PreviewPlan>(null);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);

  useEffect(() => {
    supabase
      .from("gem_tiers")
      .select("name, sort_order")
      .order("sort_order", { ascending: true })
      .then(({ data }) => setTierOrder((data ?? []).map((t: any) => t.name)));
  }, []);

  const parsed = useMemo(() => {
    try {
      const value = JSON.parse(text) as ContentReleaseInput;
      setParseError(null);
      return value;
    } catch (e) {
      setParseError((e as Error).message);
      return null;
    }
  }, [text]);

  const prepared = useMemo(
    () => (parsed ? prepareRelease(parsed, { tierOrder }) : null),
    [parsed, tierOrder],
  );

  const errors = (prepared?.validations ?? []).filter((v) => v.severity === "error");
  const warnings = (prepared?.validations ?? []).filter((v) => v.severity !== "error");
  const oddsTotal = parsed?.pack?.odds ? formatHundredths(oddsTotalHundredths(parsed.pack.odds)) : null;

  async function runBatch(mode: "preview" | "commit") {
    if (!prepared?.valid) return;
    setBusy(mode);
    try {
      const { data, error } = await supabase.rpc("admin_apply_batch", {
        p_payload: prepared.payload as never,
        p_commit: mode === "commit",
        p_preview_token: mode === "commit" ? token : null,
        p_kind: "content_release",
      });
      if (error) throw error;
      const result = data as Record<string, any>;
      setPlan(result);
      if (mode === "preview") {
        setToken(result?.preview_token ?? null);
        toast({ title: "Preview ready", description: "Nothing was written. Review the plan, then publish." });
      } else {
        setToken(null);
        toast({ title: "Release published", description: "Committed in one transaction." });
      }
    } catch (e) {
      toast({ title: `${mode === "preview" ? "Preview" : "Publish"} failed`, description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="space-y-1">
        <h1 className="font-heading text-2xl md:text-3xl">Content Release Publisher</h1>
        <p className="text-sm text-muted-foreground">
          Preview and publish a complete release — cards, collection, reward, team, pack odds and every evo card version — as one atomic transaction.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">Release document</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setText(JSON.stringify(SAMPLE, null, 2))}>
              Load sample
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <Label className="text-xs text-muted-foreground">
              Paste the JSON produced by ChatGPT or the MCP connector.
            </Label>
            <Textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setPlan(null);
                setToken(null);
              }}
              className="min-h-[420px] font-mono text-xs"
              spellCheck={false}
            />
            {parseError && <p className="text-xs text-destructive">Invalid JSON: {parseError}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => runBatch("preview")} disabled={!prepared?.valid || busy !== null}>
                {busy === "preview" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                Preview (zero writes)
              </Button>
              <Button
                variant="default"
                onClick={() => runBatch("commit")}
                disabled={!token || busy !== null}
              >
                {busy === "commit" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Rocket className="mr-2 h-4 w-4" />}
                Publish release
              </Button>
              {oddsTotal && (
                <Badge variant={oddsTotal === "100.00" ? "secondary" : "destructive"}>Odds {oddsTotal}%</Badge>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Validation &amp; plan</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="validation">
              <TabsList>
                <TabsTrigger value="validation">
                  Validation {errors.length ? `(${errors.length})` : ""}
                </TabsTrigger>
                <TabsTrigger value="plan">Plan</TabsTrigger>
                <TabsTrigger value="payload">Payload</TabsTrigger>
              </TabsList>

              <TabsContent value="validation" className="space-y-2">
                {!errors.length && !warnings.length && (
                  <p className="text-sm text-muted-foreground">No issues found. Ready to preview.</p>
                )}
                {[...errors, ...warnings].map((issue, i) => (
                  <IssueRow key={i} issue={issue} />
                ))}
              </TabsContent>

              <TabsContent value="plan">
                {!plan ? (
                  <p className="text-sm text-muted-foreground">Run a preview to see creates, updates and replacements.</p>
                ) : (
                  <ScrollArea className="h-[420px]">
                    <div className="space-y-3 pr-3">
                      <PlanSection title="Creates" rows={plan.creates} />
                      <PlanSection title="Updates" rows={plan.updates} />
                      <PlanSection title="Destructive replacements" rows={plan.replacements} destructive />
                      <PlanSection title="Deletes" rows={plan.deletes} destructive />
                      {plan.payload_hash && (
                        <p className="font-mono text-[11px] text-muted-foreground">hash {plan.payload_hash}</p>
                      )}
                    </div>
                  </ScrollArea>
                )}
              </TabsContent>

              <TabsContent value="payload">
                <ScrollArea className="h-[420px]">
                  <pre className="whitespace-pre-wrap font-mono text-[11px] text-muted-foreground">
                    {JSON.stringify(prepared?.payload ?? {}, null, 2)}
                  </pre>
                </ScrollArea>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function IssueRow({ issue }: { issue: ValidationResult }) {
  const isError = issue.severity === "error";
  return (
    <div className="flex items-start gap-2 rounded-md border border-border/60 p-2 text-sm">
      <TriangleAlert className={`mt-0.5 h-4 w-4 shrink-0 ${isError ? "text-destructive" : "text-primary"}`} />
      <div className="space-y-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={isError ? "destructive" : "secondary"} className="font-mono text-[10px]">
            {issue.code}
          </Badge>
          {issue.entity && <span className="font-mono text-[11px] text-muted-foreground">{issue.entity}</span>}
        </div>
        <p>{issue.message}</p>
      </div>
    </div>
  );
}

function PlanSection({ title, rows, destructive }: { title: string; rows?: any[]; destructive?: boolean }) {
  if (!rows?.length) return null;
  return (
    <div className="space-y-1">
      <h3 className={`text-xs uppercase tracking-wide ${destructive ? "text-destructive" : "text-muted-foreground"}`}>
        {title} ({rows.length})
      </h3>
      {rows.map((row, i) => (
        <div key={i} className="rounded-md border border-border/60 p-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="font-mono text-[10px]">{row.table ?? row.group}</Badge>
            <span>{row.match ?? row.label}</span>
          </div>
          {row.message && <p className="mt-1 text-muted-foreground">{row.message}</p>}
        </div>
      ))}
    </div>
  );
}
