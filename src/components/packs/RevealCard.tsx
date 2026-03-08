import { useEffect, useState } from "react";
import { resolveCardVisuals, type CardData, type GemTierData } from "@/lib/cardVisuals";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface RevealCardProps {
  card: CardData & {
    id: string;
    name: string;
    rating: number;
    position1?: string | null;
    position2?: string | null;
    gem_name?: string | null;
    gem_tiers?: GemTierData | null;
  };
  delay: number; // ms before reveal
  onRevealed?: () => void;
}

export function RevealCard({ card, delay, onRevealed }: RevealCardProps) {
  const [revealed, setRevealed] = useState(false);
  const visuals = resolveCardVisuals(card, card.gem_tiers);
  const isHsl = (c: string) => /^\d+\s/.test(c);
  const bg = (c: string) => (isHsl(c) ? `hsl(${c})` : c);
  const positions = [card.position1, card.position2].filter(Boolean).join("/");

  useEffect(() => {
    const t = setTimeout(() => {
      setRevealed(true);
      onRevealed?.();
    }, delay);
    return () => clearTimeout(t);
  }, [delay]);

  return (
    <div
      className={cn(
        "relative w-32 h-44 sm:w-36 sm:h-48 rounded-lg transition-all duration-700 ease-out",
        revealed ? "scale-100 opacity-100" : "scale-75 opacity-0"
      )}
    >
      {/* Glow burst */}
      {revealed && (
        <div
          className="absolute -inset-3 rounded-xl animate-card-pulse opacity-60 blur-md pointer-events-none"
          style={{ background: bg(visuals.glow) }}
        />
      )}

      <div
        className={cn(
          "relative w-full h-full rounded-lg border border-border/50 flex flex-col items-center justify-end p-3 pt-6 overflow-hidden",
          visuals.animation === "shimmer" && "animate-shimmer",
          visuals.animation === "holographic" && "animate-holographic"
        )}
        style={{
          background: `linear-gradient(135deg, ${bg(visuals.primary)}, ${bg(visuals.secondary)})`,
          boxShadow: `0 0 24px 4px ${bg(visuals.glow)}50`,
        }}
      >
        {/* OVR */}
        <div
          className="absolute top-2 right-2 rounded-full w-8 h-8 flex items-center justify-center text-xs font-bold border border-border/30"
          style={{ background: `${bg(visuals.glow)}30`, color: bg(visuals.glow) }}
        >
          {card.rating}
        </div>

        <h3 className="text-xs font-semibold text-foreground truncate w-full text-center drop-shadow-md">
          {card.name}
        </h3>
        {card.gem_name && (
          <p className="text-[9px] text-foreground/70 truncate w-full text-center mt-0.5">
            {card.gem_name}
          </p>
        )}
        <div className="flex gap-1 mt-1">
          {positions && (
            <Badge variant="secondary" className="text-[9px] px-1 py-0 h-3.5">
              {positions}
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}
