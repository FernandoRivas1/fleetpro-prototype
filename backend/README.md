# Fleetpro backend

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

## Run the API

```bash
uvicorn app.main:app --reload
```
