# Simple Brand Form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a non-technical user create and edit a brand set from a plain-language form (with optional Claude suggestions), instead of writing regex.

**Architecture:** url-verification gains `urlverify/profile.py`, a pure `build_rules(profile)` that turns form answers into the existing `BrandRule` format, and `brands.py` stores the answers under a new `profiles:` section of `config.yaml` in the same atomic write as the generated rules. repscore-pipeline adds a `/api/brand-profiles` router (save, load, preview, test, suggest, detach) and a `BrandProfileForm` on the Brands page; raw sets keep the current regex editor.

**Tech Stack:** Python 3.12, dataclasses, ruamel.yaml, pytest (url-verification); FastAPI, Pydantic v2, `anthropic` Python SDK, pytest (pipeline API); Next.js 16, React 19, Tailwind 4, base-ui/shadcn components, vitest, Playwright (pipeline web/e2e).

**Spec:** `docs/superpowers/specs/2026-10-08-simple-brand-form-design.md` (in repscore-pipeline). Read it before starting any task.

## Global Constraints

- Two repos: `~/Desktop/niks/url-verification` (Tasks 1-4) and `~/Desktop/niks/repscore-pipeline` (Tasks 5-11). The pipeline imports url-verification as an editable path package (`api/pyproject.toml` `[tool.uv.sources]`), so url-verification changes are live in the pipeline without reinstalling.
- Branches: work on a new branch `feat/brand-profiles` in each repo. url-verification currently has uncommitted work on `bridge-tier4` that is not ours; the owner decides before Task 1 whether to commit or stash it. Never commit files you did not change for this plan; stage paths explicitly, never `git add -A` or `git add .`.
- Commit messages: conventional style (`feat:`, `test:`, `docs:`, `refactor:`), no `Co-Authored-By` lines, no agent name.
- Never use the em dash character in code, copy, comments or docs. Use a plain hyphen.
- Users never see or type regex in the form. Every user value is escaped by `build_rules`. Error and warning messages use the form's labels ("Names that always mean this brand"), never field keys like `always`.
- Value limits: every text value is 1-200 characters after trimming; handles are letters, digits and `_` only (a leading `#` or `@` is stripped).
- Closeness windows: close 60, nearby 100, paragraph 2000 characters.
- Suggest settings: `ANTHROPIC_API_KEY` and `PIPELINE_SUGGEST_MODEL` (default `claude-opus-5-5`) from the pipeline's `.env`. 60 second timeout, no retries. Suggestions are never added to the form automatically.
- Next.js in this repo is a newer version with breaking changes: read the relevant guide in `web/node_modules/next/dist/docs/` before writing web code (see `web/AGENTS.md`).
- Commands. url-verification: `cd ~/Desktop/niks/url-verification && uv run pytest -q`. Pipeline API: `cd ~/Desktop/niks/repscore-pipeline/api && uv run pytest -q`, lint `uv run ruff check . && uv run ruff format --check . && uv run pyright`. Web: `cd ~/Desktop/niks/repscore-pipeline/web && npm test && npm run lint && npx tsc --noEmit`. E2E: `cd ~/Desktop/niks/repscore-pipeline/e2e && npx playwright test`. Everything: `make check` in repscore-pipeline.
- Do not start a real Suggest call (it spends API credits) except in Task 11, and only after the owner says yes.

## Review Focus

1. Saving a form set under the name of an existing raw set (e.g. `safari`) must be refused with 409, not silently replace hand-written rules. Test in Task 5.
2. Values containing regex metacharacters (`Dr. Reddy's`, `C++`, `AT&T (India)`, `$`) must be matched literally and never produce an invalid or over-broad pattern. Test in Task 2.
3. A hand edit of `config.yaml` that breaks a profile (unknown key, bad closeness) must fail loading with a message naming the profile, while a profile whose rules merely differ is only flagged `stale` and verification still runs the stored rules. Tests in Task 4.
4. Editing a managed set through the raw `/api/brands/{name}` endpoint must be refused (409) so the form answers and rules can never drift silently. Test in Task 5.
5. Suggest output from Claude that is empty, duplicated, over-long or has invalid handles must be dropped and counted, never reach the form or crash. Test in Task 6.

---

## File Structure

url-verification:
- Create `urlverify/profile.py`: profile dataclasses, dict conversion, validation, warnings, helpers, `build_rules`. Pure, no I/O.
- Modify `urlverify/config.py`: `Config.profiles`, validate `profiles:` in `load_config`.
- Modify `urlverify/brands.py`: `save_profile`, `load_profile`, `detach_profile`, `list_sets_detailed`, managed guard in `save_set`, `delete_set` removes both, `try_rules(labels=...)`.
- Create `tests/test_profile.py` (validation and helpers), `tests/test_profile_build.py` (rule building and parity), extend `tests/test_brands.py` (storage).
- Modify `README.md` (Configuration section).

repscore-pipeline API:
- Create `api/pipeline_api/routes/brand_profiles.py`: request models and endpoints.
- Create `api/pipeline_api/suggest.py`: `Suggester` protocol, `AnthropicSuggester`, `sanitize_suggestion`, prompt.
- Modify `routes/brands.py` (managed/stale, 409 for managed), `settings.py`, `deps.py`, `main.py`, `routes/health.py`, `pyproject.toml`, `.gitignore`, `e2e/start-api.sh`.
- Create `api/tests/test_brand_profiles_api.py`, `api/tests/test_suggest.py`.

repscore-pipeline web:
- Modify `web/lib/types.ts`, `web/lib/api.ts`. Create `web/lib/brandProfile.ts` + `web/lib/brandProfile.test.ts`.
- Create `web/components/BrandWorkspace.tsx` (sidebar + selection), `web/components/BrandTryPanel.tsx` (shared test panel), `web/components/TagInput.tsx`, `web/components/BrandProfileForm.tsx`, `web/components/SuggestChips.tsx`.
- Rename `web/components/BrandEditor.tsx` to `web/components/RawSetEditor.tsx` (one set, no sidebar).
- Modify `web/app/brands/page.tsx`.
- Modify `e2e/tests/brands.spec.ts`; create `e2e/tests/brands-form.spec.ts`.
- Modify `README.md` (Brand sets section).

---

### Task 1: Profile model and validation (url-verification)

**Files:**
- Create: `urlverify/profile.py`
- Test: `tests/test_profile.py`

**Interfaces:**
- Produces (used by Tasks 2-6):
  - `class ProfileError(ValueError)`
  - `@dataclass EverydayWord(word: str, exact_case: bool = True, closeness: str = "nearby", confirm: list[str] = [], not_followed_by: list[str] = [], not_preceded_by: list[str] = [], not_in_sentence_with: list[str] = [], ignore_phrases: list[str] = [])`
  - `@dataclass ProfileBrand(name: str, always: list[str] = [], handles: list[str] = [], everyday_word: EverydayWord | None = None)`
  - `@dataclass Person(name: str, common: bool = False)`
  - `@dataclass BrandProfile(brands: list[ProfileBrand], people: list[Person] = [])`
  - `@dataclass(frozen=True) ProfileWarning(brand: int | None, field: str, message: str)` - `brand` is the 0-based brand index, `None` for set-level
  - `WORD_LIST_FIELDS: tuple[str, ...]` = `("confirm", "not_followed_by", "not_preceded_by", "not_in_sentence_with", "ignore_phrases")`
  - `CLOSENESS: dict[str, int]`, `LABELS: dict[str, str]`, `MAX_VALUE = 200`
  - `profile_from_dict(d: object) -> BrandProfile` (raises `ProfileError`)
  - `profile_to_dict(p: BrandProfile) -> dict` (`everyday_word` is `None` when absent)
  - `value_problem(value: str, *, handle: bool = False) -> str | None`
  - `normalise_handle(value: str) -> str` (strips whitespace and a leading `#`/`@`)
  - `validate_profile(p: BrandProfile) -> list[ProfileWarning]` (raises `ProfileError`)

- [ ] **Step 1: Write the failing tests**

Create `tests/test_profile.py`:

```python
import pytest

from urlverify.profile import (
    BrandProfile,
    EverydayWord,
    Person,
    ProfileBrand,
    ProfileError,
    profile_from_dict,
    profile_to_dict,
    validate_profile,
    value_problem,
)

SAFARI_DICT = {
    "brands": [
        {
            "name": "Safari",
            "always": ["Safari Industries", "SAFARIND"],
            "handles": ["#safaribags"],
            "everyday_word": {
                "word": "Safari",
                "exact_case": True,
                "closeness": "close",
                "confirm": ["luggage"],
                "not_followed_by": ["browser"],
            },
        }
    ],
    "people": [{"name": "Sudhir Jatia"}],
}


def test_from_dict_fills_defaults_and_round_trips():
    p = profile_from_dict(SAFARI_DICT)
    w = p.brands[0].everyday_word
    assert w is not None and w.not_preceded_by == [] and w.ignore_phrases == []
    assert p.people == [Person("Sudhir Jatia", common=False)]
    assert profile_from_dict(profile_to_dict(p)) == p
    assert profile_to_dict(BrandProfile([ProfileBrand("Mokobara", always=["Mokobara"])]))["brands"][0][
        "everyday_word"
    ] is None


def test_from_dict_accepts_null_everyday_word_and_missing_people():
    p = profile_from_dict({"brands": [{"name": "Kedaara", "always": ["Kedaara"], "everyday_word": None}]})
    assert p.brands[0].everyday_word is None and p.people == []


@pytest.mark.parametrize(
    ("bad", "message"),
    [
        ({"brands": [{"name": "A", "always": ["A"], "colour": "red"}]}, "unknown field"),
        ({"brands": [{"name": "A", "always": "A"}]}, "list of text"),
        ({"brands": [{"name": "A", "everyday_word": {"word": "A", "closeness": "far"}}]}, "close, nearby or paragraph"),
        ({"brands": "A"}, "list"),
        ({}, "at least one brand"),
        ({"brands": [{"name": "A", "always": ["A"]}], "people": [{"name": "X", "common": "yes"}]}, "true or false"),
        ("nope", "mapping"),
    ],
)
def test_from_dict_rejects_bad_shapes(bad, message):
    with pytest.raises(ProfileError, match=message):
        profile_from_dict(bad)


@pytest.mark.parametrize(
    ("value", "handle", "problem"),
    [
        ("  ", False, "is empty"),
        ("x" * 201, False, "longer than 200"),
        ("safari bags", True, "letters, digits and _"),
        ("Safari", False, None),
        ("#safari_bags", True, None),
        ("सफारी इंडस्ट्रीज", False, None),
    ],
)
def test_value_problem(value, handle, problem):
    result = value_problem(value, handle=handle)
    assert (result is None) if problem is None else (problem in result)


def _brand(**kw):
    return ProfileBrand(**{"name": "Safari", "always": ["Safari Industries"], **kw})


def test_validate_rejects_duplicate_brand_names_case_insensitively():
    p = BrandProfile([_brand(), _brand(name="safari")])
    with pytest.raises(ProfileError, match="Brand names must be unique"):
        validate_profile(p)


def test_validate_rejects_brand_without_any_name():
    with pytest.raises(ProfileError, match=r"Brand 1 \('Safari'\): add at least one name"):
        validate_profile(BrandProfile([ProfileBrand("Safari")]))


def test_validate_names_the_field_label_and_value():
    p = BrandProfile([_brand(always=["Safari Industries", "safari industries"])])
    with pytest.raises(ProfileError, match=r"Names that always mean this brand: 'safari industries' is a duplicate"):
        validate_profile(p)
    p = BrandProfile([_brand(everyday_word=EverydayWord("Safari", not_followed_by=["  "]))])
    with pytest.raises(ProfileError, match=r"Not the brand when followed by: '  ' is empty"):
        validate_profile(p)
    p = BrandProfile([_brand(handles=["safari bags"])])
    with pytest.raises(ProfileError, match=r"Extra hashtags or handles: 'safari bags' may only contain"):
        validate_profile(p)


def test_validate_rejects_empty_brand_name_and_bad_person():
    with pytest.raises(ProfileError, match=r"Brand 1: Brand name is empty"):
        validate_profile(BrandProfile([_brand(name=" ")]))
    with pytest.raises(ProfileError, match=r"People: Leader name: 'jo' is a duplicate"):
        validate_profile(BrandProfile([_brand()], people=[Person("Jo"), Person("jo")]))
    with pytest.raises(ProfileError, match="at least one brand"):
        validate_profile(BrandProfile([]))


def test_warning_when_everyday_word_has_nothing_to_confirm_it():
    p = BrandProfile([ProfileBrand("Basil", everyday_word=EverydayWord("Basil"))])
    (w,) = validate_profile(p)
    assert (w.brand, w.field) == (0, "confirm") and "every use of the word" in w.message


def test_no_warning_when_other_names_in_the_set_confirm_it():
    p = BrandProfile([ProfileBrand("Basil", everyday_word=EverydayWord("Basil"))], people=[Person("Harini Rajagopalan")])
    assert validate_profile(p) == []


def test_warning_for_ignore_phrase_without_the_word():
    p = BrandProfile(
        [
            ProfileBrand(
                "Carlton", everyday_word=EverydayWord("Carlton", confirm=["luggage"], ignore_phrases=["Ritz-Carlton", "Savoy"])
            )
        ]
    )
    (w,) = validate_profile(p)
    assert (w.brand, w.field) == (0, "ignore_phrases") and "'Savoy'" in w.message and "never block" in w.message
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/Desktop/niks/url-verification && uv run pytest tests/test_profile.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'urlverify.profile'`

- [ ] **Step 3: Write the implementation**

Create `urlverify/profile.py`:

