# Tiny stand-in for Cloudflare D1: executes SQL sent by the test harness against a local SQLite file.
import sqlite3, json, sys
from http.server import BaseHTTPRequestHandler, HTTPServer
db = sqlite3.connect(sys.argv[1], check_same_thread=False, isolation_level=None)
db.row_factory = sqlite3.Row
db.executescript(open(sys.argv[2]).read())
def run(st):
    cur = db.execute(st["sql"], st["params"])
    rows = [dict(r) for r in cur.fetchall()]
    return {"results": rows, "meta": {"changes": db.total_changes}}
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        b = json.loads(self.rfile.read(int(self.headers["content-length"])))
        try:
            if "batch" in b:
                db.execute("BEGIN"); out = [run(s) for s in b["batch"]]; db.execute("COMMIT")
            else: out = run(b)
            code, body = 200, out
        except Exception as e:
            if db.in_transaction: db.execute("ROLLBACK")
            code, body = 500, {"error": str(e)}
        d = json.dumps(body).encode(); self.send_response(code); self.send_header("content-length", str(len(d))); self.end_headers(); self.wfile.write(d)
HTTPServer(("127.0.0.1", int(sys.argv[3])), H).serve_forever()
