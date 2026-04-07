import { useState, useRef, useCallback } from "react";
import { RevealCard, type RevealCardHandle } from "./RevealCard";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

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
}

export function PackReveal({ cards, onOpenAnother, onClose, packProgress, onNextPack }: PackRevealProps) {
  const navigate = useNavigate();
  const [revealedCount, setRevealedCount] = useState(0);
  const allRevealed = revealedCount >= cards.length;
  const cardRefs = useRef<(RevealCardHandle | null)[]>([]);

  const handleRevealAll = useCallback(() => {
    cardRefs.current.forEach((ref, i) => {
      if (ref && !ref.isRevealed()) {
        setTimeout(() => ref.reveal(), i * 200);
      }
    });
  }, []);

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
