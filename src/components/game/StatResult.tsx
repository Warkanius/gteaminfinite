import { cn } from "@/lib/utils";
import { STAT_LABELS, type StatRollResult } from "@/lib/gameEngine";
import { ActivationBanner } from "@/components/game/ActivationBanner";
import type { BadgeActivation } from "@/lib/badgeEngine";
import type { TraitActivation } from "@/lib/traitEngine";

interface StatResultProps {
  userResult: StatRollResult;
  cpuResult: StatRollResult;
  activations?: (BadgeActivation | TraitActivation)[];
}

export function StatResult({ userResult, cpuResult, activations = [] }: StatResultProps) {
  const userWins = userResult.points > cpuResult.points;
  const tie = userResult.points === cpuResult.points;
  const isScoringRound = userResult.pointMultiplier > 0;

  return (
    <div className={cn(
      "rounded-lg border p-3 text-center space-y-2",
      !isScoringRound ? "border-border bg-muted/10" :
      userWins ? "border-gem-emerald/50 bg-gem-emerald/5" :
      tie ? "border-border bg-muted/20" :
      "border-destructive/50 bg-destructive/5"
    )}>
      <p className="font-display text-sm">
        {STAT_LABELS[userResult.stat]}
        {!isScoringRound && <span className="text-muted-foreground ml-1">(tracked)</span>}
      </p>
      <div className="flex justify-center gap-6 text-sm">
        <div className="space-y-0.5">
          <p className="text-muted-foreground text-xs">You</p>
          <p className="font-mono">
            [{userResult.dice.join("+")}] × {userResult.modifier}x = {userResult.rollResult}
          </p>
          {isScoringRound && (
            <p className="text-primary font-semibold">
              {userResult.rollResult} × {userResult.pointMultiplier} = {userResult.points} pts
            </p>
          )}
          {userResult.isDoubles && <span className="text-primary font-bold text-xs">DOUBLES 3x!</span>}
        </div>
        <div className="space-y-0.5">
          <p className="text-muted-foreground text-xs">CPU</p>
          <p className="font-mono">
            [{cpuResult.dice.join("+")}] × {cpuResult.modifier}x = {cpuResult.rollResult}
          </p>
          {isScoringRound && (
            <p className="text-destructive font-semibold">
              {cpuResult.rollResult} × {cpuResult.pointMultiplier} = {cpuResult.points} pts
            </p>
          )}
          {cpuResult.isDoubles && <span className="text-destructive font-bold text-xs">DOUBLES 3x!</span>}
        </div>
      </div>

      {activations.length > 0 && (
        <ActivationBanner activations={activations} compact />
      )}
    </div>
  );
}
