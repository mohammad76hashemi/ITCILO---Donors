#!/bin/bash
# Double-click this file to start the Donor & Partner Explorer (Mac).
# It starts the server (which saves everything in the database) and opens the site.
# Keep this window open while you use the site. Close it, or press Ctrl+C, to stop.
cd "$(dirname "$0")" || exit 1
PY=$(command -v python3 || command -v python)
if [ -z "$PY" ]; then
  echo "Python is not installed. Install it from https://www.python.org/downloads/ and try again."
  read -r -p "Press Enter to close."
  exit 1
fi
"$PY" server.py --open
