import { HttpClient, fetchHttpClient } from '../payments/types';
import { AirtimePort, AirtimeProduct, AirtimeSendRequest, AirtimeSendResult } from './types';

/**
 * DingConnect mobile-airtime adapter. Auth = `api_key` header. NOTE: DingConnect's
 * edge blocks requests without a browser-like User-Agent (returns an empty 403), and
 * each key is locked to whitelisted IPs — both are required. Endpoints:
 *   GET  /GetBalance
 *   GET  /GetProducts?countryIsos=HT
 *   POST /SendTransfer { SkuCode, SendValue, SendCurrencyIso, AccountNumber, DistributorRef }
 * (Confirmed against the live API.)
 */
export interface DingConfig {
  base: string; // https://api.dingconnect.com/api/V1
  apiKey: string;
}

const UA = 'TicashPay/1.0 (+https://ticashpay.com)';

export class DingConnectAdapter implements AirtimePort {
  readonly name = 'dingconnect';
  constructor(private readonly cfg: DingConfig, private readonly http: HttpClient = fetchHttpClient) {}

  async balance(): Promise<{ amount: number; currency: string }> {
    const b = await this.get('GetBalance');
    return { amount: Number(b.Balance ?? 0), currency: String(b.CurrencyIso ?? '') };
  }

  async products(countryIso: string): Promise<AirtimeProduct[]> {
    const b = await this.get(`GetProducts?countryIsos=${encodeURIComponent(countryIso)}`);
    return (b.Items ?? []).map((it: any) => ({
      skuCode: it.SkuCode,
      providerCode: it.ProviderCode,
      sendValue: Number(it.Maximum?.SendValue ?? it.Minimum?.SendValue ?? 0),
      sendCurrency: String(it.Maximum?.SendCurrencyIso ?? it.Minimum?.SendCurrencyIso ?? ''),
      receiveValue: Number(it.Maximum?.ReceiveValue ?? it.Minimum?.ReceiveValue ?? 0),
      receiveCurrency: String(it.Maximum?.ReceiveCurrencyIso ?? it.Minimum?.ReceiveCurrencyIso ?? ''),
    }));
  }

  async send(req: AirtimeSendRequest): Promise<AirtimeSendResult> {
    const body = {
      SkuCode: req.skuCode,
      SendValue: req.sendValue,
      SendCurrencyIso: req.sendCurrency,
      AccountNumber: req.accountNumber,
      DistributorRef: req.distributorRef,
      ValidateOnly: false,
    };
    const b = await this.post('SendTransfer', body);
    if (Number(b.ResultCode) !== 1) {
      throw new AirtimeError(`dingconnect SendTransfer failed: ${(b.ErrorCodes ?? []).join(',') || b.ResultCode}`, b);
    }
    const ref = b.TransferRecord?.TransferId ?? b.TransferRecord?.TransferRef ?? b.TransferRecord?.DistributorRef ?? req.distributorRef;
    return { providerRef: String(ref), raw: b };
  }

  // --- helpers --------------------------------------------------------------

  private headers(json = false): Record<string, string> {
    return { api_key: this.cfg.apiKey, accept: 'application/json', 'user-agent': UA, ...(json ? { 'content-type': 'application/json' } : {}) };
  }
  private async get(path: string): Promise<any> {
    const res = await this.http.request({ url: `${this.cfg.base}/${path}`, method: 'GET', headers: this.headers() });
    return parse(res.status, await res.text(), path);
  }
  private async post(path: string, body: unknown): Promise<any> {
    const res = await this.http.request({ url: `${this.cfg.base}/${path}`, method: 'POST', headers: this.headers(true), body: JSON.stringify(body) });
    return parse(res.status, await res.text(), path);
  }
}

export class AirtimeError extends Error {
  constructor(message: string, readonly providerBody?: unknown) {
    super(message);
    this.name = 'AirtimeError';
  }
}

function parse(status: number, text: string, path: string): any {
  let json: any = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { _raw: text };
  }
  if (status >= 300) throw new AirtimeError(`dingconnect ${path} HTTP ${status}`, json);
  return json;
}
