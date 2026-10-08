# Simple Brand Form Revision 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the revision 1 brand form (built on `feat/brand-profiles`) into a regex-free, AI-free brand configuration system with per-brand people and saved test sentences, as specified in revision 2.

**Architecture:** url-verification's `profile.py` gets the revision 2 profile model and `build_rules`; `brands.py` writes the new YAML and adds `check_tests`. The pipeline drops Suggest and the raw-rule endpoints, replaces preview/test with `POST /api/brand-profiles/check`, and the web app replaces the raw editor, Suggest UI, generated-rules view and free-text try panel with the new form, per-brand test sentences, a read-only view of hand-written sets and a plain summary in the Verify step.

**Tech Stack:** Python 3.12, dataclasses, ruamel.yaml, pytest; FastAPI, Pydantic v2; Next.js 16, React 19, Tailwind 4, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-08-simple-brand-form-design.md` (revision 2). Read it before every task. Revision 1 code is the starting point; anything the spec removes is deleted, not hidden.

## Global Constraints

- Repos and branches: `~/Desktop/niks/url-verification` on `feat/brand-profiles` (Tasks 1-2); the pipeline worktree `~/Desktop/niks/repscore-pipeline-brand-form` on `feat/brand-profiles` (Tasks 3-8). Never touch `~/Desktop/niks/repscore-pipeline` (main checkout) or url-verification's uncommitted `config.yaml` and untracked files. Stage files explicitly.
- Commits: conventional prefixes, no `Co-Authored-By`, no agent name. Never use the em dash character anywhere.
- Regex never appears in the UI. No AI, no Anthropic dependency, no API key.
- Values: 1-200 characters after trimming, at least one letter or digit; hashtags and handles letters, digits and `_` (one leading `#` / `@` stripped); description up to 500; test sentence up to 1000; at most 50 tests per brand; `expect` is `match` or `no_match`.
- Fixed behaviour: common-word brand name matches exact capitals, confirming word within 100 characters; people who need the brand nearby use a 150-character window.
- Form labels (exact): "Brand name", "Description", "Other brand names / aliases", "Hashtags", "Social handles", "Is the brand name a common word?", "Words that confirm this is the brand", "After the brand name", "Before the brand name", "Nearby / same sentence", "Exact phrases to ignore", "People associated with the brand", "Only count when brand is nearby", "Test configuration", "Match", "Not a match".
- Commands. url-verification: `uv run pytest -q`. API: `cd api && uv run ruff format . && uv run pytest -q && uv run ruff check . && uv run pyright`. Web: `cd web && npm test && npx tsc --noEmit && npm run lint`. E2E: `cd e2e && npx playwright test` (ports 8100, 8200, 3100 must be free).
- If `next dev` rewrites `web/AGENTS.md` or other generated files, do not stage them.

## Review Focus

1. A test sentence whose only mention belongs to another brand in the same set must not count as a match for this brand (Genius sentence under Safari). Test in Task 2.
2. Unticking "common word" must not leave hidden confirming/exclusion values that block saving. Test in Task 5 (helper) and Task 6 (e2e).
3. Hand-written sets must stay usable for verification and deletable, but no screen may show their regex. Test in Tasks 6-7 (e2e asserts no `\w`, `(?:`, `[#@]` text on the Brands and Verify pages).
4. A test sentence containing quotes, colons or non-Latin text must round-trip through config.yaml unchanged. Test in Task 2.
5. Hashtags must only match with `#` and handles only with `@`. Test in Task 1.

---

### Task 1: Revision 2 profile model and rules (url-verification)

**Files:**
- Rewrite: `urlverify/profile.py`
- Rewrite: `tests/test_profile.py`, `tests/test_profile_build.py` (keep `PARITY_CASES` exactly as it is now)

**Interfaces:**
- Produces: `ProfileError`, `Exclusions(followed_by, preceded_by, nearby, phrases)` with `is_empty()`, `Person(name, require_brand_nearby=False)`, `TestSentence(text, expect)`, `ProfileBrand(name, description="", aliases, hashtags, handles, common_word=False, confirming_words, exclusions, people, tests)`, `BrandProfile(brands)`, `ProfileWarning(brand, field, message)`, `EXCLUSION_FIELDS`, `EXPECT`, `LABELS`, `profile_from_dict`, `profile_to_dict`, `normalise_tag`, `value_problem(value, *, tag_value=False)`, `automatic_context`, `validate_profile`, `lit`, `tag`, `SUFFIX`, `BuildResult(rules, warnings, labels, owners)`, `build_rules`. Warning `field` values: `confirming_words`, `phrases`.

- [ ] **Step 1: Replace `urlverify/profile.py` with this code** (it was run against the live config.yaml: all 39 parity cases pass)

