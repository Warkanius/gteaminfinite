import { useState, forwardRef, useImperativeHandle } from "react";
import { resolveCardVisuals, type CardData, type GemTierData } from "@/lib/cardVisuals";
import { Badge } from "@/components/ui/badge";
import { StarRating } from "@/components/cards/StarRating";
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
  delay?: number;
  onRevealed?: () => void;
}

export interface RevealCardHandle {
  reveal: () => void;
  isRevealed: () => boolean;
}

export const RevealCard = forwardRef<RevealCardHandle, RevealCardProps>(
  ({ card, onRevealed }, ref) => {
    const [revealed, setRevealed] = useState(false);
    const visuals = resolveCardVisuals(card, card.gem_tiers);
    const isHsl = (c: string) => /^\d+\s/.test(c);
    const bg = (c: string) => (isHsl(c) ? `hsl(${c})` : c);
    const positions = [card.position1, card.position2].filter(Boolean).join("/");

    useImperativeHandle(ref, () => ({
      reveal: () => {
        if (!revealed) {
          setRevealed(true);
          onRevealed?.();
        }
      },
      isRevealed: () => revealed,
    }));

    function handleClick() {
      if (revealed) return;
      setRevealed(true);
      onRevealed?.();
    }

    return (
      <div
        className="card-flip-container w-32 h-44 sm:w-36 sm:h-48 cursor-pointer select-none"
        onClick={handleClick}
        style={{ perspective: "800px" }}
      >
        <div
          className={cn(
            "card-flip-inner relative w-full h-full transition-transform duration-700 ease-out",
            revealed && "card-flipped"
          )}
          style={{ transformStyle: "preserve-3d" }}
        >
          {/* BACK FACE */}
          <div
            className="absolute inset-0 rounded-lg flex flex-col items-center justify-center backface-hidden"
            style={{
              backfaceVisibility: "hidden",
              background: `linear-gradient(135deg, hsl(var(--card)), hsl(var(--muted)))`,
              boxShadow: `0 0 20px 3px ${bg(visuals.glow)}40`,
            }}
          >
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-xl font-bold opacity-60 animate-card-pulse"
              style={{ color: bg(visuals.glow), textShadow: `0 0 12px ${bg(visuals.glow)}` }}
            >
              ?
            </div>
            <span className="text-[10px] text-muted-foreground mt-2 uppercase tracking-wider">
              Tap to reveal
            </span>
          </div>

          {/* FRONT FACE */}
          <div
            className="absolute inset-0 rounded-lg backface-hidden"
            style={{
              backfaceVisibility: "hidden",
              transform: "rotateY(180deg)",
            }}
          >
            {/* Glow burst on reveal */}
            {revealed && (
              <div
                className="absolute -inset-3 rounded-xl animate-reveal-burst pointer-events-none"
                style={{ background: bg(visuals.glow), opacity: 0 }}
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
              {/* Star rating */}
              <div className="absolute top-2 right-2">
                <StarRating rating={card.rating} glowColor={bg(visuals.glow)} size="sm" />
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
        </div>
      </div>
    );
  }
);

RevealCard.displayName = "RevealCard";
