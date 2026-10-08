# Simple Brand Form - Design

Status: draft for review
Date: 8 October 2026
Owner: Narendra

## 1. Purpose

Today a brand set is created on the Brands page by typing raw regular expressions: the pattern, the context words and the exclusions. Nobody on the team writes regex, so every new set is drafted by an AI and pasted in.

This feature lets anyone who knows the brand create and later edit a set from a plain form, with no regex anywhere in the normal flow. The app turns the form answers into the existing rule format behind the scenes. A **Suggest** button asks Claude for aliases, context words and exclusion phrases, shown as plain-language chips the user can add.

Success: a teammate who has never seen regex can set up a brand like "Safari" (a common word with a browser, a wildlife meaning and a luggage company) from the form alone, check it in the "Try these rules" panel, save it, and pick it in the Verify step.

## 2. Decisions taken

| Question | Decision |
|---|---|
| Editing later | A form-made set reopens in the same form. The form answers are stored and the rules are rebuilt from them on every save. |
| AI help | Manual form plus a Suggest button. Suggestions are plain text chips; nothing is added until the user clicks. |
| Where answers live | A new `profiles:` section in url-verification `config.yaml`, next to `brands:`, written in the same atomic save. |
| Where generation lives | url-verification `urlverify/profile.py`, one pure function, so the CLI and the app agree. |
| Existing 12 sets | Untouched. They stay raw sets and open in the current raw editor. |
| Escape hatch | "Switch to advanced editing" drops a set's profile and keeps its rules as raw rules. |

## 3. What does not change

- The `BrandRule` format (six fields) and `BrandMatcher` in url-verification.
- What verification runs: always the rules under `brands:`. Runs still snapshot those rules when they start.
- The raw editor (`BrandEditor.tsx`) and `/api/brands` endpoints, apart from the additions in sections 6 and 7.

## 4. The profile (form answers)

A profile describes one brand set. It has one or more brands (the main brand plus sub-brands or peers) and one People list.

```yaml
profiles:
  safari:
    brands:
      - name: Safari
        always: ['Safari Industries', 'SAFARIND', 'सफारी इंडस्ट्रीज']
        handles: ['safaribags', 'safariluggage']
        everyday_word:
          word: Safari
          exact_case: true
          closeness: close          # close | nearby | paragraph
          confirm: ['luggage', 'bag', 'trolley', 'suitcase', 'backpack', 'NSE', 'BSE', 'share price']
          not_followed_by: ['browser', 'extension', 'tab', 'park', 'tour', 'lodge']
          not_preceded_by: ['Apple', 'iOS', 'macOS', 'wildlife', 'jungle', 'jeep']
          not_in_sentence_with: ['Masai Mara', 'Serengeti', 'Kruger', 'Ranthambore']
          ignore_phrases: []
      - name: Genius
        always: []
        handles: []
        everyday_word:
          word: Genius
          exact_case: true
          closeness: close
          confirm: ['luggage', 'bag', 'trolley']
    people:
      - name: Sudhir Jatia
        common: false
```

Field meanings, as shown on the form:

| Field | Form label | Notes |
|---|---|---|
| `name` | Brand name | Shown under "Brands Found". Unique within the set. |
| `always` | Names that always mean this brand | Full names, tickers, other scripts. Optional if `everyday_word` is set. |
| `handles` | Extra hashtags or handles | Leading `#` or `@` is stripped. Letters, digits and `_` only. |
| `everyday_word` | Is the short name also an everyday word? | Absent means No. |
| `word` | The everyday word | e.g. Safari, VIP, Basil |
| `exact_case` | Match exact capitals | Default true. |
| `closeness` | How close confirming words must be | Close, Nearby (default) or Same paragraph |
| `confirm` | Words that confirm it's the brand | |
| `not_followed_by` | Not the brand when followed by | |
| `not_preceded_by` | Not the brand when preceded by | |
| `not_in_sentence_with` | Not the brand in the same sentence as | |
| `ignore_phrases` | Exact phrases to ignore | e.g. Ritz-Carlton, Vaani Kapoor, St Basil |
| `people[].name` | Leader name | |
| `people[].common` | Common name - only count when the brand is mentioned nearby | Default false. |