```python
"""Brand profiles: the plain-language answers from the pipeline's brand configuration form, and the rules built
from them.

A profile never contains regex. build_rules escapes every value the user typed before turning the profile into
BrandRule objects, so the form can be used by people who do not know regular expressions exist.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from .models import BrandRule

MAX_VALUE = 200
MAX_DESCRIPTION = 500
MAX_TEST_TEXT = 1000
MAX_TESTS = 50
WINDOW = 100  # characters either side in which a confirming word must appear (about 15 words)
PEOPLE_WINDOW = 150
EXPECT = ("match", "no_match")
EXCLUSION_FIELDS = ("followed_by", "preceded_by", "nearby", "phrases")
# Form labels, so messages name what the user sees on screen.
LABELS = {
    "name": "Brand name",
    "description": "Description",
    "aliases": "Other brand names / aliases",
    "hashtags": "Hashtags",
    "handles": "Social handles",
    "confirming_words": "Words that confirm this is the brand",
    "followed_by": "Not the brand: after the brand name",
    "preceded_by": "Not the brand: before the brand name",
    "nearby": "Not the brand: nearby, in the same sentence",
    "phrases": "Exact phrases to ignore",
    "people": "People",
    "tests": "Test sentences",
}
_TAG_VALUE = re.compile(r"^[A-Za-z0-9_]+$")


class ProfileError(ValueError):
    pass


@dataclass
class Exclusions:
    followed_by: list[str] = field(default_factory=list)
    preceded_by: list[str] = field(default_factory=list)
    nearby: list[str] = field(default_factory=list)
    phrases: list[str] = field(default_factory=list)

    def is_empty(self) -> bool:
        return not any(getattr(self, k) for k in EXCLUSION_FIELDS)


@dataclass
class Person:
    name: str
    require_brand_nearby: bool = False


@dataclass
class TestSentence:
    __test__ = False  # not a pytest test class
    text: str
    expect: str  # "match" | "no_match"


@dataclass
class ProfileBrand:
    name: str
    description: str = ""
    aliases: list[str] = field(default_factory=list)
    hashtags: list[str] = field(default_factory=list)
    handles: list[str] = field(default_factory=list)
    common_word: bool = False
    confirming_words: list[str] = field(default_factory=list)
    exclusions: Exclusions = field(default_factory=Exclusions)
    people: list[Person] = field(default_factory=list)
    tests: list[TestSentence] = field(default_factory=list)


@dataclass
class BrandProfile:
    brands: list[ProfileBrand]


@dataclass(frozen=True)
class ProfileWarning:
    brand: int | None  # 0-based brand index; None for a set-level warning
    field: str
    message: str


# ---- dict conversion ---------------------------------------------------------------------------------------------


def _mapping(d: object, allowed: set[str], where: str) -> dict:
    if not isinstance(d, dict):
        raise ProfileError(f"{where}: expected a mapping")
    unknown = set(d) - allowed
    if unknown:
        raise ProfileError(f"{where}: unknown field(s) {sorted(map(str, unknown))}")
    return d


def _text(d: dict, key: str, where: str, default: str | None = None) -> str:
    v = d.get(key, default)
    if not isinstance(v, str):
        raise ProfileError(f"{where}: {key} must be text")
    return v


def _texts(d: dict, key: str, where: str) -> list[str]:
    v = d.get(key)
    if v is None:
        return []
    if not isinstance(v, list) or not all(isinstance(x, str) for x in v):
        raise ProfileError(f"{where}: {key} must be a list of text values")
    return list(v)


def _flag(d: dict, key: str, default: bool, where: str) -> bool:
    v = d.get(key, default)
    if not isinstance(v, bool):
        raise ProfileError(f"{where}: {key} must be true or false")
    return v


def _list(d: dict, key: str, where: str) -> list:
    v = d.get(key)
    if v is None:
        return []
    if not isinstance(v, list):
        raise ProfileError(f"{where}: {key} must be a list")
    return v


def _brand_from_dict(b: object, where: str) -> ProfileBrand:
    b = _mapping(b, {"name", "description", "aliases", "hashtags", "handles", "common_word", "confirming_words",
                     "exclusions", "people", "tests"}, where)
    ex_raw = b.get("exclusions")
    ex = Exclusions() if ex_raw is None else Exclusions(
        **{k: _texts(_mapping(ex_raw, set(EXCLUSION_FIELDS), f"{where} exclusions"), k, f"{where} exclusions")
           for k in EXCLUSION_FIELDS})
    people = []
    for j, x in enumerate(_list(b, "people", where), start=1):
        pw = f"{where} person {j}"
        x = _mapping(x, {"name", "require_brand_nearby"}, pw)
        people.append(Person(name=_text(x, "name", pw), require_brand_nearby=_flag(x, "require_brand_nearby", False, pw)))
    tests = []
    for j, t in enumerate(_list(b, "tests", where), start=1):
        tw = f"{where} test {j}"
        t = _mapping(t, {"text", "expect"}, tw)
        expect = t.get("expect")
        if not isinstance(expect, str) or expect not in EXPECT:
            raise ProfileError(f"{tw}: expect must be match or no_match, not {expect!r}")
        tests.append(TestSentence(text=_text(t, "text", tw), expect=expect))
    return ProfileBrand(
        name=_text(b, "name", where),
        description=_text(b, "description", where, ""),
        aliases=_texts(b, "aliases", where),
        hashtags=_texts(b, "hashtags", where),
        handles=_texts(b, "handles", where),
        common_word=_flag(b, "common_word", False, where),
        confirming_words=_texts(b, "confirming_words", where),
        exclusions=ex,
        people=people,
        tests=tests,
    )


def profile_from_dict(d: object) -> BrandProfile:
    d = _mapping(d, {"brands"}, "profile")
    brands_raw = d.get("brands")
    if brands_raw is None or brands_raw == []:
        raise ProfileError("profile: add at least one brand")
    if not isinstance(brands_raw, list):
        raise ProfileError("profile: brands must be a list")
    return BrandProfile(brands=[_brand_from_dict(b, f"brand {i}") for i, b in enumerate(brands_raw, start=1)])


def profile_to_dict(p: BrandProfile) -> dict:
    return {
        "brands": [
            {
                "name": b.name,
                "description": b.description,
                "aliases": list(b.aliases),
                "hashtags": list(b.hashtags),
                "handles": list(b.handles),
                "common_word": b.common_word,
                "confirming_words": list(b.confirming_words),
                "exclusions": {k: list(getattr(b.exclusions, k)) for k in EXCLUSION_FIELDS},
                "people": [{"name": x.name, "require_brand_nearby": x.require_brand_nearby} for x in b.people],
                "tests": [{"text": t.text, "expect": t.expect} for t in b.tests],
            }
            for b in p.brands
        ]
    }


# ---- validation ----------------------------------------------------------------------------------------------------


def normalise_tag(value: str) -> str:
    """A hashtag or handle without surrounding spaces and one leading # or @."""
    v = value.strip()
    return v[1:] if v[:1] in ("#", "@") else v


def value_problem(value: str, *, tag_value: bool = False) -> str | None:
    """Why a single form value is unusable, or None when it is fine."""
    v = value.strip()
    if not v:
        return "is empty"
    if len(v) > MAX_VALUE:
        return f"is longer than {MAX_VALUE} characters"
    if not any(ch.isalnum() for ch in v):
        return "must contain a letter or digit"
    if tag_value and not _TAG_VALUE.match(normalise_tag(v)):
        return "may only contain letters, digits and _"
    return None


def _check_list(values: list[str], label: str, where: str, *, tag_value: bool = False) -> None:
    seen: set[str] = set()
    for v in values:
        problem = value_problem(v, tag_value=tag_value)
        if problem:
            raise ProfileError(f"{where}: {label}: {v!r} {problem}")
        key = (normalise_tag(v) if tag_value else v.strip()).casefold()
        if key in seen:
            raise ProfileError(f"{where}: {label}: {v!r} is a duplicate")
        seen.add(key)


def automatic_context(p: BrandProfile) -> list[str]:
    """Names that confirm any common-word brand name in the set: every brand name, every alias, and every person
    who is not marked "only count when the brand is nearby". Such a person ("Raj") has a common name, so letting
    them confirm the brand word would produce false positives."""
    names = [b.name for b in p.brands] + [a for b in p.brands for a in b.aliases]
    names += [x.name for b in p.brands for x in b.people if not x.require_brand_nearby]
    return list(dict.fromkeys(n.strip() for n in names))


def validate_profile(p: BrandProfile) -> list[ProfileWarning]:
    """Raise ProfileError for anything that cannot be saved; return warnings for things that look like mistakes."""
    if not p.brands:
        raise ProfileError("Add at least one brand.")
    seen_names: set[str] = set()
    for i, b in enumerate(p.brands, start=1):
        if value_problem(b.name):
            raise ProfileError(f"Brand {i}: {LABELS['name']} {value_problem(b.name)}")
        where = f"Brand {i} ({b.name.strip()!r})"
        key = b.name.strip().casefold()
        if key in seen_names:
            raise ProfileError(f"Brand names must be unique: {b.name.strip()!r} appears twice")
        seen_names.add(key)
        if len(b.description) > MAX_DESCRIPTION:
            raise ProfileError(f"{where}: {LABELS['description']} is longer than {MAX_DESCRIPTION} characters")
        _check_list(b.aliases, LABELS["aliases"], where)
        _check_list(b.hashtags, LABELS["hashtags"], where, tag_value=True)
        _check_list(b.handles, LABELS["handles"], where, tag_value=True)
        if not b.common_word and (b.confirming_words or not b.exclusions.is_empty()):
            raise ProfileError(f"{where}: confirming words and 'not the brand' words are only used when the brand "
                               "name is a common word")
        _check_list(b.confirming_words, LABELS["confirming_words"], where)
        for k in EXCLUSION_FIELDS:
            _check_list(getattr(b.exclusions, k), LABELS[k], where)
        _check_list([x.name for x in b.people], LABELS["people"], where)
        if len(b.tests) > MAX_TESTS:
            raise ProfileError(f"{where}: {LABELS['tests']}: at most {MAX_TESTS} per brand")
        for j, t in enumerate(b.tests, start=1):
            if not t.text.strip():
                raise ProfileError(f"{where}: {LABELS['tests']}: sentence {j} is empty")
            if len(t.text) > MAX_TEST_TEXT:
                raise ProfileError(f"{where}: {LABELS['tests']}: sentence {j} is longer than {MAX_TEST_TEXT} "
                                   "characters")
            if t.expect not in EXPECT:
                raise ProfileError(f"{where}: {LABELS['tests']}: sentence {j} must expect match or no_match")

    warnings: list[ProfileWarning] = []
    auto = automatic_context(p)
    for i, b in enumerate(p.brands):
        if not b.common_word:
            continue
        word = b.name.strip().casefold()
        if not b.confirming_words and not [n for n in auto if n.casefold() != word]:
            warnings.append(ProfileWarning(i, "confirming_words", (
                f"Nothing confirms {b.name.strip()!r}, so every use of the word counts. "
                "Add words that confirm this is the brand.")))
        for phrase in b.exclusions.phrases:
            if word not in phrase.casefold():
                warnings.append(ProfileWarning(i, "phrases", (
                    f"{phrase.strip()!r} does not contain {b.name.strip()!r}, so it can never block a mention.")))
    return warnings


# ---- building rules ------------------------------------------------------------------------------------------------

# The matcher treats "-" as part of a word, so "Kedaara-backed" would not match a plain "Kedaara" pattern.
SUFFIX = r"(?:-(?i:backed|owned|led|controlled|funded|managed))?"
_ASCII_WORD = re.compile(r"^[A-Za-z0-9]+$")
_SENTENCE_GAP = r"[^.!?\n]{0,60}"


@dataclass
class BuildResult:
    rules: list[BrandRule]
    warnings: list[ProfileWarning]
    labels: dict[str, str]  # generated exclusion regex -> plain-language reason
    owners: dict[str, int]  # rule name -> index of the brand it belongs to


def _pieces(text: str) -> list[str]:
    return [p for p in re.split(r"[\s-]+", text.strip()) if p]


def lit(text: str) -> str:
    """The text as a literal pattern, where any run of spaces or hyphens matches any other."""
    return r"[\s-]+".join(re.escape(p) for p in _pieces(text))


def tag(text: str) -> str | None:
    """Hashtag/handle form: "Safari Industries" is written #safariindustries or @safari_industries."""
    pieces = _pieces(text)
    if not pieces or not all(_ASCII_WORD.match(p) for p in pieces):
        return None
    return "[#@]" + "_?".join(pieces) + r"\w*"


def _bounded(pattern: str) -> str:
    return rf"(?<!\w){pattern}(?!\w)"


def _plural(text: str) -> str:
    return lit(text) + "(?:s|es)?"


def _any_of(values: list[str], form) -> str:
    # Scoped (?i:...) keeps these words case-insensitive even inside a case-sensitive rule.
    return "(?i:" + "|".join(form(v) for v in values) + ")"


def _words(values: list[str]) -> str:
    return ", ".join(v.strip() for v in values)


def _common_word_rule(b: ProfileBrand, auto: list[str], labels: dict[str, str]) -> BrandRule:
    name = b.name.strip()
    word = lit(name)
    ex = b.exclusions
    context = [_bounded(_plural(c)) for c in b.confirming_words]
    context += [_bounded(lit(n)) for n in auto if n.casefold() != name.casefold()]
    exclude: list[str] = []

    def add(rx: str, label: str) -> None:
        exclude.append(rx)
        labels[rx] = label

    if ex.followed_by:
        add(word + r"[\s-]+" + _any_of(ex.followed_by, _plural) + r"(?!\w)", f"followed by {_words(ex.followed_by)}")
    if ex.preceded_by:
        add(r"(?<!\w)" + _any_of(ex.preceded_by, _plural) + r"[\s-]+" + word, f"preceded by {_words(ex.preceded_by)}")
    if ex.nearby:
        others = _bounded(_any_of(ex.nearby, lit))
        label = f"in the same sentence as {_words(ex.nearby)}"
        add(word + _SENTENCE_GAP + others, label)
        add(others + _SENTENCE_GAP + word, label)
    for phrase in ex.phrases:
        add(_bounded("(?i:" + lit(phrase) + ")"), f"the phrase {phrase.strip()}")
    return BrandRule(name=name, pattern=word + SUFFIX, case_sensitive=True, context_window=WINDOW,
                     require_context=list(dict.fromkeys(context)), exclude=exclude)


def build_rules(p: BrandProfile) -> BuildResult:
    warnings = validate_profile(p)
    rules: list[BrandRule] = []
    labels: dict[str, str] = {}
    owners: dict[str, int] = {}
    auto = automatic_context(p)

    def own(rule: BrandRule, i: int) -> None:
        rules.append(rule)
        owners.setdefault(rule.name, i)

    for i, b in enumerate(p.brands):
        name = b.name.strip()
        names = ([] if b.common_word else [name]) + list(b.aliases)
        alts: list[str] = []
        for n in names:
            alts.append(lit(n) + SUFFIX)
            t = tag(n)
            if t:
                alts.append(t)
        alts += [rf"#{re.escape(normalise_tag(h))}\w*" for h in b.hashtags]
        alts += [rf"@{re.escape(normalise_tag(h))}\w*" for h in b.handles]
        if alts:
            own(BrandRule(name=name, pattern="|".join(dict.fromkeys(alts))), i)
        if b.common_word:
            own(_common_word_rule(b, auto, labels), i)

        always = [x.name for x in b.people if not x.require_brand_nearby]
        nearby = [x.name for x in b.people if x.require_brand_nearby]
        if always:
            own(BrandRule(name=f"{name} leadership", pattern="|".join(lit(n) for n in always)), i)
        if nearby:
            brand_terms = [name] + list(b.aliases)
            own(BrandRule(name=f"{name} leadership (brand nearby)", pattern="|".join(lit(n) for n in nearby),
                          context_window=PEOPLE_WINDOW,
                          require_context=list(dict.fromkeys(_bounded(lit(n)) for n in brand_terms))), i)
    return BuildResult(rules=rules, warnings=warnings, labels=labels, owners=owners)
```

