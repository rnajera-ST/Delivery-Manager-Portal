/* Home — daily briefing / manager dashboard */
function Home({ accounts, onOpen, goTo, goToCompliance }) {
  const now = P.now, monday = P.monday;
  const inThisWeek = (d) => { if(!d) return false; const x=new Date(d); const diff=Math.floor((x-monday)/86400000); return diff>=0 && diff<=4; };
  const monthOf = (d) => d && new Date(d).getMonth()===now.getMonth() && new Date(d).getFullYear()===now.getFullYear();

  const escAccts = accounts.filter(a => a.escalation && a.escalation.open);
  const atRisk = accounts.filter(isEsc);
  const cmrrAtRisk = atRisk.reduce((s,a)=>s+a.cmrr,0);
  // Cycle time from backend (kickoff to success transition, last 6 months)
  const ctData = window._cycleTime || [];
  const avgCycleWeeks = ctData.length ? (ctData.reduce((s,c)=>s+c.days,0)/ctData.length/7) : 0;
  const avgOf = (k) => { const v = ctData.map(c=>c[k]).filter(x=>x!=null && x>=0); return v.length ? v.reduce((a,b)=>a+b,0)/v.length/7 : null; };
  const avgToLive = avgOf("liveDays");
  const avgToSuccess = avgOf("successDays");
  // activations & transitions: completed so far this month + full-month projection
  const inMonth = (d) => d && new Date(d).getMonth()===now.getMonth() && new Date(d).getFullYear()===now.getFullYear();
  // Activations/transitions completed THIS MONTH come from the status-agnostic
  // history rollup (server-side, counted by date). Deriving them from the active
  // account list undercounts badly: once an account transitions it flips to
  // "Success" status and drops out of the list, so it would never be counted
  // (same for a fast activation that transitions within the same month). Fall
  // back to the account-derived count if history isn't loaded.
  const _curTotals = (P.history && P.history[P.currentKey] && P.history[P.currentKey].total) || null;
  const actSoFar = _curTotals ? _curTotals.act : accounts.filter(a => inMonth(a.liveDate) && new Date(a.liveDate)<=now).length;
  const actUpcoming = accounts.filter(a => a.status!=="Live" && a.status!=="Hold" && inMonth(a.pgl) && new Date(a.pgl)>now).length;
  const actProjected = actSoFar + actUpcoming;
  const transSoFar = _curTotals ? _curTotals.trans : accounts.filter(a => inMonth(a.transitionDate) && new Date(a.transitionDate)<=now).length;
  const transUpcoming = accounts.filter(a => inMonth(a.transitionDate) && new Date(a.transitionDate)>now).length;
  const transProjected = transSoFar + transUpcoming;

  // Salesforce compliance gaps (chase before Monday sync).
  // Compliance applies ONLY to Implementation / Live accounts (matches Compliance view).
  const compAccts = accounts.filter(a => a.status === "Implementation" || a.status === "Live");
  const noHS = compAccts.filter(a => a.hs==null).length;
  const noComments = compAccts.filter(a => a.hs!=null && !a.hsComment).length;
  const pglOver = compAccts.filter(a => pglOverdue(a)).length;
  const transOver = compAccts.filter(a => a.antTransitionDate && new Date(a.antTransitionDate)<now && !a.transitioned && a.status!=="Hold").length;
  const staleHS = compAccts.filter(a => a.hsLastUpdated && P.ageDays(a.hsLastUpdated) > window.HS_STALE_DAYS).length;
  const antBeforePgl = compAccts.filter(a => a.antTransitionDate && a.pgl && new Date(a.antTransitionDate) < new Date(a.pgl)).length;
  const transWeekNotLive = compAccts.filter(a => a.antTransitionDate && inThisWeek(a.antTransitionDate) && a.status !== "Live" && a.status !== "Hold" && a.status !== "Success").length;
  const needsCsm = compAccts.filter(a => a.successTransitionStatus==="Needs CSM" && !a.successRep && a.transitionStatusUpdatedAt && (Date.now()-new Date(a.transitionStatusUpdatedAt))/3600000 > 24).length;
  const complianceTotal = noHS+noComments+pglOver+transOver+staleHS+antBeforePgl+transWeekNotLive+needsCsm;

  const goLives = accounts.filter(a => inThisWeek(a.pgl) && a.status!=="Live" && a.status!=="Hold");
  const weekTransitions = accounts.filter(a => (inThisWeek(a.antTransitionDate) && a.transitioned===false) || inThisWeek(a.transitionDate));
  const ko_week = (window._kickoffs || []).filter(k => { const kd=new Date(k.kickoff); const diff=Math.floor((kd-monday)/86400000); return diff>=0 && diff<=4; });
  const followUps = accounts.filter(a => a.followUpDate && Math.ceil((new Date(a.followUpDate)-now)/86400000) <= 3)
    .sort((x,y)=> new Date(x.followUpDate)-new Date(y.followUpDate));

  const days = [0,1,2,3,4].map(i => P.addDays(monday, i));
  const todayIdx = Math.floor((now - monday)/86400000);

  // Transitions stuck past the 24h SLA in a status the manager should chase.
  // Needs CSM: always (no CSM has picked it up). Needs CSM Review: only if the
  // transition is THIS week. Uses business hours (Mon–Fri) so a Friday flip
  // doesn't trip until Monday. Field/status names match the live data.
  const isStaleTransition = (a) => {
    if (!a.transitionStatusUpdatedAt) return false;
    const over24 = P.weekdayHoursBetween(a.transitionStatusUpdatedAt, now) >= 24;
    if (!over24) return false;
    if (a.successTransitionStatus==="Needs CSM") return true;
    if (a.successTransitionStatus==="Needs CSM Review") return inThisWeek(a.antTransitionDate);
    return false;
  };
  const staleTransitions = weekTransitions.filter(isStaleTransition);

  const [weekFilter, setWeekFilter] = React.useState("all");
  const [calView, setCalView] = React.useState("week");   // "week" | "month"
  const [monthAnchor, setMonthAnchor] = React.useState(new Date(now.getFullYear(), now.getMonth(), 1));
  const allKickoffs = window._kickoffs || [];
  // Events on a given calendar day, honoring the All/Kickoffs/Go-Lives/Transitions
  // filter. Shared by the week grid and the month grid (scans the full account +
  // kickoff lists, not just this week's, so the month view is complete).
  const dayEvents = (d) => {
    const gl = (weekFilter==="all"||weekFilter==="golives") ? accounts.filter(a => a.pgl && a.status!=="Live" && a.status!=="Hold" && sameDay(a.pgl, d)) : [];
    const tr = (weekFilter==="all"||weekFilter==="transitions") ? accounts.filter(a => ((a.antTransitionDate && a.transitioned===false && a.status!=="Hold") || a.transitionDate) && (sameDay(a.antTransitionDate, d) || sameDay(a.transitionDate, d))) : [];
    const ko = (weekFilter==="all"||weekFilter==="kickoffs") ? allKickoffs.filter(k => sameDay(k.kickoff, d)) : [];
    return [
      ...ko.map(k => ({ kind:"kickoff", id:"ko-"+k.id, color:"var(--purple)", icon:"play_circle", name:k.tenant,
        onClick:()=>{ const a=accounts.find(x=>x.id===k.id); if(a) onOpen(a); } })),
      ...gl.map(a => ({ kind:"golive", id:"gl-"+a.id, color:"var(--green)", icon:"rocket_launch", name:a.tenant, onClick:()=>onOpen(a) })),
      ...tr.map(a => { const ts = P.TRANSITION_STATUS[a.successTransitionStatus]; const stale = isStaleTransition(a);
        const hrs = a.transitionStatusUpdatedAt ? P.weekdayHoursBetween(a.transitionStatusUpdatedAt, now) : null;
        return { kind:"transition", id:"tr-"+a.id, color: ts?ts.c:"var(--blue)", icon: ts?ts.i:"swap_horiz", name:a.tenant,
          statusLabel: a.successTransitionStatus || "No status", stale, staleHrs: hrs, onClick:()=>onOpen(a) }; }),
    ];
  };

  const monthName = now.toLocaleDateString("en-US",{month:"long"});
  const projGoLives = accounts.filter(a => a.status!=="Live" && a.status!=="Hold" && inMonth(a.pgl) && new Date(a.pgl)>=now).length;
  const antTrans = accounts.filter(a => !a.transitioned && a.antTransitionDate && inMonth(a.antTransitionDate) && new Date(a.antTransitionDate)>=now).length;

  return (
    <div className="view-enter">
      <div className="kpi-grid kpi-primary">
        <KPI icon="rocket_launch" label={`Go-Lives · ${monthName}`} value={actSoFar} accent="var(--green)" size="lg"
          foot={`${projGoLives} more projected this month`} footDir="up" onClick={()=>goTo("performance")} />
        <KPI icon="flag" label={`Projected Go-Lives · ${monthName}`} value={projGoLives} accent="var(--green)" size="lg"
          foot="still to go live" footDir="flat" onClick={()=>goTo("pipeline")} />
        <KPI icon="swap_horiz" label={`Moved to Success · ${monthName}`} value={transSoFar} accent="var(--sky)" size="lg"
          foot={`${antTrans} more projected this month`} footDir="up" onClick={()=>goTo("performance")} />
        <KPI icon="event_upcoming" label={`Projected to Success · ${monthName}`} value={antTrans} accent="var(--sky)" size="lg"
          foot="still to move to Success" footDir="flat" onClick={()=>goTo("pipeline")} />
      </div>
      <div className="kpi-grid kpi-secondary">
        <KPI icon="schedule" label="Avg Start to Live" value={avgToLive==null?"-":avgToLive.toFixed(1)} unit={avgToLive==null?"":"wks"} accent="var(--green)" size="sm"
          foot="kickoff to go-live, last 6 months" footDir="flat" onClick={()=>goTo("performance")} />
        <KPI icon="schedule" label="Avg Live to Success" value={avgToSuccess==null?"-":avgToSuccess.toFixed(1)} unit={avgToSuccess==null?"":"wks"} accent="var(--sky)" size="sm"
          foot="go-live to Success transition, last 6 months" footDir="flat" onClick={()=>goTo("performance")} />
      </div>

      {/* Salesforce compliance */}
      {complianceTotal>0 && (
        <div className="card" style={{ borderColor:"var(--tint-red-25)", background:"var(--tint-red-10)", padding:"13px 18px", marginBottom:24, display:"flex", alignItems:"center", gap:14, flexWrap:"wrap" }}>
          <MI style={{ fontSize:21, color:"var(--red)" }}>rule</MI>
          <span style={{ fontWeight:700, fontSize:13.5 }}>Salesforce compliance — {complianceTotal} item{complianceTotal!==1?"s":""} to chase before Monday sync</span>
          <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
            {[["noHS",noHS,"missing health score"],["noComments",noComments,"missing HS comments"],["pglOverdue",pglOver,"go-live date passed"],["transOverdue",transOver,"transition overdue"],["staleHS",staleHS,"stale health score (>7d)"],["antBeforePgl",antBeforePgl,"transition before go-live"],["transWeekNotLive",transWeekNotLive,"transition this week, not live"],["needsCsm",needsCsm,"needs CSM 24h+ (no Success Rep)"]].filter(([k,n])=>n>0).map(([k,n,l],i)=>
              <button key={i} className="flag-pill flag-pill-btn" style={{ color:"var(--fg-2)" }} onClick={()=>goToCompliance(k)} title={`Review ${n} · ${l}`}><strong style={{ color:"var(--red)", fontFamily:"var(--font-display)" }}>{n}</strong> {l} <MI style={{ fontSize:13 }}>arrow_forward</MI></button>)}
          </div>
          <span className="spacer" />
          <button className="btn btn-sm" onClick={()=>goToCompliance(null)}>Review all <MI>arrow_forward</MI></button>
        </div>
      )}

      {/* Week ahead */}
      <div style={{ display:"flex", alignItems:"center", marginBottom:14, flexWrap:"wrap", gap:8 }}>
        <div className="section-title" style={{ margin:0 }}><MI>calendar_month</MI>The Week Ahead</div>
        <span className="count-note" style={{ marginLeft:4 }}>week of {fmtDate(monday)}</span>
        <span className="spacer" />
        <div className="week-toggles">
          {[["all","All",null],["kickoffs","Kickoffs","var(--purple)"],["golives","Go-Lives","var(--green)"],["transitions","Transitions","var(--blue)"]].map(([k,l,c]) => {
            const on = weekFilter===k;
            return <button key={k} className={"wt-btn"+(on?" on":"")}
              style={ c ? { "--wt": c, background: on?c:"var(--card-2)", color: on?"#fff":"var(--fg-2)", borderColor: on?c:"var(--line-2)" }
                        : { background: on?"var(--accent)":"var(--card-2)", color: on?"#fff":"var(--fg-2)", borderColor: on?"var(--accent)":"var(--line-2)" } }
              onClick={()=>setWeekFilter(k)}>
              {c && <span className="wt-dot" style={{ background: on?"#fff":c }} />}{l}
            </button>;
          })}
          {(weekFilter==="all"||weekFilter==="transitions") && (
            <span className="legend-hover" tabIndex={0}>
              <MI style={{ fontSize:17 }}>info</MI>
              <div className="legend-pop">
                <div className="lp-title">Transition status</div>
                {Object.entries(P.TRANSITION_STATUS).map(([k,v]) => (
                  <div key={k} className="lp-row">
                    <MI className="lp-icon" style={{ color:v.c }}>{v.i}</MI>
                    <div><div className="lp-name">{k}</div><div className="lp-desc">{v.desc}</div></div>
                  </div>
                ))}
                <div className="lp-foot"><MI style={{ fontSize:13, color:"var(--yellow)" }}>warning</MI> Amber flag = stuck past 24h SLA (Mon–Fri)</div>
              </div>
            </span>
          )}
        </div>
        <div className="seg" style={{ marginLeft:8 }}>
          <button className={calView==="week"?"on":""} onClick={()=>setCalView("week")}>Week</button>
          <button className={calView==="month"?"on":""} onClick={()=>setCalView("month")}>Month</button>
        </div>
        <button className="btn btn-sm btn-ghost" onClick={()=>goTo("pipeline")}>Full pipeline <MI>arrow_forward</MI></button>
      </div>

      {staleTransitions.length>0 && (weekFilter==="all"||weekFilter==="transitions") && (
        <div className="stale-callout">
          <MI style={{ fontSize:18, color:"var(--yellow)" }}>warning</MI>
          <span><strong>{staleTransitions.length}</strong> transition{staleTransitions.length>1?"s":""} stuck past the 24h SLA — awaiting CSM pickup or manager review.</span>
          <span className="stale-names">{staleTransitions.slice(0,3).map(a=>a.tenant).join(" · ")}{staleTransitions.length>3?` +${staleTransitions.length-3}`:""}</span>
        </div>
      )}
      {calView==="week" ? (
        <div className="weekgrid" style={{ marginBottom:26 }}>
          {days.map((d, i) => <WeekDay key={i} d={d} today={i===todayIdx} events={dayEvents(d)} />)}
        </div>
      ) : (
        <MonthGrid anchor={monthAnchor} setAnchor={setMonthAnchor} dayEvents={dayEvents} />
      )}

      {/* Upcoming Kickoffs */}
      {(() => {
        const ko = window._kickoffs || [];
        if (ko.length === 0) return null;
        return (
          <Card title="Upcoming Kickoffs" count={ko.length} style={{ marginTop: 20 }}
            action={<button className="btn btn-sm btn-ghost" onClick={()=>goTo("accounts")}>View all <MI>arrow_forward</MI></button>}>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(240px, 1fr))", gap:10, padding:"8px 0" }}>
              {ko.map((k,ki) => (
                <div key={k.id+"-"+ki} className="lrow" style={{ padding:"10px 14px", flexDirection:"column", alignItems:"flex-start", gap:6, cursor:"pointer" }}
                  onClick={() => { const a = accounts.find(x=>x.id===k.id); if(a) onOpen(a); }}>
                  <div style={{ display:"flex", justifyContent:"space-between", width:"100%", alignItems:"center" }}>
                    <span style={{ fontWeight:700, fontSize:13 }}>{k.tenant}</span>
                    <span className="chip" style={{
                      background: k.status==="No Payment Method" ? "rgba(226,79,79,.14)" : "rgba(109,186,248,.14)",
                      color: k.status==="No Payment Method" ? "var(--red)" : "var(--sky)",
                      borderColor: k.status==="No Payment Method" ? "rgba(226,79,79,.4)" : "rgba(109,186,248,.4)",
                      fontSize:10
                    }}>{k.status}</span>
                  </div>
                  <div style={{ fontSize:12, color:"var(--fg-3)" }}>
                    <MI style={{fontSize:13, verticalAlign:"-2px"}}>event</MI> {new Date(k.kickoff).toLocaleDateString("en-US",{month:"short",day:"numeric"})}
                    <span style={{ margin:"0 6px" }}>·</span>
                    {firstName(k.ic)}
                    <span style={{ margin:"0 6px" }}>·</span>
                    {fmtK(k.cmrr)}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        );
      })()}
    </div>
  );
}
function sameDay(d, ref){ if(!d) return false; const x=new Date(d); return x.getFullYear()===ref.getFullYear()&&x.getMonth()===ref.getMonth()&&x.getDate()===ref.getDate(); }

function ForecastCard({ monthName }) {
  // Snapshot-based: startOfMonth comes from the weekly snapshot table, while
  // currentProjection and actuals come from the live table. No manual capture.
  const fc = window._forecastCompare;
  if (!fc || !fc.startOfMonth) {
    return (
      <Card title="Forecast vs Actual" count={monthName} style={{ marginTop: 20 }}>
        <Empty icon="flag" title="No start-of-month snapshot" sub="No weekly snapshot is available for this month yet." />
      </Card>
    );
  }

  const som = fc.startOfMonth, cur = fc.currentProjection, act = fc.actuals;
  const Metric = ({ label, start, current, actual }) => {
    const pct = start ? Math.round((actual/start)*100) : 0;
    const c = pct>=80?"var(--green)":pct>=50?"var(--yellow)":"var(--red)";
    const drift = current - start;
    return (
      <div style={{ padding:"4px 4px" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
          <span className="eyebrow">{label}</span>
          {drift!==0 && <span className="chip" style={{ fontSize:10.5, background:"var(--soft)", borderColor:"var(--line)", color: drift>0?"var(--green)":"var(--red)" }}>{drift>0?"+":""}{drift} vs plan</span>}
        </div>
        <div style={{ display:"flex", gap:18 }}>
          <FCell n={start} l="At month start" />
          <FCell n={current} l="Current projection" />
          <FCell n={actual} l="Actuals so far" big c={c} />
        </div>
        <div className="bar" style={{ marginTop:10 }}><span style={{ width: Math.min(pct,100)+"%", background:c }} /></div>
        <div style={{ fontSize:11, color:"var(--fg-3)", marginTop:4, fontWeight:600 }}>{pct}% of month-start forecast achieved</div>
      </div>
    );
  };
  const snapLabel = fc.snapshotDate ? new Date(fc.snapshotDate+"T00:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"}) : "—";
  return (
    <Card title="Forecast vs Actual" count={monthName} style={{ marginTop: 20 }}>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:24, padding:"16px 18px" }}>
        <Metric label="Go-Lives" start={som.goLives} current={cur.goLives} actual={act.goLives} />
        <Metric label="Transitions" start={som.transitions} current={cur.transitions} actual={act.transitions} />
      </div>
      <div style={{ fontSize:11, color:"var(--fg-4)", padding:"0 18px 12px", textAlign:"right" }}>Start-of-month snapshot: {snapLabel}</div>
    </Card>
  );
}
function FCell({ n, l, big, c }) {
  return <div><div style={{ fontFamily:"var(--font-display)", fontWeight:700, fontSize: big?28:20, letterSpacing:"-1px", color: c||"var(--fg-2)", lineHeight:1 }}>{n}</div>
    <div style={{ fontSize:10.5, color:"var(--fg-3)", fontWeight:700, marginTop:4 }}>{l}</div></div>;
}

/* ════════════════════════════════════════════════════════════════════
   Redesigned To-Dos page. One prioritized list of everything on the
   manager's plate — account tasks (derived from note → fromNoteId) plus
   personal to-dos. Group by Due / Account / Onboarder; click any task for
   full context (the source note + account). Replaces the old stacked
   "My To-Dos" + "Account tasks" cards.
   ════════════════════════════════════════════════════════════════════ */

const TD_BUCKETS = {
  overdue: { label: "Overdue", c: "var(--red)", i: "error" },
  today:   { label: "Today", c: "var(--yellow)", i: "wb_sunny" },
  week:    { label: "This week", c: "var(--sky)", i: "date_range" },
  later:   { label: "Later", c: "var(--fg-3)", i: "event" },
};
const TD_ORDER = ["overdue", "today", "week", "later"];
function tdBucket(due) {
  if (!due) return "later";   // dateless to-dos fold into Later (no Unscheduled bucket)
  const t = P.now, base = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  const d0 = /^\d{4}-\d{2}-\d{2}$/.test(due) ? new Date(due + "T12:00:00") : new Date(due);
  const d = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate());
  const diff = Math.round((d - base) / 86400000);
  if (diff < 0) return "overdue";
  if (diff === 0) return "today";
  if (diff <= 7) return "week";
  return "later";
}
const TD_TAG_I = { "Call":"call","Risk":"warning","Customer-facing":"outgoing_mail","Internal":"lock","Go-live":"rocket_launch","Data / DQA":"database","Pricebook":"menu_book","Training":"school","Billing":"receipt_long","Escalation":"priority_high" };
const TD_TAG_C = { "Risk":"var(--red)","Escalation":"var(--red)","Go-live":"var(--green)","Training":"var(--green)","Customer-facing":"var(--green)","Data / DQA":"var(--purple)","Internal":"var(--fg-3)" };
const tdTagColor = (t) => TD_TAG_C[t] || "var(--sky)";

