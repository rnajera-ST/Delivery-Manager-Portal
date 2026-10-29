"""
Manager Portal — Flask Backend
Serves the React UI and provides real data from Snowflake + Onboarding Portal API.

Usage:
    python server.py

Portal API auth: Reads Chrome's cookies automatically. Just be logged into the
OB Portal in Chrome and the Flask app picks up your session.
"""

import json
import os
import re
import sys
import traceback
from datetime import datetime, date, timedelta
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory, abort, redirect
import snowflake.connector
import requests as http_requests

# Google Calendar (optional). Guarded so the portal still runs before the deps
# are installed (pip install google-auth-oauthlib google-api-python-client).
try:
    from google_auth_oauthlib.flow import Flow as GoogleFlow
    from google.oauth2.credentials import Credentials as GoogleCredentials
    from google.auth.transport.requests import Request as GoogleAuthRequest
    from googleapiclient.discovery import build as gcal_build
    GOOGLE_LIBS = True
    # The OAuth redirect is http://localhost (not https), and Google may return a
    # superset of the requested scopes. Both are fine for a local single-user tool.
    os.environ.setdefault("OAUTHLIB_INSECURE_TRANSPORT", "1")
    os.environ.setdefault("OAUTHLIB_RELAX_TOKEN_SCOPE", "1")
except ImportError:
    GOOGLE_LIBS = False
    print("  [warn] Google API libs not installed. Calendar integration disabled.")
    print("         Install with: pip3 install google-auth-oauthlib google-api-python-client")

try:
    import browser_cookie3
    HAS_BROWSER_COOKIES = False
except ImportError:
    HAS_BROWSER_COOKIES = False
    print("  [warn] browser-cookie3 not installed. Portal API will use manual cookie config.")
    print("         Install with: pip3 install browser-cookie3")

app = Flask(__name__, static_folder=None)

# ── Config ──────────────────────────────────────────────────────────────────

# Connection settings shared by everyone. The per-manager identity (the SSO
# email) is NOT here — it lives in an untracked file (.data/snowflake-user.txt)
# so nobody's email is ever committed. See get_snowflake_user().
SNOWFLAKE_CONFIG = {
    "account": "jw56142.west-us-2.azure",
    "authenticator": "externalbrowser",
    "warehouse": "MCP_WH",
    "role": "MCP_ANALYST_FR",
    "database": "DSV_WAREHOUSE",
    "schema": "POST_SALES",
}

PORTAL_BASE = "https://custom-wizards.westus2-01.prod.prod.customer-journey.srv.servicetitan.com"

CONFIG_FILE = Path(__file__).parent / "config.json"

ACTIVE_STATUSES = ("Pre-Implementation", "Implementation", "Live", "Hold", "No Payment Method")

# People who get the stripped-down "lead IC" view (My Pipeline / Tasks / Settings)
# instead of the full manager dashboard. Add a name here and push; that person's
# next git pull flips their view automatically (the role is computed at runtime).
LEAD_ICS = ["Katelyn Glover", "Erik Adamyan"]

DATA_DIR = Path(__file__).parent / ".data"
DATA_DIR.mkdir(exist_ok=True)
OVERLAY_FILE = DATA_DIR / "overlays.json"
PORTAL_CACHE_FILE = DATA_DIR / "portal-cache.json"
SLACK_TOKEN_FILE = DATA_DIR / "slack-token.txt"
SLACK_USERS_FILE = DATA_DIR / "slack-users.json"
SNOWFLAKE_USER_FILE = DATA_DIR / "snowflake-user.txt"
FEEDBACK_FILE = DATA_DIR / "feedback.json"
FORECAST_BASELINE_FILE = DATA_DIR / "forecast-baseline.json"  # frozen start-of-month projections
ONEONONE_FILE = DATA_DIR / "oneonone-notes.json"
MY_ACCOUNTS_FILE = DATA_DIR / "my-accounts.json"  # lead IC's personal account list (SF Account IDs)
GOOGLE_TOKEN_FILE = DATA_DIR / "google-token.json"  # OAuth tokens (gitignored, per-machine)
TASK_SEEN_FILE = DATA_DIR / "task-seen.json"  # per-user "last seen shared tasks" timestamps

# Google Calendar OAuth client. This is a PUBLIC client for a locally-installed
# desktop app: per Google's OAuth docs, the client secret for an installed/desktop
# application is not confidential, so it ships with the code so every manager has
# it automatically. Values live in google-oauth.json at the repo root (tracked).
#   {"client_id": "...", "client_secret": "..."}
# A manager can override locally with .data/google-oauth.json (gitignored).
GOOGLE_OAUTH_SHARED_FILE = Path(__file__).parent / "google-oauth.json"  # tracked, ships via git
GOOGLE_OAUTH_FILE = DATA_DIR / "google-oauth.json"                      # optional local override
GOOGLE_CLIENT_ID = ""
GOOGLE_CLIENT_SECRET = ""
GOOGLE_REDIRECT_URI = "http://localhost:5001/api/calendar/callback"
# Calendar (read-only) + Sheets (read/write) + Gmail (read-only, for account
# email context). Adding a scope means anyone already connected must re-connect
# (Settings → reconnect Google) to grant it.
GOOGLE_SCOPES = [
    "https://www.googleapis.com/auth/calendar.readonly",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/gmail.readonly",
]

# Shared task system: a single Google Sheet the whole team reads/writes. Roberto
# creates the sheet, shares it with the team, and pastes its ID here (the long
# token in the URL: docs.google.com/spreadsheets/d/<THIS>/edit). Row 1 is a
# header written automatically on first task creation; see SHARED_TASKS_HEADER.
SHARED_TASKS_SHEET_ID = "1ISweiB3GQk4XOSUWm0fQ7-6LiPZqaQRVBb44F3rumFI"

# RCA (Root Cause Analysis) tracker: a Google Sheet with an "RCAs" tab and an
# "ActionTracker" tab. Read-only via the Sheets API (same auth as shared tasks).
RCA_SHEET_ID = "1T7I-3-G9r_mjxjtaJAOgbg1OOXpeGpr79M4FEIu2qko"

# Anthropic API (AI assistant). The key is per-manager and secret, so it lives in
# .data/anthropic-key.txt (gitignored) or the ANTHROPIC_API_KEY env var — NEVER
# committed. The Messages API requires an x-api-key header; there is no ambient
# auth for a standalone server. Optional remote MCP servers (calendar/Slack/Gmail)
# can be enabled via .data/mcp-servers.json once valid URLs + auth tokens exist.
ANTHROPIC_KEY_FILE = DATA_DIR / "anthropic-key.txt"
MCP_SERVERS_FILE = DATA_DIR / "mcp-servers.json"
ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
ANTHROPIC_VERSION = "2023-06-01"
ANTHROPIC_MCP_BETA = "mcp-client-2025-11-20"
AGENT_MODEL = "claude-sonnet-4-6"  # claude-sonnet-4-20250514 is deprecated (retires 2026-06-15)
AGENT_MAX_TOKENS = 4096

# Where in-app feedback is delivered. A Slack CHANNEL (not a person), so no one's
# identity is hardcoded. Override with the FEEDBACK_CHANNEL env var. The bot needs
# chat:write (and chat:write.public to post without being invited to the channel).
FEEDBACK_SLACK_CHANNEL = os.environ.get("FEEDBACK_CHANNEL", "manager-portal-feedback")

# In-app feedback is logged to a shared Google Sheet via an Apps Script web app.
# This is a public /exec endpoint (not a credential), shared by every manager, so
# it ships in code. Override with FEEDBACK_SHEET_URL env or .data/feedback-sheet-url.txt.
FEEDBACK_SHEET_WEBHOOK = "https://script.google.com/macros/s/AKfycbxWT7O7j5lIHuh67DtBpgJ2st6sf2MSZHRp4X8Yyo6ONJNzVxC5NWX2EREN2ax8c64sDQ/exec"
# Slack channel that in-app feedback is also posted to (via chat.postMessage with
# the bot token). The bot must be a member of this channel and have chat:write.
FEEDBACK_CHANNEL_ID = "C0B7QJF7FD4"


def get_snowflake_user():
    """The logged-in manager's SSO email. Read from .data/snowflake-user.txt
    (written by setup), or the SNOWFLAKE_USER env var. Never hardcoded/committed."""
    if SNOWFLAKE_USER_FILE.exists():
        u = SNOWFLAKE_USER_FILE.read_text().strip()
        if u:
            return u
    return os.environ.get("SNOWFLAKE_USER", "").strip()
# Color palette for auto-assigning to new ICs
IC_COLORS = ["#2270EE", "#6DBAF8", "#34C97B", "#F5C143", "#9B7BE8", "#E8915B", "#5BC8E8", "#E85B8A", "#8BC85B", "#C8A85B"]


def load_config():
    """Load manager + team config from config.json."""
    if CONFIG_FILE.exists():
        return json.loads(CONFIG_FILE.read_text())
    return {"manager": {"name": "Manager", "initials": "MG"}, "team": []}


def save_config(cfg):
    """Save config back to config.json."""
    CONFIG_FILE.write_text(json.dumps(cfg, indent=2))


# ── Identity: who is logged in ───────────────────────────────────────────────
# The app connects to Snowflake as the logged-in person (get_snowflake_user(),
# their SSO email from .data/snowflake-user.txt — set per machine at setup). We
# derive the manager name and team from that email so the dashboard reflects
# whoever is logged in, NOT a committed config. The config owner (whoever's name/team is in config.json) keeps their
# curated roster — which can include borrowed ICs and per-IC filters that pure
# auto-detection would miss. Any other logged-in manager gets an auto-detected team.

_detection = None  # cached Snowflake detection for this process

def _detect_identity():
    """Resolve {email, managerName, team} from the logged-in email. Cached."""
    global _detection
    if _detection is not None:
        return _detection
    email = get_snowflake_user()
    out = {"email": email, "managerName": "", "team": []}
    try:
        mrows = run_query(f"""
            SELECT ONBOARDER_MANAGER_ACCNT AS NM
            FROM FACT_OB_IMPL_PS_IMPLEMENTATION
            WHERE LOWER(ONBOARDER_MANAGER_EMAIL_ACCNT) = LOWER('{email}')
              AND ONBOARDER_MANAGER_ACCNT IS NOT NULL
            GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1
        """)
        if mrows:
            out["managerName"] = mrows[0].get("NM") or ""
        trows = run_query(f"""
            SELECT DISTINCT ONBOARDER_NAME_ACCNT AS NM
            FROM FACT_OB_IMPL_PS_IMPLEMENTATION
            WHERE LOWER(ONBOARDER_MANAGER_EMAIL_ACCNT) = LOWER('{email}')
              AND ONBOARDER_NAME_ACCNT IS NOT NULL
            ORDER BY 1
        """)
        for i, r in enumerate(trows):
            nm = r["NM"]
            parts = nm.split(" ")
            short = parts[0] + (" " + parts[-1][:1] + "." if len(parts) > 1 else "")
            initials = (parts[0][:1] + (parts[-1][:1] if len(parts) > 1 else "")).upper()
            out["team"].append({"name": nm, "short": short, "initials": initials,
                                "level": "IC2", "status": "Active",
                                "color": IC_COLORS[i % len(IC_COLORS)]})
    except Exception as e:
        print(f"Identity detection error: {e}", file=sys.stderr)
    _detection = out
    return out


def _is_config_owner():
    """True if the logged-in manager is the one curated in config.json (or if
    detection failed, in which case we trust the config)."""
    det = _detect_identity()
    cfg_name = (load_config().get("manager", {}).get("fullName") or "").strip().lower()
    if not det["managerName"]:
        return True
    return cfg_name == det["managerName"].strip().lower()


def _excluded_ics():
    """Lowercased set of IC names a senior has hidden (departed teammates). Stored
    in config.json under 'excludedICs' and applied to the senior's team, accounts,
    and manager rollups."""
    return set((n or "").strip().lower() for n in (load_config().get("excludedICs") or []))


def is_excluded_ic(name):
    return (name or "").strip().lower() in _excluded_ics()


def get_team():
    """Team for the current view. Senior managers get every IC under all of their
    managers (auto-discovered), minus any they've hidden (excludedICs). Otherwise:
    the curated config team if the owner has one, else auto-detected from Snowflake
    by the logged-in email. (setup.sh seeds an empty team, so a fresh manager always
    falls through to detection.)"""
    if get_role() == "senior-manager":
        ex = _excluded_ics()
        return [ic for ic in get_senior_team(get_senior_name()) if (ic.get("name") or "").strip().lower() not in ex]
    if _is_config_owner():
        cfg_team = load_config().get("team", [])
        if cfg_team:
            return cfg_team
    return _detect_identity()["team"]


def get_ic_names():
    """Get list of IC full names (Snowflake ONBOARDER_NAME_ACCNT values)."""
    return [ic["name"] for ic in get_team()]


def get_ic_short_map():
    """Get mapping of full name to short display name."""
    return {ic["name"]: ic.get("short", ic["name"]) for ic in get_team()}


# Super admins can impersonate other roles/users to see their view. The real
# (non-impersonated) identity is always used for this check, so impersonation
# can't escalate privilege.
SUPER_ADMINS = ["Roberto Najera"]
_impersonation = None  # {"role": "...", "name": "..."} while a super admin is viewing as someone else


def _mk_manager_from_name(name, role_title="Manager, SMB Implementation"):
    parts = (name or "").split(" ")
    initials = ((parts[0][:1] if parts else "") + (parts[-1][:1] if len(parts) > 1 else "")).upper()
    return {"name": parts[0] if parts else name, "fullName": name, "initials": initials or "?",
            "role": role_title, "reportsTo": "", "skip": ""}


def _real_manager():
    """The actual logged-in manager identity (ignores impersonation)."""
    cfg_mgr = load_config().get("manager", {})
    if _is_config_owner():
        return cfg_mgr
    return _mk_manager_from_name(_detect_identity()["managerName"], cfg_mgr.get("role", "Manager, SMB Implementation"))


def is_super_admin():
    return (_real_manager().get("fullName") or "").strip().lower() in [n.lower() for n in SUPER_ADMINS]


def get_manager():
    """Manager identity for the current view (honors impersonation for super admins)."""
    if _impersonation and is_super_admin():
        return _mk_manager_from_name(_impersonation.get("name") or "Lead IC",
                                     "Lead IC" if _impersonation.get("role") == "lead-ic" else "Manager")
    return _real_manager()


def _sql_str(s):
    """Escape a string for safe single-quoted SQL embedding."""
    return (s or "").replace("'", "''")


_detected_role = None  # cached for the process
_detected_senior_name = ""  # SENIOR_OB_MANAGER_NAME for the logged-in senior (set during detection)


def _detect_role():
    """Resolve the logged-in person's role from Snowflake by EMAIL (robust; no
    dependency on config name), cached. Order matters: SENIOR is checked BEFORE
    manager because a senior can also appear as an ONBOARDER_MANAGER_ACCNT, but a
    regular manager never appears in SENIOR_OB_MANAGER_EMAIL.
    LEAD_ICS (by name) -> senior-manager (SENIOR_OB_MANAGER_EMAIL) ->
    manager (ONBOARDER_MANAGER_EMAIL_ACCNT) -> name fallbacks -> config -> manager."""
    global _detected_role, _detected_senior_name
    if _detected_role is not None:
        return _detected_role
    name = (_real_manager().get("fullName") or "").strip()
    email = (get_snowflake_user() or "").strip()
    role = None
    if name.lower() in [n.lower() for n in LEAD_ICS]:
        role = "lead-ic"
    else:
        try:
            if email:
                srows = run_query(f"""
                    SELECT DISTINCT SENIOR_OB_MANAGER_NAME AS S FROM FACT_OB_IMPL_PS_IMPLEMENTATION
                    WHERE LOWER(SENIOR_OB_MANAGER_EMAIL) = LOWER('{_sql_str(email)}')
                      AND SENIOR_OB_MANAGER_NAME IS NOT NULL LIMIT 1
                """)
                if srows:
                    role = "senior-manager"
                    _detected_senior_name = srows[0].get("S") or name
                elif run_query(f"SELECT 1 FROM FACT_OB_IMPL_PS_IMPLEMENTATION WHERE LOWER(ONBOARDER_MANAGER_EMAIL_ACCNT) = LOWER('{_sql_str(email)}') LIMIT 1"):
                    role = "manager"
            if role is None and name:  # email lookup empty: fall back to name match
                if run_query(f"SELECT 1 FROM FACT_OB_IMPL_PS_IMPLEMENTATION WHERE LOWER(SENIOR_OB_MANAGER_NAME) = LOWER('{_sql_str(name)}') LIMIT 1"):
                    role = "senior-manager"; _detected_senior_name = name
                elif run_query(f"SELECT 1 FROM FACT_OB_IMPL_PS_IMPLEMENTATION WHERE LOWER(ONBOARDER_MANAGER_ACCNT) = LOWER('{_sql_str(name)}') LIMIT 1"):
                    role = "manager"
        except Exception as e:
            print(f"Role detection error: {e}", file=sys.stderr)
    if role is None:
        role = load_config().get("role") or "manager"
    _detected_role = role
    return role


def get_role():
    """Current role. A super admin's active impersonation overrides detection."""
    if _impersonation and is_super_admin():
        return _impersonation.get("role") or "manager"
    return _detect_role()


def get_senior_name():
    """SENIOR_OB_MANAGER_NAME for the current view. Impersonation supplies the
    name directly; a real senior login uses the name detected from their email."""
    if _impersonation and is_super_admin():
        return (get_manager().get("fullName") or "").strip()
    _detect_role()  # ensure _detected_senior_name is populated
    return _detected_senior_name or (get_manager().get("fullName") or "").strip()


_senior_team_cache = {}


def get_senior_team(senior_name):
    """Auto-discover every IC (with their manager) under a senior manager, from
    Snowflake. Returns team entries shaped like config ICs, plus a 'manager' key."""
    if senior_name in _senior_team_cache:
        return _senior_team_cache[senior_name]
    team = []
    try:
        rows = run_query(f"""
            SELECT DISTINCT ONBOARDER_NAME_ACCNT AS IC, ONBOARDER_MANAGER_ACCNT AS MGR
            FROM FACT_OB_IMPL_PS_IMPLEMENTATION
            WHERE (SENIOR_OB_MANAGER_NAME = '{_sql_str(senior_name)}'
                   OR ONBOARDER_MANAGER_ACCNT = '{_sql_str(senior_name)}')
              AND ONBOARDER_NAME_ACCNT IS NOT NULL
            ORDER BY MGR, IC
        """)
        for i, r in enumerate(rows):
            nm = r.get("IC")
            if not nm:
                continue
            parts = nm.split(" ")
            short = parts[0] + (" " + parts[-1][:1] + "." if len(parts) > 1 else "")
            initials = (parts[0][:1] + (parts[-1][:1] if len(parts) > 1 else "")).upper()
            team.append({"name": nm, "short": short, "initials": initials, "level": "IC2",
                         "status": "Active", "color": IC_COLORS[i % len(IC_COLORS)],
                         "manager": r.get("MGR") or ""})
    except Exception as e:
        print(f"Senior team discovery error: {e}", file=sys.stderr)
    _senior_team_cache[senior_name] = team
    return team


_real_senior_cache = None


def _real_senior_name():
    """Senior manager above the REAL logged-in manager (for the impersonation
    picker so a super admin can preview the senior view). Cached."""
    global _real_senior_cache
    if _real_senior_cache is not None:
        return _real_senior_cache
    name = (_real_manager().get("fullName") or "").strip()
    out = ""
    if name:
        try:
            rows = run_query(f"""
                SELECT SENIOR_OB_MANAGER_NAME AS S
                FROM FACT_OB_IMPL_PS_IMPLEMENTATION
                WHERE ONBOARDER_MANAGER_ACCNT = '{_sql_str(name)}' AND SENIOR_OB_MANAGER_NAME IS NOT NULL
                GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 1
            """)
            if rows:
                out = rows[0].get("S") or ""
        except Exception as e:
            print(f"Senior name lookup error: {e}", file=sys.stderr)
    _real_senior_cache = out
    return out


def load_my_accounts():
    """Lead IC's personal list. Entries are either a plain account-id string
    (legacy) or {id, status, completedAt}. Returns the raw list."""
    if MY_ACCOUNTS_FILE.exists():
        try:
            data = json.loads(MY_ACCOUNTS_FILE.read_text())
            return data if isinstance(data, list) else []
        except Exception:
            return []
    return []


def save_my_accounts(ids):
    MY_ACCOUNTS_FILE.write_text(json.dumps(ids, indent=2))


def _my_accounts_entries():
    """Normalize the list to dicts: {id, status, completedAt}, deduped by id (first wins)."""
    out, seen = [], set()
    for e in load_my_accounts():
        if isinstance(e, str):
            eid, entry = e, {"id": e, "status": "active", "completedAt": None}
        elif isinstance(e, dict) and e.get("id"):
            eid, entry = e["id"], {"id": e["id"], "status": e.get("status", "active"), "completedAt": e.get("completedAt")}
        else:
            continue
        if eid in seen:
            continue
        seen.add(eid)
        out.append(entry)
    return out


def my_account_ids():
    return [e["id"] for e in _my_accounts_entries()]


def my_account_status_map():
    return {e["id"]: e for e in _my_accounts_entries()}


# ── Helpers ─────────────────────────────────────────────────────────────────

_sf_conn = None

def get_snowflake_conn():
    """Create a Snowflake connection with SSO auth, as the logged-in manager."""
    global _sf_conn
    if _sf_conn is not None:
        try:
            _sf_conn.cursor().execute("SELECT 1")
            return _sf_conn
        except Exception:
            _sf_conn = None
    user = get_snowflake_user()
    if not user:
        raise RuntimeError(
            "No Snowflake user configured. Run ./setup.sh (or setup.bat on "
            "Windows), or create .data/snowflake-user.txt with your ServiceTitan email."
        )
    _sf_conn = snowflake.connector.connect(user=user, **SNOWFLAKE_CONFIG)
    _sf_conn.cursor().execute("USE ROLE MCP_ANALYST_FR")
    return _sf_conn


def run_query(sql, params=None):
    """Execute a Snowflake query and return list of dicts."""
    conn = get_snowflake_conn()
    try:
        cur = conn.cursor()
        cur.execute(sql, params)
        cols = [c[0] for c in cur.description]
        rows = cur.fetchall()
        return [dict(zip(cols, row)) for row in rows]
    finally:
        cur.close()


def iso(d):
    """Convert date/datetime to ISO string, or None.

    Date-only values (no time component) get "T12:00:00" appended so the browser's
    new Date() parses them at local noon instead of UTC midnight. Without this,
    "2026-06-02" is read as UTC midnight and shifts back a day in US timezones.
    Datetime values already carry a time component and are returned unchanged.
    """
    if d is None:
        return None
    # datetime is a subclass of date, so check it first.
    if isinstance(d, datetime):
        return d.strftime("%Y-%m-%d")
    if isinstance(d, date):
        return d.strftime("%Y-%m-%dT12:00:00")
    s = str(d)[:10]
    return (s + "T12:00:00") if s else None


def iso_dt(d):
    """Full ISO timestamp (keeps the time component), or None. Used for calls/
    emails where the time of day matters, unlike iso() which is date-only."""
    if d is None:
        return None
    if hasattr(d, "isoformat"):
        try:
            return d.isoformat()
        except Exception:
            return str(d)
    return str(d) or None


def load_overlays():
    """Load local overlay data."""
    if OVERLAY_FILE.exists():
        return json.loads(OVERLAY_FILE.read_text())
    return {}


def save_overlays(data):
    """Save local overlay data."""
    OVERLAY_FILE.write_text(json.dumps(data, indent=2, default=str))


def portal_enabled():
    """Check if Portal API proxying is available."""
    # Auto-enabled if browser-cookie3 is installed, or manual cookie is set
    if HAS_BROWSER_COOKIES:
        return True
    return bool(os.environ.get("PORTAL_COOKIE", ""))


def get_portal_cookies():
    """Get cookies for the Portal domain from Chrome's cookie store."""
    portal_domain = "custom-wizards.westus2-01.prod.prod.customer-journey.srv.servicetitan.com"

    # Try browser-cookie3 first (reads Chrome's actual cookie store)
    if HAS_BROWSER_COOKIES:
        try:
            cj = browser_cookie3.chrome(domain_name=portal_domain)
            return cj
        except Exception as e:
            print(f"  [warn] browser-cookie3 failed: {e}", file=sys.stderr)

    # Fallback to manual cookie from env var
    manual = os.environ.get("PORTAL_COOKIE", "")
    if manual:
        return manual

    return None


def portal_get(path, params=None):
    """Make a GET request to the Portal API using Chrome's cookies."""
    url = f"{PORTAL_BASE}/admin/api/v1/{path}"
    cookies = get_portal_cookies()

    if cookies is None:
        raise Exception("No portal cookies available. Log into the OB Portal in Chrome.")

    headers = {
        "x-requested-with": "XMLHttpRequest",
        "Accept": "application/json",
    }

    if isinstance(cookies, str):
        # Manual cookie string
        headers["Cookie"] = cookies
        resp = http_requests.get(url, headers=headers, params=params, timeout=30)
    else:
        # browser-cookie3 cookie jar
        resp = http_requests.get(url, headers=headers, params=params, cookies=cookies, timeout=30)

    resp.raise_for_status()
    return resp.json()


def in_clause(names):
    """Build a SQL IN clause from a list of names."""
    return ",".join(f"'{n}'" for n in names)


# ── Static file serving ────────────────────────────────────────────────────

def _no_cache(resp):
    # No build step here: the .jsx/.js/.css are loaded by URL with no version
    # hash, so browsers happily serve a stale copy after a `git pull` — which
    # looks like "the feature didn't work / my change didn't stick". Force a
    # revalidation on every load so an updated file is always re-fetched.
    resp.headers["Cache-Control"] = "no-cache, must-revalidate"
    return resp


@app.route("/")
def index():
    return _no_cache(send_from_directory(".", "index.html"))

@app.route("/<path:path>")
def static_files(path):
    # Serve any file from the current directory
    if Path(path).exists():
        return _no_cache(send_from_directory(".", path))
    abort(404)