```python
"""Brand profiles: the plain-language answers from the pipeline's simple brand form, and the rules built from them.

A profile never contains regex. build_rules (below) escapes every value the user typed before turning the profile
into BrandRule objects, so the form can be used by people who have never written a regular expression.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field, fields

CLOSENESS = {"close": 60, "nearby": 100, "paragraph": 2000}
MAX_VALUE = 200
WORD_LIST_FIELDS = ("confirm", "not_followed_by", "not_preceded_by", "not_in_sentence_with", "ignore_phrases")
# Form labels, so messages name what the user sees on screen.
LABELS = {
    "name": "Brand name",
    "always": "Names that always mean this brand",
    "handles": "Extra hashtags or handles",
    "word": "Everyday word",
    "confirm": "Words that confirm it's the brand",
    "not_followed_by": "Not the brand when followed by",
    "not_preceded_by": "Not the brand when preceded by",
    "not_in_sentence_with": "Not the brand in the same sentence as",
    "ignore_phrases": "Exact phrases to ignore",
}
_HANDLE = re.compile(r"^[A-Za-z0-9_]+$")


class ProfileError(ValueError):
    pass


@dataclass
class EverydayWord:
    word: str
    exact_case: bool = True
    closeness: str = "nearby"
    confirm: list[str] = field(default_factory=list)
    not_followed_by: list[str] = field(default_factory=list)
    not_preceded_by: list[str] = field(default_factory=list)
    not_in_sentence_with: list[str] = field(default_factory=list)
    ignore_phrases: list[str] = field(default_factory=list)


@dataclass
class ProfileBrand:
    name: str
    always: list[str] = field(default_factory=list)
    handles: list[str] = field(default_factory=list)
    everyday_word: EverydayWord | None = None


@dataclass
class Person:
    name: str
    common: bool = False


@dataclass
class BrandProfile:
    brands: list[ProfileBrand]
    people: list[Person] = field(default_factory=list)


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
        raise ProfileError(f"{where}: unknown field(s) {sorted(unknown)}")
    return d


def _text(d: dict, key: str, where: str) -> str:
    v = d.get(key)
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


def _word_from_dict(d: object, where: str) -> EverydayWord:
    d = _mapping(d, {f.name for f in fields(EverydayWord)}, where)
    closeness = d.get("closeness", "nearby")
    if closeness not in CLOSENESS:
        raise ProfileError(f"{where}: closeness must be close, nearby or paragraph, not {closeness!r}")
    return EverydayWord(
        word=_text(d, "word", where),
        exact_case=_flag(d, "exact_case", True, where),
        closeness=closeness,
        **{k: _texts(d, k, where) for k in WORD_LIST_FIELDS},
    )


def profile_from_dict(d: object) -> BrandProfile:
    d = _mapping(d, {"brands", "people"}, "profile")
    brands_raw = d.get("brands")
    if brands_raw is None or brands_raw == []:
        raise ProfileError("profile: add at least one brand")
    if not isinstance(brands_raw, list):
        raise ProfileError("profile: brands must be a list")
    brands = []
    for i, b in enumerate(brands_raw, start=1):
        where = f"brand {i}"
        b = _mapping(b, {"name", "always", "handles", "everyday_word"}, where)
        word = b.get("everyday_word")
        brands.append(
            ProfileBrand(
                name=_text(b, "name", where),
                always=_texts(b, "always", where),
                handles=_texts(b, "handles", where),
                everyday_word=None if word is None else _word_from_dict(word, f"{where} everyday word"),
            )
        )
    people_raw = d.get("people") or []
    if not isinstance(people_raw, list):
        raise ProfileError("profile: people must be a list")
    people = []
    for i, x in enumerate(people_raw, start=1):
        where = f"person {i}"
        x = _mapping(x, {"name", "common"}, where)
        people.append(Person(name=_text(x, "name", where), common=_flag(x, "common", False, where)))
    return BrandProfile(brands=brands, people=people)


def profile_to_dict(p: BrandProfile) -> dict:
    def word(w: EverydayWord | None) -> dict | None:
        if w is None:
            return None
        return {"word": w.word, "exact_case": w.exact_case, "closeness": w.closeness,
                **{k: list(getattr(w, k)) for k in WORD_LIST_FIELDS}}

    return {
        "brands": [
            {"name": b.name, "always": list(b.always), "handles": list(b.handles), "everyday_word": word(b.everyday_word)}
            for b in p.brands
        ],
        "people": [{"name": x.name, "common": x.common} for x in p.people],
    }


# ---- validation ----------------------------------------------------------------------------------------------------


def normalise_handle(value: str) -> str:
    return value.strip().lstrip("#@")


def value_problem(value: str, *, handle: bool = False) -> str | None:
    """Why a single form value is unusable, or None when it is fine."""
    v = value.strip()
    if not v:
        return "is empty"
    if len(v) > MAX_VALUE:
        return f"is longer than {MAX_VALUE} characters"
    if handle and not _HANDLE.match(normalise_handle(v)):
        return "may only contain letters, digits and _"
    return None


def _check_list(values: list[str], label: str, where: str, *, handle: bool = False) -> None:
    seen: set[str] = set()
    for v in values:
        problem = value_problem(v, handle=handle)
        if problem:
            raise ProfileError(f"{where}: {label}: {v!r} {problem}")
        key = (normalise_handle(v) if handle else v.strip()).casefold()
        if key in seen:
            raise ProfileError(f"{where}: {label}: {v!r} is a duplicate")
        seen.add(key)


def automatic_context(p: BrandProfile) -> list[str]:
    """Names that confirm any everyday word in the set: every brand name, always-name and person."""
    names = [b.name for b in p.brands] + [a for b in p.brands for a in b.always] + [x.name for x in p.people]
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
        if not b.always and not b.handles and b.everyday_word is None:
            raise ProfileError(f"{where}: add at least one name that always means this brand, or an everyday word")
        _check_list(b.always, LABELS["always"], where)
        _check_list(b.handles, LABELS["handles"], where, handle=True)
        w = b.everyday_word
        if w is not None:
            if value_problem(w.word):
                raise ProfileError(f"{where}: {LABELS['word']} {value_problem(w.word)}")
            if w.closeness not in CLOSENESS:
                raise ProfileError(f"{where}: closeness must be close, nearby or paragraph")
            for k in WORD_LIST_FIELDS:
                _check_list(getattr(w, k), LABELS[k], where)
    _check_list([x.name for x in p.people], "Leader name", "People")

    warnings: list[ProfileWarning] = []
    auto = automatic_context(p)
    for i, b in enumerate(p.brands):
        w = b.everyday_word
        if w is None:
            continue
        word = w.word.strip().casefold()
        if not w.confirm and not [n for n in auto if n.casefold() != word]:
            warnings.append(ProfileWarning(i, "confirm", (
                f"Nothing confirms {w.word.strip()!r}, so every use of the word counts. "
                "Add words that confirm it's the brand.")))
        for phrase in w.ignore_phrases:
            if word not in phrase.casefold():
                warnings.append(ProfileWarning(i, "ignore_phrases", (
                    f"{phrase.strip()!r} does not contain {w.word.strip()!r}, so it can never block a mention.")))
    return warnings
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/Desktop/niks/url-verification && uv run pytest tests/test_profile.py -q`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
cd ~/Desktop/niks/url-verification
git add urlverify/profile.py tests/test_profile.py
git commit -m "feat: brand profile model and validation for the simple brand form"
```

---

### Task 2: Building rules from a profile (url-verification)

**Files:**
- Modify: `urlverify/profile.py` (append)
- Test: `tests/test_profile_build.py`

**Interfaces:**
- Consumes: Task 1 types, `validate_profile`, `automatic_context`, `normalise_handle`, `CLOSENESS`.
- Produces (used by Tasks 3-6):
  - `@dataclass BuildResult(rules: list[BrandRule], warnings: list[ProfileWarning], labels: dict[str, str])` - `labels` maps each generated exclusion regex to plain text such as `"followed by browser, tab"`
  - `build_rules(p: BrandProfile) -> BuildResult` (raises `ProfileError` via `validate_profile`)
  - helpers `lit(text) -> str`, `tag(text) -> str | None`, `SUFFIX: str`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_profile_build.py`:

```python
import re

import pytest

from urlverify.match import BrandMatcher
from urlverify.profile import (
    SUFFIX,
    BrandProfile,
    EverydayWord,
    Person,
    ProfileBrand,
    ProfileError,
    build_rules,
    lit,
    tag,
)


def hits(profile: BrandProfile, text: str) -> list[int]:
    return [h.offset for h in BrandMatcher(build_rules(profile).rules).find(text, "body")]


def test_lit_escapes_and_treats_space_and_hyphen_alike():
    assert re.fullmatch(lit("Ritz-Carlton"), "Ritz Carlton")
    assert re.fullmatch(lit("Ritz Carlton"), "Ritz-Carlton")
    for value in ["Dr. Reddy's", "C++", "AT&T (India)", "$5 bn", "a|b", "[x]"]:
        assert re.fullmatch(lit(value), value), value
    assert not re.fullmatch(lit("Dr. Reddy's"), "DrX Reddy's")  # the dot is literal


def test_tag_forms_only_for_latin_names():
    assert tag("Safari Industries") == r"[#@]Safari_?Industries\w*"
    assert tag("V.I.P. Industries") is None
    assert tag("सफारी") is None


def test_always_rule_matches_name_hashtag_handle_and_backed_form():
    p = BrandProfile([ProfileBrand("Mokobara", always=["Mokobara"], handles=["@mokobara_in"])])
    (rule,) = build_rules(p).rules
    assert rule.name == "Mokobara" and not rule.case_sensitive and rule.require_context == []
    text = "Mokobara grew. #mokobaralove trends. Follow @mokobara_in now. A Mokobara-backed fund."
    assert len(hits(p, text)) == 4
    assert SUFFIX in rule.pattern


def test_always_names_are_literal_not_regex():
    p = BrandProfile([ProfileBrand("Dr. Reddy's", always=["Dr. Reddy's", "C++ Labs"])])
    text = "Dr. Reddy's rose. DrX Reddy's did not. C++ Labs hired. C Labs did not."
    assert hits(p, text) == [0, 39]


SAFARI = BrandProfile(
    [
        ProfileBrand(
            "Safari",
            always=["Safari Industries"],
            everyday_word=EverydayWord(
                "Safari",
                exact_case=True,
                closeness="close",
                confirm=["luggage", "bag"],
                not_followed_by=["browser", "tour"],
                not_preceded_by=["Apple", "jeep"],
                not_in_sentence_with=["Serengeti", "Kruger"],
                ignore_phrases=["Safari Rally"],
            ),
        )
    ],
    people=[Person("Sudhir Jatia")],
)


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("Safari launched a new luggage range.", 1),
        ("Safari bags are light.", 1),  # plural of a confirming word
        ("Safari launched a new range.", 0),  # nothing confirms it
        ("safari luggage", 0),  # exact capitals
        ("Open Safari Browser and buy luggage.", 0),  # followed-by words ignore case
        ("Apple Safari luggage tab.", 0),
        ("A JEEP Safari with luggage.", 0),
        ("Our Safari in the Serengeti, luggage and all.", 0),
        ("The Safari Rally needs luggage.", 0),
        ("Safari, said Sudhir Jatia, sells luggage.", 2),  # leader counts, and confirms
        ("Safari, said Sudhir Jatia.", 2),  # leader name alone confirms the everyday word
    ],
)
def test_everyday_word_rule(text, expected):
    assert len(hits(SAFARI, text)) == expected


def test_exclusion_labels_are_plain_language():
    result = build_rules(SAFARI)
    labels = set(result.labels.values())
    assert labels == {
        "followed by browser, tour",
        "preceded by Apple, jeep",
        "in the same sentence as Serengeti, Kruger",
        "the phrase Safari Rally",
    }
    word_rule = next(r for r in result.rules if r.exclude)
    assert set(word_rule.exclude) == set(result.labels)


def test_rule_order_and_context_window():
    rules = build_rules(SAFARI).rules
    assert [r.name for r in rules] == ["Safari", "Safari", "Safari leadership"]
    assert rules[1].context_window == 60 and rules[1].case_sensitive


def test_common_name_leaders_need_the_brand_nearby():
    p = BrandProfile(
        [ProfileBrand("Multiples", always=["Multiples Private Equity"])],
        people=[Person("Renuka Ramnath"), Person("Manish Gaur", common=True)],
    )
    rules = build_rules(p).rules
    assert [r.name for r in rules] == ["Multiples", "Multiples leadership", "Multiples leadership (common names)"]
    assert rules[2].context_window == 150
    assert hits(p, "Manish Gaur won a cricket award.") == []
    assert hits(p, "Manish Gaur joined Multiples last year.") == [0]  # no everyday word here, so only the leader


def test_confirm_terms_starting_with_symbols_still_match():
    p = BrandProfile([ProfileBrand("Inamo", everyday_word=EverydayWord("Inamo", exact_case=False, confirm=["$5 mn", "#qcom"]))])
    assert hits(p, "Inamo raised $5 mn.") == [0]
    assert hits(p, "Inamo trends as #qcom.") == [0]


def test_generated_rules_always_compile_and_validation_errors_propagate():
    with pytest.raises(ProfileError):
        build_rules(BrandProfile([ProfileBrand("X")]))
    for r in build_rules(SAFARI).rules:
        re.compile(r.pattern)
        for rx in r.require_context + r.exclude:
            re.compile(rx)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/Desktop/niks/url-verification && uv run pytest tests/test_profile_build.py -q`
Expected: FAIL with `ImportError: cannot import name 'SUFFIX'`

- [ ] **Step 3: Write the implementation**

Add `from .models import BrandRule` to the imports at the top of `urlverify/profile.py`, then append:

```python
# ---- building rules ------------------------------------------------------------------------------------------------

# The matcher treats "-" as part of a word, so "Kedaara-backed" would not match a plain "Kedaara" pattern.
SUFFIX = r"(?:-(?:backed|owned|led|controlled|funded|managed))?"
_ASCII_WORD = re.compile(r"^[A-Za-z0-9]+$")
_SENTENCE_GAP = r"[^.!?\n]{0,60}"


@dataclass
class BuildResult:
    rules: list[BrandRule]
    warnings: list[ProfileWarning]
    labels: dict[str, str]  # generated exclusion regex -> plain-language reason


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


def _plural(text: str) -> str:
    return lit(text) + "(?:s|es)?"


def _any_of(values: list[str], form) -> str:
    # Scoped (?i:...) keeps these words case-insensitive even inside a case-sensitive rule.
    return "(?i:" + "|".join(form(v) for v in values) + ")"


def _words(values: list[str]) -> str:
    return ", ".join(v.strip() for v in values)


def build_rules(p: BrandProfile) -> BuildResult:
    warnings = validate_profile(p)
    rules: list[BrandRule] = []
    labels: dict[str, str] = {}
    auto = automatic_context(p)

    for b in p.brands:
        name = b.name.strip()
        alts: list[str] = []
        for a in b.always:
            alts.append(lit(a) + SUFFIX)
            t = tag(a)
            if t:
                alts.append(t)
        alts += [rf"[#@]{re.escape(normalise_handle(h))}\w*" for h in b.handles]
        if alts:
            rules.append(BrandRule(name=name, pattern="|".join(dict.fromkeys(alts))))

        w = b.everyday_word
        if w is None:
            continue
        word = lit(w.word)
        context = [rf"(?<!\w){_plural(c)}(?!\w)" for c in w.confirm]
        context += [lit(n) for n in auto if n.casefold() != w.word.strip().casefold()]
        exclude: list[str] = []

        def add(rx: str, label: str) -> None:
            exclude.append(rx)
            labels[rx] = label

        if w.not_followed_by:
            add(word + r"[\s-]+" + _any_of(w.not_followed_by, _plural) + r"(?!\w)",
                f"followed by {_words(w.not_followed_by)}")
        if w.not_preceded_by:
            add(_any_of(w.not_preceded_by, _plural) + r"[\s-]+" + word, f"preceded by {_words(w.not_preceded_by)}")
        if w.not_in_sentence_with:
            others = _any_of(w.not_in_sentence_with, lit)
            label = f"in the same sentence as {_words(w.not_in_sentence_with)}"
            add(word + _SENTENCE_GAP + others, label)
            add(others + _SENTENCE_GAP + word, label)
        for phrase in w.ignore_phrases:
            add("(?i:" + lit(phrase) + ")", f"the phrase {phrase.strip()}")
        rules.append(BrandRule(
            name=name, pattern=word + SUFFIX, case_sensitive=w.exact_case, context_window=CLOSENESS[w.closeness],
            require_context=list(dict.fromkeys(context)), exclude=exclude,
        ))

    first = p.brands[0].name.strip()
    unique = [x.name for x in p.people if not x.common]
    common = [x.name for x in p.people if x.common]
    if unique:
        rules.append(BrandRule(name=f"{first} leadership", pattern="|".join(lit(n) for n in unique)))
    if common:
        brand_names = [b.name for b in p.brands] + [a for b in p.brands for a in b.always] + [
            b.everyday_word.word for b in p.brands if b.everyday_word
        ]
        rules.append(BrandRule(
            name=f"{first} leadership (common names)", pattern="|".join(lit(n) for n in common), context_window=150,
            require_context=list(dict.fromkeys(lit(n) for n in brand_names)),
        ))
    return BuildResult(rules=rules, warnings=warnings, labels=labels)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ~/Desktop/niks/url-verification && uv run pytest tests/test_profile.py tests/test_profile_build.py -q`
Expected: all PASS. If an offset assertion is off by a few characters, recount it by hand against the sentence; do not loosen the assertion to a length check.

- [ ] **Step 5: Commit**

```bash
cd ~/Desktop/niks/url-verification
git add urlverify/profile.py tests/test_profile_build.py
git commit -m "feat: build brand rules from a plain-language profile"
```

---

### Task 3: Parity with the hand-written sets (url-verification)

Proves the form can express what the team relies on today. A prototype of `build_rules` was run against these exact profiles and sentences on 2026-10-08: 34 of 39 sentences match the hand-written rules; the other 5 are deliberate improvements, marked `improves=True` below with the reason.

**Files:**
- Test: `tests/test_profile_build.py` (append)

**Interfaces:**
- Consumes: `build_rules`, profile types, `load_config` from `urlverify.config`, `BrandMatcher`.

- [ ] **Step 1: Write the parity test**

Append to `tests/test_profile_build.py`:

