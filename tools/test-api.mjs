import { webcrypto } from "node:crypto";
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const D = "http://127.0.0.1:8799";
const q = async (b) => { const r = await fetch(D, { method: "POST", body: JSON.stringify(b) }); const j = await r.json(); if (r.status !== 200) throw new Error(j.error); return j; };
const stmt = (sql, params = []) => ({ sql, params, bind: (...a) => stmt(sql, a),
  first: async () => (await q({ sql, params })).results[0] ?? null, all: async () => q({ sql, params }), run: async () => q({ sql, params }) });
const DB = { prepare: (s) => stmt(s), batch: async (ss) => q({ batch: ss.map((s) => ({ sql: s.sql, params: s.params })) }) };
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
const { default: W } = await import(process.argv[2]);
const env = { DB, ALLOW_NO_TURNSTILE: "1", TURNSTILE_SITE_KEY: "x" };
const ctx = { waitUntil() {} };
const api = async (m, p, b, tok) => { const h = {}; if (tok) h.authorization = "Bearer " + tok;
  const r = await W.fetch(new Request("https://t.example" + p, { method: m, headers: h, body: b ? JSON.stringify(b) : undefined }), env, ctx);
  return { s: r.status, j: await r.json() }; };
let pass = 0, failN = 0;
const ok = (c, msg, extra) => { if (c) pass++; else { failN++; console.log("FAIL:", msg, extra ? JSON.stringify(extra) : ""); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// join
let r = await api("POST", "/api/join", { data: { world: { FR: 3, US: 5 }, us: { NY: 2 } } });
ok(r.s === 200 && r.j.device && /^\w+ \w+ \d{4}$/.test(r.j.name), "join random name", r);
ok(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab]/.test(r.j.id), "uuidv7 id", r.j.id);
ok(r.j.ranks.world.pts === 8 && r.j.ranks.world.n === 2 && r.j.ranks.world.rank === 1 && r.j.ranks.ca.rank === null, "ranks", r.j.ranks);
const A = r.j; const devA = A.device;
r = await api("POST", "/api/join", { name: "Shneor S.", data: { world: { FR: 1 } } });
ok(r.s === 200 && r.j.name === "Shneor S." && r.j.ranks.world.rank === 2 && r.j.ranks.world.total === 2, "join with name, rank 2", r.j);
const devB = r.j.device;
// validation
for (const [n, why] of [["John Smith 1985", "random pattern"], ["x", "too short"], ["F.u.c.k you", "bad word"], ["<script>", "chars"], ["a".repeat(25), "too long"]]) {
  await sleep(1050); r = await api("PUT", "/api/me", { name: n }, devB); ok(r.s === 400, "reject name: " + why, r);
}
await sleep(1050); r = await api("PUT", "/api/me", { name: "Teal Falcon 2390" }, devB); ok(r.s === 200, "allow real random-style name", r);
r = await api("GET", "/api/suggest"); ok(r.s === 200 && /^\w+ \w+ \d{4}$/.test(r.j.name), "suggest a name", r);
r = await api("POST", "/api/join", { name: r.j.name }); ok(r.s === 200, "join with suggested name", r);
await sleep(1050); r = await api("PUT", "/api/me", { name: "Peacock Nazir" }, devB); ok(r.s === 200, "allow Peacock Nazir", r);
r = await api("POST", "/api/join", { name: "shit head" }); ok(r.s === 400, "join rejects bad name", r);
r = await api("PUT", "/api/me", { data: { world: { DE: 9 } } }, devA); ok(r.s === 400, "reject level 9", r);
r = await api("PUT", "/api/me", { data: { world: { "x;drop": 1 } } }, devA); ok(r.s === 400, "reject bad key", r);
const many = {}; for (let i = 0; i < 14; i++) many["P" + i] = 5;
r = await api("PUT", "/api/me", { data: { ca: many } }, devA); ok(r.s === 400, "reject >13 provinces", r);
// throttle + update
r = await api("PUT", "/api/me", { data: { world: { FR: 3 } } }, devA); r = await api("PUT", "/api/me", { data: { world: { FR: 4 } } }, devA);
ok(r.s === 429, "throttle writes", r);
await sleep(1050); r = await api("PUT", "/api/me", { data: { world: { FR: 4, JP: 2, IT: 0 } } }, devA);
ok(r.s === 200 && r.j.ranks.world.pts === 6 && r.j.data.world.IT === undefined, "update recomputes score, drops zeros", r.j);
// auth
r = await api("GET", "/api/me", null, "bogus-token-bogus-token-123"); ok(r.s === 401, "bad token 401", r);
// PIN + link
r = await api("POST", "/api/pin", { pin: "12" }, devA); ok(r.s === 400, "short pin rejected", r);
r = await api("POST", "/api/pin", { pin: "4821" }, devA); ok(r.s === 200 && r.j.link && r.j.hasPin, "set pin -> link", r.j);
let link = r.j.link;
r = await api("POST", "/api/claim", { id: A.id, link: "wrong-link-wrong-link-wrong", pin: "4821" }); ok(r.s === 403, "claim wrong link", r);
for (let i = 1; i <= 4; i++) { r = await api("POST", "/api/claim", { id: A.id, link, pin: "0000" }); ok(r.s === 403 && r.j.error.includes(5 - i + " tr"), "wrong pin " + i, r.j); }
r = await api("POST", "/api/claim", { id: A.id, link, pin: "0000" }); ok(r.s === 423 && /15 min/.test(r.j.error), "5th wrong pin locks 15 min", r.j);
r = await api("POST", "/api/claim", { id: A.id, link, pin: "4821" }); ok(r.s === 423, "locked even with right pin", r.j);
await q({ sql: "UPDATE entries SET lock_until = 0 WHERE id = ?", params: [A.id] }); // simulate time passing
r = await api("POST", "/api/claim", { id: A.id, link, pin: "1111" }); ok(r.s === 423 && /30 min/.test(r.j.error), "6th wrong pin locks 30 min (doubling)", r.j);
await q({ sql: "UPDATE entries SET lock_until = 0 WHERE id = ?", params: [A.id] });
r = await api("POST", "/api/claim", { id: A.id, link, pin: "4821" });
ok(r.s === 200 && r.j.device && r.j.data.world.JP === 2, "claim with right pin returns map", r.j);
const devA2 = r.j.device;
const row = (await q({ sql: "SELECT fails, lock_until, pin_hash, link_hash FROM entries WHERE id = ?", params: [A.id] })).results[0];
ok(row.fails === 0 && row.lock_until === 0, "success resets fails", row);
ok(row.pin_hash.length === 64 && !row.pin_hash.includes("4821") && row.link_hash !== link, "only hashes stored", row);
// change pin
r = await api("POST", "/api/pin", { pin: "9999", link, oldPin: "1234" }, devA2); ok(r.s === 403, "change pin needs old pin", r);
r = await api("POST", "/api/pin", { pin: "9999", link, oldPin: "4821" }, devA2); ok(r.s === 200 && r.j.link === link, "change pin keeps link", r);
// relink: signs out other devices, old link dead
r = await api("POST", "/api/relink", { link, pin: "9999" }, devA2); ok(r.s === 200 && r.j.link !== link, "relink", r);
const link2 = r.j.link;
r = await api("GET", "/api/me", null, devA); ok(r.s === 401, "other device signed out after relink", r);
r = await api("GET", "/api/me", null, devA2); ok(r.s === 200, "current device kept", r);
r = await api("POST", "/api/claim", { id: A.id, link, pin: "9999" }); ok(r.s === 403, "old link dead", r);
r = await api("POST", "/api/claim", { id: A.id, link: link2, pin: "9999" }); ok(r.s === 200, "new link works", r);
// no-PIN entry can't be claimed
const bid = (await q({ sql: "SELECT id FROM entries WHERE name = 'Peacock Nazir'", params: [] })).results[0].id;
r = await api("POST", "/api/claim", { id: bid, link: "anything-anything-anything", pin: "1234" }); ok(r.s === 403, "no-pin entry not claimable", r);
// board
r = await api("GET", "/api/board");
ok(r.s === 200 && r.j.world.total === 2 && r.j.world.rows[0].p === 6 && r.j.us.total === 0 && r.j.ca.total === 0, "board", r.j);
ok(!JSON.stringify(r.j).includes(A.id) && !("data" in r.j.world.rows[0]), "board hides ids and maps", r.j.world.rows[0]);
ok(r.j.world.rows[0].tag === A.tag, "board tag matches owner", r.j.world.rows[0]);
// leave
r = await api("DELETE", "/api/me", null, devA2); ok(r.s === 200, "leave", r);
r = await api("GET", "/api/me", null, devA2); ok(r.s === 401, "gone after leave", r);
const left = (await q({ sql: "SELECT COUNT(*) c FROM devices WHERE entry_id = ?", params: [A.id] })).results[0].c; ok(left === 0, "devices cleaned", left);
// turnstile fails closed when not configured
const save = env.ALLOW_NO_TURNSTILE; delete env.ALLOW_NO_TURNSTILE;
r = await api("POST", "/api/join", {}); ok(r.s === 503, "join refused without turnstile secret", r);
env.ALLOW_NO_TURNSTILE = save;
r = await api("GET", "/api/nope"); ok(r.s === 404, "404", r);
// territories earn points but aren't countries; the UK nations count as one country
{ const d = { world: { "GB-ENG": 2, "GB-SCT": 1, PR: 3, GI: 1, FR: 2, "ES-CE": 1 } };
  const j = await api("POST", "/api/join", { ts: "", data: d });
  const row = (await q({ sql: "SELECT w_pts, w_n FROM entries WHERE id = ?", params: [j.j.id] })).results[0];
  ok(row && row.w_pts === 10 && row.w_n === 2, "territories score but don't count as countries", row); }
// tab addresses serve the page itself (index at "/")
{ const seen = []; const prev = env.ASSETS; env.ASSETS = { fetch: async (rq) => { seen.push(new URL(rq.url).pathname); return new Response("page"); } };
  for (const p of ["/usa", "/leaderboard/", "/favicon.svg"]) await W.fetch(new Request("https://t.example" + p), env, ctx);
  ok(seen.join() === "/,/,/favicon.svg", "tab paths serve the page", seen); env.ASSETS = prev; }
console.log(`${pass} passed, ${failN} failed`);
process.exit(failN ? 1 : 0);