def _get_eng_breakdown(pcache, account_id):
    """Extract engagement breakdown from portal cache."""
    if not pcache:
        return None
    eng = pcache.get("engagement", {})
    if isinstance(eng, dict) and account_id in eng:
        entry = eng[account_id]
        breakdown = entry.get("breakdown", [])
        result = {}
        name_map = {
            "Go Live Readiness": "goLiveReadiness",
            "Success Transition Readiness": "transitionReadiness",
            "Product Setup": "productSetup",
            "Product Usage": "productUsage",
            "Training": "training",
        }
        for item in breakdown:
            key = name_map.get(item.get("name"))
            if key:
                result[key] = item.get("scorePercentage", 0)
        if result:
            return result
    return None

# ── API: Main data endpoint ────────────────────────────────────────────────

@app.route("/api/data")
def api_data():
    """
    Return the full data payload for the dashboard.
    This replaces data.js and populates window.PORTAL on the client.
    """
    try:
        # 0. Get the source table's last ETL refresh time (when the data was
        #    last altered, not when this dashboard queried it).
        snowflake_data_as_of = None
        try:
            # FACT_OB_IMPL_PS_IMPLEMENTATION is a dbt-managed view; dbt runs
            # CREATE OR REPLACE VIEW on every build, so LAST_ALTERED tracks the
            # last ETL run. Emit explicit UTC (Z suffix) so the browser renders
            # the correct relative age regardless of its local timezone.
            refresh_rows = run_query("""
                SELECT TO_VARCHAR(CONVERT_TIMEZONE('UTC', LAST_ALTERED),
                                  'YYYY-MM-DD"T"HH24:MI:SS"Z"') as last_updated
                FROM DSV_WAREHOUSE.INFORMATION_SCHEMA.TABLES
                WHERE TABLE_SCHEMA = 'POST_SALES'
                AND TABLE_NAME = 'FACT_OB_IMPL_PS_IMPLEMENTATION'
            """)
            if refresh_rows:
                r = refresh_rows[0]
                snowflake_data_as_of = r.get("LAST_UPDATED") or r.get("last_updated")
        except Exception as e:
            print(f"Snowflake refresh-time query error: {e}", file=sys.stderr)

        # 1. Query Snowflake for all team accounts
        # Build per-IC filter conditions
        team = get_team()
        ic_filter_parts = []
        for ic in team:
            f = ic.get("filter", {})
            conditions = [f"ONBOARDER_NAME_ACCNT = '{ic['name']}'"]
            if f.get("onboardingType"):
                conditions.append(f"ONBOARDING_TYPE_OB = '{f['onboardingType']}'")
            if f.get("segment"):
                conditions.append(f"OB_TEAM_SEGMENT = '{f['segment']}'")
            ic_filter_parts.append("(" + " AND ".join(conditions) + ")")
        ic_where = " OR ".join(ic_filter_parts) if ic_filter_parts else "1=0"

        # Role decides the account scope:
        #  - manager: the team roster (ONBOARDER_NAME_ACCNT), active statuses only.
        #  - lead-ic: a personal list of Account IDs (.data/my-accounts.json), ANY
        #             status (so they can keep accounts that have reached Success).
        role = get_role()
        account_cols = """
                ACCOUNT_ID_OB, ID_OB, NAME_ACCOUNT, ONBOARDER_NAME_ACCNT, ONBOARDER_MANAGER_ACCNT,
                ONBOARDING_STATUS_OB, ONBOARDING_HEALTH_SCORE_OB,
                ONBOARDING_HEALTH_SCORE_COMMENTS_OB, LAST_UPDATED_HEALTH_SCORE_OB,
                PROJECTED_GO_LIVE_DATE_OB, ANTICIPATED_SUCCESS_TRANSITION_DATE_OB,
                LIVE_DATE_OB, SUCCESS_TRANSITION_CALL_DATE_OB, CMRR_OB,
                COMPLEXITY_TIER_OB, IMPLEMENTATION_START_DATE_OB, MANAGED_TECH_COUNT_OB,
                COHORT_OB, INITIAL_PROJECTED_GO_LIVE_DATE_OB, SUCCESS_TRANSITION_STATUS_OB,
                LAST_SUCCESS_TRANSITION_STATUS_UPDATED_OB, OUTSTANDING_BALANCE,
                OB_DISCOVERY_CALL_DATE_OB"""

        senior_managers = []
        if role == "lead-ic":
            my_ids = my_account_ids()
            if not my_ids:
                accounts_raw = []
            else:
                accounts_raw = run_query(f"""
                    SELECT {account_cols}
                    FROM FACT_OB_IMPL_PS_IMPLEMENTATION
                    WHERE ACCOUNT_ID_OB IN ({in_clause(my_ids)})
                    QUALIFY ROW_NUMBER() OVER (PARTITION BY ACCOUNT_ID_OB ORDER BY ONBOARDING_STATUS_OB NULLS LAST) = 1
                    ORDER BY NAME_ACCOUNT
                """)
        elif role == "senior-manager":
            # All active accounts across every manager under this senior manager.
            _sn = _sql_str(get_senior_name())
            accounts_raw = run_query(f"""
                SELECT {account_cols}
                FROM FACT_OB_IMPL_PS_IMPLEMENTATION
                WHERE (SENIOR_OB_MANAGER_NAME = '{_sn}' OR ONBOARDER_MANAGER_ACCNT = '{_sn}')
                AND ONBOARDING_STATUS_OB IN ({in_clause(ACTIVE_STATUSES)})
                QUALIFY ROW_NUMBER() OVER (PARTITION BY ACCOUNT_ID_OB ORDER BY ONBOARDING_STATUS_OB NULLS LAST) = 1
                ORDER BY ONBOARDER_MANAGER_ACCNT, ONBOARDER_NAME_ACCNT, ONBOARDING_STATUS_OB
            """)
            seen_m = set()
            for r in accounts_raw:
                m = r.get("ONBOARDER_MANAGER_ACCNT")
                if m and m not in seen_m:
                    seen_m.add(m)
                    senior_managers.append(m)
        else:
            # QUALIFY dedups the table's duplicate rows (same OB record appearing
            # multiple times) to one row per account, like the other role branches.
            accounts_raw = run_query(f"""
                SELECT {account_cols}
                FROM FACT_OB_IMPL_PS_IMPLEMENTATION
                WHERE ({ic_where})
                AND ONBOARDING_STATUS_OB IN ({in_clause(ACTIVE_STATUSES)})
                QUALIFY ROW_NUMBER() OVER (PARTITION BY ACCOUNT_ID_OB ORDER BY ONBOARDING_STATUS_OB NULLS LAST) = 1
                ORDER BY ONBOARDER_NAME_ACCNT, ONBOARDING_STATUS_OB, PROJECTED_GO_LIVE_DATE_OB
            """)

        # 2. CSAT disabled (separate tab only)
        csat_raw = []

        # 3. Query ticket counts per account (for active accounts)
        sf_ids = [r["ACCOUNT_ID_OB"] for r in accounts_raw if r.get("ACCOUNT_ID_OB")]

        # Success Rep (the assigned CSM on the customer record). The OB view does
        # not expose it, so we pull it from the customer health view by account.
        # Used by the "Needs CSM 24h+ with no Success Rep" compliance check.
        success_reps = {}
        if sf_ids:
            try:
                sr_rows = run_query(f"""
                    SELECT ACCOUNT_ID, SUCCESS_REP_NAME
                    FROM VW_CUSTOMER_HEALTH_CURRENT
                    WHERE ACCOUNT_ID IN ({in_clause(sf_ids)})
                """)
                success_reps = {r["ACCOUNT_ID"]: (r.get("SUCCESS_REP_NAME") or "") for r in sr_rows}
            except Exception as e:
                print(f"Success rep query error: {e}", file=sys.stderr)

        ticket_counts = {}
        if sf_ids:
            ticket_data = run_query(f"""
                SELECT
                    ACCOUNT_ID,
                    COUNT(*) AS total_tickets,
                    SUM(CASE WHEN STATUS NOT IN ('Closed','Solved') THEN 1 ELSE 0 END) AS open_tickets,
                    SUM(CASE WHEN ESCALATION_FLAG != 'No Escalation' THEN 1 ELSE 0 END) AS escalated_tickets
                FROM VW_SUPPORT_CASES
                WHERE ACCOUNT_ID IN ({in_clause(sf_ids)})
                AND IS_DELETED = FALSE
                AND CASE_CREATEDDATETIME >= DATEADD('MONTH', -6, CURRENT_DATE())
                GROUP BY ACCOUNT_ID
            """)
            ticket_counts = {r["ACCOUNT_ID"]: r for r in ticket_data}

        # 3b. Query churn cases from the churn funnel table
        churn_tickets = {}
        if sf_ids:
            try:
                churn_data = run_query(f"""
                    SELECT
                        ACCOUNT_ID, CASE_NUMBER, CASE_SUBJECT, CASE_STATUS,
                        CASE_TERMINATION_TYPE, CASE_PRIMARY_REASON,
                        CASE_PRIMARY_DISPOSITION, CASE_CHURN_REASON_DESCRIPTION,
                        CASE_CREATED_DATE, CASE_CLOSED_DATE,
                        CASE_CREATED_OWNER_NAME, CHURN_TYPE,
                        CASE_CHURN_MRR, CASE_ID
                    FROM FACT_SALESFORCE_CHURN_FUNNEL
                    WHERE ACCOUNT_ID IN ({in_clause(sf_ids)})
                    ORDER BY CASE_CREATED_DATE DESC
                """)
                for r in churn_data:
                    aid_t = r.get("ACCOUNT_ID", "")
                    if aid_t not in churn_tickets:
                        churn_tickets[aid_t] = []
                    churn_tickets[aid_t].append({
                        "num": r.get("CASE_NUMBER", ""),
                        "caseId": r.get("CASE_ID", ""),
                        "subject": r.get("CASE_SUBJECT", "") or r.get("CASE_PRIMARY_REASON", ""),
                        "status": r.get("CASE_STATUS", ""),
                        "component": r.get("CHURN_TYPE", ""),
                        "reason": r.get("CASE_CHURN_REASON_DESCRIPTION", ""),
                        "disposition": r.get("CASE_PRIMARY_DISPOSITION", ""),
                        "terminationType": r.get("CASE_TERMINATION_TYPE", ""),
                        "created": iso(r.get("CASE_CREATED_DATE")),
                        "closed": iso(r.get("CASE_CLOSED_DATE")),
                        "owner": r.get("CASE_CREATED_OWNER_NAME", ""),
                        "churnMrr": float(r.get("CASE_CHURN_MRR") or 0),
                        "sfdcUrl": f"https://servicetitan.lightning.force.com/lightning/r/Case/{r.get('CASE_ID', '')}/view",
                    })
            except Exception as e:
                print(f"Churn tickets query error: {e}", file=sys.stderr)

        # 4. CSAT disabled
        csat_by_account = {}
        # 5. CSAT disabled
        csat_by_ic = {}

        # 6. Load portal data from cache (synced via bookmarklet) or API
        portal_data = {}
        pcache = None
        try:
            pcache = json.loads(PORTAL_CACHE_FILE.read_text()) if PORTAL_CACHE_FILE.exists() else None
        except:
            pcache = None

        if pcache:
            # Build portal_data from cached tenant details
            for sid, detail in pcache.get("details", {}).items():
                portal_data[sid] = {"_me": detail}
            # Also merge /me data for Roberto's own accounts
            for tenant in pcache.get("me", []):
                sid = tenant.get("salesforceId")
                if sid:
                    portal_data.setdefault(sid, {})
                    # Merge tenant-level fields into _me (don't overwrite detail if we have it)
                    existing = portal_data[sid].get("_me", {})
                    portal_data[sid]["_me"] = {**tenant, **existing}
            print(f"  Loaded {len(portal_data)} accounts from portal cache", file=sys.stderr)
        elif portal_enabled() and sf_ids:
            try:
                # Bulk engagement scores
                params = [("salesforceIds", sid) for sid in sf_ids]
                eng_data = portal_get("onboarding-portal/engagement-score/tenants", params=params)
                if isinstance(eng_data, list):
                    for item in eng_data:
                        sid = item.get("salesforceId") or item.get("tenantSalesforceId")
                        if sid:
                            portal_data[sid] = item
                elif isinstance(eng_data, dict):
                    portal_data = eng_data
            except Exception as e:
                print(f"Portal engagement API error: {e}", file=sys.stderr)

            try:
                # Roberto's own pipeline (for his escalated accounts)
                me_data = portal_get("onboarding-portal/me")
                if isinstance(me_data, list):
                    for tenant in me_data:
                        sid = tenant.get("salesforceId")
                        if sid:
                            portal_data.setdefault(sid, {})
                            portal_data[sid]["_me"] = tenant
            except Exception as e:
                print(f"Portal /me API error: {e}", file=sys.stderr)

        # 7. Load overlays
        overlays = load_overlays()

        # 8. Build accounts array in the shape data.js expects
        accounts = []
        today = date.today()

        for row in accounts_raw:
            aid = row["ACCOUNT_ID_OB"]
            ob_id = row.get("ID_OB")  # onboarding record ID (Onboarding__c)
            ic_name = row["ONBOARDER_NAME_ACCNT"]
            status = row["ONBOARDING_STATUS_OB"]

            # Health score: can be string like "6 - High Confidence" or just a number
            hs_raw = row.get("ONBOARDING_HEALTH_SCORE_OB")
            hs = None
            if hs_raw is not None and hs_raw != "":
                try:
                    hs = int(str(hs_raw).strip()[0])  # Take first char (the digit)
                except (ValueError, IndexError):
                    hs = None

            cmrr = float(row.get("CMRR_OB") or 0)
            techs = int(row.get("MANAGED_TECH_COUNT_OB") or 0)

            # Dates
            impl_start = iso(row.get("IMPLEMENTATION_START_DATE_OB"))
            pgl = iso(row.get("PROJECTED_GO_LIVE_DATE_OB"))
            live_date = iso(row.get("LIVE_DATE_OB"))
            transition_date = iso(row.get("SUCCESS_TRANSITION_CALL_DATE_OB"))
            ant_transition = iso(row.get("ANTICIPATED_SUCCESS_TRANSITION_DATE_OB"))
            initial_pgl = iso(row.get("INITIAL_PROJECTED_GO_LIVE_DATE_OB"))
            koc_date = iso(row.get("OB_DISCOVERY_CALL_DATE_OB"))

            # Full timestamp (with time) of the last transition-status change, used
            # for the "Needs CSM 24h+" check. Don't run through iso() — that strips
            # the time component we need for an hours comparison.
            ts_updated = row.get("LAST_SUCCESS_TRANSITION_STATUS_UPDATED_OB")
            transition_status_updated = ts_updated.isoformat() if hasattr(ts_updated, "isoformat") else (str(ts_updated) if ts_updated else None)

            success_rep = success_reps.get(aid, "")

            # Derived
            transitioned = transition_date is not None
            cohort = row.get("COHORT_OB") or ""
            complexity = row.get("COMPLEXITY_TIER_OB") or ""

            # CSAT for this account
            acct_csat = csat_by_account.get(aid, [])
            csat_avg = None
            if acct_csat:
                scores = [c.get("SCORE") or c.get("score") for c in acct_csat if c.get("SCORE") or c.get("score")]
                csat_avg = round(sum(scores) / len(scores), 1) if scores else None

            # Ticket counts
            tc = ticket_counts.get(aid, {})
            open_tickets = tc.get("open_tickets", 0) or 0
            esc_tickets = tc.get("escalated_tickets", 0) or 0

            # Portal data (engagement score, portal status, specialists)
            me_tenant = None
            engagement_score = None
            portal_status = None
            specialists = {"DQA": {"status": None, "name": None}, "Telecom": {"status": None, "name": None}, "Fintech": {"status": None, "name": None}}
            poc = {"name": None, "email": None, "phone": None}
            csm = None
            package_name = None
            account_level = None
            external_links = {}

            pd = portal_data.get(aid, {})
            me_tenant = pd.get("_me")

            if me_tenant:
                engagement_score = me_tenant.get("engagementScore")
                portal_status = me_tenant.get("status")
                package_name = me_tenant.get("packageName")
                account_level = me_tenant.get("accountLevel")

                # Team updates
                for tu in me_tenant.get("teamUpdates", []):
                    team_name = tu.get("team")
                    if team_name in specialists:
                        specialists[team_name]["status"] = tu.get("status")
                        specialists[team_name]["data"] = tu.get("data", {})
                        spec = tu.get("specialist")
                        if spec:
                            specialists[team_name]["name"] = spec.get("name")

                # POC
                p = me_tenant.get("pointOfContact", {})
                if p:
                    poc = {"name": p.get("name"), "email": p.get("email"), "phone": p.get("phone")}

                # CSM
                csm_data = me_tenant.get("csm")
                if csm_data:
                    csm = csm_data.get("name")

                # External links
                external_links = me_tenant.get("externalLinks", {})

                # Rich detail fields (from /tenants/{id} via bookmarklet cache)
                eng_data = me_tenant.get("engagement", {}).get("data", {})
                if eng_data:
                    product = eng_data.get("Product", {})
                    training_data = eng_data.get("Training", {})
                    usage = {
                        "usersLoggedIn": product.get("Users Logged In", ""),
                        "techsLoggedIn": product.get("Technicians Logged In", ""),
                        "tadScore": product.get("TAD Score", ""),
                        "jobsBooked": product.get("Jobs Booked", ""),
                    }
                    training = {
                        "poc": training_data.get("Progress (POC)", ""),
                        "admins": training_data.get("Progress (Admins)", ""),
                        "nonAdmins": training_data.get("Progress (Non Admins)", ""),
                        "technicians": training_data.get("Progress (Technicians)", ""),
                    }
                else:
                    usage = None
                    training = None

                # PGL confidence
                sf_fields = me_tenant.get("importantSalesforceFields", {})
                pgl_confidence = sf_fields.get("projectedGoLiveConfidence")
                tenant_health = sf_fields.get("tenantHealth")

                # Flash brief
                flash_brief = me_tenant.get("flashBrief", "")

                # Previous software
                prev_sw = me_tenant.get("previousSoftware", {})
                previous_software = prev_sw.get("Existing Software", "") if prev_sw else ""

                # Trade / industry
                stats = me_tenant.get("stats", {})
                trade = stats.get("Industries", "")

            # Defaults for fields that only exist when portal data is available
            if not me_tenant:
                usage = None
                training = None
                pgl_confidence = None
                tenant_health = None
                flash_brief = None
                previous_software = None
                trade = ""

            # Build external links from Salesforce ID if portal didn't provide them
            if not external_links and aid:
                external_links = {
                    "sfdc": f"https://servicetitan.lightning.force.com/lightning/r/Account/{aid}/view",
                    "gong": f"https://app.gong.io/go/account?crm-id={aid}&crm-object-type=account",
                    "portal": f"https://custom-wizards.westus2-01.prod.prod.customer-journey.srv.servicetitan.com/admin/onboarding-portal/pipeline/{aid}/overview",
                }

            # Normalize external links to match data.js shape
            el = {}
            if external_links:
                el["sfdc"] = external_links.get("SFDC Account") or external_links.get("sfdc") or f"https://servicetitan.lightning.force.com/lightning/r/Account/{aid}/view"
                el["gong"] = external_links.get("Gong") or external_links.get("gong") or f"https://app.gong.io/go/account?crm-id={aid}&crm-object-type=account"
                el["dcc"] = external_links.get("DCC") or external_links.get("dcc", "")
                el["tenant"] = external_links.get("Tenant Management") or external_links.get("tenant", "")
                # Link straight to the onboarding record (Onboarding__c) via ID_OB.
                # ACCOUNT_ID_OB only opens the account's related-list of OB records.
                if ob_id:
                    el["sfdcOb"] = f"https://servicetitan.lightning.force.com/lightning/r/Onboarding__c/{ob_id}/view"
                else:
                    el["sfdcOb"] = external_links.get("SFDC OB Record") or external_links.get("sfdcOb") or f"https://servicetitan.lightning.force.com/lightning/r/Account/{aid}/related/Onboarding__r/view"
                el["portal"] = external_links.get("portal") or f"https://custom-wizards.westus2-01.prod.prod.customer-journey.srv.servicetitan.com/admin/onboarding-portal/pipeline/{aid}/overview"

            # Overlays
            ov = overlays.get(aid, {})

            account = {
                "id": aid,
                "tenant": row["NAME_ACCOUNT"] or "",
                "ic": ic_name,
                "manager": row.get("ONBOARDER_MANAGER_ACCNT") or "",
                "trade": trade,
                "status": status,
                "hs": hs,
                "hsComment": row.get("ONBOARDING_HEALTH_SCORE_COMMENTS_OB") or "",
                "hsLastUpdated": iso(row.get("LAST_UPDATED_HEALTH_SCORE_OB")),
                "implStart": impl_start,
                "pgl": pgl,
                "initialPgl": initial_pgl,
                "kocDate": koc_date,
                "pglConfidence": pgl_confidence,
                "liveDate": live_date,
                "transitionDate": transition_date,
                "antTransitionDate": ant_transition,
                "transitioned": transitioned,
                "techs": techs,
                "cmrr": cmrr,
                "outstandingBalance": float(row.get("OUTSTANDING_BALANCE") or 0),
                "complexity": complexity,
                "cohort": cohort,
                # Portal fields
                "engagementScore": engagement_score,
                "portalStatus": portal_status,
                "specialists": specialists,
                "training": training,
                "usage": usage,
                "engagementBreakdown": _get_eng_breakdown(pcache, aid),
                "poc": poc,
                "csm": csm,
                "previousSoftware": previous_software,
                "packageName": package_name,
                "accountLevel": account_level,
                "businessFocus": me_tenant.get("businessFocus", "Residential Service & Replacement") if me_tenant else "Residential Service & Replacement",
                "flashBrief": flash_brief,
                "tenantHealth": tenant_health,
                "successTransitionStatus": row.get("SUCCESS_TRANSITION_STATUS_OB") or "",
                "successRep": success_rep,
                "transitionStatusUpdatedAt": transition_status_updated,
                "externalLinks": el,
                # Tickets
                "tickets": [],  # loaded on drill-down for full list
                "openTickets": int(open_tickets),
                "escTickets": int(esc_tickets),
                "churnTickets": churn_tickets.get(aid, []),
                "isEscalationRisk": hs is not None and hs <= 2,
                "linkedTickets": ov.get("linkedTickets", []),
                # CSAT
                "csat": [],
                "csatAvg": None,
                # Overlays (manager-entered)
                "sentiment": ov.get("sentiment", None),
                "followUpDate": ov.get("followUpDate", None),
                "nextSteps": ov.get("nextSteps", ""),
                "notes": ov.get("notes", ""),
                "noteLog": ov.get("noteLog", []),
                "actionItems": ov.get("actionItems", []),
                "todos": ov.get("todos", []),
                # Lead-IC rescue/regular classification (overlays; never written to SFDC)
                "rescue": bool(ov.get("rescue", False)),
                "leadStage": ov.get("leadStage", None),
                "leadRescueStart": ov.get("leadRescueStart", None),
                "leadGoLive": ov.get("leadGoLive", None),
                "leadTransition": ov.get("leadTransition", None),
                "leadEndDate": ov.get("leadEndDate", None),
                "escalation": ov.get("escalation", None) if ov.get("escalation") else ({"open": True, "severity": "Manager-Engaged", "owner": "Auto-detected", "opened": iso(date.today()), "reason": f"Health score {hs} - escalation risk", "nextAction": "Review account and churn tickets", "nextActionDue": None, "source": "auto", "history": [], "concession": {"status": "None", "tier": None, "detail": "", "amt": None}} if (hs is not None and hs <= 2) else None),
            }
            accounts.append(account)

        # Drop accounts owned by ICs the senior has hidden (departed teammates).
        if role == "senior-manager":
            ex = _excluded_ics()
            if ex:
                accounts = [a for a in accounts if (a.get("ic") or "").strip().lower() not in ex]

        # 9. Build monthly history. The history/cycle-time/kickoffs/forecast blocks
        # below are full-table queries that only the manager dashboard renders;
        # lead ICs (My Pipeline / My Week Ahead) never use them, so skip them to
        # keep the lead load (and the refresh after adding/removing an account) fast.
        is_lead = (role == "lead-ic")
        history = {} if is_lead else build_history()

        # 10. CSAT by IC for the CSAT module
        ic_csat = {}
        for ic, scores in csat_by_ic.items():
            ic_csat[ic] = {
                "avg": round(sum(scores) / len(scores), 1) if scores else None,
                "count": len(scores),
            }

        # Cycle time: kickoff to success transition for recently transitioned accounts
        ct_data = []
        if not is_lead:
            try:
                ct_raw = run_query(f"""
                    SELECT
                        ONBOARDER_NAME_ACCNT AS ic,
                        DATEDIFF('DAY', IMPLEMENTATION_START_DATE_OB, SUCCESS_TRANSITION_CALL_DATE_OB) AS ct_days,
                        DATEDIFF('DAY', IMPLEMENTATION_START_DATE_OB, LIVE_DATE_OB) AS live_days,
                        DATEDIFF('DAY', LIVE_DATE_OB, SUCCESS_TRANSITION_CALL_DATE_OB) AS success_days
                    FROM FACT_OB_IMPL_PS_IMPLEMENTATION
                    WHERE ONBOARDER_NAME_ACCNT IN ({in_clause(get_ic_names())})
                    AND SUCCESS_TRANSITION_CALL_DATE_OB IS NOT NULL
                    AND SUCCESS_TRANSITION_CALL_DATE_OB >= DATEADD('MONTH', -6, CURRENT_DATE())
                """)
                def _d(r, k):
                    v = r.get(k.upper())
                    if v is None:
                        v = r.get(k)
                    return int(v) if v is not None else None
                ct_data = [{"ic": r.get("IC") or r.get("ic", ""), "days": _d(r, "ct_days") or 0,
                            "liveDays": _d(r, "live_days"), "successDays": _d(r, "success_days")} for r in ct_raw]
            except Exception as e:
                print(f"Cycle time query error: {e}", file=sys.stderr)

        # Check if portal cache exists
        has_portal = PORTAL_CACHE_FILE.exists()

        # Load upcoming kickoffs inline
        kickoffs = []
        if not is_lead:
            try:
                ko_rows = run_query(f"""
                    SELECT ACCOUNT_ID_OB, NAME_ACCOUNT, ONBOARDER_NAME_ACCNT,
                           ONBOARDING_STATUS_OB, IMPLEMENTATION_START_DATE_OB,
                           PROJECTED_GO_LIVE_DATE_OB, CMRR_OB
                    FROM FACT_OB_IMPL_PS_IMPLEMENTATION
                    WHERE ONBOARDER_NAME_ACCNT IN ({in_clause(get_ic_names())})
                    AND ONBOARDING_STATUS_OB IN ('Pre-Implementation', 'No Payment Method')
                    AND IMPLEMENTATION_START_DATE_OB IS NOT NULL
                    AND IMPLEMENTATION_START_DATE_OB >= DATE_TRUNC('MONTH', CURRENT_DATE())
                    AND IMPLEMENTATION_START_DATE_OB < DATEADD('MONTH', 2, DATE_TRUNC('MONTH', CURRENT_DATE()))
                    ORDER BY IMPLEMENTATION_START_DATE_OB
                """)
                for r in ko_rows:
                    kickoffs.append({
                        "id": r.get("ACCOUNT_ID_OB", ""),
                        "tenant": r.get("NAME_ACCOUNT", ""),
                        "ic": r.get("ONBOARDER_NAME_ACCNT", ""),
                        "status": r.get("ONBOARDING_STATUS_OB", ""),
                        "kickoff": iso(r.get("IMPLEMENTATION_START_DATE_OB")),
                        "pgl": iso(r.get("PROJECTED_GO_LIVE_DATE_OB")),
                        "cmrr": float(r.get("CMRR_OB") or 0),
                    })
            except Exception as e:
                print(f"Kickoffs query error: {e}", file=sys.stderr)

        # Snapshot-based forecast comparison for the current month
        forecast_compare = None
        if not is_lead:
            try:
                forecast_compare = build_forecast_compare(date.today().strftime("%Y-%m"))
            except Exception as e:
                print(f"Forecast compare error: {e}", file=sys.stderr)

        # Load global todos
        todos = load_todos() if TODOS_FILE.exists() else []

        # Lead pipeline: tag each account active/completed from my-accounts.json.
        if role == "lead-ic":
            _sm = my_account_status_map()
            for a in accounts:
                e = _sm.get(a["id"], {})
                a["leadCompleted"] = (e.get("status") == "completed")
                a["leadCompletedAt"] = e.get("completedAt")

        return jsonify({
            "accounts": accounts,
            "role": role,
            "superAdmin": is_super_admin(),
            "impersonating": _impersonation,
            "leadICs": LEAD_ICS,
            "seniorManager": _real_senior_name(),
            "managers": senior_managers,
            "team": get_team(),
            "manager": get_manager(),
            "history": history,
            "icCsat": ic_csat,
            "cycleTime": ct_data,
            "kickoffs": kickoffs,
            "forecastCompare": forecast_compare,
            "todos": todos,
            "assignees": build_assignees(),
            "sharedTasksConfigured": bool(SHARED_TASKS_SHEET_ID),
            "portalEnabled": has_portal,
            "syncedAt": datetime.now().isoformat(),
            "sourceSync": {
                "snowflake": datetime.now().isoformat(),
                "snowflakeDataAsOf": snowflake_data_as_of,
                "portal": pcache.get("syncedAt") if pcache else None,
            },
        })

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


