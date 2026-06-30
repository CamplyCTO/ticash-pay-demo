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
auth(){ curl -s -H content-type:application/json "$@"; }
# OTP codes are emitted by the ConsoleOtpSender to the server log; read the latest for a phone.
LOG="${LOG:-}"
otp_for(){ grep -aF "[otp] $1 ->" "$LOG" | tail -1 | grep -oE '> [0-9]{6}' | grep -oE '[0-9]{6}'; }

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

if [ -n "$LOG" ]; then
echo "== I. WS-0 end-user auth (/app: phone+OTP -> JWT) =="
check "GET /app/me no token -> 401"  401 "$(code "$B/app/me")"
check "GET /app/me bad token -> 401" 401 "$(code -H 'authorization: Bearer bad.token.sig' "$B/app/me")"
PH1="+5511900001111"
check "register customer (self-signup) -> 201" 201 "$(code -X POST "$B/app/auth/register" -d "{\"phone\":\"$PH1\"}")"
C1=$(otp_for "$PH1")
V1=$(jpost x /app/auth/verify "{\"phone\":\"$PH1\",\"code\":\"$C1\"}")
AT1=$(echo "$V1" | field '.accessToken'); RT1=$(echo "$V1" | field '.refreshToken'); EXT1=$(echo "$V1" | field '.user.externalId')
check "verify issues an access token" true "$([ -n "$AT1" ] && [ "$AT1" != undefined ] && echo true || echo false)"
check "self-signup created a customers row" "$EXT1" "$(jget /customers | field ".find(c=>c.externalId=='$EXT1').externalId")"
check "GET /app/me with token -> 200" 200 "$(code -H "authorization: Bearer $AT1" "$B/app/me")"
check "/app/me role = customer" customer "$(auth -H "authorization: Bearer $AT1" "$B/app/me" | field '.user.role')"
check "/app/me scoped to own externalId" "$EXT1" "$(auth -H "authorization: Bearer $AT1" "$B/app/me" | field '.user.externalId')"
# admin funds the app customer; the app then sees its own balance (signup -> fund -> visible)
check "fund app-customer 100 BRL -> 200" 200 "$(code -X POST "$B/transactions/fund-wallet" -d "{\"customerId\":\"$EXT1\",\"currency\":\"BRL\",\"amount\":\"100.00\",\"idempotencyKey\":\"app-fund-$EXT1\"}")"
check "/app/me shows wallet 10000 BRL" 10000 "$(auth -H "authorization: Bearer $AT1" "$B/app/me" | field ".wallets.find(w=>w.currency=='BRL').balanceMinor")"
# refresh rotation is reuse-safe
RR=$(jpost x /app/auth/refresh "{\"refreshToken\":\"$RT1\"}"); RT2=$(echo "$RR" | field '.refreshToken')
check "refresh returns a NEW refresh token" true "$([ -n "$RT2" ] && [ "$RT2" != "$RT1" ] && [ "$RT2" != undefined ] && echo true || echo false)"
check "reusing the OLD refresh token -> 401" 401 "$(code -X POST "$B/app/auth/refresh" -d "{\"refreshToken\":\"$RT1\"}")"
check "duplicate phone signup -> 409" 409 "$(code -X POST "$B/app/auth/register" -d "{\"phone\":\"$PH1\"}")"
# a second signup is a distinct, isolated party
PH2="+5511900002222"
code -X POST "$B/app/auth/register" -d "{\"phone\":\"$PH2\"}" >/dev/null
EXT2=$(jpost x /app/auth/verify "{\"phone\":\"$PH2\",\"code\":\"$(otp_for "$PH2")\"}" | field '.user.externalId')
check "two signups get distinct externalIds" true "$([ -n "$EXT2" ] && [ "$EXT1" != "$EXT2" ] && echo true || echo false)"

