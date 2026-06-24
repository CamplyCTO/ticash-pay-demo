// Reverse-engineer Lytex's webhook signature: which HMAC-SHA256 base string,
// signed with the callback secret, reproduces the `signature` field? Two real
// captured samples must BOTH match to confirm the formula.
import { createHmac } from 'node:crypto';

const SECRET = 'g1aG0Il6y7O7Hvq3n4AYGcxJDHKNC04x3UgQ3Tb9rZsOqOmJTlxxS2WAzKfvn3GI0HJmaosNQm9g14BHo5DG7k1sXdneqlWONmqgSASUYlGeCw4CtWDmli4mbTRpczoR9yqMq1z7t9C79ZBpmK38cnRuMMQuWWNJwH8HUiLt0PmSnuFxga8M53KolOQlfOYsDzZYsGEZiF9eOMydotXavpm4fG9hhosSI2goZsyS4arES52KnCUeRtEhgFrvokVP';

const samples = [
  { body: '{"webhookType":"dueInvoice","data":{"invoiceId":"6a3bfb77bdcb495da0d64b57","status":"waitingPayment","invoiceValue":5000,"client":{"name":"Jean Wilson Loute","cpfCnpj":"11144477735","email":"teste@ticashpay.com"},"referenceId":"chg-jean-5000","dueDate":"2026-06-24"},"signature":"+wXaTsKm+t36rlQVUrZOIWkBRNZ13Lzr9WeFUdjHDXw="}', sig: '+wXaTsKm+t36rlQVUrZOIWkBRNZ13Lzr9WeFUdjHDXw=' },
  { body: '{"webhookType":"dueInvoice","data":{"invoiceId":"6a3bfb79bdcb495da0d64b66","status":"waitingPayment","invoiceValue":7500,"client":{"name":"Jean Wilson Loute","cpfCnpj":"11144477735","email":"teste@ticashpay.com"},"referenceId":"chg-jean-7500","dueDate":"2026-06-24"},"signature":"9SswUyDc+77+OAvPIcH5mtGaXxo9/PNpPnsqddPmJtc="}', sig: '9SswUyDc+77+OAvPIcH5mtGaXxo9/PNpPnsqddPmJtc=' },
];

function candidates(body) {
  const o = JSON.parse(body);
  const dataStr = body.slice(body.indexOf('"data":') + 7, body.indexOf(',"signature":'));
  const bodyNoSig = body.replace(/,"signature":"[^"]*"/, '');
  return {
    'data substring (raw)': dataStr,
    'body minus signature': bodyNoSig,
    'JSON.stringify(data)': JSON.stringify(o.data),
    'webhookType+invoiceId': o.webhookType + o.data.invoiceId,
    'invoiceId': o.data.invoiceId,
    'invoiceId+status': o.data.invoiceId + o.data.status,
    'invoiceId+invoiceValue': String(o.data.invoiceId) + o.data.invoiceValue,
    'referenceId': o.data.referenceId,
    'invoiceId+webhookType': o.data.invoiceId + o.webhookType,
    'webhookType': o.webhookType,
  };
}

const encs = ['base64', 'hex', 'base64url'];
const keyForms = { 'secret-utf8': Buffer.from(SECRET, 'utf8'), 'secret-base64': safeB64(SECRET) };

function safeB64(s) { try { return Buffer.from(s, 'base64'); } catch { return Buffer.from(s); } }

const names = Object.keys(candidates(samples[0].body));
for (const keyName of Object.keys(keyForms)) {
  for (const name of names) {
    for (const enc of encs) {
      const allMatch = samples.every((s) => {
        const base = candidates(s.body)[name];
        const mac = createHmac('sha256', keyForms[keyName]).update(base, 'utf8').digest(enc);
        return mac === s.sig;
      });
      if (allMatch) console.log(`MATCH  key=${keyName}  base="${name}"  enc=${enc}`);
    }
  }
}
console.log('done (no line above = no match among tried candidates)');
