# Ticash Pay — Phase 1 · Step-by-step testing guide

This guide lets you **prove every Phase 1 feature works**, by hand. Each step has an
**action** and the **expected result** that proves it.

The server is running with the in-memory store at **http://localhost:3000**.
(In-memory = data resets on restart — perfect for a demo. To run on real PostgreSQL
instead: `docker compose up -d db && npm run migrate && npm run dev`.)

> The single most important thing to show: **after every operation, reconciliation
> still says “✓ bate” — Σ per currency = 0, 0 divergences.** That is the proof that
> "saldo = Σ ledger" and no money is ever created, lost, or left incoherent.

---

## 0. Confirm it's running (browser)

| Action | Expected |
|--------|----------|
| Open http://localhost:3000/health | `{"status":"ok"}` |
| Open **http://localhost:3000/admin** | The dark “Ticash Pay · Painel Admin” panel loads with data |

---

## 1. The core: ledger + reconciliation (prove integrity)

On the **/admin** page, look at the **COMPLIANCE · RECONCILIAÇÃO** box:

| Check | Expected |
|-------|----------|
| Σ BRL | `0.00 ✓` |
| Σ HTG | `0.00 ✓` |
| Cache divergências | `0` |
| Resultado | `✓ bate` |

✅ **Proves:** every centavo is accounted for; the cached balances equal the sum of the
immutable ledger postings. Keep an eye on this box during every step below — it must
stay `✓ bate`.

Also verify the JSON directly: open http://localhost:3000/reconciliation →
`{"perCurrencyTotals":{"BRL":"0","HTG":"0"},"cacheDivergences":[],"balanced":true,"consistent":true}`

---

## 2. Each feature, through the admin UI (no commands needed)

Use the **OPERAÇÕES** panel on /admin. After each action a green toast appears, the
**LEDGER** feed gets new rows, **SALDOS** updates, and **reconciliation stays ✓ bate**.

> Tip: the seed already created `jean`, `souza`, `pedro`, `loja-sp`. For the registration
> steps below use **new** names (e.g. `maria`, `loja-rio`) so you don't hit “already exists”.

### 2.1 Register a customer
- Tab **Registrar cliente** → type `maria` → **Executar**.
- ✅ Expected: toast “✓ Registrar cliente ok”; `maria` appears in **CLIENTES & AGENTES** with `pending · L0`.

### 2.2 Set KYC
- Tab **KYC** → cliente `maria`, status `approved` → **Executar**.
- ✅ Expected: `maria` chip turns green `approved · L2`.

### 2.3 Register an agent
- Tab **Registrar agente** → `loja-rio`, limite `12000` → **Executar**.
- ✅ Expected: `loja-rio` appears under AGENTE with `12000.00 BRL`.

### 2.4 Fund a wallet (simulated PIX in)
- Tab **Fund wallet** → cliente `maria`, valor `300` → **Executar**.
- ✅ Expected: feed shows `fund_wallet`; `customer:maria:wallet:BRL` = `300.00`; reconciliation `✓ bate`.

### 2.5 Agent float top-up
- Tab **Float top-up** → agente `loja-rio`, valor `2000` → **Executar**.
- ✅ Expected: `agent:loja-rio:agent_float:BRL` = `2000.00`.

### 2.6 Cash-in (customer hands cash to agent)
- Tab **Cash in** → agente `loja-rio`, cliente `maria`, valor `100` → **Executar**.
- ✅ Expected: agent float `2000 → 1900`, maria wallet `300 → 400`. (Float down, wallet up; balanced.)

### 2.7 Cash-out (customer takes cash from agent)
- Tab **Cash out** → agente `loja-rio`, cliente `maria`, valor `50` → **Executar**.
- ✅ Expected: maria wallet `400 → 350`, agent float `1900 → 1950`.

### 2.8 International transfer BR → HT (the headline feature)
- Tab **Transfer BR→HT** → remetente `maria`, destinatário `Pierre`, envia `100`, taxa `5` → **Executar**.
- ✅ Expected in the feed (one business event, several balanced postings):
  - `maria` wallet debited **−105.00 BRL** (100 + 5 fee)
  - `fee_revenue` **+5.00 BRL**
  - `fx_position:BRL` **+100.00**, `fx_position:HTG` **−2436.00**
  - `payout_suspense:HTG` **+2436.00 HTG** (100 × 24.36 rate)
- ✅ Reconciliation still `✓ bate` (BRL and HTG each net to 0).