def build_history():
    """Query Snowflake for monthly activation/transition history."""
    try:
        act_raw = run_query(f"""
            SELECT
                ONBOARDER_NAME_ACCNT AS ic,
                DATE_TRUNC('MONTH', LIVE_DATE_OB)::DATE AS month,
                COUNT(*) AS act,
                COALESCE(SUM(CMRR_OB), 0) AS act_dollars
            FROM FACT_OB_IMPL_PS_IMPLEMENTATION
            WHERE ONBOARDER_NAME_ACCNT IN ({in_clause(get_ic_names())})
            AND LIVE_DATE_OB IS NOT NULL
            AND LIVE_DATE_OB >= DATEADD('MONTH', -12, DATE_TRUNC('MONTH', CURRENT_DATE()))
            GROUP BY ic, month
            ORDER BY month
        """)

        trans_raw = run_query(f"""
            SELECT
                ONBOARDER_NAME_ACCNT AS ic,
                DATE_TRUNC('MONTH', SUCCESS_TRANSITION_CALL_DATE_OB)::DATE AS month,
                COUNT(*) AS trans,
                COALESCE(SUM(CMRR_OB), 0) AS trans_dollars
            FROM FACT_OB_IMPL_PS_IMPLEMENTATION
            WHERE ONBOARDER_NAME_ACCNT IN ({in_clause(get_ic_names())})
            AND SUCCESS_TRANSITION_CALL_DATE_OB IS NOT NULL
            AND SUCCESS_TRANSITION_CALL_DATE_OB >= DATEADD('MONTH', -12, DATE_TRUNC('MONTH', CURRENT_DATE()))
            GROUP BY ic, month
            ORDER BY month
        """)

        # Build the history structure matching data.js shape
        history = {}
        today = date.today()
        for i in range(12, -1, -1):
            d = date(today.year, today.month, 1) - timedelta(days=i * 30)
            d = date(d.year, d.month, 1)  # normalize to 1st of month
            key = d.strftime("%Y-%m")
            history[key] = {
                "key": key,
                "date": iso(d),
                "label": d.strftime("%b '%y"),
                "monthName": d.strftime("%B"),
                "byIc": {ic: {"act": 0, "trans": 0} for ic in get_ic_names()},
                "total": {"act": 0, "trans": 0},
            }

        for row in act_raw:
            key = iso(row.get("MONTH") or row.get("month"))[:7]
            if key in history:
                history[key]["byIc"][row.get("IC") or row.get("ic", "")]["act"] = int(row.get("ACT") or row.get("act", 0))
                history[key]["total"]["act"] += int(row.get("ACT") or row.get("act", 0))

        for row in trans_raw:
            key = iso(row.get("MONTH") or row.get("month"))[:7]
            if key in history:
                history[key]["byIc"][row.get("IC") or row.get("ic", "")]["trans"] = int(row.get("TRANS") or row.get("trans", 0))
                history[key]["total"]["trans"] += int(row.get("TRANS") or row.get("trans", 0))

        return history

    except Exception as e:
        print(f"History query error: {e}", file=sys.stderr)
        return {}


# ── API: Account detail (Portal enrichment) ────────────────────────────────

@app.route("/api/portal/tenant/<sf_id>")
def api_portal_tenant(sf_id):
    """Proxy to Portal API for full tenant detail."""
    if not portal_enabled():
        return jsonify({"error": "Portal API not enabled. Set PORTAL_ENABLED=1 and PORTAL_COOKIE."}), 503
    try:
        data = portal_get(f"onboarding-portal/tenants/{sf_id}")
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": str(e)}), 502


@app.route("/api/portal/engagement/<sf_id>")
def api_portal_engagement(sf_id):
    """Proxy to Portal API for engagement score breakdown."""
    if not portal_enabled():
        return jsonify({"error": "Portal API not enabled."}), 503
    try:
        data = portal_get(f"onboarding-portal/engagement-score/tenants/{sf_id}")
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": str(e)}), 502


@app.route("/api/portal/calendar/<sf_id>")
def api_portal_calendar(sf_id):
    """Proxy to Portal API for calendar events."""
    if not portal_enabled():
        return jsonify({"error": "Portal API not enabled."}), 503
    try:
        data = portal_get(f"onboarding-portal/calendar/events", params={"salesforceId": sf_id})
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": str(e)}), 502


# ── API: Tickets for a specific account ─────────────────────────────────────

@app.route("/api/tickets/<account_id>")
def api_tickets(account_id):
    """Query SFDC support cases for a specific account."""
    try:
        rows = run_query(f"""
            SELECT
                CASE_NUMBER, SUBJECT, STATUS, PRIORITY,
                CASE_CREATEDDATETIME AS created,
                CASE_AGENT_NAME AS agent,
                ESCALATION_FLAG AS esc_flag,
                ESCALATION_CLASSIFICATION AS esc_classification,
                CLOSED_DATETIME AS closed,
                CASE_CSAT_RATING AS csat_rating,
                CASE_ESCALATION_OWNER AS esc_owner
            FROM VW_SUPPORT_CASES
            WHERE ACCOUNT_ID = '{account_id}'
            AND IS_DELETED = FALSE
            ORDER BY CASE_CREATEDDATETIME DESC
            LIMIT 50
        """)

        tickets = []
        for r in rows:
            tickets.append({
                "num": r.get("CASE_NUMBER", ""),
                "subject": r.get("SUBJECT", ""),
                "status": r.get("STATUS", ""),
                "priority": r.get("PRIORITY", ""),
                "created": iso(r.get("created")),
                "agent": r.get("agent", ""),
                "escFlag": bool(r.get("esc_flag")),
                "escClassification": r.get("esc_classification", ""),
                "closed": iso(r.get("closed")),
                "csatRating": r.get("csat_rating"),
                "escOwner": r.get("esc_owner", ""),
            })

        return jsonify({"tickets": tickets})

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


# ── API: Overlays (read/write) ──────────────────────────────────────────────

@app.route("/api/overlays", methods=["GET"])
def api_overlays_get():
    return jsonify(load_overlays())


@app.route("/api/overlays", methods=["POST"])
def api_overlays_save():
    data = request.get_json()
    account_id = data.get("id")
    if not account_id:
        return jsonify({"error": "Missing account id"}), 400

    # Merge (don't overwrite) so unrelated fields like noteLog survive a save that
    # only carries, say, an escalation edit.
    overlays = load_overlays()
    ov = overlays.get(account_id, {})
    for k in ("sentiment", "followUpDate", "nextSteps", "notes", "noteLog",
              "actionItems", "todos", "linkedTickets", "escalation"):
        if k in data:
            ov[k] = data[k]
    overlays[account_id] = ov
    save_overlays(overlays)
    return jsonify({"ok": True})


# ── API: Account notes log + tasks + tag library ────────────────────────────
# A running, timestamped notes log per account (replaces the old single textarea),
# plus call tasks and a per-user tag library. All persist via the per-account
# overlay (.data/overlays.json); the tag library lives in .data/tag-library.json.

TAG_LIBRARY_FILE = DATA_DIR / "tag-library.json"
DEFAULT_TAG_LIBRARY = ["Call", "Risk", "Customer-facing", "Internal", "Go-live",
                       "Data / DQA", "Pricebook", "Training", "Billing",
                       "Escalation", "Champion", "Follow-up"]
_note_seq = 0


def _gen_id(prefix):
    global _note_seq
    _note_seq += 1
    return f"{prefix}_{int(datetime.now().timestamp()*1000)}_{_note_seq}"


def _author():
    return get_manager().get("fullName") or get_snowflake_user() or "Unknown"


def _overlay_for(account_id):
    """Return (all_overlays, this_account_overlay_dict)."""
    overlays = load_overlays()
    ov = overlays.get(account_id) or {}
    overlays[account_id] = ov
    return overlays, ov


@app.route("/api/notes/add", methods=["POST"])
def api_notes_add():
    d = request.get_json(force=True) or {}
    aid, text = d.get("accountId"), (d.get("text") or "").strip()
    if not aid or not text:
        return jsonify({"error": "accountId and text required"}), 400
    overlays, ov = _overlay_for(aid)
    highlights = [s for s in (d.get("highlights") or []) if s and s.strip()]
    note = {
        "id": _gen_id("n"), "text": text, "at": datetime.now().isoformat(),
        "by": _author(), "tags": d.get("tags") or [], "pinned": False,
        "highlights": highlights, "hasTask": len(highlights) > 0, "edited": False,
    }
    ov["noteLog"] = [note] + (ov.get("noteLog") or [])
    # spin off a task per highlighted span
    tasks = ov.get("actionItems") or []
    for s in highlights:
        tasks.insert(0, {"id": _gen_id("t"), "text": s.strip(), "done": False,
                         "due": None, "remind": None, "fromNoteId": note["id"]})
    ov["actionItems"] = tasks
    save_overlays(overlays)
    return jsonify({"ok": True, "note": note, "tasks": tasks})


@app.route("/api/notes/update", methods=["POST"])
def api_notes_update():
    d = request.get_json(force=True) or {}
    aid, nid = d.get("accountId"), d.get("noteId")
    overlays, ov = _overlay_for(aid)
    for n in ov.get("noteLog", []):
        if n["id"] == nid:
            if "text" in d:
                n["text"] = (d["text"] or "").strip(); n["edited"] = True
            if "tags" in d:
                n["tags"] = d["tags"] or []
            if "pinned" in d:
                n["pinned"] = bool(d["pinned"])
            if "highlights" in d:
                n["highlights"] = d["highlights"] or []
                n["hasTask"] = bool(n["highlights"])
    save_overlays(overlays)
    return jsonify({"ok": True})


@app.route("/api/notes/delete", methods=["POST"])
def api_notes_delete():
    d = request.get_json(force=True) or {}
    aid, nid = d.get("accountId"), d.get("noteId")
    overlays, ov = _overlay_for(aid)
    ov["noteLog"] = [n for n in ov.get("noteLog", []) if n["id"] != nid]
    save_overlays(overlays)
    return jsonify({"ok": True})


@app.route("/api/tasks/add", methods=["POST"])
def api_tasks_add():
    d = request.get_json(force=True) or {}
    aid, text = d.get("accountId"), (d.get("text") or "").strip()
    if not aid or not text:
        return jsonify({"error": "accountId and text required"}), 400
    overlays, ov = _overlay_for(aid)
    task = {"id": _gen_id("t"), "text": text, "done": False,
            "due": d.get("due"), "remind": d.get("remind"),
            "fromNoteId": d.get("fromNoteId")}
    ov["actionItems"] = [task] + (ov.get("actionItems") or [])
    save_overlays(overlays)
    return jsonify({"ok": True, "task": task})


@app.route("/api/tasks/update", methods=["POST"])
def api_tasks_update():
    d = request.get_json(force=True) or {}
    aid, tid = d.get("accountId"), d.get("taskId")
    overlays, ov = _overlay_for(aid)
    for t in ov.get("actionItems", []):
        if t.get("id") == tid:
            for f in ("done", "due", "remind", "text"):
                if f in d:
                    t[f] = d[f]
    save_overlays(overlays)
    return jsonify({"ok": True})


@app.route("/api/tasks/delete", methods=["POST"])
def api_tasks_delete():
    d = request.get_json(force=True) or {}
    aid, tid = d.get("accountId"), d.get("taskId")
    overlays, ov = _overlay_for(aid)
    ov["actionItems"] = [t for t in ov.get("actionItems", []) if t.get("id") != tid]
    save_overlays(overlays)
    return jsonify({"ok": True})


@app.route("/api/tags")
def api_tags_get():
    if TAG_LIBRARY_FILE.exists():
        try:
            lib = json.loads(TAG_LIBRARY_FILE.read_text())
            if isinstance(lib, list) and lib:
                return jsonify(lib)
        except Exception:
            pass
    return jsonify(DEFAULT_TAG_LIBRARY)


@app.route("/api/tags/add", methods=["POST"])
def api_tags_add():
    d = request.get_json(force=True) or {}
    tag = (d.get("tag") or "").strip()
    if not tag:
        return jsonify({"error": "tag required"}), 400
    lib = DEFAULT_TAG_LIBRARY[:]
    if TAG_LIBRARY_FILE.exists():
        try:
            saved = json.loads(TAG_LIBRARY_FILE.read_text())
            if isinstance(saved, list) and saved:
                lib = saved
        except Exception:
            pass
    if not any(t.lower() == tag.lower() for t in lib):
        lib.append(tag)
        TAG_LIBRARY_FILE.write_text(json.dumps(lib, indent=2))
    return jsonify({"ok": True, "library": lib})


# ── API: Portal cookie config ──────────────────────────────────────────────

@app.route("/api/config/portal-cookie", methods=["POST"])
def api_set_portal_cookie():
    """Manually set the Portal API cookie (fallback if browser-cookie3 isn't available)."""
    data = request.get_json()
    cookie = data.get("cookie", "")
    os.environ["PORTAL_COOKIE"] = cookie
    return jsonify({"ok": True, "enabled": bool(cookie)})


@app.route("/api/config/portal-status")
def api_portal_status():
    return jsonify({
        "enabled": portal_enabled(),
        "method": "browser-cookie3 (auto)" if HAS_BROWSER_COOKIES else ("manual cookie" if os.environ.get("PORTAL_COOKIE") else "disabled"),
    })


# ── API: MAX capacity tracker (read-only view of the Google Sheet) ─────────

CAPACITY_SHEET_ID = "1VEyq5hke8odHLfzXbbf88ZHbcz6k9jOMU_BIZ-TEv4A"  # MAX New Logo Backlog & Resource Assignment Tracker
CAPACITY_SHEET_URL = f"https://docs.google.com/spreadsheets/d/{CAPACITY_SHEET_ID}/edit"
CAPACITY_DEFAULT_TAB = "Capacity Tracker"
CAPACITY_MAX_ROWS = 500


@app.route("/api/capacity", methods=["GET"])
def api_capacity():
    """Read one tab of the capacity tracker sheet. Read-only. The tab name is
    checked against the sheet's real tab titles, so a range is never built from
    raw user input."""
    base = {"url": CAPACITY_SHEET_URL, "tabs": [], "tab": "", "values": [], "truncated": False}
    svc = get_sheets_service()
    if svc is None:
        return jsonify({**base, "connected": False})
    try:
        meta = svc.spreadsheets().get(spreadsheetId=CAPACITY_SHEET_ID, fields="sheets.properties.title").execute()
        tabs = [s["properties"]["title"] for s in meta.get("sheets", [])]
        tab = request.args.get("tab") or CAPACITY_DEFAULT_TAB
        if tab not in tabs:
            tab = CAPACITY_DEFAULT_TAB if CAPACITY_DEFAULT_TAB in tabs else (tabs[0] if tabs else "")
        values = []
        if tab:
            rng = "'" + tab.replace("'", "''") + "'"
            values = svc.spreadsheets().values().get(
                spreadsheetId=CAPACITY_SHEET_ID, range=rng, valueRenderOption="FORMATTED_VALUE"
            ).execute().get("values", [])
        truncated = len(values) > CAPACITY_MAX_ROWS
        return jsonify({**base, "connected": True, "tabs": tabs, "tab": tab,
                        "values": values[:CAPACITY_MAX_ROWS], "truncated": truncated})
    except Exception as e:
        return jsonify({**base, "connected": True, "error": str(e)})


# ── API: Identity diagnostics (read-only) ──────────────────────────────────

@app.route("/api/debug/identity", methods=["GET"])
def api_debug_identity():
    """Explain why team auto-detection found (or did not find) a roster.
    Read-only. Shows the email in use, the Snowflake role, how many rows match
    that email exactly, and near-matches by email prefix and by manager name."""
    out = {}
    email = get_snowflake_user()
    out["emailInUse"] = repr(email)  # repr() makes stray spaces or newlines visible
    try:
        out["snowflakeRole"] = run_query("SELECT CURRENT_ROLE() AS R")[0].get("R")
        e = _sql_str(email.strip().lower())
        out["rowsMatchingEmailExactly"] = run_query(
            f"SELECT COUNT(*) AS N FROM FACT_OB_IMPL_PS_IMPLEMENTATION WHERE LOWER(ONBOARDER_MANAGER_EMAIL_ACCNT) = '{e}'"
        )[0].get("N")
        local = _sql_str(email.split("@")[0].strip().lower())
        out["managerEmailsLikeYours"] = run_query(f"""
            SELECT ONBOARDER_MANAGER_EMAIL_ACCNT AS MANAGER_EMAIL, ONBOARDER_MANAGER_ACCNT AS MANAGER_NAME, COUNT(*) AS ACCOUNTS
            FROM FACT_OB_IMPL_PS_IMPLEMENTATION
            WHERE LOWER(ONBOARDER_MANAGER_EMAIL_ACCNT) LIKE '%{local}%'
            GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 10
        """)
        # How much of the table can this login see at all (row-level security check)?
        out["totalRowsVisibleToYou"] = run_query(
            "SELECT COUNT(*) AS N FROM FACT_OB_IMPL_PS_IMPLEMENTATION")[0].get("N")
        out["topManagersVisibleToYou"] = run_query("""
            SELECT ONBOARDER_MANAGER_ACCNT AS MANAGER_NAME, ONBOARDER_MANAGER_EMAIL_ACCNT AS MANAGER_EMAIL, COUNT(*) AS ACCOUNTS
            FROM FACT_OB_IMPL_PS_IMPLEMENTATION
            GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 15
        """)
        # Where do specific ICs sit? Pass names: /api/debug/identity?ics=Davon,Parris
        ics = [x.strip() for x in (request.args.get("ics") or "").split(",") if x.strip()]
        if ics:
            cond = " OR ".join(f"ONBOARDER_NAME_ACCNT ILIKE '%{_sql_str(x)}%'" for x in ics[:8])
            out["icLookup"] = run_query(f"""
                SELECT ONBOARDER_NAME_ACCNT AS IC, ONBOARDER_MANAGER_ACCNT AS MANAGER_NAME,
                       ONBOARDER_MANAGER_EMAIL_ACCNT AS MANAGER_EMAIL, ONBOARDING_STATUS_OB AS STATUS, COUNT(*) AS ACCOUNTS
                FROM FACT_OB_IMPL_PS_IMPLEMENTATION
                WHERE {cond}
                GROUP BY 1, 2, 3, 4 ORDER BY 1, 5 DESC LIMIT 60
            """)
        last = _sql_str((load_config().get("manager", {}).get("fullName") or "").strip().split(" ")[-1])
        if last:
            out["managersWithYourLastName"] = run_query(f"""
                SELECT ONBOARDER_MANAGER_EMAIL_ACCNT AS MANAGER_EMAIL, ONBOARDER_MANAGER_ACCNT AS MANAGER_NAME, COUNT(*) AS ACCOUNTS
                FROM FACT_OB_IMPL_PS_IMPLEMENTATION
                WHERE ONBOARDER_MANAGER_ACCNT ILIKE '%{last}%'
                GROUP BY 1, 2 ORDER BY 3 DESC LIMIT 10
            """)
    except Exception as ex:
        out["error"] = str(ex)
    d = _detect_identity()
    out["detected"] = {"managerName": d.get("managerName"), "teamSize": len(d.get("team", [])),
                       "team": [t.get("name") for t in d.get("team", [])]}
    return jsonify(out)


# ── API: Team management ───────────────────────────────────────────────────

@app.route("/api/config/team", methods=["GET"])
def api_team_get():
    """Return the current team roster."""
    cfg = load_config()
    return jsonify({"manager": cfg.get("manager", {}), "team": cfg.get("team", [])})


@app.route("/api/config/team/add", methods=["POST"])
def api_team_add():
    """Add an IC to the team roster.
    Body: {"name": "Full Snowflake Name", "short": "Display Name", "level": "IC2"}
    """
    data = request.get_json()
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "Name is required (must match Snowflake ONBOARDER_NAME_ACCNT)"}), 400

    cfg = load_config()
    team = cfg.get("team", [])

    # Check for duplicates
    if any(ic["name"] == name for ic in team):
        return jsonify({"error": f"{name} is already on the team"}), 409

    # Auto-generate defaults
    parts = name.split()
    short = data.get("short", "")
    if not short:
        short = f"{parts[0]} {parts[-1][0]}" if len(parts) > 1 else parts[0]

    initials = "".join(p[0].upper() for p in parts[:2])

    color_idx = len(team) % len(IC_COLORS)

    new_ic = {
        "name": name,
        "short": short,
        "initials": initials,
        "color": data.get("color", IC_COLORS[color_idx]),
        "level": data.get("level", "IC2"),
        "status": data.get("status", "Active"),
        "onLeave": data.get("onLeave", False),
        "filter": data.get("filter", {}),
    }

    team.append(new_ic)
    cfg["team"] = team
    save_config(cfg)

    return jsonify({"ok": True, "added": new_ic, "teamSize": len(team)})


@app.route("/api/config/team/remove", methods=["POST"])
def api_team_remove():
    """Remove an IC from the team roster.
    Body: {"name": "Full Snowflake Name"}
    """
    data = request.get_json()
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "Name is required"}), 400

    cfg = load_config()
    team = cfg.get("team", [])
    before = len(team)
    cfg["team"] = [ic for ic in team if ic["name"] != name]
    after = len(cfg["team"])

    if before == after:
        return jsonify({"error": f"{name} not found on the team"}), 404

    save_config(cfg)
    return jsonify({"ok": True, "removed": name, "teamSize": after})


@app.route("/api/config/team/update", methods=["POST"])
def api_team_update():
    """Update an IC's details (level, status, onLeave, short name).
    Body: {"name": "Full Snowflake Name", "level": "IC3", "status": "Active", ...}
    """
    data = request.get_json()
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "Name is required"}), 400

    cfg = load_config()
    found = False
    for ic in cfg.get("team", []):
        if ic["name"] == name:
            for field in ("short", "level", "status", "onLeave", "color", "initials"):
                if field in data:
                    ic[field] = data[field]
            found = True
            break

    if not found:
        return jsonify({"error": f"{name} not found on the team"}), 404

    save_config(cfg)
    return jsonify({"ok": True, "updated": name})




# ── API: IC Performance Stats ───────────────────────────────────────────────

def fiscal_quarter(d):
    """Return fiscal quarter string for a date (FY starts Feb 1)."""
    m = d.month
    y = d.year
    if m >= 2 and m <= 4:
        return f"FY{y}Q1"
    elif m >= 5 and m <= 7:
        return f"FY{y}Q2"
    elif m >= 8 and m <= 10:
        return f"FY{y}Q3"
    else:  # Nov, Dec, Jan
        fy = y + 1 if m >= 11 else y
        return f"FY{fy}Q4"

