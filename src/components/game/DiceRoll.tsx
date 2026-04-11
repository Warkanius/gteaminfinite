import { useState, useEffect, useRef } from "react";
import { Dice5 } from "lucide-react";
import { cn } from "@/lib/utils";

interface DiceRollProps {
  rolling: boolean;
  values: (number | null)[];  // 1-6 dice
  label: string;
  highlightDoubles?: boolean;
}

export function DiceRoll({ rolling, values, label, highlightDoubles }: DiceRollProps) {
  const [displays, setDisplays] = useState<number[]>(values.map(() => 1));
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const hasMatch = values.length >= 2 && values.every(v => v !== null) && (() => {
    const counts: Record<number, number> = {};
    for (const v of values) {
      if (v == null) return false;
      counts[v] = (counts[v] || 0) + 1;
      if (counts[v] >= 2) return true;
    }
    return false;
  })();

  useEffect(() => {
    if (rolling) {
      intervalRef.current = setInterval(() => {
        setDisplays(values.map(() => Math.floor(Math.random() * 6) + 1));
      }, 80);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
      setDisplays(values.map((v) => v ?? 1));
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [rolling, values]);

  const allResolved = !rolling && values.every((v) => v !== null);

  // Smaller dice for higher counts
  const diceSize = values.length <= 2 ? "w-12 h-12" : values.length <= 4 ? "w-10 h-10" : "w-8 h-8";
  const textSize = values.length <= 2 ? "text-xl" : values.length <= 4 ? "text-lg" : "text-sm";
  const iconSize = values.length <= 2 ? "h-6 w-6" : "h-4 w-4";

  return (
    <div className="flex flex-col items-center gap-1.5">
      <span className="text-xs text-muted-foreground uppercase">{label}</span>
      <div className="flex flex-wrap gap-1.5 justify-center max-w-[120px]">
        {displays.map((d, i) => (
          <div
            key={i}
            className={cn(
              "relative flex items-center justify-center rounded-lg border-2 bg-card transition-transform",
              diceSize,
              rolling ? "animate-pulse scale-110 border-border" : "border-border",
              allResolved && highlightDoubles && hasMatch && "border-primary ring-2 ring-primary/30"
            )}
          >
            {allResolved ? (
              <span className={cn("font-bold font-display text-primary", textSize)}>{values[i]}</span>
            ) : (
              <>
                <Dice5 className={cn("text-muted-foreground", iconSize, rolling && "animate-spin")} />
                {rolling && (
                  <span className={cn("absolute font-bold text-primary", textSize)}>{d}</span>
                )}
              </>
            )}
          </div>
        ))}
      </div>
      {allResolved && hasMatch && highlightDoubles && (
        <span className="text-xs font-bold text-primary">MATCH!</span>
      )}
    </div>
  );
}
