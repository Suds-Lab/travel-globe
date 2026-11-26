// Local dev server without npm: static files from public/ + /api/* through the real worker, D1 via d1.py.
import http from "node:http"; import fs from "node:fs"; import path from "node:path"; import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const [,, workerPath, pub, port] = process.argv;
const D = "http://127.0.0.1:8799";
const q = async (b) => { const r = await fetch(D, { method: "POST", body: JSON.stringify(b) }); const j = await r.json(); if (r.status !== 200) throw new Error(j.error); return j; };
const stmt = (sql, params = []) => ({ sql, params, bind: (...a) => stmt(sql, a), first: async () => (await q({ sql, params })).results[0] ?? null, all: () => q({ sql, params }), run: () => q({ sql, params }) });
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
const { default: W } = await import(workerPath);
const env = { DB: { prepare: (s) => stmt(s), batch: (ss) => q({ batch: ss.map((s) => ({ sql: s.sql, params: s.params })) }) }, ALLOW_NO_TURNSTILE: "1",
  /* optional: TURNSTILE_SITE_KEY=1x00000000000000000000AA TURNSTILE_SECRET=1x0000000000000000000000000000000AA (Cloudflare test keys, always pass) */
  ...(process.env.TURNSTILE_SITE_KEY && { TURNSTILE_SITE_KEY: process.env.TURNSTILE_SITE_KEY, TURNSTILE_SECRET: process.env.TURNSTILE_SECRET }) };
const T = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml" };
const APP = new Set(["/globe", "/usa", "/canada", "/leaderboard"]); // tab addresses serve the same page, like the worker
http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://localhost:" + port);
  if (u.pathname.startsWith("/api/")) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const r = await W.fetch(new Request(u, { method: req.method, headers: req.headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks) }), env, { waitUntil() {} });
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer())); return;
  }
  const f = path.join(pub, u.pathname === "/" || APP.has(u.pathname.replace(/\/+$/, "")) ? "index.html" : path.normalize(u.pathname));
  if (!f.startsWith(pub) || !fs.existsSync(f)) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "content-type": T[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
}).listen(+port, "127.0.0.1", () => console.log("http://localhost:" + port));
