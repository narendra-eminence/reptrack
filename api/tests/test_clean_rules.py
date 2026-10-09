"""The scripted cleaning rules (ported from the repscore-data-processing skill's rules.py self-test)."""

import datetime as dt

import pytest

from pipeline_api.clean import rules
from pipeline_api.clean.details import CleaningDetails, DetailsError, OwnerMatcher
from pipeline_api.clean.rules import LOW_QUALITY, SPAM


@pytest.mark.parametrize(
    ("link", "known", "want"),
    [
        ("https://www.amazon.in/dp/B0X", False, (LOW_QUALITY, "E-commerce")),
        ("https://www.amazon.ae/dp/B0X", False, (LOW_QUALITY, "E-commerce")),
        ("https://ubuy.vu/fr/brand/safari", False, (LOW_QUALITY, "E-commerce")),
        ("https://bahamas.desertcart.com/products/1-safari", False, (LOW_QUALITY, "E-commerce")),
        ("https://www.ambitionbox.com/reviews/x", False, (LOW_QUALITY, "Review platform")),
        ("https://play.google.com/store/apps/details?id=x", False, (LOW_QUALITY, "App store")),
        ("https://m.naukri.com/x", False, (LOW_QUALITY, "Job listing")),
        ("https://in.jooble.org/jdp/-100", False, (LOW_QUALITY, "Job listing")),
        ("https://www.justdial.com/x", False, (LOW_QUALITY, "Directory")),
        ("https://pricehistory.app/p/safari-pentagon", False, (LOW_QUALITY, "Generic listing")),
        ("https://papers.ssrn.com/sol3/papers.cfm?abstract_id=1", False, (LOW_QUALITY, "Academic paper")),
        ("https://x.blogspot.com/2026/01/p.html", False, (LOW_QUALITY, "Blog")),
        ("https://sbisupercoop.org/aticles-market/VIPIND-x-39-3802", False, (SPAM, "Content farm")),
        ("https://www.siam.in/aticles-market/Why-Debate-48-973", False, (SPAM, "Content farm")),
        ("https://www.pacess.in/expert-time/Government-Plans-38-1", False, (SPAM, "Content farm")),
        ("https://cms.nia.ac.in/aticles-market/Safari-51-13620", False, (SPAM, "Content farm")),
        ("https://corpus.kg/product/category/1253328051890", False, (SPAM, "Content farm")),
        ("https://povod.si/product-similar-image/?19223995031680", False, (SPAM, "Content farm")),
        ("https://rcell.com.br/product/review/1253328051770", False, (SPAM, "Content farm")),
        ("https://cabal-app.com/shop/manufacturer-site?&transition=top19223785072700", False, (SPAM, "Content farm")),
        ("https://adoptparfums.am/?u=7478358001440", False, (SPAM, "Content farm")),
        ("https://m.umurunga.com/?1de38b4=29_1666132_1_96", False, (SPAM, "Content farm")),
        ("https://s0nmbh4w1-amphtml.ceya-inox.re/", False, (SPAM, "Content farm")),
        ("https://cms.nia.ac.in/news/x", False, (LOW_QUALITY, "Institutional site")),
        ("https://cms.nia.ac.in/news/x", True, None),
        ("https://economictimes.indiatimes.com/x", False, None),
        ("https://www.youtube.com/watch?v=1", False, None),
        ("https://www.example.com/?q=safari", False, None),
        ("https://shop.example.com/product/category/bags", False, None),
    ],
)
def test_exclusions(link, known, want):
    assert rules.exclusion_for(link, known_media_domain=known) == want


def test_platforms_and_handles():
    assert rules.platform_for("https://in.linkedin.com/posts/x") == "LinkedIn"
    assert rules.platform_for("https://youtu.be/abc") == "YouTube"
    assert rules.platform_for("https://www.threads.com/@a/post/1") == "Other Sources"
    assert rules.platform_for("https://economictimes.indiatimes.com/x") is None
    assert rules.handle_for_link("Twitter", "https://x.com/moneycontrolcom/status/1") == "moneycontrolcom"
    assert rules.handle_for_link("YouTube", "https://www.youtube.com/@CNBCTV18/videos") == "CNBCTV18"
    assert rules.handle_for_link("Instagram", "https://www.instagram.com/vipbagsindia/") == "vipbagsindia"
    assert rules.handle_for_link("Instagram", "https://www.instagram.com/p/DdjT1BxTINs/") == ""
    assert rules.handle_for_link("LinkedIn", "https://in.linkedin.com/posts/acme-ltd_launch-activity-1") == "acme-ltd"
    assert rules.author_for_link("Facebook", "https://www.facebook.com/watch/?v=1", "Fallback") == "Fallback"
    assert rules.clean_byline("Instagram", "lg_indiaVerified") == "lg_india"
    assert rules.clean_byline("Twitter", "someVerified") == "someVerified"


