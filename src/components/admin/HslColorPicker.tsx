import { useState, useEffect } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Pipette, X } from "lucide-react";

interface HslColorPickerProps {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  placeholder?: string;
}

function parseHsl(raw: string | null): { h: number; s: number; l: number } | null {
  if (!raw) return null;
  const m = raw.match(/(\d+)\s+(\d+)%?\s+(\d+)%?/);
  if (!m) return null;
  return { h: Number(m[1]), s: Number(m[2]), l: Number(m[3]) };
}

function toHslString(h: number, s: number, l: number) {
  return `${h} ${s}% ${l}%`;
}

function hslToCss(h: number, s: number, l: number) {
  return `hsl(${h}, ${s}%, ${l}%)`;
}

export function HslColorPicker({ label, value, onChange, placeholder }: HslColorPickerProps) {
  const parsed = parseHsl(value);
  const [h, setH] = useState(parsed?.h ?? 220);
  const [s, setS] = useState(parsed?.s ?? 70);
  const [l, setL] = useState(parsed?.l ?? 50);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const p = parseHsl(value);
    if (p) { setH(p.h); setS(p.s); setL(p.l); }
  }, [value]);

  const apply = (nh: number, ns: number, nl: number) => {
    setH(nh); setS(ns); setL(nl);
    onChange(toHslString(nh, ns, nl));
  };

  const cssColor = value ? hslToCss(parsed?.h ?? h, parsed?.s ?? s, parsed?.l ?? l) : undefined;

  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className="flex gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="icon" className="h-10 w-10 shrink-0 border-border">
              {cssColor ? (
                <div className="w-6 h-6 rounded-sm border border-border/50" style={{ backgroundColor: cssColor }} />
              ) : (
                <Pipette className="h-4 w-4 text-muted-foreground" />
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 space-y-4" align="start">
            <div className="w-full h-10 rounded-md border border-border/50" style={{ backgroundColor: hslToCss(h, s, l) }} />
            <div className="space-y-3">
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Hue</span><span>{h}°</span>
                </div>
                <div
                  className="relative"
                  style={{
                    background: "linear-gradient(to right, hsl(0,100%,50%), hsl(60,100%,50%), hsl(120,100%,50%), hsl(180,100%,50%), hsl(240,100%,50%), hsl(300,100%,50%), hsl(360,100%,50%))",
                    borderRadius: "9999px",
                  }}
                >
                  <Slider min={0} max={360} step={1} value={[h]} onValueChange={([v]) => apply(v, s, l)}
                    className="[&_[role=slider]]:border-background [&_[role=slider]]:shadow-md [&_[data-orientation=horizontal]>span]:bg-transparent" />
                </div>
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Saturation</span><span>{s}%</span>
                </div>
                <Slider min={0} max={100} step={1} value={[s]} onValueChange={([v]) => apply(h, v, l)} />
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Lightness</span><span>{l}%</span>
                </div>
                <Slider min={0} max={100} step={1} value={[l]} onValueChange={([v]) => apply(h, s, v)} />
              </div>
            </div>
            <div className="text-xs text-muted-foreground font-mono text-center">{toHslString(h, s, l)}</div>
          </PopoverContent>
        </Popover>
        <Input
          placeholder={placeholder ?? "e.g. 220 75% 50%"}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value || null)}
          className="flex-1"
        />
        {value && (
          <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0" onClick={() => onChange(null)}>
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  );
}
