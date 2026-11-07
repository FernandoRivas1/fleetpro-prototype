# Rental Software — Counter Check-out

[![CI](https://github.com/FernandoRivas1/rental-software/actions/workflows/ci.yml/badge.svg)](https://github.com/FernandoRivas1/rental-software/actions/workflows/ci.yml)
![Python](https://img.shields.io/badge/Python-FastAPI-009688)
![TypeScript](https://img.shields.io/badge/TypeScript-React%2019-3178c6)
![Postgres](https://img.shields.io/badge/DB-Postgres-336791)
![License](https://img.shields.io/badge/license-MIT-green)

A working prototype of the car-rental **counter check-out**: from opening a
contract (with or without a prior reservation) to a signed contract and the
vehicle handover report. Two devices run the flow together, synced live: the
counter agent's **executive console** and a **client tablet** the customer
signs on.

**[Live demo →](https://rental-software-demo.vercel.app)** · open
`/executive` in one window and `/client` in another (or on a tablet), then
pair them with the PIN. The backend runs on a free tier, so the first visit
can take about a minute while it wakes up.

![Executive console and client tablet](docs/screenshots/hero.png)

## What it does

| | |
|---|---|
| **Station pairing** | A tablet pairs with a counter **once per shift** (PIN or QR). Every new contract is pushed to it over the same WebSocket channel, so the agent never has to pair again for each customer. |
| **7-step client wizard** | Rental details → Vehicle → Extras → Documents → Data → Deposit → Signature, in English or Spanish, built for touch. |
| **Vehicle ranking** | Candidate cars are scored on transmission preference, mileage vs. the fleet average, headroom until next service, and damage. The score breakdown is shown to the agent. |
| **Upselling** | Offers exactly one category up, and never the same or a lower one (enforced structurally, see below). |
| **Document OCR** | ID and license photos are read by Claude (vision) into a proposal that the agent must verify before it counts. |
| **Loyalty tiers** | Gold: deposit waived and free extras. Silver: half deposit. Corporate and Standard tiers too. Enforced in the backend, not just shown in the UI. |
| **Pre check-in** | Customers can submit documents remotely; once the agent confirms them, the counter flow skips the Documents and Data steps. |
| **Handover report** | Photos, damage diagram, km/fuel, signature → a generated PDF. |

<table>
  <tr>
    <td><img src="docs/screenshots/tablet-extras.png" alt="Tablet: extras step"></td>
    <td><img src="docs/screenshots/tablet-signed.png" alt="Tablet: contract signed"></td>
  </tr>
  <tr>
    <td align="center"><sub>Client tablet: extras</sub></td>
    <td align="center"><sub>Client tablet: contract signed</sub></td>
  </tr>
</table>

## Architecture

```mermaid
flowchart LR
    subgraph Vercel
        E[Executive console<br/>React + TypeScript]
        T[Client tablet<br/>React + TypeScript]
    end
    subgraph Render
        API[FastAPI<br/>REST + WebSocket]
    end
    DB[(Postgres · Neon<br/>Alembic migrations)]
    AI[Claude API<br/>document OCR]

    E -- REST --> API
    T -- REST --> API
    E <-. "WS /checkout/ws/{station}" .-> API
    T <-. "WS /checkout/ws/{station}" .-> API
    API --> DB
    API --> AI
```

- **REST is the source of truth; the WebSocket is transport only.** Every
  state change is a REST call that commits to Postgres and then broadcasts
  an event to the station's channel. A device that reconnects rebuilds its
  state from `GET /checkout/{id}/status`, so a dropped socket never loses
  data.
- **Business rules live in the backend.** The documents/license gate, the
  deposit requirement, "rental details before vehicle" and tier perks are
  all checked by the API and covered by tests. The UI's step order is a
  convenience, not a safeguard.
- **Domain-organized backend:** `checkout/`, `fleet/`, `reports/`,
  `shared/`, each with its own models, schemas and routers.

More detail on the trade-offs is in
[docs/ENGINEERING_DECISIONS.md](docs/ENGINEERING_DECISIONS.md).

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, React Router |
| Backend | Python, FastAPI, SQLAlchemy 2.0, Pydantic v2 |
| Database | Postgres (Neon), Alembic migrations |
| Real-time | Native FastAPI WebSockets |
| AI | Claude API (Anthropic SDK) for ID/license OCR |
| PDFs | ReportLab |
| Testing | pytest against a real Postgres, Vitest + Testing Library |
| CI/CD | GitHub Actions; Vercel (frontend) and Render (backend) |

## Running locally

**Backend** (needs a Postgres database; a free [Neon](https://neon.tech)
project works):

```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env            # then set DATABASE_URL (and optionally ANTHROPIC_API_KEY)
alembic upgrade head
python seed.py                  # sample branches, fleet, drivers, reservations
uvicorn app.main:app --reload   # http://localhost:8000/docs
```

Set `SKIP_DOCUMENT_OCR=true` to use canned OCR results without an API key.

**Frontend:**

```bash
cd frontend
npm install
npm run dev                     # http://localhost:5173
```

Open `http://localhost:5173/executive`, create a station, then open
`http://localhost:5173/client` in another window and enter the PIN.

### Demo personas (from `seed.py`)

| Driver | Tier | Try it to see… |
|---|---|---|
| Maria Gonzalez | Gold | deposit waived, free child seat; her reservation was prepaid online |
| Valentina Muñoz | Silver | half deposit |
| Felipe Soto | Standard | the baseline flow |
| Jorge Alvarez | Corporate | an **expired license**, which blocks the deposit and signature |
| Isidora Paredes | Corporate | the Corporate tier with a valid license |
| Camila Rojas | — | a first-time walk-in with no documents on file |

## Tests

```bash
# backend: needs a throwaway Postgres database (the suite reseeds it)
cd backend
pip install -r requirements-dev.txt
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/rental_test pytest

# frontend
cd frontend && npm test
```

The backend suite runs the full check-out over HTTP against a migrated,
seeded Postgres: pairing, every tier, the expired-license and
unverified-documents gates, duplicate national IDs, vehicle double-booking
and upsell rules. It also has unit tests for the ranking and tier logic.
CI runs everything, plus lint and a production build, on every pull request.

## How this was built

I designed and directed this project and built it with AI assistance:
**Claude Design** for the screen designs and **Claude Code** for most of
the implementation. [`CLAUDE.md`](CLAUDE.md) is the product context I wrote
and maintained for the AI. It covers the business rules, the data model,
the scope boundaries, and what must be enforced server-side. My role was
the product and technical lead's: defining the domain and its rules,
making architecture decisions, reviewing changes through pull
requests, and testing the flow end to end.

## Scope and disclaimers

- A **prototype** with **synthetic data only**. Every person, plate and
  reservation is made up.
- Out of scope by design: quoting/pricing, real payment gateway (deposit
  authorization is stubbed), check-in/returns, invoicing.
- Report links and the pre check-in portal use simple stub access checks
  and are not production-grade authentication.

## License

[MIT](LICENSE)
