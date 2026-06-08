import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";

export interface PreviewRow {
  key: string;
  label: string;
  detail?: string;
  collides?: boolean;
}

interface Props {
  rows: PreviewRow[];
  selected: Set<string>;
  onToggle: (key: string) => void;
  onToggleAll: () => void;
}

export function ImportPreviewTable({ rows, selected, onToggle, onToggleAll }: Props) {
  if (!rows.length) return <p className="text-sm text-muted-foreground py-4">No rows.</p>;
  const allSelected = rows.every((r) => selected.has(r.key));
  return (
    <div className="border rounded-md max-h-[50vh] overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 sticky top-0">
          <tr>
            <th className="p-2 w-10">
              <Checkbox checked={allSelected} onCheckedChange={onToggleAll} />
            </th>
            <th className="p-2 text-left">Item</th>
            <th className="p-2 text-left">Details</th>
            <th className="p-2 text-left w-24">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t hover:bg-muted/30">
              <td className="p-2">
                <Checkbox checked={selected.has(r.key)} onCheckedChange={() => onToggle(r.key)} />
              </td>
              <td className="p-2 font-medium">{r.label}</td>
              <td className="p-2 text-muted-foreground text-xs">{r.detail}</td>
              <td className="p-2">
                {r.collides ? (
                  <Badge variant="destructive" className="text-[10px]">
                    <AlertTriangle className="w-3 h-3 mr-1" />Exists
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-[10px]">New</Badge>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
