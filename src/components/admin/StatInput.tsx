import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface StatInputProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}

export function StatInput({ label, value, onChange, min = 0, max = 99 }: StatInputProps) {
  return (
    <div className="space-y-1">
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</Label>
      <Input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value) || 0)))}
        className="text-center font-mono"
      />
    </div>
  );
}
