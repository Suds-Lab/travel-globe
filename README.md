# Travel Globe

Color in the places you've been: countries on a spinning globe, US states and territories, and Canadian provinces. Each place scores 0–5 points depending on how much time you spent there.

## Credit

Travel Globe was created by **yoisef-s**: <https://yoisef-s.github.io/travel-globe/> ([source](https://github.com/yoisef-s/travel-globe)).
This repo builds on that original with the author's permission. Thank you!

## What this fork adds: an anonymous leaderboard

- **Three boards:** Globe, US states and Canada, on the 🏆 Board tab.
- **No accounts:** joining gives you a random name like "Teal Falcon 2390". You can change it to your own name any time.
- **Edit link + PIN (optional):** set a PIN to get a private edit link. Opening the link and entering the PIN brings your entry and your whole map to another device.
- **Share:** creates a story-size "travel passport" with your map, flags, countries/continents (or states/provinces and regions), points, rank and the site address.
- **Privacy:** the public board only shows name, points and number of places. Which places you visited is stored privately and only returned to your own devices.

## Layout

| Path | What it is |
|---|---|
| `public/index.html` | The whole front end (map + leaderboard UI) |
| `src/worker.js` | Cloudflare Worker: serves `public/` and the `/api/*` leaderboard API |
| `schema.sql` | Database tables (Cloudflare D1) |
| `wrangler.jsonc` | Cloudflare config |
| `tools/` | Local dev server and API tests that need no npm packages (`sh tools/dev.sh`) |
| `SETUP.md` | One-time Cloudflare setup (dashboard only) and local development |

Without the server (e.g. opening `public/index.html` directly) the map works as before and the Board tab says the leaderboard isn't available.
