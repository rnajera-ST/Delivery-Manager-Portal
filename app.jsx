/* App shell — sidebar nav, routing, overlay persistence, Tweaks */
const { useState: useStateA, useEffect: useEffectA } = React;

const NAV = [
  { sec: "Overview" },
  { id: "home", label: "Home", icon: "dashboard" },
  { id: "todos", label: "To-Dos", icon: "checklist" },
  { id: "compliance", label: "Compliance", icon: "rule" },
  { sec: "Portfolio" },
  { id: "portfolio", label: "Accounts", icon: "list_alt" },
  { id: "team", label: "Team", icon: "groups" },
  { id: "capacity", label: "Capacity", icon: "stacked_bar_chart" },
  { sec: "Insights" },
  { id: "oneonone", label: "1:1 Prep", icon: "summarize" },
  { id: "performance", label: "Performance", icon: "leaderboard" },
  { sec: "Admin" },
  { id: "settings", label: "Settings", icon: "settings" },
];

// Stripped-down nav for lead ICs.
const LEAD_NAV = [
  { sec: "Pipeline" },
  { id: "myweek", label: "My Week Ahead", icon: "calendar_month" },
  { id: "mypipeline", label: "My Pipeline", icon: "timeline" },
  { id: "todos", label: "Tasks", icon: "checklist" },
  { id: "tasks", label: "Shared Tasks", icon: "assignment" },
  { sec: "Admin" },
  { id: "settings", label: "Settings", icon: "settings" },
];

// Senior managers get the full manager toolset, just with broader (all-teams)
// scope, plus a Managers comparison view. 1:1 Prep and Home roll up to the
// manager level (her direct reports) instead of the IC level.
const SENIOR_NAV = [
  { sec: "Overview" },
  { id: "home", label: "Home", icon: "dashboard" },
  { id: "managers", label: "Managers", icon: "supervisor_account" },
  { id: "tasks", label: "Tasks", icon: "assignment" },
  { id: "escalations", label: "Escalations", icon: "warning" },
  { id: "compliance", label: "Compliance", icon: "rule" },
  { sec: "Portfolio" },
  { id: "portfolio", label: "Accounts", icon: "list_alt" },
  { sec: "Insights" },
  { id: "oneonone", label: "1:1 Prep", icon: "summarize" },
  { id: "performance", label: "Performance", icon: "leaderboard" },
  { sec: "Admin" },
  { id: "settings", label: "Settings", icon: "settings" },
];

const TITLES = {
  settings: ["Settings", "Manage your team roster"],
  todos: ["My To-Dos", "Everything on your plate"],
  tasks: ["Shared Tasks", "Assign and track tasks across the team"],
  compliance: ["Compliance", "Accounts with Salesforce compliance issues"],
  performance: ["Performance", "IC-level activations, transitions, cycle time, and CSAT"],
  home: ["", "Your team at a glance — week of " ],
  mypipeline: ["My Pipeline", "Your accounts across every stage"],
  myweek: ["My Week Ahead", "Go-lives, transitions, and tasks for your book this week"],
  escalations: ["Escalation Tracker", "Active risks across your portfolio"],
  portfolio: ["Accounts", "Every account your team manages — list or pipeline view"],
  team: ["Team", "Workload & health by Implementation Consultant"],
  capacity: ["Capacity", "MAX backlog and resource assignment tracker"],
  oneonone: ["1:1 Prep", "Pull a per-IC summary for your next meeting"],
  csat: ["Customer Satisfaction", "Survey responses across the team"],
  managers: ["Managers", "Compare every manager and their team"],
};

const OVERLAY_FIELDS = ["sentiment","followUpDate","nextSteps","notes","actionItems","linkedTickets","escalation"];
const STORE_KEY = "ob_portal_overlays_v1";

function loadOverlays(accounts) {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    accounts.forEach(a => { if (raw[a.id]) OVERLAY_FIELDS.forEach(f => { if (raw[a.id][f] !== undefined) a[f] = raw[a.id][f]; }); });
  } catch (e) {}
}
function saveOverlay(a) {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    raw[a.id] = {}; OVERLAY_FIELDS.forEach(f => raw[a.id][f] = a[f]);
    localStorage.setItem(STORE_KEY, JSON.stringify(raw));
  } catch (e) {}
}

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#2270EE",
  "density": "regular"
}/*EDITMODE-END*/;

