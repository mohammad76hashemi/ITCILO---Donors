#!/usr/bin/env python3
"""Donor & Partner Explorer: small local server. Nothing to install.

Easiest: double-click start.command (Mac) or start.bat (Windows). Or run from this folder:
    python3 server.py
then open http://localhost:8000

What it saves:
- data/donors.json            course-team profiles. Admin edits, new profiles
                              and deletions are written straight into this file.
                              Every previous version is kept in server-data/backups/.
- server-data/store.json      participant submissions, reviews, filter settings
                              and a log of profile changes.

Options:
    --port 8000         choose another port
    --host 0.0.0.0      let other computers on your network open the site
                        (default 127.0.0.1 = only this computer)

Note: logins are still the demo accounts from js/store.js. Do not put this
server on the public internet as it is.
"""
import argparse
import glob
import json
import os
import shutil
import tempfile
import threading
import webbrowser
from datetime import datetime, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlsplit

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(ROOT, "server-data")
STORE = os.path.join(DATA_DIR, "store.json")
STORE_BACKUP = os.path.join(DATA_DIR, "store.backup.json")
DONORS = os.path.join(ROOT, "data", "donors.json")
BACKUP_DIR = os.path.join(DATA_DIR, "backups")
KEEP_BACKUPS = 50
KEYS = {"dpe.submissions", "dpe.filterConfig", "dpe.profileOverrides", "dpe.siteText"}
MAX_BODY = 5 * 1024 * 1024
lock = threading.Lock()


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def write_json(path, data, indent):
    """Write the whole file at once, never half a file."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".tmp")
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=indent)
        f.write("\n")
    os.replace(tmp, path)


def load():
    try:
        with open(STORE, encoding="utf-8") as f:
            db = json.load(f)
    except FileNotFoundError:
        db = {}
    db.setdefault("values", {})
    db.setdefault("revs", {})
    return db


def save(db):
    if os.path.exists(STORE):
        shutil.copyfile(STORE, STORE_BACKUP)  # one step of undo, just in case
    write_json(STORE, db, 1)


def backup_donors():
    os.makedirs(BACKUP_DIR, exist_ok=True)
    stamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    shutil.copyfile(DONORS, os.path.join(BACKUP_DIR, f"donors_{stamp}.json"))
    for old in sorted(glob.glob(os.path.join(BACKUP_DIR, "donors_*.json")))[:-KEEP_BACKUPS]:
        os.remove(old)


class Handler(SimpleHTTPRequestHandler):
    # Fixed file types, so Windows settings cannot make the browser refuse the scripts
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
                      ".svg": "image/svg+xml", ".html": "text/html"}

    def send_json(self, status, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        if urlsplit(self.path).path.endswith(".json"):
            self.send_header("Cache-Control", "no-store")  # always show the latest donors.json
        super().end_headers()

    def hidden(self, path):
        parts = [p for p in path.split("/") if p]
        return any(p.startswith(".") for p in parts) or (bool(parts) and parts[0] in ("server-data", "server.py", "start.command", "start.bat"))

    def read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            self.send_json(413, {"error": "Body missing or too large"})
            return None
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            self.send_json(400, {"error": "Invalid JSON"})
            return None
        if not isinstance(body, dict):
            self.send_json(400, {"error": "Expected a JSON object"})
            return None
        return body

    def do_GET(self):
        path = unquote(urlsplit(self.path).path)
        if path == "/api/store":
            with lock:
                return self.send_json(200, load())
        if self.hidden(path):
            return self.send_error(404)
        return super().do_GET()

    def do_HEAD(self):
        if self.hidden(unquote(urlsplit(self.path).path)):
            return self.send_error(404)
        return super().do_HEAD()

    def do_PUT(self):
        """Save one shared value (submissions, filter settings) in server-data/store.json."""
        path = unquote(urlsplit(self.path).path)
        prefix = "/api/store/"
        key = path[len(prefix):] if path.startswith(prefix) else None
        if key not in KEYS:
            return self.send_json(404, {"error": "Unknown key"})
        body = self.read_body()
        if body is None:
            return
        if "value" not in body:
            return self.send_json(400, {"error": "Expected {value, rev}"})
        with lock:
            db = load()
            current = db["revs"].get(key, 0)
            if body.get("rev") != current:  # someone saved in between
                return self.send_json(409, {"error": "Changed by someone else", "rev": current})
            if body["value"] is None:
                db["values"].pop(key, None)
            else:
                db["values"][key] = body["value"]
            db["revs"][key] = current + 1
            save(db)
            return self.send_json(200, {"rev": current + 1})

    def do_POST(self):
        """Change one course-team profile directly in data/donors.json.
        Body: {action: "save" | "delete", profile, rev, by}"""
        path = unquote(urlsplit(self.path).path)
        prefix = "/api/donors/"
        pid = path[len(prefix):] if path.startswith(prefix) else ""
        if not pid or "/" in pid or len(pid) > 80:
            return self.send_json(404, {"error": "Unknown profile"})
        body = self.read_body()
        if body is None:
            return
        action, by = body.get("action"), str(body.get("by") or "")[:120]
        if action not in ("save", "delete"):
            return self.send_json(400, {"error": "action must be save or delete"})
        profile = body.get("profile")
        if action == "save" and (not isinstance(profile, dict) or not str(profile.get("name") or "").strip()):
            return self.send_json(400, {"error": "Profile name is required"})
        with lock:
            db = load()
            current = db["revs"].get("donors", 0)
            if body.get("rev") != current:
                return self.send_json(409, {"error": "Changed by someone else", "rev": current})
            with open(DONORS, encoding="utf-8") as f:
                data = json.load(f)
            donors = data.setdefault("donors", [])
            index = next((i for i, d in enumerate(donors) if d.get("id") == pid), None)
            if action == "delete":
                if index is None:
                    return self.send_json(404, {"error": "Profile not found"})
                removed = donors.pop(index)
                change = {"action": "delete", "id": pid, "name": removed.get("name"), "by": by, "at": now()}
            else:
                profile = {k: v for k, v in profile.items() if k not in ("addedByAdmin",)}
                profile["id"] = pid
                if index is None:
                    donors.append(profile)
                    change = {"action": "add", "id": pid, "name": profile.get("name"), "by": by, "at": now()}
                else:
                    donors[index] = {**donors[index], **profile}  # keep fields the editor does not show
                    change = {"action": "edit", "id": pid, "name": profile.get("name"), "by": by, "at": now()}
            data.setdefault("meta", {})["lastUpdated"] = datetime.now().strftime("%Y-%m-%d")
            backup_donors()
            write_json(DONORS, data, 2)
            db["revs"]["donors"] = current + 1
            db["values"].setdefault("dpe.donorLog", []).append(change)
            save(db)
            return self.send_json(200, {"rev": current + 1})


def main():
    ap = argparse.ArgumentParser(description="Donor & Partner Explorer server")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--open", action="store_true", help="open the site in the browser")
    args = ap.parse_args()
    server = None
    for port in range(args.port, args.port + 20):  # if the port is taken, try the next one
        try:
            server = ThreadingHTTPServer((args.host, port), partial(Handler, directory=ROOT))
            break
        except OSError:
            print(f"Port {port} is already in use, trying {port + 1}...")
    if server is None:
        print("No free port found. Close other servers and try again.")
        return
    shown = "localhost" if args.host in ("127.0.0.1", "0.0.0.0") else args.host
    url = f"http://{shown}:{port}"
    print(f"Donor & Partner Explorer running at {url}")
    if args.open:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    print(f"Profiles are saved in {DONORS}")
    print(f"Submissions and settings are saved in {STORE}")
    print("Keep this window open while you use the site. Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
