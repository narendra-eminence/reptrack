import { STATUS_ORDER, fmt } from "@/lib/format";
import { cn } from "@/lib/utils";

export function StatusChips({ counts, selected, onSelect }: { counts: Record<string, number>; selected?: string; onSelect?: (status: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2" data-testid="status-chips">
      {STATUS_ORDER.map((s) => {
        const n = counts[s] ?? 0;
        const active = selected === s;
        const cls = cn(
          "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm",
          active ? "border-brand-navy bg-brand-navy text-white" : "border-neutral-300 bg-white text-neutral-800",
          n === 0 && !active && "text-neutral-400",
        );
        const inner = (
          <>
            <span>{s}</span>
            <span className="font-semibold tabular-nums">{fmt(n)}</span>
          </>
        );
        return onSelect ? (
          <button key={s} type="button" aria-pressed={active} className={cls} data-testid={`chip-${s}`} onClick={() => onSelect(active ? "" : s)}>
            {inner}
          </button>
        ) : (
          <span key={s} className={cls} data-testid={`chip-${s}`}>
            {inner}
          </span>
        );
      })}
    </div>
  );
}
