import { useState, useEffect, useRef } from "react";
import { Dice5 } from "lucide-react";

interface DiceRollProps {
  rolling: boolean;
  value: number | null;
  label: string;
}

export function DiceRoll({ rolling, value, label }: DiceRollProps) {
  const [display, setDisplay] = useState(1);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (rolling) {
      intervalRef.current = setInterval(() => {
        setDisplay(Math.floor(Math.random() * 6) + 1);
      }, 80);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
      if (value !== null) setDisplay(value);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [rolling, value]);

  return (
    <div className="flex flex-col items-center gap-2">
      <span className="text-xs text-muted-foreground uppercase">{label}</span>
      <div
        className={`relative flex items-center justify-center w-16 h-16 rounded-xl border-2 border-border bg-card transition-transform ${
          rolling ? "animate-pulse scale-110" : ""
        }`}
      >
        {value !== null && !rolling ? (
          <span className="text-3xl font-bold font-display text-primary">{value}</span>
        ) : (
          <>
            <Dice5 className={`h-8 w-8 text-muted-foreground ${rolling ? "animate-spin" : ""}`} />
            {rolling && (
              <span className="absolute text-lg font-bold text-primary">{display}</span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