function TdDue({ due }) {
  const b = tdBucket(due), m = TD_BUCKETS[b], strong = b === "overdue" || b === "today";
  return <span className="chip" style={{ whiteSpace:"nowrap",
    background: strong ? `color-mix(in srgb, ${m.c} 16%, transparent)` : "var(--soft)",
    borderColor: strong ? `color-mix(in srgb, ${m.c} 45%, transparent)` : "var(--line)",
    color: strong ? m.c : "var(--fg-2)" }}>
    <MI style={{ fontSize:13 }}>{due ? "schedule" : "event_busy"}</MI>{due ? relDay(due) : "No date"}</span>;
}
function TdTag({ tag }) {
  const c = tdTagColor(tag);
  return <span className="chip" style={{ color:c, background:`color-mix(in srgb, ${c} 13%, transparent)`, borderColor:`color-mix(in srgb, ${c} 38%, transparent)` }}>
    <MI style={{ fontSize:12 }}>{TD_TAG_I[tag] || "sell"}</MI>{tag}</span>;
}

// gather every open/closed task into wrappers: { t, acct, ic, note, personal }
function tdCollect() {
  const out = [];
  (P.accounts || []).forEach(a => (a.actionItems || []).forEach(t => {
    out.push({ t, acct: a, ic: a.ic, note: (a.noteLog || []).find(n => n.id === t.fromNoteId) || null, personal: false });
  }));
  (window._todos || []).forEach(t => out.push({ t, acct: null, ic: null, note: null, personal: true }));
  return out;
}

