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
from .clean import DetailsBody, normalised

router = APIRouter()


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ExclusionsBody(_Strict):
    followed_by: list[str] = []
    preceded_by: list[str] = []
    nearby: list[str] = []
    phrases: list[str] = []


class PersonBody(_Strict):
    name: str
    require_brand_nearby: bool = False


class SentenceBody(_Strict):
    text: str
    expect: Literal["match", "no_match"]


class BrandBody(_Strict):
    name: str
    description: str = ""
    aliases: list[str] = []
    hashtags: list[str] = []
    handles: list[str] = []
    common_word: bool = False
    confirming_words: list[str] = []
    exclusions: ExclusionsBody = ExclusionsBody()
    people: list[PersonBody] = []
    tests: list[SentenceBody] = []


class ProfileBody(_Strict):
    brands: list[BrandBody]


class SaveBody(_Strict):
    profile: ProfileBody
    create: bool = False
    # The set's cleaning details, saved in the same config.yaml write. Omitted: the saved ones are left as they are.
    cleaning: DetailsBody | None = None


class CheckBody(_Strict):
    profile: ProfileBody


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
        raise ApiError(
            404, f"{name!r} was written by hand before the form existed. Create it again with the form to edit it."
        )
    return {"profile": profile_to_dict(profile)}


@router.put("/api/brand-profiles/{name}")
def save_profile(request: Request, name: str, body: SaveBody) -> dict:
    profile = _profile(body.profile)
    existing = _sets(request).get(name)
    if existing is not None and not existing.managed:
        raise ApiError(
            409,
            f"{name!r} is a hand-written set. Pick another name; the form never replaces hand-written sets.",
        )
    if existing is not None and body.create:
        raise ApiError(409, f"A set named {name!r} already exists.")
    try:
        cleaning = normalised(body.cleaning).to_dict() if body.cleaning is not None else None
        backup, warnings = brands.save_profile(_config(request), name, profile, cleaning=cleaning)
    except CONFIG_WRITE_ERRORS as e:
        raise ApiError(422, str(e)) from None
    return {
        "name": name,
        "backup": str(backup),
        "warnings": [asdict(w) for w in warnings],
        "tests": brands.check_tests(profile),
    }


@router.post("/api/brand-profiles/check")
def check(body: CheckBody) -> dict:
    profile = _profile(body.profile)
    try:
        result = build_rules(profile)
    except ProfileError as e:
        raise ApiError(422, str(e)) from None
    return {"warnings": [asdict(w) for w in result.warnings], "tests": brands.check_tests(profile, result)}
