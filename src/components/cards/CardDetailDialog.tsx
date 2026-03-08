import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { StarRating } from "@/components/cards/StarRating";
import { resolveCardVisuals, type CardData, type GemTierData } from "@/lib/cardVisuals";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell, Tooltip } from "recharts";

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
}

const STAT_LABELS: Record<string, string> = {
  stat_3pt: "3PT", stat_mid: "MID", stat_fin: "FIN", stat_dnk: "DNK",
  stat_ast: "AST", stat_stl: "STL", stat_reb: "REB", stat_blk: "BLK", stat_int: "INT",
};

const TIER_COLORS: Record<string, string> = {
  base: "hsl(var(--muted-foreground))",
  gold: "hsl(var(--gem-gold))",
  diamond: "hsl(var(--gem-diamond))",
  hof: "hsl(var(--gem-pink-diamond))",
  actolytrene: "hsl(var(--gem-actolytrene))",
};

export function CardDetailDialog({ open, onOpenChange, card, gemTier, teamName, badges = [], traits = [] }: CardDetailProps) {
  if (!card) return null;

  const visuals = resolveCardVisuals(card, gemTier);
  const isHsl = (c: string) => /^\d+\s/.test(c);
  const bg = (c: string) => isHsl(c) ? `hsl(${c})` : c;
  const positions = [card.position1, card.position2].filter(Boolean).join(" / ");

  const statKeys = Object.keys(STAT_LABELS) as (keyof typeof STAT_LABELS)[];
  const chartData = statKeys.map((k) => ({
    name: STAT_LABELS[k],
    value: (card as any)[k] ?? 0,
  }));

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
          </div>
        </div>

        {/* Stats chart */}
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} layout="vertical" margin={{ left: 0, right: 10 }}>
              <XAxis type="number" domain={[0, 6]} hide />
              <YAxis type="category" dataKey="name" width={35} tick={{ fill: "hsl(var(--foreground))", fontSize: 11 }} axisLine={false} tickLine={false} />
              <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={14}>
                {chartData.map((entry, i) => (
                  <Cell key={i} fill={entry.value >= 5 ? bg(visuals.glow) : entry.value >= 4 ? `${bg(visuals.primary)}` : "hsl(var(--muted-foreground) / 0.5)"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
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
      </DialogContent>
    </Dialog>
  );
}
