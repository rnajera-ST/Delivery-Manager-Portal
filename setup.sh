#!/bin/bash
# Manager Portal - First Time Setup (Mac/Linux)
# Run this once after cloning the repo.

echo ""
echo "  ┌──────────────────────────────────────┐"
echo "  │   Manager Portal - First Time Setup   │"
echo "  └──────────────────────────────────────┘"
echo ""

cd "$(dirname "$0")"

# 1. Install Python dependencies
echo "  [1/4] Installing dependencies..."
pip3 install flask snowflake-connector-python requests 'snowflake-connector-python[secure-local-storage]' 2>/dev/null
echo "  Done."

# 2. Who are you?
echo ""
echo "  [2/4] Your profile"
read -p "  Your full name (as it appears in Salesforce): " FULL_NAME
read -p "  Your ServiceTitan email: " EMAIL
read -p "  Your initials (2 letters): " INITIALS

# 3. Role detection — is this name in LEAD_ICS in server.py?
ROLE="manager"
LEAD_LINE=$(grep '^LEAD_ICS' server.py)
if echo "$LEAD_LINE" | grep -q "\"$FULL_NAME\""; then
  ROLE="lead-ic"
  echo ""
  echo "  Detected: Lead IC role"
fi

# 4. Write config (local, gitignored) + the SSO email (untracked)
echo ""
echo "  [3/4] Saving your config..."
mkdir -p .data
FIRST="${FULL_NAME%% *}"
cat > config.json << CONFIGEOF
{
  "manager": {
    "name": "$FIRST",
    "fullName": "$FULL_NAME",
    "initials": "$INITIALS",
    "role": "Manager, SMB Implementation",
    "reportsTo": "",
    "skip": ""
  },
  "team": [],
  "role": "$ROLE"
}
CONFIGEOF
printf '%s' "$EMAIL" > .data/snowflake-user.txt
echo "  [4/4] Done (role: $ROLE)."

echo ""
echo "  ┌──────────────────────────────────────────────────┐"
echo "  │  To start the dashboard:                         │"
echo "  │    python3 server.py                             │"
echo "  │  Then open http://localhost:5001 in Chrome.      │"
echo "  │                                                  │"
echo "  │  Your team auto-detects from Snowflake.          │"
echo "  │  Update later with: git pull   (.data is kept).  │"
echo "  └──────────────────────────────────────────────────┘"
echo ""