function TodoRow({ w, onOpen, onToggle, showAcct }) {
  const { t, acct, ic } = w;
  return (
    <div className="lrow" style={{ alignItems:"flex-start", padding:"11px 16px" }} onClick={() => onOpen(w)}>
      <span className={"chk" + (t.done ? " on" : "")} style={{ cursor:"pointer", marginTop:1 }}
        onClick={(e) => { e.stopPropagation(); onToggle(w); }}>{t.done && <MI>check</MI>}</span>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:13.5, fontWeight:600, lineHeight:1.4, textWrap:"pretty",
          textDecoration: t.done ? "line-through" : "none", opacity: t.done ? .5 : 1 }}>{t.text}</div>
        <div style={{ display:"flex", alignItems:"center", gap:10, marginTop:6, flexWrap:"wrap" }}>
          {showAcct && (acct
            ? <span className="td-acct" style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:11.5, fontWeight:700, color:"var(--fg-2)" }}><MI style={{ fontSize:13, color:"var(--fg-4)" }}>store</MI>{acct.tenant}</span>
            : <span style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:11.5, fontWeight:700, color:"var(--fg-4)" }}><MI style={{ fontSize:13 }}>person</MI>Personal</span>)}
          {showAcct && acct && ic && <span style={{ display:"inline-flex", alignItems:"center", gap:4, fontSize:11, fontWeight:700, color:"var(--fg-3)" }}><Avatar name={ic} size={15} />{firstName(ic)}</span>}
          {w.note && <span style={{ display:"inline-flex", alignItems:"center", gap:3, fontSize:11, fontWeight:700, color:"var(--sky)" }}><MI style={{ fontSize:13 }}>sticky_note_2</MI>from note</span>}
        </div>
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:9, flexShrink:0 }}>
        {acct && acct.hs != null && <HsChip hs={acct.hs} mini />}
        <TdDue due={t.due} />
        <MI className="td-go" style={{ fontSize:18, color:"var(--fg-4)" }}>chevron_right</MI>
      </div>
    </div>
  );
}

