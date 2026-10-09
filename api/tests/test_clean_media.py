"""The master media list matcher, against the list shipped in reference/."""

import pytest

from pipeline_api.clean.media import load_master_list
from pipeline_api.settings import load_settings


@pytest.fixture(scope="module")
def mml():
    return load_master_list(load_settings({}).master_media_list)


@pytest.mark.parametrize(
    ("link", "name", "bucket", "how"),
    [
        ("https://www.business-standard.com/markets/news/abc-123", "", "Major Media", "domain+path"),
        ("https://www.business-standard.com/opinion/x", "", "Major Media", "domain"),
        ("https://www.jagran.com/bihar/patna-x.html", "", "Regional Media", "domain+path"),
        ("https://www.jagran.com/news/national-x.html", "", "Major Media", "domain"),
        ("https://epaper.jagran.com/x", "", "Major Media", "parent-domain"),
        ("https://economictimes.indiatimes.com/markets/stocks/x", "", "Major Media", "domain+path"),
        ("https://www.some-unknown-site-xyz.com/a", "", "Other Media", "none"),
        ("https://www.some-unknown-site-xyz.com/a", "Bangalore Mirror", "Regional Media", "name"),
        ("not a url", "", "Other Media", "none"),
    ],
)
def test_match(mml, link, name, bucket, how):
    hit = mml.match(link, name)
    assert (hit.bucket, hit.matched_by) == (bucket, how)


def test_shared_host_picks_the_parent_masthead(mml):
    # ET Foods shares economictimes.indiatimes.com but names Economic Times as its parent.
    hit = mml.match("https://economictimes.indiatimes.com/some-company/stocks/x")
    assert hit.publication == "Economic Times"
    assert hit.level == "Core"
    assert not hit.review  # a shared host is a note, not something to review


def test_name_disagreement_needs_review(mml):
    hit = mml.match("https://www.business-standard.com/x", "Bangalore Mirror")
    assert hit.matched_by == "domain" and hit.review


def test_list_loads(mml):
    counts = mml.counts()
    assert counts["rows"] > 1000
    assert {"Major Media", "Regional Media", "Other Media"} <= set(counts)
