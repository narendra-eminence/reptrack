"""Turn verified SERP rows into the RepScore cleaning workbook's sheets.

The order follows the repscore-data-processing skill's cleaning phase:

1. Normalise every row onto the RepScore column schema (Date from the export's Published value, else an absolute page
   date; Hit Sentence is Google's snippet; Opening Text is the page's own lead and never a copy of the snippet).
2. Pass-1 dedupe on the link (tracking parameters stripped, every other query parameter kept).
3. Route each unique link, first match wins: out of the run's period -> Out of Range; the brand's own sites and
   accounts -> Brand Communication; a competitor's -> Competitor Owned (on Other Media); social platforms -> their
   own sheet; exclusion lists and content-farm paths -> Low Quality / Spam with an Exclusion Type; the master media
   list -> Major / Regional / Other Media (unknown domains: Other Media, NEW). A row whose title and snippet do not
   name the brand (by the verification's own brand rules) -> Low Quality, No brand mention.
4. Pass-2 dedupe on the normalised title or snippet within media and within each platform, the highest-tier copy
   kept, Core-level Major Media exempt.

Nothing here judges meaning: passing mentions, wrong entities the brand rules cannot tell apart, tagging and
sentiment are left to the reviewed phases. The verifier's own Status is carried as Script Status and ignored.
"""

from __future__ import annotations

import datetime as dt
from collections import Counter, defaultdict
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from . import rules
from .details import CleaningDetails, OwnerMatcher
from .media import Hit, MasterMediaList, clean_host

BASE_COLUMNS = [
    "Date",
    "Link",
    "URL",
    "Author",
    "Title",
    "Opening Text",
    "Hit Sentence",
    "Driver",
    "Sub Parameter",
    "Sentiment",
    "Language",
    "Country",
    "Engagement",
    "Reach",
    "Source Bucket",
]
EXTRA_COLUMNS = [
    "Media Level",
    "Media Type",
    "Date Source",
    "Verification Status",
    "Verified Context",
    "Confidence",
    "Needs Review",
    "Sentiment Rationale",
    "Insight",
]
TRAIL_COLUMNS = [
    "Source Name",
    "Status",
    "Notes",
    "Query",
    "Vertical",
    "Rank",
    "Provider",
    "Query Count",
    "Script Status",
    "Script Hit Sentence",
    "Byline",
]
DATA_COLUMNS = BASE_COLUMNS + EXTRA_COLUMNS + TRAIL_COLUMNS
EXCLUSION_COLUMNS = BASE_COLUMNS + ["Exclusion Type"] + EXTRA_COLUMNS + TRAIL_COLUMNS

MEDIA_BUCKETS = ("Major Media", "Regional Media", "Other Media")
PLATFORM_BUCKETS = ("Twitter", "YouTube", "Facebook", "Instagram", "Reddit", "LinkedIn")
BUCKET_SHEETS = (*MEDIA_BUCKETS, *PLATFORM_BUCKETS, "Other Sources")
BRAND_COMMUNICATION = "Brand Communication"
COMPETITOR_OWNED = "Competitor Owned"
LOW_QUALITY, SPAM = rules.LOW_QUALITY, rules.SPAM
UNCLASSIFIED = "Unclassified"
OUT_OF_RANGE = "Out of Range"
VERIFICATION_REMOVED = "Verification Removed"
EXCLUSION_SHEETS = (LOW_QUALITY, SPAM)
DUPLICATE_SHEET = {
    "Major Media": "Major Media_duplicate",
    "Regional Media": "Regional Media_duplicate",
    "Other Media": "Other Media_duplicate",
    "Twitter": "duplicate_twitter",
    "YouTube": "YouTube_duplicate",
    "Reddit": "duplicate_reddit",
    "LinkedIn": "duplicate_linkedin",
    "Facebook": "Facebook_duplicate",
    "Instagram": "Instagram_duplicate",
    "Other Sources": "Other Sources_duplicate",
}
LEVEL_ORDER = {"Core": 0, "Level 1": 1, "Level 2": 2}
#: Which copy of a story survives pass 2: the highest tier.
_TIER = {"Major Media": 0, "Regional Media": 3, "Other Media": 4, COMPETITOR_OWNED: 5}
_TEXT_COLUMNS = ("Title", "Hit Sentence", "Opening Text")

BrandCheck = Callable[[str], bool]


