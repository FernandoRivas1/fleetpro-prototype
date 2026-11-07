# Rental Software backend

FastAPI + SQLAlchemy 2.0 + Alembic, organized by domain:

```
app/
  checkout/   Driver, Reservation, ReservationExtra, Station, RentalContract,
              ContractExtra, Deposit, DigitalSignature
  fleet/      ACRISSCategory, Vehicle
  reports/    PreHandoverReport, HandoverReport
  shared/     Branch, Extra, TimestampMixin, cross-domain enums
  database.py    engine / session / declarative Base
  config.py      settings (reads DATABASE_URL, ANTHROPIC_API_KEY, ...)
  models_registry.py  imports every domain's models.py — Alembic's env.py
                       and seed.py both import Base from here
  main.py     FastAPI app (health check + CORS; domain routers wire in here)
alembic/      migrations (0001_initial_schema creates all 14 tables)
seed.py       sample data — see its docstring for exactly what it inserts
```

## Setup

```bash
cd backend
python -m venv .venv && .venv/Scripts/activate   # or source .venv/bin/activate
pip install -r requirements.txt
```

Settings are read from `backend/.env` and then from the repo-root `keys.env`
(later file wins), so if `keys.env` already has `DATABASE_URL` and
`ANTHROPIC_API_KEY` you don't need a separate `backend/.env`. See
`.env.example` for the full list of variables.

## Migrate and seed

```bash
alembic upgrade head
python seed.py
```

`seed.py` clears and re-inserts its own rows each time it runs, so it's
safe to re-run after schema changes.

The public demo sets `DEMO_RESEED_ON_STARTUP=true`, which runs `seed.py`
every time the server starts. Never set it on a database whose data you
want to keep.

## Run the API

```bash
uvicorn app.main:app --reload
```

## Tests

The suite runs against a real Postgres database, which it migrates and
**reseeds before every API test**, so point it at a throwaway database.
It reads only `TEST_DATABASE_URL` and refuses to run without it; it never
falls back to `DATABASE_URL`.

```bash
pip install -r requirements-dev.txt
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/rental_test pytest
```

- `tests/test_rules.py`: unit tests for tier perks, the documents gate,
  vehicle ranking and settings parsing (no database needed beyond import).
- `tests/test_checkout_api.py`: the check-out flow end to end over HTTP,
  including every "Critical business rule" from `CLAUDE.md`.

CI (`.github/workflows/ci.yml`) runs the same suite against a Postgres
service container on every push and pull request.
