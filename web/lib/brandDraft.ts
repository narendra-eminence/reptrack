import type { BrandRule } from "./types";

export interface DraftRule {
  name: string;
  pattern: string;
  case_sensitive: boolean;
  context_window: string;
  require_context: string; // one per line
  exclude: string; // one per line
}

const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

export const emptyDraft = (): DraftRule => ({ name: "", pattern: "", case_sensitive: false, context_window: "80", require_context: "", exclude: "" });

export function toDraft(r: BrandRule): DraftRule {
  return {
    name: r.name,
    pattern: r.pattern,
    case_sensitive: r.case_sensitive,
    context_window: String(r.context_window),
    require_context: r.require_context.join("\n"),
    exclude: r.exclude.join("\n"),
  };
}

export function fromDraft(d: DraftRule): BrandRule {
  const n = Number.parseInt(d.context_window, 10);
  return {
    name: d.name.trim(),
    pattern: d.pattern,
    case_sensitive: d.case_sensitive,
    context_window: Number.isFinite(n) ? n : 0, // 0 is rejected by the API with a message naming the rule
    require_context: lines(d.require_context),
    exclude: lines(d.exclude),
  };
}
