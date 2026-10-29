/* senior.jsx — Senior Manager views (manages other managers). Roll-up Home,
   Managers comparison, and Performance-by-manager. IIFE-wrapped to avoid the
   top-level `const {useState}` collision. Reuses window globals (MI, Empty,
   Avatar, StatusChip, HsChip, fmtDate, P). */
(function () {
  const { useState, useEffect } = React;
  const MI = window.MI, Empty = window.Empty, Avatar = window.Avatar;
  const StatusChip = window.StatusChip, HsChip = window.HsChip;
  const fmtDate = window.fmtDate || ((d) => d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—");
  const money = (n) => "$" + Math.round(n || 0).toLocaleString();
  const first = (nm) => (nm || "").split(" ")[0];

  // Shared /api/manager-stats fetch (cached for the session).
  let _statsCache = null;
  function useManagerStats() {
    const [stats, setStats] = useState(_statsCache);
    useEffect(() => {
      if (_statsCache) return;
      fetch("/api/manager-stats").then(r => r.json()).then(d => { _statsCache = d; setStats(d); }).catch(() => setStats({ managers: [], totals: {} }));
    }, []);
    return stats;
  }

  // ── This-week go-lives + transitions across all teams, for the WeekDay grid ──
  const sameDay = (d1, d2) => { if (!d1) return false; const a = new Date(d1), b = new Date(d2); return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); };

  // ── Per-IC rollup from the account list (client-side) ──
  function rollupByIc(accounts) {
    const today = P.now;
    const m = {};
    accounts.forEach(a => {
      const ic = a.ic || "(unassigned)";
      const r = m[ic] = m[ic] || { ic, manager: a.manager || "", active: 0, byStatus: {}, compliance: 0, escalationRisk: 0 };
      r.active++;
      r.byStatus[a.status] = (r.byStatus[a.status] || 0) + 1;
      let iss = 0;
      if (a.hs == null && a.status !== "Pre-Implementation") iss++;
      if (a.hs != null && !a.hsComment) iss++;
      if (a.hsLastUpdated && P.ageDays(a.hsLastUpdated) > 14) iss++;
      if (a.pgl && new Date(a.pgl) < today && a.status !== "Live" && a.status !== "Hold") iss++;
      if (a.antTransitionDate && new Date(a.antTransitionDate) < today && !a.transitioned && a.status !== "Hold") iss++;
      r.compliance += iss;
      if (a.hs != null && a.hs <= 3) r.escalationRisk++;
    });
    return m;
  }

  function Tile({ icon, label, value, sub, color, onClick }) {
    return (
      <div className="card card-pad" onClick={onClick} style={{ flex: 1, minWidth: 180, cursor: onClick ? "pointer" : "default" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, fontWeight: 800, letterSpacing: ".4px", textTransform: "uppercase", color: "var(--fg-3)" }}>
          <MI style={{ fontSize: 16, color: color || "var(--accent)" }}>{icon}</MI>{label}</div>
        <div style={{ fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 34, letterSpacing: "-1px", marginTop: 6 }}>{value}</div>
        {sub && <div style={{ fontSize: 12, color: "var(--fg-3)", fontWeight: 600 }}>{sub}</div>}
      </div>
    );
  }

  // ════════════════════ SENIOR HOME ════════════════════
  function SeniorHome({ accounts, onOpen, goTo, goToManager, goToCompliance }) {
    const stats = useManagerStats();
    const t = (stats && stats.totals) || {};
    const mgrs = (stats && stats.managers) || [];
    const WeekDay = window.WeekDay;
    const [weekFilter, setWeekFilter] = useState("all");
    // Mon-Fri columns, matching the manager Home grid
    const days = []; for (let i = 0; i < 5; i++) { const d = new Date(P.monday); d.setDate(d.getDate() + i); days.push(d); }
    const todayIdx = days.findIndex(d => sameDay(d, P.now));
    const golives = accounts.filter(a => a.pgl && a.status !== "Live" && a.status !== "Hold");
    const weekTransitions = accounts.filter(a => !a.transitioned && a.status !== "Hold");

    return (
      <div className="view-enter">
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 18 }}>
          <Tile icon="inventory_2" label="Active accounts" value={t.active != null ? t.active : "…"} sub={`${t.managers || 0} managers · ${t.ics || 0} ICs`} />
          <Tile icon="rocket_launch" label="Activations · this month" value={t.actLogos != null ? t.actLogos : "…"} sub={money(t.actDollars)} color="var(--green)" />
          <Tile icon="swap_horiz" label="Transitions · this month" value={t.trLogos != null ? t.trLogos : "…"} sub={money(t.trDollars)} color="var(--sky)" />
          <Tile icon="rule" label="Compliance issues" value={t.compliance != null ? t.compliance : "…"} sub="across all teams" color="var(--red)" onClick={() => goToCompliance && goToCompliance()} />
        </div>

        {t.compliance > 0 && (
          <div className="card card-pad" style={{ marginBottom: 18, background: "var(--tint-red-10)", borderColor: "var(--tint-red-25)", display: "flex", alignItems: "center", gap: 11, flexWrap: "wrap" }}>
            <MI style={{ fontSize: 20, color: "var(--red)" }}>rule</MI>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{t.compliance} compliance issues across {t.managers} teams</span>
            <span style={{ flex: 1 }} />
            <button className="btn btn-sm" onClick={() => goToCompliance && goToCompliance()}><MI style={{ fontSize: 15 }}>arrow_forward</MI>Review</button>
          </div>
        )}

        {/* Team overview */}
        <div style={{ fontSize: 14, fontWeight: 800, margin: "4px 2px 10px" }}>Team Overview</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14, marginBottom: 22 }}>
          {mgrs.map(m => (
            <div key={m.manager} className="card card-pad" onClick={() => goToManager(m.manager)} style={{ cursor: "pointer" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <Avatar name={m.manager} size={34} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{m.manager}</div>
                  <div style={{ fontSize: 11.5, color: "var(--fg-3)", fontWeight: 600 }}>{m.icCount} ICs · {m.active} active accounts</div>
                </div>
                <MI style={{ color: "var(--fg-4)" }}>chevron_right</MI>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span className="chip" style={{ background: "var(--soft)", borderColor: "transparent" }}><MI style={{ fontSize: 13, color: "var(--green)" }}>rocket_launch</MI>{m.actLogos} live this mo</span>
                <span className="chip" style={{ background: "var(--soft)", borderColor: "transparent" }}><MI style={{ fontSize: 13, color: "var(--sky)" }}>schedule</MI>{m.avgCycleTime != null ? m.avgCycleTime + "w cycle" : "—"}</span>
                <span className="chip" style={{ color: m.compliance ? "var(--red)" : "var(--green)", borderColor: "transparent", background: m.compliance ? "var(--tint-red-10)" : "var(--soft)" }}>
                  <MI style={{ fontSize: 13 }}>rule</MI>{m.compliance} issues</span>
              </div>
            </div>
          ))}
        </div>

        {/* Week ahead across teams — same calendar grid as the manager Home */}
        <div style={{ display:"flex", alignItems:"center", marginBottom:14, flexWrap:"wrap", gap:8 }}>
          <div className="section-title" style={{ margin:0 }}><MI>calendar_month</MI>The Week Ahead</div>
          <span className="count-note" style={{ marginLeft:4 }}>across all teams · week of {fmtDate(P.monday)}</span>
          <span className="spacer" />
          <div className="week-toggles">
            {[["all","All",null],["golives","Go-Lives","var(--green)"],["transitions","Transitions","var(--blue)"]].map(([k,l,c]) => {
              const on = weekFilter===k;
              return <button key={k} className={"wt-btn"+(on?" on":"")}
                style={ c ? { background: on?c:"var(--card-2)", color: on?"#fff":"var(--fg-2)", borderColor: on?c:"var(--line-2)" }
                          : { background: on?"var(--accent)":"var(--card-2)", color: on?"#fff":"var(--fg-2)", borderColor: on?"var(--accent)":"var(--line-2)" } }
                onClick={()=>setWeekFilter(k)}>
                {c && <span className="wt-dot" style={{ background: on?"#fff":c }} />}{l}
              </button>;
            })}
          </div>
        </div>
        <div className="weekgrid" style={{ marginBottom:8 }}>
          {days.map((d, i) => {
            const gl = (weekFilter==="all"||weekFilter==="golives") ? golives.filter(a => sameDay(a.pgl, d)) : [];
            const tr = (weekFilter==="all"||weekFilter==="transitions") ? weekTransitions.filter(a => sameDay(a.antTransitionDate, d) || sameDay(a.transitionDate, d)) : [];
            const events = [
              ...gl.map(a => ({ kind:"golive", id:"gl-"+a.id, color:"var(--green)", icon:"rocket_launch", name:a.tenant, onClick:()=>onOpen(a) })),
              ...tr.map(a => ({ kind:"transition", id:"tr-"+a.id, color:"var(--blue)", icon:"swap_horiz", name:a.tenant, statusLabel:a.successTransitionStatus||"", onClick:()=>onOpen(a) })),
            ];
            return <WeekDay key={i} d={d} today={i===todayIdx} events={events} />;
          })}
        </div>
      </div>
    );
  }

  // ════════════════════ CROSS-MANAGER OVERVIEW (Home header) ════════════════════
  // Rendered ABOVE the standard manager Home for senior managers, so she gets
  // every manager-Home card (escalations, follow-ups, shared tasks, week ahead)
  // plus this team-level rollup. Per-manager cards link into the Managers view.
  function SeniorManagerOverview({ goToManager, goToCompliance }) {
    const stats = useManagerStats();
    const t = (stats && stats.totals) || {};
    const mgrs = (stats && stats.managers) || [];
    if (!stats) return <div style={{ padding: "4px 2px 18px", color: "var(--fg-3)", fontSize: 13 }}>Loading team rollup…</div>;
    return (
      <div style={{ marginBottom: 22 }}>
        {t.compliance > 0 && (
          <div className="card card-pad" style={{ marginBottom: 16, background: "var(--tint-red-10)", borderColor: "var(--tint-red-25)", display: "flex", alignItems: "center", gap: 11, flexWrap: "wrap" }}>
            <MI style={{ fontSize: 20, color: "var(--red)" }}>rule</MI>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{t.compliance} compliance issues across {t.managers} teams</span>
            <span style={{ flex: 1 }} />
            <button className="btn btn-sm" onClick={() => goToCompliance && goToCompliance()}><MI style={{ fontSize: 15 }}>arrow_forward</MI>Review</button>
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "2px 2px 12px", flexWrap: "wrap" }}>
          <span style={{ fontSize: 14, fontWeight: 800 }}>Manager Overview</span>
          <span style={{ fontSize: 12, color: "var(--fg-3)", fontWeight: 600 }}>{t.managers || 0} managers · {t.ics || 0} ICs · {t.active != null ? t.active : "…"} active accounts</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
          {mgrs.map(m => (
            <div key={m.manager} className="card card-pad" onClick={() => goToManager && goToManager(m.manager)} style={{ cursor: "pointer" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <Avatar name={m.manager} size={34} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{m.manager}</div>
                  <div style={{ fontSize: 11.5, color: "var(--fg-3)", fontWeight: 600 }}>{m.icCount} ICs · {m.active} active accounts</div>
                </div>
                <MI style={{ color: "var(--fg-4)" }}>chevron_right</MI>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span className="chip" style={{ background: "var(--soft)", borderColor: "transparent" }}><MI style={{ fontSize: 13, color: "var(--green)" }}>rocket_launch</MI>{m.actLogos} live this mo</span>
                <span className="chip" style={{ background: "var(--soft)", borderColor: "transparent" }}><MI style={{ fontSize: 13, color: "var(--sky)" }}>schedule</MI>{m.avgCycleTime != null ? m.avgCycleTime + "w cycle" : "—"}</span>
                <span className="chip" style={{ color: m.compliance ? "var(--red)" : "var(--green)", borderColor: "transparent", background: m.compliance ? "var(--tint-red-10)" : "var(--soft)" }}>
                  <MI style={{ fontSize: 13 }}>rule</MI>{m.compliance} issues</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ════════════════════ MANAGERS COMPARISON ════════════════════
  function ManagersView({ accounts, onOpen, focus }) {
    const stats = useManagerStats();
    const [openMgr, setOpenMgr] = useState(focus || null);
    const [openIc, setOpenIc] = useState(null);
    if (!stats) return <div style={{ padding: 24, color: "var(--fg-3)" }}>Loading…</div>;
    const mgrs = stats.managers || [];
    const icRollup = rollupByIc(accounts);

    const Num = ({ v, c }) => <td style={{ textAlign: "right", fontWeight: 600, color: c || "var(--fg-1)" }}>{v}</td>;

    return (
      <div className="view-enter">
        <div className="tbl-wrap">
          <table className="tbl tbl-compact">
            <thead><tr>
              <th>Manager</th><th style={{ textAlign: "right" }}>ICs</th><th style={{ textAlign: "right" }}>Active</th>
              <th style={{ textAlign: "right" }}>Impl</th><th style={{ textAlign: "right" }}>Live</th><th style={{ textAlign: "right" }}>Pre</th>
              <th style={{ textAlign: "right" }}>Activations</th><th style={{ textAlign: "right" }}>Transitions</th>
              <th style={{ textAlign: "right" }}>Cycle</th><th style={{ textAlign: "right" }}>Compliance</th><th style={{ textAlign: "right" }}>At risk</th>
            </tr></thead>
            <tbody>
              {mgrs.map(m => {
                const expanded = openMgr === m.manager;
                const ics = Object.values(icRollup).filter(r => r.manager === m.manager).sort((a, b) => b.active - a.active);
                return (
                  <React.Fragment key={m.manager}>
                    <tr onClick={() => { setOpenMgr(expanded ? null : m.manager); setOpenIc(null); }} style={{ cursor: "pointer", fontWeight: 700, background: expanded ? "var(--soft)" : "transparent" }}>
                      <td><span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><MI style={{ fontSize: 16, color: "var(--fg-4)" }}>{expanded ? "expand_more" : "chevron_right"}</MI><Avatar name={m.manager} size={22} />{m.manager}</span></td>
                      <Num v={m.icCount} /><Num v={m.active} /><Num v={m.implementation} /><Num v={m.live} /><Num v={m.preImpl} />
                      <Num v={`${m.actLogos} · ${money(m.actDollars)}`} c="var(--green)" />
                      <Num v={`${m.trLogos} · ${money(m.trDollars)}`} c="var(--sky)" />
                      <Num v={m.avgCycleTime != null ? m.avgCycleTime + "w" : "—"} />
                      <Num v={m.compliance} c={m.compliance ? "var(--red)" : "var(--fg-3)"} />
                      <Num v={m.escalationRisk} c={m.escalationRisk ? "var(--red)" : "var(--fg-3)"} />
                    </tr>
                    {expanded && ics.map(r => {
                      const icOpen = openIc === r.ic;
                      const icAccts = accounts.filter(a => a.ic === r.ic).sort((a, b) => (a.hs ?? 99) - (b.hs ?? 99));
                      return (
                        <React.Fragment key={r.ic}>
                          <tr onClick={() => setOpenIc(icOpen ? null : r.ic)} style={{ cursor: "pointer", background: "var(--card-2)" }}>
                            <td style={{ paddingLeft: 30 }}><span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5 }}><MI style={{ fontSize: 14, color: "var(--fg-4)" }}>{icOpen ? "expand_more" : "chevron_right"}</MI><Avatar name={r.ic} size={18} />{r.ic}</span></td>
                            <Num v="" /><Num v={r.active} /><Num v={r.byStatus["Implementation"] || 0} /><Num v={r.byStatus["Live"] || 0} /><Num v={r.byStatus["Pre-Implementation"] || 0} />
                            <Num v="" /><Num v="" /><Num v="" />
                            <Num v={r.compliance} c={r.compliance ? "var(--red)" : "var(--fg-3)"} /><Num v={r.escalationRisk} c={r.escalationRisk ? "var(--red)" : "var(--fg-3)"} />
                          </tr>
                          {icOpen && icAccts.map(a => (
                            <tr key={a.id} onClick={() => onOpen(a)} style={{ cursor: "pointer" }}>
                              <td colSpan={11} style={{ paddingLeft: 56 }}>
                                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                                  {a.hs != null ? <HsChip hs={a.hs} mini /> : <span style={{ width: 4 }} />}
                                  <span className="acct-name" style={{ fontSize: 13 }}>{a.tenant}</span>
                                  <StatusChip status={a.status} />
                                  <span style={{ fontSize: 11.5, color: "var(--fg-3)" }}>{a.pgl ? "GL " + fmtDate(a.pgl) : ""}</span>
                                </span>
                              </td>
                            </tr>
                          ))}
                        </React.Fragment>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11.5, color: "var(--fg-4)", marginTop: 10 }}>Click a manager to see their ICs, then an IC to see their accounts.</div>
      </div>
    );
  }

  // ════════════════════ SENIOR PERFORMANCE ════════════════════
  // Manager comparison built from /api/ic-stats (per-IC for the full team),
  // aggregated up to manager using each IC's manager from P.team.
  function SeniorPerformance({ accounts }) {
    const [period, setPeriod] = useState(() => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); });
    const [data, setData] = useState(null);
    const [openMgr, setOpenMgr] = useState(null);
    useEffect(() => { setData(null); fetch("/api/ic-stats?period=" + period).then(r => r.json()).then(setData).catch(() => setData({ ics: [] })); }, [period]);
    const icMgr = {}; (P.team || []).forEach(t => { icMgr[t.name] = t.manager || ""; });

    const months = [];
    { const now = new Date(); for (let i = 0; i < 12; i++) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0")); } }

    const ics = (data && data.stats) || [];
    // group ICs by manager + aggregate (cycle time + CSAT weighted by count)
    const groups = {};
    ics.forEach(ic => {
      const mgr = icMgr[ic.ic] || "(unassigned)";
      const g = groups[mgr] = groups[mgr] || { manager: mgr, ics: [], actLogos: 0, actDollars: 0, trLogos: 0, trDollars: 0, ctSum: 0, ctN: 0, csatSum: 0, csatN: 0 };
      g.ics.push(ic);
      g.actLogos += (ic.activations && ic.activations.logos) || 0; g.actDollars += (ic.activations && ic.activations.dollars) || 0;
      g.trLogos += (ic.transitions && ic.transitions.logos) || 0; g.trDollars += (ic.transitions && ic.transitions.dollars) || 0;
      const ct = ic.cycleTime || {}; if (ct.count) { g.ctSum += ct.avgDays * ct.count; g.ctN += ct.count; }
      const cs = ic.csat || {}; if (cs.count && cs.avg != null) { g.csatSum += cs.avg * cs.count; g.csatN += cs.count; }
    });
    const rows = Object.values(groups).sort((a, b) => b.actDollars - a.actDollars);
    const wk = (days) => (days / 7).toFixed(1) + "w";

    const Num = ({ v, c }) => <td style={{ textAlign: "right", fontWeight: 600, color: c || "var(--fg-1)" }}>{v}</td>;
    return (
      <div className="view-enter">
        <div className="toolbar">
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--fg-3)" }}>Period</span>
          <select className="select-sm" value={period} onChange={e => setPeriod(e.target.value)}>
            {months.map(m => <option key={m} value={m}>{new Date(m + "-01T12:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" })}</option>)}
          </select>
        </div>
        {!data ? <div style={{ padding: 24, color: "var(--fg-3)" }}>Loading…</div> : rows.length === 0 ? <Empty icon="leaderboard" title="No performance data for this period" /> : (
          <div className="tbl-wrap">
            <table className="tbl tbl-compact">
              <thead><tr>
                <th>Manager</th><th style={{ textAlign: "right" }}>Activations</th><th style={{ textAlign: "right" }}>Transitions</th>
                <th style={{ textAlign: "right" }}>Avg cycle</th><th style={{ textAlign: "right" }}>Avg CSAT</th>
              </tr></thead>
              <tbody>
                {rows.map(g => {
                  const expanded = openMgr === g.manager;
                  return (
                    <React.Fragment key={g.manager}>
                      <tr onClick={() => setOpenMgr(expanded ? null : g.manager)} style={{ cursor: "pointer", fontWeight: 700, background: expanded ? "var(--soft)" : "transparent" }}>
                        <td><span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}><MI style={{ fontSize: 16, color: "var(--fg-4)" }}>{expanded ? "expand_more" : "chevron_right"}</MI><Avatar name={g.manager} size={22} />{g.manager}</span></td>
                        <Num v={`${g.actLogos} · ${money(g.actDollars)}`} c="var(--green)" />
                        <Num v={`${g.trLogos} · ${money(g.trDollars)}`} c="var(--sky)" />
                        <Num v={g.ctN ? wk(g.ctSum / g.ctN) : "—"} />
                        <Num v={g.csatN ? (g.csatSum / g.csatN).toFixed(1) : "—"} />
                      </tr>
                      {expanded && g.ics.slice().sort((a, b) => ((b.activations && b.activations.dollars) || 0) - ((a.activations && a.activations.dollars) || 0)).map(ic => (
                        <tr key={ic.ic} style={{ background: "var(--card-2)" }}>
                          <td style={{ paddingLeft: 30 }}><span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5 }}><Avatar name={ic.ic} size={18} />{ic.ic}</span></td>
                          <Num v={`${(ic.activations && ic.activations.logos) || 0} · ${money(ic.activations && ic.activations.dollars)}`} />
                          <Num v={`${(ic.transitions && ic.transitions.logos) || 0} · ${money(ic.transitions && ic.transitions.dollars)}`} />
                          <Num v={ic.cycleTime && ic.cycleTime.count ? wk(ic.cycleTime.avgDays) : "—"} />
                          <Num v={ic.csat && ic.csat.avg != null ? ic.csat.avg.toFixed(1) : "—"} />
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div style={{ fontSize: 11.5, color: "var(--fg-4)", marginTop: 10 }}>Click a manager to expand their IC-level performance.</div>
      </div>
    );
  }

  Object.assign(window, { SeniorHome, SeniorManagerOverview, ManagersView, SeniorPerformance });
})();
