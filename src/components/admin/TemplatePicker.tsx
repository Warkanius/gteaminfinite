import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Star, Sparkles } from "lucide-react";
import {
  TEAM_TEMPLATES, RUN_TEMPLATES, summarizeTemplate,
  type TeamTemplate, type RunTemplate,
} from "@/lib/teamTemplates";
import { cn } from "@/lib/utils";

interface Props {
  mode: "team" | "run";
  triggerLabel?: string;
  onPick: (templateName: string) => void;
  disabled?: boolean;
}

/**
 * Replaces the bare <Select> autofill picker with a dialog that shows
 * each template's average star rating + per-slot breakdown so admins
 * can preview before any players are created.
 */
export function TemplatePicker({ mode, triggerLabel = "Autofill from template", onPick, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const templates: (TeamTemplate | RunTemplate)[] = mode === "team" ? TEAM_TEMPLATES : RUN_TEMPLATES;

  function commit() {
    if (!selected) return;
    onPick(selected);
    setOpen(false);
    setSelected(null);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setSelected(null); }}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          <Sparkles className="w-4 h-4 mr-2" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Pick a {mode === "team" ? "team" : "run"} template</DialogTitle>
          <p className="text-sm text-muted-foreground">
            Average star rating is shown so you can compare difficulty before any players are created.
          </p>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2 mt-2">
          {templates.map((t) => {
            const s = summarizeTemplate(t);
            const isSelected = selected === t.name;
            return (
              <Card
                key={t.name}
                onClick={() => setSelected(t.name)}
                className={cn(
                  "p-4 cursor-pointer transition border-2",
                  isSelected ? "border-primary bg-primary/5" : "border-border hover:border-primary/40",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h4 className="font-display text-base truncate">{t.name}</h4>
                    <p className="text-xs text-muted-foreground line-clamp-2">{t.description}</p>
                  </div>
                  <Badge variant="secondary" className="shrink-0">
                    <Star className="w-3 h-3 mr-1 fill-current" />
                    {s.avgMin === s.avgMax ? s.avgMin : `${s.avgMin}–${s.avgMax}`}
                  </Badge>
                </div>

                <div className="mt-3 text-[11px] text-muted-foreground">
                  {s.slotCount} player{s.slotCount === 1 ? "" : "s"} · Range ★ {s.minStar}–{s.maxStar}
                </div>

                <ul className="mt-2 space-y-1 text-xs">
                  {t.slots.map((slot, i) => (
                    <li key={i} className="flex justify-between gap-2">
                      <span className="truncate">{slot.archetype}</span>
                      <span className="text-muted-foreground shrink-0">
                        ★ {slot.starRange[0] === slot.starRange[1]
                          ? slot.starRange[0]
                          : `${slot.starRange[0]}–${slot.starRange[1]}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>

        <DialogFooter className="mt-4">
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={commit} disabled={!selected}>
            {selected ? `Generate "${selected}"` : "Pick a template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
