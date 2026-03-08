import { cn } from "@/lib/utils";
import type { RoundLog } from "@/pages/Play";

interface RoundResultProps {
  result: RoundLog;
}

export function RoundResult({ result }: RoundResultProps) {
  const isWin = result.winner === "user";
  const isTie = result.winner === "tie";

  return (
    <div className={cn(
      "rounded-lg border p-4 text-center space-y-2",
      isWin ? "border-gem-emerald/50 bg-gem-emerald/5" :
      isTie ? "border-border bg-muted/20" :
      "border-destructive/50 bg-destructive/5"
    )}>
      <p className="font-display text-lg">
        {isWin ? "You Win!" : isTie ? "Tie!" : "CPU Wins!"}
      </p>
      <div className="flex justify-center gap-8 text-sm">
        <div>
          <p className="text-muted-foreground text-xs">You</p>
          <p className="font-mono">{result.userValue} + {result.userDice} = <span className="font-bold">{result.userTotal}</span></p>
        </div>
        <div>
          <p className="text-muted-foreground text-xs">CPU</p>
          <p className="font-mono">{result.cpuValue} + {result.cpuDice} = <span className="font-bold">{result.cpuTotal}</span></p>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Stat: {result.stat}</p>
    </div>
  );
}
