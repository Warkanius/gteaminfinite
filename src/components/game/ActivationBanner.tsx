import { Shield, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BadgeActivation } from "@/lib/badgeEngine";
import type { TraitActivation } from "@/lib/traitEngine";

type Activation = BadgeActivation | TraitActivation;

const TIER_STYLES: Record<string, { bg: string; border: string; text: string }> = {
  base:        { bg: "bg-muted/40",                border: "border-muted-foreground/30", text: "text-muted-foreground" },
  gold:        { bg: "bg-amber-500/15",            border: "border-amber-500/50",        text: "text-amber-400" },
  hof:         { bg: "bg-fuchsia-500/15",          border: "border-fuchsia-500/50",      text: "text-fuchsia-400" },
  diamond:     { bg: "bg-cyan-400/15",             border: "border-cyan-400/50",         text: "text-cyan-400" },
  actolytrene: { bg: "bg-violet-600/15",           border: "border-violet-500/50",       text: "text-violet-400" },
};

function isBadge(a: Activation): a is BadgeActivation {
  return "badgeName" in a;
}

function getTierStyle(tier: string) {
  return TIER_STYLES[tier] ?? TIER_STYLES.base;
}

interface ActivationBannerProps {
  activations: Activation[];
  compact?: boolean;
}

export function ActivationBanner({ activations, compact = false }: ActivationBannerProps) {
  if (activations.length === 0) return null;

  return (
    <div className="space-y-1 animate-fade-in">
      {activations.map((a, i) => {
        const style = getTierStyle(a.tier);
        const badge = isBadge(a);
        const Icon = badge ? Shield : Zap;

        return (
          <div
            key={i}
            className={cn(
              "flex items-center gap-2 rounded-md border-l-[3px] px-2.5 py-1.5",
              style.bg, style.border,
              compact ? "text-[10px]" : "text-xs"
            )}
          >
            <Icon className={cn("shrink-0", style.text, compact ? "h-3 w-3" : "h-3.5 w-3.5")} />
            <span className={cn("font-bold uppercase tracking-wide", style.text)}>
              {a.abbreviation}
            </span>
            <span className="text-muted-foreground capitalize">({a.tier})</span>
            <span className="text-foreground/80 truncate">— {a.effect}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Inline version for play-by-play logs */
export function ActivationLogEntry({ activation }: { activation: Activation }) {
  const style = getTierStyle(activation.tier);
  const badge = isBadge(activation);
  const Icon = badge ? Shield : Zap;

  return (
    <div className={cn(
      "text-xs p-2 rounded-md border-l-4 flex items-center gap-1.5",
      style.bg, style.border
    )}>
      <Icon className={cn("shrink-0 h-3 w-3", style.text)} />
      <span className={cn("font-bold", style.text)}>{activation.abbreviation}</span>
      <span className="text-muted-foreground">({activation.tier})</span>
      <span className="text-foreground/80">— {activation.effect}</span>
    </div>
  );
}
