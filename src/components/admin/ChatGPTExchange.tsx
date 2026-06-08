import { useState, useEffect, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ImportPreviewTable, PreviewRow } from "@/components/admin/ImportPreviewTable";
import { Bot, Copy, Download, Sparkles, CheckCircle2, AlertCircle, Plus, Pencil } from "lucide-react";
import { toast } from "sonner";
import { loadImportContext, type ImportContext } from "@/lib/chatgptSchemas";
import type { z, ZodSchema } from "zod";

export interface ExchangeMode<S extends ZodSchema> {
  schema: S;
  buildPrompt: (ctx: ImportContext, brief: string) => string;
  toPreviewRows: (parsed: z.infer<S>, ctx: ImportContext) => PreviewRow[];
  /** Returns count of rows affected. */
  commit: (selected: z.infer<S>, ctx: ImportContext) => Promise<number>;
}

export interface ExchangeEntity<S extends ZodSchema, U extends ZodSchema = S> extends ExchangeMode<S> {
  exportData?: () => Promise<unknown>;
  /** Optional update mode (PATCH existing rows by natural key). */
  update?: ExchangeMode<U>;
}

interface Props<S extends ZodSchema> {
  title: string;
  entity: ExchangeEntity<S, any>;
  onCommitted?: () => void;
  triggerLabel?: string;
  triggerVariant?: "default" | "outline" | "secondary";
}

type Mode = "create" | "update";

