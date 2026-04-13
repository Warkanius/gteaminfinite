import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2, Trophy } from "lucide-react";

export interface Milestone {
  wins_required: number;
  coin_reward: number;
  gem_reward: number;
  pack_reward: string; // pack id, "random_standard", or ""
}

interface Props {
  milestones: Milestone[];
  onChange: (milestones: Milestone[]) => void;
  packs: { id: string; name: string; pack_type: string }[];
}

export function MilestoneEditor({ milestones, onChange, packs }: Props) {
  const sorted = [...milestones].sort((a, b) => a.wins_required - b.wins_required);

  const update = (index: number, patch: Partial<Milestone>) => {
    const next = sorted.map((m, i) => (i === index ? { ...m, ...patch } : m));
    onChange(next);
  };

  const add = () => {
    const maxWins = sorted.length > 0 ? Math.max(...sorted.map(m => m.wins_required)) : 0;
    onChange([...sorted, { wins_required: maxWins + 3, coin_reward: 500, gem_reward: 0, pack_reward: "" }]);
  };

  const remove = (index: number) => {
    onChange(sorted.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-2 text-sm uppercase tracking-wider text-muted-foreground">
          <Trophy className="h-3.5 w-3.5" /> Milestone Rewards
        </Label>
        <Button type="button" size="sm" variant="outline" onClick={add}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Add Milestone
        </Button>
      </div>

      {sorted.length === 0 && (
        <p className="text-xs text-muted-foreground border rounded-md p-3 bg-muted/30">
          No milestones configured. Add one to reward players at win streaks.
        </p>
      )}

      <div className="space-y-2">
        {sorted.map((m, i) => (
          <div key={i} className="grid grid-cols-[80px_1fr_1fr_1fr_36px] gap-2 items-end p-3 border rounded-lg bg-muted/20">
            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">Wins</Label>
              <Input
                type="number"
                min={1}
                value={m.wins_required}
                onChange={(e) => update(i, { wins_required: Number(e.target.value) })}
                className="h-8 text-center font-bold"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">Coins</Label>
              <Input
                type="number"
                min={0}
                step={100}
                value={m.coin_reward}
                onChange={(e) => update(i, { coin_reward: Number(e.target.value) })}
                className="h-8"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">Gems</Label>
              <Input
                type="number"
                min={0}
                value={m.gem_reward}
                onChange={(e) => update(i, { gem_reward: Number(e.target.value) })}
                className="h-8"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] uppercase text-muted-foreground">Pack</Label>
              <Select
                value={m.pack_reward || "none"}
                onValueChange={(val) => update(i, { pack_reward: val === "none" ? "" : val })}
              >
                <SelectTrigger className="h-8 text-xs">
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
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8 mt-auto"
              onClick={() => remove(i)}
            >
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
