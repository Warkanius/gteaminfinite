import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { StarRating } from "@/components/cards/StarRating";
import { resolveCardVisuals, type CardData, type GemTierData } from "@/lib/cardVisuals";
import { computeStars } from "@/lib/ovrUtils";
import { Lock, Unlock, Coins, CheckCircle, Circle, ArrowRight, Sparkles } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { describeChallenge } from "@/lib/evoGenerator";

interface CardDetailProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  card: (CardData & {
    id: string;
    name: string;
    rating: number;
    position1?: string | null;
    position2?: string | null;
    gem_name?: string | null;
    stat_3pt: number;
    stat_mid: number;
    stat_fin: number;
    stat_dnk: number;
    stat_ast: number;
    stat_stl: number;
    stat_reb: number;
    stat_blk: number;
    stat_int: number;
    is_collection_reward?: boolean;
  }) | null;
  gemTier?: GemTierData | null;
  teamName?: string;
  badges?: { name: string; tier: string }[];
  traits?: { name: string; tier: string; target_stat?: string | null }[];
  duplicateCount?: number;
  sellableCount?: number;
  isLocked?: boolean;
  canSell?: boolean;
  onToggleLock?: () => void;
  onQuicksell?: () => void;
  quicksellLoading?: boolean;
}

const STAT_LABELS: Record<string, string> = {
  stat_3pt: "3PT", stat_mid: "MID", stat_fin: "FIN", stat_dnk: "DNK",
  stat_ast: "AST", stat_stl: "STL", stat_reb: "REB", stat_blk: "BLK", stat_int: "INT",
};

const TIER_COLORS: Record<string, string> = {
  base: "hsl(var(--muted-foreground))",
  gold: "hsl(var(--gem-gold))",
  hof: "hsl(var(--gem-hof))",
  diamond: "hsl(var(--gem-diamond))",
  actolytrene: "hsl(var(--gem-actolytrene))",
};

