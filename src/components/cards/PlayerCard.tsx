import { resolveCardVisuals, withAlpha, type CardData, type GemTierData } from "@/lib/cardVisuals";
import { Badge } from "@/components/ui/badge";
import { StarRating } from "@/components/cards/StarRating";
import { Shield, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { computeStars } from "@/lib/ovrUtils";

interface PlayerCardProps {
  card: CardData & {
    id: string;
    name: string;
    rating: number;
    position1?: string | null;
    position2?: string | null;
    gem_name?: string | null;
  };
  gemTier?: GemTierData | null;
  badgeCount?: number;
  duplicateCount?: number;
  isLocked?: boolean;
  missing?: boolean;
  onClick?: () => void;
  className?: string;
}

export function PlayerCard({ card, gemTier, badgeCount, duplicateCount, isLocked, missing, onClick, className }: PlayerCardProps) {
  const visuals = resolveCardVisuals(card, gemTier);
  const positions = [card.position1, card.position2].filter(Boolean).join("/");

  const isHsl = (c: string) => /^\d+\s/.test(c);
  const bg = (c: string) => isHsl(c) ? `hsl(${c})` : c;

  if (missing) {
    return (
      <button
        onClick={onClick}
        className={cn(
          "relative group flex flex-col items-center justify-end rounded-xl border border-dashed border-border/40 p-3 pt-10 transition-transform hover:scale-105 cursor-pointer overflow-hidden w-full aspect-[3/4] bg-muted/20",
          className,
        )}
        style={{
          boxShadow: `inset 0 0 0 2px ${withAlpha(visuals.glow, 0.12)}`,
        }}
        title={`Missing: ${card.name}`}
      >
        {/* Tier color stripe */}
        <div
          className="absolute top-0 left-0 right-0 h-1.5"
          style={{ background: `linear-gradient(90deg, ${bg(visuals.primary)}, ${bg(visuals.glow)}, ${bg(visuals.secondary)})` }}
        />
        <div className="absolute inset-0 flex items-center justify-center opacity-30">
          <Lock className="w-10 h-10 text-muted-foreground" />
        </div>
        <h3 className="text-[11px] sm:text-sm font-semibold text-muted-foreground/80 w-full text-center relative z-10 leading-tight line-clamp-2 break-words px-1">
          {card.name}
        </h3>
        <div className="flex gap-1 mt-1.5 relative z-10">
          {positions && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 text-muted-foreground/70 border-muted-foreground/30">
              {positions}
            </Badge>
          )}
          {gemTier?.name && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 text-muted-foreground/70 border-muted-foreground/30">
              {gemTier.name}
            </Badge>
          )}
        </div>
      </button>
    );
  }

  return (
    <button
      onClick={onClick}
      className={cn(
        "relative group flex flex-col items-center justify-end rounded-xl border border-border/50 p-3 pt-10 transition-transform hover:scale-105 cursor-pointer overflow-hidden w-full aspect-[3/4]",
        visuals.animation === "shimmer" && "animate-shimmer",
        visuals.animation === "pulse" && "animate-card-pulse",
        visuals.animation === "holographic" && "animate-holographic",
        className,
      )}
      style={{
        // Use backgroundImage (not the `background` shorthand) so the
        // shimmer animation's background-size can still take effect.
        backgroundImage: `linear-gradient(135deg, ${bg(visuals.primary)}, ${bg(visuals.secondary)})`,
        boxShadow: `0 0 18px 3px ${withAlpha(visuals.glow, 0.45)}, inset 0 1px 0 ${withAlpha(visuals.glow, 0.18)}`,
      }}
    >
      {/* Star rating */}
      <div className="absolute top-2 right-2 flex items-center gap-1">
        <StarRating rating={computeStars(card)} glowColor={bg(visuals.glow)} size="md" />
      </div>

      {/* Badge count */}
      {!!badgeCount && badgeCount > 0 && (
        <div className="absolute top-2 left-2 flex items-center gap-0.5 rounded-full bg-background/60 backdrop-blur-sm px-1.5 py-0.5">
          <Shield className="w-3 h-3 text-foreground/80" />
          <span className="text-[10px] font-bold text-foreground/80">{badgeCount}</span>
        </div>
      )}

      {/* Duplicate count */}
      {!!duplicateCount && duplicateCount > 1 && (
        <div
          className="absolute bottom-2 right-2 flex items-center rounded-full px-2 py-0.5 border border-foreground/30 shadow-md"
          style={{
            background: `linear-gradient(135deg, ${bg(visuals.glow)}, ${bg(visuals.primary)})`,
          }}
          title={`${duplicateCount} copies owned`}
        >
          <span className="text-[11px] font-bold text-foreground drop-shadow">×{duplicateCount}</span>
        </div>
      )}

      {/* Lock indicator */}
      {isLocked && (
        <div className="absolute top-8 left-2">
          <Lock className="w-3 h-3 text-foreground/60" />
        </div>
      )}

      {/* Card name */}
      <h3 className="text-[11px] sm:text-sm font-semibold text-foreground w-full text-center drop-shadow-md leading-tight line-clamp-2 break-words px-1">
        {card.name}
      </h3>

      {/* Gem name */}
      {card.gem_name && (
        <p className="text-[10px] text-foreground/70 w-full text-center mt-0.5 leading-tight line-clamp-2 break-words px-1">
          {card.gem_name}
        </p>
      )}

      {/* Position / Tier chips */}
      <div className="flex gap-1 mt-1.5">
        {positions && (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
            {positions}
          </Badge>
        )}
        {gemTier?.name && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 border-foreground/20">
            {gemTier.name}
          </Badge>
        )}
      </div>
    </button>
  );
}
