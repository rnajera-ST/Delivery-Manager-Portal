/* lead-week.jsx — "My Week Ahead" for the Lead IC role (design pass), wired to the
   real account book (P.accounts for a lead = their my-accounts.json, any status)
   and persisting rescue classification + task dates via the backend. IIFE-wrapped
   so its React hook aliases don't collide with the other scripts. */
(function () {
  const { useState } = React;

  /* week math (this Mon–Fri) */
  const WK_MON = (() => { const d = new Date(); const off = (d.getDay() + 6) % 7; d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - off); return d; })();
  const WK_DAYS = [0, 1, 2, 3, 4].map((i) => { const d = new Date(WK_MON); d.setDate(d.getDate() + i); return d; });
  const WK_FRI_END = (() => { const d = new Date(WK_DAYS[4]); d.setHours(23, 59, 59, 999); return d; })();
  const TODAY_IDX = Math.floor((new Date() - WK_MON) / 86400000);
  const sameDay = (a, b) => { const x = new Date(a); return x.getFullYear() === b.getFullYear() && x.getMonth() === b.getMonth() && x.getDate() === b.getDate(); };
  const inWeek = (d) => { if (!d) return false; const x = new Date(d); return x >= WK_MON && x <= WK_FRI_END; };

  const statusColor = (s) => (P.STATUS[s] && P.STATUS[s].c) || "var(--fg-3)";
  const toBook = (accounts) => accounts.map((a) => ({
    id: a.id, tenant: a.tenant, status: a.status, sc: statusColor(a.status),
    rescue: !!a.rescue, leadStage: a.leadStage || null, leadRescueStart: a.leadRescueStart || null,
    leadGoLive: a.leadGoLive || null, leadTransition: a.leadTransition || null, leadEndDate: a.leadEndDate || null,
    sfdcGoLive: a.pgl || null, sfdcTransition: a.antTransitionDate || null,
    tasks: (a.actionItems || []).map((t) => ({ id: t.id, text: t.text, due: t.due || null, remind: t.remind || null, done: !!t.done })),
  }));

  const rescueIncomplete = (a) => {
    if (!a.rescue) return false;
    if (!a.leadStage) return true;
    if (a.leadStage === "Implementation") return !a.leadGoLive || !a.leadTransition;
    if (a.leadStage === "Success") return !a.leadEndDate;
    return !a.leadTransition;
  };

  const post = (url, body) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());

  function LeadWeekAhead({ accounts }) {
    const [book, setBook] = useState(() => toBook(accounts || []));
    const [calView, setCalView] = useState("week");   // "week" | "month"
    const [monthAnchor, setMonthAnchor] = useState(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1); });
    const patch = (id, p) => {
      setBook((prev) => prev.map((a) => a.id === id ? { ...a, ...p } : a));
      post("/api/my-accounts/classify", Object.assign({ accountId: id }, p));
    };
    const setTaskDate = (aid, tid, field, val) => {
      setBook((prev) => prev.map((a) => a.id === aid ? { ...a, tasks: a.tasks.map((t) => t.id === tid ? { ...t, [field]: val } : t) } : a));
      post("/api/tasks/update", { accountId: aid, taskId: tid, [field]: val });
    };
    const toggleTask = (aid, tid) => {
      let nd;
      setBook((prev) => prev.map((a) => a.id === aid ? { ...a, tasks: a.tasks.map((t) => { if (t.id === tid) { nd = !t.done; return { ...t, done: nd }; } return t; }) } : a));
      const cur = (book.find((a) => a.id === aid) || { tasks: [] }).tasks.find((t) => t.id === tid);
      post("/api/tasks/update", { accountId: aid, taskId: tid, done: cur ? !cur.done : true });
    };

    const effGoLive = (a) => a.rescue
      ? (a.leadStage === "Implementation" ? a.leadGoLive : null)
      : ((a.status === "Pre-Implementation" || a.status === "Implementation") ? a.sfdcGoLive : null);
    const effTrans = (a) => a.rescue
      ? (a.leadStage ? a.leadTransition : null)
      : ((a.status === "Live" && a.sfdcTransition && new Date(a.sfdcTransition) >= WK_MON) ? a.sfdcTransition : null);

    const events = [];
    book.forEach((a) => {
      const gl = effGoLive(a); if (gl && inWeek(gl)) events.push({ kind: "golive", date: gl, a, leadSet: a.rescue });
      const tr = effTrans(a); if (tr && inWeek(tr)) events.push({ kind: "transition", date: tr, a, leadSet: a.rescue });
      a.tasks.forEach((t) => {
        if (!t.done && t.due && inWeek(t.due)) events.push({ kind: "task", date: t.due, a, t });
        if (!t.done && t.remind && inWeek(t.remind)) events.push({ kind: "remind", date: t.remind, a, t });
      });
    });
    // Month-grid events for any day (MonthGrid shape), not week-bounded.
    const monthDayEvents = (d) => {
      const out = [];
      book.forEach((a) => {
        const gl = effGoLive(a); if (gl && sameDay(gl, d)) out.push({ kind: "golive", id: "gl-" + a.id, color: "var(--green)", icon: "rocket_launch", name: a.tenant });
        const tr = effTrans(a); if (tr && sameDay(tr, d)) out.push({ kind: "transition", id: "tr-" + a.id, color: "var(--sky)", icon: "swap_horiz", name: a.tenant, statusLabel: a.status });
        a.tasks.forEach((t) => {
          if (!t.done && t.due && sameDay(t.due, d)) out.push({ kind: "task", id: "task-" + t.id, color: "var(--yellow)", icon: "task_alt", name: t.text });
          if (!t.done && t.remind && sameDay(t.remind, d)) out.push({ kind: "remind", id: "rem-" + t.id, color: "var(--sky)", icon: "notifications", name: t.text });
        });
      });
      return out;
    };

    const glCount = events.filter((e) => e.kind === "golive").length;
    const trCount = events.filter((e) => e.kind === "transition").length;
    const taskCount = events.filter((e) => e.kind === "task").length;
    const rescues = book.filter((a) => a.rescue);
    const toSetUp = rescues.filter(rescueIncomplete).length;
    const openTasks = [];
    book.forEach((a) => a.tasks.forEach((t) => { if (!t.done) openTasks.push({ a, t }); }));
    openTasks.sort((x, y) => (new Date(x.t.due || "2999") - new Date(y.t.due || "2999")));

    const SourceTag = ({ leadSet }) => (
      <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: ".3px", padding: "0px 5px", borderRadius: 4, marginLeft: "auto",
        color: leadSet ? "var(--purple)" : "var(--fg-4)", background: leadSet ? "color-mix(in srgb, var(--purple) 18%, transparent)" : "var(--soft-2)" }}>
        {leadSet ? "LEAD SET" : "SFDC"}</span>
    );
    const EvChip = ({ e }) => {
      const cfg = e.kind === "golive" ? { bg: "rgba(52,201,123,.1)", bd: "var(--green)", c: "var(--green)", i: "rocket_launch", t: "Go-Live" }
        : e.kind === "transition" ? { bg: "rgba(34,112,238,.1)", bd: "var(--blue)", c: "var(--sky)", i: "swap_horiz", t: "Transition" }
        : e.kind === "task" ? { bg: "rgba(245,193,67,.1)", bd: "var(--yellow)", c: "var(--yellow)", i: "task_alt", t: "Task due" }
        : { bg: "rgba(109,186,248,.1)", bd: "var(--sky)", c: "var(--sky)", i: "notifications", t: "Reminder" };
      return (
        <div style={{ background: cfg.bg, border: "1px solid " + cfg.bd, borderLeftWidth: 3, borderRadius: 7, padding: "6px 8px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".3px", color: cfg.c }}>
            <span className="mi" style={{ fontSize: 13 }}>{cfg.i}</span>{cfg.t}{(e.kind === "golive" || e.kind === "transition") && <SourceTag leadSet={e.leadSet} />}
          </div>
          <div style={{ fontWeight: 700, fontSize: 11.5, marginTop: 3, lineHeight: 1.25, color: "var(--fg-1)" }}>{(e.kind === "task" || e.kind === "remind") ? e.t.text : e.a.tenant}</div>
          {(e.kind === "task" || e.kind === "remind") && <div style={{ fontSize: 10.5, color: "var(--fg-3)", fontWeight: 700, marginTop: 2 }}>{e.a.tenant}</div>}
        </div>
      );
    };
    const Stat = ({ icon, c, n, l }) => (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 11px", borderRadius: "var(--r-pill)", background: "var(--card)", border: "1px solid var(--line)" }}>
        <span className="mi" style={{ fontSize: 16, color: c }}>{icon}</span>
        <span style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 15, color: c }}>{n}</span>
        <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--fg-3)" }}>{l}</span>
      </span>
    );

    return (
      <div className="view-enter">
        <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap", alignItems: "center" }}>
          <Stat icon="rocket_launch" c="var(--green)" n={glCount} l="go-lives" />
          <Stat icon="swap_horiz" c="var(--sky)" n={trCount} l="transitions" />
          <Stat icon="task_alt" c="var(--yellow)" n={taskCount} l="tasks due" />
          {toSetUp > 0 && <Stat icon="healing" c="var(--red)" n={toSetUp} l="rescues to set up" />}
          <span style={{ flex: 1 }} />
          <div className="seg">
            <button className={calView === "week" ? "on" : ""} onClick={() => setCalView("week")}>Week</button>
            <button className={calView === "month" ? "on" : ""} onClick={() => setCalView("month")}>Month</button>
          </div>
        </div>

        {calView === "month" ? (
          <div style={{ marginBottom: 22 }}>
            <window.MonthGrid anchor={monthAnchor} setAnchor={setMonthAnchor} dayEvents={monthDayEvents} />
          </div>
        ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 8, marginBottom: 22 }}>
          {WK_DAYS.map((d, i) => {
            const dayEv = events.filter((e) => sameDay(e.date, d));
            return (
              <div key={i} style={{ background: "var(--card)", border: "1px solid " + (i === TODAY_IDX ? "var(--tint-blue-30)" : "var(--line)"), borderRadius: 10, overflow: "hidden", minHeight: 150 }}>
                <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--line)", background: i === TODAY_IDX ? "var(--tint-blue-08)" : "transparent" }}>
                  <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".5px", color: i === TODAY_IDX ? "var(--sky)" : "var(--fg-3)" }}>{d.toLocaleDateString("en-US", { weekday: "short" })}{i === TODAY_IDX ? " · Today" : ""}</div>
                  <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 16, color: i === TODAY_IDX ? "var(--sky)" : "var(--fg-1)" }}>{d.getDate()}</div>
                </div>
                <div style={{ padding: 7, display: "flex", flexDirection: "column", gap: 6 }}>
                  {dayEv.length === 0 && <div style={{ fontSize: 11, color: "var(--fg-4)", fontWeight: 600, padding: "4px 2px" }}>—</div>}
                  {dayEv.map((e, k) => <EvChip key={k} e={e} />)}
                </div>
              </div>
            );
          })}
        </div>
        )}

        <div className="grid-2" style={{ alignItems: "start" }}>
          <div className="card">
            <div className="card-hd"><MI style={{ color: "var(--sky)" }}>checklist</MI><h3>My open tasks</h3><span className="spacer" /><span style={{ fontSize: 11, fontWeight: 800, color: "var(--fg-3)" }}>{openTasks.length}</span></div>
            <div style={{ padding: "4px 16px 12px" }}>
              {openTasks.length === 0 && <div style={{ padding: 16, fontSize: 12.5, color: "var(--fg-4)" }}>No open tasks.</div>}
              {openTasks.map(({ a, t }) => (
                <div key={t.id} className="ai-row" style={{ alignItems: "flex-start" }}>
                  <span className={"chk" + (t.done ? " on" : "")} onClick={() => toggleTask(a.id, t.id)} style={{ marginTop: 1 }}>{t.done && <MI>check</MI>}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{t.text}</div>
                    <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--fg-3)", margin: "3px 0 5px", display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: a.sc, display: "inline-block" }} />{a.tenant}</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      <DateBit icon="event" label="Due" value={t.due} onChange={(v) => setTaskDate(a.id, t.id, "due", v)} />
                      <DateBit icon="notifications" label="Remind" value={t.remind} onChange={(v) => setTaskDate(a.id, t.id, "remind", v)} color="var(--sky)" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-hd"><MI style={{ color: "var(--purple)" }}>healing</MI><h3>Rescue accounts</h3><span className="spacer" /><span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--fg-3)" }}>Lead-set milestones</span></div>
            <div style={{ padding: "4px 16px 14px" }}>
              {rescues.length === 0 && <div style={{ padding: 14, fontSize: 12.5, color: "var(--fg-4)" }}>No rescue accounts in your pipeline.</div>}
              {rescues.map((a) => <RescueRow key={a.id} a={a} patch={patch} />)}
            </div>
          </div>
        </div>
      </div>
    );
  }

  function RescueRow({ a, patch }) {
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(a.leadStage);
    const save = () => {
      if (!draft) return;
      const p = { leadStage: draft };
      if (draft === "Live") p.leadGoLive = null;
      if (draft === "Success") { p.leadGoLive = null; p.leadTransition = null; }
      patch(a.id, p);
      setEditing(false); showToast(a.tenant + " saved, treated as " + draft);
    };
    const Seg = ({ id, label }) => (
      <button onClick={() => setDraft(id)} style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "5px 8px",
        border: 0, borderRadius: 6, cursor: "pointer", font: "800 11px/1 var(--font-body)", background: draft === id ? "var(--accent)" : "transparent", color: draft === id ? "#fff" : "var(--fg-2)" }}>{label}</button>
    );
    const incomplete = a.rescue && (!a.leadStage || (a.leadStage === "Implementation" ? (!a.leadGoLive || !a.leadTransition) : !a.leadTransition));
    const stage = a.leadStage;
    const dur = (() => {
      if (!a.leadRescueStart) return null;
      const s = new Date(a.leadRescueStart), trDone = a.leadTransition && new Date(a.leadTransition) < new Date();
      const end = trDone ? new Date(a.leadTransition) : new Date();
      const dd = Math.max(0, Math.floor((end - s) / 86400000));
      return trDone ? "Rescue took " + dd + " days" : "Day " + dd + " of rescue";
    })();
    return (
      <div style={{ padding: "11px 0", borderBottom: "1px solid var(--line)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>{a.tenant}</span>
          <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".3px", color: "var(--purple)", background: "color-mix(in srgb, var(--purple) 16%, transparent)", padding: "1px 6px", borderRadius: "var(--r-xs)" }}>RESCUE</span>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--fg-4)" }}>came in as {a.status}</span>
          {incomplete && !editing && <span className="mi" style={{ marginLeft: "auto", fontSize: 16, color: "var(--yellow)" }} title="Needs setup">error</span>}
        </div>
        {editing ? (
          <div style={{ marginTop: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <span style={{ fontSize: 10, fontWeight: 800, color: "var(--fg-4)", textTransform: "uppercase", letterSpacing: ".5px", whiteSpace: "nowrap" }}>Treat as</span>
              <div style={{ display: "flex", gap: 3, padding: 3, flex: 1, background: "var(--card-2)", border: "1px solid var(--line-2)", borderRadius: 8 }}>
                <Seg id="Implementation" label="Implementation" /><Seg id="Live" label="Live" /><Seg id="Success" label="Success" />
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 7, marginTop: 9 }}>
              <button className="btn btn-sm btn-ghost" onClick={() => { setDraft(a.leadStage); setEditing(false); }}>Cancel</button>
              <button className="btn btn-sm btn-primary" disabled={!draft} onClick={save}><MI style={{ fontSize: 15 }}>check</MI>Save classification</button>
            </div>
          </div>
        ) : stage ? (
          <div style={{ marginTop: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 9px", borderRadius: "var(--r-pill)", background: "var(--soft)", border: "1px solid var(--line-2)", fontSize: 11, fontWeight: 800, color: "var(--fg-1)" }}>
                <span className="mi" style={{ fontSize: 14, color: stage === "Live" ? "var(--green)" : stage === "Success" ? "var(--green)" : "var(--sky)" }}>{stage === "Live" ? "bolt" : stage === "Success" ? "verified" : "build"}</span>Treated as {stage}</span>
              <button className="btn btn-sm btn-ghost" onClick={() => { setDraft(a.leadStage); setEditing(true); }} style={{ padding: "3px 9px" }}><MI style={{ fontSize: 15 }}>edit</MI>Edit</button>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 9 }}>
              <DateBit icon="flag_circle" label="Rescue start" value={a.leadRescueStart} onChange={(v) => patch(a.id, { leadRescueStart: v })} color="var(--purple)" />
              {stage === "Implementation" && <DateBit icon="rocket_launch" label="Go-live" value={a.leadGoLive} onChange={(v) => patch(a.id, { leadGoLive: v })} color="var(--green)" />}
              {stage === "Success"
                ? <DateBit icon="event_available" label="Engagement end" value={a.leadEndDate} onChange={(v) => patch(a.id, { leadEndDate: v })} color="var(--green)" />
                : <DateBit icon="swap_horiz" label="Transition" value={a.leadTransition} onChange={(v) => patch(a.id, { leadTransition: v })} color="var(--sky)" />}
            </div>
            {dur && <div style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 8, padding: "2px 9px", borderRadius: "var(--r-pill)", background: "color-mix(in srgb, var(--purple) 12%, transparent)", color: "var(--purple)", fontSize: 10.5, fontWeight: 800 }}><span className="mi" style={{ fontSize: 13 }}>timelapse</span>{dur}</div>}
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
            <span style={{ fontSize: 11, color: "var(--fg-4)", fontWeight: 600, flex: 1 }}>Not classified yet. Set how this account should be treated.</span>
            <button className="btn btn-sm btn-primary" onClick={() => { setDraft(a.leadStage); setEditing(true); }}><MI style={{ fontSize: 15 }}>tune</MI>Set up</button>
          </div>
        )}
      </div>
    );
  }

  Object.assign(window, { LeadWeekAhead });
})();