✅ **Proves:** multi-currency transfer with FX + fee, modeled as balanced double-entry —
the recipient amount is computed exactly (no floating-point drift) and parked for payout.

---

## 3. Safety properties (prove it can't go wrong) — Git Bash terminal

Open **Git Bash** in the `ticash-pay` folder. `B=http://localhost:3000`.

### 3.1 Idempotency — the same request never double-charges
```bash
B=http://localhost:3000
# fund with a FIXED idempotency key, twice:
curl -s -H content-type:application/json -X POST $B/transactions/fund-wallet \
  -d '{"customerId":"idem-test","currency":"BRL","amount":"500.00","idempotencyKey":"PROOF-1"}' >/dev/null
curl -s -H content-type:application/json -X POST $B/transactions/fund-wallet \
  -d '{"customerId":"idem-test","currency":"BRL","amount":"500.00","idempotencyKey":"PROOF-1"}' >/dev/null
# balance must be 500.00, NOT 1000.00:
curl -s "$B/accounts/balance?ownerType=customer&ownerId=idem-test&kind=wallet&currency=BRL"
```
✅ Expected: `{"accountKey":"customer:idem-test:wallet:BRL","balanceMinor":"50000"}` (= R$500.00, charged once).

### 3.2 Overdraft is impossible
```bash
curl -s -o /dev/null -w "%{http_code}\n" -H content-type:application/json -X POST $B/transactions/cash-out \
  -d '{"agentId":"x","customerId":"broke","currency":"BRL","amount":"10.00","idempotencyKey":"OD-1"}'
```
✅ Expected: `409` (insufficient funds — a wallet can never go negative).

### 3.3 Bad input is rejected
```bash
# unsupported currency
curl -s -o /dev/null -w "%{http_code}\n" -H content-type:application/json -X POST $B/transactions/fund-wallet \
  -d '{"customerId":"x","currency":"XYZ","amount":"1.00","idempotencyKey":"V-1"}'
# more decimals than the currency allows
curl -s -o /dev/null -w "%{http_code}\n" -H content-type:application/json -X POST $B/transactions/fund-wallet \
  -d '{"customerId":"x","currency":"BRL","amount":"1.234","idempotencyKey":"V-2"}'
```
✅ Expected: `400` for both.

---

## 4. Run the automated test suites (the strongest proof)

In **Git Bash** (or PowerShell) in the `ticash-pay` folder:

```bash
npm test
```
✅ Expected: **31 passing** (in-memory) — money math, ledger property tests, service,
HTTP API, registry. (5 Postgres tests show as “skipped” unless you opt in.)

### Optional — full Postgres verification
```bash
docker compose up -d db
RUN_PG_TESTS=1 DATABASE_URL=postgres://ticash:ticash@localhost:5432/ticash npx vitest run
```
✅ Expected: **37 passing** (adds the real-database integration + pool tests).

### Optional — the deep end-to-end script (server must be running)
```bash
B=http://localhost:3000 bash scripts/deep-e2e.sh
```
✅ Expected: **34 passed, 0 failed** — health, registration, KYC, money ops with exact
balances, idempotency, all error paths (400/404/409), USDT scale-6 precision, and
reconciliation.

### Optional — render the admin in a real browser (headless)
```bash
npx playwright install chromium      # one-time
npm run screenshot                   # writes admin-screenshot.png, 0 console errors
```

---

## 5. Inspect the raw data anytime (browser GET)

| URL | Shows |
|-----|-------|
| http://localhost:3000/balances | every account balance |
| http://localhost:3000/ledger | the append-only ledger feed |
| http://localhost:3000/reconciliation | the integrity check |
| http://localhost:3000/customers | registered customers + KYC |
| http://localhost:3000/agents | registered agents |

---

## What each part proves (summary for the client)

| Feature | Proven by |
|---------|-----------|
| Auditable append-only ledger | §1, §5 ledger feed + reconciliation |
| Balance = Σ ledger (no money lost) | §1 reconciliation `✓ bate` after every op |
| Cash-in / cash-out / float | §2.5–2.7 |
| International transfer + FX + fee | §2.8 |
| KYC (manual) + agent registry | §2.1–2.3 |
| Idempotency (no double-charge) | §3.1 |
| Overdraft impossible | §3.2 |
| Input validation | §3.3 |
| Correctness under load / edge cases | §4 automated suites + deep-e2e |
