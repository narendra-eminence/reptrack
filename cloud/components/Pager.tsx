import { Button } from "@/components/ui/button";
import { fmt } from "@/lib/format";

export function Pager({ total, offset, limit, onChange }: { total: number; offset: number; limit: number; onChange: (offset: number) => void }) {
  const from = total ? offset + 1 : 0;
  const to = Math.min(offset + limit, total);
  return (
    <div className="flex items-center justify-between text-sm tabular-nums">
      <span className="text-neutral-600">
        {fmt(from)}-{fmt(to)} of {fmt(total)}
      </span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>Previous</Button>
        <Button variant="outline" size="sm" disabled={to >= total} onClick={() => onChange(offset + limit)}>Next</Button>
      </div>
    </div>
  );
}
