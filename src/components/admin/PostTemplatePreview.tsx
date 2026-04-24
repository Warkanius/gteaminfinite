interface PostTemplatePreviewProps {
  template: string;
}

const SAMPLE: Record<string, string> = {
  player: "Marcus Strike",
  score: "98-91",
  opponent: "Compton Crew",
  tier: "Diamond",
  stat_line: "32 PTS / 11 REB / 3 BLK",
  streak: "7",
  road: "Sunset Strip",
  run: "Venice Beach",
};

export function renderTemplate(template: string, vars: Record<string, string> = SAMPLE) {
  return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

export function PostTemplatePreview({ template }: PostTemplatePreviewProps) {
  if (!template?.trim()) {
    return <p className="text-xs text-muted-foreground italic">Type a template above to preview…</p>;
  }
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3 text-sm">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Preview</p>
      <p className="text-foreground">{renderTemplate(template)}</p>
    </div>
  );
}
