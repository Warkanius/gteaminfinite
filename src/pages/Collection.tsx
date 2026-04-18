import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { PlayerCard } from "@/components/cards/PlayerCard";
import { CardDetailDialog } from "@/components/cards/CardDetailDialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Gift, CheckCircle2, LayoutGrid, BookOpen } from "lucide-react";
import { toast } from "sonner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function Collection() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState("all");
  const [posFilter, setPosFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"name" | "rating">("rating");
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"all" | "by-collection">("all");
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(null);
  const [activeSubCollectionId, setActiveSubCollectionId] = useState<string | null>(null);

  // Fetch raw collection entries
  const { data: rawCollection = [], isLoading } = useQuery({
    queryKey: ["user-collection", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_collections")
        .select("*, player_cards(*, player_card_badges(id))")
        .eq("user_id", user!.id);
      if (error) throw error;
      return data;
    },
  });

  const { data: gemTiers = [] } = useQuery({
    queryKey: ["gem-tiers"],
    queryFn: async () => {
      const { data } = await supabase.from("gem_tiers").select("*").order("sort_order");
      return data ?? [];
    },
  });

  const { data: teams = [] } = useQuery({
    queryKey: ["teams"],
    queryFn: async () => {
      const { data } = await supabase.from("teams").select("*");
      return data ?? [];
    },
  });

  const { data: totalCardsInGame = 0 } = useQuery({
    queryKey: ["total-player-cards"],
    queryFn: async () => {
      const { count } = await supabase.from("player_cards").select("id", { count: "exact", head: true });
      return count ?? 0;
    },
  });

  // Fetch all collections and sub-collections for reward tracking
  const { data: collections = [] } = useQuery({
    queryKey: ["collections-all"],
    queryFn: async () => {
      const { data } = await supabase.from("collections").select("*, packs:reward_pack_id(id, name)").order("name");
      return data ?? [];
    },
  });

  const { data: subCollections = [] } = useQuery({
    queryKey: ["sub-collections-all"],
    queryFn: async () => {
      const { data } = await supabase.from("sub_collections").select("*, packs:reward_pack_id(id, name)").order("name");
      return data ?? [];
    },
  });

  // User's claimed non-card collection rewards
  const { data: claimedRewards = [] } = useQuery({
    queryKey: ["user-collection-claims", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data } = await supabase
        .from("user_collection_claims")
        .select("collection_id, sub_collection_id")
        .eq("user_id", user!.id);
      return data ?? [];
    },
  });

  const claimedKeys = useMemo(() => {
    const s = new Set<string>();
    for (const c of claimedRewards as any[]) {
      if (c.sub_collection_id) s.add(`sub:${c.sub_collection_id}`);
      else if (c.collection_id) s.add(`col:${c.collection_id}`);
    }
    return s;
  }, [claimedRewards]);

  // Fetch ALL player cards to compute collection completion + render missing slots
  const { data: allPlayerCards = [] } = useQuery({
    queryKey: ["all-player-cards-collection"],
    queryFn: async () => {
      const { data } = await supabase.from("player_cards").select("id, name, rating, position1, position2, gem_name, gem_tier_id, card_color_primary, card_color_secondary, card_glow_color, card_animation, collection_id, sub_collection_id, is_collection_reward");
      return data ?? [];
    },
  });

  // Fetch evolution links so we can treat an evo chain as a single collection slot.
  const { data: evoLinks = [] } = useQuery({
    queryKey: ["evo-links-collection"],
    queryFn: async () => {
      const { data } = await supabase
        .from("evo_paths")
        .select("player_card_id, evolves_to_card_id")
        .not("evolves_to_card_id", "is", null);
      return data ?? [];
    },
  });

  // Build chain maps:
  //  - chainRootOf[cardId] = the BASE (root) card of the evo chain it belongs to
  //  - chainMembersOf[rootId] = ordered list of all card ids in that chain (root first)
  const { chainRootOf, chainMembersOf } = useMemo(() => {
    // Forward: parent -> child
    const childOf = new Map<string, string>();
    // Reverse: child -> parent
    const parentOf = new Map<string, string>();
    for (const link of evoLinks as any[]) {
      const from = link.player_card_id as string;
      const to = link.evolves_to_card_id as string;
      if (!from || !to || from === to) continue;
      childOf.set(from, to);
      parentOf.set(to, from);
    }

    const rootOf = new Map<string, string>();
    const membersOf = new Map<string, string[]>();

    const findRoot = (id: string): string => {
      const seen = new Set<string>();
      let cur = id;
      while (parentOf.has(cur) && !seen.has(cur)) {
        seen.add(cur);
        cur = parentOf.get(cur)!;
      }
      return cur;
    };

    for (const pc of allPlayerCards as any[]) {
      const root = findRoot(pc.id);
      rootOf.set(pc.id, root);
    }

    // Walk forward from each root to collect ordered members
    const allIds = new Set((allPlayerCards as any[]).map((p: any) => p.id));
    const visitedRoots = new Set<string>();
    for (const pc of allPlayerCards as any[]) {
      const root = rootOf.get(pc.id)!;
      if (visitedRoots.has(root)) continue;
      visitedRoots.add(root);
      const ordered: string[] = [];
      let cur: string | undefined = root;
      const seen = new Set<string>();
      while (cur && allIds.has(cur) && !seen.has(cur)) {
        ordered.push(cur);
        seen.add(cur);
        cur = childOf.get(cur);
      }
      membersOf.set(root, ordered);
    }

    return { chainRootOf: rootOf, chainMembersOf: membersOf };
  }, [evoLinks, allPlayerCards]);

  const gemTierMap = useMemo(() => Object.fromEntries(gemTiers.map((g: any) => [g.id, g])), [gemTiers]);
  const teamMap = useMemo(() => Object.fromEntries(teams.map((t: any) => [t.id, t.name])), [teams]);

  // Group by player_card_id for duplicate counting & dedup display
  const { groupedCards, duplicateMap, lockMap, collectionIdMap, sourceMap, sellableCountMap } = useMemo(() => {
    const dupMap: Record<string, number> = {};
    const lockMap: Record<string, boolean> = {};
    const colIdMap: Record<string, string> = {};
    const srcMap: Record<string, string> = {};
    const sellableMap: Record<string, number> = {};
    const NON_SELLABLE = new Set(["gem_market", "collection_reward", "starter_pack", "locker_code"]);

    for (const entry of rawCollection as any[]) {
      const pcId = entry.player_card_id;
      dupMap[pcId] = (dupMap[pcId] || 0) + 1;
      if (entry.is_locked) lockMap[pcId] = true;

      // Count unlocked + sellable copies (excludes reward sources)
      const isSellable = !entry.is_locked && !NON_SELLABLE.has(entry.source ?? "standard_pack");
      if (isSellable) sellableMap[pcId] = (sellableMap[pcId] || 0) + 1;

      // For quicksell: always prefer an unlocked SELLABLE entry over anything else
      const currentBest = colIdMap[pcId];
      if (!currentBest) {
        colIdMap[pcId] = entry.id;
      } else {
        const currentEntry = (rawCollection as any[]).find((e: any) => e.id === currentBest);
        const currentIsSellable = currentEntry && !currentEntry.is_locked && !NON_SELLABLE.has(currentEntry.source ?? "standard_pack");
        const newIsSellable = isSellable;
        if (!currentIsSellable && newIsSellable) {
          colIdMap[pcId] = entry.id;
        }
      }

      if (!srcMap[pcId]) srcMap[pcId] = entry.source ?? "standard_pack";
      if (entry.source === "standard_pack") srcMap[pcId] = "standard_pack";
    }

    const seen = new Set<string>();
    const grouped: any[] = [];
    for (const entry of rawCollection as any[]) {
      const pc = entry.player_cards;
      if (!pc || seen.has(pc.id)) continue;
      seen.add(pc.id);
      grouped.push(pc);
    }

    return { groupedCards: grouped, duplicateMap: dupMap, lockMap, collectionIdMap: colIdMap, sourceMap: srcMap, sellableCountMap: sellableMap };
  }, [rawCollection]);

  // Set of player_card_ids user owns
  const ownedCardIds = useMemo(() => new Set(groupedCards.map((c: any) => c.id)), [groupedCards]);

  const ownedCardMap = useMemo(() => Object.fromEntries(groupedCards.map((c: any) => [c.id, c])), [groupedCards]);

  // Chain-aware ownership: a chain (root) is owned if ANY of its members is owned.
  const ownedChainRoots = useMemo(() => {
    const s = new Set<string>();
    for (const c of groupedCards as any[]) {
      const root = chainRootOf.get(c.id) ?? c.id;
      s.add(root);
    }
    return s;
  }, [groupedCards, chainRootOf]);

  // Returns true if this card OR any evo-linked sibling/ancestor/descendant is owned.
  const isOwnedSlot = (cardId: string) => {
    const root = chainRootOf.get(cardId) ?? cardId;
    return ownedChainRoots.has(root);
  };

  // Collections that have at least one card assigned
  const populatedCollections = useMemo(() => {
    const ids = new Set((allPlayerCards as any[]).map((pc) => pc.collection_id).filter(Boolean));
    return (collections as any[]).filter((c) => ids.has(c.id));
  }, [collections, allPlayerCards]);

  // Sub-collections under the active collection
  const activeSubCollections = useMemo(() => {
    if (!activeCollectionId) return [];
    const subIds = new Set(
      (allPlayerCards as any[])
        .filter((pc) => pc.collection_id === activeCollectionId && pc.sub_collection_id)
        .map((pc) => pc.sub_collection_id)
    );
    return (subCollections as any[]).filter((sc) => sc.collection_id === activeCollectionId && subIds.has(sc.id));
  }, [activeCollectionId, allPlayerCards, subCollections]);

  // Auto-pick the first populated collection when entering "by-collection" mode
  useEffect(() => {
    if (viewMode === "by-collection" && !activeCollectionId && populatedCollections.length > 0) {
      setActiveCollectionId(populatedCollections[0].id);
    }
  }, [viewMode, activeCollectionId, populatedCollections]);

  // Cards belonging to the currently active collection / sub-collection scope.
  // We dedupe evo-linked cards into a single slot (keyed by chain root). The
  // displayed card is the best owned variant in the chain (highest rating); if
  // the user owns nothing in the chain, we display the base card so the slot
  // still shows the original art/name.
  const activeScopeCards = useMemo(() => {
    if (!activeCollectionId) return { regular: [], reward: null as any };
    let scope = (allPlayerCards as any[]).filter((pc) => pc.collection_id === activeCollectionId);
    if (activeSubCollectionId) {
      scope = scope.filter((pc) => pc.sub_collection_id === activeSubCollectionId);
    } else {
      // top-level scope: cards directly in collection without sub
      scope = scope.filter((pc) => !pc.sub_collection_id);
    }
    const rawRegular = scope.filter((pc) => !pc.is_collection_reward);
    const reward = scope.find((pc) => pc.is_collection_reward) ?? null;

    // Dedupe by chain root. Slot identity = the base/root card in the chain
    // (so missing slots always show the base art). When owned, we'll swap in
    // the best owned variant at render time.
    const allCardsById = new Map<string, any>((allPlayerCards as any[]).map((p: any) => [p.id, p]));
    const seenRoots = new Set<string>();
    const slots: any[] = [];
    for (const pc of rawRegular) {
      const root = chainRootOf.get(pc.id) ?? pc.id;
      if (seenRoots.has(root)) continue;
      seenRoots.add(root);
      // Prefer the actual base card if it exists in our card list, else fall back to this card.
      const baseCard = allCardsById.get(root) ?? pc;
      slots.push(baseCard);
    }

    // owned first (by rating desc), then missing (by rating desc)
    slots.sort((a: any, b: any) => {
      const ao = isOwnedSlot(a.id) ? 1 : 0;
      const bo = isOwnedSlot(b.id) ? 1 : 0;
      if (ao !== bo) return bo - ao;
      return (b.rating ?? 0) - (a.rating ?? 0);
    });
    return { regular: slots, reward };
  }, [activeCollectionId, activeSubCollectionId, allPlayerCards, ownedChainRoots, chainRootOf]);

  // Helper: resolve reward info for a collection or sub_collection row
  type RewardInfo = {
    rewardType: "card" | "coins" | "gems" | "pack";
    rewardCardId: string | null;
    rewardLabel: string;
    rewardCoins?: number;
    rewardGems?: number;
    rewardPackId?: string | null;
    alreadyClaimed: boolean;
  };

  const resolveReward = (
    row: any,
    scope: "collection" | "sub_collection",
    rewardCard: any | null,
  ): RewardInfo => {
    const rt = (row?.reward_type ?? "card") as RewardInfo["rewardType"];
    const claimedKey = scope === "sub_collection" ? `sub:${row.id}` : `col:${row.id}`;
    if (rt === "coins") {
      return {
        rewardType: "coins",
        rewardCardId: null,
        rewardLabel: `${row.reward_coins ?? 0} Coins`,
        rewardCoins: row.reward_coins ?? 0,
        alreadyClaimed: claimedKeys.has(claimedKey),
      };
    }
    if (rt === "gems") {
      return {
        rewardType: "gems",
        rewardCardId: null,
        rewardLabel: `${row.reward_gems ?? 0} Gems`,
        rewardGems: row.reward_gems ?? 0,
        alreadyClaimed: claimedKeys.has(claimedKey),
      };
    }
    if (rt === "pack") {
      return {
        rewardType: "pack",
        rewardCardId: null,
        rewardLabel: row.packs?.name ? `Pack: ${row.packs.name}` : "Pack reward",
        rewardPackId: row.reward_pack_id ?? null,
        alreadyClaimed: claimedKeys.has(claimedKey),
      };
    }
    return {
      rewardType: "card",
      rewardCardId: rewardCard?.id ?? null,
      rewardLabel: rewardCard?.name ?? "Reward card",
      alreadyClaimed: rewardCard ? isOwnedSlot(rewardCard.id) : false,
    };
  };

  // Collection reward completion tracking — counts evo chains as a single slot.
  const collectionRewardStatus = useMemo(() => {
    const results: {
      id: string;
      name: string;
      type: "collection" | "sub_collection";
      needed: number;
      owned: number;
      complete: boolean;
      reward: RewardInfo;
    }[] = [];

    // Dedupe a list of cards down to one entry per evo chain (keyed by chain root id).
    const dedupeByChain = (cards: any[]) => {
      const seen = new Set<string>();
      const out: any[] = [];
      for (const pc of cards) {
        const root = chainRootOf.get(pc.id) ?? pc.id;
        if (seen.has(root)) continue;
        seen.add(root);
        out.push({ ...pc, chainRoot: root });
      }
      return out;
    };

    for (const sc of subCollections as any[]) {
      const rawCardsInSet = (allPlayerCards as any[]).filter(
        (pc: any) => pc.sub_collection_id === sc.id && !pc.is_collection_reward
      );
      const cardsInSet = dedupeByChain(rawCardsInSet);
      const rewardCard = (allPlayerCards as any[]).find(
        (pc: any) => pc.sub_collection_id === sc.id && pc.is_collection_reward
      );
      const reward = resolveReward(sc, "sub_collection", rewardCard);
      if (cardsInSet.length === 0) continue;
      if (reward.rewardType === "card" && !rewardCard) continue;

      const ownedCount = cardsInSet.filter((pc: any) => ownedChainRoots.has(pc.chainRoot)).length;
      results.push({
        id: sc.id,
        name: sc.name,
        type: "sub_collection",
        needed: cardsInSet.length,
        owned: ownedCount,
        complete: ownedCount >= cardsInSet.length,
        reward,
      });
    }

    for (const col of collections as any[]) {
      const rawCardsInSet = (allPlayerCards as any[]).filter(
        (pc: any) => pc.collection_id === col.id && !pc.sub_collection_id && !pc.is_collection_reward
      );
      const cardsInSet = dedupeByChain(rawCardsInSet);
      const rewardCard = (allPlayerCards as any[]).find(
        (pc: any) => pc.collection_id === col.id && !pc.sub_collection_id && pc.is_collection_reward
      );
      const reward = resolveReward(col, "collection", rewardCard);
      if (cardsInSet.length === 0) continue;
      if (reward.rewardType === "card" && !rewardCard) continue;

      const ownedCount = cardsInSet.filter((pc: any) => ownedChainRoots.has(pc.chainRoot)).length;
      results.push({
        id: col.id,
        name: col.name,
        type: "collection",
        needed: cardsInSet.length,
        owned: ownedCount,
        complete: ownedCount >= cardsInSet.length,
        reward,
      });
    }

    return results;
  }, [collections, subCollections, allPlayerCards, ownedChainRoots, chainRootOf]);

  // Claim collection reward (handles card / coins / gems / pack)
  const claimRewardMutation = useMutation({
    mutationFn: async (params: {
      rewardType: "card" | "coins" | "gems" | "pack";
      rewardCardId?: string | null;
      coins?: number;
      gems?: number;
      packId?: string | null;
      collectionId?: string | null;
      subCollectionId?: string | null;
    }) => {
      const { rewardType, rewardCardId, coins, gems, packId, collectionId, subCollectionId } = params;

      if (rewardType === "card") {
        if (!rewardCardId) throw new Error("Missing reward card");
        const { error } = await supabase.from("user_collections").insert({
          user_id: user!.id,
          player_card_id: rewardCardId,
          source: "collection_reward",
        });
        if (error) throw error;
        return { rewardType };
      }

      // Non-card reward: requires a target collection/sub_collection to mark claimed
      if (!collectionId && !subCollectionId) throw new Error("Missing claim target");

      // Insert claim record first (unique index prevents double-claim)
      const { error: claimErr } = await supabase.from("user_collection_claims").insert({
        user_id: user!.id,
        collection_id: subCollectionId ? null : collectionId,
        sub_collection_id: subCollectionId ?? null,
        reward_type: rewardType,
      });
      if (claimErr) throw claimErr;

      if (rewardType === "coins" || rewardType === "gems") {
        const { data: profile, error: pErr } = await supabase
          .from("profiles")
          .select("id, coins, gems")
          .eq("user_id", user!.id)
          .single();
        if (pErr || !profile) throw new Error("Profile not found");

        const update: any = {};
        if (rewardType === "coins") update.coins = (profile.coins ?? 0) + (coins ?? 0);
        if (rewardType === "gems") update.gems = (profile.gems ?? 0) + (gems ?? 0);

        const { error: upErr } = await supabase.from("profiles").update(update).eq("id", profile.id);
        if (upErr) throw upErr;
        return { rewardType, amount: rewardType === "coins" ? coins : gems };
      }

      if (rewardType === "pack") {
        if (!packId) throw new Error("Missing pack");
        const { error } = await supabase.from("user_pack_inventory").insert({
          user_id: user!.id,
          pack_id: packId,
          source: "collection_reward",
        });
        if (error) throw error;
        return { rewardType };
      }

      throw new Error(`Unknown reward type: ${rewardType}`);
    },
    onSuccess: (data: any) => {
      if (data?.rewardType === "coins") toast.success(`Claimed ${data.amount} coins!`);
      else if (data?.rewardType === "gems") toast.success(`Claimed ${data.amount} gems!`);
      else if (data?.rewardType === "pack") toast.success("Pack added to your inventory!");
      else toast.success("Collection reward claimed!");
      queryClient.invalidateQueries({ queryKey: ["user-collection"] });
      queryClient.invalidateQueries({ queryKey: ["user-collection-claims"] });
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      queryClient.invalidateQueries({ queryKey: ["user-pack-inventory"] });
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to claim reward");
    },
  });

  // Filter & sort
  const cards = useMemo(() => {
    let items = [...groupedCards];
    if (search) {
      const q = search.toLowerCase();
      items = items.filter((c: any) => c.name.toLowerCase().includes(q) || (c.gem_name ?? "").toLowerCase().includes(q));
    }
    if (tierFilter !== "all") {
      items = items.filter((c: any) => c.gem_tier_id === tierFilter);
    }
    if (posFilter !== "all") {
      items = items.filter((c: any) => c.position1 === posFilter || c.position2 === posFilter);
    }
    items.sort((a: any, b: any) => sortBy === "rating" ? b.rating - a.rating : a.name.localeCompare(b.name));
    return items;
  }, [groupedCards, search, tierFilter, posFilter, sortBy]);

  // Stats
  const uniqueOwned = groupedCards.length;
  const completionPct = totalCardsInGame > 0 ? Math.round((uniqueOwned / totalCardsInGame) * 100) : 0;

  // Tier breakdown
  const tierBreakdown = useMemo(() => {
    return gemTiers.map((tier: any) => {
      const owned = groupedCards.filter((c: any) => c.gem_tier_id === tier.id).length;
      return { ...tier, owned };
    });
  }, [gemTiers, groupedCards]);

  const { data: tierTotals = {} } = useQuery({
    queryKey: ["tier-totals"],
    queryFn: async () => {
      const { data } = await supabase.from("player_cards").select("gem_tier_id");
      const counts: Record<string, number> = {};
      for (const row of data ?? []) {
        if (row.gem_tier_id) counts[row.gem_tier_id] = (counts[row.gem_tier_id] || 0) + 1;
      }
      return counts;
    },
  });

  const selectedCard = cards.find((c: any) => c.id === selectedCardId) ?? null;

  const { data: selectedBadges = [] } = useQuery({
    queryKey: ["card-badges", selectedCardId],
    enabled: !!selectedCardId,
    queryFn: async () => {
      const { data } = await supabase
        .from("player_card_badges")
        .select("tier, badges(name)")
        .eq("player_card_id", selectedCardId!);
      return (data ?? []).map((d: any) => ({ name: d.badges?.name ?? "", tier: d.tier }));
    },
  });

  const { data: selectedTraits = [] } = useQuery({
    queryKey: ["card-traits", selectedCardId],
    enabled: !!selectedCardId,
    queryFn: async () => {
      const { data } = await supabase
        .from("player_card_traits")
        .select("tier, target_stat, signature_traits(name)")
        .eq("player_card_id", selectedCardId!);
      return (data ?? []).map((d: any) => ({ name: d.signature_traits?.name ?? "", tier: d.tier, target_stat: d.target_stat }));
    },
  });

  const toggleLockMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCardId) return;
      const entries = (rawCollection as any[]).filter((e) => e.player_card_id === selectedCardId);
      const anyLocked = entries.some((e: any) => e.is_locked);
      for (const entry of entries) {
        await supabase.from("user_collections").update({ is_locked: !anyLocked }).eq("id", entry.id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-collection"] });
    },
  });

  const quicksellMutation = useMutation({
    mutationFn: async () => {
      if (!selectedCardId) throw new Error("No card selected");
      const collectionId = collectionIdMap[selectedCardId];
      if (!collectionId) throw new Error("No collection entry found");
      const res = await supabase.functions.invoke("quicksell-card", {
        body: { collection_id: collectionId },
      });
      if (res.error) throw new Error(res.error.message);
      return res.data;
    },
    onSuccess: (data: any) => {
      toast.success(`Sold for ${data.coin_value} coins! Balance: ${data.coins}`);
      queryClient.invalidateQueries({ queryKey: ["user-collection"] });
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      setSelectedCardId(null);
    },
    onError: (err: any) => {
      toast.error(err.message || "Quicksell failed");
    },
  });

  const POSITIONS = ["PG", "SG", "SF", "PF", "C"];
  const isHsl = (c: string) => /^\d+\s/.test(c);
  const bg = (c: string) => isHsl(c) ? `hsl(${c})` : c;

  // Claimable rewards
  const claimableRewards = collectionRewardStatus.filter((r) => r.complete && !r.reward.alreadyClaimed);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">My Collection</h1>

      {/* Stats Header */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-baseline gap-3">
          <span className="text-3xl font-bold text-primary">{completionPct}%</span>
          <span className="text-sm text-muted-foreground">
            {uniqueOwned} / {totalCardsInGame} unique cards
          </span>
        </div>
        <Progress value={completionPct} className="h-2" />

        {/* Tier breakdown */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 pt-1">
          {tierBreakdown.map((tier: any) => {
            const total = (tierTotals as Record<string, number>)[tier.id] || 0;
            const pct = total > 0 ? Math.round((tier.owned / total) * 100) : 0;
            return (
              <div key={tier.id} className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium" style={{ color: bg(tier.color) }}>{tier.name}</span>
                  <span className="text-muted-foreground">{tier.owned}/{total}</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${pct}%`, backgroundColor: bg(tier.color) }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Collection Rewards */}
      {collectionRewardStatus.length > 0 && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-2">
            <Gift className="h-4 w-4 text-primary" /> Collection Rewards
          </h2>
          <div className="space-y-2">
            {collectionRewardStatus.map((r) => {
              const pct = r.needed > 0 ? Math.round((r.owned / r.needed) * 100) : 0;
              return (
                <div key={r.id} className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between text-xs mb-0.5">
                      <span className="font-medium truncate">{r.name}</span>
                      <span className="text-muted-foreground">{r.owned}/{r.needed}</span>
                    </div>
                    <Progress value={pct} className="h-1.5" />
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      Reward: {r.reward.rewardLabel}
                    </p>
                  </div>
                  {r.reward.alreadyClaimed ? (
                    <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
                  ) : r.complete ? (
                    <Button
                      size="sm"
                      variant="default"
                      className="shrink-0 text-xs"
                      onClick={() => claimRewardMutation.mutate({
                        rewardType: r.reward.rewardType,
                        rewardCardId: r.reward.rewardCardId,
                        coins: r.reward.rewardCoins,
                        gems: r.reward.rewardGems,
                        packId: r.reward.rewardPackId,
                        collectionId: r.type === "collection" ? r.id : null,
                        subCollectionId: r.type === "sub_collection" ? r.id : null,
                      })}
                      disabled={claimRewardMutation.isPending}
                    >
                      Claim
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* View Mode Toggle */}
      <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as any)}>
        <TabsList className="grid w-full grid-cols-2 sm:w-auto sm:inline-grid">
          <TabsTrigger value="all" className="gap-2">
            <LayoutGrid className="h-4 w-4" /> All Cards
          </TabsTrigger>
          <TabsTrigger value="by-collection" className="gap-2">
            <BookOpen className="h-4 w-4" /> By Collection
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {viewMode === "all" ? (
        <>
          {/* Filters */}
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[160px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search cards…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Select value={tierFilter} onValueChange={setTierFilter}>
              <SelectTrigger className="w-36"><SelectValue placeholder="Gem Tier" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Tiers</SelectItem>
                {gemTiers.map((g: any) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={posFilter} onValueChange={setPosFilter}>
              <SelectTrigger className="w-28"><SelectValue placeholder="Position" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Pos</SelectItem>
                {POSITIONS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="rating">By Rating</SelectItem>
                <SelectItem value="name">By Name</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Grid */}
          {isLoading ? (
            <div className="flex justify-center py-20">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          ) : cards.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground">
              <p className="text-lg">No cards yet</p>
              <p className="text-sm mt-1">Open packs to start building your collection!</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {cards.map((card: any) => (
                <PlayerCard
                  key={card.id}
                  card={card}
                  gemTier={gemTierMap[card.gem_tier_id]}
                  badgeCount={card.player_card_badges?.length ?? 0}
                  duplicateCount={duplicateMap[card.id] ?? 1}
                  isLocked={!!lockMap[card.id]}
                  onClick={() => setSelectedCardId(card.id)}
                />
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          {populatedCollections.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground">
              <p className="text-lg">No collections set up yet</p>
            </div>
          ) : (
            <>
              {/* Collection tabs */}
              <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
                {populatedCollections.map((c: any) => (
                  <button
                    key={c.id}
                    onClick={() => { setActiveCollectionId(c.id); setActiveSubCollectionId(null); }}
                    className={`shrink-0 rounded-full px-4 py-1.5 text-xs font-medium border transition-colors ${
                      activeCollectionId === c.id
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-card text-foreground border-border hover:bg-secondary"
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>

              {/* Sub-collection tabs */}
              {activeSubCollections.length > 0 && (
                <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
                  <button
                    onClick={() => setActiveSubCollectionId(null)}
                    className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-medium border transition-colors ${
                      activeSubCollectionId === null
                        ? "bg-secondary text-foreground border-foreground/30"
                        : "bg-transparent text-muted-foreground border-border hover:bg-secondary/60"
                    }`}
                  >
                    Main
                  </button>
                  {activeSubCollections.map((sc: any) => (
                    <button
                      key={sc.id}
                      onClick={() => setActiveSubCollectionId(sc.id)}
                      className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-medium border transition-colors ${
                        activeSubCollectionId === sc.id
                          ? "bg-secondary text-foreground border-foreground/30"
                          : "bg-transparent text-muted-foreground border-border hover:bg-secondary/60"
                      }`}
                    >
                      {sc.name}
                    </button>
                  ))}
                </div>
              )}

              {/* Active collection page */}
              {activeCollectionId && (() => {
                const activeCollection = (collections as any[]).find((c) => c.id === activeCollectionId);
                const activeSubCollection = activeSubCollectionId
                  ? (subCollections as any[]).find((s) => s.id === activeSubCollectionId)
                  : null;
                const colName = activeCollection?.name ?? "";
                const subName = activeSubCollection?.name ?? null;
                const totalSlots = activeScopeCards.regular.length;
                const ownedSlots = activeScopeCards.regular.filter((pc: any) => isOwnedSlot(pc.id)).length;
                const pct = totalSlots > 0 ? Math.round((ownedSlots / totalSlots) * 100) : 0;
                const rewardCard = activeScopeCards.reward;
                const scopeRow = activeSubCollection ?? activeCollection;
                const scopeKind: "collection" | "sub_collection" = activeSubCollection ? "sub_collection" : "collection";
                const reward = scopeRow ? resolveReward(scopeRow, scopeKind, rewardCard) : null;
                const rewardClaimable = !!reward && totalSlots > 0 && ownedSlots >= totalSlots && !reward.alreadyClaimed;

                return (
                  <div className="space-y-5">
                    {/* Header w/ reward */}
                    <div className="rounded-xl border border-border bg-card p-4 space-y-4">
                      <div>
                        <div className="flex items-baseline justify-between gap-2 flex-wrap">
                          <h2 className="text-base sm:text-lg font-bold">
                            {colName}
                            {subName && <span className="text-muted-foreground"> → {subName}</span>}
                          </h2>
                          <span className="text-sm text-muted-foreground">
                            {ownedSlots} / {totalSlots} collected ({pct}%)
                          </span>
                        </div>
                        <Progress value={pct} className="h-2 mt-2" />
                      </div>

                      {reward && (
                        <div className="flex items-center gap-4 pt-2 border-t border-border">
                          {reward.rewardType === "card" && rewardCard ? (
                            <div className="w-24 sm:w-28 shrink-0">
                              <PlayerCard
                                card={rewardCard as any}
                                gemTier={gemTierMap[rewardCard.gem_tier_id]}
                                missing={!reward.alreadyClaimed}
                                onClick={() => reward.alreadyClaimed && setSelectedCardId(rewardCard.id)}
                              />
                            </div>
                          ) : (
                            <div className="w-24 sm:w-28 shrink-0 aspect-[3/4] rounded-xl border border-border bg-muted/30 flex items-center justify-center">
                              <span className="text-3xl">
                                {reward.rewardType === "coins" && "🪙"}
                                {reward.rewardType === "gems" && "💎"}
                                {reward.rewardType === "pack" && "📦"}
                              </span>
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                              <Gift className="h-3.5 w-3.5" /> Reward
                            </div>
                            <p className="font-semibold text-sm mt-0.5 truncate">{reward.rewardLabel}</p>
                            <p className="text-xs text-muted-foreground mt-1">
                              Complete this collection to unlock.
                            </p>
                            {reward.alreadyClaimed ? (
                              <span className="inline-flex items-center gap-1 mt-2 text-xs text-primary font-medium">
                                <CheckCircle2 className="h-3.5 w-3.5" /> Claimed
                              </span>
                            ) : rewardClaimable ? (
                              <Button
                                size="sm"
                                className="mt-2"
                                onClick={() => claimRewardMutation.mutate({
                                  rewardType: reward.rewardType,
                                  rewardCardId: reward.rewardCardId,
                                  coins: reward.rewardCoins,
                                  gems: reward.rewardGems,
                                  packId: reward.rewardPackId,
                                  collectionId: scopeKind === "collection" ? scopeRow.id : null,
                                  subCollectionId: scopeKind === "sub_collection" ? scopeRow.id : null,
                                })}
                                disabled={claimRewardMutation.isPending}
                              >
                                Claim Reward
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Slot grid */}
                    {totalSlots === 0 ? (
                      <div className="text-center py-12 text-muted-foreground text-sm">
                        No player cards in this collection yet.
                      </div>
                    ) : (
                      <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-7 gap-1.5 sm:gap-2">
                        {activeScopeCards.regular.map((slotCard: any) => {
                          // Slot is identified by chain root. Find the best owned variant
                          // anywhere in the chain (highest rating); if none owned, render
                          // the base card as a "missing" placeholder.
                          const root = chainRootOf.get(slotCard.id) ?? slotCard.id;
                          const chainMembers = chainMembersOf.get(root) ?? [slotCard.id];
                          const ownedInChain = chainMembers
                            .map((id) => ownedCardMap[id])
                            .filter(Boolean)
                            .sort((a: any, b: any) => (b.rating ?? 0) - (a.rating ?? 0));
                          const displayOwned = ownedInChain[0] ?? null;
                          const displayCard = displayOwned ?? slotCard;
                          const owned = !!displayOwned;
                          const totalDupesInChain = chainMembers.reduce(
                            (sum, id) => sum + (duplicateMap[id] ?? 0),
                            0,
                          );
                          const anyLockedInChain = chainMembers.some((id) => !!lockMap[id]);
                          return (
                            <PlayerCard
                              key={root}
                              card={displayCard as any}
                              gemTier={gemTierMap[displayCard.gem_tier_id]}
                              badgeCount={displayOwned?.player_card_badges?.length ?? 0}
                              duplicateCount={owned ? totalDupesInChain : 0}
                              isLocked={anyLockedInChain}
                              missing={!owned}
                              onClick={() => owned && setSelectedCardId(displayCard.id)}
                            />
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}
            </>
          )}
        </>
      )}

      <CardDetailDialog
        open={!!selectedCardId}
        onOpenChange={(o) => !o && setSelectedCardId(null)}
        card={selectedCard}
        gemTier={selectedCard ? gemTierMap[selectedCard.gem_tier_id] : null}
        teamName={selectedCard ? teamMap[selectedCard.team_id] : undefined}
        badges={selectedBadges}
        traits={selectedTraits}
        duplicateCount={selectedCardId ? (duplicateMap[selectedCardId] ?? 1) : 1}
        sellableCount={selectedCardId ? (sellableCountMap[selectedCardId] ?? 0) : 0}
        isLocked={selectedCardId ? !!lockMap[selectedCardId] : false}
        canSell={selectedCardId ? (sellableCountMap[selectedCardId] ?? 0) > 0 : false}
        onToggleLock={() => toggleLockMutation.mutate()}
        onQuicksell={() => quicksellMutation.mutate()}
        quicksellLoading={quicksellMutation.isPending}
      />
    </div>
  );
}
