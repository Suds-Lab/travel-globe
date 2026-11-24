#!/bin/sh
# Local dev without npm: needs only the Node.js and Python 3 already on your machine.
#   sh tools/dev.sh        -> site + API at http://localhost:8788 (Turnstile skipped, data in .wrangler/dev.db)
#   sh tools/dev.sh test   -> run the API tests against a throwaway database
set -e
cd "$(dirname "$0")/.."
mkdir -p .wrangler
cp src/worker.js .wrangler/worker.mjs   # Node needs .mjs to load it as an ES module
if [ "$1" = "test" ]; then DB=.wrangler/test.db; rm -f $DB; else DB=.wrangler/dev.db; fi
python3 tools/d1-local.py $DB schema.sql 8799 & D1=$!
trap 'kill $D1 2>/dev/null' EXIT
sleep 1
kill -0 $D1 2>/dev/null || { echo "Port 8799 is busy (an old dev server still running?). Stop it and retry."; exit 1; }
if [ "$1" = "test" ]; then node tools/test-api.mjs "$PWD/.wrangler/worker.mjs"
else node tools/dev-server.mjs "$PWD/.wrangler/worker.mjs" "$PWD/public" 8788; fi
