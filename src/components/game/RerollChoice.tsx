import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface RerollChoiceProps {
  statLabel: string;
  originalDice: number[];
  rerollDice: number[];
  onChoose: (keepReroll: boolean) => void;
}

export function RerollChoice({ statLabel, originalDice, rerollDice, onChoose }: RerollChoiceProps) {
  const originalTotal = originalDice.reduce((a, b) => a + b, 0);
  const rerollTotal = rerollDice.reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-4 text-center">
      <h3 className="font-display text-lg text-primary">Reroll Available!</h3>
      <p className="text-sm text-muted-foreground">
        Your badge triggered a reroll on <span className="font-semibold text-foreground">{statLabel}</span>. Choose which roll to keep:
      </p>
      <div className="grid grid-cols-2 gap-4 max-w-xs mx-auto">
        <button
          onClick={() => onChoose(false)}
          className={cn(
            "rounded-lg border-2 p-4 space-y-2 transition-colors",
            "border-border hover:border-primary hover:bg-primary/5"
          )}
        >
          <p className="text-xs text-muted-foreground uppercase">Original</p>
          <div className="flex justify-center gap-1">
            {originalDice.map((d, i) => (
              <span key={i} className="inline-flex items-center justify-center w-10 h-10 rounded-md bg-muted font-bold text-lg font-mono">{d}</span>
            ))}
          </div>
          <p className="text-sm font-semibold">Total: {originalTotal}</p>
        </button>
        <button
          onClick={() => onChoose(true)}
          className={cn(
            "rounded-lg border-2 p-4 space-y-2 transition-colors",
            "border-border hover:border-primary hover:bg-primary/5"
          )}
        >
          <p className="text-xs text-muted-foreground uppercase">Reroll</p>
          <div className="flex justify-center gap-1">
            {rerollDice.map((d, i) => (
              <span key={i} className="inline-flex items-center justify-center w-10 h-10 rounded-md bg-primary/10 font-bold text-lg font-mono text-primary">{d}</span>
            ))}
          </div>
          <p className="text-sm font-semibold">Total: {rerollTotal}</p>
        </button>
      </div>
    </div>
  );
}
