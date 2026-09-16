#!/bin/bash
cd "$(dirname "$0")"

if [ ! -d "venv" ]; then
    echo "First-time setup..."
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt
else
    source venv/bin/activate
fi

echo "Starting Goose School Sync → http://127.0.0.1:5050"
open http://127.0.0.1:5050 2>/dev/null || true
python app.py
