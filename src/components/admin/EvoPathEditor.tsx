import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Wand2, ChevronDown, Trash2, Plus, Save, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { generateEvoPath, type EvoStep } from "@/lib/evoGenerator";

const CHALLENGE_TYPES = ["points_scored", "games_won", "stat_threshold"];
const STAT_KEYS = ["stat_3pt", "stat_mid", "stat_fin", "stat_dnk", "stat_ast", "stat_stl", "stat_reb", "stat_blk", "stat_int"];
const STAT_LABELS: Record<string, string> = {
  stat_3pt: "3PT", stat_mid: "MID", stat_fin: "FIN", stat_dnk: "DNK",
  stat_ast: "AST", stat_stl: "STL", stat_reb: "REB", stat_blk: "BLK", stat_int: "INT",
};

interface Props {
  playerId: string;
  playerGemTierId: string | null;
  playerStats: Record<string, number>;
  playerBadges: { badge_id: string; tier: string }[];
}

export function EvoPathEditor({ playerId, playerGemTierId, playerStats, playerBadges }: Props) {
  const qc = useQueryClient();
  const [steps, setSteps] = useState<(EvoStep & { id?: string })[]>([]);
  const [open, setOpen] = useState(false);

  const { data: gemTiers = [] } = useQuery({
    queryKey: ["gem-tiers"],
    queryFn: async () => {
      const { data } = await supabase.from("gem_tiers").select("*").order("sort_order");
      return data ?? [];
    },
  });

  const { data: existingSteps = [], isLoading } = useQuery({
    queryKey: ["evo-paths", playerId],
    queryFn: async () => {
      const { data, error } = await supabase.from("evo_paths").select("*").eq("player_card_id", playerId).order("step_order");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!playerId,
  });

  useEffect(() => {
    if (existingSteps.length > 0) {
      setSteps(existingSteps.map((s) => ({
        id: s.id,
        from_tier_id: s.from_tier_id,
        to_tier_id: s.to_tier_id ?? "",
        step_order: s.step_order,
        challenge_description: s.challenge_description,
        challenge_type: s.challenge_type,
        challenge_target: s.challenge_target,
        stat_boosts: (s.stat_boosts as Record<string, number>) ?? {},
        new_badges: (s.new_badges as any[]) ?? [],
      })));
    }
  }, [existingSteps]);

  function autoGenerate() {
    const generated = generateEvoPath(playerGemTierId, gemTiers, playerBadges, playerStats);
    setSteps(generated);
    toast.success(`Generated ${generated.length} evo steps`);
  }

  function addStep() {
    setSteps(s => [...s, {
      from_tier_id: null,
      to_tier_id: gemTiers[0]?.id ?? "",
      step_order: s.length + 1,
      challenge_description: "",
      challenge_type: "points_scored",
      challenge_target: 100,
      stat_boosts: {},
      new_badges: [],
    }]);
  }

  function removeStep(idx: number) {
    setSteps(s => s.filter((_, i) => i !== idx).map((step, i) => ({ ...step, step_order: i + 1 })));
  }

  function updateStep(idx: number, updates: Partial<EvoStep>) {
    setSteps(s => s.map((step, i) => i === idx ? { ...step, ...updates } : step));
  }

  const saveMut = useMutation({
    mutationFn: async () => {
      // Delete all existing steps for this player
      await supabase.from("evo_paths").delete().eq("player_card_id", playerId);
      // Insert new steps
      if (steps.length > 0) {
        const { error } = await supabase.from("evo_paths").insert(
          steps.map((s) => ({
            player_card_id: playerId,
            from_tier_id: s.from_tier_id || null,
            to_tier_id: s.to_tier_id || null,
            step_order: s.step_order,
            challenge_description: s.challenge_description,
            challenge_type: s.challenge_type,
            challenge_target: s.challenge_target,
            stat_boosts: s.stat_boosts,
            new_badges: s.new_badges,
          }))
        );
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["evo-paths", playerId] });
      toast.success("Evo path saved");
    },
    onError: (e) => toast.error(e.message),
  });

  const tierMap = Object.fromEntries(gemTiers.map(t => [t.id, t.name]));

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="bg-muted/30 p-4 rounded-lg border space-y-3">
      <CollapsibleTrigger className="flex items-center justify-between w-full">
        <h3 className="font-semibold text-sm flex items-center gap-2">
          Evolution Path
          {steps.length > 0 && <Badge variant="secondary" className="text-xs">{steps.length} steps</Badge>}
        </h3>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 pt-2">
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={autoGenerate} className="gap-1">
            <Wand2 className="h-3.5 w-3.5" /> Auto-Generate
          </Button>
          <Button size="sm" variant="outline" onClick={addStep} className="gap-1">
            <Plus className="h-3.5 w-3.5" /> Add Step
          </Button>
          <Button size="sm" onClick={() => saveMut.mutate()} disabled={saveMut.isPending} className="gap-1 ml-auto">
            {saveMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save Path
          </Button>
        </div>

        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : steps.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-4">No evo path defined. Click Auto-Generate or Add Step.</div>
        ) : (
          <div className="space-y-3">
            {steps.map((step, idx) => (
              <div key={idx} className="bg-card p-3 rounded-lg border space-y-3">
                <div className="flex items-center justify-between">
                  <Badge variant="secondary" className="font-mono">Step {step.step_order}</Badge>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {tierMap[step.from_tier_id ?? ""] ?? "Base"} → {tierMap[step.to_tier_id] ?? "?"}
                    </span>
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeStep(idx)}>
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">From Tier</Label>
                    <Select value={step.from_tier_id ?? ""} onValueChange={(v) => updateStep(idx, { from_tier_id: v || null })}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Base" /></SelectTrigger>
                      <SelectContent>{gemTiers.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">To Tier</Label>
                    <Select value={step.to_tier_id} onValueChange={(v) => updateStep(idx, { to_tier_id: v })}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>{gemTiers.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Challenge Type</Label>
                    <Select value={step.challenge_type} onValueChange={(v) => updateStep(idx, { challenge_type: v })}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>{CHALLENGE_TYPES.map(t => <SelectItem key={t} value={t} className="text-xs">{t.replace(/_/g, " ")}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Target</Label>
                    <Input type="number" className="h-8 text-xs" value={step.challenge_target} onChange={(e) => updateStep(idx, { challenge_target: Number(e.target.value) })} />
                  </div>
                  <div className="space-y-1 col-span-1">
                    <Label className="text-xs">Description</Label>
                    <Input className="h-8 text-xs" value={step.challenge_description} onChange={(e) => updateStep(idx, { challenge_description: e.target.value })} placeholder="Score 50 points…" />
                  </div>
                </div>

                {/* Stat boosts inline */}
                <div className="space-y-1">
                  <Label className="text-xs">Stat Boosts</Label>
                  <div className="flex flex-wrap gap-2">
                    {STAT_KEYS.map(k => {
                      const val = step.stat_boosts[k] ?? 0;
                      return (
                        <div key={k} className="flex items-center gap-1">
                          <span className="text-[10px] font-mono text-muted-foreground w-6">{STAT_LABELS[k]}</span>
                          <Input
                            type="number"
                            className="h-6 w-12 text-xs text-center p-0"
                            value={val || ""}
                            placeholder="0"
                            onChange={(e) => {
                              const v = Number(e.target.value);
                              const boosts = { ...step.stat_boosts };
                              if (v) boosts[k] = v; else delete boosts[k];
                              updateStep(idx, { stat_boosts: boosts });
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