All list fields are optional and default to empty. Every value is plain text; the user never types regex.

### Validation

`validate_profile` rejects, with a message naming the field:

- a set name that fails the existing `NAME_RE`;
- no brands, or two brands with the same name (case-insensitive);
- a brand with neither `always` nor `everyday_word`;
- an empty or whitespace-only value in any list, or a duplicate within a list (case-insensitive);
- a handle with characters other than letters, digits and `_`;
- any value longer than 200 characters;
- an unknown `closeness` or an unknown key anywhere in the profile.

It returns warnings (shown in the form, not blocking save):

- an everyday word with no confirming words of its own and no automatic ones (section 5), meaning every use of the word counts;
- an `ignore_phrases` entry that does not contain the everyday word (case-insensitive), meaning it can never block a hit.

## 5. Building rules from a profile

`build_rules(profile) -> BuildResult` is a pure function in `urlverify/profile.py`. `BuildResult` holds `rules: list[BrandRule]`, `warnings: list[str]` and `labels: dict[str, str]`, a plain-language label for each generated exclusion regex (used in section 7).

### Helpers

- **lit(text):** split on whitespace and hyphens, `re.escape` each piece, join with `[\s-]+`. So "Ritz-Carlton" also matches "Ritz Carlton".
- **tag(text):** only when every piece is ASCII letters or digits: `[#@]` + pieces joined by `_?` + `\w*`. So "Safari Industries" gives `[#@]Safari_?Industries\w*`. Non-Latin names get no tag form.
- **SUFFIX:** `(?:-(?:backed|owned|led|controlled|funded|managed))?`. Needed because the matcher treats `-` as part of a word, so "Kedaara-backed" would otherwise not match "Kedaara".
- **plural(text):** `lit(text)` + `(?:s|es)?`
- **any_of(values, plural):** `(?i:` + values joined by `|` + `)`, using `plural` or `lit`. The scoped `(?i:...)` keeps these words case-insensitive even when the rule is case-sensitive, so "Safari Browser" is excluded as well as "Safari browser".

### Rules per brand

1. **Always rule**, when `always` or `handles` is non-empty:
   - `name`: brand name
   - `pattern`: alternation of `lit(a) + SUFFIX` and `tag(a)` for each `always` entry, plus `[#@]handle\w*` for each handle
   - case-insensitive, no context, no exclusions
2. **Everyday-word rule**, when `everyday_word` is set. With `W = lit(word)`:
   - `name`: brand name
   - `pattern`: `W + SUFFIX`
   - `case_sensitive`: `exact_case`
   - `context_window`: close 60, nearby 100, paragraph 2000. The matcher works paragraph by paragraph, so 2000 means the whole paragraph in practice.
   - `require_context`: `\b` + `plural(c)` + `\b` for each `confirm` entry, plus `lit()` of every brand name, every `always` entry and every person name in the set. These automatic entries mirror today's hand-written sets, where Safari's context includes "Safari Industries", "Genius" and "Sudhir Jatia".
   - `exclude`:
     - `not_followed_by`: `W[\s-]+` + `any_of(values, plural)` + `\b`, labelled "followed by browser, tab, ..."
     - `not_preceded_by`: `any_of(values, plural)` + `[\s-]+W`, labelled "preceded by Apple, iOS, ..."
     - `not_in_sentence_with`: both `W[^.!?\n]{0,60}T` and `T[^.!?\n]{0,60}W` with `T = any_of(values, lit)`, labelled "in the same sentence as Serengeti, Kruger, ..."
     - `ignore_phrases`: `(?i:lit(p))` for each phrase, labelled "the phrase Ritz-Carlton"

### People rules

With `first` = the first brand's name:

- **`{first} leadership`**: alternation of `lit(name)` for people with `common: false`; case-insensitive; no context.
- **`{first} leadership (common names)`**: alternation of `lit(name)` for people with `common: true`; `context_window: 150`; `require_context` = `lit()` of every brand name, `always` entry and everyday word in the set.

Each rule is omitted when it would be empty. Rule order in the output is brands in form order, then people. Order has no effect on matching (the matcher sorts by pattern length), but a stable order keeps saved YAML diffs readable.

