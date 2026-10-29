// Health score is stale after this many days without an update.
window.HS_STALE_DAYS = 7;

/* ===========================================================
   Data loader for Onboarding Manager Portal
   Fetches real data from the Flask backend, then populates
   window.PORTAL in the exact shape the UI components expect.
   Falls back to empty state if the API is unreachable.
   =========================================================== */
(function () {
  const DAY = 86400000;
  const now = new Date(); now.setHours(9,0,0,0);
  const monday = new Date(now); const dow = (monday.getDay()+6)%7; monday.setDate(monday.getDate()-dow);
  const addDays = (base, n) => { const d = new Date(base); d.setDate(d.getDate()+n); return d; };
  const iso = d => d ? (typeof d === 'string' ? d.slice(0,10) : d.toISOString().slice(0,10)) : null;
  // Date-only strings parse as UTC midnight (shifts back a day in US zones); anchor at local noon.
  const _ld = s => (typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)) ? new Date(s + 'T12:00:00') : new Date(s);
  function daysBetween(a,b){ return Math.round((_ld(b)-_ld(a))/DAY); }
  function ageDays(d){ return d ? Math.floor((now - _ld(d))/DAY) : null; }

  // ── Reference maps (static, same as mock data.js) ──
  const HS = {
    0:{l:"Churn Forecasted", c:"var(--red)",    bg:"rgba(226,79,79,.14)",  bd:"rgba(226,79,79,.45)"},
    1:{l:"Working to Save",  c:"var(--red)",    bg:"rgba(226,79,79,.14)",  bd:"rgba(226,79,79,.45)"},
    2:{l:"60d MIA",          c:"#E8915B",       bg:"rgba(232,145,91,.14)", bd:"rgba(232,145,91,.45)"},
    3:{l:"30d MIA",          c:"var(--yellow)", bg:"rgba(245,193,67,.14)", bd:"rgba(245,193,67,.42)"},
    4:{l:"Low Confidence",   c:"var(--sky)",    bg:"rgba(109,186,248,.14)",bd:"rgba(109,186,248,.4)"},
    5:{l:"Med Confidence",   c:"var(--purple)", bg:"rgba(155,123,232,.14)",bd:"rgba(155,123,232,.4)"},
    6:{l:"High Confidence",  c:"var(--green)",  bg:"rgba(52,201,123,.14)", bd:"rgba(52,201,123,.42)"},
  };
  const STATUS = {
    "Pre-Implementation":{c:"var(--sky)",    bg:"rgba(109,186,248,.14)", bd:"rgba(109,186,248,.38)"},
    "Implementation":    {c:"var(--yellow)", bg:"rgba(245,193,67,.14)",  bd:"rgba(245,193,67,.38)"},
    "Live":              {c:"var(--green)",  bg:"rgba(52,201,123,.14)",  bd:"rgba(52,201,123,.38)"},
    "Hold":              {c:"var(--purple)", bg:"rgba(155,123,232,.14)", bd:"rgba(155,123,232,.38)"},
  };
  const SENT = {
    "Hostile":               {c:"var(--red)"},
    "Frustrated":            {c:"#E8915B"},
    "Neutral":               {c:"var(--yellow)"},
    "Cautiously Optimistic": {c:"var(--sky)"},
    "Re-engaged":            {c:"var(--green)"},
  };
  const SEV = {
    "IC-Owned":        {c:"var(--sky)"},
    "Manager-Engaged": {c:"var(--yellow)"},
    "Leadership":      {c:"var(--red)"},
  };
  const CTIER = {
    "Tier 1 · Roberto":    {c:"var(--sky)",    approver:"Roberto"},
    "Tier 2 · Alyssa":     {c:"var(--yellow)", approver:"Alyssa Conway"},
    "Tier 3 · Leadership": {c:"var(--red)",    approver:"Evan Moore"},
  };
  const CONCESSION_STATUS = {
    "Offered":  {c:"var(--yellow)", i:"schedule"},
    "Accepted": {c:"var(--green)",  i:"check_circle"},
    "Rejected": {c:"var(--red)",    i:"cancel"},
  };
  const PORTAL_STATUS = {
    "On Track":              {c:"var(--green)",  i:"check_circle"},
    "Stuck - Needs Action":  {c:"var(--red)",    i:"error"},
    "Customer Hold":         {c:"var(--purple)", i:"pause_circle"},
    "Ready for Success":     {c:"var(--sky)",    i:"verified"},
  };
  const SPEC_STATUS = {
    "Completed":   {c:"var(--green)"},
    "In Progress": {c:"var(--yellow)"},
    "Not Started": {c:"var(--fg-3)"},
    "On Hold":     {c:"var(--purple)"},
    "Opted Out":   {c:"var(--fg-4)"},
  };
  const engColor = (s) => s>=70 ? "var(--green)" : s>=45 ? "var(--yellow)" : "var(--red)";

  // Success transition pipeline (in order). Pending Handoff Call = good to transition.
  // Keys match the live SUCCESS_TRANSITION_STATUS_OB values exactly.
  const TRANSITION_STATUS = {
    "Needs CSM":               {c:"var(--fg-3)",  i:"hourglass_top", step:1, short:"Needs CSM",  desc:"At go-live — sitting with onboarder"},
    "Needs CSM Review":        {c:"var(--sky)",   i:"rate_review",   step:2, short:"Mgr Review",  desc:"Onboarder flagged ready — CSM mgr to review"},
    "Needs Issue Resolution":  {c:"var(--red)",   i:"error",         step:3, short:"Issue",       desc:"CSM bounced back — needs clarification"},
    "Pending Handoff Call":    {c:"var(--green)", i:"check_circle",  step:4, short:"Ready",       desc:"Cleared by CSM — good to transition"},
  };

  // Elapsed hours between two times, counting ONLY weekday (Mon–Fri) hours.
  // A status flipped Friday afternoon won't accrue SLA hours over the weekend.
  function weekdayHoursBetween(start, end) {
    start = new Date(start); end = new Date(end);
    if (!(end > start)) return 0;
    let ms = 0, cur = new Date(start);
    while (cur < end) {
      const midnight = new Date(cur); midnight.setHours(24, 0, 0, 0);
      const segEnd = midnight < end ? midnight : end;
      const dow = cur.getDay(); // 0 = Sun, 6 = Sat
      if (dow !== 0 && dow !== 6) ms += (segEnd - cur);
      cur = midnight;
    }
    return Math.floor(ms / 3600000);
  }

  const monthKey = d => {
    const dt = typeof d === 'string' ? new Date(d) : d;
    return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}`;
  };

  // ── Default empty state ──
  // ── Default empty state (overwritten by API response) ──
  const manager = {
    name: "Manager", initials: "MG",
    role: "Manager, SMB Implementation",
    reportsTo: "", skip: "",
  };

  // ── PORTAL object (populated by fetch, starts empty) ──
  window.PORTAL = {
    now, monday, addDays, iso, daysBetween, ageDays,
    team: [], activeTeam: [],
    accounts: [],
    HS, STATUS, SENT, SEV, CTIER, CONCESSION_STATUS,
    PORTAL_STATUS, SPEC_STATUS, TRANSITION_STATUS, engColor, weekdayHoursBetween,
    history: {}, orderedKeys: [], currentKey: monthKey(now), monthKey,
    manager,
    _loading: true,
    _error: null,
    _syncedAt: null,
    _portalEnabled: false,
  };
  const P = window.PORTAL;

  // Normalize one raw account from /api/data into the shape the UI expects.
  // Shared by the initial load and window.reloadAccounts (no full page reload).
  function mapAccount(a) {
    return {
      ...a,
      // Rescue/Success accounts can have no onboarder; keep ic a string so
      // name.split()/slice() never hit null (e.g. Avatar, firstName).
      ic: a.ic || "",
      tickets: a.tickets || [],
      csat: a.csat || [],
      actionItems: a.actionItems || [],
      linkedTickets: a.linkedTickets || [],
      specialists: a.specialists || {
        DQA: {status: null, name: null},
        Telecom: {status: null, name: null},
        Fintech: {status: null, name: null},
      },
      training: a.training || null,
      usage: a.usage || null,
      engagementBreakdown: a.engagementBreakdown || null,
      externalLinks: a.externalLinks || {},
      poc: a.poc || {name: null, email: null, phone: null},
      outstandingBalance: a.outstandingBalance || 0,
      initialPgl: a.initialPgl || null,
      kocDate: a.kocDate || null,
      escalation: a.escalation || null,
      churnTickets: a.churnTickets || [],
      isEscalationRisk: a.isEscalationRisk || false,
      todos: a.todos || [],
    };
  }

  // Re-fetch just the account list and re-normalize it in place — used after
  // adding/removing a pipeline account so we avoid a full location.reload()
  // (which re-compiles every JSX file via in-browser Babel).
  window.reloadAccounts = function () {
    return fetch("/api/data").then(r => r.json()).then(d => {
      if (!d.error) P.accounts = (d.accounts || []).map(mapAccount);
      return P.accounts;
    });
  };

  // ── Fetch real data from Flask backend ──
  window._portalReady = new Promise((resolve, reject) => {
    fetch("/api/data")
      .then(r => {
        if (!r.ok) throw new Error(`API returned ${r.status}`);
        return r.json();
      })
      .then(data => {
        if (data.error) throw new Error(data.error);

        // Populate team
        P.team = data.team || [];
        P.activeTeam = P.team.filter(t => !t.onLeave);

        // Populate accounts (fill in defaults for missing portal fields)
        P.accounts = (data.accounts || []).map(mapAccount);

        // Populate history
        P.history = data.history || {};
        P.orderedKeys = Object.keys(P.history).sort();

        // Populate manager from config
        if (data.manager) {
          const m = data.manager;
          P.manager = {
            name: m.name || "Manager",
            fullName: m.fullName || m.name || "Manager",
            initials: m.initials || "MG",
            role: m.role || "Manager, SMB Implementation",
            reportsTo: m.reportsTo || "",
            skip: m.skip || "",
          };
        }

        // Metadata
        P._loading = false;
        P._syncedAt = data.syncedAt;
        P._snowflakeSyncedAt = (data.sourceSync && data.sourceSync.snowflake) || data.syncedAt;
        P._snowflakeDataAsOf = (data.sourceSync && data.sourceSync.snowflakeDataAsOf) || null;
        P._role = data.role || "manager";
        P._superAdmin = data.superAdmin || false;
        P._impersonating = data.impersonating || null;
        P._leadICs = data.leadICs || [];
        P._seniorManager = data.seniorManager || "";
        P._managers = data.managers || [];
        P._portalSyncedAt = (data.sourceSync && data.sourceSync.portal) || null;
        P._portalEnabled = data.portalEnabled || false;
        window._cycleTime = data.cycleTime || [];
        window._kickoffs = data.kickoffs || [];
        window._forecastCompare = data.forecastCompare || null;
        window._todos = data.todos || [];
        P._assignees = data.assignees || [];
        P._sharedTasksConfigured = data.sharedTasksConfigured || false;

        console.log(`[Portal] Loaded ${P.accounts.length} accounts, ${P.orderedKeys.length} months of history, ${window._kickoffs.length} kickoffs, ${window._todos.length} todos`);
        resolve(P);
      })
      .catch(err => {
        console.error("[Portal] Data load failed:", err);
        P._loading = false;
        P._error = err.message;
        // Keep the empty state so the UI can render with an error banner
        resolve(P);
      });
  });
})();
