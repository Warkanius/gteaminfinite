import { resolveCardVisuals, type CardData, type GemTierData } from "@/lib/cardVisuals";
import { Badge } from "@/components/ui/badge";
import { StarRating } from "@/components/cards/StarRating";
import { Shield, Lock } from "lucide-react";
import { cn } from "@/lib/utils";

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
  onClick?: () => void;
  className?: string;
}

export function PlayerCard({ card, gemTier, badgeCount, duplicateCount, isLocked, onClick, className }: PlayerCardProps) {
  const visuals = resolveCardVisuals(card, gemTier);
  const positions = [card.position1, card.position2].filter(Boolean).join("/");

  const isHsl = (c: string) => /^\d+\s/.test(c);
  const bg = (c: string) => isHsl(c) ? `hsl(${c})` : c;

  return (
    <button
      onClick={onClick}
      className={cn(
        "relative group flex flex-col items-center justify-end rounded-xl border border-border/50 p-3 pt-10 transition-transform hover:scale-105 cursor-pointer overflow-hidden",
        visuals.animation === "shimmer" && "animate-shimmer",
        visuals.animation === "pulse" && "animate-card-pulse",
        visuals.animation === "holographic" && "animate-holographic",
        className,
      )}
      style={{
        background: `linear-gradient(135deg, ${bg(visuals.primary)}, ${bg(visuals.secondary)})`,
        boxShadow: `0 0 18px 3px ${bg(visuals.glow)}40, inset 0 1px 0 ${bg(visuals.glow)}20`,
      }}
    >
      {/* Star rating */}
      <div className="absolute top-2 right-2 flex items-center gap-1 rounded-full bg-background/60 backdrop-blur-sm px-1.5 py-0.5">
        <StarRating rating={card.rating} glowColor={bg(visuals.glow)} size="md" />
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
        <div className="absolute bottom-2 right-2 flex items-center rounded-full bg-background/70 backdrop-blur-sm px-1.5 py-0.5">
          <span className="text-[10px] font-bold text-foreground/90">×{duplicateCount}</span>
        </div>
      )}

      {/* Lock indicator */}
      {isLocked && (
        <div className="absolute top-8 left-2">
          <Lock className="w-3 h-3 text-foreground/60" />
        </div>
      )}

      {/* Card name */}
      <h3 className="text-sm font-semibold text-foreground truncate w-full text-center drop-shadow-md">
        {card.name}
      </h3>

      {/* Gem name */}
      {card.gem_name && (
        <p className="text-[10px] text-foreground/70 truncate w-full text-center mt-0.5">
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
