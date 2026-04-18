import { useState, useRef, useCallback } from "react";
import { RevealCard, type RevealCardHandle } from "./RevealCard";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { cn } from "@/lib/utils";

interface PulledCard {
  id: string;
  name: string;
  rating: number;
  position1?: string | null;
  position2?: string | null;
  gem_name?: string | null;
  card_color_primary?: string | null;
  card_color_secondary?: string | null;
  card_glow_color?: string | null;
  card_animation?: string | null;
  gem_tiers?: { color?: string; name?: string } | null;
}

interface PackProgress {
  current: number;
  total: number;
}

interface PackRevealProps {
  cards: PulledCard[];
  onOpenAnother: () => void;
  onClose: () => void;
  packProgress?: PackProgress | null;
  onNextPack?: () => void;
  // Player-choice mode
  playerChoice?: boolean;
  eligibleCards?: PulledCard[];
  onConfirmChoice?: (cardId: string) => void | Promise<void>;
  confirmingChoice?: boolean;
}

export function PackReveal({
  cards,
  onOpenAnother,
  onClose,
  packProgress,
  onNextPack,
  playerChoice,
  eligibleCards,
  onConfirmChoice,
  confirmingChoice,
}: PackRevealProps) {
  const navigate = useNavigate();
  const [revealedCount, setRevealedCount] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const allRevealed = revealedCount >= cards.length;
  const cardRefs = useRef<(RevealCardHandle | null)[]>([]);

  const handleRevealAll = useCallback(() => {
    cardRefs.current.forEach((ref, i) => {
      if (ref && !ref.isRevealed()) {
        setTimeout(() => ref.reveal(), i * 200);
      }
    });
  }, []);

  // ===== Player Choice Mode =====
  if (playerChoice && eligibleCards && eligibleCards.length > 0) {
    return (
      <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col items-center justify-start gap-4 p-4 overflow-y-auto">
        <h2 className="font-display text-2xl font-bold text-foreground uppercase tracking-wider mt-4 text-center">
          Player's Choice — Pick Your Card
        </h2>
        <p className="text-sm text-muted-foreground text-center max-w-md">
          You rolled the rare Player's Choice slot. Select one card to add to your collection.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 max-w-5xl w-full">
          {eligibleCards.map((card) => (
            <button
              key={card.id}
              type="button"
              disabled={confirmingChoice}
              onClick={() => setSelectedId(card.id)}
              className={cn(
                "rounded-lg transition-all p-1 disabled:opacity-50",
                selectedId === card.id
                  ? "ring-4 ring-primary scale-105"
                  : "ring-2 ring-transparent hover:ring-primary/50"
              )}
            >
              <PlayerCard card={card as any} />
            </button>
          ))}
        </div>

        <div className="flex gap-3 sticky bottom-4 mt-2">
          <Button
            disabled={!selectedId || confirmingChoice}
            onClick={() => selectedId && onConfirmChoice?.(selectedId)}
          >
            {confirmingChoice ? "Adding…" : "Confirm Selection"}
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={confirmingChoice}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  const isMultiPack = packProgress && packProgress.total > 1;
  const isLastPack = isMultiPack && packProgress.current >= packProgress.total;

  return (
    <div className="fixed inset-0 z-50 bg-background/90 backdrop-blur-sm flex flex-col items-center justify-center gap-6 p-4">
      <h2 className="font-display text-2xl font-bold text-foreground uppercase tracking-wider">
        {!allRevealed
          ? "Tap cards to reveal!"
          : isMultiPack && !isLastPack
            ? `Pack ${packProgress.current} of ${packProgress.total}`
            : "Pack Opened!"}
      </h2>

      <div className="flex flex-wrap justify-center gap-4 max-w-3xl">
        {cards.map((card, i) => (
          <RevealCard
            key={`${card.id}-${i}`}
            ref={(el) => { cardRefs.current[i] = el; }}
            card={card}
            onRevealed={() => setRevealedCount((c) => c + 1)}
          />
        ))}
      </div>

      {!allRevealed && (
        <Button variant="ghost" size="sm" onClick={handleRevealAll} className="text-muted-foreground">
          Reveal All
        </Button>
      )}

      {allRevealed && (
        <div className="flex gap-3 mt-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
          {isMultiPack && !isLastPack ? (
            <Button onClick={onNextPack}>
              Next Pack ({packProgress.current}/{packProgress.total})
            </Button>
          ) : (
            <>
              <Button onClick={onOpenAnother}>Open Another</Button>
              <Button variant="secondary" onClick={() => navigate("/collection")}>
                View Collection
              </Button>
            </>
          )}
          <Button variant="ghost" onClick={onClose}>
            {isMultiPack && !isLastPack ? "Skip All" : "Back"}
          </Button>
        </div>
      )}
    </div>
  );
}