```python
from pathlib import Path

from urlverify.config import load_config

ROOT = Path(__file__).resolve().parents[1]

PARITY_PROFILES = {
    "safari": BrandProfile(
        [
            ProfileBrand(
                "Safari",
                always=["Safari Industries", "SAFARIND"],
                handles=["safaribags", "safariluggage"],
                everyday_word=EverydayWord(
                    "Safari", True, "close",
                    confirm=["luggage", "bag", "trolley", "suitcase", "backpack", "NSE", "BSE", "share price", "quarter"],
                    not_followed_by=["browser", "extension", "bookmark", "reader", "window", "tab", "park", "tour", "lodge",
                                     "ride", "camp", "guide", "experience", "holiday", "destination", "vehicle", "suit", "hat"],
                    not_preceded_by=["Apple", "iOS", "macOS", "Mac", "iPhone", "iPad", "web", "wildlife", "jungle", "jeep",
                                     "desert", "game", "photo", "night", "walking", "African", "bush", "forest", "tiger", "lion"],
                    not_in_sentence_with=["Masai Mara", "Serengeti", "Kruger", "Ranthambore", "Corbett", "Kaziranga",
                                          "Bandhavgarh"],
                ),
            ),
            ProfileBrand("Genius", everyday_word=EverydayWord(
                "Genius", True, "nearby", confirm=["luggage", "bag", "trolley", "suitcase", "backpack"],
                not_followed_by=["Bar", "Hour", "Scholar"],
                not_preceded_by=["evil", "creative", "marketing", "comic", "stroke", "work", "resident", "certified"])),
            ProfileBrand("Magnum", everyday_word=EverydayWord(
                "Magnum", True, "nearby", confirm=["luggage", "bag", "trolley", "suitcase", "backpack"],
                not_followed_by=["ice cream", "PI", "Photos", "opus", "Research"],
                not_in_sentence_with=["Dirty Harry", "revolver", "handgun", "calibre", "caliber"])),
        ],
        people=[Person("Sudhir Jatia")],
    ),
    "vip": BrandProfile(
        [
            ProfileBrand(
                "VIP Industries", always=["V.I.P. Industries", "VIP Industries", "VIPIND"],
                handles=["vipindustries", "vip_industries", "vipbags"],
                everyday_word=EverydayWord(
                    "VIP", False, "close", confirm=["Industries", "Bag", "luggage", "Ltd"],
                    not_followed_by=["access", "pass", "lounge", "ticket", "treatment", "guest", "member", "area", "section",
                                     "room", "list", "service", "customer", "client", "experience", "package", "entry",
                                     "seat"]),
            ),
            ProfileBrand("Skybags", always=["Skybags", "Sky bags"], handles=["skybags"]),
            ProfileBrand("Carlton", everyday_word=EverydayWord(
                "Carlton", True, "nearby", confirm=["luggage", "bag", "trolley", "suitcase", "backpack", "travel"],
                not_followed_by=["Hotel", "Tower", "Bank", "House", "Street", "Road", "Club", "University", "Cigarette"],
                ignore_phrases=["Ritz-Carlton"])),
        ],
        people=[Person("Dilip Piramal"), Person("Neetu Kashiramka")],
    ),
    "basil": BrandProfile(
        [ProfileBrand("Basil", everyday_word=EverydayWord(
            "Basil", True, "nearby",
            confirm=["lunch box", "lunchbox", "bento", "water bottle", "food jar", "tiffin", "kid", "children", "school",
                     "D2C", "houseware"],
            not_followed_by=["leaves", "leaf", "pesto", "seed", "oil", "sauce", "plant", "chicken", "tofu", "rice", "paste",
                             "Joseph", "Fawlty", "Brush", "Rathbone", "Systems", "Hayden"],
            not_preceded_by=["holy", "sweet", "Thai", "fresh", "dried", "chopped", "lemon", "purple", "Genovese", "tulsi"],
            not_in_sentence_with=["pesto", "recipe", "tomato", "mozzarella", "garlic", "oregano", "parsley", "caprese",
                                  "herb"],
            ignore_phrases=["St Basil", "St. Basil"]))],
        people=[Person("Harini Rajagopalan"), Person("Mahesh Muraleedharan")],
    ),
    "multiples": BrandProfile(
        [ProfileBrand(
            "Multiples", always=["Multiples Alternate Asset Management", "Multiples Private Equity"],
            everyday_word=EverydayWord(
                "Multiples", True, "nearby",
                confirm=["private equity", "PE", "fund", "stake", "buyout", "portfolio", "deal", "IPO", "crore"],
                not_preceded_by=["valuation", "earnings", "EBITDA", "revenue", "price", "sales", "trading", "EV", "high",
                                 "higher", "premium", "rich", "lofty", "steep", "expensive", "exit", "deal", "transaction",
                                 "peer", "market"],
                not_followed_by=["of", "expansion", "compression", "rerating", "re-rating", "contraction"]))],
        people=[Person("Renuka Ramnath"), Person("Sudhir Variyar"), Person("Manish Gaur", common=True)],
    ),
}

# (set, sentence, counted offsets from the generated rules, improves)
# improves=True: the generated rules deliberately differ from the hand-written ones, for the stated reason.
PARITY_CASES = [
    ("safari", "Safari Industries shares rose 4% on the NSE today.", [0], False),
    ("safari", "Open the link in Safari browser on your Mac.", [], False),
    ("safari", "We took a jeep Safari in Kruger last year.", [], False),
    ("safari", "Safari launched a new trolley range for travellers.", [0], False),
    ("safari", "Apple Safari now blocks trackers.", [], False),
    ("safari", "The Safari Park in Kruger was lovely.", [], False),
    ("safari", "A Safari through the Serengeti is unforgettable.", [], False),
    # leaders count as mentions
    ("safari", "Safari reported a strong quarter, said Sudhir Jatia.", [0, 39], True),
    ("safari", "Safari, the luggage maker, cut prices.", [0], False),
    ("safari", "Check out #safaribags for the sale.", [10], False),
    ("safari", "Genius luggage from Safari is light.", [0, 20], False),
    # the hand-written '(creative|...) genius' exclusion is lowercase-only, so it counted "creative Genius"
    ("safari", "He is a creative Genius with bags of talent.", [], True),
    ("safari", "Magnum ice cream is not a bag.", [], False),
    ("safari", "The Magnum trolley bag is sturdy.", [4], False),
    ("safari", "Safari-backed brand expands.", [], False),
    ("safari", "Our Safari tour ended at dusk.", [], False),
    ("vip", "VIP Industries posted higher sales.", [0], False),
    ("vip", "Get VIP access to the lounge.", [], False),
    ("vip", "The VIP lounge was packed with VIP guests.", [], False),
    ("vip", "VIP bags are on sale this week.", [0], False),
    ("vip", "Skybags launched a new backpack.", [0], False),
    ("vip", "We stayed at the Ritz-Carlton with our luggage.", [], False),
    ("vip", "Carlton luggage is sturdy for travel.", [0], False),
    ("vip", "Carlton Hotel bags award for travel.", [], False),
    # leaders count as mentions
    ("vip", "Dilip Piramal founded VIP.", [0, 22], True),
    ("basil", "Basil raised funds to grow its kids lunch box range.", [0], False),
    ("basil", "Add fresh Basil leaves and tomato to the pasta.", [], False),
    ("basil", "Basil Joseph directed a new film for children.", [], False),
    ("basil", "Basil tiffin boxes are popular at school.", [0], False),
    ("basil", "St Basil cathedral draws children every year.", [], False),
    # the hand-written '(holy|...|Thai|...) basil' exclusion is lowercase-only, so it counted "Thai Basil"
    ("basil", "Thai Basil chicken is a kids favourite at school.", [], True),
    ("multiples", "Multiples Private Equity invested Rs 500 crore.", [0], False),
    ("multiples", "Multiples picked up a stake in the firm.", [0], False),
    ("multiples", "The stock trades at high Multiples of earnings.", [], False),
    ("multiples", "Valuation Multiples expansion continued in the sector.", [], False),
    ("multiples", "Renuka Ramnath said the fund is closed.", [0], False),
    # a leader's name now also confirms the everyday word next to it
    ("multiples", "Manish Gaur joined Multiples last year.", [0, 19], True),
    ("multiples", "Manish Gaur won a cricket award.", [], False),
    ("multiples", "Multiples-backed firm lists on BSE with a fund stake.", [0], False),
]


@pytest.fixture(scope="module")
def hand_written():
    return load_config(ROOT / "config.yaml").brands


@pytest.mark.parametrize(("set_name", "text", "expected", "improves"), PARITY_CASES)
def test_parity_with_hand_written_sets(hand_written, set_name, text, expected, improves):
    generated = sorted(h.offset for h in BrandMatcher(build_rules(PARITY_PROFILES[set_name]).rules).find(text, "body"))
    assert generated == expected
    if set_name in hand_written:
        hand = sorted(h.offset for h in BrandMatcher(hand_written[set_name]).find(text, "body"))
        assert (hand != expected) if improves else (hand == expected)
```

- [ ] **Step 2: Run the parity test**

Run: `cd ~/Desktop/niks/url-verification && uv run pytest tests/test_profile_build.py -q -k parity`
Expected: 39 PASS. A failure on a non-`improves` case means `build_rules` drifted from Task 2; fix the generator, not the case. (If `config.yaml` no longer contains one of the four sets, the hand-written half is skipped by the `if`.)

- [ ] **Step 3: Commit**

```bash
cd ~/Desktop/niks/url-verification
git add tests/test_profile_build.py
git commit -m "test: profiles reproduce the hand-written safari, vip, basil and multiples sets"
```

---

### Task 4: Storing profiles in config.yaml (url-verification)

**Files:**
- Modify: `urlverify/config.py` (`Config` dataclass, `load_config`)
- Modify: `urlverify/brands.py`
- Modify: `README.md` (Configuration section and the list of configured sets)
- Test: `tests/test_brands.py` (append)

**Interfaces:**
- Consumes: `profile_from_dict`, `validate_profile`, `build_rules`, `ProfileError`, `BrandProfile`, `ProfileWarning`, `WORD_LIST_FIELDS`.
- Produces (used by Tasks 5-6):
  - `Config.profiles: dict[str, BrandProfile]` (default empty)
  - `brands.MANAGED_MESSAGE: str`
  - `brands.save_profile(config_path, name: str, profile: BrandProfile) -> tuple[Path, list[ProfileWarning]]`
  - `brands.load_profile(config_path, name: str) -> BrandProfile | None`
  - `brands.detach_profile(config_path, name: str) -> Path`
  - `@dataclass brands.SetInfo(rules: list[BrandRule], managed: bool, stale: bool)`
  - `brands.list_sets_detailed(config_path) -> dict[str, SetInfo]`
  - `brands.try_rules(rules, text, labels: dict[str, str] | None = None) -> dict` - with `labels`, reasons read `"Not counted: <label>"` and `"Not counted: no confirming word nearby"`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_brands.py`:

```python
from urlverify.profile import BrandProfile, EverydayWord, Person, ProfileBrand, build_rules

ACME_PROFILE = BrandProfile(
    [ProfileBrand("Acme", always=["Acme Industries"], everyday_word=EverydayWord("Acme", confirm=["luggage"],
                                                                                 not_followed_by=["Corp"]))],
    people=[Person("Jo Bloggs")],
)


def test_save_profile_writes_profile_and_rules_in_one_write(cfg_path):
    before = cfg_path.read_text()
    backup, warnings = brands.save_profile(cfg_path, "acme", ACME_PROFILE)
    assert warnings == []
    assert backup.read_text() == before  # one backup of the previous file
    cfg = load_config(cfg_path)
    assert cfg.profiles["acme"] == ACME_PROFILE
    assert cfg.brands["acme"] == build_rules(ACME_PROFILE).rules
    assert brands.load_profile(cfg_path, "acme") == ACME_PROFILE
    assert brands.load_profile(cfg_path, "safari") is None
    after = cfg_path.read_text()
    assert "# Runtime configuration for verify_urls.py." in after  # comments survive
    assert "profiles:" in after


def test_save_profile_again_keeps_position_and_updates(cfg_path):
    brands.save_profile(cfg_path, "acme", ACME_PROFILE)
    order = list(brands.list_sets(cfg_path))
    changed = BrandProfile([ProfileBrand("Acme", always=["Acme Industries", "ACMEIND"])])
    brands.save_profile(cfg_path, "acme", changed)
    assert list(brands.list_sets(cfg_path)) == order
    assert load_config(cfg_path).profiles["acme"] == changed


def test_raw_save_refuses_a_managed_set(cfg_path):
    brands.save_profile(cfg_path, "acme", ACME_PROFILE)
    with pytest.raises(ConfigError, match="managed by the simple form"):
        brands.save_set(cfg_path, "acme", [BrandRule(name="Acme", pattern="Acme")])


def test_delete_set_removes_profile_too(cfg_path):
    brands.save_profile(cfg_path, "acme", ACME_PROFILE)
    brands.delete_set(cfg_path, "acme")
    cfg = load_config(cfg_path)
    assert "acme" not in cfg.brands and "acme" not in cfg.profiles


def test_detach_keeps_rules_and_drops_profile(cfg_path):
    brands.save_profile(cfg_path, "acme", ACME_PROFILE)
    rules = brands.list_sets(cfg_path)["acme"]
    brands.detach_profile(cfg_path, "acme")
    cfg = load_config(cfg_path)
    assert cfg.brands["acme"] == rules and "acme" not in cfg.profiles
    brands.save_set(cfg_path, "acme", rules)  # now editable as raw rules
    with pytest.raises(ConfigError, match="not managed by the simple form"):
        brands.detach_profile(cfg_path, "acme")


def test_list_sets_detailed_flags_managed_and_stale(cfg_path):
    brands.save_profile(cfg_path, "acme", ACME_PROFILE)
    info = brands.list_sets_detailed(cfg_path)
    assert info["acme"].managed and not info["acme"].stale
    assert not info["safari"].managed and not info["safari"].stale
    # A hand edit of the generated rules leaves the profile valid but stale; verification still runs the stored rules.
    text = cfg_path.read_text().replace("Acme[\\s-]+Industries", "Acme[\\s-]+Inc", 1)
    cfg_path.write_text(text)
    info = brands.list_sets_detailed(cfg_path)
    assert info["acme"].stale and "Inc" in info["acme"].rules[0].pattern


def test_load_config_rejects_bad_profiles(cfg_path):
    brands.save_profile(cfg_path, "acme", ACME_PROFILE)
    original = cfg_path.read_text()
    cfg_path.write_text(original.replace("closeness: nearby", "closeness: far", 1))
    with pytest.raises(ConfigError, match=r"profile 'acme'.*close, nearby or paragraph"):
        load_config(cfg_path)
    cfg_path.write_text(original + "\n  ghost:\n    brands:\n      - name: Ghost\n        always: ['Ghost']\n")
    with pytest.raises(ConfigError, match=r"profile 'ghost' has no brand set"):
        load_config(cfg_path)


def test_try_rules_with_labels_uses_plain_reasons():
    result = build_rules(ACME_PROFILE)
    out = brands.try_rules(result.rules, "Acme Corp sells anvils. Acme is here.", result.labels)
    reasons = [x["reason"] for x in out["excluded"]]
    assert reasons == ["Not counted: followed by Corp", "Not counted: no confirming word nearby"]
    raw = brands.try_rules(result.rules, "Acme Corp sells anvils.")
    assert raw["excluded"][0]["reason"].startswith("excluded by")
```

Note for `test_load_config_rejects_bad_profiles`: `profiles:` is written at the end of the file by `save_profile`, so appending `  ghost:` lands inside it. If ruamel places it elsewhere, insert the ghost entry directly under the `profiles:` line instead.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/Desktop/niks/url-verification && uv run pytest tests/test_brands.py -q`
Expected: new tests FAIL with `AttributeError: module 'urlverify.brands' has no attribute 'save_profile'`

- [ ] **Step 3: Implement `Config.profiles` in `urlverify/config.py`**

Add the import and field, and validate in `load_config` right after the `brands` loop (before `categories`):

```python
from .profile import BrandProfile, ProfileError, profile_from_dict, validate_profile
```

```python
@dataclass
class Config:
    ...existing fields unchanged...
    bridge: dict = field(default_factory=lambda: dict(_BRIDGE_DEFAULTS))
    profiles: dict[str, BrandProfile] = field(default_factory=dict)  # set name -> simple-form answers
```

```python
    profiles_raw = raw.get("profiles") or {}
    if not isinstance(profiles_raw, dict):
        raise ConfigError("'profiles:' must be a mapping of brand set name to simple-form answers")
    profiles: dict[str, BrandProfile] = {}
    for pname, praw in profiles_raw.items():
        if pname not in brands:
            raise ConfigError(f"profile {pname!r} has no brand set under 'brands:'; save it from the form again or "
                              "delete the profile")
        try:
            prof = profile_from_dict(praw)
            validate_profile(prof)
        except ProfileError as e:
            raise ConfigError(f"profile {pname!r}: {e}") from e
        profiles[str(pname)] = prof
```

and pass `profiles=profiles` in the `return Config(...)` call.

- [ ] **Step 4: Implement storage in `urlverify/brands.py`**

Add imports and code:

```python
from dataclasses import dataclass

from .profile import WORD_LIST_FIELDS, BrandProfile, ProfileWarning, build_rules

MANAGED_MESSAGE = ("This set is managed by the simple form. Edit it there, or switch it to advanced editing "
                   "first.")


@dataclass
class SetInfo:
    rules: list[BrandRule]
    managed: bool
    stale: bool  # managed, and the stored rules differ from what the form answers produce now


def list_sets_detailed(config_path: str | Path) -> dict[str, SetInfo]:
    cfg = load_config(config_path)
    out = {}
    for name, rules in cfg.brands.items():
        profile = cfg.profiles.get(name)
        out[name] = SetInfo(rules=rules, managed=profile is not None,
                            stale=profile is not None and build_rules(profile).rules != rules)
    return out


def load_profile(config_path: str | Path, name: str) -> BrandProfile | None:
    return load_config(config_path).profiles.get(name)


def _flow(values: list[str]) -> CommentedSeq:
    seq = CommentedSeq([SingleQuotedScalarString(v.strip()) for v in values])
    seq.fa.set_flow_style()
    return seq


def _profile_node(profile: BrandProfile) -> CommentedMap:
    node = CommentedMap()
    brands_seq = CommentedSeq()
    for b in profile.brands:
        bn = CommentedMap()
        bn["name"] = b.name.strip()
        for key in ("always", "handles"):
            if getattr(b, key):
                bn[key] = _flow(getattr(b, key))
        w = b.everyday_word
        if w is not None:
            wn = CommentedMap()
            wn["word"] = w.word.strip()
            wn["exact_case"] = w.exact_case
            wn["closeness"] = w.closeness
            for key in WORD_LIST_FIELDS:
                if getattr(w, key):
                    wn[key] = _flow(getattr(w, key))
            bn["everyday_word"] = wn
        brands_seq.append(bn)
    node["brands"] = brands_seq
    if profile.people:
        people = CommentedSeq()
        for x in profile.people:
            pn = CommentedMap()
            pn["name"] = x.name.strip()
            if x.common:
                pn["common"] = True
            people.append(pn)
        node["people"] = people
    return node


def save_profile(config_path: str | Path, name: str, profile: BrandProfile) -> tuple[Path, list[ProfileWarning]]:
    config_path = Path(config_path)
    result = build_rules(profile)  # raises ProfileError (a ValueError) with a message naming the form field
    validate_set(name, result.rules)
    doc = _load_doc(config_path)
    doc["brands"][name] = CommentedSeq([_rule_node(r) for r in result.rules])
    if doc.get("profiles") is None:
        doc["profiles"] = CommentedMap()
    doc["profiles"][name] = _profile_node(profile)
    return _write(config_path, doc), result.warnings


def detach_profile(config_path: str | Path, name: str) -> Path:
    config_path = Path(config_path)
    doc = _load_doc(config_path)
    profiles = doc.get("profiles") or {}
    if name not in profiles:
        raise ConfigError(f"{name!r} is not managed by the simple form")
    del profiles[name]
    if not profiles:
        del doc["profiles"]
    return _write(config_path, doc)
```

