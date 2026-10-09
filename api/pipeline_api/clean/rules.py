"""Hard cleaning rules for RepScore runs: exclusions, dedupe keys, author and date checks.

Ported from the repscore-data-processing skill's scripts/rules.py (the reviewers' 9 and 16 September 2026 rules);
keep the domain lists in step with it. Tagging rules are not here: this app does not tag.
"""

from __future__ import annotations

import datetime as dt
import re
import unicodedata
from collections.abc import Iterable, Mapping
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from .media import clean_host, parent_hosts, registrable_domain

LOW_QUALITY = "Low Quality"
SPAM = "Spam"

_GROUPS: dict[str, tuple[str, str]] = {
    "E-commerce": (
        LOW_QUALITY,
        """amazon.in amazon.com flipkart.com myntra.com nykaa.com nykaafashion.com tatacliq.com ajio.com
        snapdeal.com shopclues.com meesho.com jiomart.com paytmmall.com ubuy.co.in ubuy.com ubuy.tl pepperfry.com
        firstcry.com croma.com reliancedigital.in vijaysales.com etsy.com ebay.in aliexpress.com shopsy.in
        limeroad.com desertcart.com blinkit.com zeptonow.com bigbasket.com""",
    ),
    "Directory": (
        LOW_QUALITY,
        """indiamart.com justdial.com tradeindia.com exportersindia.com sulekha.com yellowpages.in indiacom.com
        grotal.com asklaila.com tofler.in zaubacorp.com""",
    ),
    "Reseller / Dealer": (LOW_QUALITY, "indiabazaaronline.com bagsmart.in luggagehub.in"),
    "Generic listing": (
        LOW_QUALITY,
        """pricehistory.app pricebefore.com couponzguru.com grabon.in couponduniya.in cashkaro.com smartprix.com
        buyhatke.com""",
    ),
    "Review platform": (
        LOW_QUALITY,
        """ambitionbox.com glassdoor.co.in glassdoor.com teamblind.com grapevine.in mouthshut.com
        pissedconsumer.com consumercomplaints.in trustpilot.com sitejabber.com complaintboard.in""",
    ),
    "App store": (LOW_QUALITY, "play.google.com apps.apple.com itunes.apple.com"),
    "Job listing": (
        LOW_QUALITY,
        """naukri.com indeed.com indeed.co.in internshala.com foundit.in monsterindia.com shine.com timesjobs.com
        freshersworld.com hirist.com iimjobs.com apna.co jobsforher.com placementindia.com careerjet.co.in
        simplyhired.co.in bdjobs.com jooble.org jobsora.com""",
    ),
    "Academic paper": (
        LOW_QUALITY,
        """researchgate.net papers.ssrn.com ssrn.com academia.edu semanticscholar.org jstor.org springer.com
        sciencedirect.com""",
    ),
    "Blog": (
        LOW_QUALITY,
        "blogspot.com wordpress.com medium.com tumblr.com substack.com weebly.com wixsite.com blogger.com",
    ),
    "Content farm": (
        SPAM,
        """sbisupercoop.org slbcmadhyapradesh.in pacess.in cdranalyst.in maryheylema.nl maerchenstiftung.ch
        gestion-asetaca.co.cr vinanet.vn""",
    ),
}

#: domain -> (sheet, Exclusion Type)
EXCLUSIONS: dict[str, tuple[str, str]] = {}
for _label, (_sheet, _doms) in _GROUPS.items():
    for _d in _doms.split():
        EXCLUSIONS.setdefault(_d, (_sheet, _label))

#: Marketplaces that run one store per country domain (ubuy.vu, amazon.ae, desertcart's bahamas.desertcart.com):
#: matched on the name part of the registrable domain.
ECOMMERCE_NAMES = {"amazon", "ubuy", "desertcart", "ebay", "aliexpress", "etsy", "flipkart"}

#: Path (and query) shapes of generated doorway pages on hijacked hosts. The misspelled "aticles" is the giveaway of
#: the earnings-article farm that seeded a dozen unrelated hosts (.nl, .ch, .co.cr, .ac.in); the others are fake
#: shop pages (/product/category/<long id>, /product-similar-image/?<id>, a bare /?u=<id> root) found on 30-odd
#: unrelated hosts in the Safari run of September 2026.
SPAM_PATH_SIGNATURES = (
    re.compile(r"/aticles?-market/", re.I),
    re.compile(r"/expert-time/", re.I),
    re.compile(r"/product(?:/category(?:/view_more)?|/review|-similar-image)/\??\d{8,}", re.I),
    re.compile(r"/shop/manufacturer-site\?.*transition=top\d{8,}", re.I),
    re.compile(r"/productsearch/picturesearch\?id=\d{8,}", re.I),
    re.compile(r"^/?\?[a-z0-9]{1,8}=[\d_]{10,}$", re.I),
)
SPAM_HOST_SIGNATURES = (re.compile(r"^[a-z0-9]{6,}-amphtml\.", re.I),)

