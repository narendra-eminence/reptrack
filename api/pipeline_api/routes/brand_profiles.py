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
from ..suggest import SuggestError, sanitize_suggestion

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
        raise ApiError(
            409,
            f"{name!r} is a raw set with hand-written rules. Pick another name; the form never "
            "replaces hand-written rules.",
        )
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
