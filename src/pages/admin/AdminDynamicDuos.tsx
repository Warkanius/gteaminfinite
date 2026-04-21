import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { FormDialog } from "@/components/admin/FormDialog";
import { ConfirmDialog } from "@/components/admin/ConfirmDialog";
import { PlayerCombobox } from "@/components/admin/PlayerCombobox";
import { StatInput } from "@/components/admin/StatInput";
import { Plus, Pencil, Trash2, Copy, Search } from "lucide-react";
import { toast } from "sonner";
import {
  type DuoBoosts,
  type DuoStatKey,
  type DynamicDuoRow,
  summarizeBoosts,
} from "@/lib/dynamicDuos";

const STAT_KEYS: DuoStatKey[] = [
  "stat_3pt", "stat_mid", "stat_fin", "stat_dnk",
  "stat_ast", "stat_stl", "stat_reb", "stat_blk", "stat_int",
];

const STAT_LABELS: Record<DuoStatKey, string> = {
  stat_3pt: "3PT", stat_mid: "MID", stat_fin: "FIN", stat_dnk: "DNK",
  stat_ast: "AST", stat_stl: "STL", stat_reb: "REB", stat_blk: "BLK", stat_int: "INT",
};

interface PlayerRow {
  id: string;
  name: string;
  rating: number;
  position1: string | null;
  gem_name: string | null;
}

function emptyBoosts(): Record<DuoStatKey, number> {
  return STAT_KEYS.reduce((acc, k) => ({ ...acc, [k]: 0 }), {} as Record<DuoStatKey, number>);
}

function pairKey(a: string, b: string) {
  return [a, b].sort().join("::");
}

