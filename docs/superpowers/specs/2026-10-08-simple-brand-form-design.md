# Simple Brand Form - Design

Status: revision 2, draft for review (revision 1, with Claude Suggest and a raw regex editor, was built on `feat/brand-profiles` and is superseded by this document)
Date: 8 October 2026
Owner: Narendra

## 1. Purpose

Brand sets used to be written as raw regular expressions, which nobody on the team writes, so every new set was drafted by an AI and pasted in.

This feature makes the Brands page a **brand configuration system**: anyone who knows the brand describes it in plain language - names, hashtags, handles, whether the name is a common word, words that confirm it, words that rule it out, people, and test sentences - and the backend turns that into the existing rule format. The user never needs to know regex exists; regex is an implementation detail, like SQL behind a form.

Success: a teammate who has never seen regex sets up "Safari" (a common word with a browser, a wildlife meaning and a luggage company) from the form alone, adds test sentences with the expected result, sees them all pass, saves, and picks the set in the Verify step.

## 2. Decisions taken

| Question | Decision |
|---|---|
| Editing later | A form-made set reopens in the same form. The answers are stored and the rules are rebuilt from them on every save. |
| AI | None. No Suggest, no Anthropic dependency, no API key. |
| Regex in the UI | Never shown: no generated-rules view, no raw regex editor, and the Verify step shows a plain summary instead of rules. |
| Where answers live | `profiles:` in url-verification `config.yaml`, next to `brands:`, written in the same atomic save. |
| Where generation lives | url-verification `urlverify/profile.py` (`build_rules`), so the CLI and the app agree. |
| Brands per set | Several (main brand plus sub-brands or peers), each with its own people and test sentences. |
| Test sentences | Saved with the brand, re-checked on every change, shown as pass/fail in plain language; saving warns but does not block when one fails. |
| Existing 12 hand-written sets | Keep working for verification. Read-only in the app: the page explains they were written by hand and offers Delete only. |
| Fixed behaviour (no fields) | A common-word brand name always matches exact capitals and needs a confirming word within about 15 words (100 characters). |

## 3. What does not change

- The verifier: the `brands:` section format (`BrandRule`, six fields) and `BrandMatcher`. Verification always runs the rules under `brands:`, and runs still snapshot those rules when they start.
- `/api/brands` list and delete, and `/api/runs/{id}/verify` with its snapshot.

## 4. The profile (form answers)

```yaml
profiles:
  safari:
    brands:
      - name: Safari
        description: Indian luggage and travel-products company
        aliases: ['Safari Industries', 'SAFARIND', 'सफारी इंडस्ट्रीज']
        hashtags: ['safaribags', 'safariluggage']
        handles: ['safari_luggage']
        common_word: true
        confirming_words: ['luggage', 'bag', 'trolley', 'NSE', 'share price']
        exclusions:
          followed_by: ['browser', 'tab', 'park', 'tour', 'lodge']
          preceded_by: ['Apple', 'iOS', 'wildlife', 'jungle']
          nearby: ['Serengeti', 'Kruger', 'Ranthambore']
          phrases: ['Safari Rally']
        people:
          - name: Sudhir Jatia
            require_brand_nearby: false
        tests:
          - text: Safari Industries shares rose today
            expect: match
          - text: Safari browser released a new version
            expect: no_match
          - text: We went on a safari in Kruger
            expect: no_match
      - name: Genius
        common_word: true
        confirming_words: ['luggage', 'bag', 'trolley']
```

| Field | Form label | Notes |
|---|---|---|
| `name` | Brand name | Shown under "Brands Found". Unique within the set. Always matched, unless `common_word` is true. |
| `description` | Description | A note for people; not used for matching. Up to 500 characters. |
| `aliases` | Other brand names / aliases | Full names, tickers, other scripts. Always counted. |
| `hashtags` | Hashtags | Without `#` (a leading `#` is stripped). Letters, digits and `_`. |
| `handles` | Social handles | Without `@` (a leading `@` is stripped). Letters, digits and `_`. |
| `common_word` | Is the brand name a common word? | Default false. When true, the four fields below apply. |
| `confirming_words` | Words that confirm this is the brand | |
| `exclusions.followed_by` | Not the brand: after the brand name | |
| `exclusions.preceded_by` | Not the brand: before the brand name | |
| `exclusions.nearby` | Not the brand: nearby, in the same sentence | |
| `exclusions.phrases` | Exact phrases to ignore | e.g. Ritz-Carlton, Vaani Kapoor |
| `people[].name` | Person | |
| `people[].require_brand_nearby` | Only count when the brand is nearby | Default false. |
| `tests[].text` | Test sentence | Up to 1000 characters; at most 50 per brand. |
| `tests[].expect` | Expected result | `match` or `no_match` |

