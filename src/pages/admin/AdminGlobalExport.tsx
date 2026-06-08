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

type Diagnostics = {
  unrated_players: { name: string; reason: string }[];
  incomplete_team_rosters: { team: string; category: string; players: number; expected: number }[];
  incomplete_runs: { run: string; issue: string }[];
  incomplete_domination_paths: { road: string; opponent: string; players: number; expected: number }[];
};

type Snapshot = {
  generated_at: string;
  counts: Record<string, number>;
  tables: Record<string, any[]>;
  diagnostics: Diagnostics;
};

const STAT_KEYS = ["stat_3pt","stat_mid","stat_fin","stat_dnk","stat_ast","stat_stl","stat_reb","stat_blk","stat_int"] as const;

function computeDiagnostics(tables: Record<string, any[]>): Diagnostics {
  const players = tables.player_cards ?? [];
  const teams = tables.teams ?? [];
  const teamPlayers = tables.team_players ?? [];
  const runs = tables.runs ?? [];
  const runPlayers = tables.run_players ?? [];
  const domGames = tables.domination_games ?? [];
  const domPlayers = tables.domination_game_players ?? [];

  // Unrated: only flag a card when it has NO overall rating AND no per-stat
  // values. A card with a stat breakdown (e.g. 3PT = 3) is considered rated
  // even if the overall `rating` column hasn't been filled in yet, and vice
  // versa. Decimal ratings like 0.4 count as a real rating.
  const unrated_players = players
    .map((p: any) => {
      const ratingNum = p.rating == null || p.rating === "" ? 0 : Number(p.rating);
      const statSum = STAT_KEYS.reduce((s, k) => s + (Number(p[k]) || 0), 0);
      if (!ratingNum && !statSum) return { name: p.name, reason: "no rating and all stats 0" };
      return null;
    })
    .filter(Boolean) as { name: string; reason: string }[];

  // Roster size by category (3v3 = 3 starters, 6 = full bench). Treat <3 as incomplete.
  const EXPECTED = 6;
  const MIN_VIABLE = 3;
  const teamRosterCount = new Map<string, number>();
  teamPlayers.forEach((tp: any) => teamRosterCount.set(tp.team_id, (teamRosterCount.get(tp.team_id) ?? 0) + 1));
  const incomplete_team_rosters = teams
    .map((t: any) => {
      const n = teamRosterCount.get(t.id) ?? 0;
      if (n >= MIN_VIABLE) return null;
      return { team: t.name, category: t.category, players: n, expected: EXPECTED };
    })
    .filter(Boolean) as Diagnostics["incomplete_team_rosters"];

  // Runs: need a roster (run_players) AND milestones array
  const runRosterCount = new Map<string, number>();
  runPlayers.forEach((rp: any) => runRosterCount.set(rp.run_id, (runRosterCount.get(rp.run_id) ?? 0) + 1));
  const incomplete_runs: Diagnostics["incomplete_runs"] = [];
  runs.forEach((r: any) => {
    const n = runRosterCount.get(r.id) ?? 0;
    const ms = Array.isArray(r.milestones) ? r.milestones.length : 0;
    if (n < MIN_VIABLE) incomplete_runs.push({ run: r.name, issue: `only ${n} opponent card(s) — need ≥${MIN_VIABLE}` });
    if (!ms) incomplete_runs.push({ run: r.name, issue: "no milestones defined" });
    if (!r.target_score) incomplete_runs.push({ run: r.name, issue: "no target_score" });
  });

  // Domination path games: each needs 3 (or 5) player slots filled
  const domRosterCount = new Map<string, number>();
  domPlayers.forEach((dp: any) => domRosterCount.set(dp.domination_game_id, (domRosterCount.get(dp.domination_game_id) ?? 0) + 1));
  const incomplete_domination_paths = domGames
    .map((g: any) => {
      const n = domRosterCount.get(g.id) ?? 0;
      if (n >= MIN_VIABLE) return null;
      return { road: g.road_name, opponent: g.opponent_name, players: n, expected: MIN_VIABLE };
    })
    .filter(Boolean) as Diagnostics["incomplete_domination_paths"];

  return { unrated_players, incomplete_team_rosters, incomplete_runs, incomplete_domination_paths };
}

async function fetchSnapshot(): Promise<Snapshot> {
  const snap: Snapshot = {
    generated_at: new Date().toISOString(),
    counts: {},
    tables: {},
    diagnostics: { unrated_players: [], incomplete_team_rosters: [], incomplete_runs: [], incomplete_domination_paths: [] },
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
  // Pull the two domination tables too (not in SNAPSHOT_TABLES yet)
  for (const t of ["domination_games", "domination_game_players"] as const) {
    if (snap.tables[t]) continue;
    const { data } = await supabase.from(t as any).select("*").limit(5000);
    snap.tables[t] = data ?? [];
    snap.counts[t] = (data ?? []).length;
  }
  snap.diagnostics = computeDiagnostics(snap.tables);
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
            <>
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
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs space-y-2">
                <div className="font-semibold text-amber-400">Diagnostics (incomplete data ChatGPT can fix)</div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 md:grid-cols-4">
                  <div className="flex justify-between"><span>Unrated players</span><span className="font-mono">{snapshot.diagnostics.unrated_players.length}</span></div>
                  <div className="flex justify-between"><span>Incomplete rosters</span><span className="font-mono">{snapshot.diagnostics.incomplete_team_rosters.length}</span></div>
                  <div className="flex justify-between"><span>Incomplete runs</span><span className="font-mono">{snapshot.diagnostics.incomplete_runs.length}</span></div>
                  <div className="flex justify-between"><span>Incomplete dominations</span><span className="font-mono">{snapshot.diagnostics.incomplete_domination_paths.length}</span></div>
                </div>
                {snapshot.diagnostics.unrated_players.length > 0 && (
                  <details className="text-muted-foreground">
                    <summary className="cursor-pointer">Show first 20 unrated players</summary>
                    <ul className="mt-1 list-disc pl-5">
                      {snapshot.diagnostics.unrated_players.slice(0, 20).map((p) => (
                        <li key={p.name}>{p.name} — <span className="opacity-70">{p.reason}</span></li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            </>
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
