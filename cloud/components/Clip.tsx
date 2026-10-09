import { cn } from "@/lib/utils";

/** One-line text that truncates, with the full value in the native tooltip. */
export function Clip({ text, className }: { text: string; className?: string }) {
  return (
    <span title={text} className={cn("block truncate", className)}>
      {text}
    </span>
  );
}