@dataclass
class Item:
    """One input row on its way through cleaning."""

    i: int
    src: Mapping[str, Any]
    link: str
    host: str
    title: str
    snippet: str
    outlet: str
    query: str
    date: dt.date | None
    date_source: str
    sheet: str = ""
    bucket: str = ""
    exclusion: str = ""
    platform: str | None = None
    hit: Hit | None = None
    notes: list[str] = field(default_factory=list)
    needs_review: bool = False
    dup_of: Item | None = None
    dup_pass: int = 0
    listed: bool = True
    queries: set[str] = field(default_factory=set)
    byline: str = ""
    author: str = ""
    author_corrected: bool = False
    opening: str = ""
    opening_blanked: bool = False

    @property
    def level(self) -> str:
        return self.hit.level if self.hit and self.bucket in MEDIA_BUCKETS else ""


@dataclass
class Sheet:
    name: str
    columns: list[str]
    rows: list[dict[str, Any]]
    kind: str = "data"  # data | summary | table | raw


@dataclass
class CleanResult:
    sheets: list[Sheet]
    facts: dict[str, Any]

    def sheet(self, name: str) -> Sheet | None:
        return next((s for s in self.sheets if s.name == name), None)


@dataclass
class CleanContext:
    run_name: str
    brand_set: str
    verify_job_id: int
    start: dt.date | None
    end: dt.date | None
    region: str | None
    media: MasterMediaList
    media_list_name: str
    details: CleaningDetails
    mentions_brand: BrandCheck
    raw_columns: Sequence[str]


def _s(v: Any) -> str:
    return "" if v is None else str(v).strip()


def _prepare(i: int, src: Mapping[str, Any]) -> Item:
    link = _s(src.get("Link"))
    export = rules.parse_abs_date(src.get("Published"))
    page = None if export else rules.parse_abs_date(src.get("Published Date"))
    return Item(
        i=i,
        src=src,
        link=link,
        host=clean_host(link),
        title=_s(src.get("Title")),
        snippet=_s(src.get("Snippet")),
        outlet=_s(src.get("Outlet")),
        query=_s(src.get("Query")),
        date=export or page,
        date_source="export" if export else "page" if page else "missing",
    )