## 6. Storage (url-verification `urlverify/brands.py` and `config.py`)

- **`save_profile(config_path, name, profile)`**: validates, builds rules, sets `doc["profiles"][name]` and `doc["brands"][name]` in the same document, and writes through the existing `_write` (re-validation, timestamped backup, atomic replace). Creates the `profiles:` section if missing. An existing key keeps its position.
- **`load_profile(config_path, name)`**: returns the profile, or `None` for a raw set.
- **`save_set`** (raw save) refuses a name that has a profile: "This set is managed by the simple form. Edit it there, or switch it to advanced editing first."
- **`delete_set`** removes both `brands.<name>` and `profiles.<name>`.
- **`detach_profile(config_path, name)`**: removes only `profiles.<name>`, keeping the rules. This is "Switch to advanced editing".
- **`load_config`** validates `profiles:` with `validate_profile` and rejects a profile whose name has no entry under `brands:`. It does **not** fail when a profile's stored rules differ from what `build_rules` produces now, because a later change to `build_rules` would otherwise break every saved set. The rules under `brands:` are always what runs.
- **`list_sets_detailed(config_path)`** returns, per set, its rules, `managed: bool`, and `stale: bool` (managed, and stored rules differ from a fresh `build_rules`). Stale means the YAML was hand-edited or the generator changed; re-saving from the form clears it.
- **README:** the "Configuration" section of url-verification's README documents `profiles:` and the managed-set rules. Its stale list of configured sets is corrected at the same time.

## 7. API (repscore-pipeline)

A new router `api/pipeline_api/routes/brand_profiles.py`. Pydantic models mirror the profile shape, with unknown keys forbidden.

| Endpoint | Body | Returns |
|---|---|---|
| `GET /api/brand-profiles/{name}` | | `{profile}`, 404 for a raw set |
| `PUT /api/brand-profiles/{name}` | `{profile, create}` | `{name, backup, warnings}`. 409 when `create` is true and the name exists. 422 with the validation message otherwise. |
| `POST /api/brand-profiles/preview` | `{name, profile}` | `{rules, warnings}`, nothing saved |
| `POST /api/brand-profiles/test` | `{name, profile, text}` | Same shape as `/api/brands/test`, with each "excluded by <regex>" reason replaced by "Not counted: <label>" from `BuildResult.labels` |
| `POST /api/brand-profiles/suggest` | `{brand_name, description}` | `{suggestion}` (section 8). 503 when no API key is configured, 502 on a Claude error. |
| `DELETE /api/brand-profiles/{name}/profile` | | `{name, backup}`. Switches the set to advanced editing. |

Changes to existing endpoints:

- `GET /api/brands` adds `managed` and `stale` to each set.
- `PUT /api/brands/{name}` returns 409 for a managed set, with the message from `save_set`.
- `GET /api/health` adds `suggest_available: bool` (true when `ANTHROPIC_API_KEY` is set), so the UI can disable the button.

## 8. Suggest

- **Settings:** `ANTHROPIC_API_KEY` and `PIPELINE_SUGGEST_MODEL` (default `claude-opus-5-5`) in the pipeline `.env`, read by `load_settings`. Missing key means Suggest is off; the app still starts.
- **Dependency:** the `anthropic` Python SDK in `api/pyproject.toml`.
- **Call:** one Messages API request with structured output, so the reply is JSON matching this shape:

  ```json
  {
    "always": ["..."],
    "handles": ["..."],
    "everyday_word": {
      "word": "...", "exact_case": true, "closeness": "nearby",
      "confirm": ["..."], "not_followed_by": ["..."], "not_preceded_by": ["..."],
      "not_in_sentence_with": ["..."], "ignore_phrases": ["..."]
    },
    "people": [{"name": "...", "common": false}],
    "notes": "one or two sentences on what the brand name collides with"
  }
  ```

  `everyday_word` is null when the name is not a common word. The system prompt explains the matching behaviour in plain terms (whole words only, exclusions must contain the word, what each field does) and includes the Safari profile from section 4 as a worked example. Timeout 60 seconds, no retries.
