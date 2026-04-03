import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { StarRating } from "@/components/cards/StarRating";
import { resolveCardVisuals, type CardData, type GemTierData } from "@/lib/cardVisuals";
import { Lock, Unlock, Coins, CheckCircle, Circle, ArrowRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

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
  isLocked?: boolean;
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
  hof: "hsl(var(--gem-diamond))",
  diamond: "hsl(var(--gem-pink-diamond))",
  actolytrene: "hsl(var(--gem-actolytrene))",
};

export function CardDetailDialog({ open, onOpenChange, card, gemTier, teamName, badges = [], traits = [], duplicateCount = 1, isLocked, onToggleLock, onQuicksell, quicksellLoading }: CardDetailProps) {
  const { user } = useAuth();

  if (!card) return null;

  const visuals = resolveCardVisuals(card, gemTier);
  const isHsl = (c: string) => /^\d+\s/.test(c);
  const bg = (c: string) => isHsl(c) ? `hsl(${c})` : c;
  const positions = [card.position1, card.position2].filter(Boolean).join(" / ");

  const statKeys = Object.keys(STAT_LABELS) as (keyof typeof STAT_LABELS)[];
  const canQuicksell = duplicateCount > 1 && !isLocked;

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
            <StarRating rating={card.rating} glowColor={bg(visuals.glow)} size="lg" />
            {positions && <Badge variant="secondary">{positions}</Badge>}
            {gemTier?.name && <Badge variant="outline" className="border-foreground/30">{gemTier.name}</Badge>}
            {card.gem_name && <Badge variant="outline" className="border-foreground/30">{card.gem_name}</Badge>}
            {teamName && <Badge variant="secondary">{teamName}</Badge>}
            {card.is_collection_reward && <Badge className="bg-gem-gold/20 text-foreground">Collection Reward</Badge>}
            {duplicateCount > 1 && <Badge variant="secondary">×{duplicateCount} owned</Badge>}
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-x-6 gap-y-2">
          {statKeys.map((k) => (
            <div key={k} className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground w-8 shrink-0">
                {STAT_LABELS[k]}
              </span>
              <StarRating rating={(card as any)[k] ?? 0} glowColor={bg(visuals.glow)} size="sm" />
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

        {/* Lock & Quicksell actions */}
        <div className="flex items-center gap-2 pt-2 border-t border-border/50">
          {onToggleLock && (
            <Button variant="outline" size="sm" onClick={onToggleLock} className="gap-1.5">
              {isLocked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
              {isLocked ? "Locked" : "Unlocked"}
            </Button>
          )}
          {onQuicksell && (
            <Button
              variant="outline"
              size="sm"
              onClick={onQuicksell}
              disabled={!canQuicksell || quicksellLoading}
              className="gap-1.5 ml-auto"
            >
              <Coins className="w-3.5 h-3.5" />
              {quicksellLoading ? "Selling…" : canQuicksell ? "Quicksell" : isLocked ? "Locked" : "Last copy"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