class _Cleaner:
    def __init__(self, ctx: CleanContext, rows: Sequence[Mapping[str, Any]]):
        self.ctx = ctx
        self.items = [_prepare(i, r) for i, r in enumerate(rows)]
        self.own = OwnerMatcher(ctx.details.own_websites, ctx.details.own_handles)
        self.rival = OwnerMatcher(ctx.details.competitor_websites, ctx.details.competitor_handles)
        self.core_saved = 0

    # ---- steps ---------------------------------------------------------------------------------------------------

    def dedupe_links(self) -> list[Item]:
        first: dict[str, Item] = {}
        kept: list[Item] = []
        for it in self.items:
            key = rules.canonical_url(it.link)
            orig = first.get(key) if key else None
            if orig is None:
                if key:
                    first[key] = it
                it.queries.add(it.query)
                kept.append(it)
            else:
                it.dup_of, it.dup_pass = orig, 1
                orig.queries.add(it.query)
        return kept

    def _in_period(self, d: dt.date) -> bool:
        c = self.ctx
        return (c.start is None or d >= c.start) and (c.end is None or d <= c.end)

    def _exclude(self, it: Item, sheet: str, exclusion: str) -> None:
        it.sheet, it.exclusion = sheet, exclusion

    def route(self, it: Item) -> None:
        if not rules.has_text(it.title, it.snippet):
            it.sheet = UNCLASSIFIED
            it.notes.append("No title or snippet text")
            return
        if not it.host and not it.outlet:
            it.sheet = UNCLASSIFIED
            it.notes.append("No usable link or source name")
            return
        if it.date and it.date_source == "export" and not self._in_period(it.date):
            it.sheet = OUT_OF_RANGE
            it.notes.append(f"Published {it.date.isoformat()} is outside the run's period")
            return
        if it.date and it.date_source == "page" and not self._in_period(it.date):
            it.needs_review = True
            it.notes.append(f"Page date {it.date.isoformat()} is outside the run's period")

        it.platform = rules.platform_for(it.link)
        handle = rules.handle_for_link(it.platform, it.link)
        byline = rules.clean_byline(it.platform, _s(it.src.get("Author")))
        names = (it.outlet, byline) if it.platform else ()
        if (it.host and self.own.website(it.host)) or (it.platform and self.own.account(handle, *names)):
            it.sheet = it.bucket = BRAND_COMMUNICATION
            return

        mentions = self.ctx.mentions_brand(it.title) or self.ctx.mentions_brand(it.snippet)
        if (it.host and self.rival.website(it.host)) or (it.platform and self.rival.account(handle, *names)):
            it.bucket, it.sheet = COMPETITOR_OWNED, "Other Media"
        elif it.platform:
            it.bucket = it.sheet = it.platform
            excl = rules.platform_exclusion(it.platform, it.link)
            if excl:
                self._exclude(it, *excl)
                return
            if rules.is_profile_page(it.platform, it.link):
                self._exclude(it, LOW_QUALITY, "Profile / bio match")
                return
        else:
            hit = it.hit = self.ctx.media.match(it.link, it.outlet)
            excl = rules.exclusion_for(it.link, hit.known_by_domain)
            if excl:
                self._exclude(it, *excl)
                return
            if hit.status == "Known" and hit.type in rules.MASTER_TYPE_EXCLUSIONS:
                self._exclude(it, *rules.MASTER_TYPE_EXCLUSIONS[hit.type])
                it.notes.append(f"Master media list types {hit.publication} as {hit.type}")
                return
            it.bucket = it.sheet = hit.bucket
            it.notes.extend(hit.notes)
            it.needs_review = it.needs_review or hit.review
        if not mentions:
            self._exclude(it, LOW_QUALITY, "No brand mention")
            it.notes.append(f"No {self.ctx.brand_set} brand rule matches the title or snippet")

    def dedupe_text(self, kept: list[Item]) -> None:
        candidates = [it for it in kept if it.sheet in BUCKET_SHEETS and not it.exclusion]

        def group(it: Item) -> str:
            return "media" if it.bucket in (*MEDIA_BUCKETS, COMPETITOR_OWNED) else it.bucket

        def rank(it: Item) -> tuple[int, int, int]:
            return (_TIER.get(it.bucket, 0), LEVEL_ORDER.get(it.level, 9), it.i)

        seen: dict[tuple[str, str, str], Item] = {}
        for it in sorted(candidates, key=rank):
            keys = [
                (group(it), kind, k)
                for kind, k in (("title", rules.text_key(it.title)), ("hit", rules.text_key(it.snippet)))
                if k
            ]
            match = next((seen[k] for k in keys if k in seen), None)
            if match is not None:
                if rules.exempt_from_text_dedupe(it.bucket, it.level):
                    self.core_saved += 1
                else:
                    it.dup_of, it.dup_pass = match, 2
                    continue
            for k in keys:
                seen.setdefault(k, it)

    def place_duplicates(self) -> None:
        for it in self.items:
            if it.dup_pass == 2:
                it.sheet = DUPLICATE_SHEET[it.sheet]  # its own bucket's duplicate sheet
                it.notes.append(f"Duplicate title/hit sentence of {it.dup_of.link if it.dup_of else ''}")
        for it in self.items:
            if it.dup_pass != 1 or it.dup_of is None:
                continue
            orig = it.dup_of
            it.bucket = orig.bucket
            it.hit, it.platform = orig.hit, orig.platform
            if orig.sheet == BRAND_COMMUNICATION:
                it.sheet = BRAND_COMMUNICATION
                it.notes.append(f"Duplicate of {orig.link}")
            elif orig.sheet in BUCKET_SHEETS or orig.sheet in DUPLICATE_SHEET.values():
                it.sheet = orig.sheet if orig.dup_pass == 2 else DUPLICATE_SHEET[orig.sheet]
                it.notes.append("Duplicate link")
            else:
                it.sheet = orig.sheet
                it.exclusion = orig.exclusion
                it.listed = False

    # ---- output rows -------------------------------------------------------------------------------------------

    def finish(self, it: Item) -> None:
        it.byline = rules.clean_byline(it.platform, _s(it.src.get("Author")))
        if it.platform:
            it.author = rules.author_for_link(it.platform, it.link, it.byline)
            it.author_corrected = it.author.casefold() != it.outlet.lstrip("@").casefold()
        else:
            it.author = it.outlet
        opening = _s(it.src.get("Opening Text"))
        if opening and not rules.opening_text_ok(opening, it.snippet):
            it.opening, it.opening_blanked = "", True
        else:
            it.opening = opening

    def out_row(self, it: Item) -> dict[str, Any]:
        coverage = it.sheet in BUCKET_SHEETS or it.sheet in DUPLICATE_SHEET.values()
        hit = it.hit if it.bucket in (*MEDIA_BUCKETS, "") else None
        src = it.src
        source_name = hit.publication if hit else it.platform or ""
        return {
            "Date": it.date,
            "Link": it.link,
            "URL": it.host,
            "Author": it.author,
            "Title": it.title,
            "Opening Text": it.opening,
            "Hit Sentence": it.snippet,
            "Source Bucket": it.bucket,
            "Exclusion Type": it.exclusion,
            "Media Level": (hit.level if hit else "") if it.bucket in MEDIA_BUCKETS else "",
            "Media Type": hit.type if hit else "",
            "Date Source": it.date_source if it.date else "missing",
            "Verification Status": (
                "Not verified"
                if it.sheet == BRAND_COMMUNICATION
                else "Pending"
                if coverage and not it.exclusion
                else ""
            ),
            "Needs Review": it.needs_review if coverage else None,
            "Source Name": source_name,
            "Status": hit.status if hit and (it.bucket in MEDIA_BUCKETS or hit.status == "Known") else "",
            "Notes": "; ".join(dict.fromkeys(it.notes)),
            "Query": it.query,
            "Vertical": src.get("Vertical"),
            "Rank": src.get("Rank"),
            "Provider": src.get("Provider"),
            "Query Count": len(it.queries) if it.dup_pass == 0 else None,
            "Script Status": src.get("Status"),
            "Script Hit Sentence": src.get("Hit Sentence"),
            "Byline": it.byline,
        }

    def outcome(self, it: Item) -> str:
        if it.dup_pass == 1 and not it.listed:
            return f"Not listed: duplicate link of a row on {it.sheet}"
        if it.exclusion:
            return f"{it.sheet}: {it.exclusion}"
        if it.bucket == COMPETITOR_OWNED:
            return "Other Media (Competitor Owned)"
        return it.sheet