#: Institutional hosts, excluded unless the master media list knows the domain.
INSTITUTIONAL_SUFFIXES = (".ac.in", ".edu", ".edu.in", ".ac.uk", ".gov.in", ".nic.in")

#: Master media list Types that are exclusions, not coverage.
MASTER_TYPE_EXCLUSIONS = {
    "Spam / Low Quality": (SPAM, "Content farm"),
    "Business Directory": (LOW_QUALITY, "Directory"),
}

EXCLUSION_TYPES = sorted(
    {v[1] for v in EXCLUSIONS.values()}
    | {
        "Commercial",
        "Generic listing",
        "Institutional site",
        "No brand mention",
        "Profile / bio match",
        "Broken or error link",
    }
)

ALLOWED_BUCKETS = {
    "Major Media",
    "Regional Media",
    "Other Media",
    "Brand Communication",
    "Competitor Owned",
    "Twitter",
    "YouTube",
    "Reddit",
    "LinkedIn",
    "Facebook",
    "Instagram",
    "Other Sources",
}

#: registrable domain -> platform bucket. The six named platforms get their own sheets; the rest are Other Sources.
PLATFORMS = {
    "x.com": "Twitter",
    "twitter.com": "Twitter",
    "youtube.com": "YouTube",
    "youtu.be": "YouTube",
    "facebook.com": "Facebook",
    "fb.com": "Facebook",
    "fb.watch": "Facebook",
    "instagram.com": "Instagram",
    "reddit.com": "Reddit",
    "redd.it": "Reddit",
    "linkedin.com": "LinkedIn",
    "tiktok.com": "Other Sources",
    "threads.net": "Other Sources",
    "threads.com": "Other Sources",
    "bsky.app": "Other Sources",
    "quora.com": "Other Sources",
    "pinterest.com": "Other Sources",
}


def _split(link: str) -> tuple[str, str]:
    """(host, path with its query string)."""
    host = clean_host(link)
    try:
        parts = urlsplit(link if "//" in link else "//" + link)
    except ValueError:
        return host, ""
    return host, (parts.path or "") + (f"?{parts.query}" if parts.query else "")


def platform_for(link: str) -> str | None:
    host = clean_host(link)
    return PLATFORMS.get(registrable_domain(host)) if host else None


def exclusion_for(link: str, known_media_domain: bool = False) -> tuple[str, str] | None:
    """(sheet, Exclusion Type) when the link must leave Clean Data, else None.

    known_media_domain=True (the master media list matched the domain) protects a real outlet on an institutional
    suffix.
    """
    if not link:
        return None
    host, path = _split(link)
    if not host:
        return None
    if any(rx.search(path) for rx in SPAM_PATH_SIGNATURES) or any(rx.search(host) for rx in SPAM_HOST_SIGNATURES):
        return (SPAM, "Content farm")
    for cand in [*parent_hosts(host), registrable_domain(host)]:
        if cand in EXCLUSIONS:
            return EXCLUSIONS[cand]
    if registrable_domain(host).split(".")[0] in ECOMMERCE_NAMES:
        return (LOW_QUALITY, "E-commerce")
    if not known_media_domain and any(host.endswith(suf) for suf in INSTITUTIONAL_SUFFIXES):
        return (LOW_QUALITY, "Institutional site")
    return None


def platform_exclusion(platform: str, link: str) -> tuple[str, str] | None:
    """Platform pages that are listings, not posts: LinkedIn job listings."""
    _, path = _split(link)
    if platform == "LinkedIn" and path.lower().startswith("/jobs"):
        return (LOW_QUALITY, "Job listing")
    return None


# ---- text --------------------------------------------------------------------------------------------------------

_PUNCT = re.compile(r"[^\w\s]", re.UNICODE)
_WS = re.compile(r"\s+")


