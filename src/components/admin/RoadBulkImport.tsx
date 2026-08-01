import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, Download, HistoryIcon, Loader2, Undo2, Upload } from "lucide-react";
import { toast } from "sonner";

export interface RoadOption {
  id: string;
  name: string;
}

interface Props {
  roads: RoadOption[];
  onCommitted: () => void;
}

type Plan = {
  road?: { road_id: string | null; road_name: string; import_mode: string };
  road_creates?: unknown[];
  road_updates?: unknown[];
  game_operations?: unknown[];
  destructive_operations?: unknown[];
  warnings?: unknown[];
  verification?: Record<string, unknown> | null;
  operation_id?: string | null;
  preview_token?: string;
};

type AuditRow = {
  id: string;
  operation_type: string;
  scope_label: string | null;
  created_at: string;
  before_snapshot: unknown;
  verification: Record<string, unknown> | null;
};

const NEW_ROAD = "__new";

/**
 * Road-level bulk import / export.
 * Export produces the exact payload `admin_road_bulk` accepts; the dialog then
 * runs the two-step preview -> commit protocol so nothing is written until the
 * admin approves the plan. Committed operations are recorded in
 * `content_audit_log`, and any of them can be rolled back by loading the
 * pre-operation snapshot back into the editor as a replace payload.
 */