def _date_key(it: Item) -> tuple[int, int]:
    return (0, -it.date.toordinal()) if it.date else (1, 0)


def _sorted(items: list[Item], name: str) -> list[Item]:
    if name in DUPLICATE_SHEET.values():
        return sorted(items, key=lambda it: it.i)
    if name in EXCLUSION_SHEETS:
        return sorted(items, key=lambda it: (it.exclusion, it.i))
    if name == BRAND_COMMUNICATION:
        order = {p: n for n, p in enumerate((None, *PLATFORM_BUCKETS, "Other Sources"))}
        return sorted(items, key=lambda it: (order.get(it.platform, 99), it.dup_pass > 0, _date_key(it), it.i))
    if name == "Major Media":
        return sorted(items, key=lambda it: (LEVEL_ORDER.get(it.level, 9), _date_key(it), it.i))
    if name == "Other Media":
        return sorted(items, key=lambda it: (it.bucket == COMPETITOR_OWNED, _date_key(it), it.i))
    return sorted(items, key=lambda it: (_date_key(it), it.i))


def _pct(n: int, d: int) -> str:
    return f"{n / d:.0%}" if d else "-"


def clean(rows: Sequence[Mapping[str, Any]], ctx: CleanContext) -> CleanResult:
    c = _Cleaner(ctx, rows)
    kept = c.dedupe_links()
    for it in kept:
        c.route(it)
    c.dedupe_text(kept)
    c.place_duplicates()
    for it in c.items:
        c.finish(it)

    by_sheet: dict[str, list[Item]] = defaultdict(list)
    for it in c.items:
        if it.listed:
            by_sheet[it.sheet].append(it)
    for name in list(by_sheet):
        by_sheet[name] = _sorted(by_sheet[name], name)

    def data(name: str, columns: list[str] | None = None) -> Sheet:
        return Sheet(name, columns or DATA_COLUMNS, [c.out_row(it) for it in by_sheet.get(name, [])])

    clean_items = [
        it for b in BUCKET_SHEETS for it in by_sheet.get(b, []) if it.bucket != COMPETITOR_OWNED and not it.exclusion
    ]
    sheets: list[Sheet] = [Sheet("Clean Data", DATA_COLUMNS, [c.out_row(it) for it in clean_items])]
    sheets += [data(b) for b in BUCKET_SHEETS]
    sheets.append(data(BRAND_COMMUNICATION))
    sheets += [data(LOW_QUALITY, EXCLUSION_COLUMNS), data(SPAM, EXCLUSION_COLUMNS)]
    sheets += [data(UNCLASSIFIED), data(VERIFICATION_REMOVED), data(OUT_OF_RANGE)]
    sheets += [data(d) for d in DUPLICATE_SHEET.values() if by_sheet.get(d)]

    listed_rows = [r for s in sheets if s.name != "Clean Data" for r in s.rows]
    checks = {
        "buckets": rules.assert_buckets(r.get("Source Bucket") for r in listed_rows),
        "opening_text": rules.assert_opening_text(listed_rows),
        "dates": rules.assert_no_derived_dates(
            {"Date": r["Date"].isoformat() if r["Date"] else "", "Date Source": r["Date Source"]} for r in listed_rows
        ),
    }

    sheets.append(_domain_map(c, kept))
    sheets.append(_new_domains(by_sheet))
    sheets.append(_query_yield(c))
    raw = Sheet(
        "Raw Data",
        [*ctx.raw_columns, "Cleaning Outcome"],
        [{**{k: it.src.get(k) for k in ctx.raw_columns}, "Cleaning Outcome": c.outcome(it)} for it in c.items],
        kind="raw",
    )
    summary, facts = _summary(c, kept, by_sheet, clean_items, checks)
    sheets.insert(0, summary)
    sheets.append(raw)
    return CleanResult(sheets, facts)