export function ChatGPTExchange<S extends ZodSchema>({ title, entity, onCommitted, triggerLabel = "AI Import / Export", triggerVariant = "outline" }: Props<S>) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("create");
  const [ctx, setCtx] = useState<ImportContext | null>(null);
  const [brief, setBrief] = useState("");
  const [pasted, setPasted] = useState("");
  const [parsed, setParsed] = useState<any>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [committing, setCommitting] = useState(false);
  const [exportJson, setExportJson] = useState<string>("");

  const active: ExchangeMode<any> = mode === "update" && entity.update ? entity.update : entity;
  const hasUpdate = !!entity.update;

  useEffect(() => {
    if (open && !ctx) loadImportContext().then(setCtx).catch((e) => toast.error(e.message));
  }, [open, ctx]);

  // Reset paste state when switching mode
  useEffect(() => {
    setPasted(""); setParsed(null); setParseError(null); setSelected(new Set());
  }, [mode]);

  const prompt = useMemo(() => (ctx ? active.buildPrompt(ctx, brief.trim()) : ""), [ctx, brief, active]);

  const previewRows: PreviewRow[] = useMemo(() => {
    if (!parsed || !ctx) return [];
    try { return active.toPreviewRows(parsed, ctx); } catch { return []; }
  }, [parsed, ctx, active]);

  function defaultSelectable(rows: PreviewRow[]) {
    if (mode === "update") {
      // Auto-select rows that matched an existing record
      return rows.filter((r) => (r.status ?? (r.collides ? "exists" : "new")) === "exists").map((r) => r.key);
    }
    return rows.filter((r) => !r.collides).map((r) => r.key);
  }

  function handleValidate() {
    setParseError(null);
    setParsed(null);
    try {
      const raw = pasted.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
      const json = JSON.parse(raw);
      const result = active.schema.safeParse(json);
      if (!result.success) {
        setParseError(result.error.issues.slice(0, 4).map((i) => `${i.path.join(".")}: ${i.message}`).join("\n"));
        return;
      }
      setParsed(result.data);
      const rows = active.toPreviewRows(result.data, ctx!);
      setSelected(new Set(defaultSelectable(rows)));
    } catch (e: any) {
      setParseError(`Invalid JSON: ${e.message}`);
    }
  }

  async function handleCommit() {
    if (!parsed || !ctx) return;
    setCommitting(true);
    try {
      const rows = active.toPreviewRows(parsed, ctx);
      const selectedRows = Array.isArray(parsed)
        ? parsed.filter((_: any, idx: number) => selected.has(rows[idx]?.key))
        : parsed;
      const count = await active.commit(selectedRows as any, ctx);
      toast.success(mode === "update" ? `Updated ${count} row${count === 1 ? "" : "s"}` : `Created ${count} item${count === 1 ? "" : "s"}`);
      setOpen(false); setPasted(""); setParsed(null); setSelected(new Set()); setBrief("");
      onCommitted?.();
    } catch (e: any) {
      toast.error(e.message ?? "Commit failed");
    } finally {
      setCommitting(false);
    }
  }

  async function handleLoadExport() {
    if (!entity.exportData) return;
    try {
      const data = await entity.exportData();
      setExportJson(JSON.stringify(data, null, 2));
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  const commitLabel = committing
    ? (mode === "update" ? "Updating…" : "Creating…")
    : (mode === "update" ? `Update ${selected.size} row${selected.size === 1 ? "" : "s"}` : `Create ${selected.size} item${selected.size === 1 ? "" : "s"}`);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant} size="sm">
          <Bot className="w-4 h-4 mr-2" />{triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" /> {title}</DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Create new rows. Existing names are flagged and excluded by default."
              : "Edit existing rows by name. Only fields ChatGPT returns are written — others are left untouched."}
          </DialogDescription>
        </DialogHeader>

        {hasUpdate && (
          <RadioGroup value={mode} onValueChange={(v) => setMode(v as Mode)} className="flex gap-4 border rounded-md p-2 bg-muted/30">
            <Label className="flex items-center gap-2 cursor-pointer text-sm">
              <RadioGroupItem value="create" /><Plus className="w-3 h-3" /> Create new
            </Label>
            <Label className="flex items-center gap-2 cursor-pointer text-sm">
              <RadioGroupItem value="update" /><Pencil className="w-3 h-3" /> Update existing
            </Label>
          </RadioGroup>
        )}

        <Tabs defaultValue="prompt" className="flex-1 flex flex-col min-h-0">
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="prompt">1. Copy prompt</TabsTrigger>
            <TabsTrigger value="paste">2. Paste JSON</TabsTrigger>
            <TabsTrigger value="export">Export</TabsTrigger>
          </TabsList>

          <TabsContent value="prompt" className="flex-1 overflow-y-auto space-y-3 mt-3">
            <div>
              <Label className="text-xs">Optional brief (added to the prompt)</Label>
              <Textarea
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                placeholder={mode === "update" ? "e.g. 'boost all sharpshooters' 3PT by +5'" : "e.g. '8 gauntlet-tier villains, all 5-star'"}
                rows={2}
                className="mt-1"
              />
            </div>
            <div className="flex justify-between items-center">
              <Label className="text-xs">Prompt for ChatGPT</Label>
              <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(prompt); toast.success("Copied"); }}>
                <Copy className="w-3 h-3 mr-1" />Copy prompt
              </Button>
            </div>
            <Textarea readOnly value={prompt} className="font-mono text-[11px] min-h-[280px]" />
          </TabsContent>

          <TabsContent value="paste" className="flex-1 overflow-y-auto space-y-3 mt-3">
            <Label className="text-xs">JSON from ChatGPT</Label>
            <Textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder='[{ ... }, { ... }]'
              className="font-mono text-[11px] min-h-[160px]"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleValidate}>Validate & preview</Button>
              {parsed && <span className="text-xs text-emerald-500 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />Parsed</span>}
            </div>
            {parseError && (
              <div className="text-xs text-destructive whitespace-pre-wrap border border-destructive/40 rounded p-2 bg-destructive/5">
                <AlertCircle className="w-3 h-3 inline mr-1" />{parseError}
              </div>
            )}
            {parsed && (
              <>
                <ImportPreviewTable
                  rows={previewRows}
                  selected={selected}
                  onToggle={(k) => {
                    const next = new Set(selected);
                    next.has(k) ? next.delete(k) : next.add(k);
                    setSelected(next);
                  }}
                  onToggleAll={() => {
                    if (previewRows.every((r) => selected.has(r.key))) setSelected(new Set());
                    else setSelected(new Set(previewRows.map((r) => r.key)));
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  {selected.size} of {previewRows.length} selected
                  {mode === "update" && " · only matched rows update; unmatched names are skipped"}
                </p>
              </>
            )}
          </TabsContent>

          <TabsContent value="export" className="flex-1 overflow-y-auto space-y-3 mt-3">
            {entity.exportData ? (
              <>
                <Button size="sm" variant="outline" onClick={handleLoadExport}>
                  <Download className="w-3 h-3 mr-1" />Load current data
                </Button>
                {exportJson && (
                  <>
                    <div className="flex justify-end">
                      <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(exportJson); toast.success("Copied"); }}>
                        <Copy className="w-3 h-3 mr-1" />Copy
                      </Button>
                    </div>
                    <Textarea readOnly value={exportJson} className="font-mono text-[11px] min-h-[260px]" />
                  </>
                )}
              </>
            ) : (
              <p className="text-xs text-muted-foreground">No export available for this entity.</p>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter className="border-t pt-3">
          <Button variant="ghost" onClick={() => setOpen(false)}>Close</Button>
          <Button onClick={handleCommit} disabled={!parsed || !selected.size || committing}>
            {commitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
