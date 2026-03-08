import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface PackCardProps {
  pack: {
    id: string;
    name: string;
    pack_type: string;
    cost: number;
    ten_box_cost: number | null;
  };
  coins: number;
  loading: boolean;
  onBuy: (packId: string, quantity: 1 | 10) => void;
}

export function PackCard({ pack, coins, loading, onBuy }: PackCardProps) {
  const canAfford1 = coins >= pack.cost;
  const canAfford10 = pack.ten_box_cost ? coins >= pack.ten_box_cost : coins >= pack.cost * 10;

  return (
    <Card className="group relative overflow-hidden border-border/50 bg-card hover:border-primary/40 transition-colors">
      {/* Decorative glow */}
      <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent pointer-events-none" />

      <CardContent className="p-5 flex flex-col gap-4 relative">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-display text-lg font-bold text-foreground uppercase tracking-wide">
              {pack.name}
            </h3>
            <Badge variant="secondary" className="text-[10px] mt-1">
              {pack.pack_type}
            </Badge>
          </div>
          <div className="text-right">
            <div className="text-xs text-muted-foreground">Cost</div>
            <div className="text-lg font-bold text-foreground flex items-center gap-1">
              🪙 {pack.cost.toLocaleString()}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            size="sm"
            className="flex-1"
            disabled={!canAfford1 || loading}
            onClick={() => onBuy(pack.id, 1)}
          >
            Open 1
          </Button>
          {pack.ten_box_cost !== null && (
            <Button
              size="sm"
              variant="secondary"
              className="flex-1"
              disabled={!canAfford10 || loading}
              onClick={() => onBuy(pack.id, 10)}
            >
              10-Box 🪙{pack.ten_box_cost?.toLocaleString()}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