# ---- process sheets --------------------------------------------------------------------------------------------


def _access(statuses: list[Any]) -> str:
    codes = {int(s) for s in statuses if isinstance(s, int | float) or str(s or "").isdigit()}
    if any(200 <= s < 400 for s in codes):
        return "Open"
    if codes & {401, 402, 403, 407, 429, 451}:
        return "Blocked"
    if codes & {404, 410}:
        return "Not found"
    return "Unknown"


def _domain_map(c: _Cleaner, kept: list[Item]) -> Sheet:
    by_host: dict[str, list[Item]] = defaultdict(list)
    for it in kept:
        if it.host:
            by_host[it.host].append(it)
    http: dict[str, list[Any]] = defaultdict(list)
    for it in c.items:
        if it.host:
            http[it.host].append(it.src.get("HTTP Status"))
    rows = []
    for host, items in sorted(by_host.items(), key=lambda kv: (-len(kv[1]), kv[0])):
        first = items[0]
        hit = next((it.hit for it in items if it.hit), None)
        dest = Counter(f"{it.sheet}: {it.exclusion}" if it.exclusion else it.sheet for it in items)
        bucket = next((it.bucket for it in items if it.bucket), "")
        rows.append(
            {
                "Domain": host,
                "Source Name": hit.publication if hit else first.platform or "",
                "Media ID": hit.media_id if hit else "",
                "Source Bucket": bucket,
                "Media Level": hit.level if hit and bucket in MEDIA_BUCKETS else "",
                "Media Type": hit.type if hit else "",
                "Matched By": hit.matched_by if hit else ("platform" if first.platform else ""),
                "Access": _access(http[host]),
                "Login Needed": "Unknown",
                "Article Count": len(items),
                # NEW only for coverage the master list does not know; an excluded domain is not a list candidate.
                "Status": hit.status if hit and (bucket in MEDIA_BUCKETS or hit.status == "Known") else "",
                "Destination": "; ".join(f"{k} ({n})" for k, n in dest.most_common()),
            }
        )
    cols = [
        "Domain",
        "Source Name",
        "Media ID",
        "Source Bucket",
        "Media Level",
        "Media Type",
        "Matched By",
        "Access",
        "Login Needed",
        "Article Count",
        "Status",
        "Destination",
    ]
    return Sheet("Source Bucket", cols, rows, kind="table")


def _new_domains(by_sheet: Mapping[str, list[Item]]) -> Sheet:
    hosts: dict[str, list[Item]] = defaultdict(list)
    for it in by_sheet.get("Other Media", []):
        if it.hit and it.hit.status == "NEW" and it.bucket == "Other Media":
            hosts[it.host].append(it)
    rows = [
        {
            "Domain": host,
            "Publication name": "",
            "Suggested bucket": "Other Media",
            "Rows": len(items),
            "Example link": items[0].link,
            "Language": "",
            "Geography": "",
        }
        for host, items in sorted(hosts.items(), key=lambda kv: (-len(kv[1]), kv[0]))
    ]
    cols = ["Domain", "Publication name", "Suggested bucket", "Rows", "Example link", "Language", "Geography"]
    return Sheet("NEW Domains", cols, rows, kind="table")