export function RoadBulkImport({ roads, onCommitted }: Props) {
  const [open, setOpen] = useState(false);
  const [roadKey, setRoadKey] = useState<string>(NEW_ROAD);
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [newRoadName, setNewRoadName] = useState("");
  const [expectedCount, setExpectedCount] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [result, setResult] = useState<Plan | null>(null);
  const [history, setHistory] = useState<AuditRow[]>([]);
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [restoredFrom, setRestoredFrom] = useState<string | null>(null);

  const selectedRoad = useMemo(() => roads.find((r) => r.id === roadKey) ?? null, [roads, roadKey]);

  const reset = () => {
    setPlan(null);
    setPayload(null);
  };

  const loadHistory = async (roadId: string | null) => {
    if (!roadId) return setHistory([]);
    const { data } = await supabase
      .from("content_audit_log")
      .select("id,operation_type,scope_label,created_at,before_snapshot,verification")
      .eq("content_type", "domination_road")
      .eq("scope_id", roadId)
      .order("created_at", { ascending: false })
      .limit(10);
    setHistory((data ?? []) as AuditRow[]);
  };


  const loadExport = async () => {
    if (!selectedRoad) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("admin_road_export", { p_ref: { road_id: selectedRoad.id } as never });
    setBusy(false);
    if (error) return toast.error(error.message);
    const exported = data as any;
    setText(
      JSON.stringify(
        {
          road_id: exported.road.road_id,
          road_name: exported.road.road_name,
          description: exported.road.description,
          sort_order: exported.road.sort_order,
          is_active: exported.road.is_active,
          games: (exported.games ?? []).map((g: any) => ({
            domination_game_id: g.domination_game_id,
            game_order: g.game_order,
            opponent_name: g.opponent_name,
            opponent_team_id: g.opponent_team_id,
            difficulty_stars: g.difficulty_stars,
            coin_reward: g.coin_reward,
            pack_reward_id: g.pack_reward_id,
            roster: (g.roster ?? []).map((p: any) => ({ player_id: p.player_id })),
          })),
        },
        null,
        2,
      ),
    );
    reset();
    if ((exported.warnings ?? []).length) {
      toast.warning(`${exported.warnings.length} warning(s) on this road — see the JSON warnings after preview.`);
    }
  };

  const buildPayload = () => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text || "{}");
    } catch (e) {
      toast.error(`Invalid JSON: ${(e as Error).message}`);
      return null;
    }
    const body: Record<string, unknown> = { ...parsed, mode };
    if (selectedRoad) {
      body.road_id = selectedRoad.id;
      if (newRoadName.trim() && newRoadName.trim() !== selectedRoad.name) body.new_road_name = newRoadName.trim();
    } else {
      delete body.road_id;
      body.road_name = (parsed.road_name as string) || newRoadName.trim();
      if (!body.road_name) {
        toast.error("Give the new road a name.");
        return null;
      }
      delete body.new_road_name;
    }
    // Safety net: with replace mode the admin can pin the exact number of games
    // the road must end up with. The server rejects the plan and rolls back the
    // commit if the road does not verify to that count.
    delete body.expected_game_count;
    if (mode === "replace" && expectedCount.trim()) {
      const n = Number(expectedCount);
      if (!Number.isInteger(n) || n < 1) {
        toast.error("Expected game count must be a positive whole number.");
        return null;
      }
      body.expected_game_count = n;
    }
    if (restoredFrom) body.restored_from = restoredFrom;
    else delete body.restored_from;
    return body;
  };

  const runPreview = async () => {
    const body = buildPayload();
    if (!body) return;
    setBusy(true);
    setResult(null);
    const { data, error } = await supabase.rpc("admin_road_bulk", {
      p_payload: body as never,
      p_commit: false,
      p_preview_token: undefined,
    });
    setBusy(false);
    if (error) {
      reset();
      return toast.error(error.message);
    }
    setPayload(body);
    setPlan(data as Plan);
  };

  const runCommit = async () => {
    if (!plan?.preview_token || !payload) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("admin_road_bulk", {
      p_payload: payload as never,
      p_commit: true,
      p_preview_token: plan.preview_token,
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    const committed = data as Plan;
    toast.success(`Road "${committed?.road?.road_name ?? ""}" imported`);
    reset();
    setRestoredFrom(null);
    setResult(committed);
    await loadHistory(committed?.road?.road_id ?? selectedRoad?.id ?? null);
    onCommitted();
  };

  // Loads the pre-operation snapshot back into the editor as a replace payload.
  // Nothing is written until the admin previews and applies it again.
  const loadRollback = async (row: AuditRow) => {
    setBusy(true);
    const { data, error } = await supabase.rpc("admin_content_restore_payload", { p_audit_id: row.id });
    setBusy(false);
    if (error) return toast.error(error.message);
    const p = data as any;
    setMode("replace");
    setExpectedCount(String(p.expected_game_count ?? (p.games ?? []).length));
    setRestoredFrom(row.id);
    setText(JSON.stringify({ road_id: p.road_id, road_name: p.road_name, games: p.games }, null, 2));
    reset();
    setResult(null);
    toast.info("Rollback payload loaded — preview it, then apply.");
  };

  const destructive = (plan?.destructive_operations ?? []) as unknown[];
  const verification = (result?.verification ?? null) as Record<string, unknown> | null;


  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Upload className="h-4 w-4 mr-2" /> Bulk Road Import
      </Button>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) reset();
        }}
      >
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Domination Road · Bulk Import / Export</DialogTitle>
            <DialogDescription>
              Export a road, edit the JSON (here or in ChatGPT), then preview and apply. Games are matched by
              <span className="font-mono text-xs"> domination_game_id</span> or
              <span className="font-mono text-xs"> game_order</span>, never by opponent name, so rematches stay separate.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-4">
            <div className="space-y-2">
              <Label>Road</Label>
              <Select
                value={roadKey}
                onValueChange={(v) => {
                  setRoadKey(v);
                  reset();
                  setResult(null);
                  setRestoredFrom(null);
                  const r = roads.find((x) => x.id === v);
                  setNewRoadName(r?.name ?? "");
                  void loadHistory(r?.id ?? null);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NEW_ROAD}>+ New road</SelectItem>
                  {roads.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{selectedRoad ? "Rename to" : "New road name"}</Label>
              <Input value={newRoadName} onChange={(e) => setNewRoadName(e.target.value)} placeholder="Tortuga" />
            </div>
            <div className="space-y-2">
              <Label>Import mode</Label>
              <Select
                value={mode}
                onValueChange={(v) => {
                  setMode(v as "merge" | "replace");
                  reset();
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="merge">Merge — only games in the payload</SelectItem>
                  <SelectItem value="replace">Replace — road matches payload exactly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Expected games</Label>
              <Input
                value={expectedCount}
                onChange={(e) => {
                  setExpectedCount(e.target.value);
                  reset();
                }}
                inputMode="numeric"
                placeholder="11"
                disabled={mode !== "replace"}
              />
              <p className="text-[10px] text-muted-foreground">Replace only — rolls back if the count differs.</p>
            </div>
          </div>


          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={loadExport} disabled={!selectedRoad || busy}>
              <Download className="h-4 w-4 mr-2" /> Load current road JSON
            </Button>
            {text && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  navigator.clipboard.writeText(text);
                  toast.success("JSON copied");
                }}
              >
                Copy JSON
              </Button>
            )}
          </div>

          <Textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              reset();
            }}
            rows={14}
            className="font-mono text-xs"
            placeholder='{"road_name":"Tortuga","games":[{"game_order":1,"opponent_name":"Lockport","difficulty_stars":1,"coin_reward":750,"roster":[{"player_id":"..."}]}]}'
          />

          {plan && (
            <div className="rounded-md border p-3 space-y-2 max-h-56 overflow-y-auto">
              <div className="flex flex-wrap gap-2 items-center">
                <Badge variant="secondary">{(plan.road_creates ?? []).length} road created</Badge>
                <Badge variant="secondary">{(plan.road_updates ?? []).length} road updated</Badge>
                <Badge variant="secondary">{(plan.game_operations ?? []).length} game ops</Badge>
                <Badge variant={destructive.length ? "destructive" : "secondary"}>
                  {destructive.length} destructive
                </Badge>
                <Badge variant="secondary">{(plan.warnings ?? []).length} warnings</Badge>
              </div>
              {destructive.length > 0 && (
                <p className="text-xs text-destructive flex items-start gap-1">
                  <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                  These rows will be deleted or replaced. Review carefully before applying.
                </p>
              )}
              <pre className="text-[10px] leading-snug whitespace-pre-wrap text-muted-foreground">
                {JSON.stringify(
                  {
                    road_creates: plan.road_creates,
                    road_updates: plan.road_updates,
                    game_operations: plan.game_operations,
                    destructive_operations: plan.destructive_operations,
                    warnings: plan.warnings,
                  },
                  null,
                  2,
                )}
              </pre>
            </div>
          )}

          {verification && (
            <div className="rounded-md border border-primary/40 p-3 space-y-2">
              <p className="text-xs font-semibold flex items-center gap-1">
                <CheckCircle2 className="h-3.5 w-3.5 text-primary" /> Applied &amp; verified
              </p>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">{String(verification.game_count)} games</Badge>
                <Badge variant="secondary">{String(verification.total_coin_reward)} coins total</Badge>
                <Badge variant={verification.contiguous_orders ? "secondary" : "destructive"}>
                  {verification.contiguous_orders ? "orders contiguous" : "order gaps"}
                </Badge>
                <Badge variant={Number(verification.games_with_empty_roster) ? "destructive" : "secondary"}>
                  {String(verification.games_with_empty_roster)} empty rosters
                </Badge>
                <Badge variant="secondary">other roads untouched</Badge>
              </div>
              <p className="text-[10px] text-muted-foreground font-mono">
                orders: {JSON.stringify(verification.game_orders)}
              </p>
            </div>
          )}

          {history.length > 0 && (
            <div className="rounded-md border p-3 space-y-2">
              <p className="text-xs font-semibold flex items-center gap-1">
                <History className="h-3.5 w-3.5" /> Operation history
              </p>
              <div className="space-y-1">
                {history.map((h) => (
                  <div key={h.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate">
                      <span className="uppercase font-mono">{h.operation_type}</span> ·{" "}
                      {new Date(h.created_at).toLocaleString()} ·{" "}
                      {String((h.verification as any)?.game_count ?? "?")} games
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy || !h.before_snapshot}
                      onClick={() => loadRollback(h)}
                    >
                      <Undo2 className="h-3 w-3 mr-1" /> Roll back to before
                    </Button>
                  </div>
                ))}
              </div>
              {restoredFrom && (
                <p className="text-[10px] text-muted-foreground">
                  Rollback payload loaded from operation {restoredFrom.slice(0, 8)} — preview, then apply.
                </p>
              )}
            </div>
          )}


          <DialogFooter>
            <Button variant="outline" onClick={runPreview} disabled={busy || !text.trim()}>
              {busy && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Preview
            </Button>
            <Button onClick={runCommit} disabled={busy || !plan?.preview_token}>
              Apply {mode === "replace" ? "(replace road)" : "(merge)"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
