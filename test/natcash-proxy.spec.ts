import http from 'node:http';
import net from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { proxiedHttpClient } from '../src/payments/types';

/**
 * Proves proxiedHttpClient() egresses THROUGH the configured proxy — the mechanism
 * that makes BenCash/Natcash calls come from the single whitelisted static IP.
 * Uses an in-process forward proxy + target so it runs with no network.
 */
describe('proxiedHttpClient', () => {
  let target: http.Server;
  let proxy: http.Server;
  let targetPort = 0;
  let proxyPort = 0;
  let proxyHits = 0;

  beforeAll(async () => {
    target = http.createServer((_req, res) => res.end('TARGET_OK'));
    await new Promise<void>((r) => target.listen(0, '127.0.0.1', r));
    targetPort = (target.address() as net.AddressInfo).port;

    proxy = http.createServer((req, res) => {
      proxyHits++; // absolute-form (http target)
      const u = new URL(req.url as string);
      const p = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: req.method }, (pr) => {
        res.writeHead(pr.statusCode ?? 502);
        pr.pipe(res);
      });
      req.pipe(p);
    });
    proxy.on('connect', (req, clientSocket, head) => {
      proxyHits++; // CONNECT tunnel (https target)
      const [h, p] = (req.url as string).split(':');
      const srv = net.connect(Number(p), h, () => {
        clientSocket.write('HTTP/1.1 200 Connection established\r\n\r\n');
        srv.write(head);
        srv.pipe(clientSocket);
        clientSocket.pipe(srv);
      });
    });
    await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', r));
    proxyPort = (proxy.address() as net.AddressInfo).port;
  });

  afterAll(() => {
    target.close();
    proxy.close();
  });

  it('routes the request through the proxy', async () => {
    const client = proxiedHttpClient(`http://127.0.0.1:${proxyPort}`);
    const res = await client.request({ url: `http://127.0.0.1:${targetPort}/pay`, method: 'GET', headers: {} });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('TARGET_OK');
    expect(proxyHits).toBeGreaterThan(0); // it did NOT go direct
  });
});