export function CardDetailDialog({ open, onOpenChange, card, gemTier, teamName, badges = [], traits = [], duplicateCount = 1, sellableCount = 0, isLocked, canSell = false, onToggleLock, onQuicksell, quicksellLoading }: CardDetailProps) {
  const { user } = useAuth();

  if (!card) return null;

  const visuals = resolveCardVisuals(card, gemTier);
  const isHsl = (c: string) => /^\d+\s/.test(c);
  const bg = (c: string) => isHsl(c) ? `hsl(${c})` : c;
  const positions = [card.position1, card.position2].filter(Boolean).join(" / ");

  const statKeys = Object.keys(STAT_LABELS) as (keyof typeof STAT_LABELS)[];
  const canQuicksell = canSell && sellableCount > 0;
  const sellingDuplicate = duplicateCount > 1 && sellableCount > 0;
  const remainingAfterSell = Math.max(0, duplicateCount - 1);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header with gradient */}
        <div
          className="rounded-t-lg -mx-6 -mt-6 px-6 pt-6 pb-4 mb-4"
          style={{
            background: `linear-gradient(135deg, ${bg(visuals.primary)}, ${bg(visuals.secondary)})`,
            boxShadow: `inset 0 -20px 40px -20px ${bg(visuals.glow)}30`,
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-2xl">{card.name}</DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <StarRating rating={computeStars(card)} glowColor={bg(visuals.glow)} size="lg" />
            {positions && <Badge variant="secondary">{positions}</Badge>}
            {gemTier?.name && <Badge variant="outline" className="border-foreground/30">{gemTier.name}</Badge>}
            {card.gem_name && <Badge variant="outline" className="border-foreground/30">{card.gem_name}</Badge>}
            {teamName && <Badge variant="secondary">{teamName}</Badge>}
            {card.is_collection_reward && <Badge className="bg-gem-gold/20 text-foreground">Collection Reward</Badge>}
            {duplicateCount > 1 && (
              <Badge className="bg-foreground/15 text-foreground border border-foreground/30">
                ×{duplicateCount} owned{sellableCount > 0 && sellableCount < duplicateCount ? ` (${sellableCount} sellable)` : ""}
              </Badge>
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-2">
          {statKeys.map((k) => (
            <div key={k} className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground w-8 shrink-0">
                {STAT_LABELS[k]}
              </span>
              <StarRating rating={(card as any)[k] ?? 0} glowColor={bg(visuals.glow)} size="md" />
            </div>
          ))}
        </div>

        {/* Badges */}
        {badges.length > 0 && (
          <div className="space-y-1.5">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Badges</h4>
            <div className="flex flex-wrap gap-1.5">
              {badges.map((b, i) => (
                <Badge key={i} variant="outline" className="text-xs" style={{ borderColor: TIER_COLORS[b.tier] ?? TIER_COLORS.base, color: TIER_COLORS[b.tier] ?? TIER_COLORS.base }}>
                  {b.name} · {b.tier}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Traits */}
        {traits.length > 0 && (
          <div className="space-y-1.5">
            <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Signature Traits</h4>
            <div className="flex flex-wrap gap-1.5">
              {traits.map((t, i) => (
                <Badge key={i} variant="outline" className="text-xs" style={{ borderColor: TIER_COLORS[t.tier] ?? TIER_COLORS.base, color: TIER_COLORS[t.tier] ?? TIER_COLORS.base }}>
                  {t.name} · {t.tier}{t.target_stat ? ` → ${t.target_stat}` : ""}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {/* Evo Path Timeline */}
        <EvoTimeline playerCardId={card.id} userId={user?.id} glowColor={bg(visuals.glow)} />

        {/* Lock & Quicksell actions */}
        <div className="flex items-center gap-2 pt-2 border-t border-border/50">
          {onToggleLock && (
            <Button variant="outline" size="sm" onClick={onToggleLock} className="gap-1.5">
              {isLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
              {isLocked ? "Locked" : "Unlocked"}
            </Button>
          )}
          {onQuicksell && canSell && (
            <Button
              variant={sellingDuplicate ? "default" : "outline"}
              size="sm"
              onClick={onQuicksell}
              disabled={!canQuicksell || quicksellLoading}
              className="gap-1.5 ml-auto"
              title={sellingDuplicate ? `Sell 1 duplicate, keep ${remainingAfterSell}` : undefined}
            >
              <Coins className="w-3.5 h-3.5" />
              {quicksellLoading
                ? "Selling…"
                : !canQuicksell
                ? "Locked"
                : sellingDuplicate
                ? `Sell 1 Duplicate (Keep ${remainingAfterSell})`
                : "Quicksell"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Evo Timeline sub-component
function EvoTimeline({ playerCardId, userId, glowColor }: { playerCardId: string; userId?: string; glowColor: string }) {
  const qc = useQueryClient();

  const { data: evoSteps = [] } = useQuery({
    queryKey: ["evo-paths", playerCardId],
    queryFn: async () => {
      const { data } = await supabase.from("evo_paths").select("*, from_tier:gem_tiers!evo_paths_from_tier_id_fkey(name), to_tier:gem_tiers!evo_paths_to_tier_id_fkey(name)").eq("player_card_id", playerCardId).order("step_order");
      return data ?? [];
    },
  });

  const { data: progress = [], refetch: refetchProgress } = useQuery({
    queryKey: ["evo-progress", playerCardId, userId],
    queryFn: async () => {
      if (!userId) return [];
      const { data } = await supabase.from("user_evo_progress").select("*").eq("player_card_id", playerCardId).eq("user_id", userId);
      return data ?? [];
    },
    enabled: !!userId,
  });

  const claimMut = useMutation({
    mutationFn: async ({ step, progressRow }: { step: any; progressRow: any }) => {
      const evolvesToCardId = (step as any).evolves_to_card_id;
      if (!evolvesToCardId || !userId) throw new Error("No evolution target configured");

      // Insert the new evolved card into user's collection
      const { error: insertErr } = await supabase.from("user_collections").insert({
        user_id: userId,
        player_card_id: evolvesToCardId,
      });
      if (insertErr) throw insertErr;

      // Remove one copy of the old card
      const { data: oldCopies } = await supabase.from("user_collections")
        .select("id")
        .eq("user_id", userId)
        .eq("player_card_id", playerCardId)
        .limit(1);
      if (oldCopies && oldCopies.length > 0) {
        await supabase.from("user_collections").delete().eq("id", oldCopies[0].id);
      }

      // Mark as claimed
      const { error: claimErr } = await supabase.from("user_evo_progress")
        .update({ claimed: true } as any)
        .eq("id", progressRow.id);
      if (claimErr) throw claimErr;
    },
    onSuccess: () => {
      toast.success("Evolution claimed! Check your collection for the new card.");
      refetchProgress();
      qc.invalidateQueries({ queryKey: ["user-collection"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (evoSteps.length === 0) return null;

  const progressMap = Object.fromEntries(progress.map((p: any) => [p.evo_path_id, p]));

  return (
    <div className="space-y-2 pt-2 border-t border-border/50">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Evolution Path</h4>
      <div className="space-y-2">
        {evoSteps.map((step: any, idx: number) => {
          const prog = progressMap[step.id];
          const completed = prog?.completed ?? false;
          const claimed = (prog as any)?.claimed ?? false;
          const canClaim = completed && !claimed && !!(step as any).evolves_to_card_id;

          // Check if this is a compound challenge
          const compounds = (step.compound_challenges as any[] | null) ?? [];
          const isCompound = compounds.length > 0;
          const compoundProgress: Record<string, number> = (prog as any)?.compound_progress ?? {};

          return (
            <div key={step.id} className={`flex items-start gap-2 p-2 rounded-lg transition-colors ${completed ? "bg-primary/10" : idx === 0 || progressMap[evoSteps[idx - 1]?.id]?.completed ? "bg-muted/50" : "bg-muted/20 opacity-60"}`}>
              <div className="mt-0.5">
                {completed ? (
                  <CheckCircle className="h-4 w-4 text-primary" />
                ) : (
                  <Circle className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="font-medium">{(step as any).from_tier?.name ?? "Base"}</span>
                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                  <span className="font-medium" style={{ color: glowColor }}>{(step as any).to_tier?.name ?? "?"}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {isCompound ? "Complete all of the following:" : step.challenge_description}
                </p>
                {canClaim && (
                  <Button
                    size="sm"
                    className="gap-1.5 h-7 text-xs mt-1"
                    disabled={claimMut.isPending}
                    onClick={() => claimMut.mutate({ step, progressRow: prog })}
                  >
                    <Sparkles className="h-3 w-3" />
                    {claimMut.isPending ? "Claiming…" : "Claim Evolution"}
                  </Button>
                )}
                {completed && claimed && (
                  <span className="text-[10px] text-primary font-medium">Claimed ✓</span>
                )}
                {!completed && isCompound && (
                  <div className="space-y-1">
                    {compounds.map((req: any, i: number) => {
                      const current = compoundProgress[String(i)] ?? 0;
                      const target = req.target ?? 1;
                      const met = current >= target;
                      const pctReq = Math.min(100, Math.round((current / target) * 100));
                      const label = req.description?.trim()
                        ? req.description
                        : describeChallenge(req.type, target, req.stat);
                      return (
                        <div key={i} className="space-y-0.5">
                          <div className="flex items-center gap-1.5 text-[10px]">
                            {met ? (
                              <CheckCircle className="h-3 w-3 text-primary shrink-0" />
                            ) : (
                              <Circle className="h-3 w-3 text-muted-foreground shrink-0" />
                            )}
                            <span className={met ? "text-primary" : "text-muted-foreground"}>{label}</span>
                          </div>
                          <div className="flex items-center gap-2 ml-4">
                            <Progress value={pctReq} className="h-1 flex-1" />
                            <span className="text-[10px] font-mono text-muted-foreground">{current}/{target}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
                {!completed && !isCompound && (
                  <div className="flex items-center gap-2">
                    <Progress value={Math.min(100, Math.round(((prog?.current_value ?? 0) / step.challenge_target) * 100))} className="h-1.5 flex-1" />
                    <span className="text-[10px] font-mono text-muted-foreground">{prog?.current_value ?? 0}/{step.challenge_target}</span>
                  </div>
                )}
                {Object.keys(step.stat_boosts ?? {}).length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(step.stat_boosts as Record<string, number>).map(([k, v]) => (
                      <Badge key={k} variant="outline" className="text-[10px] py-0 px-1">
                        {k.replace("stat_", "").toUpperCase()} +{v}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
