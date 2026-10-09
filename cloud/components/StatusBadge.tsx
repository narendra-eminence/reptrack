import { cn } from "@/lib/utils";
import type { RunStatus } from "@/lib/types";

const STYLES: Record<RunStatus, string> = {
  pending: "bg-neutral-100 text-neutral-800 ring-neutral-200",
  running: "bg-blue-50 text-blue-800 ring-blue-200",
  done: "bg-green-50 text-green-800 ring-green-200",
  cancelled: "bg-amber-50 text-amber-900 ring-amber-200",
};
const LABELS: Record<RunStatus, string> = { pending: "Waiting", running: "In progress", done: "Finished", cancelled: "Stopped" };

export function StatusBadge({ status }: { status: RunStatus }) {
  return (
    <span data-testid="run-status" className={cn("inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", STYLES[status])}>
      {LABELS[status]}
    </span>
  );
}
