import { useState } from "react";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { Button } from "@/components/ui/button";
import { ArrowUp, ArrowDown } from "lucide-react";
import type { GameCard } from "@/pages/Play";
import { computeOVR } from "@/lib/ovrUtils";

interface MatchupArrangeProps {
  userLineup: GameCard[];
  cpuLineup: GameCard[];
  gemTierMap: Record<string, any>;
  onConfirm: (arrangedUserLineup: GameCard[]) => void;
}

export function MatchupArrange({ userLineup, cpuLineup, gemTierMap, onConfirm }: MatchupArrangeProps) {
  const [arranged, setArranged] = useState<GameCard[]>([...userLineup]);

  const moveUp = (idx: number) => {
    if (idx <= 0) return;
    setArranged((prev) => {
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  };

  const moveDown = (idx: number) => {
    if (idx >= arranged.length - 1) return;
    setArranged((prev) => {
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-lg font-semibold">Arrange Your Matchups</h2>
        <p className="text-sm text-muted-foreground">
          Reorder your lineup to set head-to-head pairings against the CPU.
        </p>
      </div>

      <div className="space-y-2">
        {arranged.map((userCard, i) => {
          const cpuCard = cpuLineup[i];
          return (
            <div key={userCard.id} className="flex items-center gap-2 rounded-lg border border-border bg-card p-2">
              {/* Move buttons */}
              <div className="flex flex-col gap-0.5">
                <button
                  onClick={() => moveUp(i)}
                  disabled={i === 0}
                  className="p-0.5 rounded hover:bg-muted disabled:opacity-30"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => moveDown(i)}
                  disabled={i === arranged.length - 1}
                  className="p-0.5 rounded hover:bg-muted disabled:opacity-30"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* User card */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <div className="w-12 h-16 shrink-0">
                    <PlayerCard card={userCard} gemTier={gemTierMap[userCard.gem_tier_id ?? ""]} className="w-full h-full" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{userCard.name}</p>
                    <p className="text-xs text-muted-foreground">{computeOVR(userCard)}★</p>
                  </div>
                </div>
              </div>

              <span className="text-xs text-muted-foreground font-display">VS</span>

              {/* CPU card */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 justify-end">
                  <div className="min-w-0 text-right">
                    <p className="text-sm font-medium truncate">{cpuCard?.name ?? "???"}</p>
                    <p className="text-xs text-muted-foreground">{cpuCard ? computeOVR(cpuCard) : "0.0"}★</p>
                  </div>
                  <div className="w-12 h-16 shrink-0">
                    {cpuCard && <PlayerCard card={cpuCard} gemTier={gemTierMap[cpuCard.gem_tier_id ?? ""]} className="w-full h-full" />}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <Button onClick={() => onConfirm(arranged)} className="w-full">
        Lock In Matchups
      </Button>
    </div>
  );
}
