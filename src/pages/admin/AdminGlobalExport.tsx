import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { SYSTEM_DOCS_MARKDOWN } from "@/lib/systemDocs";
import { toast } from "sonner";
import { Download, Copy, Loader2, FileJson, FileText } from "lucide-react";

// Tables included in the snapshot. Keep this list aligned with what ChatGPT
// needs to author new content (no per-user data, no auth tables).
const SNAPSHOT_TABLES = [
  "player_cards",
  "teams",
  "team_players",
  "runs",
  "run_players",
  "run_rank_rewards",
  "challenges",
  "packs",
  "pack_odds",
  "pack_players",
  "gem_tiers",
  "gem_market_listings",
  "gem_tasks",
  "locker_codes",
  "dynamic_duos",
  "badges",
  "signature_traits",
  "player_card_badges",
  "player_card_traits",
  "evo_paths",
  "collections",
  "sub_collections",
  "social_creators",
  "social_posts",
  "storylines",
  "storyline_entities",
  "rule_config",
] as const;

type Snapshot = {
  generated_at: string;
  counts: Record<string, number>;
  tables: Record<string, any[]>;
};

async function fetchSnapshot(): Promise<Snapshot> {
  const snap: Snapshot = {
    generated_at: new Date().toISOString(),
    counts: {},
    tables: {},
  };
  for (const t of SNAPSHOT_TABLES) {
    const { data, error } = await supabase.from(t as any).select("*").limit(5000);
    if (error) {
      console.warn(`[snapshot] ${t} failed:`, error.message);
      snap.tables[t] = [];
      snap.counts[t] = 0;
      continue;
    }
    snap.tables[t] = data ?? [];
    snap.counts[t] = (data ?? []).length;
  }
  return snap;
}

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function AdminGlobalExport() {
  const [loading, setLoading] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  const generate = async () => {
    setLoading(true);
    try {
      const s = await fetchSnapshot();
      setSnapshot(s);
      toast.success(`Snapshot ready — ${Object.values(s.counts).reduce((a, b) => a + b, 0)} rows across ${SNAPSHOT_TABLES.length} tables`);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to build snapshot");
    } finally {
      setLoading(false);
    }
  };

  const downloadJson = () => {
    if (!snapshot) return;
    download(`gteam-snapshot-${Date.now()}.json`, JSON.stringify(snapshot, null, 2), "application/json");
  };

  const downloadDocs = () => {
    download(`gteam-system-docs.md`, SYSTEM_DOCS_MARKDOWN, "text/markdown");
  };

  const downloadBundle = () => {
    if (!snapshot) return;
    const bundle = `${SYSTEM_DOCS_MARKDOWN}\n\n---\n\n## Live DB Snapshot (JSON)\n\n\`\`\`json\n${JSON.stringify(snapshot, null, 2)}\n\`\`\`\n`;
    download(`gteam-chatgpt-context-${Date.now()}.md`, bundle, "text/markdown");
  };

  const copyPrompt = async () => {
    if (!snapshot) return;
    const prompt = `You are helping author content for the G-Team Infinite card game. Use the system reference and live database snapshot below as ground truth. Do not invent enums, archetypes, or reference names that are not present. When you output content, return valid JSON matching the schemas described.\n\n${SYSTEM_DOCS_MARKDOWN}\n\n## Live DB Snapshot\n\`\`\`json\n${JSON.stringify(snapshot)}\n\`\`\``;
    await navigator.clipboard.writeText(prompt);
    toast.success("ChatGPT context copied to clipboard");
  };

  const downloadCsvAll = async () => {
    if (!snapshot) return;
    // Simple CSV per table, concatenated as a zip-less multi-section text file.
    const parts: string[] = [];
    for (const [table, rows] of Object.entries(snapshot.tables)) {
      parts.push(`### ${table}`);
      if (!rows.length) {
        parts.push("(empty)\n");
        continue;
      }
      const cols = Object.keys(rows[0]);
      parts.push(cols.join(","));
      for (const r of rows) {
        parts.push(
          cols
            .map((c) => {
              const v = r[c];
              if (v == null) return "";
              const s = typeof v === "object" ? JSON.stringify(v) : String(v);
              return `"${s.replace(/"/g, '""')}"`;
            })
            .join(",")
        );
      }
      parts.push("");
    }
    download(`gteam-snapshot-${Date.now()}.csv`, parts.join("\n"), "text/csv");
  };

  return (
    <div className="container mx-auto max-w-5xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="font-heading text-3xl">Global Export</h1>
        <p className="text-sm text-muted-foreground">
          Bundle the system reference + a live DB snapshot to feed ChatGPT (or any other tool) the full context of your league.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">1. Generate snapshot</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button onClick={generate} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {snapshot ? "Refresh snapshot" : "Generate snapshot"}
          </Button>

          {snapshot && (
            <div className="rounded-md border bg-muted/30 p-3 text-xs">
              <div className="mb-2 text-muted-foreground">
                Generated {new Date(snapshot.generated_at).toLocaleString()}
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 md:grid-cols-3">
                {Object.entries(snapshot.counts).map(([t, n]) => (
                  <div key={t} className="flex justify-between">
                    <span className="truncate">{t}</span>
                    <span className="font-mono text-muted-foreground">{n}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">2. Export</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={downloadDocs}>
              <FileText className="mr-2 h-4 w-4" /> Docs (.md)
            </Button>
            <Button variant="secondary" onClick={downloadJson} disabled={!snapshot}>
              <FileJson className="mr-2 h-4 w-4" /> Snapshot (.json)
            </Button>
            <Button variant="secondary" onClick={downloadCsvAll} disabled={!snapshot}>
              <Download className="mr-2 h-4 w-4" /> Snapshot (.csv)
            </Button>
            <Button onClick={downloadBundle} disabled={!snapshot}>
              <Download className="mr-2 h-4 w-4" /> Combined bundle (.md)
            </Button>
            <Button onClick={copyPrompt} disabled={!snapshot}>
              <Copy className="mr-2 h-4 w-4" /> Copy ChatGPT context
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Preview</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="docs">
            <TabsList>
              <TabsTrigger value="docs">System Docs</TabsTrigger>
              <TabsTrigger value="snapshot" disabled={!snapshot}>JSON Snapshot</TabsTrigger>
            </TabsList>
            <TabsContent value="docs">
              <Textarea readOnly value={SYSTEM_DOCS_MARKDOWN} className="h-96 font-mono text-xs" />
            </TabsContent>
            <TabsContent value="snapshot">
              <Textarea
                readOnly
                value={snapshot ? JSON.stringify(snapshot, null, 2) : ""}
                className="h-96 font-mono text-xs"
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