- **Testing seam:** the route depends on a small `Suggester` protocol; tests inject a fake. The real implementation is the only code that imports `anthropic`.
- **Safety of output:** the suggestion is passed through the same Pydantic model and `validate_profile` value rules before it is returned; invalid entries are dropped and counted in a `dropped` field.
- **UI:** suggestions appear as chips under each matching field, never added automatically. Click a chip to add it, or "Add all" per field. People chips are labelled "verify - from AI memory". The `notes` text shows above the form. Suggest needs a brand name; the description is optional but encouraged ("Indian luggage maker, founder Sudhir Jatia").

## 9. UI (repscore-pipeline `web/`)

- **`/brands` page:** "New set" opens the simple form. Sets in the sidebar show a small "Form" badge when managed. Selecting a managed set opens the form; selecting a raw set opens the current raw editor unchanged.
- **New component `BrandProfileForm.tsx`:**
  - Set name (locked once saved, as today).
  - One card per brand with the section 4 fields. List fields are tag inputs: type and press Enter or comma, click x to remove. The everyday-word fields show only when the toggle is on.
  - "Add brand" for sub-brands and peers; brand cards can be removed.
  - People section: rows of name plus the "Common name" checkbox.
  - Warnings from `preview` show inline next to the field they concern.
  - "Advanced: show generated rules" toggle shows the `preview` rules read-only, using the existing `BrandRules.tsx`.
  - Footer: Save set, Delete set, and "Switch to advanced editing" (confirm dialog explaining that the form answers are discarded and the set becomes raw rules).
  - A stale banner when `stale` is true: "These rules differ from what the form would produce. Saving will replace them with the form's version."
- **Try these rules:** the existing panel, pointed at `/api/brand-profiles/test` when the form is open, so reasons read "Not counted: followed by browser, tab, ..." rather than a regex.
- **New `web/lib/brandProfile.ts`:** profile types, an empty-profile factory, and draft conversion, following `brandDraft.ts`.
- **Verify step:** unchanged, apart from managed sets appearing in the dropdown like any other set.
- The form follows the existing page's styles and layout, including at narrow widths.

## 10. Testing

- **`build_rules` unit tests (url-verification), the core of the suite:**
  - Helper behaviour: escaping of special characters (`.`, `+`, `(`, `&`), hyphen and space equivalence, tag forms, the `-backed` suffix, non-Latin names with no tag form, scoped case-insensitivity in exclusions.
  - **Parity tests:** profiles equivalent to today's hand-written `safari`, `basil`, `vip` and `multiples` sets, each run with `try_rules` over a list of sample sentences (for example "Safari Industries shares rose 4%", "open it in Safari browser", "a jeep safari in Kruger", "Safari launched a new trolley range", "Kedaara-backed firm"). The test asserts the generated rules count and drop the same mentions as the hand-written rules. This proves the form can express what the team already relies on.
  - Warnings and validation messages for each rule in section 4.
- **Storage tests:** `save_profile` writes both sections in one file write with one backup; `save_set` refuses a managed set; `delete_set` removes both; `detach_profile` keeps the rules; `load_config` rejects a profile without rules and an invalid profile; `stale` is computed correctly; comments elsewhere in `config.yaml` survive.
- **API tests (repscore-pipeline):** each endpoint in section 7, including 404, 409, 422, 503, label substitution in `/test`, and Suggest with a fake `Suggester` (valid output, output with invalid entries dropped, Claude error).
- **Web unit tests:** `brandProfile.ts` draft conversion.
- **Playwright:** create "Safari" from the form, test a sentence and see a plain-language "Not counted" reason, save, reload, edit and save again, then see the set in the Verify dropdown. Suggest is stubbed at the network layer.
- **Manual:** one real Suggest call against the Anthropic API, run only with the owner's go-ahead because it spends credits.

## 11. Out of scope

- Converting the 12 existing raw sets into profiles.
- Claude fetching real articles to test draft rules.
- Fixing `navana_ai`, whose `'Dhaka|Bangladesh|\bBD\b|Tk\.? ?\d'` exclusion never blocks anything because it does not cover the word "Navana". Tracked separately.
- Per-brand domains, competitor lists as a separate concept, or any change to how verification scores pages.
