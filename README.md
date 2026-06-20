# Ticash Pay — Phase 1: Financial Core

The auditable, append-only, double-entry **ledger** that the whole platform stands on,
plus the core money operations and a web/JSON API. This is the foundation described in
[`../implementation-plan.md`](../implementation-plan.md) (Phase 1).

> The core is financial integrity, not the apps. A wrong balance is not a bug — it is
> lost money. So balance is a **derived query over immutable postings**, never an
> overwritable column, and every operation is a **balanced double-entry journal**.

## What's implemented

- **Ledger engine** — append-only journals; each posts to ≥2 accounts; the signed sum
  per currency is always **0** (`src/ledger/engine.ts`).
- **Money** — exact integer **minor units** (`BigInt`), per-currency scale, exact
  half-up FX conversion. No floating point (`src/money/`).
- **Operations** — fund wallet, cash-in, cash-out, agent float top-up, and a
  cross-currency **transfer (BR→HT)** with FX + fee, plus payout settlement
  (`src/ledger/operations.ts`).
- **Idempotency** — every operation carries an idempotency key; replays never
  double-post.
- **Overdraft control** — user-facing accounts (wallet, agent float) can't go negative.
- **Reconciliation** — per-currency closure (Σ = 0) and balance-cache vs `SUM(postings)`.
- **Two storage adapters behind one port** (`LedgerStore`):
  - `InMemoryLedgerStore` — for tests, the demo, and as the executable spec.
  - `PgLedgerStore` — PostgreSQL with `SERIALIZABLE` tx + `SELECT … FOR UPDATE`;
    the DB also enforces the invariants via triggers (`db/migrations/0001_init.sql`).
- **HTTP API** — Fastify + Zod-validated routes (`src/api/`).

## Architecture (ports & adapters)

```
operations (pure)         engine (pure invariants)
        \                 /
         LedgerService  ──►  LedgerStore (port)
                                 ├── InMemoryLedgerStore  (tests / demo)
                                 └── PgLedgerStore         (production)
HTTP: Fastify routes ──► LedgerService
```

> **Framework note:** the platform plan names NestJS for the long term. Phase 1 uses a
> lean **Fastify** layer to keep the dependency surface small and the ledger front and
> centre; the service/domain layer is framework-agnostic, so moving to NestJS later is
> a thin adapter swap, not a rewrite.

## Run it

### Zero-setup demo (no database)

```bash
npm install
npm run demo      # runs the Jean → Marie BR→HT story on the in-memory store
npm test          # 17 tests incl. fast-check property tests
```

The demo prints balances, the append-only ledger feed, and a reconciliation showing
**Σ per currency = 0, 0 divergences**.

### API + admin panel against the in-memory store

```bash
STORE=memory npm run dev
curl localhost:3000/health
# open the live admin panel in a browser:
#   http://localhost:3000/admin
```

The **admin panel** (`public/admin.html`, served at `/admin`) is a live, data-driven UI:
KPIs, the append-only ledger feed, balances, the reconciliation widget
(`saldo = Σ ledger ✓`), customer/agent + KYC registry, and operation forms
(fund, float top-up, cash-in/out, BR→HT transfer). It auto-refreshes every 4s.

A Playwright visual check renders the panel in real Chromium, asserts the rendered
values, fails on any console error, and writes `admin-screenshot.png`:

```bash
npx playwright install chromium      # one-time
STORE=memory npm run dev &           # start the server, seed some data, then:
npm run screenshot
```

### API against PostgreSQL

```bash
docker compose up -d db
cp .env.example .env
npm run migrate
npm run dev
```

### Verify the Postgres adapter against a real database

The PG adapter has a dedicated integration test (skipped by default). With Postgres up:

```bash
RUN_PG_TESTS=1 DATABASE_URL=postgres://ticash:ticash@localhost:5432/ticash \
  npx vitest run test/pg-store.integration.spec.ts
```

It exercises the real adapter (idempotency, overdraft, cross-currency transfer,
reconciliation) **and** asserts the database's own balanced-transaction trigger rejects
an unbalanced write — defense in depth, independent of the application code.

## API surface

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/admin` | Live admin panel (HTML) |
| POST | `/customers` | Register a customer |
| GET | `/customers` | List customers |
| POST | `/customers/:id/kyc` | Set manual KYC level/status |
| POST | `/agents` | Register an agent (float limit, commission) |
| GET | `/agents` | List agents |
| POST | `/transactions/fund-wallet` | External money → customer wallet |
| POST | `/transactions/cash-in` | Agent float → customer wallet |
| POST | `/transactions/cash-out` | Customer wallet → agent float |
| POST | `/agents/float-topup` | External money → agent float |
| POST | `/transactions/transfer` | Cross-currency transfer (e.g. BR→HT) |
| POST | `/transactions/settle-payout` | Settle a confirmed outbound payout |
| GET | `/accounts/balance` | Balance for one account |
| GET | `/balances` | All balances (admin view) |
| GET | `/ledger` | Append-only ledger feed |
| GET | `/reconciliation` | Per-currency closure + cache consistency |

Example:

```bash
curl -XPOST localhost:3000/transactions/transfer -H 'content-type: application/json' -d '{
  "senderId":"jean","recipientRef":"Marie/MonCash",
  "fromCurrency":"BRL","toCurrency":"HTG",
  "sendAmount":"500.00","feeAmount":"12.50","rate":"24.36",
  "idempotencyKey":"xfer-001"
}'
```

## Scope (Phase 1)

In: ledger, the operations above, idempotency, overdraft control, reconciliation, API.
Out (later phases): real PIX/MonCash/tPago integrations, automated KYC/AML, native apps,
USDT, top-up — see the root implementation plan. Integrations in Phase 1 are simulated.

## Layout

```
src/
  money/       currency catalogue + exact minor-unit + FX math
  ledger/      types, engine (invariants), operations, service, store port + 2 adapters
  api/         Fastify server + routes
  db/          pg pool + migration runner
  demo/        runnable Jean → Marie story
db/migrations/ SQL schema with balanced + append-only triggers
test/          money, operations (property), service (incl. reconciliation property)
```