Change `save_set` to refuse a managed set (first lines after `_load_doc`):

```python
    doc = _load_doc(config_path)
    if name in (doc.get("profiles") or {}):
        raise ConfigError(MANAGED_MESSAGE)
```

Change `delete_set` to drop the profile too, just before `return _write(...)`:

```python
    del sets[name]
    profiles = doc.get("profiles") or {}
    if name in profiles:
        del profiles[name]
        if not profiles:
            del doc["profiles"]
    return _write(config_path, doc)
```

Change `try_rules` to take labels:

```python
def try_rules(rules: list[BrandRule], text: str, labels: dict[str, str] | None = None) -> dict:
```

and replace the reason block with:

```python
            covering = next((rx for (a, b), rx in exclusions if a <= s and e <= b), None)
            if covering:
                reason = (f"Not counted: {labels[covering]}" if labels and covering in labels
                          else f"excluded by {covering!r}")
            elif rule.require_context:
                reason = ("Not counted: no confirming word nearby" if labels is not None
                          else f"no context word within {rule.context_window} characters")
            else:
                reason = "overlaps a longer match from another rule"
```

- [ ] **Step 5: Run the full url-verification suite**

Run: `cd ~/Desktop/niks/url-verification && uv run pytest -q`
Expected: all PASS (existing brand tests unchanged; the real `config.yaml` has no `profiles:` and still loads).

- [ ] **Step 6: Update `README.md`**

In the "Configuration" section, after the brand rule example, add:

````markdown
### Brand sets made with the simple form

The RepScore Pipeline's Brands page can create a set from plain-language answers instead of regex. Those answers
are stored under `profiles:`, keyed by the same name as the set under `brands:`, and the rules under `brands:` are
rebuilt from them on every save (`urlverify/profile.py`, `build_rules`). Verification always runs the rules under
`brands:`.

```yaml
profiles:
  safari:
    brands:
      - name: Safari
        always: ['Safari Industries', 'SAFARIND']
        everyday_word:
          word: Safari
          exact_case: true
          closeness: close      # close (60 chars) | nearby (100) | paragraph (2000)
          confirm: ['luggage', 'bag']
          not_followed_by: ['browser', 'tour']
    people:
      - name: Sudhir Jatia
```

Do not hand-edit the generated rules of a set that has a profile: the app marks it stale and the next save from
the form replaces your edit. To hand-tune such a set, use "Switch to advanced editing" on the Brands page, which
drops the profile and keeps the rules.
````

Also replace the stale list of configured sets in "Choosing the brand" with the current twelve: vip, samsonite, safari, mokobara, brahma_ai, inamo, basil, navana_ai, multiples, kedaara, chryscapital, qsr_india (check `config.yaml` and list what is actually there).

- [ ] **Step 7: Commit**

```bash
cd ~/Desktop/niks/url-verification
git add urlverify/config.py urlverify/brands.py tests/test_brands.py README.md
git commit -m "feat: store simple-form profiles next to their generated rules in config.yaml"
```

---

### Task 5: Brand profile API (repscore-pipeline)

**Files:**
- Create: `api/pipeline_api/routes/brand_profiles.py`
- Modify: `api/pipeline_api/routes/brands.py` (list + raw save guard)
- Modify: `api/pipeline_api/main.py` (register router)
- Test: `api/tests/test_brand_profiles_api.py`

**Interfaces:**
- Consumes: Task 4 `brands.*`, Task 1/2 `profile_from_dict`, `profile_to_dict`, `build_rules`, `ProfileError`.
- Produces (used by Tasks 6-10), all JSON:
  - `GET /api/brands` -> `{"sets": [{"name", "rules", "managed": bool, "stale": bool}]}`
  - `PUT /api/brands/{name}` -> 409 `{"error": MANAGED_MESSAGE}` for a managed set
  - `GET /api/brand-profiles/{name}` -> `{"profile": <profile dict>}`; 404 otherwise
  - `PUT /api/brand-profiles/{name}` body `{"profile", "create": bool}` -> `{"name", "backup", "warnings": [{"brand", "field", "message"}]}`; 409 duplicate/raw; 422 invalid
  - `POST /api/brand-profiles/preview` body `{"profile"}` -> `{"rules": [...], "warnings": [...]}`
  - `POST /api/brand-profiles/test` body `{"profile", "text"}` -> `{"hits": [...], "excluded": [...]}` with plain reasons
  - `DELETE /api/brand-profiles/{name}/profile` -> `{"name", "backup"}`

- [ ] **Step 1: Write the failing tests**

Create `api/tests/test_brand_profiles_api.py`:

```python
from conftest import FakeSearch, make_client

PROFILE = {
    "brands": [
        {
            "name": "Zeta",
            "always": ["Zeta Industries"],
            "handles": [],
            "everyday_word": {"word": "Zeta", "exact_case": True, "closeness": "close", "confirm": ["luggage"],
                              "not_followed_by": ["Corp"], "not_preceded_by": [], "not_in_sentence_with": [],
                              "ignore_phrases": []},
        }
    ],
    "people": [],
}


def test_create_load_list_and_edit_a_form_set(settings):
    with make_client(settings, search_one=FakeSearch()) as c:
        r = c.put("/api/brand-profiles/zeta", json={"profile": PROFILE, "create": True})
        assert r.status_code == 200, r.text
        assert r.json()["warnings"] == [] and r.json()["backup"]
        assert c.get("/api/brand-profiles/zeta").json()["profile"] == PROFILE
        sets = {s["name"]: s for s in c.get("/api/brands").json()["sets"]}
        assert sets["zeta"]["managed"] is True and sets["zeta"]["stale"] is False
        assert sets["acme"]["managed"] is False
        assert [r["name"] for r in sets["zeta"]["rules"]] == ["Zeta", "Zeta"]
        edited = {**PROFILE, "people": [{"name": "Jo Bloggs", "common": False}]}
        assert c.put("/api/brand-profiles/zeta", json={"profile": edited}).status_code == 200
        assert c.get("/api/brand-profiles/zeta").json()["profile"]["people"] == [{"name": "Jo Bloggs", "common": False}]


def test_create_refuses_existing_names_and_raw_sets(settings):
    with make_client(settings, search_one=FakeSearch()) as c:
        c.put("/api/brand-profiles/zeta", json={"profile": PROFILE, "create": True})
        assert c.put("/api/brand-profiles/zeta", json={"profile": PROFILE, "create": True}).status_code == 409
        # acme is a raw set: the form never silently replaces hand-written rules, with or without create
        for create in (True, False):
            r = c.put("/api/brand-profiles/acme", json={"profile": PROFILE, "create": create})
            assert r.status_code == 409 and "raw" in r.json()["error"]


def test_raw_endpoint_refuses_a_managed_set(settings):
    with make_client(settings, search_one=FakeSearch()) as c:
        c.put("/api/brand-profiles/zeta", json={"profile": PROFILE, "create": True})
        r = c.put("/api/brands/zeta", json={"rules": [{"name": "Zeta", "pattern": "Zeta"}]})
        assert r.status_code == 409 and "simple form" in r.json()["error"]


def test_validation_errors_are_422_with_form_wording(settings):
    bad = {"brands": [{"name": "Zeta", "always": ["Zeta", "zeta"]}]}
    with make_client(settings, search_one=FakeSearch()) as c:
        r = c.put("/api/brand-profiles/zeta", json={"profile": bad, "create": True})
        assert r.status_code == 422 and "Names that always mean this brand" in r.json()["error"]
        r = c.put("/api/brand-profiles/Bad Name", json={"profile": PROFILE, "create": True})
        assert r.status_code == 422 and "set name" in r.json()["error"]
        r = c.put("/api/brand-profiles/zeta", json={"profile": {**PROFILE, "colour": "red"}, "create": True})
        assert r.status_code == 422


def test_preview_returns_rules_and_warnings_without_saving(settings):
    lonely = {"brands": [{"name": "Basil", "everyday_word": {"word": "Basil"}}]}
    with make_client(settings, search_one=FakeSearch()) as c:
        r = c.post("/api/brand-profiles/preview", json={"profile": lonely})
        assert r.status_code == 200
        body = r.json()
        assert body["rules"][0]["pattern"].startswith("Basil")
        assert body["warnings"][0]["brand"] == 0 and body["warnings"][0]["field"] == "confirm"
        assert "basil" not in [s["name"] for s in c.get("/api/brands").json()["sets"]]


def test_test_endpoint_explains_in_plain_language(settings):
    with make_client(settings, search_one=FakeSearch()) as c:
        text = "Zeta luggage is light. Zeta Corp makes anvils for cartoon coyotes everywhere they roam. Zeta again."
        r = c.post("/api/brand-profiles/test", json={"profile": PROFILE, "text": text})
        body = r.json()
        assert [h["brand"] for h in body["hits"]] == ["Zeta"]
        assert [x["reason"] for x in body["excluded"]] == ["Not counted: followed by Corp",
                                                          "Not counted: no confirming word nearby"]


def test_detach_and_missing(settings):
    with make_client(settings, search_one=FakeSearch()) as c:
        assert c.get("/api/brand-profiles/acme").status_code == 404
        assert c.get("/api/brand-profiles/nope").status_code == 404
        c.put("/api/brand-profiles/zeta", json={"profile": PROFILE, "create": True})
        assert c.delete("/api/brand-profiles/zeta/profile").status_code == 200
        sets = {s["name"]: s for s in c.get("/api/brands").json()["sets"]}
        assert sets["zeta"]["managed"] is False
        assert c.delete("/api/brand-profiles/zeta/profile").status_code == 422
        assert c.delete("/api/brands/zeta").status_code == 200
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/Desktop/niks/repscore-pipeline/api && uv run pytest tests/test_brand_profiles_api.py -q`
Expected: FAIL (404 on `/api/brand-profiles/...`)

- [ ] **Step 3: Implement the router**

Create `api/pipeline_api/routes/brand_profiles.py`:

```python
"""The simple brand form: plain-language profiles that url-verification turns into brand rules."""

from __future__ import annotations

from dataclasses import asdict
from typing import Any, Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict
from urlverify import brands
from urlverify.profile import BrandProfile, ProfileError, build_rules, profile_from_dict, profile_to_dict

from ..config_errors import CONFIG_LOAD_ERRORS, CONFIG_WRITE_ERRORS
from ..errors import ApiError

router = APIRouter()


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class WordBody(_Strict):
    word: str
    exact_case: bool = True
    closeness: Literal["close", "nearby", "paragraph"] = "nearby"
    confirm: list[str] = []
    not_followed_by: list[str] = []
    not_preceded_by: list[str] = []
    not_in_sentence_with: list[str] = []
    ignore_phrases: list[str] = []


class BrandBody(_Strict):
    name: str
    always: list[str] = []
    handles: list[str] = []
    everyday_word: WordBody | None = None


class PersonBody(_Strict):
    name: str
    common: bool = False


class ProfileBody(_Strict):
    brands: list[BrandBody]
    people: list[PersonBody] = []


class SaveBody(_Strict):
    profile: ProfileBody
    create: bool = False


class PreviewBody(_Strict):
    profile: ProfileBody


class TestBody(_Strict):
    profile: ProfileBody
    text: str


def _config(request: Request) -> Any:
    return request.app.state.deps.settings.verifier_config


def _profile(body: ProfileBody) -> BrandProfile:
    try:
        return profile_from_dict(body.model_dump())
    except ProfileError as e:
        raise ApiError(422, str(e)) from None


def _sets(request: Request) -> dict[str, brands.SetInfo]:
    try:
        return brands.list_sets_detailed(_config(request))
    except CONFIG_LOAD_ERRORS as e:
        raise ApiError(422, f"config.yaml could not be read: {e}") from None


@router.get("/api/brand-profiles/{name}")
def get_profile(request: Request, name: str) -> dict:
    info = _sets(request).get(name)
    if info is None:
        raise ApiError(404, f"No brand set named {name!r}.")
    profile = brands.load_profile(_config(request), name)
    if profile is None:
        raise ApiError(404, f"{name!r} is a raw set, edited with regex rules, not the simple form.")
    return {"profile": profile_to_dict(profile)}


@router.put("/api/brand-profiles/{name}")
def save_profile(request: Request, name: str, body: SaveBody) -> dict:
    profile = _profile(body.profile)
    existing = _sets(request).get(name)
    if existing is not None and not existing.managed:
        raise ApiError(409, f"{name!r} is a raw set with hand-written rules. Pick another name; the form never "
                            "replaces hand-written rules.")
    if existing is not None and body.create:
        raise ApiError(409, f"A set named {name!r} already exists.")
    try:
        backup, warnings = brands.save_profile(_config(request), name, profile)
    except CONFIG_WRITE_ERRORS as e:
        raise ApiError(422, str(e)) from None
    return {"name": name, "backup": str(backup), "warnings": [asdict(w) for w in warnings]}


@router.post("/api/brand-profiles/preview")
def preview(body: PreviewBody) -> dict:
    try:
        result = build_rules(_profile(body.profile))
    except ProfileError as e:
        raise ApiError(422, str(e)) from None
    return {"rules": [brands.rule_to_dict(r) for r in result.rules], "warnings": [asdict(w) for w in result.warnings]}


@router.post("/api/brand-profiles/test")
def test_profile(body: TestBody) -> dict:
    try:
        result = build_rules(_profile(body.profile))
    except ProfileError as e:
        raise ApiError(422, str(e)) from None
    return brands.try_rules(result.rules, body.text, result.labels)


@router.delete("/api/brand-profiles/{name}/profile")
def detach(request: Request, name: str) -> dict:
    try:
        backup = brands.detach_profile(_config(request), name)
    except CONFIG_WRITE_ERRORS as e:
        raise ApiError(422, str(e)) from None
    return {"name": name, "backup": str(backup)}
```

`ProfileError` subclasses `ValueError`, which is already in `CONFIG_WRITE_ERRORS`, so validation failures inside `save_profile` become 422 with the form wording.

- [ ] **Step 4: Update `routes/brands.py`**

Replace `list_brands` and add the managed guard at the top of `save_brand`:

```python
@router.get("/api/brands")
def list_brands(request: Request) -> dict:
    try:
        sets = brands.list_sets_detailed(_config(request))
    except CONFIG_LOAD_ERRORS as e:
        raise ApiError(422, f"config.yaml could not be read: {e}") from None
    return {
        "sets": [
            {"name": n, "rules": [brands.rule_to_dict(r) for r in s.rules], "managed": s.managed, "stale": s.stale}
            for n, s in sets.items()
        ]
    }


@router.put("/api/brands/{name}")
def save_brand(request: Request, name: str, body: SaveBody) -> dict:
    try:
        existing = brands.list_sets_detailed(_config(request))
    except CONFIG_LOAD_ERRORS as e:
        raise ApiError(422, f"config.yaml could not be read: {e}") from None
    if name in existing and existing[name].managed:
        raise ApiError(409, brands.MANAGED_MESSAGE)
    if body.create and name in existing:
        raise ApiError(409, f"A set named {name!r} already exists.")
    try:
        backup = brands.save_set(_config(request), name, _rules(body.rules))
    except CONFIG_WRITE_ERRORS as e:
        raise ApiError(422, str(e)) from None
    return {"name": name, "backup": str(backup)}
```

- [ ] **Step 5: Register the router in `main.py`**

```python
from .routes import brand_profiles as brand_profiles_routes
...
    app.include_router(brands_routes.router)
    app.include_router(brand_profiles_routes.router)
```

- [ ] **Step 6: Run API tests and lint**