export default function AdminDynamicDuos() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<DynamicDuoRow | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  // form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [cardA, setCardA] = useState("");
  const [cardB, setCardB] = useState("");
  const [boostsA, setBoostsA] = useState<Record<DuoStatKey, number>>(emptyBoosts());
  const [boostsB, setBoostsB] = useState<Record<DuoStatKey, number>>(emptyBoosts());
  const [isActive, setIsActive] = useState(true);

  const { data: duos = [], isLoading } = useQuery({
    queryKey: ["admin-dynamic-duos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("dynamic_duos")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as DynamicDuoRow[];
    },
  });

  const { data: players = [] } = useQuery({
    queryKey: ["admin-duos-players"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("player_cards")
        .select("id, name, rating, position1, gem_name")
        .order("name");
      if (error) throw error;
      return (data ?? []) as PlayerRow[];
    },
  });

  const playerById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);

  const playerOptions = useMemo(
    () =>
      players.map((p) => ({
        id: p.id,
        name: p.name,
        detail: p.gem_name ? `${p.gem_name} • ${Math.round(p.rating)}` : `${Math.round(p.rating)}`,
      })),
    [players],
  );

  const filteredDuos = useMemo(() => {
    if (!search.trim()) return duos;
    const q = search.toLowerCase();
    return duos.filter((d) => {
      const a = playerById.get(d.player_card_id_a)?.name?.toLowerCase() ?? "";
      const b = playerById.get(d.player_card_id_b)?.name?.toLowerCase() ?? "";
      return d.name.toLowerCase().includes(q) || a.includes(q) || b.includes(q);
    });
  }, [duos, search, playerById]);

  const resetForm = () => {
    setEditing(null);
    setName("");
    setDescription("");
    setCardA("");
    setCardB("");
    setBoostsA(emptyBoosts());
    setBoostsB(emptyBoosts());
    setIsActive(true);
  };

  const openCreate = () => {
    resetForm();
    setShowForm(true);
  };

  const openEdit = (duo: DynamicDuoRow) => {
    setEditing(duo);
    setName(duo.name);
    setDescription(duo.description ?? "");
    setCardA(duo.player_card_id_a);
    setCardB(duo.player_card_id_b);
    setBoostsA({ ...emptyBoosts(), ...(duo.boosts_a ?? {}) } as Record<DuoStatKey, number>);
    setBoostsB({ ...emptyBoosts(), ...(duo.boosts_b ?? {}) } as Record<DuoStatKey, number>);
    setIsActive(duo.is_active !== false);
    setShowForm(true);
  };

  const openDuplicate = (duo: DynamicDuoRow) => {
    setEditing(null);
    setName(`${duo.name} (Copy)`);
    setDescription(duo.description ?? "");
    setCardA(duo.player_card_id_a);
    setCardB(duo.player_card_id_b);
    setBoostsA({ ...emptyBoosts(), ...(duo.boosts_a ?? {}) } as Record<DuoStatKey, number>);
    setBoostsB({ ...emptyBoosts(), ...(duo.boosts_b ?? {}) } as Record<DuoStatKey, number>);
    setIsActive(duo.is_active !== false);
    setShowForm(true);
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Name required");
      if (!cardA || !cardB) throw new Error("Select both players");
      if (cardA === cardB) throw new Error("Pick two different players");

      // duplicate-mirrored check
      const k = pairKey(cardA, cardB);
      const dup = duos.find(
        (d) => d.id !== editing?.id && pairKey(d.player_card_id_a, d.player_card_id_b) === k,
      );
      if (dup) throw new Error(`These two players already form duo "${dup.name}"`);

      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        player_card_id_a: cardA,
        player_card_id_b: cardB,
        boosts_a: boostsA as any,
        boosts_b: boostsB as any,
        is_active: isActive,
      };

      if (editing) {
        const { error } = await supabase.from("dynamic_duos").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("dynamic_duos").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(editing ? "Duo updated" : "Duo created");
      qc.invalidateQueries({ queryKey: ["admin-dynamic-duos"] });
      qc.invalidateQueries({ queryKey: ["dynamic-duos"] });
      setShowForm(false);
      resetForm();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("dynamic_duos").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Duo removed");
      qc.invalidateQueries({ queryKey: ["admin-dynamic-duos"] });
      qc.invalidateQueries({ queryKey: ["dynamic-duos"] });
      setDeleteId(null);
    },
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await supabase.from("dynamic_duos").update({ is_active: active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-dynamic-duos"] });
      qc.invalidateQueries({ queryKey: ["dynamic-duos"] });
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-wider">Dynamic Duos</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Pair two players to grant custom stat boosts when both are in the same lineup.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" /> New Duo
        </Button>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search duos or players…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : filteredDuos.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No dynamic duos yet. Create your first pair to grant stat boosts when two cards play together.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filteredDuos.map((duo) => {
            const a = playerById.get(duo.player_card_id_a);
            const b = playerById.get(duo.player_card_id_b);
            const aBoosts = summarizeBoosts(duo.boosts_a);
            const bBoosts = summarizeBoosts(duo.boosts_b);
            return (
              <Card key={duo.id} className={duo.is_active === false ? "opacity-60" : ""}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="font-display text-lg truncate">{duo.name}</CardTitle>
                      {duo.description && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{duo.description}</p>
                      )}
                    </div>
                    <Switch
                      checked={duo.is_active !== false}
                      onCheckedChange={(v) => toggleActive.mutate({ id: duo.id, active: v })}
                    />
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded-md border border-border/50 p-2">
                      <p className="font-semibold truncate">{a?.name ?? "Missing"}</p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {aBoosts.length === 0 ? (
                          <span className="text-xs text-muted-foreground">No boosts</span>
                        ) : (
                          aBoosts.map((s, i) => (
                            <Badge key={i} variant="secondary" className="text-[10px]">{s}</Badge>
                          ))
                        )}
                      </div>
                    </div>
                    <div className="rounded-md border border-border/50 p-2">
                      <p className="font-semibold truncate">{b?.name ?? "Missing"}</p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {bBoosts.length === 0 ? (
                          <span className="text-xs text-muted-foreground">No boosts</span>
                        ) : (
                          bBoosts.map((s, i) => (
                            <Badge key={i} variant="secondary" className="text-[10px]">{s}</Badge>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={() => openDuplicate(duo)}>
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => openEdit(duo)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setDeleteId(duo.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <FormDialog
        open={showForm}
        onOpenChange={(o) => {
          setShowForm(o);
          if (!o) resetForm();
        }}
        title={editing ? "Edit Dynamic Duo" : "New Dynamic Duo"}
        onSave={() => saveMutation.mutate()}
        saving={saveMutation.isPending}
        className="max-w-3xl max-h-[85vh] flex flex-col overflow-hidden"
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Splash Brothers" />
          </div>
          <div className="space-y-2">
            <Label>Description (optional)</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Flavor text shown to players when this duo activates."
              rows={2}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-3 rounded-lg border border-border/50 p-3">
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Player A</Label>
                <PlayerCombobox
                  players={playerOptions}
                  value={cardA}
                  onValueChange={setCardA}
                  placeholder="Select Player A…"
                />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">Boosts (Player A)</Label>
                <div className="grid grid-cols-3 gap-2">
                  {STAT_KEYS.map((key) => (
                    <StatInput
                      key={key}
                      label={STAT_LABELS[key]}
                      value={boostsA[key]}
                      onChange={(v) => setBoostsA((p) => ({ ...p, [key]: v }))}
                      min={-50}
                      max={50}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-3 rounded-lg border border-border/50 p-3">
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground">Player B</Label>
                <PlayerCombobox
                  players={playerOptions}
                  value={cardB}
                  onValueChange={setCardB}
                  placeholder="Select Player B…"
                />
              </div>
              <div>
                <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">Boosts (Player B)</Label>
                <div className="grid grid-cols-3 gap-2">
                  {STAT_KEYS.map((key) => (
                    <StatInput
                      key={key}
                      label={STAT_LABELS[key]}
                      value={boostsB[key]}
                      onChange={(v) => setBoostsB((p) => ({ ...p, [key]: v }))}
                      min={-50}
                      max={50}
                    />
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border border-border/50 p-3">
            <div>
              <Label>Active</Label>
              <p className="text-xs text-muted-foreground">Inactive duos won't trigger in games.</p>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>
        </div>
      </FormDialog>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(o) => !o && setDeleteId(null)}
        title="Delete this duo?"
        description="This action can't be undone."
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
      />
    </div>
  );
}
