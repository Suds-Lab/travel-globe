// Travel Globe leaderboard API (Cloudflare Worker + D1).
// Static files in /public are served by Workers Static Assets; only /api/* reaches this code.
//
// Auth model:
//   device token  – random, held by each browser that owns an entry; sent as "Authorization: Bearer <token>".
//   link secret   – random, part of the edit link (#me=<id>.<secret>); only exists once a PIN is set.
//   PIN           – 4–8 digits; together with the link secret it lets a new browser claim the entry.
// Only SHA-256 hashes of tokens/secrets/PINs are stored. The PIN hash includes the link secret,
// so a leaked database can't be used to brute-force PINs.

const TABS = { world: "w", us: "us", ca: "ca" };
const CAP = { world: 260, us: 60, ca: 13 }; // max places per tab (a bit above the real counts)
const KEY = /^[A-Za-z0-9][A-Za-z0-9 .'-]{0,39}$/;
const MAX_BODY = 32 * 1024;
const BOARD_SIZE = 100;
const LOCK_AFTER = 5; // wrong PINs before lockout
const LOCK_BASE = 15 * 60e3; // first lockout, doubles each further miss
const LOCK_MAX = 24 * 3600e3;
const MIN_WRITE_GAP = 1000; // ms between writes to one entry

const ADJ = ["Amber", "Azure", "Bold", "Brave", "Bright", "Calm", "Clever", "Coral", "Cosmic", "Crimson", "Daring", "Dusty", "Eager", "Fast", "Gentle", "Golden", "Happy", "Hidden", "Jolly", "Keen", "Lively", "Lucky", "Merry", "Misty", "Mellow", "Nimble", "Noble", "Olive", "Polar", "Proud", "Quiet", "Rapid", "Rusty", "Sandy", "Silver", "Sly", "Snowy", "Sunny", "Swift", "Teal", "Tidy", "Velvet", "Vivid", "Wandering", "Wild", "Windy", "Witty", "Zesty"];
const ANI = ["Albatross", "Antelope", "Badger", "Beaver", "Bison", "Camel", "Caribou", "Cheetah", "Comet", "Condor", "Coyote", "Crane", "Dolphin", "Eagle", "Falcon", "Ferret", "Finch", "Fox", "Gazelle", "Gecko", "Heron", "Ibex", "Jaguar", "Koala", "Lemur", "Lynx", "Marmot", "Moose", "Narwhal", "Ocelot", "Orca", "Otter", "Owl", "Panda", "Pelican", "Penguin", "Puffin", "Raven", "Robin", "Seal", "Sparrow", "Stork", "Swan", "Tapir", "Tiger", "Toucan", "Walrus", "Yak"];
// Matched after lowercasing, removing accents, undoing common leetspeak and dropping non-letters.
// Kept to words that rarely occur inside innocent words. Extend as needed.
// (e.g. "cock" is left out because of Peacock/Hancock, "nazi" because of Nazir.)
const BAD = ["fuck", "shit", "cunt", "nigg", "faggot", "bitch", "whore", "slut", "rapist", "retard", "hitler", "kike", "chink", "wetback", "tranny", "pussy", "penis", "vagina", "dildo", "porn", "twat", "wank", "bastard", "asshole", "jizz", "kkk"];
const LEET = { 0: "o", 1: "i", 3: "e", 4: "a", 5: "s", 7: "t" };

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    try {
      return await route(req, env, ctx, url);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: "Server error" }, 500);
    }
  },
};

async function route(req, env, ctx, url) {
  const p = url.pathname, m = req.method;
  if (p === "/api/config" && m === "GET") return config(env);
  if (p === "/api/board" && m === "GET") return board(req, env, ctx, url);
  if (p === "/api/join" && m === "POST") return join(req, env);
  if (p === "/api/claim" && m === "POST") return claim(req, env);
  if (p === "/api/me") {
    if (m === "GET") return json(await meView(env, await auth(req, env)));
    if (m === "PUT") return updateMe(req, env);
    if (m === "DELETE") return leave(req, env);
  }
  if (p === "/api/pin" && m === "POST") return setPin(req, env);
  if (p === "/api/relink" && m === "POST") return relink(req, env);
  throw new HttpError(404, "Not found");
}

// ---------- endpoints ----------