function TodoSummary({ counts, filter, setFilter }) {
  const cards = ["overdue","today","week"].map(k => ({ key:k, ...TD_BUCKETS[k], n:counts[k] }));
  return (
    <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:18 }}>
      {cards.map(c => {
        const on = filter === c.key;
        return <button key={c.key} onClick={() => setFilter(on ? "all" : c.key)}
          style={{ textAlign:"left", padding:"13px 15px", borderRadius:"var(--radius)", cursor:"pointer", background:"var(--card)",
            border:"1px solid " + (on ? c.c : "var(--line)"), boxShadow: on ? `0 0 0 3px color-mix(in srgb, ${c.c} 22%, transparent)` : "none", transition:"all .15s" }}>
          <div style={{ display:"flex", alignItems:"center", gap:7 }}><MI style={{ fontSize:16, color:c.c }}>{c.i}</MI><span style={{ fontSize:11.5, fontWeight:700, color:"var(--fg-3)" }}>{c.label}</span></div>
          <div style={{ fontFamily:"var(--font-display)", fontWeight:700, fontSize:26, letterSpacing:"-1px", color: c.n ? c.c : "var(--fg-3)", marginTop:4 }}>{c.n}</div>
        </button>;
      })}
    </div>
  );
}

function TodoDetail({ w, onClose, onToggle, onOpenAcct, onPick }) {
  if (!w) return null;
  const { t, acct, note } = w;
  const siblings = acct ? tdCollect().filter(x => x.acct && x.acct.id === acct.id && x.t.id !== t.id && !x.t.done) : [];
  const Sec = ({ label, children }) => (
    <div style={{ padding:"16px 20px", borderTop:"1px solid var(--line)" }}>
      <div style={{ fontSize:10.5, fontWeight:800, color:"var(--fg-4)", textTransform:"uppercase", letterSpacing:".6px", marginBottom:10 }}>{label}</div>{children}</div>
  );
  let noteBody = note ? note.text : null;
  if (note) {
    const i = note.text.toLowerCase().indexOf((t.text || "").toLowerCase());
    if (i >= 0) noteBody = <>{note.text.slice(0,i)}<mark style={{ background:"var(--tint-blue-15)", color:"var(--sky)", borderRadius:4, padding:"0 3px" }}>{note.text.slice(i,i+t.text.length)}</mark>{note.text.slice(i+t.text.length)}</>;
  }
  return (
    <>
      <div className="td-scrim" onClick={onClose} />
      <aside className="td-panel">
        <div style={{ display:"flex", alignItems:"center", gap:10, padding:"16px 20px", borderBottom:"1px solid var(--line)" }}>
          <span style={{ fontSize:11, fontWeight:800, color:"var(--fg-4)", textTransform:"uppercase", letterSpacing:".6px" }}>Task</span>
          <span className="spacer" /><button className="btn btn-sm btn-ghost icon-btn" onClick={onClose}><MI>close</MI></button>
        </div>
        <div style={{ flex:1, minHeight:0, overflowY:"auto" }}>
          <div style={{ padding:"18px 20px" }}>
            <div style={{ display:"flex", gap:12, alignItems:"flex-start" }}>
              <span className={"chk" + (t.done ? " on" : "")} style={{ cursor:"pointer", marginTop:3, width:22, height:22 }} onClick={() => onToggle(w)}>{t.done && <MI>check</MI>}</span>
              <div style={{ fontFamily:"var(--font-display)", fontWeight:700, fontSize:19, lineHeight:1.3, letterSpacing:"-.3px", textWrap:"pretty", textDecoration: t.done ? "line-through" : "none", opacity: t.done ? .55 : 1 }}>{t.text}</div>
            </div>
            <div style={{ display:"flex", gap:8, marginTop:14, flexWrap:"wrap" }}>
              <TdDue due={t.due} />
              {note && (note.tags || []).slice(0,2).map(tg => <TdTag key={tg} tag={tg} />)}
            </div>
            <div style={{ marginTop:16 }}>
              <button className={"btn btn-sm" + (t.done ? " btn-ghost" : " btn-primary")} onClick={() => onToggle(w)}><MI style={{ fontSize:16 }}>{t.done ? "replay" : "check"}</MI>{t.done ? "Reopen" : "Mark complete"}</button>
            </div>
          </div>
          {acct ? (
            <Sec label="Account">
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontFamily:"var(--font-display)", fontWeight:700, fontSize:15.5, letterSpacing:"-.2px" }}>{acct.tenant}</div>
                  <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:4, fontSize:11.5, color:"var(--fg-3)", fontWeight:700 }}><Avatar name={acct.ic} size={16} />{acct.ic}<span style={{ color:"var(--fg-4)" }}>·</span>{acct.trade}</div>
                </div>
              </div>
              <div style={{ display:"flex", gap:8, marginTop:12, flexWrap:"wrap" }}><HsChip hs={acct.hs} /><StatusChip status={acct.status} /></div>
              <button className="btn btn-sm btn-ghost" style={{ marginTop:12 }} onClick={() => onOpenAcct(acct)}><MI style={{ fontSize:16 }}>open_in_new</MI>Open account detail</button>
            </Sec>
          ) : (
            <Sec label="Type"><span style={{ display:"inline-flex", alignItems:"center", gap:6, fontSize:12.5, fontWeight:700, color:"var(--fg-2)" }}><MI style={{ fontSize:16, color:"var(--fg-3)" }}>person</MI>Personal to-do — not tied to an account</span></Sec>
          )}
          {note && (
            <Sec label="From this note">
              <div style={{ background:"var(--card-2)", border:"1px solid var(--line)", borderRadius:"var(--r-md)", padding:"13px 15px" }}>
                <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:8 }}><Avatar name={note.by} size={20} /><span style={{ fontSize:12, fontWeight:800 }}>{note.by}</span><span style={{ fontSize:11, fontWeight:700, color:"var(--fg-4)" }}>· {fmtDateY(note.at)}</span></div>
                <div style={{ fontSize:13, lineHeight:1.6, textWrap:"pretty" }}>{noteBody}</div>
                {(note.tags || []).length > 0 && <div style={{ display:"flex", gap:6, marginTop:10, flexWrap:"wrap" }}>{note.tags.map(tg => <TdTag key={tg} tag={tg} />)}</div>}
              </div>
            </Sec>
          )}
          {siblings.length > 0 && (
            <Sec label={`Other open tasks on this account (${siblings.length})`}>
              <div style={{ display:"flex", flexDirection:"column", gap:2 }}>
                {siblings.map(s => (
                  <div key={s.t.id} className="lrow" style={{ padding:"8px 0", border:"none", cursor:"pointer" }} onClick={() => onPick(s)}>
                    <span className="chk" style={{ width:17, height:17 }} onClick={(e) => { e.stopPropagation(); onToggle(s); }} />
                    <span style={{ flex:1, minWidth:0, fontSize:12.5, fontWeight:600 }}>{s.t.text}</span><TdDue due={s.t.due} />
                  </div>
                ))}
              </div>
            </Sec>
          )}
        </div>
      </aside>
    </>
  );
}