const DENSITY_PAD = { compact: "7px", regular: "11px", comfy: "15px" };

function syncedAgo(iso) {
  if (!iso) return "just now";
  const mins = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins + "m ago";
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + "h ago";
  return Math.floor(hrs / 24) + "d ago";
}

// Absolute timestamp formatted in US Eastern (NYC) time.
function fmtET(iso) {
  if (!iso) return "unknown";
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  }) + " ET";
}

// Map internal view ids to the page slugs we record in feedback.
const FEEDBACK_PAGE_SLUG = { portfolio: "accounts" };
function FeedbackWidget({ view, account }) {
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState("");
  const [type, setType] = React.useState("General");
  const [priority, setPriority] = React.useState("Medium");
  const [busy, setBusy] = React.useState(false);
  // Auto-captured page: the open account detail wins, else the current view.
  const page = account ? ("detail:" + account.tenant) : (FEEDBACK_PAGE_SLUG[view] || view);
  const pageLabel = account ? account.tenant : (view === "home" ? "Home" : ((TITLES[view] && TITLES[view][0]) || view));

  const send = () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    fetch("/api/feedback", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page: page, text: text.trim(), type: type, priority: priority }),
    }).then(r => r.json()).then(d => {
      setBusy(false); setOpen(false); setText(""); setType("General"); setPriority("Medium");
      showToast(d && d.delivered ? "Feedback sent — thank you!" : "Feedback saved — thank you!");
    }).catch(() => { setBusy(false); showToast("Couldn't send feedback. Please try again."); });
  };

  return (
    <>
      <button className="feedback-fab" onClick={() => setOpen(o => !o)} title="Send feedback about this page">
        <MI>{open ? "close" : "feedback"}</MI>{!open && <span>Feedback</span>}
      </button>
      {open && (
        <div className="feedback-pop">
          <div className="fp-title">Feedback on <strong>{pageLabel}</strong></div>
          <div style={{ display: "flex", gap: 8 }}>
            <select className="select-sm" value={type} onChange={e => setType(e.target.value)} style={{ flex: 1 }} title="Type">
              {["General", "Bug", "Feature request", "Question"].map(o => <option key={o} value={o}>{o}</option>)}
            </select>
            <select className="select-sm" value={priority} onChange={e => setPriority(e.target.value)} style={{ flex: 1 }} title="Priority">
              {["Low", "Medium", "High"].map(o => <option key={o} value={o}>{o} priority</option>)}
            </select>
          </div>
          <textarea className="inp" autoFocus rows={4} value={text}
            placeholder="What's working, what's confusing, what would you change?"
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send(); if (e.key === "Escape") setOpen(false); }} />
          <div className="fp-actions">
            <span className="fp-hint">Sent straight to the portal owner.</span>
            <button className="btn btn-sm btn-primary" onClick={send} disabled={busy || !text.trim()}>
              <MI style={{ fontSize: 15 }}>{busy ? "sync" : "send"}</MI>{busy ? "Sending…" : "Send"}</button>
          </div>
        </div>
      )}
    </>
  );
}

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const role = P._role || "manager";
  const nav = role === "lead-ic" ? LEAD_NAV : role === "senior-manager" ? SENIOR_NAV : NAV;
  const allowedViews = nav.filter(n => n.id).map(n => n.id);
  const [view, setView] = useStateA(() => {
    const h = location.hash.replace("#", "");
    if (allowedViews.includes(h)) return h;
    return role === "lead-ic" ? "myweek" : "home";
  });
  const [sel, setSel] = useStateA(null);
  const [icFocus, setIcFocus] = useStateA(null);
  const [complianceFocus, setComplianceFocus] = useStateA(null);
  const [managerFocus, setManagerFocus] = useStateA(null);
  const [refreshing, setRefreshing] = useStateA(false);
  const [taskBadge, setTaskBadge] = useStateA(0);
  const [theme, setThemeState] = useStateA(() => localStorage.getItem("ob_portal_theme") || "dark");
  const setTheme = (v) => { setThemeState(v); try { localStorage.setItem("ob_portal_theme", v); } catch(e){} };
  const accounts = P.accounts;

  useEffectA(() => { loadOverlays(accounts); }, []);
  useEffectA(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffectA(() => {
    document.documentElement.style.setProperty("--accent", t.accent);
    document.documentElement.style.setProperty("--row-pad", DENSITY_PAD[t.density] || "11px");
  }, [t.accent, t.density]);
  useEffectA(() => { location.hash = view; }, [view]);
  // Shared-tasks "new tasks for you" badge: load the unseen count on mount,
  // then clear it (and stamp last-seen) once the user opens the Tasks page.
  useEffectA(() => {
    fetch("/api/shared-tasks/unseen").then(r => r.json()).then(d => setTaskBadge(d.count || 0)).catch(() => {});
  }, []);
  useEffectA(() => {
    if (view === "tasks" && taskBadge > 0) {
      fetch("/api/shared-tasks/seen", { method: "POST" }).catch(() => {});
      setTaskBadge(0);
    }
  }, [view, taskBadge]);
  // Google Calendar OAuth return: show a toast, then strip the query param.
  useEffectA(() => {
    const p = new URLSearchParams(location.search).get("calendar");
    if (!p) return;
    if (p === "connected") showToast("Google Calendar connected.");
    else if (p === "error") showToast("Google Calendar connection failed. Check the OAuth setup in server.py.");
    const url = location.pathname + (location.hash || "");
    window.history.replaceState({}, "", url);
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    // Clear the server's per-process identity/team caches (so a roster/role
    // change is picked up), then reload — which re-queries Snowflake fresh.
    fetch("/api/refresh", { method: "POST" }).catch(() => {}).then(() => location.reload());
  };

  // Super-admin impersonation: view the app as another role/user.
  const impersonateAs = (r, name) => fetch("/api/impersonate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: r, name }) }).then(() => location.reload());
  const stopImpersonation = () => fetch("/api/impersonate/stop", { method: "POST" }).then(() => location.reload());

  const goTo = (v) => { setView(v); document.querySelector(".content")?.scrollTo(0,0); };
  const goToCompliance = (issueKey) => { setComplianceFocus(issueKey || null); goTo("compliance"); };
  const onOpen = (a) => setSel(a);
  const onSave = (a) => {
    saveOverlay(a);
    // Also persist to Flask backend
    fetch("/api/overlays", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(a),
    }).catch(() => {});
  };

  const escCount = accounts.filter(a => a.escalation && a.escalation.open).length;
  const [titleBase, subBase] = TITLES[view] || ["", ""];
  // Home greeting is built from the logged-in manager (no hardcoded name).
  const greeting = (() => { const h = P.now.getHours(); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; })();
  const mgrFirst = (P.manager && P.manager.name) ? P.manager.name : "there";
  const title = view === "home" ? `${greeting}, ${mgrFirst}` : titleBase;
  const sub = view === "home" ? subBase + P.monday.toLocaleDateString("en-US",{month:"long",day:"numeric"})
    : (view === "oneonone" && role === "senior-manager") ? "Per-manager rollup for your next 1:1"
    : subBase;

  const goToManager = (m) => { setManagerFocus(m || null); goTo("managers"); };

  let body;
  if (view === "home") body = role === "senior-manager"
    ? <div className="view-enter"><SeniorManagerOverview goToManager={goToManager} goToCompliance={goToCompliance} /><Home accounts={accounts} onOpen={onOpen} goTo={goTo} goToCompliance={goToCompliance} /></div>
    : <Home accounts={accounts} onOpen={onOpen} goTo={goTo} goToCompliance={goToCompliance} />;
  else if (view === "managers") body = <ManagersView accounts={accounts} onOpen={onOpen} focus={managerFocus} />;
  else if (view === "escalations") body = <Escalations accounts={accounts} onOpen={onOpen} onSave={onSave} />;
  else if (view === "portfolio") body = <AccountsView accounts={accounts} onOpen={onOpen} senior={role === "senior-manager"} />;
  else if (view === "team") body = <Team accounts={accounts} onOpen={onOpen} goTo={goTo} setIcFocus={setIcFocus} />;
  else if (view === "capacity") body = <CapacityView />;
  else if (view === "oneonone") body = role === "senior-manager"
    ? <SeniorOneOnOne accounts={accounts} onOpen={onOpen} goToCompliance={goToCompliance} mgrFocus={managerFocus} setMgrFocus={setManagerFocus} />
    : <OneOnOne accounts={accounts} onOpen={onOpen} icFocus={icFocus} setIcFocus={setIcFocus} />;
  else if (view === "csat") body = <Csat accounts={accounts} onOpen={onOpen} setIcFocus={setIcFocus} goTo={goTo} />;
  else if (view === "settings") body = <SettingsView />;
  else if (view === "todos") body = <TodosView onOpen={onOpen} />;
  else if (view === "tasks") body = <SharedTasksBoard onOpen={onOpen} />;
  else if (view === "compliance") body = <ComplianceView accounts={accounts} onOpen={onOpen} focus={complianceFocus} senior={role === "senior-manager"} />;
  else if (view === "performance") body = role === "senior-manager" ? <SeniorPerformance accounts={accounts} /> : <PerformanceView />;
  else if (view === "mypipeline") body = <MyPipeline accounts={accounts} onOpen={onOpen} />;
  else if (view === "myweek") body = <LeadWeekAhead accounts={accounts} />;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sb-brand">
          <img src="assets/ServiceTitan-Logo.png" alt="ServiceTitan" />
          <div><div className="bt">Onboarding</div><div className="bs">Manager Portal</div></div>
        </div>
        <div className="sb-nav">
          {nav.map((n, i) => n.sec
            ? <div className="sb-section" key={"s"+i}>{n.sec}</div>
            : <button key={n.id} className={"nav-item" + (view===n.id?" active":"")} onClick={()=>goTo(n.id)}>
                <MI>{n.icon}</MI>{n.label}
                {n.id==="escalations" && escCount>0 && <span className="badge">{escCount}</span>}
                {n.id==="tasks" && taskBadge>0 && <span className="badge">{taskBadge}</span>}
              </button>)}
        </div>
        <div className="sb-foot">
          <span className="avatar" style={{ width:34, height:34 }}>{P.manager.initials}</span>
          <div style={{ minWidth:0 }}>
            <div className="nm">{P.manager.name}</div>
            <div className="rl">SMB Implementation</div>
          </div>
        </div>
      </aside>

      <main className="main">
        {P._impersonating && (
          <div style={{ display:"flex", alignItems:"center", gap:10, padding:"7px 28px", background:"var(--tint-blue-15)", borderBottom:"1px solid var(--accent)", fontSize:12.5, fontWeight:700, color:"var(--sky)" }}>
            <MI style={{ fontSize:16 }}>visibility</MI>
            Viewing as {P._impersonating.name} ({P._impersonating.role === "lead-ic" ? "Lead IC" : P._impersonating.role === "senior-manager" ? "Senior Manager" : "Manager"})
            <span style={{ flex:1 }} />
            <button className="btn btn-sm" onClick={stopImpersonation}><MI style={{ fontSize:15 }}>logout</MI>Exit impersonation</button>
          </div>
        )}
        <header className="topbar">
          <div>
            <h1>{title}</h1>
            {sub && <div className="sub">{sub}</div>}
          </div>
          <span className="spacer" />
          {P._superAdmin && (
            <select className="select-sm" title="Super admin: view as another role" style={{ maxWidth:220 }}
              value={P._impersonating ? ((P._impersonating.role === "senior-manager" ? "senior:" : "lead:") + P._impersonating.name) : "self"}
              onChange={e => {
                const v = e.target.value;
                if (v === "self") return stopImpersonation();
                if (v.startsWith("senior:")) return impersonateAs("senior-manager", v.slice(7));
                impersonateAs("lead-ic", v.slice(5));
              }}>
              <option value="self">View as: Yourself</option>
              {P._seniorManager && <option value={"senior:" + P._seniorManager}>View as {P._seniorManager} (Senior)</option>}
              {(P._leadICs || []).map(n => <option key={n} value={"lead:" + n}>View as {n} (Lead)</option>)}
            </select>
          )}
          <button className="btn btn-sm btn-ghost icon-btn" title="Toggle light / dark" onClick={()=>setTheme(theme==="dark"?"light":"dark")}><MI>{theme==="dark"?"light_mode":"dark_mode"}</MI></button>
          <div className="pill-tag" title={`Data last refreshed by ETL: ${fmtET(P._snowflakeDataAsOf)}\nDashboard queried: ${fmtET(P._syncedAt)}`}><MI style={{fontSize:15, color: P._portalEnabled ? "var(--green)" : "var(--yellow)"}}>cloud_done</MI>Snowflake{P._portalEnabled ? " + Portal" : ""} · {P._snowflakeDataAsOf ? `data updated ${syncedAgo(P._snowflakeDataAsOf)}` : `synced ${syncedAgo(P._syncedAt)}`}</div>
          <button className="btn btn-sm" onClick={handleRefresh} disabled={refreshing}><MI>{refreshing ? "sync" : "refresh"}</MI>{refreshing ? "Loading..." : "Refresh"}</button>
        </header>
        <div className="content">{body}</div>
      </main>

      {sel && <AccountDetail account={sel} onClose={()=>setSel(null)} onSave={onSave} />}

      <FeedbackWidget view={view} account={sel} />
      {window.AgentChat && <window.AgentChat account={sel} />}

      <TweaksPanel>
        <TweakSection label="Appearance" />
        <TweakRadio label="Theme" value={theme} options={["dark","light"]}
          onChange={setTheme} />
        <TweakSection label="Brand accent" />
        <TweakColor label="Accent" value={t.accent}
          options={["#2270EE","#6DBAF8","#34C97B","#9B7BE8"]}
          onChange={(v)=>setTweak("accent", v)} />
        <TweakSection label="Layout" />
        <TweakRadio label="Density" value={t.density} options={["compact","regular","comfy"]}
          onChange={(v)=>setTweak("density", v)} />
      </TweaksPanel>
    </div>
  );
}