function config(env) {
  const off = !env.TURNSTILE_SECRET && env.ALLOW_NO_TURNSTILE === "1";
  return json({ ts: off ? "" : env.TURNSTILE_SITE_KEY || "" });
}

async function board(req, env, ctx, url) {
  const cache = caches.default, key = new Request(url.origin + "/api/board");
  const hit = await cache.match(key);
  if (hit) return hit;
  const top = (t) => env.DB.prepare(`SELECT name, tag, ${t}_pts AS p, ${t}_n AS n FROM entries WHERE ${t}_pts > 0 ORDER BY ${t}_pts DESC, ${t}_n DESC, created LIMIT ${BOARD_SIZE}`);
  const res = await env.DB.batch([
    top("w"), top("us"), top("ca"),
    env.DB.prepare("SELECT (SELECT COUNT(*) FROM entries WHERE w_pts > 0) AS w, (SELECT COUNT(*) FROM entries WHERE us_pts > 0) AS us, (SELECT COUNT(*) FROM entries WHERE ca_pts > 0) AS ca"),
  ]);
  const c = res[3].results[0];
  const out = {
    world: { total: c.w, rows: res[0].results },
    us: { total: c.us, rows: res[1].results },
    ca: { total: c.ca, rows: res[2].results },
    at: Date.now(),
  };
  const r = json(out, 200, { "cache-control": "public, max-age=30" });
  ctx.waitUntil(cache.put(key, r.clone()));
  return r;
}

async function join(req, env) {
  const b = await body(req);
  const d = parseData(b.data || {});
  const name = b.name ? cleanName(b.name) : randomName(); // validate before spending the Turnstile token
  await human(env, b.ts, req);
  const id = uuidv7(), dev = rand(32), now = Date.now();
  const tag = (await sha("tag|" + id)).slice(0, 12);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO entries (id, tag, name, data, w_pts, w_n, us_pts, us_n, ca_pts, ca_n, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, tag, name, d.json, d.w_pts, d.w_n, d.us_pts, d.us_n, d.ca_pts, d.ca_n, now, now),
    env.DB.prepare("INSERT INTO devices (token_hash, entry_id, created) VALUES (?, ?, ?)").bind(await sha("dev|" + dev), id, now),
  ]);
  const e = await getEntry(env, id);
  return json({ device: dev, ...(await meView(env, e)) });
}

async function claim(req, env) {
  const b = await body(req);
  await human(env, b.ts, req);
  const e = typeof b.id === "string" ? await getEntry(env, b.id) : null;
  if (!e || !e.pin_hash) throw new HttpError(403, "This edit link is not valid.");
  await verify(env, e, b.link, b.pin);
  const dev = rand(32);
  await env.DB.prepare("INSERT INTO devices (token_hash, entry_id, created) VALUES (?, ?, ?)").bind(await sha("dev|" + dev), e.id, Date.now()).run();
  return json({ device: dev, ...(await meView(env, await getEntry(env, e.id))) });
}

async function updateMe(req, env) {
  const e = await auth(req, env);
  const b = await body(req);
  const now = Date.now();
  if (now - e.updated < MIN_WRITE_GAP) throw new HttpError(429, "Too many updates, try again in a moment.");
  const sets = ["updated = ?"], vals = [now];
  if (b.data !== undefined) {
    const d = parseData(b.data);
    sets.push("data = ?", "w_pts = ?", "w_n = ?", "us_pts = ?", "us_n = ?", "ca_pts = ?", "ca_n = ?");
    vals.push(d.json, d.w_pts, d.w_n, d.us_pts, d.us_n, d.ca_pts, d.ca_n);
  }
  if (b.reroll) { sets.push("name = ?"); vals.push(randomName()); }
  else if (b.name !== undefined) { sets.push("name = ?"); vals.push(cleanName(b.name)); }
  await env.DB.prepare(`UPDATE entries SET ${sets.join(", ")} WHERE id = ?`).bind(...vals, e.id).run();
  return json(await meView(env, await getEntry(env, e.id)));
}

async function leave(req, env) {
  const e = await auth(req, env);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM devices WHERE entry_id = ?").bind(e.id),
    env.DB.prepare("DELETE FROM entries WHERE id = ?").bind(e.id),
  ]);
  return json({ ok: true });
}

