// Admin: give an entry a new edit link when its owner lost the old one.
// Prints SQL to paste into the D1 Console, plus the new link and PIN to send to the owner.
// The old link stops working and every device signed in to the entry is signed out.
//
//   node tools/new-link.mjs <entry id> [--pin 1234] [--site https://travel-globe.shneor.dev]
//
// Without --pin a random 6-digit temporary PIN is made; the owner can change it under ⚙ Your entry.
// With --pin the owner keeps a PIN they choose (they have to tell it to you).
// Uses only Node's built-in crypto, the same hashing as src/worker.js (sha / pinHash / rand).
import { createHash, randomBytes, randomInt } from "node:crypto";

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const pin = opt("--pin") ?? String(randomInt(0, 1e6)).padStart(6, "0");
const site = (opt("--site") ?? "https://travel-globe.shneor.dev").replace(/\/+$/, "");
const id = args[0];

if (!/^[0-9a-f-]{36}$/.test(id || "")) { console.error("Usage: node tools/new-link.mjs <entry id> [--pin 1234] [--site https://…]"); process.exit(1); }
if (!/^\d{4,8}$/.test(pin)) { console.error("The PIN must be 4–8 digits."); process.exit(1); }

const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const link = randomBytes(32).toString("base64url"); // same format as rand(32) in the worker
const linkHash = sha("link|" + link);
const pinHash = sha(`pin|${id}|${link}|${pin}`);

console.log(`
-- 1. Paste into Cloudflare → D1 → travel-globe → Console (one line):
UPDATE entries SET link_hash = '${linkHash}', pin_hash = '${pinHash}', fails = 0, lock_until = 0 WHERE id = '${id}'; DELETE FROM devices WHERE entry_id = '${id}';

-- 2. Check it changed exactly one entry:
SELECT id, name, w_pts FROM entries WHERE id = '${id}' AND link_hash = '${linkHash}';

-- 3. Send the owner, privately:
   Link: ${site}/#me=${id}.${link}
   PIN:  ${pin}
   (They open the link, enter the PIN, and can change the PIN under ⚙ Your entry.)
`);
