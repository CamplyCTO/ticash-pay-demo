#!/usr/bin/env bash
# Deep end-to-end test against a running server (real Postgres).
#   B=http://127.0.0.1:3100 PSQL="<path>/psql.exe" bash scripts/deep-e2e.sh
set -u
B="${B:-http://127.0.0.1:3100}"
PASS=0; FAIL=0
ok()   { echo "  PASS · $1"; PASS=$((PASS+1)); }
bad()  { echo "  FAIL · $1 (got: $2)"; FAIL=$((FAIL+1)); }
# check(desc, expected, actual)
check(){ [ "$2" = "$3" ] && ok "$1" || bad "$1" "$3"; }
# http-code only
code(){ curl -s -o /dev/null -w "%{http_code}" -H content-type:application/json "$@"; }
jget(){ curl -s "$B$1"; }
jpost(){ curl -s -H content-type:application/json -X POST "$B$2" -d "$3"; }
field(){ node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d)$1)}catch(e){console.log('PARSE_ERR')}})"; }

echo "== A. health =="
check "health ok" '{"status":"ok"}' "$(jget /health)"

echo "== B. happy path: registration + KYC =="
check "create customer jean -> 201" 201 "$(code -X POST "$B/customers" -d '{"externalId":"jean"}')"
check "create customer souza -> 201" 201 "$(code -X POST "$B/customers" -d '{"externalId":"souza"}')"
check "approve jean KYC -> 200"      200 "$(code -X POST "$B/customers/jean/kyc" -d '{"level":2,"status":"approved"}')"
check "create agent pedro -> 201"    201 "$(code -X POST "$B/agents" -d '{"externalId":"pedro","floatLimit":"15000.00","commissionBps":75}')"
check "jean kycStatus approved" approved "$(jget /customers | field '.find(c=>c.externalId=="jean").kycStatus')"
check "pedro floatLimitMinor 1500000" 1500000 "$(jget /agents | field '.find(a=>a.externalId=="pedro").floatLimitMinor')"

echo "== C. happy path: money ops + exact balances =="
check "fund jean 1240 -> 200"  200 "$(code -X POST "$B/transactions/fund-wallet" -d '{"customerId":"jean","currency":"BRL","amount":"1240.00","idempotencyKey":"h-fund"}')"
check "float pedro 8450 -> 200" 200 "$(code -X POST "$B/agents/float-topup" -d '{"agentId":"pedro","currency":"BRL","amount":"8450.00","idempotencyKey":"h-float"}')"
check "cashin souza 250 -> 200" 200 "$(code -X POST "$B/transactions/cash-in" -d '{"agentId":"pedro","customerId":"souza","currency":"BRL","amount":"250.00","idempotencyKey":"h-ci"}')"
XF=$(jpost x /transactions/transfer '{"senderId":"jean","recipientRef":"Marie/MonCash","fromCurrency":"BRL","toCurrency":"HTG","sendAmount":"500.00","feeAmount":"12.50","rate":"24.36","idempotencyKey":"h-xfer"}')
check "transfer receiveMinor 1218000 HTG" 1218000 "$(echo "$XF" | field '.quote.receiveMinor')"
CORR=$(echo "$XF" | field '.correlationId')
check "settle payout -> 200" 200 "$(code -X POST "$B/transactions/settle-payout" -d "{\"currency\":\"HTG\",\"amount\":\"12180.00\",\"correlationId\":\"$CORR\",\"externalRef\":\"mc-1\",\"idempotencyKey\":\"h-payout\"}")"
check "jean wallet = 72750"        72750 "$(jget '/accounts/balance?ownerType=customer&ownerId=jean&kind=wallet&currency=BRL' | field '.balanceMinor')"
check "pedro float = 820000"       820000 "$(jget '/accounts/balance?ownerType=agent&ownerId=pedro&kind=agent_float&currency=BRL' | field '.balanceMinor')"
check "souza wallet = 25000"       25000 "$(jget '/accounts/balance?ownerType=customer&ownerId=souza&kind=wallet&currency=BRL' | field '.balanceMinor')"
check "fee_revenue = 1250"         1250 "$(jget '/accounts/balance?ownerType=system&kind=fee_revenue&currency=BRL' | field '.balanceMinor')"
check "payout_suspense HTG = 0"    0 "$(jget '/accounts/balance?ownerType=system&kind=payout_suspense&currency=HTG' | field '.balanceMinor')"

