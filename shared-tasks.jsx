/* Shared task system (Google Sheet backed).
   Exposes three globals:
     - AssignTaskForm  : compact composer with an "Assign to" dropdown
     - SharedTasksCard  : "Shared Tasks" section for the Home page (my tasks)
     - SharedTasksBoard : full team task board with filters (Tasks nav)
   All persist to the shared sheet via /api/shared-tasks*. */
(function () {
  const { useState, useEffect, useMemo, useRef } = React;
  const P = window.PORTAL;

  const PRIORITIES = ["High", "Medium", "Low"];
  const PRI = {
    High:   { c: "var(--red)",    bg: "rgba(226,79,79,.14)",  bd: "rgba(226,79,79,.42)" },
    Medium: { c: "var(--yellow)", bg: "rgba(245,193,67,.14)", bd: "rgba(245,193,67,.4)" },
    Low:    { c: "var(--fg-3)",   bg: "var(--soft)",          bd: "var(--line)" },
  };
  const isDone = (s) => ["done", "completed", "complete", "closed"].includes((s || "").toLowerCase());

  function PriBadge({ p }) {
    const m = PRI[p] || PRI.Medium;
    return <span className="chip" style={{ background: m.bg, borderColor: m.bd, color: m.c, fontSize: 10.5 }}>{p || "Medium"}</span>;
  }

  // Resolve a task's account to an in-scope account object (or null).
  const acctFor = (t) => (t.accountId && P.accounts.find(a => a.id === t.accountId)) || null;

  /* ── Assignee dropdown (known managers + ICs, grouped by role) ── */
  function AssigneeSelect({ value, onChange, style }) {
    const people = P._assignees || [];
    const groups = {};
    people.forEach(p => { (groups[p.role] = groups[p.role] || []).push(p.name); });
    const order = ["Manager", "Senior Manager", "Lead IC", "IC"];
    const roles = Object.keys(groups).sort((a, b) => order.indexOf(a) - order.indexOf(b));
    return (
      <select className="select-sm" value={value} onChange={e => onChange(e.target.value)} style={style} title="Assign to">
        <option value="">Assign to…</option>
        {roles.map(role => (
          <optgroup key={role} label={role === "IC" ? "Implementation Consultants" : role + "s"}>
            {groups[role].map(n => <option key={n} value={n}>{n}</option>)}
          </optgroup>
        ))}
      </select>
    );
  }

  /* ── Searchable account autocomplete (optional — can be left blank) ──
     value = {id, name} | null. Type 2+ chars; a 300ms-debounced request hits
     /api/accounts/search (every account, in-memory cache). Pick a row to store
     {id, name}, or "No account" to clear. */
  function AccountCombo({ value, onChange, style }) {
    const [open, setOpen] = useState(false);
    const [q, setQ] = useState(value ? value.name : "");
    const [results, setResults] = useState([]);
    const [loading, setLoading] = useState(false);
    const ref = useRef(null);
    const seq = useRef(0);

    useEffect(() => { setQ(value ? value.name : ""); }, [value ? value.id + "|" + value.name : ""]);
    useEffect(() => {
      const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
      document.addEventListener("mousedown", h);
      return () => document.removeEventListener("mousedown", h);
    }, []);

    // Debounced search: fire 300ms after typing stops, only at 2+ chars, and
    // skip if the box just shows the already-selected account.
    useEffect(() => {
      const needle = q.trim();
      if (needle.length < 2 || (value && needle === value.name)) { setResults([]); setLoading(false); return; }
      setLoading(true);
      const mine = ++seq.current;
      const t = setTimeout(() => {
        fetch("/api/accounts/search?q=" + encodeURIComponent(needle))
          .then(r => r.json())
          .then(d => { if (mine === seq.current) { setResults(d.results || []); setLoading(false); } })
          .catch(() => { if (mine === seq.current) { setResults([]); setLoading(false); } });
      }, 300);
      return () => clearTimeout(t);
    }, [q]);

    const pick = (r) => { onChange({ id: r.ACCOUNT_ID_OB, name: r.NAME_ACCOUNT }); setQ(r.NAME_ACCOUNT); setResults([]); setOpen(false); };
    const clear = () => { onChange(null); setQ(""); setResults([]); setOpen(false); };

    const showPop = open && (q.trim().length >= 2 || value);
    return (
      <div className="ms" ref={ref} style={style}>
        <input className="inp" value={q} placeholder="Account (optional)…"
          onChange={e => { setQ(e.target.value); setOpen(true); if (!e.target.value.trim()) onChange(null); }}
          onFocus={() => setOpen(true)} title="Search any account (optional)" />
        {showPop && (
          <div className="ms-pop">
            <button className="ms-opt" onClick={clear}>
              <MI style={{ fontSize: 16, color: "var(--fg-3)" }}>block</MI>
              <span style={{ flex: 1, textAlign: "left", color: "var(--fg-3)" }}>No account</span>
            </button>
            {loading && <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--fg-4)" }}>Searching…</div>}
            {!loading && q.trim().length >= 2 && results.length === 0 &&
              <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--fg-4)" }}>No matching accounts</div>}
            {results.map(r => (
              <button key={r.ACCOUNT_ID_OB} className="ms-opt" onClick={() => pick(r)}>
                <span style={{ flex: 1, textAlign: "left", minWidth: 0 }}>
                  {r.NAME_ACCOUNT}
                  {r.ONBOARDER_NAME_ACCNT && <span style={{ color: "var(--fg-4)", fontWeight: 600, marginLeft: 6, fontSize: 11.5 }}>· {r.ONBOARDER_NAME_ACCNT}</span>}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  /* ── Reusable composer: assign a shared task ──
     Props: accountId, account (name) — used as the initial (pre-filled, editable)
     account; defaultAssignee; onCreated(task). Only Assign-to + Task are required. */
  function AssignTaskForm({ accountId, account, defaultAssignee, onCreated }) {
    const [assignee, setAssignee] = useState(defaultAssignee || "");
    const [text, setText] = useState("");
    const [priority, setPriority] = useState("Medium");
    const [due, setDue] = useState("");
    const [acct, setAcct] = useState(account ? { id: accountId || "", name: account } : null);
    const [busy, setBusy] = useState(false);
    useEffect(() => { setAssignee(defaultAssignee || ""); }, [defaultAssignee]);
    useEffect(() => { setAcct(account ? { id: accountId || "", name: account } : null); }, [accountId, account]);

    const submit = () => {
      if (!assignee || !text.trim() || busy) return;
      setBusy(true);
      fetch("/api/shared-tasks/create", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignedTo: assignee, account: acct ? acct.name : "", accountId: acct ? acct.id : "", task: text.trim(), priority, dueDate: due }),
      }).then(r => r.json()).then(d => {
        setBusy(false);
        if (d && d.ok) {
          setText(""); setDue("");
          showToast("Task assigned to " + firstName(assignee) + ".");
          onCreated && onCreated(d.task);
        } else {
          showToast((d && d.error) || "Couldn't assign task.");
        }
      }).catch(() => { setBusy(false); showToast("Couldn't assign task. Try again."); });
    };

    if (!P._sharedTasksConfigured) {
      return <div className="hint" style={{ margin: 0 }}>
        <MI style={{ fontSize: 14, verticalAlign: "-2px" }}>info</MI> Shared tasks aren't set up yet — add the sheet ID in <code>server.py</code> and connect Google.
      </div>;
    }
    return (
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <AssigneeSelect value={assignee} onChange={setAssignee} style={{ minWidth: 150 }} />
        <input className="inp" style={{ flex: 1, minWidth: 180 }} value={text}
          placeholder="What needs doing?"
          onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === "Enter") submit(); }} />
        <AccountCombo value={acct} onChange={setAcct} style={{ minWidth: 170 }} />
        <input type="date" className="select-sm" value={due} onChange={e => setDue(e.target.value)} title="Due date (optional)" style={{ minWidth: 140 }} />
        <select className="select-sm" value={priority} onChange={e => setPriority(e.target.value)} title="Priority">
          {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <button className="btn btn-sm btn-primary" onClick={submit} disabled={busy || !assignee || !text.trim()}>
          <MI>{busy ? "sync" : "add_task"}</MI>{busy ? "Assigning…" : "Assign"}</button>
      </div>
    );
  }

  /* ── Due-date chip with inline edit (click to set/change) ── */
  function DueControl({ t, done, onSetDue }) {
    const [editing, setEditing] = useState(false);
    if (editing) {
      return <input type="date" className="select-sm" defaultValue={t.dueDate || ""} autoFocus
        style={{ padding: "2px 6px", fontSize: 11.5, width: 140 }}
        onChange={e => { onSetDue(t, e.target.value); setEditing(false); }}
        onBlur={() => setEditing(false)} />;
    }
    if (t.dueDate) {
      const overdue = !done && new Date(t.dueDate + "T23:59:59") < P.now;
      const today = relDay(t.dueDate) === "today";
      const c = done ? "var(--fg-4)" : overdue ? "var(--red)" : today ? "var(--yellow)" : "var(--fg-3)";
      return <span className="chip" onClick={() => onSetDue && setEditing(true)}
        style={{ cursor: onSetDue ? "pointer" : "default", fontSize: 10.5, color: c, borderColor: c, background: "var(--soft)" }}
        title="Change due date"><MI style={{ fontSize: 12 }}>event</MI>{overdue ? "Due " + relDay(t.dueDate) : relDay(t.dueDate)}</span>;
    }
    return onSetDue
      ? <button className="btn btn-sm btn-ghost" onClick={() => setEditing(true)} style={{ padding: "2px 6px", fontSize: 10.5 }} title="Set due date"><MI style={{ fontSize: 13 }}>event</MI>Due date</button>
      : null;
  }

  /* ── One task row (shared by card + board) ── */
  function TaskRow({ t, onOpen, onToggle, onSetDue, showAssignee }) {
    const done = isDone(t.status);
    const acct = acctFor(t);
    return (
      <div className="lrow" style={{ alignItems: "flex-start", padding: "10px 14px", opacity: done ? 0.62 : 1 }}>
        <span className={"chk" + (done ? " on" : "")} onClick={() => onToggle(t)} style={{ cursor: "pointer", marginTop: 1 }} title={done ? "Reopen" : "Mark complete"}>{done && <MI>check</MI>}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: done ? "var(--fg-4)" : "var(--fg-1)", textDecoration: done ? "line-through" : "none" }}>{t.task}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
            {t.account && (acct
              ? <span className="acct-name" style={{ fontSize: 11.5, cursor: "pointer", color: "var(--accent)" }} onClick={() => onOpen(acct)}>{t.account}</span>
              : <span style={{ fontSize: 11.5, color: "var(--fg-4)" }}>{t.account}</span>)}
            {showAssignee && <span style={{ fontSize: 11, color: "var(--fg-3)", fontWeight: 700, display: "inline-flex", alignItems: "center", gap: 4 }}><Avatar name={t.assignedTo} size={15} />{firstName(t.assignedTo)}</span>}
            {t.createdBy && <span style={{ fontSize: 11, color: "var(--fg-4)" }}>from {firstName(t.createdBy)}</span>}
            {done && t.completedAt && <span style={{ fontSize: 11, color: "var(--fg-4)" }}>· done {relDay(t.completedAt)}</span>}
          </div>
        </div>
        {!done && <DueControl t={t} done={done} onSetDue={onSetDue} />}
        {done && t.dueDate && <DueControl t={t} done={done} onSetDue={onSetDue} />}
        <PriBadge p={t.priority} />
      </div>
    );
  }

  /* ── Subsection label ── */
  function SectionLabel({ children, count }) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px 4px" }}>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--fg-3)" }}>{children}</span>
        {count != null && <span className="ct">{count}</span>}
      </div>
    );
  }

  /* ── Collapsible "Completed Tasks" section (collapsed by default) ── */
  function CompletedSection({ tasks, onOpen, onToggle, onSetDue, showAssignee }) {
    const [open, setOpen] = useState(false);
    if (!tasks.length) return null;
    return (
      <div style={{ borderTop: "1px solid var(--line)" }}>
        <div className="lrow" onClick={() => setOpen(o => !o)} style={{ cursor: "pointer", padding: "10px 14px" }}>
          <MI style={{ fontSize: 18, color: "var(--fg-3)" }}>{open ? "expand_more" : "chevron_right"}</MI>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--fg-3)" }}>Completed Tasks</span>
          <span className="ct">{tasks.length}</span>
        </div>
        {open && tasks.map(t => <TaskRow key={t.id} t={t} onOpen={onOpen} onToggle={onToggle} onSetDue={onSetDue} showAssignee={showAssignee} />)}
      </div>
    );
  }

  // Newest-completed first.
  const byCompleted = (a, b) => new Date(b.completedAt || 0) - new Date(a.completedAt || 0);

  /* ── Home: "Shared Tasks" section (tasks assigned to me) ── */
  function SharedTasksCard({ onOpen, goTo }) {
    const [tasks, setTasks] = useState(null);   // null = loading
    const [connected, setConnected] = useState(true);
    const load = () => fetch("/api/shared-tasks")
      .then(r => r.json())
      .then(d => { setTasks(d.tasks || []); setConnected(d.connected !== false); })
      .catch(() => { setTasks([]); setConnected(false); });
    useEffect(() => { load(); }, []);

    const toggle = (t) => {
      const next = isDone(t.status) ? "Open" : "Done";
      setTasks(ts => ts.map(x => x.id === t.id ? { ...x, status: next, completedAt: next === "Done" ? new Date().toISOString() : "" } : x));
      fetch("/api/shared-tasks/update", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: t.id, status: next }),
      }).then(r => r.json()).then(d => { if (!d || !d.ok) load(); }).catch(load);
    };
    const setDue = (t, due) => {
      setTasks(ts => ts.map(x => x.id === t.id ? { ...x, dueDate: due } : x));
      fetch("/api/shared-tasks/update", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: t.id, dueDate: due }),
      }).then(r => r.json()).then(d => { if (!d || !d.ok) load(); }).catch(load);
    };

    if (!P._sharedTasksConfigured) return null;  // hide until the sheet is wired up
    const open = (tasks || []).filter(t => !isDone(t.status));
    const done = (tasks || []).filter(t => isDone(t.status)).sort(byCompleted);

    return (
      <Card title="Shared Tasks" count={tasks == null ? "" : open.length + " open"}
        action={<button className="btn btn-sm btn-ghost" onClick={() => goTo && goTo("tasks")}>Task board <MI>arrow_forward</MI></button>}>
        {tasks == null ? <div className="empty"><MI>sync</MI><div>Loading…</div></div>
          : !connected ? <Empty icon="link_off" title="Google not connected" sub="Connect Google in Settings to see shared tasks." />
          : open.length === 0 && done.length === 0 ? <Empty icon="task_alt" title="No tasks assigned to you" sub="Tasks others assign you show up here." />
          : <>
              {open.length > 0 && <SectionLabel count={open.length}>Open Tasks</SectionLabel>}
              {open.map(t => <TaskRow key={t.id} t={t} onOpen={onOpen} onToggle={toggle} onSetDue={setDue} />)}
              {open.length === 0 && <div style={{ padding: "10px 14px", fontSize: 12.5, color: "var(--fg-3)" }}>No open tasks — nicely done.</div>}
              <CompletedSection tasks={done} onOpen={onOpen} onToggle={toggle} onSetDue={setDue} />
            </>}
      </Card>
    );
  }

  /* ── Full team task board (Tasks nav) ── */
  function SharedTasksBoard({ onOpen }) {
    const [tasks, setTasks] = useState(null);
    const [connected, setConnected] = useState(true);
    const [fAssignee, setFAssignee] = useState([]);
    const [fPriority, setFPriority] = useState(PRIORITIES.slice());
    const [acctQuery, setAcctQuery] = useState("");

    const load = () => fetch("/api/shared-tasks?scope=all")
      .then(r => r.json())
      .then(d => { setTasks(d.tasks || []); setConnected(d.connected !== false); })
      .catch(() => { setTasks([]); setConnected(false); });
    useEffect(() => { load(); }, []);

    const toggle = (t) => {
      const next = isDone(t.status) ? "Open" : "Done";
      setTasks(ts => ts.map(x => x.id === t.id ? { ...x, status: next, completedAt: next === "Done" ? new Date().toISOString() : "" } : x));
      fetch("/api/shared-tasks/update", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: t.id, status: next }),
      }).then(r => r.json()).then(d => { if (!d || !d.ok) load(); }).catch(load);
    };
    const setDue = (t, due) => {
      setTasks(ts => ts.map(x => x.id === t.id ? { ...x, dueDate: due } : x));
      fetch("/api/shared-tasks/update", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: t.id, dueDate: due }),
      }).then(r => r.json()).then(d => { if (!d || !d.ok) load(); }).catch(load);
    };

    const assignees = useMemo(() => Array.from(new Set((tasks || []).map(t => t.assignedTo).filter(Boolean))).sort(), [tasks]);
    useEffect(() => { setFAssignee(assignees.slice()); }, [assignees.length]);

    const matchesFilters = (t) => {
      if (fAssignee.length && !fAssignee.includes(t.assignedTo)) return false;
      if (fPriority.length && !fPriority.includes(t.priority || "Medium")) return false;
      if (acctQuery.trim() && !(t.account || "").toLowerCase().includes(acctQuery.trim().toLowerCase())) return false;
      return true;
    };
    const shown = (tasks || []).filter(matchesFilters);
    const rank = { High: 0, Medium: 1, Low: 2 };
    const openTasks = shown.filter(t => !isDone(t.status))
      .sort((a, b) => ((rank[a.priority] ?? 1) - (rank[b.priority] ?? 1)) || (new Date(b.createdAt || 0) - new Date(a.createdAt || 0)));
    const doneTasks = shown.filter(t => isDone(t.status)).sort(byCompleted);

    if (!P._sharedTasksConfigured) {
      return <div className="view-enter"><Card title="Shared Tasks">
        <div style={{ padding: 24 }}><Empty icon="settings" title="Shared tasks not set up"
          sub="Create the team Google Sheet, paste its ID into SHARED_TASKS_SHEET_ID in server.py, and connect Google in Settings." /></div>
      </Card></div>;
    }

    return (
      <div className="view-enter">
        <Card title="Assign a task">
          <div style={{ padding: "12px 14px" }}>
            <AssignTaskForm onCreated={(task) => setTasks(ts => [task, ...(ts || [])])} />
          </div>
        </Card>

        <div className="toolbar" style={{ marginTop: 16, flexWrap: "wrap", gap: 8 }}>
          <MultiSelect label="assignees" options={assignees} selected={fAssignee} onChange={setFAssignee} />
          <MultiSelect label="priorities" options={PRIORITIES} selected={fPriority} onChange={setFPriority} />
          <input className="inp" style={{ maxWidth: 220 }} value={acctQuery} placeholder="Filter by account…" onChange={e => setAcctQuery(e.target.value)} />
          <span className="spacer" />
          <button className="btn btn-sm btn-ghost" onClick={load} title="Reload from sheet"><MI>refresh</MI></button>
        </div>

        <div style={{ marginTop: 16 }}>
          <Card title="Tasks" count={tasks == null ? "" : openTasks.length + " open · " + doneTasks.length + " completed"}>
            {tasks == null ? <div className="empty"><MI>sync</MI><div>Loading…</div></div>
              : !connected ? <Empty icon="link_off" title="Google not connected" sub="Connect Google in Settings to load the shared task board." />
              : openTasks.length === 0 && doneTasks.length === 0 ? <Empty icon="task_alt" title="No tasks match" sub="Adjust the filters above, or assign a new task." />
              : <>
                  <SectionLabel count={openTasks.length}>Open Tasks</SectionLabel>
                  {openTasks.length === 0
                    ? <div style={{ padding: "10px 14px", fontSize: 12.5, color: "var(--fg-3)" }}>No open tasks match the filters.</div>
                    : openTasks.map(t => <TaskRow key={t.id} t={t} onOpen={onOpen} onToggle={toggle} onSetDue={setDue} showAssignee />)}
                  <CompletedSection tasks={doneTasks} onOpen={onOpen} onToggle={toggle} onSetDue={setDue} showAssignee />
                </>}
          </Card>
        </div>
      </div>
    );
  }

  Object.assign(window, { AssignTaskForm, SharedTasksCard, SharedTasksBoard });
})();