@pytest.mark.parametrize(
    ("platform", "link", "profile"),
    [
        ("Twitter", "https://x.com/KaushalGarodia", True),
        ("Twitter", "https://x.com/KaushalGarodia/status/1", False),
        ("Instagram", "https://www.instagram.com/Grow_With_Abhinash/", True),
        ("Instagram", "https://www.instagram.com/reel/DdjvWsPTBUM/", False),
        ("LinkedIn", "https://uk.linkedin.com/in/margaretdevlin", True),
        ("LinkedIn", "https://in.linkedin.com/company/acme/about", True),
        ("LinkedIn", "https://in.linkedin.com/posts/acme_launch-activity-1", False),
        ("LinkedIn", "https://in.linkedin.com/company/acme/jobs", False),
        ("YouTube", "https://m.youtube.com/@patersoncapital/videos?view=0", True),
        ("YouTube", "https://www.youtube.com/watch?v=1", False),
        ("Facebook", "https://www.facebook.com/61592628933435/", True),
        ("Facebook", "https://www.facebook.com/page/videos/a-video-123/", False),
        ("Facebook", "https://www.facebook.com/watch/?v=1", False),
        ("Reddit", "https://www.reddit.com/r/india/comments/1/x/", False),
    ],
)
def test_profile_pages(platform, link, profile):
    assert rules.is_profile_page(platform, link) is profile


def test_linkedin_job_listing():
    assert rules.platform_exclusion("LinkedIn", "https://in.linkedin.com/jobs/view/1") == (LOW_QUALITY, "Job listing")
    assert rules.platform_exclusion("LinkedIn", "https://in.linkedin.com/posts/a_b") is None


def test_canonical_url_keeps_content_parameters():
    assert rules.canonical_url("https://a.com/x?utm_source=g&id=5#f") == "a.com/x?id=5"
    assert rules.canonical_url("https://youtube.com/watch?v=abc&si=z") == "youtube.com/watch?v=abc"
    assert rules.canonical_url("https://youtube.com/watch?v=abc") != rules.canonical_url(
        "https://youtube.com/watch?v=x"
    )
    assert rules.canonical_url("http://www.a.com/x/") == rules.canonical_url("https://a.com/x")
    assert rules.canonical_url("https://www.facebook.com/P?locale=hy_AM") == rules.canonical_url(
        "https://www.facebook.com/P?locale=th_TH"
    )


def test_text_keys():
    assert rules.text_key("VIP Q4 results are out!!") == rules.text_key("vip q4 results are out")
    assert rules.text_key("Instagram") is None  # too generic to call two rows the same story
    assert rules.text_key("Café opens today in Pune") == "cafe opens today in pune"
    assert rules.exempt_from_text_dedupe("Major Media", "Core")
    assert not rules.exempt_from_text_dedupe("Major Media", "Level 1")


def test_dates_are_absolute_or_blank():
    assert rules.parse_abs_date("2026-05-15T10:00:00Z") == dt.date(2026, 5, 15)
    for v in ("2w", "rel:4mo", "3 weeks ago", "yesterday", "", None, "1776-07-04", "2026-02-30"):
        assert rules.parse_abs_date(v) is None
    assert rules.assert_no_derived_dates([{"Date": "", "Date Source": "missing"}]) == []
    assert rules.assert_no_derived_dates([{"Date": "2026-05-15", "Date Source": "export"}]) == []
    assert len(rules.assert_no_derived_dates([{"Date": "2026-05-15", "Date Source": "page-approx"}])) == 1
    assert len(rules.assert_no_derived_dates([{"Date": "2 weeks ago", "Date Source": "page"}])) == 1


def test_shipping_checks():
    assert rules.assert_buckets(["Major Media", "E-commerce", "Brand Owned", "YouTube", ""]) == [
        "Brand Owned",
        "E-commerce",
    ]
    assert rules.assert_opening_text([{"Opening Text": "Same.", "Hit Sentence": "same"}]) == [2]
    assert rules.assert_opening_text([{"Opening Text": "", "Hit Sentence": "x"}]) == []


def test_cleaning_details_normalise():
    d = CleaningDetails.from_dict(
        {
            "own_websites": ["https://www.SafariBags.com/pages/x", "safaribags.com", " "],
            "own_handles": [
                "@safaribags",
                "https://www.instagram.com/safaribags/",
                "https://in.linkedin.com/company/s-ltd",
            ],
            "competitor_websites": ["vipindustries.co.in"],
        }
    )
    assert d.own_websites == ("safaribags.com",)
    assert d.own_handles == ("safaribags", "s-ltd")
    assert d.competitor_websites == ("vipindustries.co.in",)
    assert CleaningDetails.from_dict(d.to_dict()) == d


@pytest.mark.parametrize(
    "bad",
    [
        {"own_websites": ["not a site"]},
        {"own_websites": ["instagram.com"]},
        {"own_handles": ["bad handle!"]},
        {"own_handles": ["https://www.instagram.com/p/abc/"]},
        {"own_websites": ["a.com"], "competitor_websites": ["a.com"]},
        {"nope": []},
    ],
)
def test_cleaning_details_reject(bad):
    with pytest.raises(DetailsError):
        CleaningDetails.from_dict(bad)


def test_owner_matcher():
    m = OwnerMatcher(("safaribags.com",), ("safaribags", "SafariBagsIndia"))
    assert m.website("stores.safaribags.com") and m.website("safaribags.com")
    assert not m.website("notsafaribags.com")
    assert m.account("SAFARIBAGS")
    assert not m.account("safaribagsnepal")
    assert m.account("", "Safari Bags India")  # no handle in the link: the post's name stands in
    assert not m.account("", "Safari Bags Nepal")