def normalise_text(s: object) -> str:
    """Lowercase, strip punctuation and accents, collapse whitespace."""
    if not s:
        return ""
    text = unicodedata.normalize("NFKD", str(s))
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = _PUNCT.sub(" ", text.lower())
    return _WS.sub(" ", text).strip()


def has_text(*values: object) -> bool:
    """False when nothing alphanumeric is left (empty or emoji-only rows)."""
    return any(ch.isalnum() for v in values if v for ch in str(v))


def opening_text_ok(opening_text: object, hit_sentence: object) -> bool:
    """False when Opening Text merely repeats Hit Sentence. Opening Text is the page's own lead; never the snippet."""
    o, h = normalise_text(opening_text), normalise_text(hit_sentence)
    return not o or o != h


_HANDLE_RX = {
    "Twitter": re.compile(r"(?:twitter|x)\.com/(?!i/|hashtag/|search|home\b|intent/)([^/?#]+)", re.I),
    "Instagram": re.compile(r"instagram\.com/(?!p/|reel/|reels/|explore|stories/|tv/)([^/?#]+)", re.I),
    "Facebook": re.compile(
        r"facebook\.com/(?!watch|groups|events|story\.php|permalink\.php|photo|share|reel/|profile\.php)([^/?#]+)",
        re.I,
    ),
    "YouTube": re.compile(r"youtube\.com/(?:@|c/|channel/|user/)([^/?#]+)", re.I),
    "LinkedIn": re.compile(r"linkedin\.com/(?:company|in|school|showcase)/([^/?#]+)", re.I),
    "Reddit": re.compile(r"reddit\.com/(?:r|u|user)/([^/?#]+)", re.I),
}
_LINKEDIN_POST = re.compile(r"linkedin\.com/posts/([^/?#]+?)_", re.I)


def handle_for_link(platform: str | None, link: str) -> str:
    """The account handle in a platform link ('' when the link carries none, e.g. instagram.com/p/<id>)."""
    if not platform or not link:
        return ""
    rx = _HANDLE_RX.get(platform)
    m = rx.search(link) if rx else None
    if m is None and platform == "LinkedIn":
        m = _LINKEDIN_POST.search(link)
    return m.group(1).lstrip("@") if m else ""


def author_for_link(platform: str | None, link: str, fallback: str = "") -> str:
    """Platform rows: the handle from the link, which is authoritative (exported authors are often wrong); the
    page's byline only when the link has no handle (instagram.com/p/<id>)."""
    return handle_for_link(platform, link) or (fallback or "").lstrip("@")


def clean_byline(platform: str | None, byline: str) -> str:
    """The verifier's page byline. Instagram's carries the badge text glued on ("lg_indiaVerified")."""
    b = (byline or "").strip()
    if platform == "Instagram" and b.endswith("Verified") and len(b) > len("Verified"):
        b = b[: -len("Verified")]
    return b


_PROFILE_PATHS = {
    "Twitter": re.compile(r"^/(?!i/|hashtag/|search|home/?$|explore/?$|intent/)[^/?#]+/?$", re.I),
    "Instagram": re.compile(r"^/(?!p/|reels?/|explore|stories/|tv/)[^/?#]+/?$", re.I),
    "Facebook": re.compile(
        r"^/(?:profile\.php|people/[^/]+/[^/]+|(?!watch|groups|events|story\.php|permalink\.php|photo|share|reel)"
        r"[^/?#]+(?:/(?:about|photos|videos|reviews))?)/?$",
        re.I,
    ),
    "YouTube": re.compile(
        r"^/(?:@[^/]+|c/[^/]+|channel/[^/]+|user/[^/]+)(?:/(?:videos|featured|shorts|about|streams|playlists))?/?$",
        re.I,
    ),
    "LinkedIn": re.compile(r"^/(?:in/[^/]+|company/[^/]+(?:/(?:about|people|life))?)/?$", re.I),
    "Reddit": re.compile(r"^/(?:u|user)/[^/]+/?$", re.I),
}


def is_profile_page(platform: str | None, link: str) -> bool:
    """An account's profile page (x.com/<handle>, instagram.com/<handle>/, linkedin.com/in/<person>, a YouTube
    channel page), not a post. A brand named on it is in the bio, headline or employer line, not coverage."""
    rx = _PROFILE_PATHS.get(platform or "")
    if rx is None or not link:
        return False
    try:
        path = urlsplit(link if "//" in link else "//" + link).path or "/"
    except ValueError:
        return False
    return bool(rx.match(path))


