# CLAUDE.md — Manager Portal Project Context

This file gives AI assistants (Claude Code, Claude.ai, etc.) full context on the Manager Portal project. Read this before making any changes.

---

## What This Is

A locally-run dashboard for ServiceTitan Onboarding Managers to monitor their IC teams' onboarding pipelines. Built by Roberto Najera (Manager, SMB Implementation).

**Stack:** Flask backend (server.py) + vanilla React frontend (JSX via Babel in-browser). No build step. Snowflake for data, OB Portal API for engagement scores (via bookmarklet sync).

**Users:** Roberto Najera, Rachel Hogue (and potentially other managers). Each runs locally on their Mac. Code syncs via GitHub. Personal data is in `.data/` (gitignored).

---

## File Structure

```
manager-portal/
├── server.py              # Flask backend (all API endpoints, Snowflake queries)
├── config.example.json    # Neutral template for optional roster curation (committed)
├── config.json            # OPTIONAL local curation (gitignored; absent = auto-detect)
├── setup.sh               # First-time setup script for new managers
├── connect-portal.html    # Bookmarklet setup page for portal sync
├── .data/                 # Per-manager personal data (GITIGNORED)
│   ├── overlays.json      # Escalation notes, follow-ups, action items per account
│   ├── portal-cache.json  # Cached OB Portal data (engagement, training, flash briefs)
│   ├── todos.json         # Global to-do list
│   ├── slack-token.txt    # Slack bot token (optional; enables Slack features)
│   ├── slack-users.json   # Cached {teamId, refreshedAt, users:{ic_name:{slackId,...}}}
│   ├── snowflake-user.txt # The logged-in manager's SSO email (set by setup; never committed)
│   ├── feedback-webhook.txt # Optional: shared Slack Incoming Webhook URL for feedback delivery
│   └── my-accounts.json   # Lead-IC only: their personal list of SF Account IDs
├── app.jsx                # Main app shell, routing, sidebar nav
├── home.jsx               # Home page (KPI tiles, Week Ahead, compliance banner)
├── detail.jsx             # Account detail slide-over panel
├── escalations.jsx        # Escalations view
├── views-more.jsx         # Accounts, Team, CSAT, Compliance, Performance, Settings, To-Dos
├── ui.jsx                 # Shared UI components
├── data.js                # Data loading layer
├── tweaks-panel.jsx       # Dev tweaks panel
├── styles.css             # All styles (ServiceTitan design tokens, light/dark themes)
├── index.html             # Entry point
└── assets/
    ├── st-tokens.css      # ServiceTitan design system CSS tokens
    └── ServiceTitan-Logo.png
```

---

## Architecture Decisions

### Snowflake Connection
- Auth: SSO via Okta (externalbrowser authenticator). One popup on startup, connection cached globally (_sf_conn).
- Config: account=jw56142.west-us-2.azure, warehouse=MCP_WH, role=MCP_ANALYST_FR, database=DSV_WAREHOUSE, schema=POST_SALES
- Use cur.close() after queries, NEVER conn.close() (connection is reused).
- Snowflake returns UPPERCASE column names. Always use row.get("COLUMN_NAME") or handle both cases.
- Every page load hits Snowflake fresh. Staleness = ETL pipeline refresh, not the connection.

### Portal Data (Engagement Scores)
- Bookmarklet approach. User logs into OB Portal in Chrome, runs bookmarklet that fetches data using browser cookies, POSTs to Flask.
- Base URL: https://custom-wizards.westus2-01.prod.prod.customer-journey.srv.servicetitan.com
- Cached in .data/portal-cache.json
- Structure: {me: [], engagement: {sfId: {scorePercentage, breakdown: [...]}}, details: {sfId: {...}}, ids: [...], syncedAt: "..."}
- Why bookmarklet: MDM blocks Keychain access, unpacked extensions, and browser-cookie3.

### Per-IC Filters (Temp Assignments)
- Core team ICs have filter: {} (no filter, all accounts shown).
- Temp ICs (e.g., Bill Highsmith) get filter: {onboardingType: "Corp 1:1"} to only show relevant accounts.
- Main query builds per-IC WHERE clauses with optional conditions.

### Identity — based on who is logged in (server.py)
- The app connects to Snowflake as the logged-in person: get_snowflake_user()
  reads their SSO email from .data/snowflake-user.txt (or the SNOWFLAKE_USER env
  var). It is NOT hardcoded in server.py and never committed. externalbrowser auth
  means this MUST be the real user, so it's a reliable identity anchor.
