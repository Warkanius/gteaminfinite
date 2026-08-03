import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, Plus, Rocket, Trash2 } from "lucide-react";
import {
  buildBundlePayload,
  emptyDraft,
  oddsTotal,
  validateDraft,
  type ReleaseDraft,
  type ValidationIssue,
} from "@/lib/releaseBundle";

const DRAFT_KEY = "gteam.release.draft";

function loadDraft(): ReleaseDraft {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) return { ...emptyDraft(), ...JSON.parse(raw) };
  } catch {
    /* ignore corrupt drafts */
  }
  return emptyDraft();
}

interface PreviewResult {
  preview_token?: string;
  payload_hash?: string;
  creates?: unknown[];
  updates?: unknown[];
  deletes?: unknown[];
  replacements?: unknown[];
  warnings?: unknown[];
  resolved_references?: unknown[];
  verification?: unknown;
  [k: string]: unknown;
}

export default function AdminReleases() {
  const [draft, setDraft] = useState<ReleaseDraft>(loadDraft);
  const [issues, setIssues] = useState<ValidationIssue[] | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [playersJson, setPlayersJson] = useState(() => JSON.stringify(loadDraft().players ?? [], null, 2));
  const [evoJson, setEvoJson] = useState(() => JSON.stringify(loadDraft().evo_paths ?? [], null, 2));

  const { data: tiers = [] } = useQuery({
    queryKey: ["gem-tiers-release"],
    queryFn: async () => {
      const { data, error } = await supabase.from("gem_tiers").select("name, sort_order").order("sort_order");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: releases = [], refetch: refetchReleases } = useQuery({
    queryKey: ["release-bundles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("release_bundles")
        .select("id, name, version_label, version_number, status, published_at")
        .order("created_at", { ascending: false })
        .limit(25);
      if (error) throw error;
      return data ?? [];
    },
  });

  const tierNames = useMemo(() => tiers.map((t) => t.name as string), [tiers]);
  const total = oddsTotal(draft.pack?.odds);

  const update = (patch: Partial<ReleaseDraft>) => {
    setDraft((d) => {
      const next = { ...d, ...patch };
      localStorage.setItem(DRAFT_KEY, JSON.stringify(next));
      return next;
    });
    setPreview(null);
  };

  const syncJson = (): ReleaseDraft | null => {
    try {
      const players = JSON.parse(playersJson || "[]");
      const evo_paths = JSON.parse(evoJson || "[]");
      if (!Array.isArray(players) || !Array.isArray(evo_paths)) throw new Error("Expected JSON arrays");
      const next = { ...draft, players, evo_paths };
      localStorage.setItem(DRAFT_KEY, JSON.stringify(next));
      setDraft(next);
      return next;
    } catch (e) {
      toast.error(`Invalid JSON: ${(e as Error).message}`);
      return null;
    }
  };

  const handleValidate = () => {
    const next = syncJson();
    if (!next) return null;
    const found = validateDraft(next, tierNames);
    setIssues(found);
    if (!found.some((i) => i.severity === "error")) toast.success("Release is valid.");
    return found.some((i) => i.severity === "error") ? null : next;
  };

  const handlePreview = async () => {
    const next = handleValidate();
    if (!next) return;
    setBusy(true);
    setPreview(null);
    try {
      const payload = buildBundlePayload(next);
      const { data, error } = await supabase.rpc("admin_apply_batch", {
        p_payload: payload as never,
        p_commit: false,
        p_preview_token: null,
        p_kind: "content_bundle",
      });
      if (error) throw error;
      setPreview(data as PreviewResult);
      toast.success("Preview generated — nothing was written.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handlePublish = async () => {
    if (!preview?.preview_token) return;
    setBusy(true);
    try {
      const payload = buildBundlePayload(draft);
      const { data, error } = await supabase.rpc("admin_apply_batch", {
        p_payload: payload as never,
        p_commit: true,
        p_preview_token: preview.preview_token,
        p_kind: "content_bundle",
      });
      if (error) throw error;
      setPreview(data as PreviewResult);
      toast.success("Release published atomically.");
      refetchReleases();
    } catch (e) {
      toast.error(`Nothing was written: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const pack = draft.pack!;
  const setPack = (patch: Partial<typeof pack>) => update({ pack: { ...pack, ...patch } });

  const movePool = (index: number, dir: -1 | 1) => {
    const pool = [...pack.pool];
    const target = index + dir;
    if (target < 0 || target >= pool.length) return;
    [pool[index], pool[target]] = [pool[target], pool[index]];
    setPack({ pool: pool.map((s, i) => ({ ...s, slot_number: i + 1 })) });
  };

  const errors = (issues ?? []).filter((i) => i.severity === "error");

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
      <header className="space-y-1">
        <h1 className="font-display text-2xl tracking-wide">Content Releases</h1>
        <p className="text-sm text-muted-foreground">
          Build a whole release — collection, cards, pack pool and odds, multi-step evos — then publish it in one
          atomic transaction.
        </p>
      </header>

      <Tabs defaultValue="release">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="release">Release</TabsTrigger>
          <TabsTrigger value="collection">Collection</TabsTrigger>
          <TabsTrigger value="players">Cards</TabsTrigger>
          <TabsTrigger value="pack">Pack</TabsTrigger>
          <TabsTrigger value="evo">Evo paths</TabsTrigger>
        </TabsList>

        <TabsContent value="release" className="space-y-4 pt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Release name</Label>
              <Input
                value={draft.release.name}
                onChange={(e) => update({ release: { ...draft.release, name: e.target.value } })}
                placeholder="Galactic"
              />
            </div>
            <div>
              <Label>Version label</Label>
              <Input
                value={draft.release.version_label ?? ""}
                onChange={(e) => update({ release: { ...draft.release, version_label: e.target.value } })}
                placeholder="v1"
              />
            </div>
            <div>
              <Label>Version number</Label>
              <Input
                type="number"
                value={draft.release.version_number ?? 1}
                onChange={(e) =>
                  update({ release: { ...draft.release, version_number: Number(e.target.value) || 1 } })
                }
              />
            </div>
            <div>
              <Label>Optional team link (name)</Label>
              <Input value={draft.team_link ?? ""} onChange={(e) => update({ team_link: e.target.value })} />
            </div>
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea
              value={draft.release.notes ?? ""}
              onChange={(e) => update({ release: { ...draft.release, notes: e.target.value } })}
            />
          </div>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Recent releases</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              {releases.length === 0 && <p className="text-muted-foreground">No releases yet.</p>}
              {releases.map((r) => (
                <div key={r.id as string} className="flex items-center justify-between gap-2">
                  <span>
                    {r.name as string}{" "}
                    <span className="text-muted-foreground">
                      {(r.version_label as string) ?? `v${r.version_number}`}
                    </span>
                  </span>
                  <Badge variant="secondary">{r.status as string}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="collection" className="space-y-3 pt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Collection name</Label>
              <Input
                value={draft.collection?.name ?? ""}
                onChange={(e) => update({ collection: { ...draft.collection!, name: e.target.value } })}
                placeholder="Galactic"
              />
            </div>
            <div>
              <Label>Reward card (name or card_key)</Label>
              <Input
                value={draft.collection?.reward_card ?? ""}
                onChange={(e) => update({ collection: { ...draft.collection!, reward_card: e.target.value } })}
              />
            </div>
          </div>
          <div>
            <Label>Description</Label>
            <Textarea
              value={draft.collection?.description ?? ""}
              onChange={(e) => update({ collection: { ...draft.collection!, description: e.target.value } })}
            />
          </div>
          <div>
            <Label>Membership order (one card per line — blank = every card in this release)</Label>
            <Textarea
              rows={6}
              value={(draft.collection?.members ?? []).join("\n")}
              onChange={(e) =>
                update({
                  collection: {
                    ...draft.collection!,
                    members: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean),
                  },
                })
              }
            />
            <p className="text-xs text-muted-foreground mt-1">
              Membership is a destructive replacement — the preview lists every added and removed card.
            </p>
          </div>
        </TabsContent>

        <TabsContent value="players" className="space-y-2 pt-4">
          <Label>Cards (JSON array — bulk create and bulk update)</Label>
          <Textarea
            className="font-mono text-xs"
            rows={18}
            value={playersJson}
            onChange={(e) => {
              setPlayersJson(e.target.value);
              setPreview(null);
            }}
          />
          <p className="text-xs text-muted-foreground">
            Supported per card: player_id / card_key / name, action, position1, position2, gem_tier, display_gem_name,
            rating, run_rating, stat_* , run_stat_*, team, collection, sub_collection, is_reward_card, market_value,
            social_handle, avatar_url, card colours, card_animation, badges, traits, trait target stats. Badge and
            trait arrays fully replace what is on the card.
          </p>
        </TabsContent>

        <TabsContent value="pack" className="space-y-4 pt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Pack name</Label>
              <Input value={pack.name} onChange={(e) => setPack({ name: e.target.value })} placeholder="Galactic" />
            </div>
            <div>
              <Label>Pack type</Label>
              <Input value={pack.pack_type ?? ""} onChange={(e) => setPack({ pack_type: e.target.value })} />
            </div>
            <div>
              <Label>Single cost</Label>
              <Input type="number" value={pack.cost ?? 0} onChange={(e) => setPack({ cost: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Ten-box cost</Label>
              <Input
                type="number"
                value={pack.ten_box_cost ?? 0}
                onChange={(e) => setPack({ ten_box_cost: Number(e.target.value) })}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Ordered pool</Label>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setPack({ pool: [...pack.pool, { slot_number: pack.pool.length + 1, player: "" }] })}
              >
                <Plus className="w-4 h-4 mr-1" />Slot
              </Button>
            </div>
            {pack.pool.map((slot, i) => (
              <div key={i} className="flex items-center gap-2">
                <Badge variant="secondary" className="w-10 justify-center">{slot.slot_number}</Badge>
                <Input
                  value={slot.player}
                  placeholder="Card name or card_key"
                  onChange={(e) => {
                    const pool = [...pack.pool];
                    pool[i] = { ...slot, player: e.target.value };
                    setPack({ pool });
                  }}
                />
                <Button size="icon" variant="ghost" onClick={() => movePool(i, -1)}><ArrowUp className="w-4 h-4" /></Button>
                <Button size="icon" variant="ghost" onClick={() => movePool(i, 1)}><ArrowDown className="w-4 h-4" /></Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() =>
                    setPack({
                      pool: pack.pool.filter((_, x) => x !== i).map((s, x) => ({ ...s, slot_number: x + 1 })),
                    })
                  }
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Odds</Label>
              <div className="flex items-center gap-2">
                <Badge variant={total === 100 ? "secondary" : "destructive"}>Total {total}%</Badge>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    setPack({ odds: [...pack.odds, { dice_roll: "", result_slot: "", percentage: 0 }] })
                  }
                >
                  <Plus className="w-4 h-4 mr-1" />Row
                </Button>
              </div>
            </div>
            {pack.odds.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  className="w-24"
                  placeholder="Roll"
                  value={row.dice_roll}
                  onChange={(e) => {
                    const odds = [...pack.odds];
                    odds[i] = { ...row, dice_roll: e.target.value };
                    setPack({ odds });
                  }}
                />
                <Input
                  className="w-24"
                  placeholder="Slot"
                  value={row.result_slot}
                  onChange={(e) => {
                    const odds = [...pack.odds];
                    odds[i] = { ...row, result_slot: e.target.value };
                    setPack({ odds });
                  }}
                />
                <Input
                  className="w-24"
                  type="number"
                  step="0.01"
                  value={row.percentage}
                  onChange={(e) => {
                    const odds = [...pack.odds];
                    odds[i] = { ...row, percentage: Number(e.target.value) };
                    setPack({ odds });
                  }}
                />
                <Input
                  placeholder="Description"
                  value={row.description ?? ""}
                  onChange={(e) => {
                    const odds = [...pack.odds];
                    odds[i] = { ...row, description: e.target.value };
                    setPack({ odds });
                  }}
                />
                <Button size="icon" variant="ghost" onClick={() => setPack({ odds: pack.odds.filter((_, x) => x !== i) })}>
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="evo" className="space-y-2 pt-4">
          <Label>Evo paths (JSON array of multi-step ladders)</Label>
          <Textarea
            className="font-mono text-xs"
            rows={18}
            value={evoJson}
            onChange={(e) => {
              setEvoJson(e.target.value);
              setPreview(null);
            }}
          />
          <p className="text-xs text-muted-foreground">
            Shape: {`{ player, final_tier, status, steps: [{ step_order, from_tier, to_tier, objectives: [{ key, target }], final_stats, badges, traits }] }`}.
            Objective keys: points, three_pointers, mid_range, dunks, assists, steals, rebounds, blocks, games_won.
            Known tiers: {tierNames.join(", ") || "—"}.
          </p>
        </TabsContent>
      </Tabs>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={handleValidate} disabled={busy}>Validate release</Button>
        <Button onClick={handlePreview} disabled={busy}>Generate preview (zero writes)</Button>
        <Button
          onClick={handlePublish}
          disabled={busy || !preview?.preview_token}
          className="ml-auto"
        >
          <Rocket className="w-4 h-4 mr-1" />Publish atomically
        </Button>
      </div>

      {issues && issues.length > 0 && (
        <Card className="border-destructive/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-destructive" />
              {errors.length} error{errors.length === 1 ? "" : "s"}, {issues.length - errors.length} warning(s)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {issues.map((issue, i) => (
              <div key={i} className="flex gap-2">
                <Badge variant={issue.severity === "error" ? "destructive" : "secondary"} className="text-[10px]">
                  {issue.scope}
                </Badge>
                <span className="text-muted-foreground">{issue.message}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {issues && issues.length === 0 && (
        <p className="text-sm text-emerald-400 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />No validation problems found.
        </p>
      )}

      {preview && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              Preview plan {preview.payload_hash ? `· hash ${String(preview.payload_hash).slice(0, 12)}` : ""}
              {preview.preview_token ? " · approval required" : " · committed"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-80">
              <pre className="text-xs font-mono whitespace-pre-wrap">{JSON.stringify(preview, null, 2)}</pre>
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