# ---- dates: absolute or blank, never derived -------------------------------------------------------------------

_ABS_DATE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})")
_RELATIVE = re.compile(
    r"^\s*(?:rel:)?\d+\s*(?:mo|w|d|h|y|min|sec)\b|\bago\b|\byesterday\b|\btoday\b|\bjust now\b"
    r"|\blast (?:week|month|year)\b",
    re.I,
)
VALID_DATE_SOURCES = ("export", "page")


def is_relative_age(value: object) -> bool:
    return bool(value) and bool(_RELATIVE.search(str(value).strip()))


def parse_abs_date(value: object) -> dt.date | None:
    """A real date from an absolute YYYY-MM-DD[...] value; None for relative ages, blanks and nonsense."""
    if value is None or value == "":
        return None
    if isinstance(value, dt.datetime):
        return value.date()
    if isinstance(value, dt.date):
        return value
    v = str(value).strip()
    if is_relative_age(v):
        return None
    m = _ABS_DATE.match(v)
    if not m:
        return None
    try:
        d = dt.date(*(int(x) for x in m.groups()))
    except ValueError:
        return None
    return d if 1990 <= d.year <= dt.date.today().year + 1 else None


def assert_no_derived_dates(rows: Iterable[Mapping[str, object]]) -> list[str]:
    """Rows whose Date has no legitimate source, or holds a relative age. Must be empty before shipping."""
    bad = []
    for i, r in enumerate(rows, start=2):
        d = str(r.get("Date") or "").strip()
        src = str(r.get("Date Source") or "").strip()
        if not d:
            if src in VALID_DATE_SOURCES:
                bad.append(f"row {i}: Date Source {src!r} but Date is blank")
        elif src not in VALID_DATE_SOURCES:
            bad.append(f"row {i}: Date filled with Date Source {src!r}")
        elif is_relative_age(d):
            bad.append(f"row {i}: Date holds a relative age ({d!r})")
    return bad


# ---- dedupe ------------------------------------------------------------------------------------------------------

#: Tracking parameters, plus display-language ones (Facebook's locale=, Google's hl=) that never change the page.
_TRACKING = {"fbclid", "srsltid", "si", "gclid", "mc_cid", "mc_eid", "igshid", "locale", "hl"}


def canonical_url(link: str) -> str:
    """The pass-1 dedupe key. Tracking and display-language parameters (utm_*, fbclid, srsltid, si, gclid, igshid,
    locale, hl) and the fragment are stripped; every other query parameter is kept (stripping them once collapsed
    500 YouTube videos into one row). Scheme, a leading www. and a trailing slash are ignored too, so http/https and
    www/non-www copies of one page are one link."""
    if not link:
        return ""
    try:
        p = urlsplit(link.strip())
    except ValueError:
        return link.strip()
    q = [
        (k, v)
        for k, v in parse_qsl(p.query, keep_blank_values=True)
        if not (k.lower().startswith("utm_") or k.lower() in _TRACKING)
    ]
    host = p.netloc.lower()
    host = host[4:] if host.startswith("www.") else host
    return urlunsplit(("", host, p.path.rstrip("/"), urlencode(q), "")).lstrip("/")


#: Normalised titles and snippets shorter than this are too generic ("Instagram", "Safari Bags on LinkedIn") to
#: call two rows the same story.
MIN_TEXT_KEY_WORDS = 4


def text_key(value: object) -> str | None:
    t = normalise_text(value)
    return t if len(t.split()) >= MIN_TEXT_KEY_WORDS else None


def exempt_from_text_dedupe(source_bucket: str, media_level: str) -> bool:
    """Core-level Major Media never loses a row to the title / hit-sentence pass."""
    return source_bucket == "Major Media" and media_level == "Core"


# ---- shipping checks ---------------------------------------------------------------------------------------------


def assert_buckets(values: Iterable[object]) -> list[str]:
    """Source Bucket values that are not allowed (an exclusion type leaking into the column)."""
    return sorted({str(v).strip() for v in values if str(v or "").strip() and str(v).strip() not in ALLOWED_BUCKETS})


def assert_opening_text(rows: Iterable[Mapping[str, object]]) -> list[int]:
    """Sheet row numbers where Opening Text is a copy of Hit Sentence."""
    return [i for i, r in enumerate(rows, start=2) if not opening_text_ok(r.get("Opening Text"), r.get("Hit Sentence"))]