def _query_yield(c: _Cleaner) -> Sheet:
    stats: dict[str, Counter[str]] = defaultdict(Counter)
    provider: dict[str, str] = {}
    for it in c.items:
        s = stats[it.query]
        provider.setdefault(it.query, _s(it.src.get("Provider")))
        s["in"] += 1
        if it.dup_pass:
            s["dup"] += 1
        elif it.sheet == BRAND_COMMUNICATION:
            s["owned"] += 1
        elif it.sheet in BUCKET_SHEETS and not it.exclusion and it.bucket != COMPETITOR_OWNED:
            s["clean"] += 1
        else:
            s["out"] += 1
    rows = [
        {
            "Query": q,
            "Provider": provider[q],
            "Rows in": s["in"],
            "Duplicates": s["dup"],
            "Clean (first seen)": s["clean"],
            "Brand Communication": s["owned"],
            "Excluded": s["out"],
            "Clean rate": _pct(s["clean"], s["in"]),
        }
        for q, s in stats.items()
    ]
    rows.sort(key=lambda r: (-r["Clean (first seen)"], -r["Rows in"]))
    cols = [
        "Query",
        "Provider",
        "Rows in",
        "Duplicates",
        "Clean (first seen)",
        "Brand Communication",
        "Excluded",
        "Clean rate",
    ]
    return Sheet("Query Yield", cols, rows, kind="table")