Run: `cd ~/Desktop/niks/repscore-pipeline/api && uv run ruff format . && uv run pytest -q && uv run ruff check . && uv run pyright` (the plan's snippets are not pre-formatted; `ruff format` normalises them)
Expected: all PASS, no lint errors (existing `test_brands_api.py` tests still pass; the `sets` objects only gained keys).

- [ ] **Step 7: Commit**

```bash
cd ~/Desktop/niks/repscore-pipeline
git add api/pipeline_api/routes/brand_profiles.py api/pipeline_api/routes/brands.py api/pipeline_api/main.py api/tests/test_brand_profiles_api.py
git commit -m "feat: brand profile API for the simple brand form"
```

---

### Task 6: Suggest with Claude (repscore-pipeline API)

**Files:**
- Create: `api/pipeline_api/suggest.py`
- Modify: `api/pipeline_api/settings.py`, `api/pipeline_api/deps.py`, `api/pipeline_api/main.py`, `api/pipeline_api/routes/health.py`, `api/pipeline_api/routes/brand_profiles.py`, `api/pyproject.toml`, `.gitignore`, `e2e/start-api.sh`, `README.md`
- Test: `api/tests/test_suggest.py`

**Interfaces:**
- Consumes: `value_problem`, `normalise_handle`, `CLOSENESS` from `urlverify.profile`.
- Produces (used by Tasks 7 and 10):
  - `Settings.anthropic_api_key: str | None`, `Settings.suggest_model: str`
  - `class Suggester(Protocol): def __call__(self, brand_name: str, description: str) -> dict[str, Any]`
  - `class SuggestError(Exception)`
  - `sanitize_suggestion(raw: dict[str, Any]) -> tuple[dict[str, Any], int]`
  - `Deps.suggester: Suggester | None`; `create_app(..., suggester: Suggester | None = None)`
  - `GET /api/health` gains `"suggest_available": bool`
  - `POST /api/brand-profiles/suggest` body `{"brand_name", "description"}` -> `{"suggestion": {...}, "dropped": int}`; 503 no key; 502 Claude error; 422 empty brand name

- [ ] **Step 1: Write the failing tests**

Create `api/tests/test_suggest.py`:

```python
from conftest import FakeSearch, make_client

from pipeline_api.settings import load_settings
from pipeline_api.suggest import SuggestError, sanitize_suggestion

GOOD = {
    "always": ["Safari Industries", "safari industries", "  ", "x" * 300],
    "handles": ["#safaribags", "safari bags"],
    "everyday_word": {
        "word": "Safari", "exact_case": True, "closeness": "close", "confirm": ["luggage", "luggage"],
        "not_followed_by": ["browser"], "not_preceded_by": [], "not_in_sentence_with": ["Serengeti"],
        "ignore_phrases": [],
    },
    "people": [{"name": "Sudhir Jatia", "common": False}, {"name": "", "common": False}],
    "notes": "Collides with the Apple browser and wildlife safaris.",
}


class FakeSuggester:
    def __init__(self, result=None, error=None):
        self.result, self.error, self.calls = result, error, []

    def __call__(self, brand_name, description):
        self.calls.append((brand_name, description))
        if self.error:
            raise self.error
        return self.result


def test_sanitize_drops_and_counts_bad_entries():
    clean, dropped = sanitize_suggestion(GOOD)
    assert clean["always"] == ["Safari Industries"]
    assert clean["handles"] == ["safaribags"]
    assert clean["everyday_word"]["confirm"] == ["luggage"]
    assert clean["people"] == [{"name": "Sudhir Jatia", "common": False}]
    assert dropped == 6  # duplicate + empty + too long always, bad handle, duplicate confirm, empty person
    assert clean["notes"].startswith("Collides")


def test_sanitize_drops_an_unusable_everyday_word():
    clean, dropped = sanitize_suggestion({**GOOD, "everyday_word": {**GOOD["everyday_word"], "word": " "}})
    assert clean["everyday_word"] is None and dropped >= 1


def test_suggest_endpoint_returns_clean_suggestion(settings):
    fake = FakeSuggester(result=GOOD)
    with make_client(settings, search_one=FakeSearch(), suggester=fake) as c:
        assert c.get("/api/health").json()["suggest_available"] is True
        r = c.post("/api/brand-profiles/suggest", json={"brand_name": " Safari ", "description": "luggage maker"})
    assert r.status_code == 200
    assert r.json()["suggestion"]["always"] == ["Safari Industries"] and r.json()["dropped"] == 6
    assert fake.calls == [("Safari", "luggage maker")]


def test_suggest_errors(settings):
    with make_client(settings, search_one=FakeSearch()) as c:
        assert c.get("/api/health").json()["suggest_available"] is False
        r = c.post("/api/brand-profiles/suggest", json={"brand_name": "Safari"})
        assert r.status_code == 503 and "ANTHROPIC_API_KEY" in r.json()["error"]
    with make_client(settings, search_one=FakeSearch(), suggester=FakeSuggester(error=SuggestError("boom"))) as c:
        r = c.post("/api/brand-profiles/suggest", json={"brand_name": "Safari"})
        assert r.status_code == 502 and r.json()["error"] == "boom"
        assert c.post("/api/brand-profiles/suggest", json={"brand_name": "  "}).status_code == 422


def test_settings_read_suggest_keys():
    s = load_settings({"ANTHROPIC_API_KEY": "k", "PIPELINE_SUGGEST_MODEL": "claude-sonnet-5-5"})
    assert s.anthropic_api_key == "k" and s.suggest_model == "claude-sonnet-5-5"
    s = load_settings({"ANTHROPIC_API_KEY": ""})
    assert s.anthropic_api_key is None and s.suggest_model == "claude-opus-5-5"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ~/Desktop/niks/repscore-pipeline/api && uv run pytest tests/test_suggest.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'pipeline_api.suggest'`

- [ ] **Step 3: Add the dependency and settings**

Run: `cd ~/Desktop/niks/repscore-pipeline/api && uv add anthropic`

In `settings.py` add fields to `Settings` (after `search_fixture`):

```python
    anthropic_api_key: str | None = None  # Suggest on the brand form is off without it
    suggest_model: str = "claude-opus-5-5"
```

and in `load_settings`, load the repo's `.env` when reading the real environment, then pass the two values:

```python
from dotenv import load_dotenv
...
def load_settings(env: Mapping[str, str] | None = None) -> Settings:
    if env is None:
        load_dotenv(REPO_ROOT / ".env", override=False)  # ANTHROPIC_API_KEY for Suggest
        env = os.environ
    ...
        search_fixture=Path(fixture).expanduser() if fixture else None,
        anthropic_api_key=env.get("ANTHROPIC_API_KEY") or None,
        suggest_model=env.get("PIPELINE_SUGGEST_MODEL") or "claude-opus-5-5",
    )
```

Add `.env` to `.gitignore` (new line `.env`), and in `e2e/start-api.sh` add `export ANTHROPIC_API_KEY=""` next to the other dummy keys so e2e never picks up a real key from `.env` (`load_dotenv(override=False)` keeps an existing empty value).

- [ ] **Step 4: Write `suggest.py`**

Create `api/pipeline_api/suggest.py`:

```python
"""Ask Claude for brand form suggestions. The only module that imports anthropic.

Suggestions are plain text in the same shape as the form. They are cleaned with the form's own value rules before
they reach the browser, and the user still has to click each one to add it.
"""

from __future__ import annotations

from typing import Any, Literal, Protocol

import anthropic
from pydantic import BaseModel
from urlverify.profile import normalise_handle, value_problem

WORD_LISTS = ("confirm", "not_followed_by", "not_preceded_by", "not_in_sentence_with", "ignore_phrases")


class SuggestError(Exception):
    pass


class Suggester(Protocol):
    def __call__(self, brand_name: str, description: str) -> dict[str, Any]: ...


class SuggestedWord(BaseModel):
    word: str
    exact_case: bool
    closeness: Literal["close", "nearby", "paragraph"]
    confirm: list[str]
    not_followed_by: list[str]
    not_preceded_by: list[str]
    not_in_sentence_with: list[str]
    ignore_phrases: list[str]


class SuggestedPerson(BaseModel):
    name: str
    common: bool


class Suggestion(BaseModel):
    always: list[str]
    handles: list[str]
    everyday_word: SuggestedWord | None
    people: list[SuggestedPerson]
    notes: str


SYSTEM_PROMPT = """You help a media-monitoring analyst describe a brand so that a matcher can find mentions of it in
news articles and social posts. You never write regular expressions; you fill in plain-text form fields.

How the matcher works:
- It matches whole words only. "Safari" does not match inside "Safaris" or "safari-park".
- "always": names that can only mean this brand - full legal name, stock ticker, names in other scripts. Every
  match counts. Hashtag and handle forms of these are added automatically.
- "handles": extra social hashtags or handles without # or @ (letters, digits, underscore only).
- "everyday_word": set it only when the brand's short name is also a common word or another famous name
  (Safari, VIP, Basil, Genius). Otherwise null.
  - "exact_case": true when the brand is always capitalised and the common word usually is not.
  - "closeness": how near a confirming word must be: "close" (about 10 words), "nearby" (about 15 words),
    "paragraph".
  - "confirm": words that show the text is about this brand: its products, category, founders, stock exchange,
    sub-brands.
  - "not_followed_by" / "not_preceded_by": single words or short phrases that, directly after or before the word,
    mean it is NOT the brand ("browser" after Safari, "Apple" before Safari).
  - "not_in_sentence_with": names that, anywhere in the same sentence, mean it is NOT the brand (national parks
    for a Safari wildlife trip).
  - "ignore_phrases": exact phrases containing the word that are never the brand ("Ritz-Carlton" for Carlton).
    Each phrase must contain the word itself.
- "people": the brand's founders and senior leaders. Set "common" true for names that are common enough to belong
  to many other people, so they only count near the brand name.
- "notes": one or two sentences on what the brand name collides with.

Only suggest what you are confident about. Leave a list empty rather than guess. Names of people must be real
current or recent leaders of this exact company.

Example for "Safari - Indian luggage maker, founder Sudhir Jatia":
{"always": ["Safari Industries", "SAFARIND"], "handles": ["safaribags"],
 "everyday_word": {"word": "Safari", "exact_case": true, "closeness": "close",
   "confirm": ["luggage", "bag", "trolley", "suitcase", "backpack", "NSE", "BSE", "share price"],
   "not_followed_by": ["browser", "extension", "tab", "park", "tour", "lodge"],
   "not_preceded_by": ["Apple", "iOS", "macOS", "wildlife", "jungle", "jeep"],
   "not_in_sentence_with": ["Masai Mara", "Serengeti", "Kruger", "Ranthambore"], "ignore_phrases": []},
 "people": [{"name": "Sudhir Jatia", "common": false}],
 "notes": "Collides with Apple's Safari browser and wildlife safaris."}"""


class AnthropicSuggester:
    def __init__(self, api_key: str, model: str):
        self._client = anthropic.Anthropic(api_key=api_key, timeout=60.0, max_retries=0)
        self._model = model

    def __call__(self, brand_name: str, description: str) -> dict[str, Any]:
        content = f"Brand: {brand_name}"
        if description:
            content += f"\nAbout the brand: {description}"
        try:
            response = self._client.messages.parse(
                model=self._model,
                max_tokens=16000,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": content}],
                output_format=Suggestion,
            )
        except anthropic.APIConnectionError as e:
            raise SuggestError(f"Could not reach Claude ({e}). Check the connection and try again.") from e
        except anthropic.APIStatusError as e:
            raise SuggestError(f"Claude returned an error ({e.status_code}): {e.message}") from e
        if response.stop_reason == "refusal":
            raise SuggestError("Claude declined to make suggestions for this brand. Fill in the form by hand.")
        if response.parsed_output is None:
            raise SuggestError("Claude's reply could not be read. Try again.")
        return response.parsed_output.model_dump()


def _clean_list(values: list[str], *, handle: bool = False) -> tuple[list[str], int]:
    out: list[str] = []
    seen: set[str] = set()
    dropped = 0
    for v in values:
        v = normalise_handle(v) if handle else v.strip()
        key = v.casefold()
        if value_problem(v, handle=handle) or key in seen:
            dropped += 1
            continue
        seen.add(key)
        out.append(v)
    return out, dropped


def sanitize_suggestion(raw: dict[str, Any]) -> tuple[dict[str, Any], int]:
    """Apply the form's value rules; return the cleaned suggestion and how many entries were dropped."""
    dropped = 0
    always, n = _clean_list(raw.get("always") or [])
    dropped += n
    handles, n = _clean_list(raw.get("handles") or [], handle=True)
    dropped += n
    word = raw.get("everyday_word")
    if word is not None:
        if value_problem(word.get("word") or ""):
            word, dropped = None, dropped + 1
        else:
            word = {**word, "word": word["word"].strip()}
            for key in WORD_LISTS:
                word[key], n = _clean_list(word.get(key) or [])
                dropped += n
    people = []
    seen: set[str] = set()
    for person in raw.get("people") or []:
        name = (person.get("name") or "").strip()
        if value_problem(name) or name.casefold() in seen:
            dropped += 1
            continue
        seen.add(name.casefold())
        people.append({"name": name, "common": bool(person.get("common"))})
    notes = (raw.get("notes") or "").strip()
    return {"always": always, "handles": handles, "everyday_word": word, "people": people, "notes": notes}, dropped
```

- [ ] **Step 5: Wire it into deps, app, health and the router**

`deps.py`: add to imports `from .suggest import Suggester` and the field `suggester: Suggester | None = None` at the end of `Deps`.

`main.py`: add the parameter and build the default:

```python
from .suggest import AnthropicSuggester, Suggester
...
def create_app(
    settings: Settings | None = None,
    *,
    search_one: SearchFn | None = None,
    pipeline_run: PipelineRunFn | None = None,
    suggester: Suggester | None = None,
) -> FastAPI:
    ...
    if suggester is None and settings.anthropic_api_key:
        suggester = AnthropicSuggester(settings.anthropic_api_key, settings.suggest_model)
    deps = Deps(
        settings=settings, bs=bs, search_one=search_one or _default_search(settings, bs), pipeline_run=pipeline_run,
        suggester=suggester,
    )
```

`routes/health.py`, in the `result` dict: `"suggest_available": deps.suggester is not None,` (not part of `ok`).

`routes/brand_profiles.py`, append:

```python
from ..suggest import SuggestError, sanitize_suggestion


class SuggestBody(_Strict):
    brand_name: str
    description: str = ""


@router.post("/api/brand-profiles/suggest")
def suggest(request: Request, body: SuggestBody) -> dict:
    suggester = request.app.state.deps.suggester
    if suggester is None:
        raise ApiError(503, "Suggest is off: set ANTHROPIC_API_KEY in repscore-pipeline/.env and restart the app.")
    name = body.brand_name.strip()
    if not name:
        raise ApiError(422, "Type the brand name first.")
    try:
        raw = suggester(name, body.description.strip())
    except SuggestError as e:
        raise ApiError(502, str(e)) from None
    clean, dropped = sanitize_suggestion(raw)
    return {"suggestion": clean, "dropped": dropped}
```

(Move the `..suggest` import to the top of the file with the other imports.)

- [ ] **Step 6: Run API tests and lint**

Run: `cd ~/Desktop/niks/repscore-pipeline/api && uv run ruff format . && uv run pytest -q && uv run ruff check . && uv run pyright` (the plan's snippets are not pre-formatted; `ruff format` normalises them)
Expected: all PASS. If pyright cannot resolve `response.parsed_output` or `output_format`, check the installed SDK version (`uv pip show anthropic`) supports `messages.parse` (it must; upgrade with `uv add 'anthropic>=<current>'` if old). Do not make a live call to check.

- [ ] **Step 7: Document the key in `README.md`**

In the setup/configuration part of the pipeline README, add: "Suggest on the brand form needs `ANTHROPIC_API_KEY` in `repscore-pipeline/.env` (git-ignored). Optional: `PIPELINE_SUGGEST_MODEL` (default `claude-opus-5-5`). Without a key the button is disabled; everything else works."

- [ ] **Step 8: Commit**

```bash
cd ~/Desktop/niks/repscore-pipeline
git add api/pipeline_api/suggest.py api/pipeline_api/settings.py api/pipeline_api/deps.py api/pipeline_api/main.py api/pipeline_api/routes/health.py api/pipeline_api/routes/brand_profiles.py api/pyproject.toml api/uv.lock api/tests/test_suggest.py .gitignore e2e/start-api.sh README.md
git commit -m "feat: Claude suggestions for the simple brand form"
```

---

### Task 7: Web types, API client and profile helpers

**Files:**
- Modify: `web/lib/types.ts`, `web/lib/api.ts`
- Create: `web/lib/brandProfile.ts`
- Test: `web/lib/brandProfile.test.ts`

**Interfaces:**
- Consumes: the JSON shapes from Tasks 5-6.
- Produces (used by Tasks 8-10):
  - types `Closeness`, `EverydayWord`, `ProfileBrand`, `Person`, `BrandProfile`, `ProfileWarning`, `Suggestion`; `BrandSet` gains `managed: boolean; stale: boolean`; `Health` gains `suggest_available: boolean`
  - `api.brandProfile(name)`, `api.saveBrandProfile(name, profile, create)`, `api.previewBrandProfile(profile)`, `api.testBrandProfile(profile, text)`, `api.suggestBrandProfile(brandName, description)`, `api.detachBrandProfile(name)`
  - `emptyWord(word?: string): EverydayWord`, `emptyBrand(): ProfileBrand`, `emptyProfile(): BrandProfile`, `splitEntries(raw: string): string[]`, `addValues(list: string[], values: string[]): string[]`, `missingValues(list: string[], values: string[]): string[]`, `cleanProfile(p: BrandProfile): BrandProfile`, `CLOSENESS_LABELS: Record<Closeness, string>`

- [ ] **Step 1: Write the failing test**

Create `web/lib/brandProfile.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { addValues, cleanProfile, emptyBrand, emptyProfile, emptyWord, missingValues, splitEntries } from "./brandProfile";

describe("brandProfile helpers", () => {
  it("splits typed or pasted entries on commas and new lines", () => {
    expect(splitEntries(" luggage, bag\ntrolley ,, ")).toEqual(["luggage", "bag", "trolley"]);
  });

  it("adds values without case-insensitive duplicates, keeping order", () => {
    expect(addValues(["Luggage"], ["luggage", "bag", "Bag", "tab"])).toEqual(["Luggage", "bag", "tab"]);
  });

  it("reports which suggestions are not in the list yet", () => {
    expect(missingValues(["Luggage"], ["luggage", "bag"])).toEqual(["bag"]);
  });

  it("starts with one empty brand and no people", () => {
    expect(emptyProfile()).toEqual({ brands: [emptyBrand()], people: [] });
    expect(emptyWord("Safari").word).toBe("Safari");
    expect(emptyWord().closeness).toBe("nearby");
    expect(emptyWord().exact_case).toBe(true);
  });

  it("trims names and values before sending", () => {
    const p = emptyProfile();
    p.brands[0] = { ...p.brands[0], name: " Safari ", always: [" Safari Industries "], everyday_word: { ...emptyWord(" Safari "), confirm: [" bag "] } };
    p.people = [{ name: " Jo ", common: false }];
    const c = cleanProfile(p);
    expect(c.brands[0].name).toBe("Safari");
    expect(c.brands[0].always).toEqual(["Safari Industries"]);
    expect(c.brands[0].everyday_word?.word).toBe("Safari");
    expect(c.brands[0].everyday_word?.confirm).toEqual(["bag"]);
    expect(c.people[0].name).toBe("Jo");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/Desktop/niks/repscore-pipeline/web && npm test`
Expected: FAIL, cannot resolve `./brandProfile`

- [ ] **Step 3: Add the types to `web/lib/types.ts`**

Change `Health` and `BrandSet` and add the profile types next to `BrandRule`:

```ts
export interface Health {
  ok: boolean;
  company_monitor: boolean;
  url_verification: boolean;
  verifier_config_error: string | null;
  keys: Record<Provider, string | null>;
  chromium: boolean;
  suggest_available: boolean;
}
```

```ts
export interface BrandSet { name: string; rules: BrandRule[]; managed: boolean; stale: boolean }
export type Closeness = "close" | "nearby" | "paragraph";
export interface EverydayWord {
  word: string;
  exact_case: boolean;
  closeness: Closeness;
  confirm: string[];
  not_followed_by: string[];
  not_preceded_by: string[];
  not_in_sentence_with: string[];
  ignore_phrases: string[];
}
export interface ProfileBrand { name: string; always: string[]; handles: string[]; everyday_word: EverydayWord | null }
export interface Person { name: string; common: boolean }
export interface BrandProfile { brands: ProfileBrand[]; people: Person[] }
export interface ProfileWarning { brand: number | null; field: string; message: string }
export interface Suggestion {
  always: string[];
  handles: string[];
  everyday_word: EverydayWord | null;
  people: Person[];
  notes: string;
}
```

- [ ] **Step 4: Add the client calls to `web/lib/api.ts`**

Extend the type import with `BrandProfile, ProfileWarning, Suggestion` and add to `api`:

```ts
  brandProfile: (name: string) => request<{ profile: BrandProfile }>(`/api/brand-profiles/${encodeURIComponent(name)}`),
  saveBrandProfile: (name: string, profile: BrandProfile, create = false) =>
    request<{ name: string; backup: string; warnings: ProfileWarning[] }>(`/api/brand-profiles/${encodeURIComponent(name)}`, {
      method: "PUT",
      body: JSON.stringify({ profile, create }),
    }),
  previewBrandProfile: (profile: BrandProfile) =>
    post<{ rules: BrandRule[]; warnings: ProfileWarning[] }>("/api/brand-profiles/preview", { profile }),
  testBrandProfile: (profile: BrandProfile, text: string) => post<TryResult>("/api/brand-profiles/test", { profile, text }),
  suggestBrandProfile: (brandName: string, description: string) =>
    post<{ suggestion: Suggestion; dropped: number }>("/api/brand-profiles/suggest", { brand_name: brandName, description }),
  detachBrandProfile: (name: string) =>
    request<{ name: string; backup: string }>(`/api/brand-profiles/${encodeURIComponent(name)}/profile`, { method: "DELETE" }),
```

- [ ] **Step 5: Write `web/lib/brandProfile.ts`**

```ts
import type { BrandProfile, Closeness, EverydayWord, ProfileBrand } from "./types";

export const CLOSENESS_LABELS: Record<Closeness, string> = {
  close: "Close (about 10 words)",
  nearby: "Nearby (about 15 words)",
  paragraph: "Same paragraph",
};

export const WORD_LISTS = ["confirm", "not_followed_by", "not_preceded_by", "not_in_sentence_with", "ignore_phrases"] as const;
export type WordList = (typeof WORD_LISTS)[number];

export const emptyWord = (word = ""): EverydayWord => ({
  word,
  exact_case: true,
  closeness: "nearby",
  confirm: [],
  not_followed_by: [],
  not_preceded_by: [],
  not_in_sentence_with: [],
  ignore_phrases: [],
});

export const emptyBrand = (): ProfileBrand => ({ name: "", always: [], handles: [], everyday_word: null });

export const emptyProfile = (): BrandProfile => ({ brands: [emptyBrand()], people: [] });

export function splitEntries(raw: string): string[] {
  return raw.split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
}

export function addValues(list: string[], values: string[]): string[] {
  const seen = new Set(list.map((v) => v.toLowerCase()));
  const out = [...list];
  for (const v of values) {
    const key = v.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(v);
    }
  }
  return out;
}

export function missingValues(list: string[], values: string[]): string[] {
  const seen = new Set(list.map((v) => v.toLowerCase()));
  return values.filter((v) => !seen.has(v.toLowerCase()));
}

const trimAll = (xs: string[]) => xs.map((x) => x.trim());

export function cleanProfile(p: BrandProfile): BrandProfile {
  return {
    brands: p.brands.map((b) => ({
      name: b.name.trim(),
      always: trimAll(b.always),
      handles: trimAll(b.handles),
      everyday_word: b.everyday_word && {
        ...b.everyday_word,
        word: b.everyday_word.word.trim(),
        ...Object.fromEntries(WORD_LISTS.map((k) => [k, trimAll(b.everyday_word![k])])),
      },
    })),
    people: p.people.map((x) => ({ name: x.name.trim(), common: x.common })),
  };
}
```

- [ ] **Step 6: Run tests, types and lint**

Run: `cd ~/Desktop/niks/repscore-pipeline/web && npm test && npx tsc --noEmit && npm run lint`
Expected: PASS. `tsc` may flag places that build a `BrandSet` without `managed`/`stale` (for example test fixtures); add `managed: false, stale: false` there.

- [ ] **Step 7: Commit**

```bash
cd ~/Desktop/niks/repscore-pipeline
git add web/lib/types.ts web/lib/api.ts web/lib/brandProfile.ts web/lib/brandProfile.test.ts
git commit -m "feat: web types and helpers for brand profiles"
```

---

### Task 8: Split the Brands page into a workspace, raw editor and shared test panel

A refactor with no new behaviour except the sidebar's two "new" buttons and the "Form" badge, so Task 9 can drop the form in. The existing e2e test is the safety net.

**Files:**
- Create: `web/components/BrandWorkspace.tsx`, `web/components/BrandTryPanel.tsx`
- Rename + modify: `web/components/BrandEditor.tsx` -> `web/components/RawSetEditor.tsx`
- Modify: `web/app/brands/page.tsx`, `e2e/tests/brands.spec.ts`

**Interfaces:**
- Consumes: `api.brands`, `api.health`, `BrandSet`, `TryResult`.
- Produces (used by Tasks 9-10):
  - `BrandTryPanel({ run: (text: string) => Promise<TryResult> })` - sample box, "Try rules" button, Counted / Not counted lists (same test ids `try-hits`, `try-excluded` as today)
  - `RawSetEditor({ set: BrandSet | null, existingNames: string[], onSaved: (name: string) => void, onDeleted: () => void, onDirtyChange: (dirty: boolean) => void })`
  - `BrandWorkspace()` holding `sets` and `selection: { kind: "new-form" } | { kind: "new-raw" } | { kind: "set"; name: string }`; renders `RawSetEditor` for raw sets and `new-raw`, and a placeholder `<p>` for managed sets and `new-form` until Task 9 (Task 9 adds `suggestAvailable` from `/api/health`)

- [ ] **Step 1: Read the Next.js docs relevant to client components**

Run: `ls ~/Desktop/niks/repscore-pipeline/web/node_modules/next/dist/docs/01-app` and read the client components / "use client" guide. Note anything that differs from what the existing components do; follow the existing components where they already work.

- [ ] **Step 2: Update the e2e test for the new raw-set entry point**

In `e2e/tests/brands.spec.ts`, change the first click to the raw entry point:

```ts
  await page.getByRole("button", { name: "New raw set" }).click();
```

and after the save add:

```ts
  await expect(page.getByRole("button", { name, exact: true })).not.toContainText("Form");
```

Run: `cd ~/Desktop/niks/repscore-pipeline/e2e && npx playwright test brands.spec.ts`
Expected: FAIL (no "New raw set" button yet)

- [ ] **Step 3: Extract `BrandTryPanel.tsx`**

Move the "Try these rules" block out of the old editor into `web/components/BrandTryPanel.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/api";
import type { TryResult } from "@/lib/types";

export function BrandTryPanel({ run }: { run: (text: string) => Promise<TryResult> }) {
  const [sample, setSample] = useState("");
  const [tried, setTried] = useState<TryResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function tryRules() {
    setError(null);
    try {
      setTried(await run(sample));
    } catch (e) {
      setTried(null);
      setError(errorMessage(e));
    }
  }

  return (
    <div className="space-y-3 rounded-md border p-4">
      <h3 className="text-base">Try these rules</h3>
      <div className="space-y-1.5">
        <Label htmlFor="sample">Sample text</Label>
        <Textarea
          id="sample"
          value={sample}
          onChange={(e) => setSample(e.target.value)}
          placeholder="Paste a sentence or paragraph from a real page."
          className="field-sizing-fixed h-32 resize-y"
        />
      </div>
      <Button variant="outline" disabled={!sample.trim()} onClick={tryRules}>Try rules</Button>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {tried && (
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-sm font-semibold">Counted ({tried.hits.length})</p>
            <ul data-testid="try-hits" className="mt-1 space-y-1 text-sm">
              {tried.hits.map((h) => (
                <li key={`${h.brand}-${h.offset}`}>
                  <span className="font-medium">{h.brand}</span>: {h.snippet}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-sm font-semibold">Not counted ({tried.excluded.length})</p>
            <ul data-testid="try-excluded" className="mt-1 space-y-1 text-sm">
              {tried.excluded.map((x) => (
                <li key={`${x.brand}-${x.offset}`}>&quot;{x.text}&quot; - {x.reason}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Turn `BrandEditor.tsx` into `RawSetEditor.tsx`**

Run: `cd ~/Desktop/niks/repscore-pipeline && git mv web/components/BrandEditor.tsx web/components/RawSetEditor.tsx`

Then edit `RawSetEditor.tsx`:
- Rename the component to `RawSetEditor` with the props in the Interfaces block.
- Remove `sets`, `load`, the list `useEffect`, `open`/`openNow`, the `<aside>` sidebar and the outer two-column grid; the root becomes `<section className="space-y-6">`.
- Initialise `name`/`rules`/`savedSnapshot` from `props.set` (`set ? set.rules.map(toDraft) : [emptyDraft()]`). `current` becomes `set?.name ?? null` (the workspace remounts the editor with a `key` when the selection changes, so no reset logic is needed).
- Report dirtiness: `useEffect(() => onDirtyChange(snapshotOf(name, rules) !== savedSnapshot), [name, rules, savedSnapshot, onDirtyChange]);`
- In `save`: use `existingNames.includes(trimmed)` for the duplicate check; after success set the snapshot and call `onSaved(res.name)`. Keep the "Saved. The previous config.yaml was backed up to ..." status.
- In `remove`: after success call `onDeleted()`.
- Replace the inline try block with `<BrandTryPanel run={(text) => api.testBrand({ text, rules: rules.map(fromDraft) })} />` and delete the `sample`/`tried`/`tryError` state.
- Keep every label and aria-label exactly as today (the e2e test depends on them).

- [ ] **Step 5: Write `BrandWorkspace.tsx`**

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { RawSetEditor } from "@/components/RawSetEditor";
import { api, errorMessage } from "@/lib/api";
import type { BrandSet } from "@/lib/types";
import { cn } from "@/lib/utils";

export type Selection = { kind: "new-form" } | { kind: "new-raw" } | { kind: "set"; name: string };

export function BrandWorkspace() {
  const [sets, setSets] = useState<BrandSet[]>([]);
  const [selection, setSelection] = useState<Selection>({ kind: "new-form" });
  const [version, setVersion] = useState(0); // remounts the editor after save/delete
  const [error, setError] = useState<string | null>(null);
  const dirty = useRef(false);
  const onDirtyChange = useCallback((d: boolean) => {
    dirty.current = d;
  }, []);

  const load = useCallback(async () => {
    try {
      setSets((await api.brands()).sets);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    let alive = true;
    api.brands().then((r) => alive && setSets(r.sets)).catch((e) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, []);

  function select(next: Selection) {
    if (dirty.current && !window.confirm("Discard unsaved changes?")) return;
    dirty.current = false;
    setSelection(next);
    setVersion((v) => v + 1);
  }

  async function afterSave(name: string) {
    dirty.current = false;
    await load();
    setSelection({ kind: "set", name });
    setVersion((v) => v + 1);
  }

  async function afterDelete() {
    dirty.current = false;
    await load();
    setSelection({ kind: "new-form" });
    setVersion((v) => v + 1);
  }

  const current = selection.kind === "set" ? sets.find((s) => s.name === selection.name) ?? null : null;
  const names = sets.map((s) => s.name);
  const key = `${selection.kind}-${current?.name ?? ""}-${version}`;

  return (
    <div className="grid gap-8 lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="space-y-2">
        <Button variant="outline" className="w-full" onClick={() => select({ kind: "new-form" })}>New set</Button>
        <Button variant="ghost" size="sm" className="w-full text-neutral-600" onClick={() => select({ kind: "new-raw" })}>
          New raw set
        </Button>
        <ul className="space-y-1">
          {sets.map((s) => (
            <li key={s.name}>
              <button
                type="button"
                onClick={() => select({ kind: "set", name: s.name })}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm",
                  current?.name === s.name ? "bg-brand-navy text-white" : "hover:bg-neutral-100",
                )}
              >
                <span className="truncate">{s.name}</span>
                {s.managed && (
                  <span
                    className={cn(
                      "shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium",
                      current?.name === s.name ? "bg-white/20 text-white" : "bg-neutral-100 text-neutral-600",
                    )}
                  >
                    Form
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </aside>
      <div className="min-w-0">
        {error && <p role="alert" className="mb-4 text-sm text-red-700">{error}</p>}
        {selection.kind === "new-raw" || (current && !current.managed) ? (
          <RawSetEditor key={key} set={current} existingNames={names} onSaved={afterSave} onDeleted={afterDelete} onDirtyChange={onDirtyChange} />
        ) : (
          <p key={key} className="text-sm text-neutral-600" data-testid="form-placeholder">
            The simple form arrives in the next task.
          </p>
        )}
      </div>
    </div>
  );
}
```

(The placeholder branch is replaced in Task 9; it must not ship on its own past this task's commit.)

- [ ] **Step 6: Point the page at the workspace**

In `web/app/brands/page.tsx` replace `BrandEditor` with `BrandWorkspace` (import from `@/components/BrandWorkspace`).

- [ ] **Step 7: Run checks**

Run: `cd ~/Desktop/niks/repscore-pipeline/web && npm test && npx tsc --noEmit && npm run lint` then `cd ../e2e && npx playwright test brands.spec.ts`
Expected: PASS on both viewports.

- [ ] **Step 8: Commit**

```bash
cd ~/Desktop/niks/repscore-pipeline
git add web/components/BrandWorkspace.tsx web/components/BrandTryPanel.tsx web/components/RawSetEditor.tsx web/app/brands/page.tsx e2e/tests/brands.spec.ts
git commit -m "refactor: split the Brands page into a workspace, raw set editor and shared test panel"
```

---

### Task 9: The simple form

**Files:**
- Create: `web/components/TagInput.tsx`, `web/components/BrandProfileForm.tsx`
- Modify: `web/components/BrandWorkspace.tsx` (render the form)
- Test: `e2e/tests/brands-form.spec.ts`

**Interfaces:**
- Consumes: Task 7 helpers and API calls; `BrandTryPanel`, `BrandRules` (existing read-only rule list: check its props in `web/components/BrandRules.tsx` before use), `AlertDialog*`, `Button`, `Input`, `Label`, `NativeSelect`.
- Produces (used by Task 10):
  - `TagInput({ id, label, ariaLabel?, values, onChange, placeholder?, hint?, children? })` - `label` is the visible text, `ariaLabel` (defaults to `label`) is the input's accessible name used by tests; `children` renders below the field (Task 10 puts suggestion chips there)
  - `BrandProfileForm({ name: string | null, initial: BrandProfile, stale: boolean, existingNames: string[], suggestAvailable: boolean, onSaved(name), onDeleted(), onDetached(name), onDirtyChange(dirty) })`
  - Accessible names used by tests: `Set name`, `Brand {n} name`, `Brand {n} names that always mean this brand`, `Brand {n} hashtags or handles`, `Brand {n} short name is also an everyday word` (checkbox), `Brand {n} everyday word`, `Brand {n} match exact capitals`, `Brand {n} how close`, `Brand {n} confirming words`, `Brand {n} not followed by`, `Brand {n} not preceded by`, `Brand {n} not in the same sentence as`, `Brand {n} phrases to ignore`, `Person {n} name`, `Person {n} common name`, buttons `Add brand`, `Add person`, `Save set`, `Delete set`, `Switch to advanced editing`, toggle `Show generated rules`

- [ ] **Step 1: Write the failing e2e test**

Create `e2e/tests/brands-form.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import { createRun, shot } from "./helpers";

async function addTag(page: import("@playwright/test").Page, label: string, value: string) {
  await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByLabel(label, { exact: true }).press("Enter");
}

test("create, try, save, reload and edit a brand set from the simple form", async ({ page }, info) => {
  const name = `zeta-${info.project.name}`;
  await page.goto("/brands");
  await page.getByRole("button", { name: "New set", exact: true }).click();
  await page.getByLabel("Set name").fill(name);
  await page.getByLabel("Brand 1 name").fill("Zeta");
  await addTag(page, "Brand 1 names that always mean this brand", "Zeta Industries");
  await page.getByLabel("Brand 1 short name is also an everyday word").check();
  await page.getByLabel("Brand 1 everyday word").fill("Zeta");
  await expect(page.getByText("so every use of the word counts")).toBeVisible(); // preview warning
  await addTag(page, "Brand 1 confirming words", "luggage");
  await addTag(page, "Brand 1 not followed by", "browser");
  await expect(page.getByText("so every use of the word counts")).toHaveCount(0);

  await page.getByLabel("Sample text").fill("Zeta Industries rose. Open it in Zeta browser. Zeta luggage is light.");
  await page.getByRole("button", { name: "Try rules" }).click();
  await expect(page.getByTestId("try-hits").getByRole("listitem")).toHaveCount(2);
  await expect(page.getByTestId("try-excluded")).toContainText("Not counted: followed by browser");
  await expect(page.getByTestId("try-excluded")).not.toContainText("(?i:");

  await page.getByRole("button", { name: "Show generated rules" }).click();
  await expect(page.getByTestId("generated-rules")).toContainText("Zeta");

  await page.getByRole("button", { name: "Save set" }).click();
  await expect(page.getByRole("status")).toContainText("Saved");
  await shot(page, "brands-form", info);

  await page.reload();
  const setButton = page.getByRole("button", { name: new RegExp(`^${name}`) });
  await expect(setButton).toContainText("Form");
  await setButton.click();
  await expect(page.getByLabel("Brand 1 name")).toHaveValue("Zeta");
  await expect(page.getByRole("button", { name: "Remove browser" })).toBeVisible();
  await addTag(page, "Brand 1 confirming words", "trolley");
  await page.getByRole("button", { name: "Save set" }).click();
  await expect(page.getByRole("status")).toContainText("Saved");

  // The set is offered for verification like any other.
  await createRun(page, [`zeta luggage f-${info.project.name}`]);
  await expect(page.getByTestId("search-progress")).toContainText("Search finished");
  await page.getByTestId("continue-to-verify").click();
  await expect(page.getByLabel("Brand set").locator("option", { hasText: name })).toHaveCount(1);

  await page.goto("/brands");
  await page.getByRole("button", { name: new RegExp(`^${name}`) }).click();
  await page.getByRole("button", { name: "Delete set" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("button", { name: new RegExp(`^${name}`) })).toHaveCount(0);
});

test("switching a form set to advanced editing keeps its rules", async ({ page }, info) => {
  const name = `eta-${info.project.name}`;
  await page.goto("/brands");
  await page.getByRole("button", { name: "New set", exact: true }).click();
  await page.getByLabel("Set name").fill(name);
  await page.getByLabel("Brand 1 name").fill("Eta");
  await addTag(page, "Brand 1 names that always mean this brand", "Eta Labs");
  await page.getByRole("button", { name: "Save set" }).click();
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "Switch to advanced editing" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Switch" }).click();
  await expect(page.getByLabel("Rule 1 pattern")).toHaveValue(/Eta/);
  await expect(page.getByRole("button", { name, exact: true })).not.toContainText("Form");
});

test("the form refuses a raw set's name", async ({ page }) => {
  await page.goto("/brands");
  await page.getByRole("button", { name: "New set", exact: true }).click();
  await page.getByLabel("Set name").fill("mokobara");
  await page.getByLabel("Brand 1 name").fill("Mokobara");
  await addTag(page, "Brand 1 names that always mean this brand", "Mokobara");
  await page.getByRole("button", { name: "Save set" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "already exists" })).toBeVisible();
});
```

Check the e2e verifier fixture (`e2e/fixtures/verifier-config.yaml`) has a raw `mokobara` set; if it uses another name, use that.

Run: `cd ~/Desktop/niks/repscore-pipeline/e2e && npx playwright test brands-form.spec.ts`
Expected: FAIL (no form)

- [ ] **Step 2: Write `TagInput.tsx`**

```tsx
"use client";

import { type ReactNode, useState } from "react";
import { Label } from "@/components/ui/label";
import { addValues, splitEntries } from "@/lib/brandProfile";

export function TagInput({
  id, label, ariaLabel, values, onChange, placeholder, hint, children,
}: {
  id: string;
  label: string;
  ariaLabel?: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  hint?: ReactNode;
  children?: ReactNode;
}) {
  const [text, setText] = useState("");

  function commit(raw: string) {
    const entries = splitEntries(raw);
    if (entries.length) onChange(addValues(values, entries));
    setText("");
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-lg border border-input px-2 py-1 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50">
        {values.map((v) => (
          <span key={v} className="inline-flex max-w-full items-center gap-1 rounded-md bg-neutral-100 py-0.5 pr-1 pl-2 text-sm">
            <span className="truncate">{v}</span>
            <button
              type="button"
              aria-label={`Remove ${v}`}
              onClick={() => onChange(values.filter((x) => x !== v))}
              className="rounded px-1 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900"
            >
              ×
            </button>
          </span>
        ))}
        <input
          id={id}
          aria-label={ariaLabel ?? label}
          value={text}
          placeholder={values.length ? undefined : placeholder}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commit(text);
            } else if (e.key === "Backspace" && !text && values.length) {
              onChange(values.slice(0, -1));
            }
          }}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData("text");
            if (/[\n,]/.test(pasted)) {
              e.preventDefault();
              commit(text + pasted);
            }
          }}
          onBlur={() => commit(text)}
          className="min-w-32 flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-neutral-400"
        />
      </div>
      {hint && <p className="text-xs text-neutral-500">{hint}</p>}
      {children}
    </div>
  );
}
```

The input's `aria-label` (`ariaLabel`, e.g. "Brand 1 confirming words") is what `getByLabel(..., { exact: true })` finds in the tests; the visible `Label` shows the friendly text (e.g. "Words that confirm it's the brand").

- [ ] **Step 3: Write `BrandProfileForm.tsx`**

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { BrandRules } from "@/components/BrandRules";
import { BrandTryPanel } from "@/components/BrandTryPanel";
import { NativeSelect } from "@/components/NativeSelect";
import { TagInput } from "@/components/TagInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, errorMessage } from "@/lib/api";
import { CLOSENESS_LABELS, cleanProfile, emptyBrand, emptyWord } from "@/lib/brandProfile";
import type { BrandProfile, BrandRule, Closeness, EverydayWord, ProfileBrand, ProfileWarning } from "@/lib/types";

type Props = {
  name: string | null; // null = new set
  initial: BrandProfile;
  stale: boolean;
  existingNames: string[];
  suggestAvailable: boolean;
  onSaved: (name: string) => void;
  onDeleted: () => void;
  onDetached: (name: string) => void;
  onDirtyChange: (dirty: boolean) => void;
};

export function BrandProfileForm({ name, initial, stale, existingNames, suggestAvailable, onSaved, onDeleted, onDetached, onDirtyChange }: Props) {
  const [setName, setSetName] = useState(name ?? "");
  const [profile, setProfile] = useState<BrandProfile>(initial);
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify({ n: name ?? "", p: initial }));
  const [warnings, setWarnings] = useState<ProfileWarning[]>([]);
  const [rules, setRules] = useState<BrandRule[]>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"delete" | "detach" | null>(null);
  const [busy, setBusy] = useState(false);

  const snapshot = JSON.stringify({ n: setName, p: profile });
  useEffect(() => onDirtyChange(snapshot !== savedSnapshot), [snapshot, savedSnapshot, onDirtyChange]);

  // Preview on every change (debounced): warnings next to fields, and the generated rules.
  const clean = useMemo(() => cleanProfile(profile), [profile]);
  useEffect(() => {
    const t = setTimeout(() => {
      api
        .previewBrandProfile(clean)
        .then((r) => {
          setWarnings(r.warnings);
          setRules(r.rules);
          setPreviewError(null);
        })
        .catch((e) => {
          setWarnings([]);
          setRules([]);
          setPreviewError(errorMessage(e));
        });
    }, 400);
    return () => clearTimeout(t);
  }, [clean]);

  const updateBrand = (i: number, patch: Partial<ProfileBrand>) =>
    setProfile((p) => ({ ...p, brands: p.brands.map((b, j) => (j === i ? { ...b, ...patch } : b)) }));
  const updateWord = (i: number, patch: Partial<EverydayWord>) =>
    setProfile((p) => ({
      ...p,
      brands: p.brands.map((b, j) => (j === i && b.everyday_word ? { ...b, everyday_word: { ...b.everyday_word, ...patch } } : b)),
    }));
  const warningsFor = (i: number | null, field: string) =>
    warnings.filter((w) => w.brand === i && w.field === field).map((w) => (
      <p key={w.message} className="text-xs text-amber-800">{w.message}</p>
    ));

  async function save() {
    setError(null);
    setSaved(null);
    const n = setName.trim();
    if (name === null && existingNames.includes(n)) {
      setError(`A set named ${n} already exists - pick another name.`);
      return;
    }
    try {
      const res = await api.saveBrandProfile(n, clean, name === null);
      setSavedSnapshot(JSON.stringify({ n: setName, p: profile }));
      setSaved(`Saved. The previous config.yaml was backed up to ${res.backup.split("/").pop()}.`);
      onSaved(res.name);
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  async function confirmDialog() {
    if (!name || !dialog) return;
    setBusy(true);
    try {
      if (dialog === "delete") {
        await api.deleteBrand(name);
        onDeleted();
      } else {
        await api.detachBrandProfile(name);
        onDetached(name);
      }
      setDialog(null);
    } catch (e) {
      setError(errorMessage(e));
      setDialog(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-6">
      {stale && (
        <p role="note" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          These rules differ from what the form would produce, probably from a hand edit of config.yaml. Saving will replace them with the form&apos;s version.
        </p>
      )}
      <div className="max-w-sm space-y-1.5">
        <Label htmlFor="set-name">Set name</Label>
        <Input id="set-name" value={setName} disabled={name !== null} onChange={(e) => setSetName(e.target.value)} placeholder="lowercase, e.g. safari" />
      </div>

      <ol className="space-y-4">
        {profile.brands.map((b, i) => {
          const n = i + 1;
          const w = b.everyday_word;
          return (
            <li key={i} className="space-y-4 rounded-md border p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-base">{i === 0 ? "Brand" : `Brand ${n}`}</h3>
                {profile.brands.length > 1 && (
                  <Button variant="ghost" size="sm" onClick={() => setProfile((p) => ({ ...p, brands: p.brands.filter((_, j) => j !== i) }))}>
                    Remove brand
                  </Button>
                )}
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor={`b${i}-name`}>Brand name</Label>
                  <Input id={`b${i}-name`} aria-label={`Brand ${n} name`} value={b.name} onChange={(e) => updateBrand(i, { name: e.target.value })} placeholder="e.g. Safari" />
                </div>
                <TagInput
                  id={`b${i}-handles`}
                  label="Extra hashtags or handles"
                  ariaLabel={`Brand ${n} hashtags or handles`}
                  values={b.handles}
                  onChange={(v) => updateBrand(i, { handles: v })}
                  placeholder="e.g. safaribags"
                  hint="Without # or @. Hashtags of the names below are added automatically."
                />
              </div>
              <TagInput
                id={`b${i}-always`}
                label="Names that always mean this brand"
                ariaLabel={`Brand ${n} names that always mean this brand`}
                values={b.always}
                onChange={(v) => updateBrand(i, { always: v })}
                placeholder="Full name, ticker, other scripts - press Enter after each"
              />
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  aria-label={`Brand ${n} short name is also an everyday word`}
                  className="size-4 accent-[#000c66]"
                  checked={w !== null}
                  onChange={(e) => updateBrand(i, { everyday_word: e.target.checked ? emptyWord(b.name.trim()) : null })}
                />
                Is the short name also an everyday word? (like Safari, VIP, Basil)
              </label>
              {w && (
                <div className="space-y-4 border-l-2 border-neutral-200 pl-4">
                  <div className="flex flex-wrap items-end gap-6">
                    <div className="w-56 space-y-1.5">
                      <Label htmlFor={`b${i}-word`}>The everyday word</Label>
                      <Input id={`b${i}-word`} aria-label={`Brand ${n} everyday word`} value={w.word} onChange={(e) => updateWord(i, { word: e.target.value })} />
                    </div>
                    <label className="flex h-9 items-center gap-2 text-sm">
                      <input type="checkbox" aria-label={`Brand ${n} match exact capitals`} className="size-4 accent-[#000c66]" checked={w.exact_case} onChange={(e) => updateWord(i, { exact_case: e.target.checked })} />
                      Match exact capitals
                    </label>
                    <div className="w-64 space-y-1.5">
                      <Label htmlFor={`b${i}-close`}>How close confirming words must be</Label>
                      <NativeSelect id={`b${i}-close`} aria-label={`Brand ${n} how close`} value={w.closeness} onChange={(e) => updateWord(i, { closeness: e.target.value as Closeness })}>
                        {(Object.keys(CLOSENESS_LABELS) as Closeness[]).map((c) => (
                          <option key={c} value={c}>{CLOSENESS_LABELS[c]}</option>
                        ))}
                      </NativeSelect>
                    </div>
                  </div>
                  <TagInput id={`b${i}-confirm`} label="Words that confirm it's the brand" ariaLabel={`Brand ${n} confirming words`} values={w.confirm} onChange={(v) => updateWord(i, { confirm: v })} placeholder="e.g. luggage, bag, NSE" hint="Plurals are matched automatically. Brand names and people in this set also count.">
                    {warningsFor(i, "confirm")}
                  </TagInput>
                  <div className="grid gap-4 md:grid-cols-2">
                    <TagInput id={`b${i}-after`} label="Not the brand when followed by" ariaLabel={`Brand ${n} not followed by`} values={w.not_followed_by} onChange={(v) => updateWord(i, { not_followed_by: v })} placeholder="e.g. browser, tour" />
                    <TagInput id={`b${i}-before`} label="Not the brand when preceded by" ariaLabel={`Brand ${n} not preceded by`} values={w.not_preceded_by} onChange={(v) => updateWord(i, { not_preceded_by: v })} placeholder="e.g. Apple, jeep" />
                    <TagInput id={`b${i}-sentence`} label="Not the brand in the same sentence as" ariaLabel={`Brand ${n} not in the same sentence as`} values={w.not_in_sentence_with} onChange={(v) => updateWord(i, { not_in_sentence_with: v })} placeholder="e.g. Serengeti, Kruger" />
                    <TagInput id={`b${i}-phrases`} label="Exact phrases to ignore" ariaLabel={`Brand ${n} phrases to ignore`} values={w.ignore_phrases} onChange={(v) => updateWord(i, { ignore_phrases: v })} placeholder="e.g. Ritz-Carlton">
                      {warningsFor(i, "ignore_phrases")}
                    </TagInput>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <Button variant="outline" onClick={() => setProfile((p) => ({ ...p, brands: [...p.brands, emptyBrand()] }))}>Add brand</Button>

      <div className="space-y-3 rounded-md border p-4">
        <h3 className="text-base">People</h3>
        <p className="text-sm text-neutral-600">Founders and leaders. Their names count as mentions of the brand.</p>
        {profile.people.map((x, i) => (
          <div key={i} className="flex flex-wrap items-center gap-4">
            <Input
              aria-label={`Person ${i + 1} name`}
              value={x.name}
              onChange={(e) => setProfile((p) => ({ ...p, people: p.people.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)) }))}
              className="w-64"
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                aria-label={`Person ${i + 1} common name`}
                className="size-4 accent-[#000c66]"
                checked={x.common}
                onChange={(e) => setProfile((p) => ({ ...p, people: p.people.map((y, j) => (j === i ? { ...y, common: e.target.checked } : y)) }))}
              />
              Common name - only count when the brand is mentioned nearby
            </label>
            <Button variant="ghost" size="sm" onClick={() => setProfile((p) => ({ ...p, people: p.people.filter((_, j) => j !== i) }))}>Remove</Button>
          </div>
        ))}
        <Button variant="outline" size="sm" onClick={() => setProfile((p) => ({ ...p, people: [...p.people, { name: "", common: false }] }))}>Add person</Button>
      </div>

      <div className="space-y-2">
        <Button variant="ghost" size="sm" aria-expanded={showRules} onClick={() => setShowRules((s) => !s)}>
          {showRules ? "Hide generated rules" : "Show generated rules"}
        </Button>
        {showRules && (
          <div data-testid="generated-rules" className="rounded-md border bg-neutral-50 p-3">
            {previewError ? <p className="text-sm text-neutral-600">{previewError}</p> : <BrandRules rules={rules} />}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={save} disabled={!setName.trim()}>Save set</Button>
        {name && <Button variant="outline" onClick={() => setDialog("delete")}>Delete set</Button>}
        {name && <Button variant="ghost" onClick={() => setDialog("detach")}>Switch to advanced editing</Button>}
      </div>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {saved && <p role="status" className="text-sm text-green-800">{saved}</p>}

      <BrandTryPanel run={(text) => api.testBrandProfile(clean, text)} />

      <AlertDialog open={dialog !== null} onOpenChange={(o) => !busy && !o && setDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{dialog === "delete" ? `Delete brand set "${name}"?` : `Switch "${name}" to advanced editing?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {dialog === "delete"
                ? "It is removed from config.yaml (a backup is kept). Finished verifications keep the copy of the rules they used."
                : "The form answers are discarded and the set becomes raw regex rules, edited in the advanced editor. The rules themselves do not change."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void confirmDialog(); }}>
              {dialog === "delete" ? "Delete" : "Switch"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
```

`suggestAvailable` is unused until Task 10; prefix it `_suggestAvailable` in the destructuring if lint complains, and drop the prefix in Task 10. Check `BrandRules`'s actual props and `NativeSelect`'s props (it may not forward `aria-label`; if not, rely on the `Label htmlFor` and change the test label to the visible text) before wiring them.

- [ ] **Step 4: Render the form from the workspace**

In `BrandWorkspace.tsx`, add `const [suggestAvailable, setSuggestAvailable] = useState(false);` and, in the existing mount effect, `api.health().then((h) => alive && setSuggestAvailable(Boolean(h.suggest_available))).catch(() => {});` (Suggest simply stays off if health fails). Then replace the placeholder branch. For `new-form` render `BrandProfileForm` with `name={null}`, `initial={emptyProfile()}`, `stale={false}`. For a managed set, load its profile first:

```tsx
const [profile, setProfile] = useState<{ name: string; profile: BrandProfile } | null>(null);

useEffect(() => {
  if (!current?.managed) return;
  let alive = true;
  api.brandProfile(current.name)
    .then((r) => alive && setProfile({ name: current.name, profile: r.profile }))
    .catch((e) => alive && setError(errorMessage(e)));
  return () => {
    alive = false;
  };
}, [current?.name, current?.managed, version]);
```

and render:

```tsx
{selection.kind === "new-raw" || (current && !current.managed) ? (
  <RawSetEditor ... />
) : selection.kind === "new-form" ? (
  <BrandProfileForm key={key} name={null} initial={emptyProfile()} stale={false} existingNames={names}
    suggestAvailable={suggestAvailable} onSaved={afterSave} onDeleted={afterDelete} onDetached={afterSave}
    onDirtyChange={onDirtyChange} />
) : profile && current && profile.name === current.name ? (
  <BrandProfileForm key={key} name={current.name} initial={profile.profile} stale={current.stale}
    existingNames={names} suggestAvailable={suggestAvailable} onSaved={afterSave} onDeleted={afterDelete}
    onDetached={afterSave} onDirtyChange={onDirtyChange} />
) : (
  <p className="text-sm text-neutral-600">Loading...</p>
)}
```

`onDetached={afterSave}` reloads the list and reselects the set; it is now raw, so the raw editor opens.

- [ ] **Step 5: Run checks and look at it**

Run: `cd ~/Desktop/niks/repscore-pipeline/web && npm test && npx tsc --noEmit && npm run lint` then `cd ../e2e && npx playwright test brands.spec.ts brands-form.spec.ts`
Expected: PASS on both viewports.

Open the screenshots written by `shot` (`e2e/test-results/**/brands-form-*.png`) and check, at both widths: aligned field edges, consistent spacing between cards, chips wrapping cleanly, labels not truncated, the checkbox rows vertically centred, nothing overflowing. Fix anything that looks off before committing. Also start the app with `make dev` and check the form at a narrow window (about 400px wide): single column, no horizontal scroll.

- [ ] **Step 6: Commit**

```bash
cd ~/Desktop/niks/repscore-pipeline
git add web/components/TagInput.tsx web/components/BrandProfileForm.tsx web/components/BrandWorkspace.tsx e2e/tests/brands-form.spec.ts
git commit -m "feat: simple brand form on the Brands page"
```

---

### Task 10: Suggest chips in the form

**Files:**
- Create: `web/components/SuggestChips.tsx`
- Modify: `web/components/BrandProfileForm.tsx`
- Test: `e2e/tests/brands-form.spec.ts` (append)

**Interfaces:**
- Consumes: `api.suggestBrandProfile`, `missingValues`, `addValues`, `Suggestion`, `TagInput` `children` slot.
- Produces: `SuggestChips({ values: string[], current: string[], onAdd: (values: string[]) => void, note?: string })` - renders nothing when every suggestion is already in `current`.

- [ ] **Step 1: Write the failing e2e test**

Append to `e2e/tests/brands-form.spec.ts`:

```ts
test("Suggest offers chips that are only added when clicked", async ({ page }) => {
  await page.route("**/api/health", async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), suggest_available: true } });
  });
  await page.route("**/api/brand-profiles/suggest", (route) =>
    route.fulfill({
      json: {
        dropped: 0,
        suggestion: {
          always: ["Theta Industries"],
          handles: ["thetabags"],
          everyday_word: {
            word: "Theta", exact_case: true, closeness: "close", confirm: ["luggage", "trolley"],
            not_followed_by: ["function"], not_preceded_by: [], not_in_sentence_with: [], ignore_phrases: [],
          },
          people: [{ name: "Ann Example", common: false }],
          notes: "Collides with the Greek letter.",
        },
      },
    }),
  );
  await page.goto("/brands");
  await page.getByRole("button", { name: "New set", exact: true }).click();
  await page.getByLabel("Brand 1 name").fill("Theta");
  await page.getByLabel("Brand 1 description").fill("Luggage maker");
  await page.getByRole("button", { name: "Suggest" }).click();
  await expect(page.getByText("Collides with the Greek letter.")).toBeVisible();

  // Nothing is added until clicked.
  await expect(page.getByRole("button", { name: "Remove Theta Industries" })).toHaveCount(0);
  await page.getByRole("button", { name: "Add Theta Industries" }).click();
  await expect(page.getByRole("button", { name: "Remove Theta Industries" })).toBeVisible();

  // The everyday-word suggestion turns the section on and its chips appear.
  await page.getByRole("button", { name: "Use everyday word Theta" }).click();
  await expect(page.getByLabel("Brand 1 everyday word")).toHaveValue("Theta");
  await page.getByRole("button", { name: "Add all confirming words" }).click();
  await expect(page.getByRole("button", { name: "Remove trolley" })).toBeVisible();

  await expect(page.getByText("verify - from AI memory")).toBeVisible();
  await page.getByRole("button", { name: "Add Ann Example" }).click();
  await expect(page.getByLabel("Person 1 name")).toHaveValue("Ann Example");
});

test("Suggest is disabled without an API key", async ({ page }) => {
  await page.goto("/brands");
  await page.getByRole("button", { name: "New set", exact: true }).click();
  await page.getByLabel("Brand 1 name").fill("Theta");
  await expect(page.getByRole("button", { name: "Suggest" })).toBeDisabled();
  await expect(page.getByText("Suggest needs ANTHROPIC_API_KEY")).toBeVisible();
});
```

Run: `cd ~/Desktop/niks/repscore-pipeline/e2e && npx playwright test brands-form.spec.ts -g Suggest`
Expected: FAIL (no Suggest button)

- [ ] **Step 2: Write `SuggestChips.tsx`**

```tsx
"use client";

import { Button } from "@/components/ui/button";
import { missingValues } from "@/lib/brandProfile";

export function SuggestChips({
  values, current, onAdd, note, allLabel,
}: {
  values: string[];
  current: string[];
  onAdd: (values: string[]) => void;
  note?: string;
  allLabel: string; // e.g. "Add all confirming words"
}) {
  const missing = missingValues(current, values);
  if (!missing.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-1">
      <span className="text-xs text-neutral-500">Suggested{note ? ` (${note})` : ""}:</span>
      {missing.map((v) => (
        <button
          key={v}
          type="button"
          aria-label={`Add ${v}`}
          onClick={() => onAdd([v])}
          className="rounded-md border border-dashed border-neutral-300 px-2 py-0.5 text-sm text-neutral-700 hover:border-neutral-500 hover:bg-neutral-50"
        >
          + {v}
        </button>
      ))}
      {missing.length > 1 && (
        <Button variant="ghost" size="xs" aria-label={allLabel} onClick={() => onAdd(missing)}>Add all</Button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add Suggest to `BrandProfileForm.tsx`**

State: `const [suggestions, setSuggestions] = useState<Record<number, Suggestion>>({});`, `const [descriptions, setDescriptions] = useState<Record<number, string>>({});`, `const [suggesting, setSuggesting] = useState<number | null>(null);`, `const [suggestError, setSuggestError] = useState<string | null>(null);`.

```tsx
async function suggest(i: number) {
  setSuggestError(null);
  setSuggesting(i);
  try {
    const r = await api.suggestBrandProfile(profile.brands[i].name.trim(), (descriptions[i] ?? "").trim());
    setSuggestions((s) => ({ ...s, [i]: r.suggestion }));
  } catch (e) {
    setSuggestError(errorMessage(e));
  } finally {
    setSuggesting(null);
  }
}
```

In each brand card, under the Brand name row, add:

```tsx
<div className="flex flex-wrap items-end gap-3">
  <div className="min-w-64 flex-1 space-y-1.5">
    <Label htmlFor={`b${i}-desc`}>One-line description (for Suggest)</Label>
    <Input id={`b${i}-desc`} aria-label={`Brand ${n} description`} value={descriptions[i] ?? ""}
      onChange={(e) => setDescriptions((d) => ({ ...d, [i]: e.target.value }))}
      placeholder="e.g. Indian luggage maker, founder Sudhir Jatia" />
  </div>
  <Button variant="outline" disabled={!suggestAvailable || !b.name.trim() || suggesting !== null} onClick={() => suggest(i)}>
    {suggesting === i ? "Suggesting..." : "Suggest"}
  </Button>
</div>
{!suggestAvailable && <p className="text-xs text-neutral-500">Suggest needs ANTHROPIC_API_KEY in repscore-pipeline/.env.</p>}
{suggestions[i]?.notes && <p className="rounded-md bg-neutral-50 p-2 text-sm text-neutral-700">{suggestions[i].notes}</p>}
```

The description is not saved; it only feeds Suggest. Chips under each field via the `TagInput` `children` slot, for example:

```tsx
<TagInput id={`b${i}-always`} ... >
  {suggestions[i] && (
    <SuggestChips values={suggestions[i].always} current={b.always} allLabel="Add all names"
      onAdd={(v) => updateBrand(i, { always: addValues(b.always, v) })} />
  )}
</TagInput>
```

Do the same for `handles` (`allLabel="Add all handles"`) and, inside the everyday-word section, each word list with `suggestions[i].everyday_word?.<list> ?? []` and `allLabel`s `Add all confirming words`, `Add all followed-by words`, `Add all preceded-by words`, `Add all sentence words`, `Add all phrases` (keep the existing warning children too).

When the suggestion has an `everyday_word` and the section is off, show next to the checkbox:

```tsx
{suggestions[i]?.everyday_word && !w && (
  <Button variant="ghost" size="xs" aria-label={`Use everyday word ${suggestions[i].everyday_word.word}`}
    onClick={() => {
      const sw = suggestions[i].everyday_word!;
      updateBrand(i, { everyday_word: { ...emptyWord(sw.word), exact_case: sw.exact_case, closeness: sw.closeness } });
    }}>
    Suggested: treat &quot;{suggestions[i].everyday_word.word}&quot; as an everyday word
  </Button>
)}
```

In the People section, for every brand's suggestion, render people chips with the "verify" note:

```tsx
{Object.values(suggestions).map((s, k) => (
  <SuggestChips key={k} note="verify - from AI memory" allLabel="Add all people"
    values={s.people.map((x) => x.name)} current={profile.people.map((x) => x.name)}
    onAdd={(names) => setProfile((p) => ({
      ...p,
      people: [...p.people, ...s.people.filter((x) => names.includes(x.name))],
    }))} />
))}
```

Show `suggestError` as `<p role="alert" className="text-sm text-red-700">` under the Suggest row. Remove the `_` prefix from `suggestAvailable` if Task 9 added one.

- [ ] **Step 4: Run checks and look at it**

Run: `cd ~/Desktop/niks/repscore-pipeline/web && npm test && npx tsc --noEmit && npm run lint` then `cd ../e2e && npx playwright test brands.spec.ts brands-form.spec.ts`
Expected: PASS. Look at a screenshot with chips showing (add `await shot(page, "brands-suggest", info)` to the Suggest test after the chips appear, with `info` from the test args) and check chip spacing and wrapping.

- [ ] **Step 5: Commit**

```bash
cd ~/Desktop/niks/repscore-pipeline
git add web/components/SuggestChips.tsx web/components/BrandProfileForm.tsx e2e/tests/brands-form.spec.ts
git commit -m "feat: Suggest chips on the simple brand form"
```

---

### Task 11: Docs, full check, and the one real Suggest call

**Files:**
- Modify: `README.md` (repscore-pipeline "Brand sets" section)

- [ ] **Step 1: Update the pipeline README**

In "Brand sets" (around lines 55-59), describe: "New set" opens the simple form (no regex; plain words, people, optional Suggest); sets made with it show a "Form" badge and reopen in the form; "New raw set" and existing hand-written sets use the regex editor; "Switch to advanced editing" turns a form set into raw rules; the `profiles:` section in url-verification's `config.yaml` holds the form answers.

- [ ] **Step 2: Run everything**

Run: `cd ~/Desktop/niks/repscore-pipeline && make check`
Expected: lint, all unit suites (api, web, Company Monitor, url-verification) and e2e PASS. Any failure or flake, including ones not caused by this work, gets fixed before moving on.

- [ ] **Step 3: Pixel pass**

Run `make dev`, open `/brands` in the browser preview, and walk the flow by hand at 1280px, 1920px and about 400px: new form set with two brands and people, preview warnings, generated rules, try panel, save, reload, edit, switch to advanced, raw set editor, delete. Fix anything misaligned, clipped, inconsistent with the rest of the app, or awkwardly worded.

- [ ] **Step 4: Ask the owner before the real Suggest call**

Ask: "Ready to make one real Suggest call for 'Safari - Indian luggage maker' using the key in repscore-pipeline/.env (model claude-opus-5-5, a few cents). OK?" Only after a yes: click Suggest in the running app, check the chips are sensible, the notes show, nothing invalid got through, and people chips carry the verify note. Report what came back.

- [ ] **Step 5: Commit**

```bash
cd ~/Desktop/niks/repscore-pipeline
git add README.md
git commit -m "docs: simple brand form on the Brands page"
```
