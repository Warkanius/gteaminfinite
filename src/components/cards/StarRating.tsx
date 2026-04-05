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
  const fullStars = Math.floor(rating);
  const totalStars = Math.max(5, fullStars);
  const isScaleBreaker = rating > 5;

  const sizeClass = size === "sm" ? "w-3 h-3" : size === "md" ? "w-4 h-4" : "w-5 h-5";

  return (
    <div
      className={cn("flex items-center gap-px flex-wrap", className)}
      style={isScaleBreaker ? { filter: `drop-shadow(0 0 6px ${glowColor})` } : undefined}
    >
      {Array.from({ length: totalStars }, (_, i) => {
        const isFull = i < fullStars;

        return (
          <span key={i} className="relative inline-flex">
            {/* Empty star (background) */}
            <Star
              className={cn(sizeClass, "text-foreground/50")}
              strokeWidth={2.5}
              style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.4))" }}
            />
            {/* Filled overlay */}
            {isFull && (
              <span
                className="absolute inset-0 overflow-hidden"
                style={{ width: "100%" }}
              >
                <Star
                  className={cn(sizeClass)}
                  strokeWidth={1.5}
                  fill="#ffffff"
                  stroke="#ffffff"
                  style={{
                    filter: isScaleBreaker
                      ? "drop-shadow(0 0 2px #ffffff)"
                      : i >= 4
                        ? "drop-shadow(0 0 3px #ffffff)"
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
