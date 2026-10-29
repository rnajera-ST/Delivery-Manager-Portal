#!/bin/bash
# Start the Manager Portal

cd "$(dirname "$0")"

# Check dependencies
if ! python3 -c "import flask" 2>/dev/null; then
    echo "Installing dependencies..."
    pip3 install -r requirements.txt
fi

echo ""
echo "  ┌──────────────────────────────────────┐"
echo "  │   Onboarding Manager Portal          │"
echo "  │   http://localhost:5001               │"
echo "  │                                       │"
echo "  │   Snowflake SSO: browser will open    │"
echo "  │   Portal API: paste cookie in UI      │"
echo "  └──────────────────────────────────────┘"
echo ""

python3 server.py