def parse_period(period):
    """Parse period string into start/end dates.
    Formats: '2026-06' (month), 'FY2026Q2' (fiscal quarter), 'YTD', 'L3', 'L6', 'L12'
    """
    today = date.today()
    if period == "YTD":
        # Fiscal year starts Feb 1
        fy_start = date(today.year if today.month >= 2 else today.year - 1, 2, 1)
        return fy_start, today
    elif period == "L3":
        return today - timedelta(days=90), today
    elif period == "L6":
        return today - timedelta(days=180), today
    elif period == "L12":
        return today - timedelta(days=365), today
    elif period.startswith("FY"):
        # e.g. FY2026Q2
        fy = int(period[2:6])
        q = int(period[7])
        if q == 1:
            return date(fy, 2, 1), date(fy, 5, 1)
        elif q == 2:
            return date(fy, 5, 1), date(fy, 8, 1)
        elif q == 3:
            return date(fy, 8, 1), date(fy, 11, 1)
        else:  # Q4
            return date(fy - 1, 11, 1), date(fy, 2, 1)
    elif len(period) == 7:
        # e.g. 2026-06
        y, m = int(period[:4]), int(period[5:7])
        start = date(y, m, 1)
        if m == 12:
            end = date(y + 1, 1, 1)
        else:
            end = date(y, m + 1, 1)
        return start, end
    else:
        # Default: current month
        start = date(today.year, today.month, 1)
        if today.month == 12:
            end = date(today.year + 1, 1, 1)
        else:
            end = date(today.year, today.month + 1, 1)
        return start, end

@app.route("/api/ic-stats")
def api_ic_stats():
    """Return per-IC performance stats for a given time period."""
    period = request.args.get("period", date.today().strftime("%Y-%m"))
    try:
        start, end = parse_period(period)
        start_str, end_str = str(start), str(end)
        ic_names = get_ic_names()

        # Activations (logos + dollars)
        act = run_query(f"""
            SELECT ONBOARDER_NAME_ACCNT AS ic,
                   COUNT(*) AS logos, COALESCE(SUM(CMRR_OB), 0) AS dollars
            FROM FACT_OB_IMPL_PS_IMPLEMENTATION
            WHERE ONBOARDER_NAME_ACCNT IN ({in_clause(ic_names)})
            AND LIVE_DATE_OB >= '{start_str}' AND LIVE_DATE_OB < '{end_str}'
            GROUP BY ic
        """)

        # Transitions (logos + dollars)
        trans = run_query(f"""
            SELECT ONBOARDER_NAME_ACCNT AS ic,
                   COUNT(*) AS logos, COALESCE(SUM(CMRR_OB), 0) AS dollars
            FROM FACT_OB_IMPL_PS_IMPLEMENTATION
            WHERE ONBOARDER_NAME_ACCNT IN ({in_clause(ic_names)})
            AND SUCCESS_TRANSITION_CALL_DATE_OB >= '{start_str}' AND SUCCESS_TRANSITION_CALL_DATE_OB < '{end_str}'
            GROUP BY ic
        """)

        # Projected go-lives (not yet live, PGL in range)
        proj_gl = run_query(f"""
            SELECT ONBOARDER_NAME_ACCNT AS ic,
                   COUNT(*) AS logos, COALESCE(SUM(CMRR_OB), 0) AS dollars
            FROM FACT_OB_IMPL_PS_IMPLEMENTATION
            WHERE ONBOARDER_NAME_ACCNT IN ({in_clause(ic_names)})
            AND PROJECTED_GO_LIVE_DATE_OB >= '{start_str}' AND PROJECTED_GO_LIVE_DATE_OB < '{end_str}'
            AND ONBOARDING_STATUS_OB NOT IN ('Live', 'Success', 'Churn', 'Opted Out', 'Rejected')
            GROUP BY ic
        """)

        # Projected transitions (not yet transitioned, ant date in range)
        proj_tr = run_query(f"""
            SELECT ONBOARDER_NAME_ACCNT AS ic,
                   COUNT(*) AS logos, COALESCE(SUM(CMRR_OB), 0) AS dollars
            FROM FACT_OB_IMPL_PS_IMPLEMENTATION
            WHERE ONBOARDER_NAME_ACCNT IN ({in_clause(ic_names)})
            AND ANTICIPATED_SUCCESS_TRANSITION_DATE_OB >= '{start_str}' AND ANTICIPATED_SUCCESS_TRANSITION_DATE_OB < '{end_str}'
            AND SUCCESS_TRANSITION_CALL_DATE_OB IS NULL
            AND ONBOARDING_STATUS_OB NOT IN ('Success', 'Churn', 'Opted Out', 'Rejected')
            GROUP BY ic
        """)

        # Cycle time (for accounts transitioned in range)
        ct = run_query(f"""
            SELECT ONBOARDER_NAME_ACCNT AS ic,
                   AVG(DATEDIFF('DAY', IMPLEMENTATION_START_DATE_OB, SUCCESS_TRANSITION_CALL_DATE_OB)) AS avg_days,
                   COUNT(*) AS cnt,
                   SUM(CASE WHEN DATEDIFF('WEEK', IMPLEMENTATION_START_DATE_OB, SUCCESS_TRANSITION_CALL_DATE_OB) > 4 THEN 1 ELSE 0 END) AS over_4wk,
                   SUM(CASE WHEN DATEDIFF('WEEK', IMPLEMENTATION_START_DATE_OB, SUCCESS_TRANSITION_CALL_DATE_OB) > 5 THEN 1 ELSE 0 END) AS over_5wk
            FROM FACT_OB_IMPL_PS_IMPLEMENTATION
            WHERE ONBOARDER_NAME_ACCNT IN ({in_clause(ic_names)})
            AND SUCCESS_TRANSITION_CALL_DATE_OB >= '{start_str}' AND SUCCESS_TRANSITION_CALL_DATE_OB < '{end_str}'
            GROUP BY ic
        """)

        # CSAT
        csat = run_query(f"""
            SELECT ONBOARDER_NAME_ACCNT AS ic,
                   AVG(CSAT_AO) AS avg_score, COUNT(*) AS cnt,
                   SUM(CASE WHEN CSAT_AO >= 4 THEN 1 ELSE 0 END) AS good,
                   SUM(CASE WHEN CSAT_AO < 3 THEN 1 ELSE 0 END) AS bad
            FROM FACT_OB_IMPL_PS_CSAT
            WHERE ONBOARDER_NAME_ACCNT IN ({in_clause(ic_names)})
            AND SURVEY_RESPONDED_AO = TRUE
            AND SURVEY_RESPONDED_DATE_AO >= '{start_str}' AND SURVEY_RESPONDED_DATE_AO < '{end_str}'
            GROUP BY ic
        """)

        # CSAT individual responses (for links)
        csat_detail = run_query(f"""
            SELECT ONBOARDER_NAME_ACCNT AS ic, ACCOUNT_ID_OB, NAME_ACCOUNT,
                   CSAT_AO AS score, USER_COMMENT_AO AS comment,
                   SURVEY_RESPONDED_DATE_AO AS responded, FULL_NAME_AO AS respondent
            FROM FACT_OB_IMPL_PS_CSAT
            WHERE ONBOARDER_NAME_ACCNT IN ({in_clause(ic_names)})
            AND SURVEY_RESPONDED_AO = TRUE
            AND SURVEY_RESPONDED_DATE_AO >= '{start_str}' AND SURVEY_RESPONDED_DATE_AO < '{end_str}'
            ORDER BY SURVEY_RESPONDED_DATE_AO DESC
        """)

        def to_dict(rows, key_field="IC"):
            d = {}
            for r in rows:
                ic = r.get(key_field) or r.get(key_field.lower(), "")
                d[ic] = r
            return d

        act_d = to_dict(act)
        trans_d = to_dict(trans)
        proj_gl_d = to_dict(proj_gl)
        proj_tr_d = to_dict(proj_tr)
        ct_d = to_dict(ct)
        csat_d = to_dict(csat)

        # Build CSAT details by IC
        csat_by_ic = {}
        for r in csat_detail:
            ic = r.get("IC") or r.get("ic", "")
            if ic not in csat_by_ic:
                csat_by_ic[ic] = []
            csat_by_ic[ic].append({
                "accountId": r.get("ACCOUNT_ID_OB") or r.get("account_id_ob", ""),
                "accountName": r.get("NAME_ACCOUNT") or r.get("name_account", ""),
                "score": float(r.get("SCORE") or r.get("score") or 0),
                "comment": r.get("COMMENT") or r.get("comment", ""),
                "date": iso(r.get("RESPONDED") or r.get("responded")),
                "respondent": r.get("RESPONDENT") or r.get("respondent", ""),
            })

        # Build per-IC stats
        stats = []
        for ic in ic_names:
            a = act_d.get(ic, {})
            tr = trans_d.get(ic, {})
            pg = proj_gl_d.get(ic, {})
            pt = proj_tr_d.get(ic, {})
            c = ct_d.get(ic, {})
            cs = csat_d.get(ic, {})

            stats.append({
                "ic": ic,
                "activations": {"logos": int(a.get("LOGOS") or a.get("logos") or 0), "dollars": float(a.get("DOLLARS") or a.get("dollars") or 0)},
                "transitions": {"logos": int(tr.get("LOGOS") or tr.get("logos") or 0), "dollars": float(tr.get("DOLLARS") or tr.get("dollars") or 0)},
                "projectedGoLives": {"logos": int(pg.get("LOGOS") or pg.get("logos") or 0), "dollars": float(pg.get("DOLLARS") or pg.get("dollars") or 0)},
                "projectedTransitions": {"logos": int(pt.get("LOGOS") or pt.get("logos") or 0), "dollars": float(pt.get("DOLLARS") or pt.get("dollars") or 0)},
                "cycleTime": {
                    "avgDays": round(float(c.get("AVG_DAYS") or c.get("avg_days") or 0), 1),
                    "count": int(c.get("CNT") or c.get("cnt") or 0),
                    "over4wk": int(c.get("OVER_4WK") or c.get("over_4wk") or 0),
                    "over5wk": int(c.get("OVER_5WK") or c.get("over_5wk") or 0),
                },
                "csat": {
                    "avg": round(float(cs.get("AVG_SCORE") or cs.get("avg_score") or 0), 2) if (cs.get("AVG_SCORE") or cs.get("avg_score")) else None,
                    "count": int(cs.get("CNT") or cs.get("cnt") or 0),
                    "good": int(cs.get("GOOD") or cs.get("good") or 0),
                    "bad": int(cs.get("BAD") or cs.get("bad") or 0),
                },
                "csatResponses": csat_by_ic.get(ic, []),
            })

        # Current fiscal quarter
        fq = fiscal_quarter(date.today())

        return jsonify({
            "period": period,
            "start": str(start),
            "end": str(end),
            "fiscalQuarter": fq,
            "stats": stats,
        })

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500




# ── API: Auto-detect team from Snowflake ────────────────────────────────────

