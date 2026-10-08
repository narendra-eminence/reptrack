import type { TestResult, TryEntry } from "@/lib/types";
import { cn } from "@/lib/utils";

/** The mention with the words around it, as they appear in the sentence; cut markers show where the context was trimmed. */
function Highlighted({ e, muted = false }: { e: TryEntry; muted?: boolean }) {
  return (
    <>
      {e.cut_before && (/^\s/.test(e.before) ? "…" : "… ")}
      {e.before}
      <mark className={cn("rounded-sm px-0.5 text-inherit", muted ? "bg-neutral-200" : "bg-amber-100")}>{e.text}</mark>
      {e.after}
      {e.cut_after && (/\s$/.test(e.after) ? "…" : " …")}
    </>
  );
}

/** Why a test sentence did or did not match: what counted, what did not and why, and what counted for another brand. */
export function MatchExplanation({ result }: { result: TestResult }) {
  const { counted, not_counted: notCounted, elsewhere } = result;
  if (!counted.length && !notCounted.length && !elsewhere.length) {
    return <p className="text-xs text-neutral-500">No mention of this brand in the sentence.</p>;
  }
  return (
    <div className="space-y-1 text-xs text-neutral-700">
      {counted.map((e, i) => (
        <p key={`c-${e.offset}-${i}`}>
          <span className="text-neutral-500">Counted: </span>
          <Highlighted e={e} />
        </p>
      ))}
      {notCounted.map((e, i) => (
        <p key={`n-${e.offset}-${i}`}>
          <span className="text-neutral-500">Not counted: </span>
          <Highlighted e={e} muted /> - {e.reason}
        </p>
      ))}
      {elsewhere.map((e, i) => (
        <p key={`e-${e.offset}-${i}`}>
          <span className="text-neutral-500">Counted for {e.brand}: </span>
          <Highlighted e={e} />
        </p>
      ))}
    </div>
  );
}