- [ ] **Step 2: Rewrite the unit tests**

`tests/test_profile.py` (model and validation) must cover, each as its own test with exact assertions:
- `profile_from_dict` round trip: `profile_from_dict(profile_to_dict(p)) == p` for the spec's Safari example; defaults (`description ""`, `common_word False`, empty exclusions, `require_brand_nearby False`); missing `exclusions`/`people`/`tests` accepted.
- Bad shapes raise `ProfileError` (parametrized): unknown brand key, unknown exclusions key, `aliases` not a list, `common_word: "yes"`, `expect: "maybe"`, `people: "x"`, `tests: [{"text": "a"}]` (missing expect), top-level not a mapping, empty brands, mixed-type unknown keys (`{1: "x", "foo": "y"}`).
- `value_problem`: empty, 201 chars, `"--"`, `"safari bags"` with `tag_value=True`, `"#safari_bags"` ok, `"@safari"` ok, `"##x"` rejected with `tag_value=True` (only one leading `#` is stripped), Devanagari ok.
- `validate_profile`: duplicate brand names (case-insensitive); empty brand name; description 501 chars; duplicate alias with the label "Other brand names / aliases"; invalid hashtag with "Hashtags"; invalid handle with "Social handles"; confirming words on a non-common brand -> "only used when the brand name is a common word"; exclusions on a non-common brand -> same; duplicate people within a brand; 51 tests; empty test text; 1001-char test text.
- Warnings: common word with nothing confirming -> `(0, "confirming_words")`; no warning when another brand or a person without `require_brand_nearby` exists; no rescue from a person with `require_brand_nearby=True`; exact phrase without the brand name -> `(0, "phrases")`.

