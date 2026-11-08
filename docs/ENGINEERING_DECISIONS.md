# Engineering decisions

The choices that shaped Rental Software, what each one trades away, and
what would change in a production version.

## 1. Pair once per counter, not once per customer

**Decision.** A tablet pairs with a *Station* (a physical counter) using a
short-lived PIN or a QR code. The resulting `pairing_token` is stored in
`localStorage` on both devices and reused for the whole shift. A new
contract is pushed to the tablet over the already-open channel.

**Why.** Counter agents handle dozens of customers per shift. Pairing for
each customer adds friction at the worst moment, with a queue waiting.

**Trade-offs.** The pairing token is a long-lived bearer credential on a
shared device. It's compared in constant time (`secrets.compare_digest`),
and *Unlink* rotates it and closes every socket holding the old one with a
dedicated close code (4401), so the tablet knows it was unlinked rather
than just disconnected.

**In production:** tokens would expire, be tied to a managed device, and
the agent would have their own login.

## 2. REST is the source of truth; the WebSocket is only transport

**Decision.** Every state change (`confirm-documents`, `select-vehicle`,
`sign`, …) is a REST call that commits to Postgres and *then* broadcasts an
event on `WS /api/v1/checkout/ws/{station_id}`. The socket persists
nothing (apart from the station's active contract pointer).

**Why.** Tablets on venue Wi-Fi drop connections. If the socket were the
source of truth, every reconnect would risk losing data. With this design,
a device that reconnects simply calls `GET /checkout/{id}/status`, and the
current step is *inferred from persisted state*.

**Trade-off.** Each event is a REST write plus a broadcast rather than a
single socket message. That's more requests, but far simpler to reason
about. Broadcasting is in-process, so the API runs as a single instance; a
second instance would need Redis pub/sub or Postgres `LISTEN/NOTIFY`
behind the same `manager.broadcast` interface.

## 3. Business rules live in the backend

**Decision.** The rules in `CLAUDE.md` ("license unexpired and documents
verified before deposit and signature", "deposit authorized before
signing", "rental details confirmed before choosing a vehicle", "the
upsell is never the same or a lower category") are checked by the API,
not by the order of the wizard's screens.

**Why.** The wizard was reordered once (the Vehicle step moved ahead of
Documents). If the rules had lived in the screen order, that redesign
would have silently removed a legal safeguard. Because they live in the
backend, the rules survived the redesign, and `tests/test_checkout_api.py`
fails if any of them breaks.

## 4. Upselling is part of vehicle selection, not a separate step

**Decision.** One endpoint (`GET /checkout/{id}/vehicle-options`) returns a
single ranked list: the reservation's pre-assigned car, the rest of the
booked category, then the best two cars of each higher category with
their extra daily rate. The agent shortlists from it, and the tablet shows
upgrades side by side with the booked cars.

**Why.** A separate "would you like to upgrade?" screen after the client
has already chosen asks them to reconsider a decision they just made.
Showing the upgrade next to the alternatives lets them compare like for
like (seats, trunk, transmission, price per day and for the whole rental)
at the moment they're choosing. The rule that an upgrade is never the same
or a lower category is checked by `select-vehicle`, so no UI change can
break it. Upgrades are priced against the booked category, even after the
client switches to a different car.

## 5. AI reads documents; a person confirms them

ID and license photos go to Claude (vision) for OCR. The result is only a
*proposal*: `documents.py` never writes to the driver record. The agent
edits the proposal and confirms it through `confirm-documents`, which is
the only thing that sets `documents_verified`.

**Why.** OCR mistakes on a legal document are costly, and someone has to be
accountable for the check. `SKIP_DOCUMENT_OCR` returns canned data so
development and demos don't spend API credits.

## 6. Postgres everywhere, including tests

The schema uses native Postgres enums and is managed by Alembic (six
migrations so far). The tests run against a real Postgres, both locally and
in CI as a service container, instead of SQLite. Testing on a different
database would hide exactly the problems migrations and enums cause. The
test suite requires an explicit `TEST_DATABASE_URL` and never falls back to
`DATABASE_URL`, because it reseeds the database.

## 7. Free hosting, honestly handled

The backend runs on Render's free tier, which sleeps when idle; the first
request then takes 30–60 s. Instead of paying for an always-on instance or
using a keep-alive ping, the frontend's `BackendWakeGate` checks `/health`
first. If the backend doesn't answer within 1.5 s, it explains that the
server is waking up and shows progress. A warm backend never shows that
screen.

The same sleep keeps the public demo fresh. With `DEMO_RESEED_ON_STARTUP`
on, the backend reruns `seed.py` every time it starts, so each new visitor
gets a full fleet and pickups dated from today, not whatever earlier
visitors' check-outs left behind. It only starts after ~15 idle minutes,
so nobody is mid-check-out when it happens. The seed keeps at least three
available cars in every category at every branch, and a test enforces it.

## Known gaps (deliberate, for a prototype)

- Deposit authorization is stubbed; there is no payment gateway.
- Report and pre check-in links have no expiring tokens.
- Agents have no login; the station's pairing is the only credential.
- The tablet's Extras step shows list prices even when a tier makes an
  extra free; the backend correctly charges `applied_price = 0`, but the
  tablet doesn't show it yet.
