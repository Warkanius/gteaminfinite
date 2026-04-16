import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { computeOVR } from "@/lib/ovrUtils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, Trash2, Plus, User, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PlayerCombobox } from "@/components/admin/PlayerCombobox";

export default function AdminCollections() {
  const qc = useQueryClient();
  const [userSearch, setUserSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [addCardId, setAddCardId] = useState("");

  // Fetch all profiles
  const { data: profiles = [], isLoading: profilesLoading } = useQuery({
    queryKey: ["admin-profiles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("profiles").select("id, user_id, display_name, coins, gems").order("display_name");
      if (error) throw error;
      return data;
    },
  });

  // Fetch all player cards for combobox
  const { data: allCards = [] } = useQuery({
    queryKey: ["admin-all-cards-lite"],
    queryFn: async () => {
      const { data, error } = await supabase.from("player_cards").select("id, name, rating, stat_3pt, stat_mid, stat_fin, stat_dnk, stat_stl, stat_blk, stat_ast, stat_reb, stat_int").order("name");
      if (error) throw error;
      return data;
    },
  });

  // Fetch selected user's collection
  const { data: collection = [], isLoading: collectionLoading } = useQuery({
    queryKey: ["admin-user-collection", selectedUserId],
    enabled: !!selectedUserId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_collections")
        .select("id, player_card_id, acquired_at, is_locked, player_cards(name, rating, gem_name, stat_3pt, stat_mid, stat_fin, stat_dnk, stat_stl, stat_blk, stat_ast, stat_reb, stat_int)")
        .eq("user_id", selectedUserId!)
        .order("acquired_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const addCard = useMutation({
    mutationFn: async () => {
      if (!selectedUserId || !addCardId) throw new Error("Select a user and card");
      const { error } = await supabase.from("user_collections").insert({
        user_id: selectedUserId,
        player_card_id: addCardId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-user-collection", selectedUserId] });
      setAddCardId("");
      toast.success("Card added to collection");
    },
    onError: (e) => toast.error(e.message),
  });

  const removeCard = useMutation({
    mutationFn: async (collectionId: string) => {
      const { error } = await supabase.from("user_collections").delete().eq("id", collectionId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-user-collection", selectedUserId] });
      toast.success("Card removed");
    },
    onError: (e) => toast.error(e.message),
  });

  const filteredProfiles = useMemo(() => {
    if (!userSearch.trim()) return profiles;
    const q = userSearch.toLowerCase();
    return profiles.filter(p => (p.display_name ?? "").toLowerCase().includes(q));
  }, [userSearch, profiles]);

  const selectedProfile = profiles.find(p => p.user_id === selectedUserId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">User Collections</h1>
        <p className="text-muted-foreground mt-2">View and manage player collections for any user.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* User List */}
        <Card className="lg:col-span-1">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Users</CardTitle>
            <div className="relative mt-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search users…" value={userSearch} onChange={e => setUserSearch(e.target.value)} className="pl-9" />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {profilesLoading ? (
              <div className="flex items-center justify-center py-8 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…
              </div>
            ) : (
              <div className="max-h-[500px] overflow-y-auto divide-y divide-border">
                {filteredProfiles.map(p => (
                  <button
                    key={p.user_id}
                    onClick={() => setSelectedUserId(p.user_id)}
                    className={`w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors flex items-center gap-3 ${
                      selectedUserId === p.user_id ? "bg-primary/10 border-l-2 border-primary" : ""
                    }`}
                  >
                    <User className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{p.display_name || "Unknown"}</div>
                      <div className="text-xs text-muted-foreground">{p.coins} coins · {p.gems} gems</div>
                    </div>
                  </button>
                ))}
                {filteredProfiles.length === 0 && (
                  <div className="py-8 text-center text-sm text-muted-foreground">No users found.</div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Collection View */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg">
              {selectedProfile ? `${selectedProfile.display_name}'s Collection` : "Select a User"}
            </CardTitle>
            {selectedProfile && (
              <CardDescription>{collection.length} cards</CardDescription>
            )}
          </CardHeader>
          <CardContent>
            {!selectedUserId ? (
              <div className="py-12 text-center text-muted-foreground">Select a user from the list to view their collection.</div>
            ) : collectionLoading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading…
              </div>
            ) : (
              <div className="space-y-4">
                {/* Add Card */}
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <PlayerCombobox
                      players={allCards.map(c => ({ id: c.id, name: `${c.name} (${computeOVR(c)}★)` }))}
                      value={addCardId}
                      onValueChange={setAddCardId}
                      placeholder="Search card to add…"
                    />
                  </div>
                  <Button onClick={() => addCard.mutate()} disabled={!addCardId || addCard.isPending} size="sm">
                    <Plus className="h-4 w-4 mr-1" /> Add
                  </Button>
                </div>

                {/* Card List */}
                <div className="max-h-[450px] overflow-y-auto divide-y divide-border border rounded-md">
                  {collection.length === 0 ? (
                    <div className="py-8 text-center text-sm text-muted-foreground">No cards in collection.</div>
                  ) : (
                    collection.map((item: any) => (
                      <div key={item.id} className="flex items-center justify-between px-4 py-2.5 hover:bg-muted/30">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm truncate">{item.player_cards?.name ?? "Unknown"}</span>
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
                              {item.player_cards ? computeOVR(item.player_cards) : (item.player_cards?.rating ?? 0)}★
                            </Badge>
                            {item.player_cards?.gem_name && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                {item.player_cards.gem_name}
                              </Badge>
                            )}
                            {item.is_locked && (
                              <Badge variant="destructive" className="text-[9px] px-1 py-0">🔒</Badge>
                            )}
                          </div>
                          <div className="text-[10px] text-muted-foreground">
                            Added {new Date(item.acquired_at).toLocaleDateString()}
                          </div>
                        </div>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 shrink-0"
                          onClick={() => removeCard.mutate(item.id)}
                          disabled={removeCard.isPending}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
