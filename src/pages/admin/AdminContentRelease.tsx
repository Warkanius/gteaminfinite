import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
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
import EvoRunsAuditPanel from "@/components/admin/EvoRunsAuditPanel";

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

type PreviewRecord = {
  preview_id: string;
  payload_hash: string;
  status: string;
  expires_at: string;
  summary?: Record<string, any>;
  creates?: any[];
  updates?: any[];
  replacements?: any[];
  deletes?: any[];
  warnings?: any[];
  destructive_operations?: any[];
  commit_result?: Record<string, any> | null;
  verification_result?: Record<string, any> | null;
};

export default function AdminContentRelease() {
  const [text, setText] = useState(() => JSON.stringify(SAMPLE, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);
  const [tierOrder, setTierOrder] = useState<string[]>([]);
  const [preview, setPreview] = useState<PreviewRecord | null>(null);
  const [hashConfirm, setHashConfirm] = useState("");
  const [lookupId, setLookupId] = useState("");
  const [commit, setCommit] = useState<Record<string, any> | null>(null);
  const [busy, setBusy] = useState<"preview" | "commit" | "load" | "cancel" | null>(null);

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
  const hashMatches = !!preview && hashConfirm.trim() === preview.payload_hash;
  const expired = !!preview && new Date(preview.expires_at).getTime() < Date.now();

  async function runPreview() {
    if (!prepared?.valid) return;
    setBusy("preview");
    try {
      const { data, error } = await supabase.rpc("admin_apply_batch", {
        p_payload: prepared.payload as never,
        p_commit: false,
        p_preview_token: null,
        p_kind: "content_release",
      });
      if (error) throw error;
      const plan = data as Record<string, any>;
      const { data: stored, error: storeErr } = await supabase.rpc("content_release_preview_store", {
        p_payload_hash: plan.payload_hash,
        p_canonical_payload: (plan.normalized_payload ?? prepared.payload) as never,
        p_preview_token: plan.preview_token ?? null,
        p_summary: {
          release_name: (parsed as any)?.release?.name ?? null,
          release_status: (parsed as any)?.release?.status ?? "draft",
          item_count: plan.item_count ?? 0,
        } as never,
        p_plan: {
          creates: plan.creates ?? [],
          updates: plan.updates ?? [],
          replacements: plan.replacements ?? [],
          deletes: plan.deletes ?? [],
          warnings: plan.warnings ?? [],
          destructive_operations: plan.replacements ?? [],
          resolved_references: plan.resolved_references ?? [],
          results: plan.results ?? [],
        } as never,
        p_ttl_minutes: 30,
      });
      if (storeErr) throw storeErr;
      setPreview(stored as unknown as PreviewRecord);
      setHashConfirm("");
      setCommit(null);
      toast({ title: "Preview stored", description: "Nothing was written. Confirm the payload hash to publish." });
    } catch (e) {
      toast({ title: "Preview failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  async function loadPreview() {
    if (!lookupId.trim()) return;
    setBusy("load");
    try {
      const { data, error } = await supabase.rpc("content_release_preview_get", { p_preview_id: lookupId.trim() });
      if (error) throw error;
      const record = data as unknown as PreviewRecord;
      setPreview(record);
      setHashConfirm("");
      setCommit(record.commit_result ?? null);
      toast({ title: `Preview ${record.status}`, description: `Hash ${record.payload_hash}` });
    } catch (e) {
      toast({ title: "Could not load preview", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  async function cancelPreview() {
    if (!preview) return;
    setBusy("cancel");
    try {
      const { data, error } = await supabase.rpc("content_release_preview_cancel", { p_preview_id: preview.preview_id });
      if (error) throw error;
      setPreview(data as unknown as PreviewRecord);
      toast({ title: "Preview cancelled", description: "It can no longer be committed." });
    } catch (e) {
      toast({ title: "Cancel failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  // Commits ONLY by stored preview_id + approved hash: no re-preview, no
  // re-normalization, no rebuilt request body, no fresh token.
  async function publish() {
    if (!preview || !hashMatches) return;
    setBusy("commit");
    try {
      const { data, error } = await supabase.rpc("content_release_preview_commit", {
        p_preview_id: preview.preview_id,
        p_approved_payload_hash: preview.payload_hash,
        p_idempotency_key: `ui:${preview.preview_id}`,
      });
      if (error) throw error;
      const record = data as unknown as PreviewRecord & { idempotent_replay?: boolean };
      setPreview(record);
      setCommit(record.commit_result ?? null);
      toast({
        title: record.idempotent_replay ? "Already committed" : "Release published",
        description: "Committed in one transaction and verified by immutable id.",
      });
    } catch (e) {
      toast({ title: "Publish failed", description: (e as Error).message, variant: "destructive" });
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
                setPreview(null);
                setHashConfirm("");
                setCommit(null);
              }}
              className="min-h-[360px] font-mono text-xs"
              spellCheck={false}
            />
            {parseError && <p className="text-xs text-destructive">Invalid JSON: {parseError}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={runPreview} disabled={!prepared?.valid || busy !== null}>
                {busy === "preview" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                Preview (zero writes)
              </Button>
              {oddsTotal && (
                <Badge variant={oddsTotal === "100.00" ? "secondary" : "destructive"}>Odds {oddsTotal}%</Badge>
              )}
            </div>

            <div className="space-y-2 rounded-md border border-border/60 p-3">
              <Label className="text-xs text-muted-foreground">Resume a stored preview by ID</Label>
              <div className="flex flex-wrap gap-2">
                <Input
                  value={lookupId}
                  onChange={(e) => setLookupId(e.target.value)}
                  placeholder="preview_id"
                  className="max-w-[320px] font-mono text-xs"
                />
                <Button variant="outline" size="sm" onClick={loadPreview} disabled={busy !== null || !lookupId.trim()}>
                  {busy === "load" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Load preview
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Validation &amp; plan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {preview && (
              <div className="space-y-3 rounded-md border border-border/60 p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant="outline" className="font-mono text-[10px]">{preview.status}</Badge>
                  <span className="font-mono">{preview.preview_id}</span>
                  <span className="text-muted-foreground">
                    {preview.summary?.release_name ? `${preview.summary.release_name} · ` : ""}
                    expires {new Date(preview.expires_at).toLocaleString()}
                  </span>
                </div>
                <p className="font-mono text-[11px] break-all">hash {preview.payload_hash}</p>
                {expired && preview.status === "pending" && (
                  <p className="text-xs text-destructive">This preview expired. Run a new preview and approve it again.</p>
                )}
                {preview.status === "pending" && !expired && (
                  <>
                    <Label className="text-xs text-muted-foreground">
                      Type the payload hash above to confirm you approve exactly this plan.
                    </Label>
                    <Input
                      value={hashConfirm}
                      onChange={(e) => setHashConfirm(e.target.value)}
                      placeholder="paste payload hash"
                      className="font-mono text-xs"
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={publish} disabled={!hashMatches || busy !== null}>
                        {busy === "commit" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Rocket className="mr-2 h-4 w-4" />}
                        Publish this preview
                      </Button>
                      <Button variant="outline" onClick={cancelPreview} disabled={busy !== null}>
                        {busy === "cancel" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Cancel preview
                      </Button>
                    </div>
                  </>
                )}
                {preview.verification_result && (
                  <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2 font-mono text-[10px]">
                    {JSON.stringify(preview.verification_result, null, 2)}
                  </pre>
                )}
              </div>
            )}

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
                {!preview ? (
                  <p className="text-sm text-muted-foreground">Run a preview to see creates, updates and replacements.</p>
                ) : (
                  <ScrollArea className="h-[420px]">
                    <div className="space-y-3 pr-3">
                      <PlanSection title="Creates" rows={preview.creates} />
                      <PlanSection title="Updates" rows={preview.updates} />
                      <PlanSection title="Destructive replacements" rows={preview.destructive_operations ?? preview.replacements} destructive />
                      <PlanSection title="Deletes" rows={preview.deletes} destructive />
                      {!!preview.warnings?.length && (
                        <pre className="whitespace-pre-wrap rounded bg-muted/40 p-2 font-mono text-[10px]">
                          {JSON.stringify(preview.warnings, null, 2)}
                        </pre>
                      )}
                      {commit && (
                        <pre className="max-h-52 overflow-auto whitespace-pre-wrap rounded bg-muted/40 p-2 font-mono text-[10px]">
                          {JSON.stringify(commit.created_ids ?? commit, null, 2)}
                        </pre>
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

      <EvoRunsAuditPanel />
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
