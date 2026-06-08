import { useState, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Bot, Copy, Sparkles, BookOpen, Trash2, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { buildStorylinePrompt, StorylineBundleSchema, loadImportContext, type ImportContext } from "@/lib/chatgptSchemas";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";

export default function AdminStorylines() {
  const qc = useQueryClient();
  const [ctx, setCtx] = useState<ImportContext | null>(null);
  const [brief, setBrief] = useState("");
  const [pasted, setPasted] = useState("");
  const [parsed, setParsed] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [committing, setCommitting] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => { loadImportContext().then(setCtx); }, []);

  const prompt = useMemo(() => (ctx ? buildStorylinePrompt(ctx, brief.trim()) : ""), [ctx, brief]);

  const { data: storylines = [] } = useQuery({
    queryKey: ["storylines"],
    queryFn: async () => {
      const { data } = await supabase
        .from("storylines")
        .select("*, storyline_entities(entity_type, entity_id)")
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  function validate() {
    setError(null); setParsed(null);
    try {
      const raw = pasted.trim().replace(/^```(json)?/i, "").replace(/```$/, "").trim();
      const json = JSON.parse(raw);
      const result = StorylineBundleSchema.safeParse(json);
      if (!result.success) {
        setError(result.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("\n"));
        return;
      }
      setParsed(result.data);
    } catch (e: any) { setError(`Invalid JSON: ${e.message}`); }
  }

  async function commit() {
    if (!parsed) return;
    setCommitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("import-storyline-bundle", { body: parsed });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`Storyline created: ${data.created.players} players, ${data.created.locker_codes} codes, ${data.created.posts} posts`);
      setPasted(""); setParsed(null); setBrief("");
      qc.invalidateQueries({ queryKey: ["storylines"] });
    } catch (e: any) {
      toast.error(e.message ?? "Commit failed");
    } finally { setCommitting(false); }
  }

  async function deleteStoryline() {
    if (!deleteId) return;
    const { error } = await supabase.from("storylines").delete().eq("id", deleteId);
    if (error) { toast.error(error.message); return; }
    toast.success("Storyline deleted (linked items kept)");
    setDeleteId(null);
    qc.invalidateQueries({ queryKey: ["storylines"] });
  }

  return (
    <div className="p-4 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="font-display text-3xl tracking-wider flex items-center gap-2">
          <BookOpen className="w-7 h-7 text-primary" /> Storylines
        </h1>
        <p className="text-sm text-muted-foreground">
          Use ChatGPT to draft a complete narrative arc — players, locker codes, and social posts — and commit it as one bundle.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Bot className="w-5 h-5 text-primary" /> New storyline from ChatGPT
          </CardTitle>
          <CardDescription>
            Describe the arc, copy the prompt, paste ChatGPT's JSON back, and commit. All-or-nothing — partial failures roll back.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="prompt">
            <TabsList>
              <TabsTrigger value="prompt">1. Copy prompt</TabsTrigger>
              <TabsTrigger value="paste">2. Paste & commit</TabsTrigger>
            </TabsList>

            <TabsContent value="prompt" className="space-y-3 mt-3">
              <div>
                <Label className="text-xs">Arc brief</Label>
                <Textarea
                  value={brief}
                  onChange={(e) => setBrief(e.target.value)}
                  placeholder="e.g. 'Rookie point guard rises from the streets, signs with a contender, wins MVP'"
                  rows={2}
                />
              </div>
              <div className="flex justify-between items-center">
                <Label className="text-xs">Prompt</Label>
                <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(prompt); toast.success("Copied"); }}>
                  <Copy className="w-3 h-3 mr-1" />Copy
                </Button>
              </div>
              <Textarea readOnly value={prompt} className="font-mono text-[11px] min-h-[280px]" />
            </TabsContent>

            <TabsContent value="paste" className="space-y-3 mt-3">
              <Label className="text-xs">JSON bundle from ChatGPT</Label>
              <Textarea
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder='{ "storyline": {...}, "players": [...], "locker_codes": [...], "posts": [...] }'
                className="font-mono text-[11px] min-h-[180px]"
              />
              <div className="flex gap-2 items-center">
                <Button size="sm" onClick={validate}>Validate</Button>
                {parsed && <span className="text-xs text-emerald-500 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />Parsed</span>}
              </div>
              {error && (
                <div className="text-xs text-destructive whitespace-pre-wrap border border-destructive/40 rounded p-2 bg-destructive/5">
                  <AlertCircle className="w-3 h-3 inline mr-1" />{error}
                </div>
              )}
              {parsed && (
                <div className="border rounded p-3 space-y-2 text-sm">
                  <div className="font-display text-lg">{parsed.storyline.title}</div>
                  {parsed.storyline.summary && <p className="text-muted-foreground text-xs">{parsed.storyline.summary}</p>}
                  <div className="flex gap-2 flex-wrap text-xs">
                    <Badge variant="secondary">{parsed.players.length} players</Badge>
                    <Badge variant="secondary">{parsed.locker_codes.length} locker codes</Badge>
                    <Badge variant="secondary">{parsed.posts.length} posts</Badge>
                  </div>
                  <Button onClick={commit} disabled={committing} className="w-full mt-2">
                    {committing ? "Committing…" : "Commit storyline bundle"}
                  </Button>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Existing storylines ({storylines.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {storylines.length === 0 && <p className="text-sm text-muted-foreground">No storylines yet.</p>}
          {storylines.map((s: any) => (
            <div key={s.id} className="flex items-center justify-between border rounded p-3 hover:bg-muted/30">
              <div className="min-w-0">
                <div className="font-medium flex items-center gap-2">
                  {s.title}
                  <Badge variant="outline" className="text-[10px]">{s.status}</Badge>
                </div>
                {s.summary && <p className="text-xs text-muted-foreground line-clamp-1">{s.summary}</p>}
                <p className="text-[10px] text-muted-foreground mt-1">
                  {s.storyline_entities?.length ?? 0} linked items
                </p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setDeleteId(s.id)}>
                <Trash2 className="w-4 h-4 text-destructive" />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(o) => !o && setDeleteId(null)}
        onConfirm={deleteStoryline}
        title="Delete storyline?"
        description="The linked players, posts, and codes will remain — only the storyline arc and its links are removed."
      />
    </div>
  );
}
