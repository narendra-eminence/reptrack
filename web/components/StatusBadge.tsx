import { cn } from "@/lib/utils";
import type { RunStatus } from "@/lib/types";

const STYLES: Record<RunStatus, string> = {
  scraping: "bg-blue-50 text-blue-800 ring-blue-200",
  scraped: "bg-neutral-100 text-neutral-800 ring-neutral-200",
  verifying: "bg-blue-50 text-blue-800 ring-blue-200",
  verified: "bg-green-50 text-green-800 ring-green-200",
  failed: "bg-red-50 text-red-800 ring-red-200",
};
const LABELS: Record<RunStatus, string> = {
  scraping: "Searching",
  scraped: "Searched",
  verifying: "Verifying",
  verified: "Verified",
  failed: "Failed",
};

export function StatusBadge({ status }: { status: RunStatus }) {
  return (
    <span data-testid="run-status" className={cn("inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset", STYLES[status])}>
      {LABELS[status]}
    </span>
  );
}