function TodoBoard({ onOpen }) {
  const [groupBy, setGroupBy] = React.useState("due");
  const [filter, setFilter] = React.useState("all");
  const [q, setQ] = React.useState("");
  const [showDone, setShowDone] = React.useState(false);
  const [sel, setSel] = React.useState(null);
  const [tick, setTick] = React.useState(0);
  const [adding, setAdding] = React.useState(false);
  const [newText, setNewText] = React.useState("");
  const [newDue, setNewDue] = React.useState("");
  const [icFilter, setIcFilter] = React.useState("all");
  const [acctFilter, setAcctFilter] = React.useState("all");

  const all = React.useMemo(() => tdCollect(), [tick]);
  const counts = React.useMemo(() => {
    const c = { overdue:0, today:0, week:0, later:0, none:0, open:0 };
    all.forEach(w => { if (w.t.done) return; c.open++; c[tdBucket(w.t.due)]++; });
    return c;
  }, [all]);

  const toggle = (w) => {
    w.t.done = !w.t.done;
    if (w.personal) fetch("/api/todos/update", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ id:w.t.id, done:w.t.done }) }).catch(()=>{});
    else fetch("/api/tasks/update", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ accountId:w.acct.id, taskId:w.t.id, done:w.t.done }) }).catch(()=>{});
    setTick(x => x + 1);
    showToast(w.t.done ? "Task completed" : "Marked open");
  };
  const openDetail = (w) => setSel(w);
  const openAcct = (a) => { setSel(null); onOpen && onOpen(a); };
  const addPersonal = () => {
    const text = newText.trim(); if (!text) return;
    const t = { id:"tmp-"+Date.now(), text, due:newDue||null, done:false };
    (window._todos = window._todos || []).push(t);
    fetch("/api/todos/add", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ text:t.text, due:t.due }) }).catch(()=>{});
    setNewText(""); setNewDue(""); setAdding(false); setTick(x => x + 1);
  };

  // options for the IC + Account filter dropdowns (only ICs/accounts that actually have tasks)
  const icOptions = React.useMemo(() => {
    const s = new Set(); all.forEach(w => { if (w.acct && w.ic) s.add(w.ic); });
    return [...s].sort();
  }, [all]);
  const acctOptions = React.useMemo(() => {
    const m = new Map(); all.forEach(w => { if (w.acct) m.set(w.acct.id, w.acct.tenant); });
    return [...m.entries()].sort((a,b) => a[1].localeCompare(b[1]));
  }, [all]);

  const visible = React.useMemo(() => {
    const ql = q.trim().toLowerCase();
    return all.filter(w => {
      if (!showDone && w.t.done) return false;
      if (filter !== "all" && tdBucket(w.t.due) !== filter) return false;
      if (icFilter !== "all" && w.ic !== icFilter) return false;
      if (acctFilter !== "all" && (!w.acct || w.acct.id !== acctFilter)) return false;
      if (ql) { const hay = (w.t.text + " " + (w.acct ? w.acct.tenant : "") + " " + (w.ic || "")).toLowerCase(); if (!hay.includes(ql)) return false; }
      return true;
    });
  }, [all, filter, icFilter, acctFilter, q, showDone, tick]);

  const groups = React.useMemo(() => {
    if (groupBy === "due") return TD_ORDER.map(k => ({ key:k, kind:"due", items:visible.filter(w => tdBucket(w.t.due) === k) })).filter(g => g.items.length);
    if (groupBy === "account") {
      const m = new Map();
      visible.forEach(w => { const k = w.acct ? w.acct.id : "__p"; if (!m.has(k)) m.set(k, { key:k, kind:"account", acct:w.acct, items:[] }); m.get(k).items.push(w); });
      return [...m.values()].sort((a,b) => !a.acct ? 1 : !b.acct ? -1 : a.acct.tenant.localeCompare(b.acct.tenant));
    }
    const m = new Map();
    visible.forEach(w => { const k = w.ic || "__me"; if (!m.has(k)) m.set(k, { key:k, kind:"ic", ic:w.ic, items:[] }); m.get(k).items.push(w); });
    return [...m.values()].sort((a,b) => !a.ic ? -1 : !b.ic ? 1 : a.ic.localeCompare(b.ic));
  }, [visible, groupBy, tick]);

  const sortItems = (items) => items.slice().sort((a,b) => {
    const oa = TD_ORDER.indexOf(tdBucket(a.t.due)), ob = TD_ORDER.indexOf(tdBucket(b.t.due));
    if (oa !== ob) return oa - ob;
    return new Date(a.t.due || "2999") - new Date(b.t.due || "2999");
  });

  const Seg = ({ id, icon, label }) => (
    <button className={groupBy === id ? "on" : ""} onClick={() => setGroupBy(id)}><MI style={{ fontSize:15 }}>{icon}</MI>{label}</button>
  );

  return (
    <div className="view-enter">
      <TodoSummary counts={counts} filter={filter} setFilter={setFilter} />
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:14, flexWrap:"wrap" }}>
        <div className="seg td-seg">
          <span style={{ fontSize:11, fontWeight:800, color:"var(--fg-4)", textTransform:"uppercase", letterSpacing:".6px", padding:"0 6px 0 4px" }}>Group by</span>
          <Seg id="due" icon="schedule" label="Due" />
          <Seg id="account" icon="store" label="Account" />
          <Seg id="ic" icon="groups" label="Onboarder" />
        </div>
        <span className="spacer" />
        <div className="search"><MI>search</MI><input className="inp" placeholder="Search tasks" value={q} onChange={e => setQ(e.target.value)} style={{ minWidth:200 }} /></div>
        <button className={"btn btn-sm" + (showDone ? " btn-primary" : " btn-ghost")} onClick={() => setShowDone(s => !s)}><MI style={{ fontSize:16 }}>{showDone ? "check_circle" : "radio_button_unchecked"}</MI>Done</button>
        <button className="btn btn-sm" onClick={() => setAdding(a => !a)}><MI style={{ fontSize:16 }}>{adding ? "close" : "add"}</MI>{adding ? "Cancel" : "Add to-do"}</button>
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14, flexWrap:"wrap" }}>
        <span style={{ fontSize:11, fontWeight:800, color:"var(--fg-4)", textTransform:"uppercase", letterSpacing:".6px" }}><MI style={{ fontSize:15, verticalAlign:"-3px", marginRight:3 }}>filter_list</MI>Filter</span>
        <select className="select-sm" value={icFilter} onChange={e => setIcFilter(e.target.value)}>
          <option value="all">All onboarders</option>
          {icOptions.map(ic => <option key={ic} value={ic}>{ic}</option>)}
        </select>
        <select className="select-sm" value={acctFilter} onChange={e => setAcctFilter(e.target.value)}>
          <option value="all">All accounts</option>
          {acctOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        {(icFilter !== "all" || acctFilter !== "all" || filter !== "all") &&
          <button className="btn btn-sm btn-ghost" onClick={() => { setIcFilter("all"); setAcctFilter("all"); setFilter("all"); }}><MI style={{ fontSize:15 }}>close</MI>Clear filters</button>}
        <span className="spacer" />
        <span className="count-note">{visible.filter(w => !w.t.done).length} open · {visible.length} shown</span>
      </div>
      {adding && (
        <div className="card" style={{ display:"flex", gap:8, padding:"12px 16px", marginBottom:14, flexWrap:"wrap", alignItems:"center" }}>
          <input className="inp" autoFocus placeholder="What needs doing? (personal to-do)" value={newText} style={{ flex:1, minWidth:220 }} onChange={e => setNewText(e.target.value)} onKeyDown={e => { if (e.key === "Enter") addPersonal(); if (e.key === "Escape") setAdding(false); }} />
          <input className="inp" type="date" value={newDue} style={{ width:160 }} onChange={e => setNewDue(e.target.value)} />
          <button className="btn btn-primary btn-sm" onClick={addPersonal} disabled={!newText.trim()}><MI>add</MI>Add</button>
        </div>
      )}
      <div className="card" style={{ overflow:"hidden" }}>
        {visible.length === 0 ? <Empty icon="task_alt" title="Nothing here" sub={filter !== "all" ? "No tasks in this bucket." : "You're all caught up."} /> :
          groups.map((g, gi) => (
            <div key={g.key} style={{ borderTop: gi ? "1px solid var(--line)" : "none" }}>
              <div style={{ display:"flex", alignItems:"center", gap:10, padding:"12px 16px 8px" }}>
                {g.kind === "due" && <><MI style={{ fontSize:17, color:TD_BUCKETS[g.key].c }}>{TD_BUCKETS[g.key].i}</MI><span style={{ fontFamily:"var(--font-display)", fontWeight:700, fontSize:13.5, letterSpacing:"-.2px" }}>{TD_BUCKETS[g.key].label}</span></>}
                {g.kind === "account" && <><MI style={{ fontSize:17, color: g.acct ? "var(--sky)" : "var(--fg-4)" }}>store</MI><span style={{ fontFamily:"var(--font-display)", fontWeight:700, fontSize:13.5, letterSpacing:"-.2px" }}>{g.acct ? g.acct.tenant : "Personal to-dos"}</span>{g.acct && <span style={{ display:"inline-flex", alignItems:"center", gap:8 }}><HsChip hs={g.acct.hs} mini /><StatusChip status={g.acct.status} /><span style={{ display:"inline-flex", alignItems:"center", gap:4, fontSize:11, fontWeight:700, color:"var(--fg-3)" }}><Avatar name={g.acct.ic} size={15} />{firstName(g.acct.ic)}</span></span>}</>}
                {g.kind === "ic" && <><Avatar name={g.ic || "Roberto Najera"} size={20} /><span style={{ fontFamily:"var(--font-display)", fontWeight:700, fontSize:13.5, letterSpacing:"-.2px" }}>{g.ic || "Me (Roberto)"}</span></>}
                <span style={{ minWidth:22, height:20, padding:"0 7px", borderRadius:999, background:"var(--soft-2)", color:"var(--fg-2)", fontSize:11, fontWeight:800, display:"inline-flex", alignItems:"center", justifyContent:"center" }}>{g.items.length}</span>
                <span className="spacer" />
                {g.kind === "account" && g.acct && <button className="btn btn-sm btn-ghost" onClick={() => openAcct(g.acct)}>Open account<MI style={{ fontSize:15 }}>arrow_forward</MI></button>}
              </div>
              {sortItems(g.items).map((w, i) => <TodoRow key={(w.acct ? w.acct.id : "me") + ":" + (w.t.id || i)} w={w} onOpen={openDetail} onToggle={toggle} showAcct={g.kind !== "account"} />)}
            </div>
          ))}
      </div>
      <TodoDetail w={sel} onClose={() => setSel(null)} onToggle={toggle} onOpenAcct={openAcct} onPick={setSel} />
    </div>
  );
}