`tests/test_profile_build.py` must cover (keep the `hits(profile, text)` helper style: offsets from `BrandMatcher(build_rules(p).rules).find(text, "body")`):
- `lit` escaping and space/hyphen equivalence; `tag` only for ASCII; symbol-led confirming words (`"$5 mn"`, `"#qcom"`).
- Non-common brand: the brand name itself matches (`ProfileBrand("Mokobara")` alone counts "Mokobara grew"), `-backed`/`-Backed` forms, aliases, auto hashtag form of the name.
- Hashtags only with `#`: `hashtags=["safaribags"]` counts "#safaribags" and not "@safaribags"; handles only with `@`: `handles=["safari_luggage"]` counts "@safari_luggage" and not "#safari_luggage".
- Common word: the SAFARI parametrized cases from revision 1 rewritten for the new model (brand name "Safari", `common_word=True`, aliases `["Safari Industries"]`, confirming `["luggage", "bag"]`, exclusions followed_by `["browser", "tour"]`, preceded_by `["Apple", "jeep"]`, nearby `["Serengeti", "Kruger"]`, phrases `["Safari Rally"]`, people `[Person("Sudhir Jatia")]`) with the same expected counts as today, plus the boundary cases "Pineapple Safari luggage." (counts), "Safari luggage Krugerrand." (counts), "Safari skyline" with another brand "Sky" (0).
- Labels: exactly `{"followed by browser, tour", "preceded by Apple, jeep", "in the same sentence as Serengeti, Kruger", "the phrase Safari Rally"}`.
- People per brand: `{brand} leadership` always counted; `{brand} leadership (brand nearby)` only with the brand's name or aliases within 150 characters; a nearby-only person does not confirm the brand word ("Raj booked a Safari trip" -> only Raj at offset 0 counts when Raj has `require_brand_nearby=True` and Safari is common with confirming `["luggage"]`).
- `owners`: every rule name maps to its brand index (two brands, each with people).
- Rule order: `[name, name, "name leadership", ...]` per brand in form order.
- Parity: replace `PARITY_PROFILES` with the revision 2 profiles below; keep `PARITY_CASES`, the `hand_written` fixture and the visible-skip parity test unchanged.

