import { useState } from "react";
import { RevealCard } from "./RevealCard";
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

interface PackRevealProps {
  cards: PulledCard[];
  onOpenAnother: () => void;
  onClose: () => void;
}

export function PackReveal({ cards, onOpenAnother, onClose }: PackRevealProps) {
  const navigate = useNavigate();
  const [revealedCount, setRevealedCount] = useState(0);
  const allRevealed = revealedCount >= cards.length;

  return (
    <div className="fixed inset-0 z-50 bg-background/90 backdrop-blur-sm flex flex-col items-center justify-center gap-6 p-4">
      <h2 className="font-display text-2xl font-bold text-foreground uppercase tracking-wider">
        {allRevealed ? "Pack Opened!" : "Revealing..."}
      </h2>

      <div className="flex flex-wrap justify-center gap-4 max-w-3xl">
        {cards.map((card, i) => (
          <RevealCard
            key={`${card.id}-${i}`}
            card={card}
            delay={i * 600}
            onRevealed={() => setRevealedCount((c) => c + 1)}
          />
        ))}
      </div>

      {allRevealed && (
        <div className="flex gap-3 mt-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <Button onClick={onOpenAnother}>Open Another</Button>
          <Button variant="secondary" onClick={() => navigate("/collection")}>
            View Collection
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Back to Market
          </Button>
        </div>
      )}
    </div>
  );
}