All list fields are optional. Every value is plain text. Each value is 1-200 characters after trimming and must contain at least one letter or digit.

### Validation

`validate_profile` rejects, with a message using the form labels:

- no brands, or two brands with the same name (case-insensitive);
- an empty name, or an invalid value in any list, or a duplicate within a list (case-insensitive), or two people with the same name within a brand;
- a hashtag or handle with characters other than letters, digits and `_`;
- `confirming_words` or `exclusions` values on a brand whose `common_word` is false (the form clears them when the box is unticked);
- an unknown `expect` or an unknown key anywhere.

It returns warnings (shown in the form, not blocking save):

- a common-word brand with nothing to confirm it (no confirming words and no automatic ones, section 5), meaning every use of the word counts;
- an exact phrase to ignore that does not contain the brand name, meaning it can never block a mention.

## 5. Building rules from a profile

`build_rules(profile) -> BuildResult` stays a pure function in `urlverify/profile.py`. `BuildResult` holds `rules`, `warnings`, `labels` (plain-language label per generated exclusion) and `owners` (which brand each rule belongs to, for checking test sentences).

Helpers are unchanged from revision 1: `lit` (escaped literal, spaces and hyphens interchangeable), `tag` (hashtag/handle form for ASCII names), `SUFFIX` (`-backed`, `-owned`, ... with case-insensitive suffix words), scoped `(?i:...)` for exclusion words, `(?<!\w)...(?!\w)` boundaries on every user word in context and exclusions.

Per brand:

1. **Always rule** (case-insensitive, no context): the brand name (unless `common_word`) and every alias as `lit + SUFFIX` plus `tag`; each hashtag as `#value\w*`; each handle as `@value\w*`.
2. **Common-word rule** (when `common_word`): pattern `lit(name) + SUFFIX`, exact capitals, context window 100, `require_context` = each confirming word (plurals allowed) plus the automatic context: every other brand name, every alias, and every person whose `require_brand_nearby` is false, across the whole set. Exclusions from `followed_by`, `preceded_by`, `nearby` (both directions, same sentence) and `phrases`, each labelled in plain language.
3. **People rules**: `{name} leadership` for people with `require_brand_nearby: false` (always counted); `{name} leadership (brand nearby)` for the others, context window 150, `require_context` = this brand's name and aliases.

Rule order: brands in form order, then that brand's people. Order does not affect matching.

### Test sentences

`check_tests(profile) -> list[TestResult]` runs every brand's test sentences through a `BrandMatcher` built from the whole set's rules (so overlaps between brands resolve exactly as in verification), treating each sentence as one paragraph. A sentence **matches** when at least one counted mention belongs to that brand (its name, aliases, hashtags, handles, common word or people). Each result carries `brand`, `index`, `text`, `expect`, `passed`, and the plain-language explanation from `try_rules` (matched text with surrounding words, and the reason for each mention that did not count).

## 6. Storage (url-verification)

As in revision 1: `save_profile` writes `profiles.<name>` and `brands.<name>` in one atomic `_write` with a backup; `load_config` validates `profiles:` and rejects a profile without a brand set; stored rules that merely differ from a fresh build only mark the set `stale`; `delete_set` removes both; `list_sets_detailed` returns `rules`, `managed`, `stale`; `try_rules(rules, text, labels)` reports matched text, surrounding words, cut markers and plain reasons. `profile_from_dict` / `profile_to_dict` and the YAML writer use the revision 2 field names. No revision 1 profiles exist in the live `config.yaml`, so there is no migration.

## 7. API (repscore-pipeline)