echo "== J. WS-0 agent app login (admin-provisioned) + OTP rate limit =="
APH="+5511900003333"
check "admin provisions agent pedro login -> 201" 201 "$(code -X POST "$B/agents/pedro/app-login" -d "{\"phone\":\"$APH\"}")"
check "request OTP for agent -> 200" 200 "$(code -X POST "$B/app/auth/otp" -d "{\"phone\":\"$APH\"}")"
AV=$(jpost x /app/auth/verify "{\"phone\":\"$APH\",\"code\":\"$(otp_for "$APH")\"}")
AAT=$(echo "$AV" | field '.accessToken'); ART=$(echo "$AV" | field '.refreshToken')
check "agent /app/me role = agent" agent "$(auth -H "authorization: Bearer $AAT" "$B/app/me" | field '.user.role')"
check "agent /app/me scoped to pedro" pedro "$(auth -H "authorization: Bearer $AAT" "$B/app/me" | field '.user.externalId')"
check "agent logout -> 200" 200 "$(code -X POST "$B/app/auth/logout" -d "{\"refreshToken\":\"$ART\"}")"
check "refresh after logout -> 401" 401 "$(code -X POST "$B/app/auth/refresh" -d "{\"refreshToken\":\"$ART\"}")"
# OTP brute-force is rate-limited (default 5/hour); hammer until it trips
for i in 1 2 3 4 5; do code -X POST "$B/app/auth/otp" -d "{\"phone\":\"$PH2\"}" >/dev/null; done
check "OTP rate limit -> 429" 429 "$(code -X POST "$B/app/auth/otp" -d "{\"phone\":\"$PH2\"}")"

echo "== K. WS-2 customer flows (/app: quote -> send -> history, scoped + idempotent) =="
# EXT1 (customer from section I) was funded 100 BRL; fund a bit more for the send.
code -X POST "$B/transactions/fund-wallet" -d "{\"customerId\":\"$EXT1\",\"currency\":\"BRL\",\"amount\":\"400.00\",\"idempotencyKey\":\"app-fund2-$EXT1\"}" >/dev/null
CAUTH="authorization: Bearer $AT1"
check "GET /app/fx/quote no token -> 401" 401 "$(code "$B/app/fx/quote?from=BRL&to=HTG&amount=200")"
QT=$(auth -H "$CAUTH" "$B/app/fx/quote?from=BRL&to=HTG&amount=200")
check "quote: recipient nets > 0 HTG" true "$([ "$(echo "$QT" | field '.netToRecipientMinor')" -gt 0 ] && echo true || echo false)"
XF=$(auth -H "$CAUTH" -X POST "$B/app/transfers" -d "{\"recipientRef\":\"50912345678\",\"fromCurrency\":\"BRL\",\"toCurrency\":\"HTG\",\"sendAmount\":\"200.00\",\"idempotencyKey\":\"app-send-1\"}")
CORR1=$(echo "$XF" | field '.correlationId')
check "POST /app/transfers -> correlationId" true "$([ -n "$CORR1" ] && [ "$CORR1" != undefined ] && echo true || echo false)"
check "send receiveMinor > 0" true "$([ "$(echo "$XF" | field '.quote.receiveMinor')" -gt 0 ] && echo true || echo false)"
# idempotent replay: same key -> same correlationId, no second debit
XF2=$(auth -H "$CAUTH" -X POST "$B/app/transfers" -d "{\"recipientRef\":\"50912345678\",\"fromCurrency\":\"BRL\",\"toCurrency\":\"HTG\",\"sendAmount\":\"200.00\",\"idempotencyKey\":\"app-send-1\"}")
check "idempotent replay -> same correlationId" "$CORR1" "$(echo "$XF2" | field '.correlationId')"
check "history shows the transfer" true "$(auth -H "$CAUTH" "$B/app/transactions" | field '.some(r=>r.type=="transfer")')"
# wallet debited once (~500 funded - 200 send - fee), still > 250 (no double debit)
BAL=$(auth -H "$CAUTH" "$B/app/me" | field '.wallets.find(w=>w.currency=="BRL").balanceMinor')
check "wallet debited once (25000 < bal < 50000)" true "$([ "$BAL" -gt 25000 ] && [ "$BAL" -lt 50000 ] && echo true || echo false)"
check "KYC L0 cap blocks 600 -> 422" 422 "$(code -H "$CAUTH" -X POST "$B/app/transfers" -d "{\"recipientRef\":\"50912345678\",\"fromCurrency\":\"BRL\",\"toCurrency\":\"HTG\",\"sendAmount\":\"600.00\"}")"

