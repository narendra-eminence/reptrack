"""Centralized exception tuples for config loading and writing errors.

Used throughout the app to catch configuration errors consistently:
- CONFIG_LOAD_ERRORS: for load_config / list_sets_detailed (PyYAML only)
- CONFIG_WRITE_ERRORS: for save_profile / delete_set (includes ruamel.yaml)
"""

from __future__ import annotations

import yaml
from ruamel.yaml.error import YAMLError as RuamelYAMLError
from urlverify.config import ConfigError

# Errors from load_config (uses PyYAML's yaml.safe_load)
CONFIG_LOAD_ERRORS = (ConfigError, OSError, ValueError, yaml.YAMLError, AttributeError, TypeError)

# Errors from save_profile / delete_set (use ruamel.yaml internally)
CONFIG_WRITE_ERRORS = CONFIG_LOAD_ERRORS + (RuamelYAMLError,)
