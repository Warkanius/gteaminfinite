import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { RevealCard, RevealCardHandle } from "@/components/packs/RevealCard";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Dices } from "lucide-react";
import { runRatingToStars, starStatToRunStat } from "@/lib/gameEngine";

interface Props {
  runId: string;
  teamId: string | null;
  onLineupConfirmed: (playerLineup: any[], cpuLineup: any[]) => void;
}

export function RunLineupSelect({ runId, teamId, onLineupConfirmed }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [cpuLineup, setCpuLineup] = useState<any[]>([]);
  const [revealIndex, setRevealIndex] = useState(-1);
  const [isRolling, setIsRolling] = useState(false);

  const revealRefs = useRef<(RevealCardHandle | null)[]>([]);

  // Fetch user's collection
  const { data: collection, isLoading: isCollectionLoading } = useQuery({
    queryKey: ["collection-runs", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_collections")
        .select(`player_card_id, player_cards(*, gem_tiers(*))`)
        .eq("user_id", user?.id)
        .order("acquired_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  // Fetch CPU roster from run_players (the actual run roster, not team-based)
  const { data: cpuRoster, isLoading: isRosterLoading } = useQuery({
    queryKey: ["run-players-roster", runId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("run_players")
        .select(`*, player_cards(*, gem_tiers(*))`)
        .eq("run_id", runId);
      if (error) throw error;
      // Map to card-like objects with run stats overlaid
      return (data ?? []).map((rp) => {
        const base = rp.player_cards as any;
        return {
          ...base,
          // Keep raw numerical values for game logic
          stat_3pt: rp.run_stat_3pt,
          stat_mid: rp.run_stat_mid,
          stat_fin: rp.run_stat_fin,
          stat_dnk: rp.run_stat_dnk,
          stat_stl: rp.run_stat_stl,
          stat_blk: rp.run_stat_blk,
          stat_ast: rp.run_stat_ast,
          stat_reb: rp.run_stat_reb,
          stat_int: rp.run_stat_int,
          // Keep raw run_rating for game engine, convert for display
          _runRating: rp.run_rating,
          rating: runRatingToStars(rp.run_rating),
        };
      });
    },
    enabled: !!runId,
  });

  const handleCardClick = (cardId: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(cardId)) {
      newSelected.delete(cardId);
    } else {
      if (newSelected.size >= 3) {
        toast({ title: "Lineup Full", description: "You can only select 3 players for The Runs.", variant: "destructive" });
        return;
      }
      newSelected.add(cardId);
    }
    setSelectedIds(newSelected);
  };

  const handleRollOpponents = () => {
    if (selectedIds.size !== 3) {
      toast({ title: "Incomplete Lineup", description: "Please select 3 players first." });
      return;
    }
    if (!cpuRoster || cpuRoster.length < 3) {
      toast({ title: "Roster Error", description: "Opponent team doesn't have enough players.", variant: "destructive" });
      return;
    }

    setIsRolling(true);
    
    // Simulate 4d6 (range 4 to 24) to pick 3 unique opponents
    // We map 4-24 to 0-20 to match array indexes (or wrap around using modulo)
    const picks: any[] = [];
    const usedIndexes = new Set<number>();
    
    while (picks.length < 3) {
      const d1 = Math.floor(Math.random() * 6) + 1;
      const d2 = Math.floor(Math.random() * 6) + 1;
      const d3 = Math.floor(Math.random() * 6) + 1;
      const d4 = Math.floor(Math.random() * 6) + 1;
      const rollTotal = d1 + d2 + d3 + d4; // 4 to 24
      
      const index = (rollTotal - 4) % cpuRoster.length;
      if (!usedIndexes.has(index)) {
        usedIndexes.add(index);
        picks.push(cpuRoster[index]);
      }
    }

    setCpuLineup(picks);
    setTimeout(() => {
      setRevealIndex(0);
      setIsRolling(false);
    }, 1000);
  };

  useEffect(() => {
    if (revealIndex >= 0 && revealIndex < cpuLineup.length) {
      const timer = setTimeout(() => {
        revealRefs.current[revealIndex]?.reveal();
        setTimeout(() => setRevealIndex(revealIndex + 1), 1000);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [revealIndex, cpuLineup.length]);

  const allRevealed = revealIndex >= cpuLineup.length && cpuLineup.length > 0;

  const playerLineup = Array.from(selectedIds).map(id => 
    collection?.find(c => c.player_card_id === id)?.player_cards
  ).filter(Boolean);

  return (
    <div className="space-y-8">
      <div className="bg-card border border-border/50 rounded-xl p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="font-display text-2xl tracking-wider">Your Lineup</h2>
          <div className="text-sm font-semibold bg-primary/10 text-primary px-3 py-1 rounded-full">
            {selectedIds.size} / 3 Selected
          </div>
        </div>

        <div className="flex gap-4 min-h-[200px] mb-8 overflow-x-auto pb-4">
          {playerLineup.map((card: any, i) => (
            <div key={card.id} className="w-32 sm:w-36 shrink-0 relative">
              <div className="absolute -top-3 -left-3 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold z-10 shadow-lg border-2 border-background">
                {i + 1}
              </div>
              <div onClick={() => handleCardClick(card.id)} className="cursor-pointer">
                <PlayerCard card={card} />
              </div>
            </div>
          ))}
          {Array.from({ length: 3 - playerLineup.length }).map((_, i) => (
            <div key={`empty-${i}`} className="w-32 sm:w-36 shrink-0 h-44 sm:h-48 border-2 border-dashed border-border/50 rounded-lg flex items-center justify-center text-muted-foreground text-sm font-semibold opacity-50">
              Empty Slot
            </div>
          ))}
        </div>

        {cpuLineup.length === 0 ? (
          <Button 
            className="w-full font-display text-lg tracking-wider" 
            size="lg" 
            disabled={selectedIds.size !== 3 || isRolling}
            onClick={handleRollOpponents}
          >
            {isRolling ? "ROLLING 4D6..." : "ROLL OPPONENTS"}
            {!isRolling && <Dices className="ml-2 h-5 w-5" />}
          </Button>
        ) : (
          <div className="space-y-6 border-t border-border/50 pt-6">
            <h2 className="font-display text-2xl tracking-wider">CPU Lineup (4d6 Roll)</h2>
            <div className="flex gap-4 min-h-[200px] overflow-x-auto pb-4">
              {cpuLineup.map((card, idx) => (
                <div key={`cpu-${idx}`} className="w-32 sm:w-36 shrink-0 relative">
                  <div className="absolute -top-3 -left-3 w-8 h-8 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center font-bold z-10 shadow-lg border-2 border-background">
                    {idx + 1}
                  </div>
                  <RevealCard
                    ref={el => revealRefs.current[idx] = el}
                    card={card}
                  />
                </div>
              ))}
            </div>
            {allRevealed && (
              <Button 
                className="w-full font-display text-lg tracking-wider bg-gem-diamond hover:bg-gem-diamond/90 text-black" 
                size="lg"
                onClick={() => onLineupConfirmed(playerLineup, cpuLineup)}
              >
                START GAUNTLET
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="space-y-4">
        <h3 className="font-display text-xl tracking-wider">Your Collection</h3>
        {isCollectionLoading ? (
          <div className="flex h-32 items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>
        ) : (
          <div className="flex flex-wrap gap-4">
            {collection?.map((c: any) => {
              const card = c.player_cards;
              if (!card) return null;
              const isSelected = selectedIds.has(card.id);
              return (
                <div key={card.id} className="relative w-32 sm:w-36 shrink-0 transition-transform hover:-translate-y-1">
                  <div onClick={() => handleCardClick(card.id)} className="cursor-pointer">
                    <PlayerCard card={card} />
                  </div>
                  {isSelected && (
                    <div className="absolute inset-0 bg-background/50 rounded-lg flex items-center justify-center border-4 border-primary">
                      <div className="bg-primary text-primary-foreground font-bold px-3 py-1 rounded-full text-sm">
                        Selected
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
