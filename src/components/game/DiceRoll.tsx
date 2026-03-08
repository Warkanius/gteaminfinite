import { useState, useEffect, useRef } from "react";
import { Dice5 } from "lucide-react";
import { cn } from "@/lib/utils";

interface DiceRollProps {
  rolling: boolean;
  values: (number | null)[];  // 1 or 2 dice
  label: string;
  highlightDoubles?: boolean;
}

export function DiceRoll({ rolling, values, label, highlightDoubles }: DiceRollProps) {
  const [displays, setDisplays] = useState<number[]>(values.map(() => 1));
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isDoubles = values.length === 2 && values[0] !== null && values[0] === values[1];

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

  return (
    <div className="flex flex-col items-center gap-2">
      <span className="text-xs text-muted-foreground uppercase">{label}</span>
      <div className="flex gap-2">
        {displays.map((d, i) => (
          <div
            key={i}
            className={cn(
              "relative flex items-center justify-center w-14 h-14 rounded-xl border-2 bg-card transition-transform",
              rolling ? "animate-pulse scale-110 border-border" : "border-border",
              allResolved && highlightDoubles && isDoubles && "border-primary ring-2 ring-primary/30"
            )}
          >
            {allResolved ? (
              <span className="text-2xl font-bold font-display text-primary">{values[i]}</span>
            ) : (
              <>
                <Dice5 className={cn("h-7 w-7 text-muted-foreground", rolling && "animate-spin")} />
                {rolling && (
                  <span className="absolute text-lg font-bold text-primary">{d}</span>
                )}
              </>
            )}
          </div>
        ))}
      </div>
      {allResolved && isDoubles && highlightDoubles && (
        <span className="text-xs font-bold text-primary">DOUBLES!</span>
      )}
    </div>
  );
}