echo "== L. WS-3 agent cash-in/out (commission accrual, scoped, reconciles) =="
# section J logged the agent out; re-login pedro (commissionBps 75 from section B)
code -X POST "$B/app/auth/otp" -d "{\"phone\":\"$APH\"}" >/dev/null
AAT2=$(jpost x /app/auth/verify "{\"phone\":\"$APH\",\"code\":\"$(otp_for "$APH")\"}" | field '.accessToken')
GAUTH="authorization: Bearer $AAT2"
code -X POST "$B/agents/float-topup" -d "{\"agentId\":\"pedro\",\"currency\":\"BRL\",\"amount\":\"2000.00\",\"idempotencyKey\":\"app-pedro-float\"}" >/dev/null
check "agent looks up customer by phone -> EXT1" "$EXT1" "$(auth -H "$GAUTH" -X POST "$B/app/agent/customer" -d "{\"phone\":\"$PH1\"}" | field '.externalId')"
check "cash-in 300 -> 201"  201 "$(code -H "$GAUTH" -X POST "$B/app/agent/cash-in"  -d "{\"customerId\":\"$EXT1\",\"currency\":\"BRL\",\"amount\":\"300.00\",\"idempotencyKey\":\"app-ci-1\"}")"
check "cash-out 100 -> 201" 201 "$(code -H "$GAUTH" -X POST "$B/app/agent/cash-out" -d "{\"customerId\":\"$EXT1\",\"currency\":\"BRL\",\"amount\":\"100.00\",\"idempotencyKey\":\"app-co-1\"}")"
# commission = 75bps * (300 + 100) = R$3.00 = 300 minor
check "agent commission = 300 (R\$3.00)" 300 "$(auth -H "$GAUTH" "$B/app/me" | field '.commission.find(w=>w.currency=="BRL").balanceMinor')"
check "customer token cannot cash-in -> 403" 403 "$(code -H "$CAUTH" -X POST "$B/app/agent/cash-in" -d "{\"customerId\":\"$EXT1\",\"currency\":\"BRL\",\"amount\":\"1.00\"}")"
check "idempotent cash-in replay -> 201 (no double)" 201 "$(code -H "$GAUTH" -X POST "$B/app/agent/cash-in" -d "{\"customerId\":\"$EXT1\",\"currency\":\"BRL\",\"amount\":\"300.00\",\"idempotencyKey\":\"app-ci-1\"}")"
RL=$(jget /reconciliation)
check "reconciliation balanced after agent ops" true "$(echo "$RL" | field '.balanced')"
check "reconciliation consistent after agent ops" true "$(echo "$RL" | field '.consistent')"

echo "== M. WS-5 push notifications (register/opt-out, scoped; dispatch best-effort) =="
check "register no token -> 401" 401 "$(code -X POST "$B/app/push/register" -d '{"expoToken":"ExponentPushToken[e2e]"}')"
check "customer registers device -> 201" 201 "$(code -H "$CAUTH" -X POST "$B/app/push/register" -d '{"expoToken":"ExponentPushToken[e2e]","platform":"ios"}')"
# a cash-in to the customer now dispatches a push (best-effort, bounded) — money op still succeeds
check "cash-in with a registered device still 201" 201 "$(code -H "$GAUTH" -X POST "$B/app/agent/cash-in" -d "{\"customerId\":\"$EXT1\",\"currency\":\"BRL\",\"amount\":\"25.00\",\"idempotencyKey\":\"app-ci-push\"}")"
check "opt-out (unregister) -> ok" true "$(auth -H "$CAUTH" -X POST "$B/app/push/unregister" -d '{"expoToken":"ExponentPushToken[e2e]"}' | field '.ok')"
else
echo "== I/J. SKIPPED auth section (set LOG=<server log path> to enable OTP capture) =="
fi

echo ""
echo "================= RESULT: $PASS passed, $FAIL failed ================="
[ "$FAIL" = "0" ]
