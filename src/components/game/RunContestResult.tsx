import { PlayerCard } from "@/components/cards/PlayerCard";
import { DiceRoll } from "@/components/game/DiceRoll";
import { ActivationBanner } from "@/components/game/ActivationBanner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { STAT_LABELS, type StatKey, type ShotContestResult } from "@/lib/gameEngine";
import type { BadgeActivation } from "@/lib/badgeEngine";
import type { TraitActivation } from "@/lib/traitEngine";

interface Props {
  kind: "shot" | "rebound";
  shooter: any;
  defender: any;
  offenseStat: StatKey;
  defenseStat: StatKey;
  contest: ShotContestResult;
  activations: (BadgeActivation | TraitActivation)[];
  rolling: boolean;
  shooterSide: "player" | "cpu";
  onContinue: () => void;
}

export function RunContestResult({
  kind, shooter, defender, offenseStat, defenseStat,
  contest, activations, rolling, shooterSide, onContinue,
}: Props) {
  const made = contest.made;
  const outcome = contest.outcome;
  const isSteal = outcome === "steal";
  const isBlock = outcome === "block";

  const verdictColor = kind === "rebound"
    ? "text-accent-foreground"
    : made
      ? (shooterSide === "player" ? "text-primary" : "text-destructive")
      : (isSteal || isBlock)
        ? (shooterSide === "player" ? "text-destructive" : "text-primary")
        : "text-muted-foreground";

  const verdictLabel = kind === "rebound"
    ? (shooterSide === "player" ? "🏀 YOUR REBOUND" : "🏀 CPU REBOUND")
    : made
      ? (shooterSide === "player" ? `✅ MAKE +${contest.points}` : `❌ THEY SCORED +${contest.points}`)
      : isSteal
        ? (shooterSide === "player" ? `🛡️ STOLEN — CPU ball` : `🛡️ STEAL — Your ball`)
        : isBlock
          ? (shooterSide === "player" ? `🚫 BLOCKED` : `🚫 BLOCK — Rebound`)
          : (shooterSide === "player" ? "❌ MISS" : "🛡️ STOP");

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        {/* Shooter / offense rebounder */}
        <div className="flex flex-col items-center gap-2">
          <p className={cn(
            "text-[10px] font-bold uppercase tracking-wider",
            shooterSide === "player" ? "text-primary" : "text-destructive",
          )}>
            {kind === "shot"
              ? (shooterSide === "player" ? "Your Shot" : "CPU Shot")
              : (shooterSide === "player" ? "Your Rebounder" : "CPU Rebounder")}
          </p>
          <div className="w-24 sm:w-28">
            <PlayerCard card={shooter._displayCard ?? shooter} gemTier={(shooter._displayCard ?? shooter).gem_tiers} />
          </div>
          <p className="text-[11px] font-mono text-center">
            {STAT_LABELS[offenseStat]} {shooter[offenseStat]} ({Math.min(12, Math.floor((shooter[offenseStat] ?? 0) / 20))}★)
          </p>
          <DiceRoll
            rolling={rolling}
            values={rolling ? contest.offenseDice.map(() => null) : contest.offenseDice}
            label="OFF"
            highlightDoubles
          />
          {!rolling && (
            <p className={cn(
              "text-lg font-bold font-display",
              shooterSide === "player" ? "text-primary" : "text-destructive",
            )}>
              {contest.offenseRoll}
            </p>
          )}
        </div>

        <div className="text-center text-sm font-display text-muted-foreground self-center">VS</div>

        {/* Defender */}
        <div className="flex flex-col items-center gap-2">
          <p className={cn(
            "text-[10px] font-bold uppercase tracking-wider",
            shooterSide === "player" ? "text-destructive" : "text-primary",
          )}>
            {kind === "shot"
              ? (shooterSide === "player" ? "CPU Defender" : "Your Defender")
              : (shooterSide === "player" ? "CPU Rebounder" : "Your Rebounder")}
          </p>
          <div className="w-24 sm:w-28">
            <PlayerCard card={defender._displayCard ?? defender} gemTier={(defender._displayCard ?? defender).gem_tiers} />
          </div>
          <p className="text-[11px] font-mono text-center">
            {STAT_LABELS[defenseStat]} {defender[defenseStat]} ({Math.min(12, Math.floor((defender[defenseStat] ?? 0) / 20))}★)
          </p>
          <DiceRoll
            rolling={rolling}
            values={rolling ? contest.defenseDice.map(() => null) : contest.defenseDice}
            label="DEF"
            highlightDoubles
          />
          {!rolling && (
            <p className={cn(
              "text-lg font-bold font-display",
              shooterSide === "player" ? "text-destructive" : "text-primary",
            )}>
              {contest.defenseRoll}
            </p>
          )}
        </div>
      </div>

      {!rolling && activations.length > 0 && (
        <ActivationBanner activations={activations} compact />
      )}

      {!rolling && (
        <div className={cn(
          "rounded-xl border-2 p-4 text-center space-y-1",
          made
            ? (shooterSide === "player" ? "border-primary/50 bg-primary/10" : "border-destructive/50 bg-destructive/10")
            : "border-border bg-muted/30",
        )}>
          <p className={cn("font-display text-2xl font-bold", verdictColor)}>{verdictLabel}</p>
          <p className="text-xs text-muted-foreground font-mono">
            {contest.offenseRoll} vs {contest.defenseRoll}
          </p>
        </div>
      )}

      {!rolling && (
        <Button
          className="w-full font-display tracking-wider"
          onClick={onContinue}
        >
          {isSteal ? "Continue →" : isBlock ? "Go to Rebound →" : "Next Possession →"}
        </Button>
      )}
    </div>
  );
}