```python
E = Exclusions
PARITY_PROFILES = {
    "safari": BrandProfile([
        ProfileBrand("Safari", aliases=["Safari Industries", "SAFARIND"], hashtags=["safaribags", "safariluggage"],
                     common_word=True,
                     confirming_words=["luggage", "bag", "trolley", "suitcase", "backpack", "NSE", "BSE", "share price",
                                       "quarter"],
                     exclusions=E(
                         followed_by=["browser", "extension", "bookmark", "reader", "window", "tab", "park", "tour",
                                      "lodge", "ride", "camp", "guide", "experience", "holiday", "destination",
                                      "vehicle", "suit", "hat"],
                         preceded_by=["Apple", "iOS", "macOS", "Mac", "iPhone", "iPad", "web", "wildlife", "jungle",
                                      "jeep", "desert", "game", "photo", "night", "walking", "African", "bush",
                                      "forest", "tiger", "lion"],
                         nearby=["Masai Mara", "Serengeti", "Kruger", "Ranthambore", "Corbett", "Kaziranga",
                                 "Bandhavgarh"]),
                     people=[Person("Sudhir Jatia")]),
        ProfileBrand("Genius", common_word=True, confirming_words=["luggage", "bag", "trolley", "suitcase", "backpack"],
                     exclusions=E(followed_by=["Bar", "Hour", "Scholar"],
                                  preceded_by=["evil", "creative", "marketing", "comic", "stroke", "work", "resident",
                                               "certified"])),
        ProfileBrand("Magnum", common_word=True, confirming_words=["luggage", "bag", "trolley", "suitcase", "backpack"],
                     exclusions=E(followed_by=["ice cream", "PI", "Photos", "opus", "Research"],
                                  nearby=["Dirty Harry", "revolver", "handgun", "calibre", "caliber"])),
    ]),
    "vip": BrandProfile([
        ProfileBrand("VIP", aliases=["V.I.P. Industries", "VIP Industries", "VIPIND"],
                     hashtags=["vipindustries", "vip_industries", "vipbags"],
                     handles=["vipindustries", "vip_industries", "vipbags"], common_word=True,
                     confirming_words=["Industries", "Bag", "luggage", "Ltd"],
                     exclusions=E(followed_by=["access", "pass", "lounge", "ticket", "treatment", "guest", "member",
                                               "area", "section", "room", "list", "service", "customer", "client",
                                               "experience", "package", "entry", "seat"]),
                     people=[Person("Dilip Piramal"), Person("Neetu Kashiramka")]),
        ProfileBrand("Skybags", aliases=["Sky bags"], hashtags=["skybags"], handles=["skybags"]),
        ProfileBrand("Carlton", common_word=True,
                     confirming_words=["luggage", "bag", "trolley", "suitcase", "backpack", "travel"],
                     exclusions=E(followed_by=["Hotel", "Tower", "Bank", "House", "Street", "Road", "Club",
                                               "University", "Cigarette"], phrases=["Ritz-Carlton"])),
    ]),
    "basil": BrandProfile([ProfileBrand(
        "Basil", common_word=True,
        confirming_words=["lunch box", "lunchbox", "bento", "water bottle", "food jar", "tiffin", "kid", "children",
                          "school", "D2C", "houseware"],
        exclusions=E(followed_by=["leaves", "leaf", "pesto", "seed", "oil", "sauce", "plant", "chicken", "tofu",
                                  "rice", "paste", "Joseph", "Fawlty", "Brush", "Rathbone", "Systems", "Hayden"],
                     preceded_by=["holy", "sweet", "Thai", "fresh", "dried", "chopped", "lemon", "purple", "Genovese",
                                  "tulsi"],
                     nearby=["pesto", "recipe", "tomato", "mozzarella", "garlic", "oregano", "parsley", "caprese",
                             "herb"],
                     phrases=["St Basil", "St. Basil"]),
        people=[Person("Harini Rajagopalan"), Person("Mahesh Muraleedharan")])]),
    "multiples": BrandProfile([ProfileBrand(
        "Multiples", aliases=["Multiples Alternate Asset Management", "Multiples Private Equity"], common_word=True,
        confirming_words=["private equity", "PE", "fund", "stake", "buyout", "portfolio", "deal", "IPO", "crore"],
        exclusions=E(preceded_by=["valuation", "earnings", "EBITDA", "revenue", "price", "sales", "trading", "EV",
                                  "high", "higher", "premium", "rich", "lofty", "steep", "expensive", "exit", "deal",
                                  "transaction", "peer", "market"],
                     followed_by=["of", "expansion", "compression", "rerating", "re-rating", "contraction"]),
        people=[Person("Renuka Ramnath"), Person("Sudhir Variyar"), Person("Manish Gaur", require_brand_nearby=True)])]),
}
```

- [ ] **Step 3: Run and commit**

Run: `cd ~/Desktop/niks/url-verification && uv run pytest -q tests/test_profile.py tests/test_profile_build.py` (expect all pass; parity 39 passed). `tests/test_brands.py` and `urlverify/brands.py` will fail to import `WORD_LIST_FIELDS` until Task 2: make the minimal edit in `brands.py` here only if needed to keep the suite importable (replace the import with `EXCLUSION_FIELDS`; the `_profile_node` rewrite is Task 2), and leave `tests/test_brands.py` failures for Task 2, noting them in the report.

```bash
git add urlverify/profile.py tests/test_profile.py tests/test_profile_build.py
git commit -m "feat: revision 2 brand profile model (aliases, hashtags, handles, per-brand people and tests)"
```

---

### Task 2: Revision 2 storage and test-sentence checking (url-verification)

**Files:**
- Modify: `urlverify/brands.py`
- Modify: `tests/test_brands.py`, `README.md`

**Interfaces:**
- Consumes: Task 1 model, `build_rules`, `BuildResult.owners`, `EXCLUSION_FIELDS`.
- Produces: `MANAGED_MESSAGE = "This set is managed by the brand form. Edit it there."`; `SetInfo` gains `profile: BrandProfile | None` (filled by `list_sets_detailed` from the same `load_config` call); `save_profile`, `load_profile`, `list_sets_detailed`, `delete_set`, `try_rules` unchanged in signature; `detach_profile` removed; `check_tests(profile) -> list[dict]` with keys `brand` (index), `index`, `text`, `expect`, `passed`, `counted`, `not_counted`, `elsewhere` (entries shaped like `try_rules` hits/excluded).

- [ ] **Step 1: Update tests first** in `tests/test_brands.py`: rewrite `ACME_PROFILE` and every profile-based test for the revision 2 model (`ProfileBrand("Acme", aliases=["Acme Industries"], common_word=True, confirming_words=["luggage"], exclusions=Exclusions(followed_by=["Corp"]), people=[Person("Jo Bloggs")])`); delete the detach test; keep the stale test (edit the stored alias pattern by text replace). Add:
  - YAML round trip of the spec's Safari example including tests with quotes and a colon (`"It's 'quoted': Safari luggage"`) and a Devanagari alias: `load_config(cfg).profiles[name] == profile`.
  - The written YAML omits empty fields (no `description:` when empty, no `exclusions:` when empty, `require_brand_nearby` only when true, `common_word` only when true).
  - `check_tests`: a profile with brands Safari (aliases `["Safari Industries"]`, common, confirming `["luggage"]`, exclusions followed_by `["browser"]`, nearby `["Kruger"]`, people `[Person("Sudhir Jatia"), Person("Raj", require_brand_nearby=True)]`) and Genius (common, confirming `["luggage"]`), with Safari tests `("Safari Industries shares rose today", "match")` passes with counted text "Safari Industries"; `("Open it in Safari browser", "no_match")` passes with a not_counted reason "followed by browser"; `("We went on a Safari in Kruger", "no_match")` passes with reason "in the same sentence as Kruger"; `("Raj booked a Safari trip", "match")` passes (Raj counted) and has not_counted Safari "no confirming word nearby"; `("Genius luggage is light", "match")` under Safari FAILS (`passed is False`) and lists Genius under `elsewhere` (Review Focus 1); `("Safari luggage", "no_match")` fails.
  - `check_tests` does not list a mention as not counted when it lies inside a counted mention (bare "Safari" inside "Safari Industries").
  - `list_sets_detailed(cfg)[name].profile` equals the saved profile for a managed set and is `None` for `safari`.
