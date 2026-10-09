COMPANY_MONITOR_DIR ?= $(HOME)/Desktop/Eminence/CompanyMonitor
URL_VERIFICATION_DIR ?= $(HOME)/Desktop/niks/url-verification
API = uv run uvicorn pipeline_api.main:create_app --factory --host 127.0.0.1 --port 8000 --timeout-graceful-shutdown 3

.PHONY: install dev start lint test e2e check

install:
	cd api && uv sync
	cd web && npm install
	cd e2e && npm install && npx playwright install chromium

dev:
	@trap 'kill 0' EXIT; \
	(cd api && $(API) --reload) & \
	(cd web && npm run dev) & \
	wait

start:
	cd web && npm run build
	@trap 'kill 0' EXIT; \
	(cd api && $(API)) & \
	(cd web && npm run start) & \
	wait

lint:
	cd api && uv run ruff check . && uv run ruff format --check . && uv run pyright
	cd web && npm run lint && npx tsc --noEmit

test:
	cd api && uv run pytest -q
	cd web && npm test
	cd $(COMPANY_MONITOR_DIR) && venv/bin/python -m unittest discover -s tests -q
	cd $(URL_VERIFICATION_DIR) && uv run pytest -q

e2e:
	cd e2e && npx playwright test

check: lint test e2e
