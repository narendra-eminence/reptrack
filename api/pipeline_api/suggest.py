"""Ask Claude for brand form suggestions. The only module that imports anthropic.

Suggestions are plain text in the same shape as the form. They are cleaned with the form's own value rules before
they reach the browser, and the user still has to click each one to add it.
"""

from __future__ import annotations

from typing import Any, Literal, Protocol

import anthropic
from pydantic import BaseModel, ValidationError
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
        except anthropic.APIError as e:
            raise SuggestError(f"Claude's reply could not be read ({e.message}). Try again.") from e
        except ValidationError as e:
            raise SuggestError("Claude's reply could not be read. Try again.") from e
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
            # A phrase without the word itself can never block a mention of it
            kept = [p for p in word["ignore_phrases"] if word["word"].casefold() in p.casefold()]
            dropped += len(word["ignore_phrases"]) - len(kept)
            word["ignore_phrases"] = kept
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
