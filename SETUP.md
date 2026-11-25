# Setup

Everything runs on Cloudflare's free plan: one Worker (site + API), one D1 database and Turnstile (bot check).
On the free plan, going over a limit makes requests fail until the next day. You can't be billed.

| Service | Free allowance |
|---|---|
| Workers (site + API) | 100,000 requests/day (static files don't count) |
| D1 | 5M rows read/day, 100k rows written/day, 5 GB |
| Turnstile | Unlimited |

**No Node.js or npm is needed on your machine.** The whole setup is done in the Cloudflare dashboard. Cloudflare's own build servers run their `wrangler` tool when you push to GitHub, so no npm packages are ever installed locally.

## Live deployment

This repo is deployed at **<https://travel-globe.shneor.dev>**. `wrangler.jsonc` already holds its D1 database ID, Turnstile site key and subdomain (none of these are secrets). If you fork it to run your own copy, replace those three values in steps 1–3 below.

## One-time setup (dashboard only)

1. **Create the database.** Storage & Databases → D1 → Create → name it `travel-globe`.
   - Put its **Database ID** in `wrangler.jsonc` (`database_id`).
   - Open the database's **Console** tab, paste the whole of `schema.sql`, and run it. The file only uses `/* */` comments, so it still works if the console squashes it onto one line.

2. **Create a Turnstile widget.** Turnstile → Add widget:
   - Hostname: your subdomain (e.g. `travel-globe.<your domain>`)
   - Widget mode: **Managed**
   - Put the **site key** in `wrangler.jsonc` (`TURNSTILE_SITE_KEY`). Keep the **secret key** for step 5. Never commit it.

3. **Set your subdomain** in `wrangler.jsonc` (`routes`). The domain must be in this Cloudflare account. Cloudflare creates the DNS record and certificate itself.

4. **Push and connect the repo.** Commit the `wrangler.jsonc` edits and push. Then Workers & Pages → Create → **Import a repository**.
   - GitHub asks you to install the **Cloudflare Workers and Pages** app. Choose **Only select repositories** → this repo. To add repos later: GitHub → Settings → Applications → Installed GitHub Apps → Cloudflare Workers and Pages → Configure.
   - Project name: `travel-globe` (must match `"name"` in `wrangler.jsonc`)
   - Production branch: `main`
   - Build command: *(leave empty)*. Deploy command: `npx wrangler deploy` (the default; it runs on Cloudflare's servers).
   - **Preview builds** (optional): pushes to other branches get their own `*.workers.dev` test URL. Previews use the **same database** as the live site, and Turnstile only allows your real hostname, so joining/saving fails on preview URLs. That's intended: test branches can't touch the real leaderboard. Preview URLs need `workers.dev` turned on (Settings → Domains & Routes).

   Every push to `main` now deploys automatically.

5. **Add the Turnstile secret.** Workers & Pages → `travel-globe` → Settings → Variables and Secrets → Add:
   - Environment: **Production** (Previews is optional; it changes nothing while previews can't pass Turnstile)
   - Key `TURNSTILE_SECRET`, value = the secret key from step 2, **Secret** box ticked
   - **Add variable and deploy**

   Use the Worker's runtime variables, not the Build variables (those are only seen by the build step). Until the secret exists, the API refuses to create or claim entries (it fails closed). The map itself still works.

6. **Rate limit (recommended).** Your domain → Security → WAF → Rate limiting rules → Create:
   - If: **URI Path** starts with `/api/` (check there's no trailing space in the value)
   - Characteristics: IP
   - Rate: 30 requests per 10 seconds
   - Action: Block for 10 seconds

   The free plan includes one rule and only lets it match on URI Path, so you can't limit it to one hostname. It applies to `/api/` paths on every subdomain of the zone, which is fine at this rate.

7. **Check it.** On the live site: mark a few places → Join (name, then optional PIN) → you appear on the Leaderboard → Share makes a passport → the edit link plus PIN restores your map in a private window.

## Local development (no npm)

You only need the `node` and `python3` already installed on your Mac. No packages are downloaded.

```sh
sh tools/dev.sh        # site + API at http://localhost:8788 (Turnstile skipped)
sh tools/dev.sh test   # run the API tests (49 checks)
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

- **Layout (mobile first):** a fixed glass header (title + share) and, on phones, a fixed glass bottom tab bar with icons. Content scrolls underneath both bars, which blur it and take on its colors. On phones the map is edge to edge and the selected-place card stays pinned above the tab bar. Screens 700px and wider get the tabs at the top instead. Text fields use 16px text so iPhone doesn't zoom in on tap. Browsers without blur support, or with Reduce Transparency on, get solid bars and cards.
- **Look:** dark only. Black background, gray grouped cards, bold numbers, green accent (`--acc` in the `:root` block of `public/index.html`). Level colors are `--l1`…`--l5`; the passport image uses the same ones. (Original Travel Globe colors: blue, green, yellow, orange, red.) The passport keeps its own navy-and-gold look.
- **Map tabs:** a stats card (points · places · rank; rank links to the Leaderboard), a Breakdown card with a bar per level, the map, then the selected-place card.

- **Share:** the round share icon in the top-right corner.
- **Leaderboard tab:** a one-line "you" bar (Join, or your name + rank, Share and ⚙), a Globe / US states / Canada switcher that starts on the last map tab you used, and one list at a time.
- **Join:** two steps, labelled "Step 1 of 2 · Name → PIN" and "Step 2 of 2 · optional". Step 1 is the name (random one pre-filled, editable, 🎲 for another). Step 2 offers a PIN so people know editing from another device is possible; it can be skipped and set later under ⚙.
- **Share:** a first-time visitor gets a random name pre-filled (editable, 🎲 for another), then a one-time PIN offer (skippable), then the passport. Later shares go straight to the passport. It's a 1080×1920 (story-size) PNG drawn in the browser: a hatched map with visited places in their level colors, round flags in as many centered rows as needed (countries from the `flag-icons` package on jsDelivr; US state/territory and Canadian province flags from Wikimedia Commons), the holder's name, stats (countries + continents / states + Census regions / provinces + regions, % covered, points, rank), and a passport-style machine-readable strip. The site address is taken from the page's own URL, so it always shows the real domain. Phones get the system share sheet; desktops get Download and Copy link. Edit links are never put in the image or share text.
- **⚙ Your entry:** name (or 🎲 random), set PIN / copy edit link / change PIN / replace link, and leave the leaderboard.
- **PIN entry:** one box at a time. Setting a PIN asks "Choose a PIN", then "Enter it again to confirm" (a mismatch starts over); changing it asks current → new → confirm. Each step has an on-screen numpad (↵ = next). On touch screens it replaces the system keyboard; on desktops typing still works.
- **Opening an edit link:** shows a "Welcome back" PIN popup over the map.
- **Short messages** (joined, copied, signed out) appear as small notices that fade out.