- [ ] **Step 2: Implement** in `urlverify/brands.py`: import `EXCLUSION_FIELDS` instead of `WORD_LIST_FIELDS`; replace `MANAGED_MESSAGE`; delete `detach_profile`; replace `_profile_node` and add `check_tests` with this code (verified in a scratch copy):

```python
def _profile_node(profile: BrandProfile) -> CommentedMap:
    """The profile as YAML, leaving out empty and default fields so config.yaml stays readable."""
    node = CommentedMap()
    brands_seq = CommentedSeq()
    for b in profile.brands:
        bn = CommentedMap()
        bn["name"] = b.name.strip()
        if b.description.strip():
            bn["description"] = b.description.strip()
        for key in ("aliases", "hashtags", "handles"):
            if getattr(b, key):
                bn[key] = _flow(getattr(b, key))
        if b.common_word:
            bn["common_word"] = True
        if b.confirming_words:
            bn["confirming_words"] = _flow(b.confirming_words)
        if not b.exclusions.is_empty():
            ex = CommentedMap()
            for key in EXCLUSION_FIELDS:
                if getattr(b.exclusions, key):
                    ex[key] = _flow(getattr(b.exclusions, key))
            bn["exclusions"] = ex
        if b.people:
            people = CommentedSeq()
            for x in b.people:
                pn = CommentedMap()
                pn["name"] = x.name.strip()
                if x.require_brand_nearby:
                    pn["require_brand_nearby"] = True
                people.append(pn)
            bn["people"] = people
        if b.tests:
            tests = CommentedSeq()
            for t in b.tests:
                tn = CommentedMap()
                tn["text"] = SingleQuotedScalarString(t.text.strip())
                tn["expect"] = t.expect
                tests.append(tn)
            bn["tests"] = tests
        brands_seq.append(bn)
    node["brands"] = brands_seq
    return node


def check_tests(profile: BrandProfile) -> list[dict]:
    """Run every brand's test sentences through the whole set's rules, as verification would.

    A sentence matches when at least one counted mention belongs to that brand (its name, aliases, hashtags,
    handles or people). Each result explains what counted, what did not and why, and what counted for another
    brand in the set.
    """
    result = build_rules(profile)
    out = []
    for i, b in enumerate(profile.brands):
        for j, t in enumerate(b.tests):
            tried = try_rules(result.rules, t.text, result.labels)
            spans = [(h["offset"], h["offset"] + len(h["text"])) for h in tried["hits"]]

            def mine(entry: dict) -> bool:
                return result.owners.get(entry["brand"]) == i

            def inside_a_hit(x: dict) -> bool:
                s, e = x["offset"], x["offset"] + len(x["text"])
                return any(a <= s and e <= b for a, b in spans)

            counted = [h for h in tried["hits"] if mine(h)]
            out.append({
                "brand": i,
                "index": j,
                "text": t.text,
                "expect": t.expect,
                "passed": bool(counted) == (t.expect == "match"),
                "counted": counted,
                "not_counted": [x for x in tried["excluded"] if mine(x) and not inside_a_hit(x)],
                "elsewhere": [h for h in tried["hits"] if not mine(h)],
            })
    return out
```

Update the module docstring's first line to mention the brand configuration form instead of the brand editor.
- [ ] **Step 3: README**: replace the "Brand sets made with the simple form" section with the revision 2 YAML example (from the spec) and one paragraph: answers live under `profiles:`, rules under `brands:` are rebuilt on save, verification runs `brands:`, test sentences are stored with each brand. Remove the "Switch to advanced editing" sentence.
- [ ] **Step 4: Run and commit**: `uv run pytest -q` (all green).

```bash
git add urlverify/brands.py tests/test_brands.py README.md
git commit -m "feat: revision 2 profile storage and test-sentence checks"
```

---

### Task 3: Remove Suggest (pipeline API)

**Files:** delete `api/pipeline_api/suggest.py`, `api/tests/test_suggest.py`; modify `api/pipeline_api/deps.py`, `main.py`, `routes/health.py`, `routes/brand_profiles.py` (remove the suggest route, `SuggestBody` and imports), `settings.py`, `api/tests/test_settings.py`, `api/pyproject.toml` + `api/uv.lock` (`uv remove anthropic`), `e2e/start-api.sh` (drop the `ANTHROPIC_API_KEY` export), `README.md` (drop the Suggest paragraph).

- [ ] **Step 1:** Write/adjust tests first: `test_health` asserts `"suggest_available" not in` the health JSON; a test that `POST /api/brand-profiles/suggest` returns 404 or 405; remove the `.env` settings test and any `anthropic_api_key` / `suggest_model` assertions.
- [ ] **Step 2:** Remove the code. `settings.py` returns to reading the environment only: `env = os.environ if env is None else env` (no `dotenv_values`, no `anthropic_api_key` / `suggest_model` fields). `create_app` loses the `suggester` parameter; `Deps` loses `suggester`. Keep `.env` in `.gitignore` (harmless, protects other secrets).
- [ ] **Step 3:** Run the API command from Global Constraints; also `grep -ri "anthropic\|suggest" api web e2e README.md` must only show unrelated hits (report them) - web Suggest UI is removed in Task 6, so web hits are expected here.
- [ ] **Step 4:** Commit: `refactor: remove Claude Suggest from the brand form API`.

---

### Task 4: Revision 2 brand profile API

**Files:** modify `api/pipeline_api/routes/brand_profiles.py`, `api/pipeline_api/routes/brands.py`; rewrite `api/tests/test_brand_profiles_api.py`; update `api/tests/test_brands_api.py`.

**Interfaces (JSON):**
- `GET /api/brands` -> `{"sets": [{"name", "rules", "managed", "stale", "profile": <profile dict> | null}]}`
- `GET /api/brand-profiles/{name}` -> `{"profile"}`; 404 hand-written/unknown
- `PUT /api/brand-profiles/{name}` body `{"profile", "create"}` -> `{"name", "backup", "warnings": [{brand, field, message}], "tests": [check_tests results]}`; 409 duplicate-on-create or hand-written; 422 form-worded
- `POST /api/brand-profiles/check` body `{"profile"}` -> `{"warnings", "tests"}`
- Removed: `PUT /api/brands/{name}`, `POST /api/brands/test`, `POST /api/brand-profiles/preview`, `POST /api/brand-profiles/test`, `DELETE /api/brand-profiles/{name}/profile`

