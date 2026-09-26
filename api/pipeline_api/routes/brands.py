from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request
from pydantic import BaseModel
from urlverify import brands
from urlverify.config import ConfigError

from ..errors import ApiError

router = APIRouter()


class SaveBody(BaseModel):
    rules: list[dict[str, Any]]


class TestBody(BaseModel):
    text: str
    rules: list[dict[str, Any]] | None = None
    set: str | None = None


def _config(request: Request) -> Any:
    return request.app.state.deps.settings.verifier_config


def _rules(raw: list[dict[str, Any]]) -> list[Any]:
    try:
        return [brands.rule_from_dict(d) for d in raw]
    except ConfigError as e:
        raise ApiError(422, str(e)) from None


@router.get("/api/brands")
def list_brands(request: Request) -> dict:
    import yaml
    from ruamel.yaml.error import YAMLError as RuamelYAMLError

    try:
        sets = brands.list_sets(_config(request))
    except (ConfigError, OSError, ValueError, yaml.YAMLError, RuamelYAMLError, AttributeError, TypeError) as e:
        raise ApiError(422, f"config.yaml could not be read: {e}") from None
    return {"sets": [{"name": n, "rules": [brands.rule_to_dict(r) for r in rules]} for n, rules in sets.items()]}


@router.put("/api/brands/{name}")
def save_brand(request: Request, name: str, body: SaveBody) -> dict:
    import yaml
    from ruamel.yaml.error import YAMLError as RuamelYAMLError

    try:
        backup = brands.save_set(_config(request), name, _rules(body.rules))
    except (ConfigError, OSError, ValueError, yaml.YAMLError, RuamelYAMLError, AttributeError, TypeError) as e:
        raise ApiError(422, str(e)) from None
    return {"name": name, "backup": str(backup)}


@router.delete("/api/brands/{name}")
def delete_brand(request: Request, name: str) -> dict:
    import yaml
    from ruamel.yaml.error import YAMLError as RuamelYAMLError

    try:
        backup = brands.delete_set(_config(request), name)
    except (ConfigError, OSError, ValueError, yaml.YAMLError, RuamelYAMLError, AttributeError, TypeError) as e:
        raise ApiError(422, str(e)) from None
    return {"deleted": name, "backup": str(backup)}


@router.post("/api/brands/test")
def test_brand(request: Request, body: TestBody) -> dict:
    import yaml
    from ruamel.yaml.error import YAMLError as RuamelYAMLError

    if body.set is not None:
        try:
            sets = brands.list_sets(_config(request))
        except (ConfigError, OSError, ValueError, yaml.YAMLError, RuamelYAMLError, AttributeError, TypeError) as e:
            raise ApiError(422, str(e)) from None
        if body.set not in sets:
            raise ApiError(404, f"No brand set named {body.set!r}.")
        rules = sets[body.set]
    else:
        rules = _rules(body.rules or [])
        try:
            brands.validate_set("test", rules)
        except ConfigError as e:
            raise ApiError(422, str(e)) from None
    return brands.try_rules(rules, body.text)
