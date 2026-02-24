import { useState, useEffect } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface JsonEditorProps {
  label?: string;
  value: any;
  onChange: (v: any) => void;
}

export function JsonEditor({ label, value, onChange }: JsonEditorProps) {
  const [text, setText] = useState(() => JSON.stringify(value, null, 2));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setText(JSON.stringify(value, null, 2));
  }, [value]);

  function handleChange(raw: string) {
    setText(raw);
    try {
      const parsed = JSON.parse(raw);
      setError(null);
      onChange(parsed);
    } catch {
      setError("Invalid JSON");
    }
  }

  return (
    <div className="space-y-1">
      {label && <Label>{label}</Label>}
      <Textarea
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        className="font-mono text-xs min-h-[120px]"
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