- [ ] **Step 1: Tests first.** Rewrite `test_brand_profiles_api.py` with a revision 2 `PROFILE` (brand Zeta: aliases `["Zeta Industries"]`, common, confirming `["luggage"]`, exclusions followed_by `["Corp"]`, people `[{"name": "Jo Bloggs", "require_brand_nearby": false}]`, tests `[{"text": "Zeta Industries rose", "expect": "match"}, {"text": "Zeta Corp makes anvils", "expect": "no_match"}]`). Cover: create/load/list (`profile` present for managed, `null` for `acme`), edit; 409 on duplicate create and on hand-written names (create true and false); 422 form-worded validation; unknown key 422; `check` returns warnings and two passing tests with a plain reason "followed by Corp" and saves nothing; PUT returns `tests`; removed endpoints return 404 or 405 (one parametrized test over all five). In `test_brands_api.py` delete raw-save and raw-test tests; keep list/delete coverage and assert the new `profile` key.
- [ ] **Step 2: Implement.** Pydantic models mirror the revision 2 profile with `extra="forbid"`: `ExclusionsBody(followed_by, preceded_by, nearby, phrases)`, `PersonBody(name, require_brand_nearby=False)`, `TestBody(text, expect: Literal["match", "no_match"])` (rename to avoid clashing with pytest collection, e.g. `SentenceBody`), `BrandBody(name, description="", aliases, hashtags, handles, common_word=False, confirming_words, exclusions=ExclusionsBody(), people, tests)`, `ProfileBody(brands)`, `SaveBody(profile, create=False)`, `CheckBody(profile)`. `check` and `PUT` call `brands.check_tests(profile)` (PUT after a successful save). `routes/brands.py`: remove `save_brand`, `test_brand`, `SaveBody`, `TestBody`, `_rules`; `list_brands` adds `"profile": profile_to_dict(s.profile) if s.profile else None` using `SetInfo.profile` from Task 2.
- [ ] **Step 3:** Run the API command. Commit: `feat: brand profile check endpoint and revision 2 API`.

---

### Task 5: Web types, API client and profile helpers

**Files:** modify `web/lib/types.ts`, `web/lib/api.ts`; rewrite `web/lib/brandProfile.ts`, `web/lib/brandProfile.test.ts`.

**Interfaces:**
- Types: `Exclusions {followed_by, preceded_by, nearby, phrases: string[]}`, `Person {name: string; require_brand_nearby: boolean}`, `TestSentence {text: string; expect: "match" | "no_match"}`, `ProfileBrand {name, description, aliases, hashtags, handles, common_word, confirming_words, exclusions, people, tests}`, `BrandProfile {brands: ProfileBrand[]}`, `ProfileWarning {brand, field, message}`, `TryEntry {brand, offset, text, before, after, cut_before, cut_after, snippet, reason?}`, `TestResult {brand: number; index: number; text; expect; passed: boolean; counted: TryEntry[]; not_counted: TryEntry[]; elsewhere: TryEntry[]}`. `BrandSet` gains `profile: BrandProfile | null`. Remove `Health.suggest_available`, `Suggestion`, `EverydayWord`, `Closeness`; keep `TryResult` only if still used.
- API: `brandProfile(name)`, `saveBrandProfile(name, profile, create) -> {name, backup, warnings, tests}`, `checkBrandProfile(profile) -> {warnings, tests}`; remove `saveBrand`, `testBrand`, `previewBrandProfile`, `testBrandProfile`, `suggestBrandProfile`, `detachBrandProfile`.
- Helpers: `emptyExclusions()`, `emptyBrand()` (all empty, `common_word: false`), `emptyProfile()`, `splitEntries`, `addValues`, `missingValues` (keep), `cleanProfile(p)` which trims, drops blank list values, people with blank names and tests with blank text, and **clears `confirming_words` and `exclusions` when `common_word` is false** (Review Focus 2).

- [ ] **Step 1:** Vitest first: `emptyProfile()` shape; `cleanProfile` trims, drops blanks, keeps `require_brand_nearby` and test `expect`, and clears confirming words/exclusions when `common_word` is false while keeping them when true; does not mutate input.
- [ ] **Step 2:** Implement; run the web command (tsc will flag every component still using removed types - leave those compile errors for Task 6 only if they are in files Task 6 rewrites, and say so in the report; otherwise fix).
- [ ] **Step 3:** Commit: `feat: web types and helpers for revision 2 brand profiles`.

---

### Task 6: Brands page - revision 2 form, test sentences, read-only hand-written sets

**Files:**
- Rewrite: `web/components/BrandProfileForm.tsx`, `web/components/BrandWorkspace.tsx`
- Create: `web/components/TestSentences.tsx`, `web/components/MatchExplanation.tsx`
- Delete: `web/components/RawSetEditor.tsx`, `web/components/SuggestChips.tsx`, `web/components/BrandTryPanel.tsx`
- Keep: `web/components/TagInput.tsx`
- Rewrite: `e2e/tests/brands-form.spec.ts`, `e2e/tests/brands.spec.ts`

