"""Cleaning details for a brand set: the brand's own websites and accounts, and its competitors'.

They decide Brand Communication and Competitor Owned. They do not change what verification matches, so they are
kept by this app (one row per brand set), not in url-verification's config.yaml.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass, fields

from .media import clean_host, registrable_domain
from .rules import PLATFORMS, handle_for_link, platform_for

MAX_VALUES = 200
LABELS = {
    "own_websites": "Own websites",
    "own_handles": "Own social handles",
    "competitor_websites": "Competitor websites",
    "competitor_handles": "Competitor social handles",
}
_HOST = re.compile(r"^[a-z0-9-]+(\.[a-z0-9-]+)+$")
_HANDLE = re.compile(r"^[A-Za-z0-9_.-]{1,100}$")


class DetailsError(ValueError):
    pass


def _website(value: str, label: str) -> str:
    host = clean_host(value)
    if not host or not _HOST.match(host):
        raise DetailsError(f"{label}: {value.strip()!r} is not a website (for example safari.in)")
    if registrable_domain(host) in PLATFORMS:
        raise DetailsError(
            f"{label}: {value.strip()!r} is a social platform; add the account under social handles instead"
        )
    return host


def _handle(value: str, label: str) -> str:
    v = value.strip()
    if "/" in v and "." in v:  # a pasted profile link: keep only its handle
        platform = platform_for(v if "//" in v else "https://" + v)
        handle = handle_for_link(platform, v)
        if not handle:
            raise DetailsError(f"{label}: no account handle found in {v!r}")
        v = handle
    v = v.lstrip("@")
    if not _HANDLE.match(v):
        raise DetailsError(f"{label}: {value.strip()!r} may only contain letters, digits, _ . and -")
    return v


@dataclass(frozen=True)
class CleaningDetails:
    own_websites: tuple[str, ...] = ()
    own_handles: tuple[str, ...] = ()
    competitor_websites: tuple[str, ...] = ()
    competitor_handles: tuple[str, ...] = ()

    @classmethod
    def from_dict(cls, data: Mapping[str, object] | None) -> CleaningDetails:
        """Validate and normalise (websites to their host, handles without @ or the profile link around them)."""
        data = data or {}
        unknown = set(data) - set(LABELS)
        if unknown:
            raise DetailsError(f"Unknown field(s): {', '.join(sorted(unknown))}")
        out: dict[str, tuple[str, ...]] = {}
        for f in fields(cls):
            label = LABELS[f.name]
            raw = data.get(f.name) or []
            if not isinstance(raw, list | tuple) or not all(isinstance(v, str) for v in raw):
                raise DetailsError(f"{label} must be a list of text values")
            if len(raw) > MAX_VALUES:
                raise DetailsError(f"{label}: at most {MAX_VALUES} values")
            norm = _website if f.name.endswith("websites") else _handle
            values: dict[str, str] = {}
            for v in raw:
                if not v.strip():
                    continue
                n = norm(v, label)
                values.setdefault(n.casefold(), n)
            out[f.name] = tuple(values.values())
        own = {v.casefold() for v in out["own_websites"]} | {v.casefold() for v in out["own_handles"]}
        theirs = {v.casefold() for v in out["competitor_websites"]} | {v.casefold() for v in out["competitor_handles"]}
        both = sorted(own & theirs)
        if both:
            raise DetailsError(f"{', '.join(both)} cannot be both the brand's own and a competitor's")
        return cls(**out)

    def to_dict(self) -> dict[str, list[str]]:
        return {f.name: list(getattr(self, f.name)) for f in fields(self)}

    def is_empty(self) -> bool:
        return not any(getattr(self, f.name) for f in fields(self))


def _compact(s: object) -> str:
    return re.sub(r"[^a-z0-9]", "", str(s or "").lower())


class OwnerMatcher:
    """Whether a link (or a platform post's account) belongs to one side: the brand or its competitors."""

    def __init__(self, websites: tuple[str, ...], handles: tuple[str, ...]):
        self.websites = tuple(w.casefold() for w in websites)
        self.handles = {h.casefold() for h in handles}
        self.compact = {_compact(h) for h in handles if len(_compact(h)) >= 4}

    def website(self, host: str) -> bool:
        return any(host == w or host.endswith("." + w) for w in self.websites)

    def account(self, handle: str, *names: object) -> bool:
        """The link's handle is one of ours; or, for a link with no handle (instagram.com/p/<id>), the post's outlet
        or byline is exactly one of our handles written as a name ("Safari Bags" for safaribags)."""
        if handle:
            return handle.casefold() in self.handles
        return any(_compact(n) in self.compact for n in names if n)
