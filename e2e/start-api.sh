#!/usr/bin/env bash
# API for end-to-end tests: fresh temp data, fixture search backend, test verifier config, dummy keys.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$here/.tmp"
rm -rf "$tmp"
mkdir -p "$tmp/cache"
cp "$here/fixtures/verifier-config.yaml" "$tmp/config.yaml"
export PIPELINE_DATA_DIR="$tmp/data"
export URL_VERIFICATION_CONFIG="$tmp/config.yaml"
export URL_VERIFICATION_CACHE="$tmp/cache"
export PIPELINE_SEARCH_BACKEND=fixture
export PIPELINE_SEARCH_FIXTURE="$here/fixtures/search.json"
export SERPAPI_KEY=e2e-dummy DATAFORSEO_LOGIN=e2e DATAFORSEO_PASSWORD=e2e
export ANTHROPIC_API_KEY=""  # empty, so e2e never picks up a real key from .env
cd "$here/../api"
exec uv run uvicorn pipeline_api.main:create_app --factory --host 127.0.0.1 --port 8100 --timeout-graceful-shutdown 3