**Behaviour (spec section 8):**
- Sidebar: "New set" button, then the sets; form sets show a "Form" badge, hand-written sets a muted "Hand-written" badge. No "New raw set".
- Hand-written set selected: heading with the set name, the text "Written by hand before the form existed. It still works for verification. To change it, create it again with the form.", and a "Delete set" button with the existing confirm dialog. Nothing else.
- Form: keep revision 1's proven mechanics - stable client-side card ids (never sent), the per-effect `alive` flag on the debounced call, `sentSnapshot` on save, `savedName` so a saved new set stays mounted with "Saved" visible, dirty tracking with the discard confirm, the stale banner (copy: "These rules differ from what the form would produce, from a hand edit of config.yaml or an app update. Saving will replace them with the form's version."). The debounced call is now `api.checkBrandProfile(cleanProfile(profile))`, skipped while no brand has a name.
- Per brand card, in this order: Brand name; Description (textarea, 3 rows); Other brand names / aliases; Hashtags (hint "Without #"); Social handles (hint "Without @"); "Is the brand name a common word?" as two radio buttons Yes / No (default No). When Yes, a bordered sub-section: "Words that confirm this is the brand"; a sub-heading "Words that mean it is NOT the brand" with three tag inputs "After the brand name", "Before the brand name", "Nearby / same sentence"; then "Exact phrases to ignore". Switching to No clears those values (state, not just hidden). Warnings render under the field they concern (`confirming_words`, `phrases`).
- "People associated with the brand" per brand: a two-column table (Person | Only count when brand is nearby) with a text input and a checkbox per row, a Remove button per row, and "Add person".
- "Test configuration" per brand (`TestSentences.tsx`): each row shows the sentence, a Match / Not a match selector, a result badge ("Passes" in green or "Fails" in red, or "Checking..." before the first result), and below it `MatchExplanation`: counted mentions as the highlighted match with surrounding words (mark styling from revision 1's try panel), not-counted mentions with " - " and the plain reason, and "Counted for <brand>:" lines for `elsewhere`. An "Add test sentence" textarea plus Match / Not a match and an "Add" button append a row; rows can be removed. Results come from the latest check response matched by `(brand index, test index)`; a result for a stale profile is never shown (the `alive` guard).
- Footer: "Save set", "Delete set" (saved sets only). After save: "Saved. The previous config.yaml was backed up to <file>." plus, when any saved test fails, " <N> test sentence(s) do not give the expected result." Errors in `role="alert"`, status in `role="status"`.
- No element anywhere may render a rule pattern.
- Accessible names for tests: `Set name`, `Brand {n} name`, `Brand {n} description`, `Brand {n} aliases`, `Brand {n} hashtags`, `Brand {n} handles`, radios `Brand {n} common word yes` / `Brand {n} common word no`, `Brand {n} confirming words`, `Brand {n} not after`, `Brand {n} not before`, `Brand {n} not nearby`, `Brand {n} phrases to ignore`, `Brand {n} person {m} name`, `Brand {n} person {m} only when brand nearby`, `Brand {n} new test sentence`, `Brand {n} new test expectation`, buttons `Add another brand`, `Add person`, `Add`, `Save set`, `Delete set`; each test row is a `listitem` inside a list with `data-testid="tests-brand-{n}"` and a result badge `data-testid="test-result"`.

- [ ] **Step 1: E2E first.** Rewrite `brands-form.spec.ts`:
  1. Create `zeta-<project>` with brand Zeta (alias "Zeta Industries", hashtag "zetabags", common word Yes, confirming "luggage", after "browser", nearby "Kruger"), a person "Jo Bloggs", and tests: "Zeta Industries shares rose today" Match, "Open it in Zeta browser" Not a match, "We went to Zeta near Kruger" Not a match, "Zeta trolley sale" Match. Expect three "Passes" and one "Fails"; add confirming word "trolley" and see all four pass. Save -> status contains "Saved". Reload, open the set (Form badge), values and tests are back. Add a second brand "Geniux" (common, confirming "luggage") with test "Geniux luggage is light" Match -> passes; under Zeta add "Geniux luggage is light" Match -> fails and shows "Counted for Geniux". Save -> status mentions "1 test sentence". Narrow viewport 400px: no horizontal scroll (`expect.poll`). Verify dropdown lists the set (reuse `createRun`). Delete the set.
  2. Switching common word to No clears the hidden fields: set Yes, add confirming "x", switch No, save succeeds (no 422).
  3. The form refuses a hand-written set's name (`mokobara`) with "already exists" or "hand-written" alert.
  4. No regex on the page: after filling the form, `page.locator("body")` text does not contain `(?:`, `\\w`, `[#@]`.
  Rewrite `brands.spec.ts`: open the hand-written `mokobara` set: it shows the hand-written note and a "Hand-written" badge, has no text inputs, and no regex text; then open the hand-written `other` set, delete it through the confirm dialog, and confirm it disappears from the sidebar (the e2e verifier fixture, with sets `acme`, `other`, `mokobara`, is copied fresh for every run).
  Run e2e: these fail.
- [ ] **Step 2: Implement** the components above. Read `web/node_modules/next/dist/docs/` client-component guidance first. Keep `TagInput` as is.
- [ ] **Step 3:** Run web command and `npx playwright test brands.spec.ts brands-form.spec.ts`; inspect the screenshots (`shot(page, "brands-form", info)` after the four tests pass, and the narrow one) for alignment, spacing, wrapping, and fix what looks off.
- [ ] **Step 4:** Commit: `feat: revision 2 brand configuration form with saved test sentences`.

---

### Task 7: Verify step shows a plain summary

**Files:** create `web/components/BrandSummary.tsx`; modify `web/components/VerifyStep.tsx`; delete `web/components/BrandRules.tsx` (no longer used); update `e2e/tests/run-verify.spec.ts`.

- [ ] **Step 1: E2E first.** In `run-verify.spec.ts`, replace the assertion that the rules regex `Mokobara|MOKOBARA|[#@]mokobara\w*` is visible with: the selected hand-written set shows "Written by hand before the form existed"; the page text contains no `(?:`, `\\w` or `[#@]`. Add (in `brands-form.spec.ts` step 1 or a new test) that selecting a form set in the Verify step shows its summary: brand name, "Other names: Zeta Industries", "Hashtags: #zetabags", "Confirmed by: luggage, trolley", "Not when after: browser", "Not in the same sentence as: Kruger", "People: Jo Bloggs".
- [ ] **Step 2: Implement** `BrandSummary({ set }: { set: BrandSet })`: for `set.profile`, one block per brand with the lines above (omit empty lines; hashtags with `#`, handles with `@`; people needing the brand nearby suffixed " (only near the brand)"); for hand-written sets, the hand-written note. In `VerifyStep.tsx` render `<BrandSummary set={selectedSet} />` instead of `BrandRules`, and in the job panel remove the `<BrandRules rules={job.brand_rules} />` line (keep the snapshot note and the "changed since" notice, which still compares `rules`).
- [ ] **Step 3:** Run web command and the full e2e suite. Commit: `feat: Verify step shows a plain brand summary instead of rules`.

---

### Task 8: Docs and full check

- [ ] **Step 1:** Update the pipeline `README.md` "Brand sets" paragraph to revision 2: "New set" opens the brand configuration form (names, aliases, hashtags, handles, common word, confirming and excluding words, people, test sentences); form sets show a "Form" badge; hand-written sets are read-only (delete only) and keep working; answers live under `profiles:` in url-verification's `config.yaml`. Remove any mention of Suggest, raw editor, or advanced editing.
- [ ] **Step 2:** Run `make check` in the worktree (Company Monitor's two known `test_rbp_tagging` failures are out of scope; run url-verification tests and e2e directly if `make test` stops there). Fix any other failure or flake.
- [ ] **Step 3:** Commit: `docs: brand configuration form revision 2`.
- [ ] **Step 4 (controller):** interactive walk in the in-app browser against a scratch config copy at desktop and 375px, checking the Brands page and the Verify step for any regex, misalignment or awkward copy.
