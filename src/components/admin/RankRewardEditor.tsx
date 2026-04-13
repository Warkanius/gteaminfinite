import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Save, Trophy } from "lucide-react";
import { toast } from "sonner";

interface RankReward {
  id: string;
  rank_name: string;
  wins_required: number;
  coin_reward: number;
  gem_reward: number;
  pack_reward: string;
  sort_order: number;
}

interface Props {
  packs: { id: string; name: string; pack_type: string }[];
}

const RANK_COLORS: Record<string, string> = {
  Nobody: "text-muted-foreground",
  Regular: "text-blue-400",
  Hooper: "text-green-400",
  "Top Pick": "text-purple-400",
  Legend: "text-amber-400",
};

function getRankColor(name: string) {
  for (const [prefix, cls] of Object.entries(RANK_COLORS)) {
    if (name.startsWith(prefix)) return cls;
  }
  return "";
}

export function RankRewardEditor({ packs }: Props) {
  const qc = useQueryClient();

  const { data: rewards = [], isLoading } = useQuery({
    queryKey: ["admin-rank-rewards"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("run_rank_rewards")
        .select("*")
        .order("sort_order");
      if (error) throw error;
      return data as RankReward[];
    },
  });

  const [edits, setEdits] = useState<Record<string, Partial<RankReward>>>({});
  const [dirty, setDirty] = useState(false);

  const updateField = (id: string, field: keyof RankReward, value: any) => {
    setEdits(prev => ({
      ...prev,
      [id]: { ...prev[id], [field]: value },
    }));
    setDirty(true);
  };

  const getVal = (r: RankReward, field: keyof RankReward) => {
    return edits[r.id]?.[field] ?? r[field];
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const updates = Object.entries(edits);
      for (const [id, patch] of updates) {
        const { error } = await supabase
          .from("run_rank_rewards")
          .update(patch)
          .eq("id", id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-rank-rewards"] });
      setEdits({});
      setDirty(false);
      toast.success("Rank rewards saved");
    },
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return <div className="py-4 text-center text-muted-foreground">Loading rank rewards...</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          <Trophy className="h-4 w-4" /> Rank Reward Ladder
        </h3>
        <Button
          size="sm"
          onClick={() => saveMutation.mutate()}
          disabled={!dirty || saveMutation.isPending}
        >
          <Save className="h-3.5 w-3.5 mr-1" />
          {saveMutation.isPending ? "Saving..." : "Save All"}
        </Button>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[140px]">Rank</TableHead>
              <TableHead className="w-[70px] text-center">Wins</TableHead>
              <TableHead className="w-[100px]">Coins</TableHead>
              <TableHead className="w-[80px]">Gems</TableHead>
              <TableHead>Pack Reward</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rewards.map((r) => (
              <TableRow key={r.id}>
                <TableCell className={`font-semibold text-sm ${getRankColor(r.rank_name)}`}>
                  {r.rank_name}
                </TableCell>
                <TableCell className="text-center text-xs text-muted-foreground font-mono">
                  {r.wins_required}
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    min={0}
                    step={100}
                    value={getVal(r, "coin_reward") as number}
                    onChange={(e) => updateField(r.id, "coin_reward", Number(e.target.value))}
                    className="h-7 w-full text-xs"
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    min={0}
                    value={getVal(r, "gem_reward") as number}
                    onChange={(e) => updateField(r.id, "gem_reward", Number(e.target.value))}
                    className="h-7 w-full text-xs"
                  />
                </TableCell>
                <TableCell>
                  <Select
                    value={(getVal(r, "pack_reward") as string) || "none"}
                    onValueChange={(val) => updateField(r.id, "pack_reward", val === "none" ? "" : val)}
                  >
                    <SelectTrigger className="h-7 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No Pack</SelectItem>
                      <SelectItem value="random_standard">🎲 Random Pack</SelectItem>
                      <SelectItem value="random_standard_box">📦 Random Box (10-pack)</SelectItem>
                      {packs.map(p => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name} ({p.pack_type})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