// First PIN: creates the edit link. Later: changes the PIN (needs link + old PIN).
async function setPin(req, env) {
  const e = await auth(req, env);
  const b = await body(req);
  checkPin(b.pin);
  let link;
  if (!e.pin_hash) link = rand(32);
  else { await verify(env, e, b.link, b.oldPin); link = b.link; }
  await env.DB.prepare("UPDATE entries SET link_hash = ?, pin_hash = ?, fails = 0, lock_until = 0 WHERE id = ?")
    .bind(await sha("link|" + link), await pinHash(e.id, link, b.pin), e.id).run();
  return json({ link, ...(await meView(env, await getEntry(env, e.id))) });
}

// New edit link (old one stops working) and sign out every other device.
async function relink(req, env) {
  const e = await auth(req, env);
  const b = await body(req);
  await verify(env, e, b.link, b.pin);
  const link = rand(32);
  await env.DB.batch([
    env.DB.prepare("UPDATE entries SET link_hash = ?, pin_hash = ? WHERE id = ?").bind(await sha("link|" + link), await pinHash(e.id, link, b.pin), e.id),
    env.DB.prepare("DELETE FROM devices WHERE entry_id = ? AND token_hash != ?").bind(e.id, e.token_hash),
  ]);
  return json({ link, ...(await meView(env, await getEntry(env, e.id))) });
}

// ---------- helpers ----------

async function meView(env, e) {
  const r = await env.DB.prepare(
    "SELECT (SELECT COUNT(*) FROM entries WHERE w_pts > ?1) AS wa, (SELECT COUNT(*) FROM entries WHERE w_pts > 0) AS wt," +
    " (SELECT COUNT(*) FROM entries WHERE us_pts > ?2) AS ua, (SELECT COUNT(*) FROM entries WHERE us_pts > 0) AS ut," +
    " (SELECT COUNT(*) FROM entries WHERE ca_pts > ?3) AS ca, (SELECT COUNT(*) FROM entries WHERE ca_pts > 0) AS ct"
  ).bind(e.w_pts, e.us_pts, e.ca_pts).first();
  const rk = (p, n, above, total) => ({ pts: p, n, rank: p > 0 ? above + 1 : null, total });
  return {
    id: e.id, tag: e.tag, name: e.name, hasPin: !!e.pin_hash, updated: e.updated,
    data: JSON.parse(e.data),
    ranks: { world: rk(e.w_pts, e.w_n, r.wa, r.wt), us: rk(e.us_pts, e.us_n, r.ua, r.ut), ca: rk(e.ca_pts, e.ca_n, r.ca, r.ct) },
  };
}

function getEntry(env, id) {
  return env.DB.prepare("SELECT * FROM entries WHERE id = ?").bind(id).first();
}

async function auth(req, env) {
  const m = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(req.headers.get("authorization") || "");
  if (!m) throw new HttpError(401, "Not signed in.");
  const th = await sha("dev|" + m[1]);
  const e = await env.DB.prepare("SELECT e.*, d.token_hash FROM devices d JOIN entries e ON e.id = d.entry_id WHERE d.token_hash = ?").bind(th).first();
  if (!e) throw new HttpError(401, "This device is no longer signed in.");
  return e;
}

// Checks link secret, then PIN, with escalating lockout on wrong PINs. Throws on failure.
async function verify(env, e, link, pin) {
  if (typeof link !== "string" || !e.link_hash || !same(await sha("link|" + link), e.link_hash))
    throw new HttpError(403, "This edit link is not valid anymore.");
  const now = Date.now();
  if (e.lock_until > now) throw new HttpError(423, `Too many wrong PINs. Try again in ${mins(e.lock_until - now)}.`);
  if (typeof pin === "string" && same(await pinHash(e.id, link, pin), e.pin_hash)) {
    if (e.fails) await env.DB.prepare("UPDATE entries SET fails = 0, lock_until = 0 WHERE id = ?").bind(e.id).run();
    return;
  }
  // Atomic increment so parallel guesses can't dodge the counter.
  const r = await env.DB.prepare(
    `UPDATE entries SET fails = fails + 1, lock_until = CASE WHEN fails + 1 >= ${LOCK_AFTER}
       THEN ?2 + MIN(${LOCK_BASE} * (1 << MIN(fails + 1 - ${LOCK_AFTER}, 7)), ${LOCK_MAX}) ELSE 0 END
     WHERE id = ?1 RETURNING fails, lock_until`
  ).bind(e.id, now).first();
  if (r.lock_until > now) throw new HttpError(423, `Wrong PIN. Locked for ${mins(r.lock_until - now)}.`);
  const left = LOCK_AFTER - r.fails;
  throw new HttpError(403, `Wrong PIN. ${left} ${left === 1 ? "try" : "tries"} left before a lockout.`);
}