// Full-month calendar grid. `dayEvents(date)` returns the same event objects the
// week grid uses ({id, color, icon, name, stale, onClick, ...}). Prev/next/today
// navigation via setAnchor (anchor is the 1st of the displayed month).
function MonthGrid({ anchor, setAnchor, dayEvents }) {
  const y = anchor.getFullYear(), mo = anchor.getMonth();
  const startDow = new Date(y, mo, 1).getDay();           // 0 = Sun
  const daysInMonth = new Date(y, mo + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let dnum = 1; dnum <= daysInMonth; dnum++) cells.push(new Date(y, mo, dnum));
  while (cells.length % 7 !== 0) cells.push(null);
  const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const isToday = (d) => d && sameDay(d, P.now);
  return (
    <div className="card card-pad" style={{ marginBottom:26 }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
        <button className="btn btn-sm btn-ghost icon-btn" title="Previous month" onClick={()=>setAnchor(new Date(y, mo-1, 1))}><MI>chevron_left</MI></button>
        <span style={{ fontFamily:"var(--font-display)", fontWeight:700, fontSize:16, minWidth:150, textAlign:"center" }}>{anchor.toLocaleDateString("en-US",{month:"long",year:"numeric"})}</span>
        <button className="btn btn-sm btn-ghost icon-btn" title="Next month" onClick={()=>setAnchor(new Date(y, mo+1, 1))}><MI>chevron_right</MI></button>
        <span className="spacer" />
        <button className="btn btn-sm btn-ghost" onClick={()=>setAnchor(new Date(P.now.getFullYear(), P.now.getMonth(), 1))}>Today</button>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:6 }}>
        {DOW.map(w => <div key={w} style={{ fontSize:10.5, fontWeight:800, letterSpacing:".04em", textTransform:"uppercase", color:"var(--fg-3)", textAlign:"center", padding:"2px 0" }}>{w}</div>)}
        {cells.map((d, i) => {
          if (!d) return <div key={i} style={{ minHeight:88 }} />;
          const evs = dayEvents(d);
          return (
            <div key={i} style={{ minHeight:88, borderRadius:8, border:"1px solid var(--line)", background: isToday(d)?"var(--tint-blue-10)":"var(--card)", padding:"5px 6px", overflow:"hidden" }}>
              <div style={{ fontSize:11.5, fontWeight:800, color: isToday(d)?"var(--accent)":"var(--fg-2)", marginBottom:4 }}>{d.getDate()}</div>
              <div style={{ display:"flex", flexDirection:"column", gap:3 }}>
                {evs.slice(0,3).map(e => (
                  <div key={e.id} onClick={(ev)=>{ ev.stopPropagation(); e.onClick && e.onClick(); }} title={e.kind==="transition" ? e.name+" — "+e.statusLabel : e.name}
                    style={{ display:"flex", alignItems:"center", gap:4, cursor:"pointer", fontSize:10.5, fontWeight:700, color:e.color, background:"var(--soft)", borderRadius:4, padding:"1px 5px", whiteSpace:"nowrap", overflow:"hidden" }}>
                    <MI style={{ fontSize:11, color:e.color, flexShrink:0 }}>{e.icon}</MI>
                    <span style={{ overflow:"hidden", textOverflow:"ellipsis", color:"var(--fg-1)" }}>{e.name}</span>
                    {e.stale && <MI style={{ fontSize:10, color:"var(--yellow)", marginLeft:"auto", flexShrink:0 }}>warning</MI>}
                  </div>
                ))}
                {evs.length>3 && <div style={{ fontSize:10, color:"var(--fg-4)", fontWeight:700, paddingLeft:2 }}>+{evs.length-3} more</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekDay({ d, today, events }) {
  const [open, setOpen] = React.useState(false);
  const CAP = 4;
  const shown = open ? events : events.slice(0, CAP);
  const hidden = events.length - shown.length;
  // count by kind for the day header summary
  const counts = events.reduce((o,e)=>{ o[e.kind]=(o[e.kind]||0)+1; return o; }, {});
  const dots = [["kickoff","var(--purple)"],["golive","var(--green)"],["transition","var(--blue)"]].filter(([k])=>counts[k]);
  return (
    <div className={"daycol" + (today?" today":"")}>
      <div className="dh">
        <div>
          <div className="dn">{d.toLocaleDateString("en-US",{weekday:"short"})}{today?" · Today":""}</div>
          <div className="dd">{d.getDate()}</div>
        </div>
        {events.length>0 && <div className="day-count">
          {dots.map(([k,c])=><span key={k} className="dc-pill" style={{ color:c }}><span className="flag-dot" style={{ background:c }} />{counts[k]}</span>)}
        </div>}
      </div>
      <div className="db">
        {events.length===0 && <div className="db-empty">—</div>}
        {shown.map(e => (
          <button key={e.id} className={"evt-chip evt-"+e.kind + (e.stale?" evt-stale":"")} onClick={e.onClick}
            title={e.kind==="transition" ? e.name+" — "+e.statusLabel+(e.stale?` · ${e.staleHrs}h in status (Mon–Fri, past 24h SLA)`:"") : e.name}
            style={ e.kind==="transition" ? { borderLeftColor:e.color } : null }>
            <MI style={{ fontSize:14, color:e.color, flexShrink:0 }}>{e.icon}</MI>
            <span className="evt-name">{e.name}</span>
            {e.stale && <MI className="evt-stale-flag" style={{ fontSize:14, marginLeft:"auto", flexShrink:0 }}>warning</MI>}
          </button>
        ))}
        {hidden>0 && <button className="evt-more" onClick={()=>setOpen(true)}>+{hidden} more</button>}
        {open && events.length>CAP && <button className="evt-more" onClick={()=>setOpen(false)}>Show less</button>}
      </div>
    </div>
  );
}

function TodosView({ onOpen }) {
  return (
    <div className="view-enter">
      <TodoBoard onOpen={onOpen} />
    </div>
  );
}

Object.assign(window, { Home, TodosView, ForecastCard, WeekDay });
