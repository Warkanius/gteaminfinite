import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { FormDialog } from "@/components/admin/FormDialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatInput } from "@/components/admin/StatInput";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

const POSITIONS = ["PG", "SG", "SF", "PF", "C"];
const STAT_KEYS = [
  { key: "stat_3pt", label: "3PT" },
  { key: "stat_mid", label: "MID" },
  { key: "stat_fin", label: "FIN" },
  { key: "stat_dnk", label: "DNK" },
  { key: "stat_ast", label: "AST" },
  { key: "stat_stl", label: "STL" },
  { key: "stat_reb", label: "REB" },
  { key: "stat_blk", label: "BLK" },
  { key: "stat_int", label: "INT" },
] as const;

interface PlayerQuickEditProps {
  playerId: string | null;
  onClose: () => void;
}

interface PlayerData {
  name: string;
  rating: number;
  position1: string;
  position2: string;
  stat_3pt: number;
  stat_mid: number;
  stat_fin: number;
  stat_dnk: number;
  stat_ast: number;
  stat_stl: number;
  stat_reb: number;
  stat_blk: number;
  stat_int: number;
}

export function PlayerQuickEdit({ playerId, onClose }: PlayerQuickEditProps) {
  const qc = useQueryClient();
  const [form, setForm] = useState<PlayerData>({
    name: "", rating: 0, position1: "", position2: "",
    stat_3pt: 0, stat_mid: 0, stat_fin: 0, stat_dnk: 0,
    stat_ast: 0, stat_stl: 0, stat_reb: 0, stat_blk: 0, stat_int: 0,
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!playerId) { setLoaded(false); return; }
    setLoaded(false);
    supabase.from("player_cards")
      .select("name, rating, position1, position2, stat_3pt, stat_mid, stat_fin, stat_dnk, stat_ast, stat_stl, stat_reb, stat_blk, stat_int")
      .eq("id", playerId)
      .single()
      .then(({ data }) => {
        if (data) {
          setForm({
            name: data.name,
            rating: data.rating,
            position1: data.position1 ?? "",
            position2: data.position2 ?? "",
            stat_3pt: data.stat_3pt, stat_mid: data.stat_mid, stat_fin: data.stat_fin,
            stat_dnk: data.stat_dnk, stat_ast: data.stat_ast, stat_stl: data.stat_stl,
            stat_reb: data.stat_reb, stat_blk: data.stat_blk, stat_int: data.stat_int,
          });
          setLoaded(true);
        }
      });
  }, [playerId]);

  const save = useMutation({
    mutationFn: async () => {
      if (!playerId) return;
      const { error } = await supabase.from("player_cards").update({
        name: form.name,
        rating: form.rating,
        position1: form.position1 || null,
        position2: form.position2 || null,
        stat_3pt: form.stat_3pt, stat_mid: form.stat_mid, stat_fin: form.stat_fin,
        stat_dnk: form.stat_dnk, stat_ast: form.stat_ast, stat_stl: form.stat_stl,
        stat_reb: form.stat_reb, stat_blk: form.stat_blk, stat_int: form.stat_int,
      }).eq("id", playerId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-all-players-lite"] });
      qc.invalidateQueries({ queryKey: ["admin-team-players"] });
      qc.invalidateQueries({ queryKey: ["admin-dom-game-players"] });
      toast.success("Player updated");
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <FormDialog
      open={!!playerId}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title="Quick Edit Player"
      onSave={() => save.mutate()}
      saving={save.isPending}
    >
      {!loaded ? (
        <div className="py-8 text-center text-muted-foreground">Loading…</div>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1 col-span-2">
              <Label>Name</Label>
              <Input value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label>Position 1</Label>
              <Select value={form.position1} onValueChange={(v) => setForm(f => ({ ...f, position1: v }))}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  {POSITIONS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Position 2</Label>
              <Select value={form.position2 || "none"} onValueChange={(v) => setForm(f => ({ ...f, position2: v === "none" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {POSITIONS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label className="text-xs uppercase tracking-wider text-muted-foreground mb-2 block">Stats (0–6 stars)</Label>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
              {STAT_KEYS.map(({ key, label }) => (
                <StatInput
                  key={key}
                  label={label}
                  value={(form as any)[key]}
                  onChange={(v) => setForm(f => ({ ...f, [key]: v }))}
                  min={0}
                  max={6}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </FormDialog>
  );
}
