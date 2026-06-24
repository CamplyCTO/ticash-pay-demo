// Feed the two REAL captured Lytex webhook bodies through the built adapter to
// confirm parseWebhook verifies them and extracts the right fields.
import { LytexPaymentAdapter } from '../dist/payments/lytex-adapter.js';

const SECRET = 'g1aG0Il6y7O7Hvq3n4AYGcxJDHKNC04x3UgQ3Tb9rZsOqOmJTlxxS2WAzKfvn3GI0HJmaosNQm9g14BHo5DG7k1sXdneqlWONmqgSASUYlGeCw4CtWDmli4mbTRpczoR9yqMq1z7t9C79ZBpmK38cnRuMMQuWWNJwH8HUiLt0PmSnuFxga8M53KolOQlfOYsDzZYsGEZiF9eOMydotXavpm4fG9hhosSI2goZsyS4arES52KnCUeRtEhgFrvokVP';
const a = new LytexPaymentAdapter({ authBase: 'x', apiBase: 'x', clientId: 'x', clientSecret: 'x', callbackSecret: SECRET });

const bodies = [
  '{"webhookType":"dueInvoice","data":{"invoiceId":"6a3bfb77bdcb495da0d64b57","status":"waitingPayment","invoiceValue":5000,"client":{"name":"Jean Wilson Loute","cpfCnpj":"11144477735","email":"teste@ticashpay.com"},"referenceId":"chg-jean-5000","dueDate":"2026-06-24"},"signature":"+wXaTsKm+t36rlQVUrZOIWkBRNZ13Lzr9WeFUdjHDXw="}',
  '{"webhookType":"dueInvoice","data":{"invoiceId":"6a3bfb79bdcb495da0d64b66","status":"waitingPayment","invoiceValue":7500,"client":{"name":"Jean Wilson Loute","cpfCnpj":"11144477735","email":"teste@ticashpay.com"},"referenceId":"chg-jean-7500","dueDate":"2026-06-24"},"signature":"9SswUyDc+77+OAvPIcH5mtGaXxo9/PNpPnsqddPmJtc="}',
];

let ok = true;
for (const b of bodies) {
  const ev = a.parseWebhook(b, {});
  const good = ev && ev.providerId && ev.paid === false && ev.amountMinor != null;
  console.log((good ? 'PASS' : 'FAIL') + `  providerId=${ev && ev.providerId}  paid=${ev && ev.paid}  amountMinor=${ev && ev.amountMinor}  event=${ev && ev.event}`);
  if (!good) ok = false;
}
// Tamper check: flip a byte -> must reject.
const tampered = bodies[0].replace('"invoiceValue":5000', '"invoiceValue":500000');
console.log((a.parseWebhook(tampered, {}) === null ? 'PASS' : 'FAIL') + '  tampered body rejected');
console.log(ok ? '\nREAL WEBHOOK VERIFICATION OK' : '\nFAILED');
process.exit(ok ? 0 : 1);