| Endpoint | Body | Returns |
|---|---|---|
| `GET /api/brands` | | Each set: `name`, `rules` (kept for the Verify step's "changed since this run" check; never rendered), `managed`, `stale`, and `profile` for managed sets |
| `DELETE /api/brands/{name}` | | Unchanged |
| `GET /api/brand-profiles/{name}` | | `{profile}`; 404 for a hand-written or unknown set |
| `PUT /api/brand-profiles/{name}` | `{profile, create}` | `{name, backup, warnings, tests}`; 409 for a duplicate on create or an existing hand-written set; 422 with the form-worded validation message |
| `POST /api/brand-profiles/check` | `{profile}` | `{warnings, tests}`, nothing saved. Replaces revision 1's preview and test endpoints. |

Removed: `PUT /api/brands/{name}` (raw save), `POST /api/brands/test`, `POST /api/brand-profiles/preview`, `/test`, `/suggest`, `DELETE /api/brand-profiles/{name}/profile`, `suggest_available` in health, and the Anthropic settings, `.env` loading and dependency.

## 8. UI (repscore-pipeline `web/`)

- **Brands page sidebar:** "New set" plus the list of sets. Form-made sets show a "Form" badge; hand-written sets show a muted "Hand-written" badge.
- **Hand-written set selected:** "Written by hand before the form existed. It still works for verification. To change it, create it again with the form." plus Delete set. No rules are shown.
- **The form** (`BrandProfileForm.tsx`), for a new or form-made set:
  - Set name (locked once saved).
  - One card per brand, with "Add another brand" and Remove: Brand name, Description, Other brand names / aliases, Hashtags, Social handles (tag inputs), and "Is the brand name a common word?" Yes/No. When Yes: Words that confirm this is the brand; Words that mean it is NOT the brand, split into After the brand name, Before the brand name, Nearby / same sentence; Exact phrases to ignore. Unticking clears those fields.
  - People per brand: rows of Person and "Only count when brand is nearby", with Add person.
  - Test configuration per brand: rows of sentence, Match / Not a match, and a live result ("Passes" / "Fails") with the plain explanation (highlighted match and its words, or why each mention did not count). An "Add test sentence" input appends a row.
  - Warnings inline next to the field they concern.
  - Footer: Save set and Delete set. A save with failing tests saves and shows "Saved. N test sentences do not give the expected result." The stale banner from revision 1 stays.
  - Every change re-runs `POST /api/brand-profiles/check` (debounced, out-of-order responses ignored).
- **Verify step:** the selected set shows a plain summary instead of rules: for a form set, each brand's names, hashtags, handles, confirming words, exclusions and people; for a hand-written set, the hand-written note. The job panel keeps "Brand set X, rules copied when this verification started" and the "changed since" notice, without listing rules.
- Removed: Suggest UI, "Show generated rules", the raw regex editor, "New raw set", "Switch to advanced editing", and the free-text "Try these rules" panel (test sentences replace it).

## 9. Testing

- `build_rules` unit tests for the revision 2 fields (name always matched when not common, hashtags `#` only, handles `@` only, per-brand people, `require_brand_nearby`), plus all revision 1 behaviour tests carried over.
- Parity tests: the Safari, VIP, Basil and Multiples profiles rewritten in revision 2 form give the same counted mentions as today on the 39 sample sentences (same expected offsets and deliberate differences as now).
- `check_tests` tests: match / no_match, mentions owned by another brand do not count, people count for their brand, explanations present.
- Validation tests for every rule in section 4.
- Storage tests updated to the revision 2 YAML.
- API tests for every endpoint in section 7, including the removed endpoints returning 404/405.
- Web unit tests for the profile helpers.
- Playwright: create a Safari set with two brands, people and test sentences; see passes and a failing test go green after adding an exclusion; save (including the "N test sentences" notice); reload and edit; a hand-written set is read-only with Delete; the Verify step shows the plain summary and no regex anywhere on the page.

## 10. Out of scope

- Converting the 12 hand-written sets into form sets.
- Any change to how verification scores pages.
- Fixing `navana_ai`'s ineffective `Dhaka|Bangladesh` exclusion (tracked separately).
