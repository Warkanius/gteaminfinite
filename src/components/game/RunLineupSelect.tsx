import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { RevealCard, RevealCardHandle } from "@/components/packs/RevealCard";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Dices } from "lucide-react";
import { starStatToRunStat } from "@/lib/gameEngine";
import { fetchBadgesForCards, type CardBadge } from "@/lib/badgeEngine";
import { fetchTraitsForCards, type CardTrait } from "@/lib/traitEngine";

interface Props {
  runId: string;
  teamId: string | null;
  onLineupConfirmed: (playerLineup: any[], cpuLineup: any[], badgeMap: Record<string, CardBadge[]>, traitMap: Record<string, CardTrait[]>) => void;
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
      // Map to objects carrying both display + game representations
      return (data ?? []).map((rp) => {
        const displayCard = rp.player_cards as any;
        const gameCard = {
          ...displayCard,
          // Raw numerical run-stat values for game engine
          stat_3pt: rp.run_stat_3pt,
          stat_mid: rp.run_stat_mid,
          stat_fin: rp.run_stat_fin,
          stat_dnk: rp.run_stat_dnk,
          stat_stl: rp.run_stat_stl,
          stat_blk: rp.run_stat_blk,
          stat_ast: rp.run_stat_ast,
          stat_reb: rp.run_stat_reb,
          stat_int: rp.run_stat_int,
          _runRating: rp.run_rating,
          // Preserve untouched display card for UI rendering
          _displayCard: displayCard,
        };
        return { displayCard, gameCard };
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

  // Original cards for display (consistent card art, real star stats, gem_tiers preserved)
  const selectedDisplayCards = Array.from(selectedIds).map(id => {
    return collection?.find(c => c.player_card_id === id)?.player_cards as any;
  }).filter(Boolean);

  // Run-stat overlaid cards for game logic only — carry _displayCard for downstream rendering
  const playerGameLineup = selectedDisplayCards.map((card: any) => ({
    ...card,
    stat_3pt: card.run_stat_3pt ?? starStatToRunStat(card.stat_3pt),
    stat_mid: card.run_stat_mid ?? starStatToRunStat(card.stat_mid),
    stat_fin: card.run_stat_fin ?? starStatToRunStat(card.stat_fin),
    stat_dnk: card.run_stat_dnk ?? starStatToRunStat(card.stat_dnk),
    stat_stl: card.run_stat_stl ?? starStatToRunStat(card.stat_stl),
    stat_blk: card.run_stat_blk ?? starStatToRunStat(card.stat_blk),
    stat_ast: card.run_stat_ast ?? starStatToRunStat(card.stat_ast),
    stat_reb: card.run_stat_reb ?? starStatToRunStat(card.stat_reb),
    stat_int: card.run_stat_int ?? starStatToRunStat(card.stat_int),
    _runRating: card.run_rating ?? starStatToRunStat(card.rating),
    _displayCard: card,
  }));

  return (
    <div className="space-y-8">
      <div className="bg-card border border-border/50 rounded-xl p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="font-display text-2xl tracking-wider">Your Lineup</h2>
          <div className="text-sm font-semibold bg-primary/10 text-primary px-3 py-1 rounded-full">
            {selectedIds.size} / 3 Selected
          </div>
        </div>

      <div className="flex gap-3 min-h-[200px] mb-8 overflow-x-auto pb-4">
          {selectedDisplayCards.map((card: any, i) => (
            <div key={card.id} className="w-[120px] sm:w-[140px] shrink-0 relative">
              <div className="absolute -top-3 -left-3 w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold z-10 shadow-lg border-2 border-background">
                {i + 1}
              </div>
              <div onClick={() => handleCardClick(card.id)} className="cursor-pointer">
                <PlayerCard card={card} gemTier={card.gem_tiers} />
              </div>
            </div>
          ))}
          {Array.from({ length: 3 - selectedDisplayCards.length }).map((_, i) => (
            <div key={`empty-${i}`} className="w-[120px] sm:w-[140px] shrink-0 h-44 sm:h-48 border-2 border-dashed border-border/50 rounded-lg flex items-center justify-center text-muted-foreground text-sm font-semibold opacity-50">
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
            <div className="flex gap-3 min-h-[200px] overflow-x-auto pb-4">
              {cpuLineup.map((entry: any, idx) => (
                <div key={`cpu-${idx}`} className="w-[120px] sm:w-[140px] shrink-0 relative">
                  <div className="absolute -top-3 -left-3 w-8 h-8 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center font-bold z-10 shadow-lg border-2 border-background">
                    {idx + 1}
                  </div>
                  <RevealCard
                    ref={el => revealRefs.current[idx] = el}
                    card={entry.displayCard}
                  />
                </div>
              ))}
            </div>
            {allRevealed && (
              <Button 
                className="w-full font-display text-lg tracking-wider bg-gem-diamond hover:bg-gem-diamond/90 text-black" 
                size="lg"
                onClick={async () => {
                  const cpuGameLineup = cpuLineup.map((e: any) => e.gameCard);
                  const allCardIds = [
                    ...playerGameLineup.map((c: any) => c.id),
                    ...cpuGameLineup.map((c: any) => c.id),
                  ];
                  const [badgeMap, traitMap] = await Promise.all([
                    fetchBadgesForCards(supabase, allCardIds),
                    fetchTraitsForCards(supabase, allCardIds),
                  ]);
                  onLineupConfirmed(playerGameLineup, cpuGameLineup, badgeMap, traitMap);
                }}
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
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {collection?.map((c: any) => {
              const card = c.player_cards;
              if (!card) return null;
              const isSelected = selectedIds.has(card.id);
              return (
                <div key={card.id} className="relative w-full transition-transform hover:-translate-y-1">
                  <div onClick={() => handleCardClick(card.id)} className="cursor-pointer">
                    <PlayerCard card={card} gemTier={card.gem_tiers} />
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
