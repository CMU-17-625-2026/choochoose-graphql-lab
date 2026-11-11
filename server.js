import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { runQuery, schemaSource } from './api.js';

const assets = new Map([
  ['/', ['text/html; charset=utf-8', 'index.html']],
  ['/app.js', ['text/javascript; charset=utf-8', 'app.js']],
  ['/style.css', ['text/css; charset=utf-8', 'style.css']],
  ['/starter.graphql', ['text/plain; charset=utf-8', 'starter.graphql']],
].map(([path, [type, file]]) => [path, { type, content: readFileSync(new URL(`./public/${file}`, import.meta.url)) }]));
const MAX_BODY = 16 * 1024;

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}
export function createApp() {
  return createServer(async (req, res) => {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-methods', 'GET, HEAD, POST, OPTIONS');
    res.setHeader('access-control-allow-headers', 'content-type');
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path === '/graphql') {
      if (req.method === 'GET') { res.writeHead(303, { location: '/' }); res.end(); return; }
      if (req.method !== 'POST') {
        res.setHeader('allow', 'POST, GET, OPTIONS');
        json(res, 405, { errors: [{ message: 'Use POST /graphql with a JSON body, or open / for the editor.' }] }); return;
      }
      if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) {
        json(res, 415, { errors: [{ message: 'Content-Type must be application/json.' }] }); return;
      }
      try {
        let length = 0;
        const chunks = [];
        for await (const chunk of req) {
          length += chunk.length;
          if (length > MAX_BODY) {
            json(res, 413, { errors: [{ message: 'Sandbox request bodies are limited to 16 KiB.' }] });
            return;
          }
          chunks.push(chunk);
        }
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { json(res, 400, { errors: [{ message: 'Request body must be valid JSON.' }] }); return; }
        const { status, result } = runQuery(body);
        json(res, status, result);
      } catch {
        if (!res.headersSent) json(res, 500, { errors: [{ message: 'The sandbox could not complete this request.' }] });
        else res.end();
      }
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.setHeader('allow', 'GET, HEAD, OPTIONS'); json(res, 405, { error: 'Method not allowed.' }); return;
    }
    if (path === '/health') { json(res, 200, { status: 'ok' }); return; }
    if (path === '/schema.graphql') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }); res.end(req.method === 'HEAD' ? undefined : schemaSource); return;
    }
    const asset = assets.get(path);
    if (!asset) { json(res, 404, { error: 'Not found.' }); return; }
    res.writeHead(200, { 'content-type': asset.type });
    res.end(req.method === 'HEAD' ? undefined : asset.content);
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 3000);
  const app = createApp();
  app.requestTimeout = 15_000;
  app.headersTimeout = 10_000;
  app.listen(port, '0.0.0.0', () => console.log(`ChooChoose GraphQL Lab: http://localhost:${port}`));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => app.close());
}
