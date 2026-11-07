# Rental Software — frontend

React 19 + TypeScript + Vite. One app with separate routes for each device
and audience:

| Route | Who uses it |
|---|---|
| `/executive` | Counter agent's console: station setup, reservations, the live session panel |
| `/client` | Customer-facing tablet: the 7-step check-out wizard (EN/ES) |
| `/precheckin` | Customer's remote pre check-in portal |
| `/report/pre/:id`, `/report/new/:id` | Parking-lot handover reports |

`src/components/BackendWakeGate.tsx` wraps every route. It pings the
backend's `/health` first and, only if the free-tier server is asleep,
shows a "waking up the server" screen instead of a blank page.

## Scripts

```bash
npm install
npm run dev      # http://localhost:5173, expects the API at VITE_API_BASE_URL (default http://localhost:8000)
npm test         # Vitest + Testing Library
npm run lint     # oxlint
npm run build    # type-check + production build
```

Configuration lives in `.env` (see `.env.example`). Design tokens (colors,
type) are in `src/styles/tokens.css`.