// Wait for data to load before rendering
const root = ReactDOM.createRoot(document.getElementById("root"));

function renderLoading() {
  root.render(
    React.createElement("div", {
      style: {
        display:"flex", alignItems:"center", justifyContent:"center",
        height:"100vh", fontFamily:"Nunito Sans, sans-serif",
        color:"var(--fg-2)", gap: 12,
      }
    },
      React.createElement("span", {className:"material-symbols-outlined", style:{animation:"spin 1s linear infinite"}}, "sync"),
      "Connecting to Snowflake..."
    )
  );
}

renderLoading();

window._portalReady.then(() => {
  if (window.PORTAL._error) {
    root.render(
      React.createElement("div", {
        style: {
          display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
          height:"100vh", fontFamily:"Nunito Sans, sans-serif",
          color:"var(--fg-2)", gap: 16, padding: 40, textAlign:"center",
        }
      },
        React.createElement("span", {className:"material-symbols-outlined", style:{fontSize:48, color:"var(--red)"}}, "error"),
        React.createElement("h2", {style:{color:"var(--fg-1)", margin:0}}, "Failed to load data"),
        React.createElement("p", {style:{maxWidth:500}}, window.PORTAL._error),
        React.createElement("p", {style:{fontSize:13, color:"var(--fg-3)"}}, "Make sure server.py is running on localhost:5001 and Snowflake SSO auth completed."),
        React.createElement("button", {
          onClick: () => location.reload(),
          style:{padding:"8px 20px", borderRadius:6, border:"1px solid var(--line-2)", background:"var(--card-2)", color:"var(--fg-1)", cursor:"pointer"}
        }, "Retry")
      )
    );
  } else {
    root.render(React.createElement(App));
  }
});