- _detect_identity() resolves {managerName, team} by querying
  ONBOARDER_MANAGER_EMAIL_ACCNT = that email (manager name from
  ONBOARDER_MANAGER_ACCNT; team = distinct ONBOARDER_NAME_ACCNT). Cached per process.
- get_manager() / get_team():
  - If the logged-in manager matches config.json's manager (the "config owner")
    AND config has a non-empty team, use the curated config team. This preserves
    borrowed ICs and per-IC filters (e.g. Roberto's Bill Highsmith = Corp 1:1)
    that pure auto-detection would miss.
  - Otherwise (different manager, or empty config team) derive name + team from
    Snowflake. So a fresh manager (setup.sh seeds team:[]) always auto-detects.
- The Home greeting uses the resolved manager's first name — never hardcoded.
- Known edge: if a non-owner manually adds an IC in Settings, it writes to
  config.json and would then be treated as a curated team. Fine for now.

### Multi-Manager Deployment
- Each manager clones the repo and runs setup.sh (Mac) or setup.bat (Windows).
  Setup asks for ONE thing — their ServiceTitan email — and writes it to
  .data/snowflake-user.txt. It does NOT touch tracked files (no config.json
  overwrite, no sed of server.py), so pulls never conflict.
- Name + team derive from that email (see Identity above); nothing about one
  manager leaks to another even though config.json is committed with the
  original owner's curated roster.
- .data/ is gitignored (personal data: email, Slack token, portal cache).
- Update anytime with `git pull` (or `git reset --hard origin/main`); .data/ is
  untouched, so no re-setup is needed.

---

## Snowflake Data Sources

### FACT_OB_IMPL_PS_IMPLEMENTATION (main table)
Primary onboarding records. NOT a daily snapshot.

Key fields:
- ACCOUNT_ID_OB, NAME_ACCOUNT, ONBOARDER_NAME_ACCNT, ONBOARDER_MANAGER_ACCNT
- ONBOARDING_STATUS_OB (Pre-Implementation, Implementation, Live, Hold, No Payment Method, Success, Churn)
- ONBOARDING_HEALTH_SCORE_OB (0-6: 0=Churn Forecasted, 1=Working to Save, 2=60d MIA, 3=30d MIA, 4=Low, 5=Med, 6=High)
- ONBOARDING_HEALTH_SCORE_COMMENTS_OB, LAST_UPDATED_HEALTH_SCORE_OB
- PROJECTED_GO_LIVE_DATE_OB, ANTICIPATED_SUCCESS_TRANSITION_DATE_OB
- SUCCESS_TRANSITION_STATUS_OB ("", Needs CSM, Needs CSM Review, Needs Issue Resolution, Pending Handoff Call, Completed)
- LIVE_DATE_OB, SUCCESS_TRANSITION_CALL_DATE_OB, IMPLEMENTATION_START_DATE_OB
- CMRR_OB, MANAGED_TECH_COUNT_OB, COMPLEXITY_TIER_OB, COHORT_OB
- ONBOARDING_TYPE_OB (Corp 1:1, Franchise Cohort, etc.)

### FACT_SALESFORCE_CHURN_FUNNEL (churn tickets)
Churn/contract change cases. NOT in VW_SUPPORT_CASES (different SFDC record types).
Key: ACCOUNT_ID, CASE_ID, CASE_NUMBER, CASE_SUBJECT, CASE_STATUS, CASE_CHURN_REASON_DESCRIPTION, CASE_TERMINATION_TYPE, CASE_PRIMARY_DISPOSITION, CHURN_TYPE, CASE_CHURN_MRR

### VW_SUPPORT_CASES (support tickets)
Regular support tickets. Join on ACCOUNT_ID.
Key: CASE_NUMBER, SUBJECT, STATUS, PRIORITY, COMPONENT, ISSUE_C, ESCALATION_FLAG, CASE_AGENT_NAME

### FACT_OB_IMPL_PS_CSAT (CSAT surveys)
Key: CSAT_AO (1-5), USER_COMMENT_AO, FULL_NAME_AO, SURVEY_RESPONDED_DATE_AO, filter SURVEY_RESPONDED_AO=TRUE

### FACT_OB_IMPL_WEEKLY_SNAPSHOT (weekly point-in-time snapshots)
Powers the forecast feature. One row per account per weekly CALENDAR_DATE.
Snapshots are weekly (the 1st of a month is usually NOT a snapshot date), so the
"start of month" projection uses the earliest CALENDAR_DATE within the month
(MIN of snapshots in [month_start, month_end)), not an exact date match.
NOTE: column names differ from the live table: uses ONBOARDER_NAME_OB (not
ONBOARDER_NAME_ACCNT) and OB_STATUS_OB (not ONBOARDING_STATUS_OB).
Key: CALENDAR_DATE, ONBOARDER_NAME_OB, OB_STATUS_OB, PROJECTED_GO_LIVE_DATE_OB,
ANTICIPATED_SUCCESS_TRANSITION_DATE_OB, CMRR_OB.
Forecast queries exclude OB_STATUS_OB IN ('Success','Churn','Opted Out','Rejected').

### VW_CUSTOMER_HEALTH_CURRENT (current customer health)
One row per customer. Used to source SUCCESS_REP_NAME (the assigned CSM/Success
Rep) for the "Needs CSM 24h+" compliance check, since the OB view does not carry
it. Join on ACCOUNT_ID = FACT_OB_IMPL_PS_IMPLEMENTATION.ACCOUNT_ID_OB.
Key: ACCOUNT_ID, TENANT_ID, SUCCESS_REP_NAME, SUCCESS_REP_MANAGER_NAME.

---

## Active Statuses
```python
ACTIVE_STATUSES = ("Pre-Implementation", "Implementation", "Live", "Hold", "No Payment Method")
```

---

## Compliance Flags (always check)
SCOPE: compliance applies ONLY to accounts in Implementation or Live status.
Pre-Implementation, Hold, and No Payment Method are excluded entirely. This is
enforced in the Compliance view, the Home compliance banner, and the
/api/slack/compliance-message backend query.
1. Missing Health Score: HS NULL
2. Missing HS Comments: HS exists but no comments
3. PGL Overdue: PGL in the past, not Live
4. Transition Overdue: Ant. transition in the past, not transitioned
5. Stale Health Score: Last updated >14 days ago
6. Transition Before Go-Live: Ant. transition < PGL
7. Transitioning This Week But Not Live: Ant. transition this week, status != Live
8. Needs CSM 24h+ (no Success Rep): SUCCESS_TRANSITION_STATUS_OB = 'Needs CSM',
   no Success Rep assigned, and LAST_SUCCESS_TRANSITION_STATUS_UPDATED_OB > 24h ago.
   "Success Rep" (NOT the Account CSM) is the field that matters. It is NOT on the
   OB view; it comes from VW_CUSTOMER_HEALTH_CURRENT.SUCCESS_REP_NAME joined on
   ACCOUNT_ID. An account can have a CSM assigned and still flag if it has no
   Success Rep. This issue is excluded from the per-IC Slack message and surfaced
   via a "Copy CSM message" button. That message is COPY-ONLY (no Slack deep link,
   no named recipient) because whoever owns CSM assignment varies per manager and
   must NOT be hardcoded — the manager pastes it into a DM to their own contact.

---

## Fiscal Year
Starts February 1. Q1=Feb-Apr, Q2=May-Jul, Q3=Aug-Oct, Q4=Nov-Jan.

---

## Escalation Rules
- HS 0/1/2 auto-generate escalations with source: "auto"
- Manual escalations have source: "Manual"
- Concession status must be string "None" (not null)
- Shape: {open, severity, owner, opened, reason, nextAction, nextActionDue, source, history, concession: {status, tier, detail, amt}}

---

## Key API Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| /api/data | GET | Main data load |
| /api/overlay/<id> | POST | Save account notes/escalation |
| /api/ic-stats?period= | GET | IC performance (2026-06, FY2026Q2, YTD, L3, L6, L12) |
| /api/kickoffs | GET | Upcoming kickoffs |
| /api/forecast/compare?month= | GET | Start-of-month (weekly snapshot) vs current projection vs actuals + drift |
| /api/todos | GET/POST | To-do list |
| /api/todos/add | POST | Add to-do |
| /api/todos/update | POST | Toggle/edit to-do |
| /api/todos/delete | POST | Delete to-do |
| /api/config/team | GET | Team roster |
| /api/config/team/add | POST | Add IC (with optional filter) |
| /api/config/team/remove | POST | Remove IC |
| /api/config/auto-detect-team | POST | Auto-detect ICs from Snowflake |
| /api/portal-sync/receive | POST | Receive portal data from bookmarklet |
| /api/portal-sync/status | GET | Check if cached portal data exists |
| /api/refresh | GET | Confirm Snowflake live-query + report portal cache sync time |
| /api/slack/status | GET | Slack configured? cached user count + last refresh |
| /api/slack/refresh-users | GET | Fetch all Slack users (paginated), match ICs by real_name, cache mapping + team ID |
| /api/slack/compliance-message | POST | {icName} -> {message, slackDeepLink, icName, issueCount} (Implementation/Live only) |
| /api/slack/csm-assignment-message | POST | Copy-only message listing accounts stuck in Needs CSM 24h+ with no Success Rep (no recipient/deep link — paste to your own contact) |
| /api/feedback | POST | {page, text} -> delivers via shared Slack Incoming Webhook (get_feedback_webhook), logs locally; bot token is only a fallback |
| /api/oneonone-notes(/add,/update,/delete) | GET/POST | Per-IC 1:1 talking points |
| /api/my-accounts/search?q= | GET | Lead-IC: search accounts by name (any status), top 20 |
| /api/my-accounts/add, /remove | POST | Lead-IC: add/remove an Account ID to my-accounts.json |

### Roles (manager vs lead-ic)
- LEAD_ICS in server.py lists names that get the stripped-down "lead IC" view.
  get_role() returns "lead-ic" if the logged-in person's name is in that list
  (authoritative — update the list + push, they git pull and their view flips),
  else the config "role", else "manager". /api/data returns `role`.
- Lead-IC nav = My Pipeline / Tasks / Settings only. Their /api/data accounts come
  from .data/my-accounts.json (a personal Account-ID list), ANY status (incl.
  Success), not the team roster. Empty list = no accounts.
- setup.sh / setup.bat detect the role at setup time (grep LEAD_ICS) and write it
  to config.json, but the runtime LEAD_ICS check is what actually decides.

### Slack is optional — and sustainable for many managers
- The whole dashboard works with NO Slack setup. Slack only adds: (a) per-IC
  "Message on Slack" DM deep links, and (b) feedback delivery.
- "Message on Slack" opens a DM in the MANAGER's own Slack (the deep link); the
  bot only resolves user IDs. Without a bot token it degrades to copy-only.
- Feedback delivery uses ONE shared Slack Incoming Webhook the owner creates once
  (FEEDBACK_WEBHOOK_URL env or .data/feedback-webhook.txt). Individual managers do
  NOT each need a Slack bot. The optional users:read bot token (for deep links)
  can also be a single shared read-only token, not one per person.

---

## Code Conventions

### NEVER use em dashes in any content
Use commas, periods, or restructure.

### Frontend
- Vanilla React, no build step, Babel in-browser
- Components: function Name() {}, exported via Object.assign(window, { Name })
- CSS vars from ServiceTitan design system
- Material Symbols icons via <MI>icon_name</MI>
- NO localStorage/sessionStorage

### Backend
- Flask with jsonify responses
- run_query(sql) for Snowflake, returns list of dicts
- in_clause(items) builds SQL IN clauses
- iso(val) converts dates to ISO strings
- All personal data in DATA_DIR (.data/)

---

## Team Roster (Roberto's)

| IC | Snowflake Name | Level | Notes |
|---|---|---|---|
| Alexandra B | Alexandra Battaile | IC3 | On leave, joining June 2026 |
| Dmitri K | Dmitri Khachatryan | IC2 | Active |
| Davon Knight | Davon Knight | IC2 | Active |
| Fetret T | Fetret Tadesse | IC2 | Active |
| Joyce A | Joyce Anderson | IC2 | Active |
| Angie E | Angie Etchebarren | IC2 | Active |
| Anthony C | Anthony Clark | IC1 | Active |
| Bill Highsmith | Bill Highsmith | IC2 | Temp, filter: Corp 1:1 only |

---

## Known Issues
- Bill Highsmith filter doesn't save via Settings UI (works via direct config edit)
- CSAT queries disabled in main data load (works in Performance view)
- Portal bookmarklet fetches accounts one by one (slow, could batch)
- Snowflake email lives in .data/snowflake-user.txt (untracked), read by
  get_snowflake_user(); setup.sh / setup.bat write it. Nothing is hardcoded.
- config.json is gitignored (local curation only). New managers don't need it —
  name + team auto-detect from the login email.
