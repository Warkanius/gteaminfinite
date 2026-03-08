import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

interface StarRatingProps {
  rating: number;
  glowColor?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

/**
 * Renders a star rating that adapts to any scale.
 * - Ratings 0–5 show 5 stars
 * - Ratings above 5 show extra stars with scale-breaking glow
 */
export function StarRating({ rating, glowColor = "hsl(var(--primary))", size = "sm", className }: StarRatingProps) {
  const totalStars = Math.max(5, Math.ceil(rating));
  const fullStars = Math.floor(rating);
  const fraction = rating - fullStars;
  const hasHalf = fraction >= 0.25;
  const isScaleBreaker = rating > 5;

  const sizeClass = size === "sm" ? "w-3 h-3" : size === "md" ? "w-4 h-4" : "w-5 h-5";

  return (
    <div
      className={cn("flex items-center gap-px flex-wrap", className)}
      style={isScaleBreaker ? { filter: `drop-shadow(0 0 6px ${glowColor})` } : undefined}
    >
      {Array.from({ length: totalStars }, (_, i) => {
        const isFull = i < fullStars;
        const isHalf = i === fullStars && hasHalf;

        return (
          <span key={i} className="relative inline-flex">
            {/* Empty star (background) */}
            <Star
              className={cn(sizeClass, "text-foreground/20")}
              strokeWidth={1.5}
            />
            {/* Filled overlay */}
            {(isFull || isHalf) && (
              <span
                className="absolute inset-0 overflow-hidden"
                style={{ width: isFull ? "100%" : "50%" }}
              >
                <Star
                  className={cn(sizeClass)}
                  strokeWidth={1.5}
                  fill={glowColor}
                  stroke={glowColor}
                  style={{
                    filter: isScaleBreaker
                      ? `drop-shadow(0 0 2px ${glowColor})`
                      : isFull && i >= 4
                        ? `drop-shadow(0 0 3px ${glowColor})`
                        : undefined,
                  }}
                />
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}