@app.route("/api/config/auto-detect-team", methods=["POST"])
def api_auto_detect_team():
    """Auto-detect ICs from Snowflake based on ONBOARDER_MANAGER_ACCNT."""
    try:
        cfg = load_config()
        manager_name = cfg.get("manager", {}).get("fullName", "")
        if not manager_name:
            return jsonify({"error": "Set manager.fullName in config.json first"}), 400

        rows = run_query(f"""
            SELECT DISTINCT ONBOARDER_NAME_ACCNT
            FROM FACT_OB_IMPL_PS_IMPLEMENTATION
            WHERE ONBOARDER_MANAGER_ACCNT = '{manager_name}'
            AND ONBOARDING_STATUS_OB IN ({in_clause(ACTIVE_STATUSES)})
            ORDER BY ONBOARDER_NAME_ACCNT
        """)

        detected = [r["ONBOARDER_NAME_ACCNT"] for r in rows if r.get("ONBOARDER_NAME_ACCNT")]
        existing_names = {ic["name"] for ic in cfg.get("team", [])}

        added = []
        for name in detected:
            if name not in existing_names:
                parts = name.split()
                short = f"{parts[0]} {parts[-1][0]}" if len(parts) > 1 else parts[0]
                initials = "".join(p[0].upper() for p in parts[:2])
                color_idx = len(cfg.get("team", [])) % len(IC_COLORS)
                cfg.setdefault("team", []).append({
                    "name": name, "short": short, "initials": initials,
                    "color": IC_COLORS[color_idx], "level": "IC2", "status": "Active",
                    "onLeave": False, "autoDetected": True, "filter": {},
                })
                added.append(name)

        if added:
            save_config(cfg)

        return jsonify({
            "ok": True, "managerName": manager_name,
            "detected": detected, "added": added,
            "totalTeam": len(cfg.get("team", [])),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ── API: Portal sync (bookmarklet-based) ───────────────────────────────────

PORTAL_CACHE_FILE = DATA_DIR / "portal-cache.json"
TODOS_FILE = DATA_DIR / "todos.json"


# ── API: Upcoming kickoffs ──────────────────────────────────────────────────

@app.route("/api/kickoffs")
def api_kickoffs():
    """Return accounts kicking off this month and next month."""
    try:
        rows = run_query(f"""
            SELECT
                ACCOUNT_ID_OB, NAME_ACCOUNT, ONBOARDER_NAME_ACCNT,
                ONBOARDING_STATUS_OB, IMPLEMENTATION_START_DATE_OB,
                PROJECTED_GO_LIVE_DATE_OB, CMRR_OB, COMPLEXITY_TIER_OB,
                ONBOARDING_HEALTH_SCORE_OB
            FROM FACT_OB_IMPL_PS_IMPLEMENTATION
            WHERE ONBOARDER_NAME_ACCNT IN ({in_clause(get_ic_names())})
            AND ONBOARDING_STATUS_OB IN ('Pre-Implementation', 'No Payment Method')
            AND IMPLEMENTATION_START_DATE_OB IS NOT NULL
            AND IMPLEMENTATION_START_DATE_OB >= DATE_TRUNC('MONTH', CURRENT_DATE())
            AND IMPLEMENTATION_START_DATE_OB < DATEADD('MONTH', 2, DATE_TRUNC('MONTH', CURRENT_DATE()))
            ORDER BY IMPLEMENTATION_START_DATE_OB
        """)
        kickoffs = []
        for r in rows:
            kickoffs.append({
                "id": r.get("ACCOUNT_ID_OB", ""),
                "tenant": r.get("NAME_ACCOUNT", ""),
                "ic": r.get("ONBOARDER_NAME_ACCNT", ""),
                "status": r.get("ONBOARDING_STATUS_OB", ""),
                "kickoff": iso(r.get("IMPLEMENTATION_START_DATE_OB")),
                "pgl": iso(r.get("PROJECTED_GO_LIVE_DATE_OB")),
                "cmrr": float(r.get("CMRR_OB") or 0),
                "complexity": r.get("COMPLEXITY_TIER_OB", ""),
            })
        return jsonify({"kickoffs": kickoffs})
    except Exception as e:
        return jsonify({"error": str(e), "kickoffs": []}), 500


# ── API: Forecast tracking (weekly snapshot based) ──────────────────────────
#
# We no longer ask the user to manually "capture" a forecast. Instead we read
# the FACT_OB_IMPL_WEEKLY_SNAPSHOT table, which stores a weekly point-in-time
# copy of every onboarding record. For any month, the earliest snapshot within
# that month is the "start of month" projection. We compare that to the current
# live table (FACT_OB_IMPL_PS_IMPLEMENTATION) for the up-to-date projection and
# the realized actuals.
#
# Note: the snapshot table uses ONBOARDER_NAME_OB / OB_STATUS_OB, whereas the
# live table uses ONBOARDER_NAME_ACCNT / ONBOARDING_STATUS_OB.

FORECAST_EXCLUDED_STATUSES = ("Success", "Churn", "Opted Out", "Rejected")


def _load_forecast_baseline():
    if FORECAST_BASELINE_FILE.exists():
        try:
            return json.loads(FORECAST_BASELINE_FILE.read_text())
        except Exception:
            return {}
    return {}


def _save_forecast_baseline(d):
    try:
        FORECAST_BASELINE_FILE.write_text(json.dumps(d, indent=2, default=str))
    except Exception as e:
        print(f"Forecast baseline save error: {e}", file=sys.stderr)


def _month_bounds(month_key):
    """Return (month_start, month_end) date objects for a 'YYYY-MM' key."""
    year, month = int(month_key[:4]), int(month_key[5:7])
    month_start = date(year, month, 1)
    month_end = date(year + (1 if month == 12 else 0), (month % 12) + 1, 1)
    return month_start, month_end


def _forecast_counts(rows):
    """Normalize a go-live / transition count+CMRR row into a dict."""
    r = rows[0] if rows else {}
    g = lambda k: r.get(k) if r.get(k) is not None else 0
    return {
        "goLives": int(g("GL_CNT")),
        "goLiveCmrr": float(g("GL_CMRR")),
        "transitions": int(g("TR_CNT")),
        "transitionCmrr": float(g("TR_CMRR")),
    }


def build_forecast_compare(month_key):
    """Compare start-of-month projections (from the weekly snapshot) against the
    current live projections and the realized actuals for the given month.

    Returns startOfMonth, currentProjection, actuals, and the drift between the
    start-of-month and current projections.
    """
    month_start, month_end = _month_bounds(month_key)
    ms, me = str(month_start), str(month_end)
    ics = in_clause(get_ic_names())
    excl = ", ".join(f"'{s}'" for s in FORECAST_EXCLUDED_STATUSES)

    # The "start of month" snapshot = earliest weekly snapshot within the month.
    # The 1st is often not a snapshot date (snapshots are weekly), so we take the
    # first available snapshot on/after the 1st rather than an exact date match.
    snap_rows = run_query(f"""
        SELECT TO_VARCHAR(MIN(CALENDAR_DATE)) AS SNAP_DATE
        FROM FACT_OB_IMPL_WEEKLY_SNAPSHOT
        WHERE CALENDAR_DATE >= '{ms}' AND CALENDAR_DATE < '{me}'
    """)
    snapshot_date = snap_rows[0].get("SNAP_DATE") if snap_rows else None

    start_of_month = None
    if snapshot_date:
        som_rows = run_query(f"""
            SELECT
                COUNT(CASE WHEN PROJECTED_GO_LIVE_DATE_OB >= '{ms}'
                            AND PROJECTED_GO_LIVE_DATE_OB < '{me}' THEN 1 END) AS GL_CNT,
                COALESCE(SUM(CASE WHEN PROJECTED_GO_LIVE_DATE_OB >= '{ms}'
                            AND PROJECTED_GO_LIVE_DATE_OB < '{me}' THEN CMRR_OB END), 0) AS GL_CMRR,
                COUNT(CASE WHEN ANTICIPATED_SUCCESS_TRANSITION_DATE_OB >= '{ms}'
                            AND ANTICIPATED_SUCCESS_TRANSITION_DATE_OB < '{me}' THEN 1 END) AS TR_CNT,
                COALESCE(SUM(CASE WHEN ANTICIPATED_SUCCESS_TRANSITION_DATE_OB >= '{ms}'
                            AND ANTICIPATED_SUCCESS_TRANSITION_DATE_OB < '{me}' THEN CMRR_OB END), 0) AS TR_CMRR
            FROM FACT_OB_IMPL_WEEKLY_SNAPSHOT
            WHERE CALENDAR_DATE = '{snapshot_date}'
              AND ONBOARDER_NAME_OB IN ({ics})
              AND OB_STATUS_OB NOT IN ({excl})
        """)
        start_of_month = _forecast_counts(som_rows)

    # Freeze the start-of-month baseline the first time it's computed each month
    # (per team scope). The warehouse rewrites historical snapshot rows — row
    # counts for early-June snapshots swing day to day — so without freezing, the
    # "start of month" number drifts. Once frozen, it stays put. Delete
    # .data/forecast-baseline.json to recompute.
    scope = (get_manager().get("fullName") or "team").strip()
    bkey = f"{month_key}|{scope}"
    baseline = _load_forecast_baseline()
    if bkey in baseline:
        start_of_month = baseline[bkey].get("startOfMonth")
        snapshot_date = baseline[bkey].get("snapshotDate") or snapshot_date
    elif start_of_month:
        baseline[bkey] = {"startOfMonth": start_of_month, "snapshotDate": snapshot_date,
                          "frozenAt": datetime.now().isoformat()}
        _save_forecast_baseline(baseline)

    # Current projection from the live table.
    cur_rows = run_query(f"""
        SELECT
            COUNT(CASE WHEN PROJECTED_GO_LIVE_DATE_OB >= '{ms}'
                        AND PROJECTED_GO_LIVE_DATE_OB < '{me}' THEN 1 END) AS GL_CNT,
            COALESCE(SUM(CASE WHEN PROJECTED_GO_LIVE_DATE_OB >= '{ms}'
                        AND PROJECTED_GO_LIVE_DATE_OB < '{me}' THEN CMRR_OB END), 0) AS GL_CMRR,
            COUNT(CASE WHEN ANTICIPATED_SUCCESS_TRANSITION_DATE_OB >= '{ms}'
                        AND ANTICIPATED_SUCCESS_TRANSITION_DATE_OB < '{me}' THEN 1 END) AS TR_CNT,
            COALESCE(SUM(CASE WHEN ANTICIPATED_SUCCESS_TRANSITION_DATE_OB >= '{ms}'
                        AND ANTICIPATED_SUCCESS_TRANSITION_DATE_OB < '{me}' THEN CMRR_OB END), 0) AS TR_CMRR
        FROM FACT_OB_IMPL_PS_IMPLEMENTATION
        WHERE ONBOARDER_NAME_ACCNT IN ({ics})
          AND ONBOARDING_STATUS_OB NOT IN ({excl})
    """)
    current_projection = _forecast_counts(cur_rows)

    # Actuals from the live table (no status filter: an account that already went
    # live / transitioned should still count even if its status now reads Success).
    act_rows = run_query(f"""
        SELECT
            COUNT(CASE WHEN LIVE_DATE_OB >= '{ms}'
                        AND LIVE_DATE_OB < '{me}' THEN 1 END) AS GL_CNT,
            COALESCE(SUM(CASE WHEN LIVE_DATE_OB >= '{ms}'
                        AND LIVE_DATE_OB < '{me}' THEN CMRR_OB END), 0) AS GL_CMRR,
            COUNT(CASE WHEN SUCCESS_TRANSITION_CALL_DATE_OB >= '{ms}'
                        AND SUCCESS_TRANSITION_CALL_DATE_OB < '{me}' THEN 1 END) AS TR_CNT,
            COALESCE(SUM(CASE WHEN SUCCESS_TRANSITION_CALL_DATE_OB >= '{ms}'
                        AND SUCCESS_TRANSITION_CALL_DATE_OB < '{me}' THEN CMRR_OB END), 0) AS TR_CMRR
        FROM FACT_OB_IMPL_PS_IMPLEMENTATION
        WHERE ONBOARDER_NAME_ACCNT IN ({ics})
    """)
    actuals = _forecast_counts(act_rows)

    drift = None
    if start_of_month:
        drift = {
            "goLives": current_projection["goLives"] - start_of_month["goLives"],
            "goLiveCmrr": current_projection["goLiveCmrr"] - start_of_month["goLiveCmrr"],
            "transitions": current_projection["transitions"] - start_of_month["transitions"],
            "transitionCmrr": current_projection["transitionCmrr"] - start_of_month["transitionCmrr"],
        }

    return {
        "month": month_key,
        "snapshotDate": snapshot_date,
        "startOfMonth": start_of_month,
        "currentProjection": current_projection,
        "actuals": actuals,
        "drift": drift,
    }


@app.route("/api/forecast/compare")
def api_forecast_compare():
    """Start-of-month (snapshot) vs current projection vs actuals for a month."""
    try:
        month_key = request.args.get("month", date.today().strftime("%Y-%m"))
        return jsonify(build_forecast_compare(month_key))
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── API: Global to-do list ──────────────────────────────────────────────────

def load_todos():
    if TODOS_FILE.exists():
        return json.loads(TODOS_FILE.read_text())
    return []

def save_todos(data):
    TODOS_FILE.write_text(json.dumps(data, indent=2, default=str))

@app.route("/api/todos", methods=["GET"])
def api_todos_get():
    return jsonify(load_todos())

@app.route("/api/todos", methods=["POST"])
def api_todos_save():
    """Save the entire todo list."""
    data = request.get_json()
    if not isinstance(data, list):
        return jsonify({"error": "Expected a list"}), 400
    save_todos(data)
    return jsonify({"ok": True, "count": len(data)})

@app.route("/api/todos/add", methods=["POST"])
def api_todos_add():
    """Add a single todo item."""
    data = request.get_json()
    todos = load_todos()
    todo = {
        "id": data.get("id", f"todo_{len(todos)+1}_{int(datetime.now().timestamp())}"),
        "text": data.get("text", ""),
        "due": data.get("due"),
        "accountId": data.get("accountId"),
        "accountName": data.get("accountName"),
        "done": False,
        "createdAt": datetime.now().isoformat(),
    }
    todos.append(todo)
    save_todos(todos)
    return jsonify({"ok": True, "todo": todo})

@app.route("/api/todos/update", methods=["POST"])
def api_todos_update():
    """Update a todo item (toggle done, edit text, etc)."""
    data = request.get_json()
    todo_id = data.get("id")
    todos = load_todos()
    for t in todos:
        if t["id"] == todo_id:
            for k in ("text", "due", "done", "accountId", "accountName"):
                if k in data:
                    t[k] = data[k]
            break
    save_todos(todos)
    return jsonify({"ok": True})

@app.route("/api/todos/delete", methods=["POST"])
def api_todos_delete():
    """Delete a todo item."""
    data = request.get_json()
    todo_id = data.get("id")
    todos = load_todos()
    todos = [t for t in todos if t["id"] != todo_id]
    save_todos(todos)
    return jsonify({"ok": True})


# ── API: 1:1 talking points (per IC) ────────────────────────────────────────
# Notes/action items added from an account page that surface on that IC's 1:1
# Prep page. Stored locally as { "IC Name": [ {id, text, accountId, accountName,
# createdAt, done} ] }.

def load_oneonone():
    if ONEONONE_FILE.exists():
        try:
            return json.loads(ONEONONE_FILE.read_text())
        except Exception:
            return {}
    return {}

def save_oneonone(data):
    ONEONONE_FILE.write_text(json.dumps(data, indent=2, default=str))


@app.route("/api/oneonone-notes", methods=["GET"])
def api_oneonone_get():
    """Return talking points for one IC (?ic=) or all if no ic given."""
    notes = load_oneonone()
    ic = request.args.get("ic")
    if ic:
        return jsonify(notes.get(ic, []))
    return jsonify(notes)


@app.route("/api/oneonone-notes/add", methods=["POST"])
def api_oneonone_add():
    data = request.get_json(force=True) or {}
    ic = (data.get("ic") or "").strip()
    text = (data.get("text") or "").strip()
    if not ic or not text:
        return jsonify({"error": "ic and text are required"}), 400
    notes = load_oneonone()
    item = {
        "id": f"oo_{int(datetime.now().timestamp()*1000)}",
        "text": text,
        "accountId": data.get("accountId"),
        "accountName": data.get("accountName"),
        "createdAt": datetime.now().isoformat(),
        "done": False,
    }
    notes.setdefault(ic, []).append(item)
    save_oneonone(notes)
    return jsonify({"ok": True, "item": item})


@app.route("/api/oneonone-notes/update", methods=["POST"])
def api_oneonone_update():
    data = request.get_json(force=True) or {}
    ic, nid = data.get("ic"), data.get("id")
    notes = load_oneonone()
    for n in notes.get(ic, []):
        if n["id"] == nid:
            if "done" in data:
                n["done"] = bool(data["done"])
            if "text" in data:
                n["text"] = data["text"]
    save_oneonone(notes)
    return jsonify({"ok": True})


@app.route("/api/oneonone-notes/delete", methods=["POST"])
def api_oneonone_delete():
    data = request.get_json(force=True) or {}
    ic, nid = data.get("ic"), data.get("id")
    notes = load_oneonone()
    if ic in notes:
        notes[ic] = [n for n in notes[ic] if n["id"] != nid]
    save_oneonone(notes)
    return jsonify({"ok": True})


# ── API: Page feedback (seamless, delivered server-side) ────────────────────
# Managers click Feedback, type, hit Send. The backend delivers it and logs it
# locally. Delivery uses ONE shared Slack Incoming Webhook (get_feedback_webhook)
# so individual managers never need their own Slack bot/token. A per-manager bot
# token is only a fallback if no webhook is set.

def load_feedback():
    if FEEDBACK_FILE.exists():
        try:
            return json.loads(FEEDBACK_FILE.read_text())
        except Exception:
            return []
    return []


def get_feedback_webhook():
    """The shared Slack Incoming Webhook URL for feedback. ONE webhook the tool
    owner creates, shared by every manager — no per-person bot needed. Read from
    the FEEDBACK_WEBHOOK_URL env var or .data/feedback-webhook.txt."""
    f = DATA_DIR / "feedback-webhook.txt"
    if f.exists():
        u = f.read_text().strip()
        if u:
            return u
    return os.environ.get("FEEDBACK_WEBHOOK_URL", "").strip()


def get_feedback_sheet_url():
    """Google Sheets Apps Script webhook for feedback. Override with
    .data/feedback-sheet-url.txt or FEEDBACK_SHEET_URL env; defaults to the shared script."""
    f = DATA_DIR / "feedback-sheet-url.txt"
    if f.exists():
        u = f.read_text().strip()
        if u:
            return u
    return os.environ.get("FEEDBACK_SHEET_URL", "").strip() or FEEDBACK_SHEET_WEBHOOK


@app.route("/api/feedback", methods=["POST"])
def api_feedback():
    data = request.get_json(force=True) or {}
    text = (data.get("text") or "").strip()
    # The page/view the user was on is captured automatically by the frontend
    # (e.g. "home", "compliance", "accounts", "detail:Account Name").
    page = (data.get("page") or "unknown").strip()
    ftype = (data.get("type") or "General").strip()
    priority = (data.get("priority") or "Medium").strip()
    if not text:
        return jsonify({"error": "Feedback text is required"}), 400

    # Enrich with who/when/role server-side so the client can't spoof it.
    name = get_manager().get("fullName") or get_snowflake_user() or "A manager"
    role = get_role()
    payload = {
        "timestamp": datetime.now().isoformat(),
        "name": name,
        "role": role,
        "page": page,
        "type": ftype,
        "priority": priority,
        "feedback": text,
    }

    # Always log locally first — the audit trail / backstop so feedback is never lost.
    try:
        log = load_feedback()
        log.append(dict(payload, id=f"fb_{int(datetime.now().timestamp()*1000)}"))
        FEEDBACK_FILE.write_text(json.dumps(log, indent=2, default=str))
    except Exception as e:
        print(f"Feedback local save error: {e}", file=sys.stderr)

    delivered, err = False, None

    # Primary: post to the Slack channel via chat.postMessage (bot token), as a
    # Block Kit card (header, metadata grid, divider, description).
    token = get_slack_token()
    if token:
        blocks = [
            {"type": "header", "text": {"type": "plain_text", "text": "New Portal Feedback"}},
            {"type": "section", "fields": [
                {"type": "mrkdwn", "text": f"*From:*\n{name}"},
                {"type": "mrkdwn", "text": f"*Role:*\n{role}"},
                {"type": "mrkdwn", "text": f"*Page:*\n{page}"},
                {"type": "mrkdwn", "text": f"*Priority:*\n{priority}"},
            ]},
            {"type": "context", "elements": [{"type": "mrkdwn", "text": f"Type: {ftype}"}]},
            {"type": "divider"},
            {"type": "section", "text": {"type": "mrkdwn", "text": text or "_(no description)_"}},
        ]
        # Plain-text fallback for notifications / accessibility.
        fallback = f"New Portal Feedback from {name} ({role}) — {page} [{priority}/{ftype}]: {text}"
        try:
            resp = slack_api_post("chat.postMessage", token, {"channel": FEEDBACK_CHANNEL_ID, "text": fallback, "blocks": blocks})
            delivered = bool(resp.get("ok"))
            if not delivered:
                err = "slack_" + str(resp.get("error", "error"))
        except Exception as e:
            err = str(e)
            print(f"Feedback Slack error: {e}", file=sys.stderr)

    # Backup: the shared Google Sheet (Apps Script web app) — always attempted.
    try:
        r = http_requests.post(get_feedback_sheet_url(), json=payload, timeout=20)
        sheet_ok = (r.status_code == 200)
        if not delivered:
            delivered = sheet_ok
            if not sheet_ok and not err:
                err = f"sheet_{r.status_code}"
    except Exception as e:
        if not err:
            err = str(e)
        print(f"Feedback sheet error: {e}", file=sys.stderr)

    return jsonify({"ok": True, "delivered": delivered, "error": err})


# ── API: Lead IC personal account list (My Pipeline) ────────────────────────

@app.route("/api/my-accounts/search")
def api_my_accounts_search():
    """Search accounts by name (any status) so a lead IC can add them to their
    personal pipeline. Returns up to 20 deduped matches."""
    q = (request.args.get("q") or "").strip()
    if len(q) < 2:
        return jsonify([])

    # If the query is a Salesforce link or a raw record ID, resolve by ID instead
    # of by name. Handles .../Onboarding__c/<ID_OB>/view, .../Account/<id>/view, or
    # a pasted 15/18-char Salesforce ID. (SF IDs are alphanumeric — no injection.)
    sf_id = None
    m = re.search(r"/([a-zA-Z0-9]{15,18})(?:/|\?|$)", q)
    if m:
        sf_id = m.group(1)
    elif re.fullmatch(r"[a-zA-Z0-9]{15,18}", q):
        sf_id = q

    if sf_id:
        where = f"(ID_OB = '{sf_id}' OR ACCOUNT_ID_OB = '{sf_id}')"
    else:
        safe = q.replace("'", "''")
        where = f"NAME_ACCOUNT ILIKE '%{safe}%'"

    try:
        rows = run_query(f"""
            SELECT ACCOUNT_ID_OB, NAME_ACCOUNT, ONBOARDING_STATUS_OB,
                   ONBOARDER_NAME_ACCNT, ONBOARDING_HEALTH_SCORE_OB, CMRR_OB
            FROM FACT_OB_IMPL_PS_IMPLEMENTATION
            WHERE {where} AND ACCOUNT_ID_OB IS NOT NULL
            QUALIFY ROW_NUMBER() OVER (PARTITION BY ACCOUNT_ID_OB ORDER BY ONBOARDING_STATUS_OB NULLS LAST) = 1
            ORDER BY NAME_ACCOUNT
            LIMIT 20
        """)
        out = []
        for r in rows:
            hs_raw = r.get("ONBOARDING_HEALTH_SCORE_OB")
            hs = None
            if hs_raw not in (None, ""):
                try:
                    hs = int(str(hs_raw).strip()[0])
                except (ValueError, IndexError):
                    hs = None
            out.append({
                "id": r.get("ACCOUNT_ID_OB"),
                "name": r.get("NAME_ACCOUNT") or "",
                "status": r.get("ONBOARDING_STATUS_OB") or "",
                "ic": r.get("ONBOARDER_NAME_ACCNT") or "",
                "hs": hs,
                "cmrr": float(r.get("CMRR_OB") or 0),
            })
        return jsonify(out)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def _entry_id(e):
    return e if isinstance(e, str) else (e or {}).get("id")


@app.route("/api/my-accounts/add", methods=["POST"])
def api_my_accounts_add():
    data = request.get_json(force=True) or {}
    aid = (data.get("accountId") or "").strip()
    if not aid:
        return jsonify({"error": "accountId required"}), 400
    raw = load_my_accounts()
    if aid not in [_entry_id(e) for e in raw]:
        raw.append(aid)  # plain-string entry = active
        save_my_accounts(raw)
    return jsonify({"ok": True, "count": len(raw)})


@app.route("/api/my-accounts/remove", methods=["POST"])
def api_my_accounts_remove():
    data = request.get_json(force=True) or {}
    aid = (data.get("accountId") or "").strip()
    raw = [e for e in load_my_accounts() if _entry_id(e) != aid]
    save_my_accounts(raw)
    return jsonify({"ok": True, "count": len(raw)})


@app.route("/api/my-accounts/complete", methods=["POST"])
def api_my_accounts_complete():
    """Mark a lead pipeline account completed (or reactivate). Preserves the
    account (and its notes/tasks); just flips its status in my-accounts.json."""
    data = request.get_json(force=True) or {}
    aid = (data.get("accountId") or "").strip()
    completed = data.get("completed", True)
    if not aid:
        return jsonify({"error": "accountId required"}), 400
    raw, out = load_my_accounts(), []
    for e in raw:
        if _entry_id(e) == aid:
            out.append({"id": aid, "status": "completed" if completed else "active",
                        "completedAt": datetime.now().isoformat() if completed else None})
        else:
            out.append(e)
    save_my_accounts(out)
    return jsonify({"ok": True})


@app.route("/api/my-accounts/classify", methods=["POST"])
def api_my_accounts_classify():
    """Set a lead account's rescue/regular classification + lead-set milestone
    dates. Stored as per-account overlays (never written back to Salesforce)."""
    d = request.get_json(force=True) or {}
    aid = (d.get("accountId") or "").strip()
    if not aid:
        return jsonify({"error": "accountId required"}), 400
    overlays, ov = _overlay_for(aid)
    for f in ("rescue", "leadStage", "leadRescueStart", "leadGoLive", "leadTransition", "leadEndDate"):
        if f in d:
            ov[f] = d[f]
    save_overlays(overlays)
    return jsonify({"ok": True})


# ── API: Impersonation (super admins view as another role/user) ─────────────

@app.route("/api/impersonate", methods=["POST"])
def api_impersonate():
    global _impersonation
    if not is_super_admin():
        return jsonify({"error": "Not permitted"}), 403
    d = request.get_json(force=True) or {}
    role = d.get("role") or "manager"
    _impersonation = {"role": role, "name": d.get("name") or ("Lead IC" if role == "lead-ic" else "Manager")}
    return jsonify({"ok": True, "impersonating": _impersonation})


@app.route("/api/impersonate/stop", methods=["POST"])
def api_impersonate_stop():
    global _impersonation
    _impersonation = None
    return jsonify({"ok": True})


# ── Slack compliance messaging ──────────────────────────────────────────────
#
# Optional integration. The bot token lives in .data/slack-token.txt (gitignored,
# never committed). If that file is absent, every Slack feature degrades
# gracefully: /api/slack/status reports configured=false and the UI hides /
# disables the buttons. The user matching maps each IC's Snowflake name to a
# Slack user by real_name (case-insensitive); the result is cached in
# .data/slack-users.json so we don't hit Slack on every page load.

# Note on CSM-assignment messages: the recipient (whoever owns CSM assignment)
# varies per manager and is intentionally NOT hardcoded or configured. That
# message is copy-only — the manager pastes it into a DM to their own contact —
# so we don't resolve a Slack user or deep link for it.

# Shared Slack bot token, shipped via git so managers don't configure Slack
# individually. PASTE THE TOKEN BETWEEN THE QUOTES BELOW (it's the value in your
# .data/slack-token.txt). WARNING: committing this puts the token in git history
# permanently and exposes it to everyone with repo access; rotate it if leaked.
# Scopes used: users:read (resolve IC Slack IDs). Leave "" to keep Slack disabled.
SLACK_BOT_TOKEN = ""


def get_slack_token():
    """Return the Slack bot token. A local .data/slack-token.txt overrides the
    shipped SLACK_BOT_TOKEN constant (per-machine override); otherwise the
    constant is used. None if neither is set."""
    if SLACK_TOKEN_FILE.exists():
        tok = SLACK_TOKEN_FILE.read_text().strip()
        if tok:
            return tok
    return SLACK_BOT_TOKEN.strip() or None


def slack_enabled():
    return get_slack_token() is not None


def load_slack_users():
    """Return the cached Slack mapping: {teamId, refreshedAt, users:{...}}."""
    if SLACK_USERS_FILE.exists():
        try:
            return json.loads(SLACK_USERS_FILE.read_text())
        except Exception:
            return {}
    return {}


def save_slack_users(data):
    SLACK_USERS_FILE.write_text(json.dumps(data, indent=2, default=str))


def slack_api_get(method, token, params=None):
    """Call a Slack Web API method over GET and return the parsed JSON dict."""
    resp = http_requests.get(
        f"https://slack.com/api/{method}",
        headers={"Authorization": f"Bearer {token}"},
        params=params or {},
        timeout=30,
    )
    return resp.json()


def slack_api_post(method, token, payload):
    """Call a Slack Web API method over POST (JSON) and return the parsed dict."""
    resp = http_requests.post(
        f"https://slack.com/api/{method}",
        headers={"Authorization": f"Bearer {token}",
                 "Content-Type": "application/json; charset=utf-8"},
        json=payload,
        timeout=30,
    )
    return resp.json()


def _fmt_short_date(d):
    """Format a date/'YYYY-MM-DD' as 'May 15'. Empty string for None."""
    if not d:
        return ""
    if isinstance(d, datetime):
        d = d.date()
    elif isinstance(d, str):
        try:
            d = datetime.strptime(d[:10], "%Y-%m-%d").date()
        except ValueError:
            return d
    return d.strftime("%b %-d")


def _account_compliance_issues(row, today):
    """Return a list of human-readable compliance issue labels for one account.

    Mirrors the seven checks in the Compliance view. Assumes the row has already
    been filtered to Implementation / Live status.
    """
    def as_date(x):
        if isinstance(x, datetime):
            return x.date()
        return x  # date or None

    status = row.get("ONBOARDING_STATUS_OB")
    comments = (row.get("ONBOARDING_HEALTH_SCORE_COMMENTS_OB") or "").strip()

    hs_raw = row.get("ONBOARDING_HEALTH_SCORE_OB")
    hs = None
    if hs_raw not in (None, ""):
        try:
            hs = int(str(hs_raw).strip()[0])
        except (ValueError, IndexError):
            hs = None

    pgl = as_date(row.get("PROJECTED_GO_LIVE_DATE_OB"))
    ant = as_date(row.get("ANTICIPATED_SUCCESS_TRANSITION_DATE_OB"))
    hs_updated = as_date(row.get("LAST_UPDATED_HEALTH_SCORE_OB"))
    transitioned = row.get("SUCCESS_TRANSITION_CALL_DATE_OB") is not None

    monday = today - timedelta(days=today.weekday())
    friday = monday + timedelta(days=4)

    issues = []
    if hs is None:
        issues.append("missing health score")
    if hs is not None and not comments:
        issues.append("health score comments missing")
    if pgl and pgl < today and status != "Live":
        issues.append(f"PGL overdue, was {_fmt_short_date(pgl)}")
    if ant and ant < today and not transitioned:
        issues.append(f"transition overdue, was {_fmt_short_date(ant)}")
    if hs_updated and (today - hs_updated).days > 14:
        issues.append(f"health score not updated in {(today - hs_updated).days} days")
    if ant and pgl and ant < pgl:
        issues.append("transition date is before go-live")
    if ant and monday <= ant <= friday and status != "Live":
        issues.append("transitioning this week but not live")
    return issues


@app.route("/api/slack/status")
def api_slack_status():
    """Report whether Slack is configured, cached user count, last refresh time."""
    su = load_slack_users()
    return jsonify({
        "configured": slack_enabled(),
        "userCount": len(su.get("users") or {}),
        "teamId": su.get("teamId"),
        "refreshedAt": su.get("refreshedAt"),
    })


@app.route("/api/slack/refresh-users")
def api_slack_refresh_users():
    """Fetch all workspace users (paginated) and match each IC to a Slack user."""
    token = get_slack_token()
    if not token:
        return jsonify({"ok": False, "configured": False,
                        "error": "Slack not configured"}), 400
    try:
        members = []
        cursor = None
        team_id = None
        while True:
            params = {"limit": 200}
            if cursor:
                params["cursor"] = cursor
            data = slack_api_get("users.list", token, params)
            if not data.get("ok"):
                return jsonify({"ok": False, "error": data.get("error", "slack_error")}), 502
            members.extend(data.get("members", []))
            cursor = (data.get("response_metadata") or {}).get("next_cursor") or ""
            if not cursor:
                break

        # Slack team ID: present on each member; fall back to auth.test.
        for m in members:
            if m.get("team_id"):
                team_id = m["team_id"]
                break
        if not team_id:
            try:
                auth = slack_api_get("auth.test", token)
                if auth.get("ok"):
                    team_id = auth.get("team_id")
            except Exception:
                pass

        # Index active members by real_name (case-insensitive).
        by_realname = {}
        for m in members:
            if m.get("deleted") or m.get("is_bot") or m.get("id") == "USLACKBOT":
                continue
            prof = m.get("profile", {}) or {}
            rn = (m.get("real_name") or prof.get("real_name") or "").strip().lower()
            if rn:
                by_realname.setdefault(rn, m)

        mapping = {}
        unmatched = []
        # Match each IC to a Slack user (for the per-IC "Message on Slack" DM link).
        names_to_match = [ic["name"] for ic in get_team()]
        for name in names_to_match:
            m = by_realname.get(name.strip().lower())
            if m:
                prof = m.get("profile", {}) or {}
                mapping[name] = {
                    "slackId": m.get("id"),
                    "email": prof.get("email"),
                    "displayName": prof.get("display_name") or prof.get("real_name"),
                    "realName": m.get("real_name") or prof.get("real_name"),
                }
            else:
                unmatched.append(name)

        out = {
            "teamId": team_id,
            "refreshedAt": datetime.now().isoformat(),
            "users": mapping,
        }
        save_slack_users(out)
        return jsonify({
            "ok": True,
            "teamId": team_id,
            "matched": len(mapping),
            "unmatched": unmatched,
            "totalTeam": len(get_team()),
            "totalSlackUsers": len(members),
            "refreshedAt": out["refreshedAt"],
        })
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/api/slack/compliance-message", methods=["POST"])
def api_slack_compliance_message():
    """Build a friendly compliance nudge for one IC and a Slack DM deep link.

    Only considers accounts in Implementation / Live status.
    """
    try:
        data = request.get_json(force=True) or {}
        ic_name = data.get("icName") or data.get("name")
        if not ic_name:
            return jsonify({"error": "icName required"}), 400

        today = date.today()
        rows = run_query(f"""
            SELECT
                ID_OB,
                NAME_ACCOUNT,
                ONBOARDING_STATUS_OB,
                ONBOARDING_HEALTH_SCORE_OB,
                ONBOARDING_HEALTH_SCORE_COMMENTS_OB,
                LAST_UPDATED_HEALTH_SCORE_OB,
                PROJECTED_GO_LIVE_DATE_OB,
                ANTICIPATED_SUCCESS_TRANSITION_DATE_OB,
                LIVE_DATE_OB,
                SUCCESS_TRANSITION_CALL_DATE_OB
            FROM FACT_OB_IMPL_PS_IMPLEMENTATION
            WHERE ONBOARDER_NAME_ACCNT = '{ic_name.replace("'", "''")}'
              AND ONBOARDING_STATUS_OB IN ('Implementation', 'Live')
            ORDER BY NAME_ACCOUNT
        """)

        flagged = []
        total_issues = 0
        for r in rows:
            issues = _account_compliance_issues(r, today)
            if issues:
                flagged.append((r.get("NAME_ACCOUNT") or "Unknown account",
                                r.get("ID_OB"), issues))
                total_issues += len(issues)

        first = ic_name.split(" ")[0]
        if not flagged:
            message = (f"Hey {first}, all your active accounts look compliant right now. "
                       "Nice work, nothing to clean up!")
        else:
            lines = []
            for name, id_ob, issues in flagged:
                label = ", ".join(issues)
                line = f"{name} - {label}"
                if id_ob:
                    link = f"https://servicetitan.lightning.force.com/lightning/r/Onboarding__c/{id_ob}/view"
                    line += f" ({link})"
                lines.append(line)
            message = (
                f"Hey {first}, heads up on a few accounts that need updating by end of day:\n\n"
                + "\n".join(lines)
                + "\n\nCan you get these cleaned up? Thanks!"
            )

        su = load_slack_users()
        team_id = su.get("teamId")
        user = (su.get("users") or {}).get(ic_name)
        deep_link = None
        if team_id and user and user.get("slackId"):
            deep_link = f"slack://user?team={team_id}&id={user['slackId']}"

        return jsonify({
            "message": message,
            "slackDeepLink": deep_link,
            "icName": ic_name,
            "issueCount": total_issues,
            "accountCount": len(flagged),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def _fmt_duration_hours(hours):
    """Format an hours count as a friendly age: '26 hours' or '3 days'."""
    if hours is None:
        return ""
    hours = int(hours)
    if hours < 48:
        return f"{hours} hour{'s' if hours != 1 else ''}"
    days = hours // 24
    return f"{days} day{'s' if days != 1 else ''}"


@app.route("/api/slack/csm-assignment-message", methods=["POST"])
def api_slack_csm_assignment_message():
    """Build a copy-only message listing accounts stuck in 'Needs CSM' for >24h
    with no Success Rep assigned. The recipient (whoever owns CSM assignment)
    varies per manager and is NOT hardcoded — this returns no deep link; the
    manager pastes it into a DM to their own contact.
    """
    try:
        ics = in_clause(get_ic_names())
        rows = run_query(f"""
            SELECT
                o.ID_OB,
                o.NAME_ACCOUNT,
                o.ONBOARDER_NAME_ACCNT,
                DATEDIFF('hour', o.LAST_SUCCESS_TRANSITION_STATUS_UPDATED_OB, CURRENT_TIMESTAMP()) AS HRS
            FROM FACT_OB_IMPL_PS_IMPLEMENTATION o
            LEFT JOIN VW_CUSTOMER_HEALTH_CURRENT h ON o.ACCOUNT_ID_OB = h.ACCOUNT_ID
            WHERE o.ONBOARDER_NAME_ACCNT IN ({ics})
              AND o.SUCCESS_TRANSITION_STATUS_OB = 'Needs CSM'
              AND o.ONBOARDING_STATUS_OB IN ('Implementation', 'Live')
              AND COALESCE(h.SUCCESS_REP_NAME, '') = ''
              AND o.LAST_SUCCESS_TRANSITION_STATUS_UPDATED_OB < DATEADD('hour', -24, CURRENT_TIMESTAMP())
            ORDER BY HRS DESC
        """)

        if not rows:
            message = "No accounts are stuck in Needs CSM right now."
        else:
            lines = []
            for r in rows:
                name = r.get("NAME_ACCOUNT") or "Unknown account"
                ic = r.get("ONBOARDER_NAME_ACCNT") or ""
                age = _fmt_duration_hours(r.get("HRS"))
                id_ob = r.get("ID_OB")
                line = f"{name} - in Needs CSM {age}" + (f", {ic}'s account" if ic else "")
                if id_ob:
                    line += f" (https://servicetitan.lightning.force.com/lightning/r/Onboarding__c/{id_ob}/view)"
                lines.append(line)
            message = (
                "Hi, these accounts have been in Needs CSM for over 24 hours with no Success Rep assigned. "
                "Can a CSM be assigned?\n\n"
                + "\n".join(lines)
                + "\n\nThanks!"
            )

        # Copy-only: no recipient, no deep link (the contact varies per manager).
        return jsonify({
            "message": message,
            "slackDeepLink": None,
            "accountCount": len(rows),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.after_request
def add_cors_headers(response):
    """Allow cross-origin requests from the portal domain (for bookmarklet sync)."""
    origin = request.headers.get("Origin", "")
    if "custom-wizards" in origin or "localhost" in origin or "127.0.0.1" in origin:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response

# ── API: Refresh status ─────────────────────────────────────────────────────

def pcache_synced_at():
    """Return the portal cache's syncedAt timestamp, or None if unavailable."""
    if PORTAL_CACHE_FILE.exists():
        try:
            cache = json.loads(PORTAL_CACHE_FILE.read_text())
            return cache.get("syncedAt")
        except Exception:
            pass
    return None


def _reset_identity_caches():
    """Clear the per-process identity/team/role metadata caches. Account data is
    queried fresh on every /api/data call and is never cached; but team/role/email
    detection is memoized for the process, so a roster or role change in Snowflake
    wouldn't appear until restart. Clearing here lets the Refresh button pick it up."""
    global _detection, _detected_role, _detected_senior_name, _senior_team_cache, _real_senior_cache, _ic_email_cache
    _detection = None
    _detected_role = None
    _detected_senior_name = ""
    _senior_team_cache = {}
    _real_senior_cache = None
    _ic_email_cache = None


@app.route("/api/refresh", methods=["GET", "POST"])
def api_refresh():
    """GET: confirm data sourcing. POST (from the Refresh button): also clear the
    per-process identity/team caches so a roster/role change reflects without a
    server restart. (Snowflake account data is already live-queried every call.)"""
    if request.method == "POST":
        _reset_identity_caches()
    return jsonify({
        "ok": True,
        "snowflakeLiveQueried": True,
        "message": "Snowflake is live-queried on every page load.",
        "cachesCleared": request.method == "POST",
        "portalSyncedAt": pcache_synced_at(),
    })


# ── API: Portal sync (bookmarklet-based) ────────────────────────────────────

@app.route("/connect-portal")
def connect_portal_page():
    return send_from_directory(".", "connect-portal.html")

@app.route("/api/portal-sync/accounts")
def api_portal_sync_accounts():
    """Salesforce IDs the bookmarklet should fetch. Always includes the
    manually-added accounts in my-accounts.json — lead ICs have no team roster,
    so that personal list is their only source. Managers/seniors additionally get
    their roster's active accounts. The my-accounts list is kept even if the
    roster query fails, so a lead's sync never returns empty on a query error."""
    ids = set(my_account_ids())  # manually-added accounts (lead IC personal list)
    if get_role() != "lead-ic":
        try:
            names = get_ic_names()
            if names:
                rows = run_query(f"""
                    SELECT ACCOUNT_ID_OB
                    FROM FACT_OB_IMPL_PS_IMPLEMENTATION
                    WHERE ONBOARDER_NAME_ACCNT IN ({in_clause(names)})
                    AND ONBOARDING_STATUS_OB IN ({in_clause(ACTIVE_STATUSES)})
                    AND ACCOUNT_ID_OB IS NOT NULL
                """)
                ids.update(r["ACCOUNT_ID_OB"] for r in rows if r.get("ACCOUNT_ID_OB"))
        except Exception as e:
            print(f"portal-sync roster query error: {e}", file=sys.stderr)
            if not ids:
                return jsonify({"ids": [], "error": str(e)}), 500
    out = sorted(i for i in ids if i)
    return jsonify({"ids": out, "count": len(out)})

@app.route("/api/portal-sync/receive", methods=["POST", "OPTIONS"])
def api_portal_sync_receive():
    """Receive portal data from the bookmarklet and cache it."""
    if request.method == "OPTIONS":
        return "", 204
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data received"}), 400
    PORTAL_CACHE_FILE.write_text(json.dumps(data, default=str))
    detail_count = len(data.get("details", {}))
    return jsonify({"ok": True, "detailCount": detail_count, "syncedAt": data.get("syncedAt")})

@app.route("/api/portal-sync/status")
def api_portal_sync_status():
    """Check if we have cached portal data."""
    if PORTAL_CACHE_FILE.exists():
        try:
            cache = json.loads(PORTAL_CACHE_FILE.read_text())
            return jsonify({
                "hasCachedData": True,
                "syncedAt": cache.get("syncedAt"),
                "accountCount": len(cache.get("details", {})),
            })
        except:
            pass
    return jsonify({"hasCachedData": False})


# ── API: Senior-manager per-manager aggregates ──────────────────────────────
@app.route("/api/manager-stats")
def api_manager_stats():
    """Per-manager rollups for the senior-manager view, plus aggregate totals.
    Auto-scoped to the senior manager for the current view (honors impersonation)."""
    if get_role() != "senior-manager":
        return jsonify({"error": "not_senior_manager", "managers": [], "totals": {}}), 200
    sname = get_senior_name()
    today = date.today()
    mstart = today.replace(day=1).isoformat()
    try:
        active = run_query(f"""
            SELECT ONBOARDER_MANAGER_ACCNT AS MGR, ONBOARDER_NAME_ACCNT AS IC, ONBOARDING_STATUS_OB AS STATUS,
                   ONBOARDING_HEALTH_SCORE_OB AS HS, ONBOARDING_HEALTH_SCORE_COMMENTS_OB AS COMMENTS,
                   LAST_UPDATED_HEALTH_SCORE_OB AS HS_UPD, PROJECTED_GO_LIVE_DATE_OB AS PGL,
                   ANTICIPATED_SUCCESS_TRANSITION_DATE_OB AS ANT
            FROM FACT_OB_IMPL_PS_IMPLEMENTATION
            WHERE (SENIOR_OB_MANAGER_NAME = '{_sql_str(sname)}' OR ONBOARDER_MANAGER_ACCNT = '{_sql_str(sname)}')
              AND ONBOARDING_STATUS_OB IN ({in_clause(ACTIVE_STATUSES)})
            QUALIFY ROW_NUMBER() OVER (PARTITION BY ACCOUNT_ID_OB ORDER BY ONBOARDING_STATUS_OB NULLS LAST) = 1
        """)
        flows = run_query(f"""
            SELECT MGR,
                   COUNT(CASE WHEN LIVE_DATE_OB >= '{mstart}' THEN 1 END) AS ACT_LOGOS,
                   COALESCE(SUM(CASE WHEN LIVE_DATE_OB >= '{mstart}' THEN CMRR_OB END), 0) AS ACT_DOLLARS,
                   COUNT(CASE WHEN STC >= '{mstart}' THEN 1 END) AS TR_LOGOS,
                   COALESCE(SUM(CASE WHEN STC >= '{mstart}' THEN CMRR_OB END), 0) AS TR_DOLLARS,
                   AVG(CASE WHEN STC >= DATEADD('MONTH', -6, CURRENT_DATE()) THEN DATEDIFF('DAY', IMPL, STC) END) AS AVG_CT
            FROM (
                SELECT ACCOUNT_ID_OB, ONBOARDER_MANAGER_ACCNT AS MGR, LIVE_DATE_OB, CMRR_OB,
                       SUCCESS_TRANSITION_CALL_DATE_OB AS STC, IMPLEMENTATION_START_DATE_OB AS IMPL
                FROM FACT_OB_IMPL_PS_IMPLEMENTATION
                WHERE (SENIOR_OB_MANAGER_NAME = '{_sql_str(sname)}' OR ONBOARDER_MANAGER_ACCNT = '{_sql_str(sname)}')
                QUALIFY ROW_NUMBER() OVER (PARTITION BY ACCOUNT_ID_OB ORDER BY ONBOARDING_STATUS_OB NULLS LAST) = 1
            ) GROUP BY MGR
        """)
    except Exception as e:
        return jsonify({"error": f"query failed: {e}", "managers": [], "totals": {}}), 500

    flow_by_mgr = {r["MGR"]: r for r in flows}
    ex = _excluded_ics()  # hidden ICs (departed) drop out of the rollups
    mgrs = {}
    for r in active:
        if (r.get("IC") or "").strip().lower() in ex:
            continue
        mgr = r.get("MGR") or "(unassigned)"
        m = mgrs.setdefault(mgr, {"manager": mgr, "ics": set(), "active": 0, "byStatus": {},
                                  "compliance": 0, "escalationRisk": 0})
        m["ics"].add(r.get("IC") or "")
        m["active"] += 1
        st = r.get("STATUS") or "Unknown"
        m["byStatus"][st] = m["byStatus"].get(st, 0) + 1
        hs = _parse_hs(r.get("HS"))
        comments = (r.get("COMMENTS") or "").strip()
        hs_upd = _as_date(r.get("HS_UPD"))
        pgl = _as_date(r.get("PGL"))
        ant = _as_date(r.get("ANT"))
        issues = 0
        if hs is None and st != "Pre-Implementation": issues += 1
        if hs is not None and not comments: issues += 1
        if hs_upd and (today - hs_upd).days > 14: issues += 1
        if pgl and pgl < today and st not in ("Live", "Hold"): issues += 1
        if ant and ant < today and st != "Hold": issues += 1
        m["compliance"] += issues
        if hs is not None and hs <= 3:
            m["escalationRisk"] += 1

    out, totals = [], {"managers": 0, "ics": 0, "active": 0, "compliance": 0, "escalationRisk": 0,
                       "actLogos": 0, "actDollars": 0, "trLogos": 0, "trDollars": 0}
    for mgr, m in sorted(mgrs.items(), key=lambda kv: -kv[1]["active"]):
        f = flow_by_mgr.get(mgr, {})
        row = {
            "manager": mgr,
            "icCount": len([x for x in m["ics"] if x]),
            "active": m["active"],
            "byStatus": m["byStatus"],
            "implementation": m["byStatus"].get("Implementation", 0),
            "live": m["byStatus"].get("Live", 0),
            "preImpl": m["byStatus"].get("Pre-Implementation", 0),
            "compliance": m["compliance"],
            "escalationRisk": m["escalationRisk"],
            "actLogos": int(f.get("ACT_LOGOS") or 0),
            "actDollars": float(f.get("ACT_DOLLARS") or 0),
            "trLogos": int(f.get("TR_LOGOS") or 0),
            "trDollars": float(f.get("TR_DOLLARS") or 0),
            "avgCycleTime": round(float(f["AVG_CT"]) / 7, 1) if f.get("AVG_CT") not in (None, "") else None,
        }
        out.append(row)
        totals["managers"] += 1
        totals["ics"] += row["icCount"]
        totals["active"] += row["active"]
        totals["compliance"] += row["compliance"]
        totals["escalationRisk"] += row["escalationRisk"]
        totals["actLogos"] += row["actLogos"]
        totals["actDollars"] += row["actDollars"]
        totals["trLogos"] += row["trLogos"]
        totals["trDollars"] += row["trDollars"]
    return jsonify({"senior": sname, "managers": out, "totals": totals})


# ── Senior roster management (hide departed ICs) ─────────────────────────────
# A senior's roster is auto-discovered from Snowflake, so there's no add/remove.
# Instead she can HIDE an IC who has left: they (and their lingering accounts)
# drop out of every senior view. Hidden names persist in config.excludedICs and
# can be restored. The full (unfiltered) roster is returned here so the Settings
# UI can list everyone, including those already hidden.
@app.route("/api/senior/roster")
def api_senior_roster():
    if get_role() != "senior-manager":
        return jsonify({"error": "not_senior_manager", "ics": [], "excluded": []}), 200
    full = get_senior_team(get_senior_name())  # unfiltered; get_team() applies exclusions
    ics = [{"name": ic.get("name"), "manager": ic.get("manager") or ""} for ic in full if ic.get("name")]
    return jsonify({"ics": ics, "excluded": list(load_config().get("excludedICs") or [])})


@app.route("/api/senior/roster/hide", methods=["POST"])
def api_senior_roster_hide():
    name = ((request.get_json(force=True) or {}).get("name") or "").strip()
    if not name:
        return jsonify({"error": "name required"}), 400
    cfg = load_config()
    ex = list(cfg.get("excludedICs") or [])
    if not any((n or "").strip().lower() == name.lower() for n in ex):
        ex.append(name)
    cfg["excludedICs"] = ex
    save_config(cfg)
    return jsonify({"ok": True, "excluded": ex})


@app.route("/api/senior/roster/restore", methods=["POST"])
def api_senior_roster_restore():
    name = ((request.get_json(force=True) or {}).get("name") or "").strip()
    cfg = load_config()
    cfg["excludedICs"] = [n for n in (cfg.get("excludedICs") or []) if (n or "").strip().lower() != name.lower()]
    save_config(cfg)
    return jsonify({"ok": True, "excluded": cfg["excludedICs"]})


# ════════════════════════════════════════════════════════════════════════════
# Google Calendar integration
# ════════════════════════════════════════════════════════════════════════════
# Read-only calendar access via OAuth. Tokens live in .data/google-token.json
# (gitignored, per-machine). IC emails come from Snowflake ONBOARDER_EMAIL_ACCNT
# — never guessed from names. Everything degrades gracefully when the libs aren't
# installed, the OAuth client isn't configured, or no token has been granted yet.

ST_DOMAIN = "@servicetitan.com"
# Distinctive-word matching: drop legal suffixes and generic trade words so a
# "Plumbing" event doesn't match every plumbing customer.
# Legal/structural suffixes stripped from the END of an account name before
# matching. Articles stripped from the FRONT as a fallback variant.
_NAME_SUFFIXES = {
    "llc", "inc", "corp", "co", "ltd", "company", "companies", "incorporated",
    "corporation", "limited", "contractors", "contracting", "services", "service",
    "enterprises", "enterprise", "group", "holdings", "holding",
}
_NAME_ARTICLES = {"the", "a", "an"}


def _google_oauth_creds():
    """(client_id, client_secret): from .data/google-oauth.json (gitignored,
    preferred) or the constants. Keeping them out of server.py means the secret
    never lands in a tracked file."""
    cid, csec = GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
    # .data override wins, then the tracked file shipped with the app.
    for path in (GOOGLE_OAUTH_FILE, GOOGLE_OAUTH_SHARED_FILE):
        if not path.exists():
            continue
        try:
            d = json.loads(path.read_text())
            # Google client-secret files nest under "installed" (desktop) or "web".
            if isinstance(d.get("installed"), dict):
                d = d["installed"]
            elif isinstance(d.get("web"), dict):
                d = d["web"]
            # tolerate key-name casing variants (client_id / CLIENT_ID / clientId)
            low = {str(k).lower().replace("-", "_"): v for k, v in d.items()}
            fcid = (low.get("client_id") or low.get("clientid") or "").strip()
            fcsec = (low.get("client_secret") or low.get("clientsecret") or "").strip()
            if fcid and fcsec:
                return fcid, fcsec
        except Exception as e:
            print(f"{path.name} parse error: {e}", file=sys.stderr)
    return cid, csec


def _google_configured():
    cid, csec = _google_oauth_creds()
    return bool(GOOGLE_LIBS and cid and csec)


def _google_client_config():
    cid, csec = _google_oauth_creds()
    return {"web": {
        "client_id": cid,
        "client_secret": csec,
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
        "redirect_uris": [GOOGLE_REDIRECT_URI],
    }}


def _save_google_creds(creds):
    GOOGLE_TOKEN_FILE.write_text(json.dumps({
        "token": creds.token,
        "refresh_token": creds.refresh_token,
        "token_uri": creds.token_uri,
        "client_id": creds.client_id,
        "client_secret": creds.client_secret,
        "scopes": list(creds.scopes or GOOGLE_SCOPES),
        "expiry": creds.expiry.isoformat() if creds.expiry else None,
    }, indent=2))


def _google_credentials():
    """Valid Google OAuth credentials (shared by Calendar + Sheets), refreshing
    the token if needed. Returns None if libs are missing, no token exists, or
    refresh fails. The single grant covers every scope in GOOGLE_SCOPES."""
    if not GOOGLE_LIBS or not GOOGLE_TOKEN_FILE.exists():
        return None
    try:
        data = json.loads(GOOGLE_TOKEN_FILE.read_text())
    except Exception:
        return None
    _cid, _csec = _google_oauth_creds()
    creds = GoogleCredentials(
        token=data.get("token"),
        refresh_token=data.get("refresh_token"),
        token_uri=data.get("token_uri", "https://oauth2.googleapis.com/token"),
        client_id=data.get("client_id") or _cid,
        client_secret=data.get("client_secret") or _csec,
        scopes=data.get("scopes") or GOOGLE_SCOPES,
    )
    if not creds.valid:
        if creds.expired and creds.refresh_token:
            try:
                creds.refresh(GoogleAuthRequest())
                _save_google_creds(creds)
            except Exception as e:
                print(f"Google token refresh failed: {e}", file=sys.stderr)
                return None
        else:
            return None
    return creds


def get_calendar_service():
    """Authenticated Calendar API service. Returns None if not connected."""
    creds = _google_credentials()
    if creds is None:
        return None
    try:
        return gcal_build("calendar", "v3", credentials=creds, cache_discovery=False)
    except Exception as e:
        print(f"Calendar service build failed: {e}", file=sys.stderr)
        return None


def get_sheets_service():
    """Authenticated Sheets API service (for the shared task system). Returns
    None if not connected or the token lacks the spreadsheets scope."""
    creds = _google_credentials()
    if creds is None:
        return None
    try:
        return gcal_build("sheets", "v4", credentials=creds, cache_discovery=False)
    except Exception as e:
        print(f"Sheets service build failed: {e}", file=sys.stderr)
        return None


def get_gmail_service():
    """Authenticated Gmail API service (read-only, for account email context).
    Returns None if not connected or the token lacks the gmail.readonly scope."""
    creds = _google_credentials()
    if creds is None:
        return None
    try:
        return gcal_build("gmail", "v1", credentials=creds, cache_discovery=False)
    except Exception as e:
        print(f"Gmail service build failed: {e}", file=sys.stderr)
        return None


# ── IC email lookup (Snowflake ONBOARDER_EMAIL_ACCNT, cached) ────────────────
_ic_email_cache = None


def get_ic_emails():
    """Map IC full name -> email from Snowflake. Cached in memory and persisted
    to config.json (icEmails). Emails are looked up by name, never guessed."""
    global _ic_email_cache
    names = get_ic_names()
    if _ic_email_cache is None:
        cfg = load_config()
        cached = dict(cfg.get("icEmails") or {})
        missing = [n for n in names if not cached.get(n)]
        if missing:
            try:
                rows = run_query(f"""
                    SELECT ONBOARDER_NAME_ACCNT AS NM, ONBOARDER_EMAIL_ACCNT AS EM, COUNT(*) AS N
                    FROM FACT_OB_IMPL_PS_IMPLEMENTATION
                    WHERE ONBOARDER_NAME_ACCNT IN ({in_clause(missing)})
                      AND ONBOARDER_EMAIL_ACCNT IS NOT NULL
                    GROUP BY 1, 2 ORDER BY N DESC
                """)
                for r in rows:
                    nm, em = r.get("NM"), r.get("EM")
                    if nm and em and not cached.get(nm):
                        cached[nm] = em
                cfg["icEmails"] = cached
                save_config(cfg)
            except Exception as e:
                print(f"IC email lookup failed: {e}", file=sys.stderr)
        _ic_email_cache = cached
    return {n: _ic_email_cache.get(n) for n in names if _ic_email_cache.get(n)}


# ── Event shaping + matching ─────────────────────────────────────────────────
def _rfc3339(d, end=False):
    s = str(d).strip()
    if "T" in s:
        return s if (s.endswith("Z") or "+" in s[10:] or "-" in s[11:]) else s + "Z"
    return s + ("T23:59:59Z" if end else "T00:00:00Z")


def _as_date(x):
    """Snowflake date/datetime/string/None -> date or None."""
    if x is None:
        return None
    if isinstance(x, datetime):
        return x.date()
    if isinstance(x, date):
        return x
    try:
        return datetime.fromisoformat(str(x)[:19].replace("Z", "")).date()
    except Exception:
        return None


def _event_dt(e):
    """Parse an event's start dateTime into an aware datetime, or None."""
    s = e.get("start") if isinstance(e, dict) else None
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=datetime.now().astimezone().tzinfo)
    return dt


def _shape_event(e):
    if e.get("status") == "cancelled":
        return None
    start = e.get("start", {}) or {}
    end = e.get("end", {}) or {}
    if "dateTime" not in start:   # all-day events have only "date"
        return None
    attendees = [{"email": a.get("email"), "responseStatus": a.get("responseStatus")}
                 for a in (e.get("attendees") or []) if a.get("email")]
    is_customer = any(ST_DOMAIN not in (a["email"] or "").lower() for a in attendees)
    return {
        "id": e.get("id"),
        "summary": e.get("summary") or "(no title)",
        "start": start.get("dateTime"),
        "end": end.get("dateTime"),
        "attendees": attendees,
        "isCustomerCall": is_customer,
    }


def _fetch_events(svc, calendar_id, start, end):
    """Shaped, non-all-day, non-cancelled events in [start, end].
    Returns None on access error (vs [] for no events).

    Paginates: a single 250-event page is NOT enough on dense calendars (daily
    recurring blocks, office hours, etc.). With orderBy=startTime a single page
    returns only the EARLIEST events in the window, which silently truncates the
    later (upcoming) events — so a real "next call" can be cut off. Follow
    nextPageToken so the whole window is covered (capped to avoid runaway)."""
    out = []
    page_token = None
    try:
        for _ in range(8):  # up to 8 pages (2000 events) — ample for any window
            resp = svc.events().list(
                calendarId=calendar_id,
                timeMin=_rfc3339(start), timeMax=_rfc3339(end, end=True),
                singleEvents=True, orderBy="startTime", maxResults=250,
                pageToken=page_token,
            ).execute()
            for ev in resp.get("items", []):
                shaped = _shape_event(ev)
                if shaped:
                    out.append(shaped)
            page_token = resp.get("nextPageToken")
            if not page_token:
                break
    except Exception as e:
        print(f"Calendar list failed for {calendar_id}: {e}", file=sys.stderr)
        return None
    return out


def _norm(s):
    """Lowercase, strip punctuation, collapse whitespace."""
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", (s or "").lower())).strip()


def _name_candidates(name):
    """Ordered (longest first) phrase candidates for matching an account name.
    Requires a CONTINUOUS phrase, not a single generic word — so "Aqua Pro" only
    matches "Aqua Pro", never just "Pro". Strips trailing legal suffixes, then
    yields progressively shorter prefixes down to a 2-word core (1-word if the
    name is a single word), also trying a leading-article-stripped variant, and
    treats "X DBA Y" as two names. Returns deduped phrases, longest first."""
    cands, seen = [], set()
    for seg in re.split(r"\bdba\b", _norm(name)):
        words = [w for w in seg.split() if w]
        while words and words[-1] in _NAME_SUFFIXES:
            words.pop()
        if not words:
            continue
        starts = [0]
        if words[0] in _NAME_ARTICLES and len(words) > 1:
            starts.append(1)
        for start in starts:
            ws = words[start:]
            minlen = 1 if len(ws) == 1 else 2
            for L in range(len(ws), minlen - 1, -1):
                phrase = " ".join(ws[:L])
                if len(phrase) >= 3 and phrase not in seen:
                    seen.add(phrase)
                    cands.append(phrase)
            # Also add the first word alone if it's specific enough (6+ chars)
            # so "Deltron Electric" matches on "Deltron" and "Acme Plumbing" on "Acme"
            # but short/generic openers like "Air" or "Pro" are excluded.
            if len(ws) >= 2 and len(ws[0]) >= 6 and ws[0] not in seen:
                seen.add(ws[0])
                cands.append(ws[0])
    cands.sort(key=lambda p: -len(p))   # most specific first; callers stop at first match
    return cands


def _name_in_title(name, title):
    """True if any candidate phrase appears as whole words in the title.
    Uses word-boundary matching so 'robert' does not match 'roberto'."""
    t = _norm(title)
    return any(re.search(r"\b" + re.escape(c) + r"\b", t) for c in _name_candidates(name))


def _attendee_company_match(name, attendees):
    """Secondary signal: a candidate phrase (spaces removed) appears in a
    non-ServiceTitan attendee's email domain. e.g. 'ac guys' -> 'acguys' matches
    'theacguyscontractors.com'."""
    cands = [c.replace(" ", "") for c in _name_candidates(name) if len(c.replace(" ", "")) >= 5]
    for a in (attendees or []):
        em = (a.get("email") or "").lower()
        if not em or ST_DOMAIN in em:
            continue
        domain = re.sub(r"[^a-z0-9]", "", em.split("@")[-1])
        if any(c in domain for c in cands):
            return True
    return False


def _title_has(events, *keywords):
    kws = [k.lower() for k in keywords]
    return [e for e in events if any(k in (e["summary"] or "").lower() for k in kws)]


# ── Calendar API endpoints ───────────────────────────────────────────────────
@app.route("/api/calendar/status")
def api_calendar_status():
    return jsonify({
        "libsInstalled": GOOGLE_LIBS,
        "configured": _google_configured(),
        "tokenExists": GOOGLE_TOKEN_FILE.exists(),
        "connected": get_calendar_service() is not None,
    })


# The library auto-enables PKCE: a code_verifier is generated when the auth URL
# is built and must be replayed at token exchange. Auth and callback are separate
# requests (separate Flow objects), so persist the verifier between them.
_GOOGLE_VERIFIER_FILE = DATA_DIR / "google-oauth-verifier.txt"


@app.route("/api/calendar/auth")
def api_calendar_auth():
    if not GOOGLE_LIBS:
        return jsonify({"error": "Google API libraries are not installed on the server."}), 500
    if not _google_configured():
        return jsonify({"error": "Google OAuth client not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in server.py."}), 400
    flow = GoogleFlow.from_client_config(_google_client_config(), scopes=GOOGLE_SCOPES, redirect_uri=GOOGLE_REDIRECT_URI)
    auth_url, _state = flow.authorization_url(access_type="offline", include_granted_scopes="true", prompt="consent")
    try:
        _GOOGLE_VERIFIER_FILE.write_text(flow.code_verifier or "")
    except Exception as e:
        print(f"Could not persist PKCE verifier: {e}", file=sys.stderr)
    return jsonify({"url": auth_url})


@app.route("/api/calendar/callback")
def api_calendar_callback():
    if not GOOGLE_LIBS or not _google_configured():
        return redirect("/?calendar=error")
    code = request.args.get("code")
    if not code:
        return redirect("/?calendar=error")
    verifier = None
    if _GOOGLE_VERIFIER_FILE.exists():
        verifier = _GOOGLE_VERIFIER_FILE.read_text().strip() or None
    try:
        flow = GoogleFlow.from_client_config(_google_client_config(), scopes=GOOGLE_SCOPES, redirect_uri=GOOGLE_REDIRECT_URI)
        if verifier:
            flow.code_verifier = verifier   # replay the PKCE verifier from the auth step
        flow.fetch_token(code=code)
        _save_google_creds(flow.credentials)
    except Exception as e:
        print(f"Google OAuth callback error: {e}", file=sys.stderr)
        return redirect("/?calendar=error")
    finally:
        try:
            if _GOOGLE_VERIFIER_FILE.exists():
                _GOOGLE_VERIFIER_FILE.unlink()
        except Exception:
            pass
    return redirect("/?calendar=connected")


@app.route("/api/calendar/disconnect", methods=["POST"])
def api_calendar_disconnect():
    global _ic_email_cache
    try:
        if GOOGLE_TOKEN_FILE.exists():
            GOOGLE_TOKEN_FILE.unlink()
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500
    return jsonify({"ok": True})


@app.route("/api/calendar/events")
def api_calendar_events():
    svc = get_calendar_service()
    if svc is None:
        return jsonify({"error": "not_connected"}), 400
    email = (request.args.get("email") or "").strip()
    start = (request.args.get("start") or "").strip()
    end = (request.args.get("end") or "").strip()
    if not (email and start and end):
        return jsonify({"error": "email, start, and end are required"}), 400
    events = _fetch_events(svc, email, start, end)
    if events is None:
        return jsonify({"error": "calendar_access_denied", "events": []}), 200
    return jsonify({"events": events})


@app.route("/api/calendar/account")
def api_calendar_account():
    svc = get_calendar_service()
    if svc is None:
        return jsonify({"error": "not_connected"}), 400
    account_id = (request.args.get("accountId") or "").strip()
    if not account_id:
        return jsonify({"error": "accountId required"}), 400
    try:
        rows = run_query(f"""
            SELECT NAME_ACCOUNT AS NM, ONBOARDER_NAME_ACCNT AS IC
            FROM FACT_OB_IMPL_PS_IMPLEMENTATION
            WHERE ACCOUNT_ID_OB = '{account_id}'
            QUALIFY ROW_NUMBER() OVER (PARTITION BY ACCOUNT_ID_OB ORDER BY ONBOARDING_STATUS_OB NULLS LAST) = 1
        """)
    except Exception as e:
        return jsonify({"error": f"data query failed: {e}"}), 500
    if not rows:
        return jsonify({"error": "account_not_found"}), 404
    name = rows[0].get("NM") or ""
    ic = rows[0].get("IC") or ""
    email = get_ic_emails().get(ic)
    base = {"account": name, "ic": ic, "icEmail": email,
            "nextCall": None, "lastCall": None, "allEvents": [], "matchConfidence": None}
    if not email:
        base["error"] = "no_ic_email"
        return jsonify(base), 200
    today = date.today()
    # Look back 30 days (for "last call") and forward 21 days (>= the required 14)
    # so upcoming calls a couple weeks out — e.g. an Accounting Export Call — are
    # captured. Pagination in _fetch_events ensures the forward end isn't truncated.
    events = _fetch_events(svc, email, (today - timedelta(days=30)).isoformat(),
                           (today + timedelta(days=21)).isoformat())
    if events is None:
        base["error"] = "calendar_access_denied"
        return jsonify(base), 200
    matched, confidence = [], None
    for ev in events:
        if _name_in_title(name, ev["summary"]):
            matched.append(ev); confidence = "high"
        elif _attendee_company_match(name, ev["attendees"]):
            matched.append(ev); confidence = confidence or "medium"
    now = datetime.now().astimezone()
    upcoming = sorted([e for e in matched if _event_dt(e) and _event_dt(e) >= now], key=_event_dt)
    past = sorted([e for e in matched if _event_dt(e) and _event_dt(e) < now], key=_event_dt)
    base["nextCall"] = upcoming[0] if upcoming else None
    base["lastCall"] = past[-1] if past else None
    base["allEvents"] = sorted(matched, key=lambda e: e["start"] or "")
    base["matchConfidence"] = confidence
    return jsonify(base)


@app.route("/api/calendar/ic-week")
def api_calendar_ic_week():
    """This week's calendar for one IC, categorized for the 1:1 Prep summary."""
    svc = get_calendar_service()
    if svc is None:
        return jsonify({"error": "not_connected"}), 400
    ic = (request.args.get("ic") or "").strip()
    email = get_ic_emails().get(ic)
    if not email:
        return jsonify({"error": "no_ic_email", "ic": ic, "events": [],
                        "koc": [], "goLive": [], "transition": []}), 200
    today = date.today()
    monday = today - timedelta(days=today.weekday())
    sunday = monday + timedelta(days=6)
    evs = _fetch_events(svc, email, monday.isoformat(), sunday.isoformat())
    if evs is None:
        return jsonify({"error": "calendar_access_denied", "ic": ic, "events": [],
                        "koc": [], "goLive": [], "transition": []}), 200
    return jsonify({
        "ic": ic, "icEmail": email, "weekStart": monday.isoformat(),
        "events": evs,
        "koc": _title_has(evs, "kick off", "kickoff", "kick-off"),
        "goLive": _title_has(evs, "go live", "go-live", "golive"),
        "transition": _title_has(evs, "success", "welcome"),
    })


@app.route("/api/calendar/compliance")
def api_calendar_compliance():
    svc = get_calendar_service()
    if svc is None:
        return jsonify({"connected": False, "error": "not_connected", "flags": [], "byType": {}, "byIc": {}}), 200
    team = get_ic_names()
    emails = get_ic_emails()
    if not team:
        return jsonify({"connected": True, "flags": [], "byType": {}, "byIc": {}, "missingEmail": []})
    try:
        rows = run_query(f"""
            SELECT ACCOUNT_ID_OB, NAME_ACCOUNT, ONBOARDER_NAME_ACCNT, ONBOARDING_STATUS_OB,
                   IMPLEMENTATION_START_DATE_OB, PROJECTED_GO_LIVE_DATE_OB,
                   ANTICIPATED_SUCCESS_TRANSITION_DATE_OB, SUCCESS_TRANSITION_STATUS_OB
            FROM FACT_OB_IMPL_PS_IMPLEMENTATION
            WHERE ONBOARDER_NAME_ACCNT IN ({in_clause(team)})
              AND ONBOARDING_STATUS_OB IN ({in_clause(ACTIVE_STATUSES)})
            QUALIFY ROW_NUMBER() OVER (PARTITION BY ACCOUNT_ID_OB ORDER BY ONBOARDING_STATUS_OB NULLS LAST) = 1
        """)
    except Exception as e:
        return jsonify({"connected": True, "error": f"data query failed: {e}", "flags": []}), 500

    today = date.today()
    by_ic = {}
    for r in rows:
        by_ic.setdefault(r["ONBOARDER_NAME_ACCNT"], []).append(r)

    # one calendar fetch per IC, covering kickoff(+10d) and transition(+3wk) windows
    ic_events, access_errors = {}, []
    for ic in by_ic:
        email = emails.get(ic)
        if not email:
            continue
        evs = _fetch_events(svc, email, (today - timedelta(days=3)).isoformat(),
                            (today + timedelta(days=24)).isoformat())
        if evs is None:
            access_errors.append(ic); evs = []
        ic_events[ic] = evs

    def near(subset, target, days=3):
        out = []
        for e in subset:
            dt = _event_dt(e)
            if dt and abs((dt.date() - target).days) <= days:
                out.append(e)
        return out

    flags = []
    for ic, accts in by_ic.items():
        email = emails.get(ic)
        if not email:
            continue
        evs = ic_events.get(ic, [])
        for r in accts:
            aid = r["ACCOUNT_ID_OB"]; name = r["NAME_ACCOUNT"] or ""
            status = r["ONBOARDING_STATUS_OB"]
            pgl = _as_date(r.get("PROJECTED_GO_LIVE_DATE_OB"))
            kickoff = _as_date(r.get("IMPLEMENTATION_START_DATE_OB"))
            ant = _as_date(r.get("ANTICIPATED_SUCCESS_TRANSITION_DATE_OB"))
            stt = r.get("SUCCESS_TRANSITION_STATUS_OB") or ""

            # 1. KOC not booked — Pre-Implementation, kickoff within 7 days
            if status == "Pre-Implementation" and kickoff and 0 <= (kickoff - today).days <= 7:
                hits = near(_title_has(evs, "kick off", "kickoff", "kick-off"), kickoff, 3) \
                    or near([e for e in evs if _name_in_title(name, e["summary"])], kickoff, 3)
                if not hits:
                    flags.append({"type": "kocMissing", "severity": "red", "ic": ic, "accountId": aid,
                                  "account": name, "detail": f"Kickoff {kickoff.isoformat()} — no KOC found on calendar"})

            # 2. Go-live check-in missing — Implementation, PGL within 7 days
            if status == "Implementation" and pgl and 0 <= (pgl - today).days <= 7:
                hits = near(_title_has(evs, "go live", "go-live", "golive"), pgl, 3) \
                    or near([e for e in evs if _name_in_title(name, e["summary"])], pgl, 3)
                if not hits:
                    flags.append({"type": "goLiveMissing", "severity": "red", "ic": ic, "accountId": aid,
                                  "account": name, "detail": f"Go-live {pgl.isoformat()} — no check-in booked"})

            # 3 & 4. Transition logic for Live accounts
            if status == "Live":
                window = [e for e in evs if _event_dt(e)
                          and today - timedelta(days=1) <= _event_dt(e).date() <= today + timedelta(days=3)]
                # Only count as a transition call if the event both has a transition
                # keyword AND mentions this specific account — avoids flagging all Live
                # accounts when the IC has a transition call for a different account.
                trans = [e for e in _title_has(window, "success", "welcome", "transition", "handoff")
                         if _name_in_title(name, e.get("summary", ""))]
                pending = (stt == "Pending Handoff Call")
                if pending and not trans:
                    flags.append({"type": "transitionMissing", "severity": "red", "ic": ic, "accountId": aid,
                                  "account": name, "detail": "In Pending Handoff — no transition / Success call booked"})
                elif not pending and trans:
                    flags.append({"type": "transitionNotPending", "severity": "yellow", "ic": ic, "accountId": aid,
                                  "account": name, "detail": f"Transition call booked but status is '{stt or 'n/a'}', not Pending Handoff"})
                if ant and 0 <= (ant - today).days <= 3 and not pending:
                    flags.append({"type": "transitionDataIssue", "severity": "red", "ic": ic, "accountId": aid,
                                  "account": name, "detail": f"Transition {ant.isoformat()} within 3 days but not in Pending Handoff"})

    by_type, by_ic_out = {}, {}
    for f in flags:
        by_type.setdefault(f["type"], []).append(f)
        by_ic_out.setdefault(f["ic"], []).append(f)
    return jsonify({
        "connected": True,
        "flags": flags,
        "byType": by_type,
        "byIc": by_ic_out,
        "accessErrors": access_errors,
        "missingEmail": [ic for ic in by_ic if not emails.get(ic)],
        "icsChecked": [ic for ic in by_ic if emails.get(ic)],
    })


# ════════════════════════════════════════════════════════════════════════════
# Shared task system (Google Sheet backed)
# ════════════════════════════════════════════════════════════════════════════
# A single team-wide Google Sheet (SHARED_TASKS_SHEET_ID) is the source of truth.
# Anyone on the team reads/writes it through these endpoints. Tasks are tagged to
# a person by their fullName in the AssignedTo column, so "My Tasks" filters on
# the logged-in manager's fullName. Senior managers see every row.

# Column order in the sheet (row 1 header). The camelCase API keys mirror these.
# DueDate is last (column L) so it can be appended to an existing sheet without
# shifting any data already written under the original 11-column layout.
SHARED_TASKS_HEADER = [
    "ID", "AssignedTo", "Account", "AccountId", "Task", "Priority",
    "CreatedBy", "CreatedAt", "Status", "CompletedAt", "Notes", "DueDate",
]
# 0-based indices of the editable trailing block: Status=I(8), CompletedAt=J(9),
# Notes=K(10), DueDate=L(11) — contiguous, so /update writes the range I:L.
SHARED_TASKS_RANGE = "A:L"
_SHARED_DONE = {"done", "completed", "complete", "closed"}


def _shared_task_to_api(d):
    """Map a sheet row dict (header-keyed) to the camelCase shape the UI uses."""
    return {
        "id": d.get("ID", ""),
        "assignedTo": d.get("AssignedTo", ""),
        "account": d.get("Account", ""),
        "accountId": d.get("AccountId", ""),
        "task": d.get("Task", ""),
        "priority": d.get("Priority", ""),
        "createdBy": d.get("CreatedBy", ""),
        "createdAt": d.get("CreatedAt", ""),
        "status": d.get("Status", "") or "Open",
        "completedAt": d.get("CompletedAt", ""),
        "notes": d.get("Notes", ""),
        "dueDate": d.get("DueDate", ""),
    }


def _parse_shared_tasks(values):
    """Sheet `values` (list of rows) -> list of header-keyed dicts with `_row`
    (the 1-based sheet row number). Skips a header row and blank rows."""
    if not values:
        return []
    start = 1 if (values[0] and str(values[0][0]).strip().lower() == "id") else 0
    out = []
    for i, row in enumerate(values[start:], start=start):
        if not any((str(c) or "").strip() for c in row):
            continue
        d = {key: (row[j] if j < len(row) else "") for j, key in enumerate(SHARED_TASKS_HEADER)}
        d["_row"] = i + 1  # sheet rows are 1-based
        out.append(d)
    return out


def _read_shared_tasks():
    """(svc, rows-as-header-dicts) or (None, None) if not configured/connected."""
    if not SHARED_TASKS_SHEET_ID:
        return None, None
    svc = get_sheets_service()
    if svc is None:
        return None, None
    try:
        resp = svc.spreadsheets().values().get(
            spreadsheetId=SHARED_TASKS_SHEET_ID, range=SHARED_TASKS_RANGE).execute()
    except Exception as e:
        print(f"Shared tasks read failed: {e}", file=sys.stderr)
        return svc, None
    return svc, _parse_shared_tasks(resp.get("values", []))


def _ensure_shared_header(svc):
    """Ensure row 1 is the full current header. Writes it when missing, and
    upgrades an older/shorter header in place (e.g. a pre-DueDate 11-column
    sheet) without touching the data rows below."""
    rng = f"A1:{chr(ord('A') + len(SHARED_TASKS_HEADER) - 1)}1"  # A1:L1
    try:
        resp = svc.spreadsheets().values().get(
            spreadsheetId=SHARED_TASKS_SHEET_ID, range=rng).execute()
        first = (resp.get("values", []) or [[]])
        existing = [str(c).strip() for c in (first[0] if first else [])]
        if existing == SHARED_TASKS_HEADER:
            return
        svc.spreadsheets().values().update(
            spreadsheetId=SHARED_TASKS_SHEET_ID, range=rng,
            valueInputOption="RAW", body={"values": [SHARED_TASKS_HEADER]}).execute()
    except Exception as e:
        print(f"Shared tasks header write failed: {e}", file=sys.stderr)


def shared_tasks_configured():
    return bool(SHARED_TASKS_SHEET_ID and get_sheets_service() is not None)


def build_assignees():
    """Known people a task can be assigned to: the manager, their ICs, lead ICs,
    the senior manager, and (for seniors) the managers under them. Deduped by
    name; each is tagged with a role for the dropdown grouping."""
    out, seen = [], set()

    def add(name, role):
        n = (name or "").strip()
        if not n or n.lower() in seen:
            return
        seen.add(n.lower())
        out.append({"name": n, "role": role})

    mgr = get_manager().get("fullName") or ""
    add(mgr, "Manager")
    for ic in get_team():
        add(ic.get("name"), "IC")
    for n in LEAD_ICS:
        add(n, "Lead IC")
    add(_real_senior_name(), "Senior Manager")
    if get_role() == "senior-manager":
        try:
            for member in get_senior_team(get_senior_name()):
                add(member.get("manager"), "Manager")
                add(member.get("name"), "IC")
        except Exception:
            pass
    return out


@app.route("/api/shared-tasks")
def api_shared_tasks():
    """All shared tasks the current viewer should see. scope=all returns every
    task (the board); default is 'mine' for managers/leads (AssignedTo ==
    fullName) and 'all' for senior managers."""
    svc, rows = _read_shared_tasks()
    if rows is None:
        return jsonify({"configured": bool(SHARED_TASKS_SHEET_ID),
                        "connected": svc is not None, "tasks": []})
    me = (get_manager().get("fullName") or "").strip().lower()
    scope = (request.args.get("scope") or "").strip().lower()
    if not scope:
        scope = "all" if get_role() == "senior-manager" else "mine"
    tasks = [_shared_task_to_api(r) for r in rows]
    if scope == "mine":
        tasks = [t for t in tasks if t["assignedTo"].strip().lower() == me]
    return jsonify({"configured": True, "connected": True, "scope": scope, "tasks": tasks})


@app.route("/api/shared-tasks/create", methods=["POST"])
def api_shared_tasks_create():
    d = request.get_json(force=True) or {}
    assigned_to = (d.get("assignedTo") or "").strip()
    task_text = (d.get("task") or "").strip()
    if not assigned_to or not task_text:
        return jsonify({"error": "assignedTo and task are required"}), 400
    if not SHARED_TASKS_SHEET_ID:
        return jsonify({"error": "Shared tasks sheet not configured. Set SHARED_TASKS_SHEET_ID in server.py."}), 503
    svc = get_sheets_service()
    if svc is None:
        return jsonify({"error": "Google Sheets not connected. Connect Google in Settings (and grant the Sheets scope)."}), 400
    _ensure_shared_header(svc)
    created_by = (load_config().get("manager", {}).get("fullName") or _author())
    task = {
        "ID": _gen_id("st"),
        "AssignedTo": assigned_to,
        "Account": (d.get("account") or "").strip(),
        "AccountId": (d.get("accountId") or "").strip(),
        "Task": task_text,
        "Priority": (d.get("priority") or "Medium").strip(),
        "CreatedBy": created_by,
        "CreatedAt": datetime.now().isoformat(),
        "Status": "Open",
        "CompletedAt": "",
        "Notes": "",
        "DueDate": (d.get("dueDate") or "").strip(),
    }
    row = [task[k] for k in SHARED_TASKS_HEADER]
    try:
        svc.spreadsheets().values().append(
            spreadsheetId=SHARED_TASKS_SHEET_ID, range=SHARED_TASKS_RANGE,
            valueInputOption="RAW", insertDataOption="INSERT_ROWS",
            body={"values": [row]}).execute()
    except Exception as e:
        print(f"Shared task append failed: {e}", file=sys.stderr)
        return jsonify({"error": f"Could not write to sheet: {e}"}), 502
    return jsonify({"ok": True, "task": _shared_task_to_api(task)})


@app.route("/api/shared-tasks/update", methods=["POST"])
def api_shared_tasks_update():
    """Update a task's Status, Notes, and/or DueDate. Setting a done-like status
    stamps CompletedAt (if not already set); reopening clears it."""
    d = request.get_json(force=True) or {}
    tid = (d.get("id") or "").strip()
    if not tid:
        return jsonify({"error": "id is required"}), 400
    svc, rows = _read_shared_tasks()
    if rows is None:
        return jsonify({"error": "Shared tasks not available (not configured or not connected)."}), 503
    match = next((r for r in rows if str(r.get("ID")).strip() == tid), None)
    if not match:
        return jsonify({"error": "task not found"}), 404
    status = match["Status"]
    completed = match["CompletedAt"]
    notes = match["Notes"]
    due = match.get("DueDate", "")
    if "status" in d and d["status"] is not None:
        status = str(d["status"]).strip()
        if status.lower() in _SHARED_DONE:
            if not completed:
                completed = datetime.now().isoformat()
        else:
            completed = ""  # reopened
    if "notes" in d and d["notes"] is not None:
        notes = str(d["notes"])
    if "dueDate" in d and d["dueDate"] is not None:
        due = str(d["dueDate"]).strip()
    rn = match["_row"]
    try:
        # Status=I, CompletedAt=J, Notes=K, DueDate=L — one contiguous write.
        svc.spreadsheets().values().update(
            spreadsheetId=SHARED_TASKS_SHEET_ID, range=f"I{rn}:L{rn}",
            valueInputOption="RAW",
            body={"values": [[status, completed, notes, due]]}).execute()
    except Exception as e:
        print(f"Shared task update failed: {e}", file=sys.stderr)
        return jsonify({"error": f"Could not update sheet: {e}"}), 502
    match["Status"], match["CompletedAt"], match["Notes"], match["DueDate"] = status, completed, notes, due
    return jsonify({"ok": True, "task": _shared_task_to_api(match)})


def _parse_iso(s):
    """Lenient ISO parse -> datetime or None (handles fractional seconds)."""
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s))
    except Exception:
        try:
            return datetime.fromisoformat(str(s)[:19])
        except Exception:
            return None


def _load_task_seen():
    if TASK_SEEN_FILE.exists():
        try:
            return json.loads(TASK_SEEN_FILE.read_text())
        except Exception:
            return {}
    return {}


def _task_seen_key():
    """Who the 'last seen' timestamp belongs to (the current viewer)."""
    return (get_manager().get("fullName") or get_snowflake_user() or "default").strip().lower()


@app.route("/api/shared-tasks/unseen")
def api_shared_tasks_unseen():
    """Count of NEW tasks for the current user: assigned to them, still Open,
    created within the last 7 days, and created after their last-seen time.
    Drives the red badge on the Tasks nav item."""
    last_seen = _load_task_seen().get(_task_seen_key())
    svc, rows = _read_shared_tasks()
    if rows is None:
        return jsonify({"count": 0, "lastSeen": last_seen,
                        "configured": bool(SHARED_TASKS_SHEET_ID), "connected": svc is not None})
    me = (get_manager().get("fullName") or "").strip().lower()
    cutoff = datetime.now() - timedelta(days=7)
    last_dt = _parse_iso(last_seen)
    count = 0
    for r in rows:
        if (r.get("AssignedTo") or "").strip().lower() != me:
            continue
        if (r.get("Status") or "Open").strip().lower() in _SHARED_DONE:
            continue
        created = _parse_iso(r.get("CreatedAt"))
        if not created or created < cutoff:
            continue
        if last_dt and created <= last_dt:
            continue
        count += 1
    return jsonify({"count": count, "lastSeen": last_seen, "configured": True, "connected": True})


@app.route("/api/shared-tasks/seen", methods=["POST"])
def api_shared_tasks_seen():
    """Mark the current user's shared tasks as seen (stamps last-seen = now)."""
    seen = _load_task_seen()
    key = _task_seen_key()
    seen[key] = datetime.now().isoformat()
    try:
        TASK_SEEN_FILE.write_text(json.dumps(seen, indent=2))
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500
    return jsonify({"ok": True, "lastSeen": seen[key]})


# ── All-accounts autocomplete cache ──────────────────────────────────────────
# The shared-task account picker must search EVERY account, not just the
# logged-in manager's team. We cache the full account list in memory (one row
# per account) and refresh it once a day (or on restart). Searches hit this
# cache, never Snowflake — so type-ahead is instant.
_all_accounts_cache = None
_all_accounts_cached_at = None
_ALL_ACCOUNTS_TTL = timedelta(days=1)


def get_all_accounts(force=False):
    """Cached list of every account: [{name, id, onboarder}]. Lazily loaded on
    the first call and refreshed once a day (or when force=True)."""
    global _all_accounts_cache, _all_accounts_cached_at
    fresh = (_all_accounts_cache is not None and _all_accounts_cached_at is not None
             and (datetime.now() - _all_accounts_cached_at) < _ALL_ACCOUNTS_TTL)
    if fresh and not force:
        return _all_accounts_cache
    try:
        rows = run_query("""
            SELECT NAME_ACCOUNT AS NM, ACCOUNT_ID_OB AS AID, ONBOARDER_NAME_ACCNT AS OB
            FROM FACT_OB_IMPL_PS_IMPLEMENTATION
            WHERE NAME_ACCOUNT IS NOT NULL AND ACCOUNT_ID_OB IS NOT NULL
            QUALIFY ROW_NUMBER() OVER (
                PARTITION BY ACCOUNT_ID_OB
                ORDER BY IMPLEMENTATION_START_DATE_OB DESC NULLS LAST) = 1
        """)
        _all_accounts_cache = [
            {"name": r.get("NM"), "id": r.get("AID"), "onboarder": r.get("OB") or ""}
            for r in rows if r.get("NM") and r.get("AID")
        ]
        _all_accounts_cached_at = datetime.now()
        print(f"All-accounts cache loaded: {len(_all_accounts_cache)} accounts", file=sys.stderr)
    except Exception as e:
        print(f"All-accounts cache refresh failed: {e}", file=sys.stderr)
        if _all_accounts_cache is None:
            _all_accounts_cache = []
    return _all_accounts_cache


@app.route("/api/accounts/search")
def api_accounts_search():
    """Case-insensitive autocomplete over ALL accounts (no team filter). Returns
    up to 15 matches (prefix matches first), each with NAME_ACCOUNT,
    ACCOUNT_ID_OB, and ONBOARDER_NAME_ACCNT. Served from the in-memory cache."""
    q = (request.args.get("q") or "").strip().lower()
    if len(q) < 2:
        return jsonify({"results": [], "count": 0})
    accounts = get_all_accounts()
    matches = [a for a in accounts if q in (a["name"] or "").lower()]
    matches.sort(key=lambda a: (not (a["name"] or "").lower().startswith(q), (a["name"] or "").lower()))
    results = [{"NAME_ACCOUNT": a["name"], "ACCOUNT_ID_OB": a["id"],
                "ONBOARDER_NAME_ACCNT": a["onboarder"]} for a in matches[:15]]
    return jsonify({"results": results, "count": len(accounts)})


# ════════════════════════════════════════════════════════════════════════════
# Gong calls (Snowflake VW_CUSTOMER_GONG_CALLS)
# ════════════════════════════════════════════════════════════════════════════
@app.route("/api/gong/calls")
def api_gong_calls():
    """Last 5 Gong calls for an account, with a deep link per call."""
    account_id = (request.args.get("accountId") or "").strip()
    if not account_id:
        return jsonify({"error": "accountId required", "calls": []}), 400
    try:
        rows = run_query(f"""
            SELECT CONVERSATION_KEY, CALL_TITLE, CALL_START_DATETIME, CALL_DURATION_SECONDS,
                   ST_ATTENDEES, CUSTOMER_ATTENDEES, TALK_RATIO, CALL_SCORE,
                   IFF(CALL_TRANSCRIPT IS NOT NULL AND CALL_TRANSCRIPT <> '', TRUE, FALSE) AS HAS_TRANSCRIPT
            FROM VW_CUSTOMER_GONG_CALLS
            WHERE ACCOUNT_ID = '{_sql_str(account_id)}'
            ORDER BY CALL_START_DATETIME DESC
            LIMIT 5
        """)
    except Exception as e:
        return jsonify({"error": str(e), "calls": []}), 500
    calls = []
    for r in rows:
        key = r.get("CONVERSATION_KEY")
        calls.append({
            "id": key,
            "title": r.get("CALL_TITLE") or "(untitled call)",
            "start": iso_dt(r.get("CALL_START_DATETIME")),
            "durationSeconds": float(r.get("CALL_DURATION_SECONDS") or 0),
            "stAttendees": r.get("ST_ATTENDEES") or "",
            "customerAttendees": r.get("CUSTOMER_ATTENDEES") or "",
            "talkRatio": (float(r["TALK_RATIO"]) if r.get("TALK_RATIO") not in (None, "") else None),
            "callScore": (float(r["CALL_SCORE"]) if r.get("CALL_SCORE") not in (None, "") else None),
            "hasTranscript": bool(r.get("HAS_TRANSCRIPT")),
            "gongUrl": (f"https://app.gong.io/call?id={key}" if key else None),
        })
    return jsonify({"calls": calls})


# ════════════════════════════════════════════════════════════════════════════
# RCA tracker (Google Sheet: "RCAs" + "ActionTracker" tabs)
# ════════════════════════════════════════════════════════════════════════════
def _rca_norm(name):
    """Normalize an account/customer name for fuzzy matching: lowercase, drop a
    'dba …' suffix, strip punctuation and trailing legal suffixes."""
    s = (name or "").lower()
    if " dba " in s:
        s = s.split(" dba ")[0]
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    toks = [t for t in s.split() if t and t not in _NAME_SUFFIXES]
    return " ".join(toks).strip()


def _match_account(name):
    """Fuzzy-match an RCA customer name to (account_id, account_name) via the
    in-memory all-accounts cache. Exact normalized match wins; else containment."""
    target = _rca_norm(name)
    if not target:
        return None, None
    contains = None
    for a in get_all_accounts():
        n = _rca_norm(a["name"])
        if not n:
            continue
        if n == target:
            return a["id"], a["name"]
        if contains is None and min(len(target), len(n)) >= 5 and (target in n or n in target):
            contains = (a["id"], a["name"])
    return contains if contains else (None, None)


@app.route("/api/rca/status")
def api_rca_status():
    """RCA rows (matched to accounts) + open action items, read from the RCA sheet."""
    if not RCA_SHEET_ID:
        return jsonify({"configured": False, "connected": False, "rcas": [], "actions": []})
    svc = get_sheets_service()
    if svc is None:
        return jsonify({"configured": True, "connected": False, "rcas": [], "actions": []})
    rcas = []
    try:
        vals = (svc.spreadsheets().values().get(spreadsheetId=RCA_SHEET_ID, range="RCAs").execute()).get("values", [])
        try:
            fvals = (svc.spreadsheets().values().get(spreadsheetId=RCA_SHEET_ID, range="RCAs",
                     valueRenderOption="FORMULA").execute()).get("values", [])
        except Exception:
            fvals = []
        if vals:
            header = [str(h).strip().lower() for h in vals[0]]
            def col(*names):
                for nm in names:
                    if nm in header:
                        return header.index(nm)
                for i, h in enumerate(header):
                    if any(nm in h for nm in names):
                        return i
                return -1
            ci = {"customer": col("customer", "account"), "link": col("rcca link", "link"),
                  "date": col("rcca date"), "churnMonth": col("churn month"),
                  "ob": col("ob"), "obMgr": col("ob mgr", "ob manager"), "mrr": col("mrr"),
                  "dispo1": col("churn dispo 1", "dispo 1"), "dispo2": col("churn dispo 2", "dispo 2"),
                  "dispo3": col("churn dispo 3", "dispo 3"), "tldr": col("tldr")}
            def g(row, key):
                i = ci[key]
                if i < 0 or i >= len(row) or row[i] in (None, ""):
                    return ""
                return str(row[i]).strip()
            for ri, row in enumerate(vals[1:], start=1):
                cust = g(row, "customer")
                if not cust or "example" in cust.lower():
                    continue
                link_disp = g(row, "link")
                link_url = link_disp if link_disp.startswith("http") else None
                if not link_url and ci["link"] >= 0 and ri < len(fvals) and ci["link"] < len(fvals[ri]):
                    fcell = str(fvals[ri][ci["link"]])
                    m = re.search(r'HYPERLINK\(\s*"([^"]+)"', fcell, re.I)
                    if m:
                        link_url = m.group(1)
                    elif fcell.strip().startswith("http"):
                        link_url = fcell.strip()
                mid, mname = _match_account(cust)
                rcas.append({"customer": cust, "link": link_url, "linkText": link_disp,
                             "date": g(row, "date"), "churnMonth": g(row, "churnMonth"),
                             "ob": g(row, "ob"), "obMgr": g(row, "obMgr"), "mrr": g(row, "mrr"),
                             "dispo1": g(row, "dispo1"), "dispo2": g(row, "dispo2"), "dispo3": g(row, "dispo3"),
                             "tldr": g(row, "tldr"), "accountId": mid, "matchedName": mname})
    except Exception as e:
        print(f"RCA RCAs read failed: {e}", file=sys.stderr)
        return jsonify({"configured": True, "connected": True, "rcas": [], "actions": [], "error": str(e)})

    actions = []
    try:
        avals = (svc.spreadsheets().values().get(spreadsheetId=RCA_SHEET_ID, range="ActionTracker").execute()).get("values", [])
        for row in avals:
            if not any((str(c) or "").strip() for c in row):
                continue
            cell = lambda i: (str(row[i]).strip() if i < len(row) and row[i] is not None else "")
            status = cell(5)
            actions.append({"date": cell(0), "item": cell(1), "area": cell(2),
                            "owner": cell(3), "due": cell(4), "status": status, "notes": cell(6)})
        actions = [a for a in actions if a["status"].lower() not in ("done", "closed", "complete", "completed")
                   and (a["item"] or a["area"])]
    except Exception as e:
        print(f"RCA ActionTracker read failed: {e}", file=sys.stderr)
    return jsonify({"configured": True, "connected": True, "rcas": rcas, "actions": actions})


# ════════════════════════════════════════════════════════════════════════════
# Gmail account context (read-only; threads with the customer)
# ════════════════════════════════════════════════════════════════════════════
@app.route("/api/gmail/account-threads")
def api_gmail_account_threads():
    """5 most recent Gmail threads for an account. Finds the customer's email
    addresses from the IC's matched calendar events, then searches Gmail by those
    addresses (falling back to the account name)."""
    svc = get_gmail_service()
    if svc is None:
        return jsonify({"error": "not_connected", "threads": []}), 400
    account_id = (request.args.get("accountId") or "").strip()
    if not account_id:
        return jsonify({"error": "accountId required", "threads": []}), 400
    try:
        rows = run_query(f"""
            SELECT NAME_ACCOUNT AS NM, ONBOARDER_NAME_ACCNT AS IC
            FROM FACT_OB_IMPL_PS_IMPLEMENTATION
            WHERE ACCOUNT_ID_OB = '{_sql_str(account_id)}'
            QUALIFY ROW_NUMBER() OVER (PARTITION BY ACCOUNT_ID_OB ORDER BY ONBOARDING_STATUS_OB NULLS LAST) = 1
        """)
    except Exception as e:
        return jsonify({"error": str(e), "threads": []}), 500
    if not rows:
        return jsonify({"error": "account_not_found", "threads": []}), 404
    name = rows[0].get("NM") or ""
    ic = rows[0].get("IC") or ""

    # Customer (non-ServiceTitan) email addresses from the IC's matched calendar events.
    emails, cal, ic_email = [], get_calendar_service(), get_ic_emails().get(ic)
    if cal and ic_email:
        today = date.today()
        evs = _fetch_events(cal, ic_email, (today - timedelta(days=60)).isoformat(),
                            (today + timedelta(days=14)).isoformat()) or []
        seen = set()
        for ev in evs:
            if _name_in_title(name, ev["summary"]) or _attendee_company_match(name, ev["attendees"]):
                for at in ev["attendees"]:
                    em = (at.get("email") or "").lower()
                    if em and ST_DOMAIN not in em and em not in seen:
                        seen.add(em)
                        emails.append(em)

    if emails:
        q = " OR ".join(f"(from:{e} OR to:{e})" for e in emails[:5])
    else:
        q = f'"{name}"'

    try:
        resp = svc.users().messages().list(userId="me", q=q, maxResults=25).execute()
        msgs = resp.get("messages", [])
    except Exception as e:
        # Most likely the token predates the Gmail scope — prompt a reconnect.
        return jsonify({"error": "gmail_access", "detail": str(e), "threads": [], "queryEmails": emails}), 200

    thread_ids = []
    for m in msgs:
        tid = m.get("threadId")
        if tid and tid not in thread_ids:
            thread_ids.append(tid)
    threads = []
    for tid in thread_ids[:5]:
        try:
            th = svc.users().threads().get(userId="me", id=tid, format="metadata",
                                           metadataHeaders=["Subject", "From", "Date"]).execute()
            tmsgs = th.get("messages", [])
            last = tmsgs[-1] if tmsgs else None
            if not last:
                continue
            hdrs = {h["name"].lower(): h["value"] for h in last.get("payload", {}).get("headers", [])}
            threads.append({"id": tid, "subject": hdrs.get("subject") or "(no subject)",
                            "date": hdrs.get("date"), "from": hdrs.get("from"),
                            "snippet": last.get("snippet") or "",
                            "url": f"https://mail.google.com/mail/u/0/#inbox/{tid}"})
        except Exception:
            continue
    return jsonify({"account": name, "threads": threads, "queryEmails": emails})


# ════════════════════════════════════════════════════════════════════════════
# AI assistant (Anthropic API)
# ════════════════════════════════════════════════════════════════════════════
# The Messages API REQUIRES an x-api-key header. The key is per-manager/secret,
# read from .data/anthropic-key.txt or ANTHROPIC_API_KEY (gitignored, never
# committed). MCP servers are optional and OFF unless .data/mcp-servers.json
# exists, because the public calendar/Slack/Gmail MCP URLs need valid endpoints
# plus OAuth tokens; the call is wrapped to retry without MCP if it errors.

def get_anthropic_key():
    if ANTHROPIC_KEY_FILE.exists():
        k = ANTHROPIC_KEY_FILE.read_text().strip()
        if k:
            return k
    return os.environ.get("ANTHROPIC_API_KEY", "").strip()


def _load_mcp_servers():
    if MCP_SERVERS_FILE.exists():
        try:
            d = json.loads(MCP_SERVERS_FILE.read_text())
            if isinstance(d, list):
                return d
        except Exception as e:
            print(f"mcp-servers.json parse error: {e}", file=sys.stderr)
    return []


def _fiscal_quarter(d):
    """FY starts Feb 1. Q1 Feb-Apr, Q2 May-Jul, Q3 Aug-Oct, Q4 Nov-Jan."""
    m = d.month
    if 2 <= m <= 4:
        q, fy = 1, d.year
    elif 5 <= m <= 7:
        q, fy = 2, d.year
    elif 8 <= m <= 10:
        q, fy = 3, d.year
    elif m == 1:
        q, fy = 4, d.year - 1
    else:  # Nov, Dec
        q, fy = 4, d.year
    return f"Q{q}, fiscal year starting Feb 1 {fy}"


def _parse_hs(raw):
    if raw in (None, ""):
        return None
    try:
        return int(str(raw).strip()[0])
    except Exception:
        return None


def _agent_account_detail(account_id, rows=None):
    row = None
    if rows:
        row = next((r for r in rows if r.get("ACCOUNT_ID_OB") == account_id), None)
    if row is None:
        try:
            q = run_query(f"""
                SELECT ACCOUNT_ID_OB, NAME_ACCOUNT, ONBOARDER_NAME_ACCNT, ONBOARDING_STATUS_OB,
                       ONBOARDING_HEALTH_SCORE_OB, ONBOARDING_HEALTH_SCORE_COMMENTS_OB,
                       PROJECTED_GO_LIVE_DATE_OB, ANTICIPATED_SUCCESS_TRANSITION_DATE_OB,
                       SUCCESS_TRANSITION_STATUS_OB, CMRR_OB
                FROM FACT_OB_IMPL_PS_IMPLEMENTATION WHERE ACCOUNT_ID_OB = '{account_id}'
                QUALIFY ROW_NUMBER() OVER (PARTITION BY ACCOUNT_ID_OB ORDER BY ONBOARDING_STATUS_OB NULLS LAST) = 1
            """)
            row = q[0] if q else None
        except Exception:
            row = None
    if not row:
        return {"accountId": account_id, "error": "not_found"}
    try:
        ov = load_overlays().get(account_id, {}) or {}
    except Exception:
        ov = {}
    detail = {
        "accountId": account_id,
        "name": row.get("NAME_ACCOUNT"),
        "ic": row.get("ONBOARDER_NAME_ACCNT"),
        "status": row.get("ONBOARDING_STATUS_OB"),
        "healthScore": row.get("ONBOARDING_HEALTH_SCORE_OB"),
        "healthComments": (row.get("ONBOARDING_HEALTH_SCORE_COMMENTS_OB") or "").strip(),
        "projectedGoLive": iso(row.get("PROJECTED_GO_LIVE_DATE_OB")),
        "anticipatedTransition": iso(row.get("ANTICIPATED_SUCCESS_TRANSITION_DATE_OB")),
        "successTransitionStatus": row.get("SUCCESS_TRANSITION_STATUS_OB"),
        "cmrr": row.get("CMRR_OB"),
        "notes": [{"text": n.get("text"), "at": n.get("at"), "by": n.get("by")} for n in (ov.get("noteLog") or [])[:8]],
        "actionItems": [{"text": t.get("text"), "done": t.get("done")} for t in (ov.get("actionItems") or [])],
        "escalation": ov.get("escalation"),
        "churnTickets": ov.get("churnTickets") or [],
    }
    svc = get_calendar_service()
    if svc is not None and detail["ic"]:
        email = get_ic_emails().get(detail["ic"])
        if email:
            today = date.today()
            evs = _fetch_events(svc, email, (today - timedelta(days=14)).isoformat(), (today + timedelta(days=14)).isoformat())
            if evs:
                matched = [e for e in evs if _name_in_title(detail["name"], e["summary"]) or _attendee_company_match(detail["name"], e["attendees"])]
                detail["calendarEvents"] = [{"summary": e["summary"], "start": e["start"]} for e in matched[:8]]
    return detail


def _agent_dashboard(account_id=None):
    """Snapshot of the manager's pipeline for the agent's system prompt + suggestions."""
    team = get_team()
    team_names = [t["name"] for t in team]
    out = {"team": team, "teamNames": team_names, "today": date.today().isoformat(),
           "fiscalQuarter": _fiscal_quarter(date.today()), "totalAccounts": 0, "byStatus": {},
           "complianceCount": 0, "complianceByType": {}, "icIssueCounts": {}, "worstIc": None,
           "transitionsThisWeek": [], "goLivesThisWeek": [], "escalationCount": 0, "account": None}
    if team_names:
        try:
            rows = run_query(f"""
                SELECT ACCOUNT_ID_OB, NAME_ACCOUNT, ONBOARDER_NAME_ACCNT, ONBOARDING_STATUS_OB,
                       ONBOARDING_HEALTH_SCORE_OB, ONBOARDING_HEALTH_SCORE_COMMENTS_OB,
                       LAST_UPDATED_HEALTH_SCORE_OB, PROJECTED_GO_LIVE_DATE_OB,
                       ANTICIPATED_SUCCESS_TRANSITION_DATE_OB, SUCCESS_TRANSITION_STATUS_OB, CMRR_OB
                FROM FACT_OB_IMPL_PS_IMPLEMENTATION
                WHERE ONBOARDER_NAME_ACCNT IN ({in_clause(team_names)})
                  AND ONBOARDING_STATUS_OB IN ({in_clause(ACTIVE_STATUSES)})
                QUALIFY ROW_NUMBER() OVER (PARTITION BY ACCOUNT_ID_OB ORDER BY ONBOARDING_STATUS_OB NULLS LAST) = 1
            """)
        except Exception as e:
            out["error"] = str(e)
            rows = []
        today = date.today()
        monday = today - timedelta(days=today.weekday())
        sunday = monday + timedelta(days=6)
        by_status, ic_issues, comp_by_type, comp_total = {}, {}, {}, 0
        for r in rows:
            status = r.get("ONBOARDING_STATUS_OB") or "Unknown"
            by_status[status] = by_status.get(status, 0) + 1
            ic = r.get("ONBOARDER_NAME_ACCNT") or ""
            name = r.get("NAME_ACCOUNT") or ""
            hs = _parse_hs(r.get("ONBOARDING_HEALTH_SCORE_OB"))
            comments = (r.get("ONBOARDING_HEALTH_SCORE_COMMENTS_OB") or "").strip()
            hs_upd = _as_date(r.get("LAST_UPDATED_HEALTH_SCORE_OB"))
            pgl = _as_date(r.get("PROJECTED_GO_LIVE_DATE_OB"))
            ant = _as_date(r.get("ANTICIPATED_SUCCESS_TRANSITION_DATE_OB"))
            issues = []
            if hs is None and status != "Pre-Implementation":
                issues.append("missing health score")
            if hs is not None and not comments:
                issues.append("no HS comments")
            if hs_upd and (today - hs_upd).days > 14:
                issues.append("stale health score")
            if pgl and pgl < today and status not in ("Live", "Hold"):
                issues.append("go-live date passed")
            if ant and ant < today and status != "Hold":
                issues.append("transition overdue")
            if ant and monday <= ant <= sunday and status not in ("Live", "Hold"):
                issues.append("transitioning this week, not live")
            for i in issues:
                comp_by_type[i] = comp_by_type.get(i, 0) + 1
            if issues:
                comp_total += len(issues)
                ic_issues[ic] = ic_issues.get(ic, 0) + len(issues)
            if ant and monday <= ant <= sunday:
                out["transitionsThisWeek"].append({"account": name, "ic": ic, "date": ant.isoformat(), "status": status})
            if pgl and monday <= pgl <= sunday and status != "Live":
                out["goLivesThisWeek"].append({"account": name, "ic": ic, "date": pgl.isoformat()})
        out["totalAccounts"] = len(rows)
        out["byStatus"] = by_status
        out["complianceCount"] = comp_total
        out["complianceByType"] = comp_by_type
        out["icIssueCounts"] = ic_issues
        if ic_issues:
            out["worstIc"] = max(ic_issues, key=ic_issues.get)
    try:
        ov = load_overlays()
        out["escalationCount"] = sum(1 for o in ov.values() if isinstance(o, dict) and o.get("escalation") and o["escalation"].get("open"))
    except Exception:
        pass
    if account_id:
        out["account"] = _agent_account_detail(account_id)
    return out


def _agent_system_prompt(ctx):
    mgr = get_manager()
    L = ["You are an AI assistant for an Onboarding Manager at ServiceTitan. You help monitor their team's onboarding pipeline, identify risks, prepare for 1:1s, and draft communications. Be concise and action-oriented. Never use em dashes. Cite specific numbers (health scores, CMRR, dates) not vague summaries.", ""]
    L.append(f"Manager: {mgr.get('fullName') or mgr.get('name')}.")
    L.append(f"Today is {ctx['today']} ({ctx['fiscalQuarter']}).")
    if ctx.get("teamNames"):
        L.append(f"Team ({len(ctx['teamNames'])} ICs): {', '.join(ctx['teamNames'])}.")
    if ctx.get("byStatus"):
        L.append(f"Pipeline: {ctx['totalAccounts']} active accounts. By status: " + ", ".join(f"{k} {v}" for k, v in ctx['byStatus'].items()) + ".")
    L.append(f"Open escalations: {ctx.get('escalationCount', 0)}.")
    if ctx.get("complianceCount"):
        L.append(f"Salesforce compliance issues: {ctx['complianceCount']} total (" + ", ".join(f"{k} {v}" for k, v in ctx['complianceByType'].items()) + ").")
        if ctx.get("worstIc"):
            L.append(f"IC with the most compliance issues: {ctx['worstIc']} ({ctx['icIssueCounts'][ctx['worstIc']]} items).")
    else:
        L.append("Salesforce compliance: all clear.")
    if ctx.get("transitionsThisWeek"):
        L.append("Transitions this week: " + "; ".join(f"{t['account']} (IC {t['ic']}, {t['date']}, status {t['status']})" for t in ctx['transitionsThisWeek']) + ".")
    if ctx.get("goLivesThisWeek"):
        L.append("Go-lives this week: " + "; ".join(f"{g['account']} (IC {g['ic']}, {g['date']})" for g in ctx['goLivesThisWeek']) + ".")
    a = ctx.get("account")
    if a and not a.get("error"):
        L += ["", "The manager is currently viewing this account:",
              f"  {a['name']} | IC {a['ic']} | status {a['status']} | health score {a['healthScore']} | CMRR {a['cmrr']}",
              f"  Projected go-live {a['projectedGoLive']} | anticipated transition {a['anticipatedTransition']} | transition status {a['successTransitionStatus']}"]
        if a.get("healthComments"):
            L.append(f"  Health score comments: {a['healthComments']}")
        notes = [n['text'] for n in (a.get('notes') or []) if n.get('text')]
        if notes:
            L.append("  Recent notes: " + " || ".join(notes[:5]))
        open_ai = [t['text'] for t in (a.get('actionItems') or []) if not t.get('done') and t.get('text')]
        if open_ai:
            L.append("  Open action items: " + "; ".join(open_ai))
        if a.get("escalation") and a["escalation"].get("open"):
            L.append(f"  ESCALATION OPEN: {a['escalation'].get('reason', '')} | next action: {a['escalation'].get('nextAction', '')}")
        if a.get("calendarEvents"):
            L.append("  Matched calendar events: " + "; ".join(f"{e['summary']} ({e['start']})" for e in a['calendarEvents']))
    L += ["", "When useful, offer a concrete follow-up action, for example drafting a Slack message to an IC or checking an account's calendar for upcoming calls."]
    return "\n".join(L)


def _anthropic_call(key, system, messages, mcp_servers):
    headers = {"x-api-key": key, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json"}
    body = {"model": AGENT_MODEL, "max_tokens": AGENT_MAX_TOKENS, "system": system, "messages": messages}
    if mcp_servers:
        headers["anthropic-beta"] = ANTHROPIC_MCP_BETA
        body["mcp_servers"] = mcp_servers
        body["tools"] = [{"type": "mcp_toolset", "mcp_server_name": s.get("name")} for s in mcp_servers if s.get("name")]
    return http_requests.post(ANTHROPIC_API_URL, headers=headers, json=body, timeout=120)


@app.route("/api/agent/chat", methods=["POST"])
def api_agent_chat():
    data = request.get_json(force=True) or {}
    message = (data.get("message") or "").strip()
    if not message:
        return jsonify({"error": "message required"}), 400
    key = get_anthropic_key()
    if not key:
        return jsonify({"response": "The AI assistant needs an Anthropic API key. Add yours to .data/anthropic-key.txt (or set the ANTHROPIC_API_KEY environment variable) and restart the server.",
                        "toolsUsed": [], "error": "no_api_key"}), 200
    history = data.get("conversationHistory") or []
    messages = []
    for m in history:
        role, content = m.get("role"), m.get("content")
        if role in ("user", "assistant") and isinstance(content, str) and content.strip():
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": message})
    try:
        system = _agent_system_prompt(_agent_dashboard(data.get("accountId")))
    except Exception as e:
        print(f"agent context error: {e}", file=sys.stderr)
        system = "You are an AI assistant for an Onboarding Manager at ServiceTitan. Be concise and action-oriented. Never use em dashes."
    mcp_servers = _load_mcp_servers()
    try:
        resp = _anthropic_call(key, system, messages, mcp_servers)
        if resp.status_code != 200 and mcp_servers:
            print(f"Anthropic call failed with MCP ({resp.status_code}); retrying without MCP", file=sys.stderr)
            resp = _anthropic_call(key, system, messages, [])
        if resp.status_code != 200:
            try:
                err = resp.json().get("error", {}).get("message", "")
            except Exception:
                err = resp.text[:200]
            return jsonify({"response": f"The assistant hit an API error ({resp.status_code}). {err}", "toolsUsed": [], "error": "api_error"}), 200
        d = resp.json()
    except Exception as e:
        print(f"Anthropic request error: {e}", file=sys.stderr)
        return jsonify({"response": "Could not reach the Anthropic API. Check your network and key.", "toolsUsed": [], "error": "request_failed"}), 200
    texts, tools = [], []
    for block in d.get("content", []):
        bt = block.get("type")
        if bt == "text":
            texts.append(block.get("text", ""))
        elif bt == "mcp_tool_use":
            nm = block.get("name") or block.get("server_name")
            if nm:
                tools.append(nm)
    return jsonify({"response": "\n".join(t for t in texts if t).strip() or "(The assistant returned no text.)", "toolsUsed": tools})


@app.route("/api/agent/suggestions")
def api_agent_suggestions():
    try:
        ctx = _agent_dashboard()
    except Exception:
        ctx = {}
    first = lambda nm: (nm or "").split(" ")[0]
    s = ["Which accounts are most at risk this week?"]
    worst = ctx.get("worstIc")
    if worst:
        s.append(f"Is {first(worst)} ready for their upcoming go-lives?")
        s.append(f"Draft a Slack message to {first(worst)} about their compliance gaps.")
    if ctx.get("transitionsThisWeek"):
        s.append("What is the status of accounts transitioning this week?")
    pick = worst or ((ctx.get("teamNames") or [None])[0])
    if pick:
        s.append(f"Prepare my 1:1 talking points for {first(pick)}.")
    if not ctx.get("complianceCount"):
        s.append("Summarize the health of my pipeline this quarter.")
    seen, out = set(), []
    for x in s:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return jsonify({"suggestions": out[:5]})


# ── Run ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("\n  Manager Portal starting on http://localhost:5001\n")
    if not get_snowflake_user():
        print("  No Snowflake user set yet.")
        print("  Run ./setup.sh (Mac) or setup.bat (Windows), or create")
        print("  .data/snowflake-user.txt with your ServiceTitan email, then restart.\n")
    else:
        print(f"  Logged in as: {get_snowflake_user()}")
        print("  Authenticating with Snowflake (Okta popup)...")
        try:
            get_snowflake_conn()
            print("  Snowflake: CONNECTED\n")
        except Exception as e:
            print(f"  Snowflake: FAILED - {e}\n")

    if PORTAL_CACHE_FILE.exists():
        print("  Portal data: CACHED (synced via bookmarklet)")
    else:
        print("  Portal data: NOT SYNCED")
        print("  Go to http://localhost:5001/connect-portal to set up portal sync")
    print()
    app.run(host="0.0.0.0", port=5001, debug=False)
