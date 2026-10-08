from conftest import FakeSearch, make_client

from pipeline_api.settings import load_settings
from pipeline_api.suggest import SuggestError, sanitize_suggestion

GOOD = {
    "always": ["Safari Industries", "safari industries", "  ", "x" * 300],
    "handles": ["#safaribags", "safari bags"],
    "everyday_word": {
        "word": "Safari",
        "exact_case": True,
        "closeness": "close",
        "confirm": ["luggage", "luggage"],
        "not_followed_by": ["browser"],
        "not_preceded_by": [],
        "not_in_sentence_with": ["Serengeti"],
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
