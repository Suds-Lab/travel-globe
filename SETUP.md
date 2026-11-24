# Setup

Everything runs on Cloudflare's free plan: one Worker (site + API), one D1 database and Turnstile (bot check).
On the free plan, going over a limit makes requests fail until the next day. You can't be billed.

| Service | Free allowance |
|---|---|
| Workers (site + API) | 100,000 requests/day (static files don't count) |
| D1 | 5M rows read/day, 100k rows written/day, 5 GB |
| Turnstile | Unlimited |

**No Node.js or npm is needed on your machine.** The whole setup is done in the Cloudflare dashboard. Cloudflare's own build servers run their `wrangler` tool when you push to GitHub, so no npm packages are ever installed locally.

## One-time setup (dashboard only)

1. **Create the database.** Storage & Databases → D1 → Create → name it `travel-globe`.
   - Copy its **Database ID** into `wrangler.jsonc`, replacing `REPLACE_WITH_D1_DATABASE_ID`.
   - Open the database's **Console** tab, paste the whole of `schema.sql`, and run it.

2. **Create a Turnstile widget.** Turnstile → Add widget:
   - Hostname: your subdomain (e.g. `travel-globe.<your domain>`)
   - Widget mode: **Managed**
   - Copy the **site key** into `wrangler.jsonc`, replacing `REPLACE_WITH_TURNSTILE_SITE_KEY`. Keep the **secret key** for step 5.

3. **Set your subdomain.** In `wrangler.jsonc`, change `travel-globe.example.com` to your real subdomain. The domain must be in this Cloudflare account. Cloudflare creates the DNS record and certificate itself.

4. **Push and connect the repo.** Commit those three `wrangler.jsonc` edits and push. Then Workers & Pages → Create → **Import a repository** → pick `Suds-Lab/travel-globe` (public or private both work):
   - Project name: `travel-globe` (must match `"name"` in `wrangler.jsonc`)
   - Production branch: `main`
   - Build command: *(leave empty)*. Deploy command: `npx wrangler deploy` (the default).

   Every push to `main` now deploys automatically.

5. **Add the Turnstile secret.** Workers & Pages → `travel-globe` → Settings → Variables and Secrets → Add → type **Secret**, name `TURNSTILE_SECRET`, value = the secret key from step 2.
   Until this exists, the API refuses to create or claim entries (it fails closed). The map itself still works.

6. **Rate limit (recommended).** Your domain → Security → WAF → Rate limiting rules → Create:
   - If: URI Path starts with `/api/` **and** Request Method is not `GET`
   - Rate: 20 requests per 10 seconds, per IP
   - Action: Block for 10 seconds

   The free plan includes one rule like this.

## Local development (no npm)

You only need the `node` and `python3` already installed on your Mac. No packages are downloaded.

```sh
sh tools/dev.sh        # site + API at http://localhost:8788 (Turnstile skipped)
sh tools/dev.sh test   # run the API tests (46 checks)
```

`tools/` runs the real `src/worker.js` with a small stand-in for D1 that uses Python's built-in SQLite. It's close to Cloudflare but not identical, so check important changes on the live site too.

## Moderation

Bad names are blocked by a word list (`BAD` in `src/worker.js`). To fix or remove an entry by hand: D1 → `travel-globe` → Console:

```sql
SELECT id, name, w_pts, us_pts, ca_pts FROM entries ORDER BY updated DESC LIMIT 50;
UPDATE entries SET name = 'Quiet Comet 0001' WHERE id = '…';
DELETE FROM devices WHERE entry_id = '…'; DELETE FROM entries WHERE id = '…';
```

## How the edit link works

- Each browser that owns an entry holds a random **device token**.
- Setting a **PIN** (4–8 digits) creates an **edit link** `https://<your subdomain>/#me=<entry id>.<secret>`. The part after `#` is never sent to the server in the URL. The page sends it in the request body instead.
- A new device needs **link + PIN** to claim the entry. After 5 wrong PINs the entry locks for 15 minutes, doubling each further miss (max 24 h).
- The database stores only SHA-256 hashes of tokens, link secrets and PINs. The PIN hash includes the link secret, so a leaked database can't be used to guess PINs.
- "New edit link" (needs the PIN) stops the old link from working and signs out all other devices.
- Entry IDs are UUIDv7 and are never shown on the public board. Rows are matched to "you" with a short hash tag.

## How the leaderboard UI flows

- **Map tabs:** a 📤 Share button next to the score. Once joined, a 🏆 #rank badge links to the board.
- **Board tab:** a one-line "you" bar (Join, or your name + rank, Share and ⚙), a Globe / US states / Canada switcher that starts on the last map tab you used, and one list at a time.
- **Share:** a first-time visitor picks a name, then gets a one-time offer to set a PIN (skippable), then the image. Later shares go straight to the image. The image is a 1080×1080 PNG drawn in the browser: a map of your colored places, name, points, rank and the site address. Phones get the system share sheet; desktops get Download and Copy link. Edit links are never put in the image or share text.
- **⚙ Your entry:** name (or 🎲 random), set PIN / copy edit link / change PIN / replace link, and leave the leaderboard.
- **Opening an edit link:** shows a "Welcome back" PIN popup over the map.
- **Short messages** (joined, copied, signed out) appear as small notices that fade out.