function mins(ms) {
  const m = Math.ceil(ms / 60e3);
  return m >= 120 ? `${Math.ceil(m / 60)} hours` : `${m} min`;
}

function checkPin(pin) {
  if (typeof pin !== "string" || !/^\d{4,8}$/.test(pin)) throw new HttpError(400, "PIN must be 4–8 digits.");
}

function pinHash(id, link, pin) {
  return sha(`pin|${id}|${link}|${pin}`);
}

async function human(env, token, req) {
  if (!env.TURNSTILE_SECRET) {
    if (env.ALLOW_NO_TURNSTILE === "1") return;
    throw new HttpError(503, "Verification is not set up on the server.");
  }
  if (typeof token !== "string" || !token) throw new HttpError(400, "Verification missing, please try again.");
  const f = new FormData();
  f.append("secret", env.TURNSTILE_SECRET);
  f.append("response", token);
  const ip = req.headers.get("cf-connecting-ip");
  if (ip) f.append("remoteip", ip);
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: f });
  const j = await r.json().catch(() => ({}));
  if (!j.success) throw new HttpError(403, "Verification failed, please try again.");
}

function parseData(d) {
  if (!d || typeof d !== "object" || Array.isArray(d)) throw new HttpError(400, "Bad map data.");
  const clean = {}, out = {};
  for (const [t, col] of Object.entries(TABS)) {
    const src = d[t] == null ? {} : d[t];
    if (typeof src !== "object" || Array.isArray(src)) throw new HttpError(400, "Bad map data.");
    const o = {};
    let p = 0, n = 0;
    for (const [k, v] of Object.entries(src)) {
      if (!KEY.test(k) || !Number.isInteger(v) || v < 0 || v > 5) throw new HttpError(400, "Bad map data.");
      if (!v) continue;
      o[k] = v; p += v; n++;
    }
    if (n > CAP[t]) throw new HttpError(400, "Too many places.");
    clean[t] = o; out[col + "_pts"] = p; out[col + "_n"] = n;
  }
  out.json = JSON.stringify(clean);
  return out;
}

function cleanName(s) {
  const n = String(s == null ? "" : s).normalize("NFKC").replace(/\s+/g, " ").trim();
  if ([...n].length < 2 || [...n].length > 24) throw new HttpError(400, "Name must be 2–24 characters.");
  if (!/^[\p{L}\p{N}][\p{L}\p{M}\p{N} .'_-]*$/u.test(n) || /\p{M}{3,}/u.test(n))
    throw new HttpError(400, "Use letters, numbers, spaces and . - _ ' only.");
  if (/^\p{Lu}\p{Ll}+ \p{Lu}\p{Ll}+ \d{4}$/u.test(n))
    throw new HttpError(400, "That looks like an auto-generated name. Pick something else, or use the random name button.");
  const flat = n.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[013457]/g, (c) => LEET[c]).replace(/[^a-z]/g, "");
  if (BAD.some((w) => flat.includes(w))) throw new HttpError(400, "Please choose a different name.");
  return n;
}

function randomName() {
  const r = crypto.getRandomValues(new Uint32Array(3));
  return `${ADJ[r[0] % ADJ.length]} ${ANI[r[1] % ANI.length]} ${String(r[2] % 10000).padStart(4, "0")}`;
}

function uuidv7() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  let ts = Date.now();
  for (let i = 5; i >= 0; i--) { b[i] = ts % 256; ts = Math.floor(ts / 256); }
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function rand(n) {
  const b = crypto.getRandomValues(new Uint8Array(n));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function same(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

async function body(req) {
  const t = await req.text();
  if (t.length > MAX_BODY) throw new HttpError(413, "Request too large.");
  try {
    const j = JSON.parse(t || "{}");
    if (j && typeof j === "object" && !Array.isArray(j)) return j;
  } catch (e) {}
  throw new HttpError(400, "Bad request.");
}

function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}