echo "== D. idempotency =="
T1=$(jpost x /transactions/fund-wallet '{"customerId":"jean","currency":"BRL","amount":"1240.00","idempotencyKey":"h-fund"}' | field '.transactionUid')
check "replay same idempotencyKey -> same tx" "$T1" "$(jget '/accounts/balance?ownerType=customer&ownerId=jean&kind=wallet&currency=BRL' | field '.balanceMinor' >/dev/null; jpost x /transactions/fund-wallet '{"customerId":"jean","currency":"BRL","amount":"1240.00","idempotencyKey":"h-fund"}' | field '.transactionUid')"
check "jean wallet still 72750 (no double)" 72750 "$(jget '/accounts/balance?ownerType=customer&ownerId=jean&kind=wallet&currency=BRL' | field '.balanceMinor')"

echo "== E. negative / edge paths =="
check "over-precision amount -> 400" 400 "$(code -X POST "$B/transactions/fund-wallet" -d '{"customerId":"jean","currency":"BRL","amount":"1.234","idempotencyKey":"e-prec"}')"
check "unsupported currency -> 400"  400 "$(code -X POST "$B/transactions/fund-wallet" -d '{"customerId":"jean","currency":"XYZ","amount":"1.00","idempotencyKey":"e-ccy"}')"
check "duplicate customer -> 409"    409 "$(code -X POST "$B/customers" -d '{"externalId":"jean"}')"
check "KYC unknown customer -> 404"  404 "$(code -X POST "$B/customers/ghost/kyc" -d '{"level":1,"status":"approved"}')"
check "overdraft cash-out -> 409"    409 "$(code -X POST "$B/transactions/cash-out" -d '{"agentId":"pedro","customerId":"nofunds","currency":"BRL","amount":"10.00","idempotencyKey":"e-od"}')"
check "missing field -> 400"         400 "$(code -X POST "$B/transactions/fund-wallet" -d '{"currency":"BRL","amount":"1.00"}')"

echo "== F. multi-currency / USDT scale-6 precision =="
check "fund USDT 50 -> 200" 200 "$(code -X POST "$B/transactions/fund-wallet" -d '{"customerId":"jean","currency":"USDT","amount":"50.000000","idempotencyKey":"u-usdt"}')"
check "USDT balance = 50000000 (scale 6)" 50000000 "$(jget '/accounts/balance?ownerType=customer&ownerId=jean&kind=wallet&currency=USDT' | field '.balanceMinor')"
check "USDT over-precision (7dp) -> 400" 400 "$(code -X POST "$B/transactions/fund-wallet" -d '{"customerId":"jean","currency":"USDT","amount":"1.0000001","idempotencyKey":"u-usdt2"}')"

echo "== G. reconciliation (whole system) =="
R=$(jget /reconciliation)
check "reconciliation balanced"   true "$(echo "$R" | field '.balanced')"
check "reconciliation consistent" true "$(echo "$R" | field '.consistent')"
check "Σ BRL = 0"  0 "$(echo "$R" | field '.perCurrencyTotals.BRL')"
check "Σ HTG = 0"  0 "$(echo "$R" | field '.perCurrencyTotals.HTG')"
check "Σ USDT = 0" 0 "$(echo "$R" | field '.perCurrencyTotals.USDT')"

echo "== H. admin panel served =="
check "GET /admin -> 200" 200 "$(code "$B/admin")"

echo ""
echo "================= RESULT: $PASS passed, $FAIL failed ================="
[ "$FAIL" = "0" ]