def _summary(
    c: _Cleaner,
    kept: list[Item],
    by_sheet: Mapping[str, list[Item]],
    clean_items: list[Item],
    checks: Mapping[str, list[Any]],
) -> tuple[Sheet, dict[str, Any]]:
    ctx = c.ctx
    rows: list[dict[str, Any]] = []

    def head(text: str) -> None:
        rows.append({"Item": text, "Value": None, "_section": True})

    def add(item: str, value: Any) -> None:
        rows.append({"Item": item, "Value": value})

    period = f"{ctx.start} to {ctx.end}" if ctx.start and ctx.end else "Any date"
    counts = ctx.media.counts()
    head("Run")
    add("Run", ctx.run_name)
    add("Brand set", ctx.brand_set)
    add("Verification", f"#{ctx.verify_job_id} (its statuses are carried as Script Status, not used)")
    add("Period", period)
    add("Region", ctx.region.upper() if ctx.region else "Provider default")
    add(
        "Master media list",
        f"{ctx.media_list_name}: {counts['rows']} rows (Major {counts.get('Major Media', 0)}, "
        f"Regional {counts.get('Regional Media', 0)}, Other {counts.get('Other Media', 0)}); "
        f"{len(ctx.media.problems)} data problems",
    )
    d = ctx.details
    add("Own websites", ", ".join(d.own_websites) or "(none set)")
    add("Own social handles", ", ".join(d.own_handles) or "(none set)")
    add("Competitor websites", ", ".join(d.competitor_websites) or "(none set)")
    add("Competitor social handles", ", ".join(d.competitor_handles) or "(none set)")

    p1 = [it for it in c.items if it.dup_pass == 1]
    p2 = [it for it in c.items if it.dup_pass == 2]
    head("Rows")
    add("Rows in", len(c.items))
    add("Unique links", len(kept))
    add("Clean Data", len(clean_items))

    head("Removed or moved, by reason")
    add("Out of date range (export date outside the period)", len(by_sheet.get(OUT_OF_RANGE, [])))
    add("Unclassified (no text, or no link and no source name)", len(by_sheet.get(UNCLASSIFIED, [])))
    owned = [it for it in by_sheet.get(BRAND_COMMUNICATION, []) if not it.dup_pass]
    add("Brand communication (unique)", len(owned))
    add("Duplicates, pass 1 (same link)", len(p1))
    add("  of which not listed (copies of excluded rows)", sum(1 for it in p1 if not it.listed))
    add("Duplicates, pass 2 (same title or hit sentence)", len(p2))
    add("Core-level Major Media rows kept by the exemption", c.core_saved)
    add("Competitor Owned (on Other Media, not in Clean Data)", sum(1 for it in kept if it.bucket == COMPETITOR_OWNED))
    for sheet in EXCLUSION_SHEETS:
        items = [it for it in by_sheet.get(sheet, []) if not it.dup_pass]
        add(f"{sheet} (unique)", len(items))
        for kind, n in Counter(it.exclusion for it in items).most_common():
            add(f"  {kind}", n)

    head("Clean Data by source bucket")
    for b in BUCKET_SHEETS:
        add(b, sum(1 for it in clean_items if it.bucket == b))
    for level in ("Core", "Level 1", "Level 2"):
        add(f"  Major Media, {level}", sum(1 for it in clean_items if it.bucket == "Major Media" and it.level == level))

    head("Brand communication")
    add("Websites", sum(1 for it in owned if not it.platform))
    for p in (*PLATFORM_BUCKETS, "Other Sources"):
        n = sum(1 for it in owned if it.platform == p)
        if n:
            add(p, n)
    add("Duplicates (marked in Notes)", sum(1 for it in by_sheet.get(BRAND_COMMUNICATION, []) if it.dup_pass))
    dates = sorted(it.date for it in owned if it.date)
    add("Date range", f"{dates[0]} to {dates[-1]}" if dates else "-")

    media_items = [it for it in kept if it.hit]
    head("Master media list matching (unique links)")
    for how in ("domain+path", "domain", "parent-domain", "name", "none"):
        add(f"Matched by {how}", sum(1 for it in media_items if it.hit and it.hit.matched_by == how))
    new_domains = {it.host for it in by_sheet.get("Other Media", []) if it.hit and it.hit.status == "NEW"}
    add("NEW domains (Other Media, see NEW Domains)", len(new_domains))
    review = [it for it in clean_items if it.needs_review]
    add("Clean Data rows flagged Needs Review", len(review))

    head("Dates")
    undated = [it for it in clean_items if not it.date]
    add("Undated rows kept (never filled by inference)", len(undated))
    add("Dates taken from the page (absolute timestamps only)", sum(it.date_source == "page" for it in clean_items))
    for b in (*BUCKET_SHEETS, BRAND_COMMUNICATION):
        items = owned if b == BRAND_COMMUNICATION else [it for it in clean_items if it.bucket == b]
        if items:
            add(f"Date fill rate, {b}", _pct(sum(1 for it in items if it.date), len(items)))

    platform_rows = [it for it in clean_items if it.platform]
    head("Data checks")
    add("Platform rows whose Author was corrected from the link", sum(1 for it in platform_rows if it.author_corrected))
    add("Opening Text blanked because it repeated the snippet", sum(1 for it in c.items if it.opening_blanked))
    add("Source Bucket values allowed", "OK" if not checks["buckets"] else "FAIL: " + ", ".join(checks["buckets"]))
    add("Opening Text never equals Hit Sentence", "OK" if not checks["opening_text"] else "FAIL")
    add("Dates are absolute or blank", "OK" if not checks["dates"] else "FAIL: " + "; ".join(checks["dates"][:5]))

    head("Left for the reviewed phases (not scripted)")
    add("Passing mentions", "Not marked; Driver is blank on every row")
    add("Wrong entity", "Only what the brand set's own rules exclude; check namesakes by hand")
    add("NEW domain publication names", "Blank on NEW Domains; open each site to confirm")
    add(
        "Verification, tagging, sentiment, scoring",
        "Verification Status = Pending; Driver, Sub Parameter, Sentiment blank",
    )

    sheet_counts = {s: len(v) for s, v in by_sheet.items()}
    facts = {
        "rows_in": len(c.items),
        "unique_links": len(kept),
        "clean_data": len(clean_items),
        "brand_communication": len(owned),
        "competitor_owned": sum(1 for it in kept if it.bucket == COMPETITOR_OWNED),
        "duplicates_link": len(p1),
        "duplicates_text": len(p2),
        "core_saved": c.core_saved,
        "new_domains": len(new_domains),
        "needs_review": len(review),
        "buckets": {b: sum(1 for it in clean_items if it.bucket == b) for b in BUCKET_SHEETS},
        "sheets": {k: sheet_counts[k] for k in sorted(sheet_counts)},
        "checks_ok": not any(checks.values()),
    }
    return Sheet("Cleaning Summary", ["Item", "Value"], rows, kind="summary"), facts
