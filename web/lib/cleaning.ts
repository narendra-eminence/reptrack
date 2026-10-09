import type { CleaningDetails, CleanSummary } from "./types";

export const DETAIL_FIELDS: { key: keyof CleaningDetails; label: string; placeholder: string; hint: string }[] = [
  {
    key: "own_websites",
    label: "Own websites",
    placeholder: "safaribags.com",
    hint: "Pages on these sites, and their subdomains, go to Brand Communication.",
  },
  {
    key: "own_handles",
    label: "Own social handles",
    placeholder: "@safaribags or a profile link",
    hint: "Posts by these accounts on X, YouTube, LinkedIn, Facebook and Instagram go to Brand Communication.",
  },
  {
    key: "competitor_websites",
    label: "Competitor websites",
    placeholder: "vipindustries.co.in",
    hint: "Kept on Other Media as Competitor Owned, out of Clean Data.",
  },
  {
    key: "competitor_handles",
    label: "Competitor social handles",
    placeholder: "@vipbags",
    hint: "Kept on Other Media as Competitor Owned, out of Clean Data.",
  },
];

export const emptyDetails = (): CleaningDetails => ({
  own_websites: [],
  own_handles: [],
  competitor_websites: [],
  competitor_handles: [],
});

export const hasOwnDetails = (d: CleaningDetails) => d.own_websites.length + d.own_handles.length > 0;

/** Clean Data per source bucket, in the workbook's sheet order. */
export const BUCKETS = [
  "Major Media", "Regional Media", "Other Media", "Twitter", "YouTube", "Facebook", "Instagram", "Reddit", "LinkedIn",
  "Other Sources",
] as const;

/** Rows taken out of Clean Data, by the sheet they went to. */
export const REMOVED_SHEETS = ["Low Quality", "Spam", "Out of Range", "Unclassified"] as const;

export function duplicatesRemoved(s: Partial<CleanSummary>): number {
  return (s.duplicates_link ?? 0) + (s.duplicates_text ?? 0);
}
