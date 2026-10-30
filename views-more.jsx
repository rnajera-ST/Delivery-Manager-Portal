/* Portfolio, Team, Pipeline, 1:1 Prep, Concessions, CSAT modules */
const { useState: useStateM } = React;

// OB health-score labels (ONBOARDING_HEALTH_SCORE_OB). Colors come from P.HS.
const HS_SCORE_LABELS = {
  0: "Churn Forecasted", 1: "Churn Risk", 2: "60 Days MIA", 3: "Delayed",
  4: "Low Confidence", 5: "Med Confidence", 6: "High Confidence",
};

/* ============================ PORTFOLIO ============================ */
function Portfolio({ accounts, onOpen, mode, senior }) {
  const [q, setQ] = useStateM("");
  const icOpts = P.team.map(t=>t.name);
  const mgrOpts = senior ? Array.from(new Set(accounts.map(a=>a.manager).filter(Boolean))).sort() : [];
  const statusOpts = Object.keys(P.STATUS);
  const pstatusOpts = Object.keys(P.PORTAL_STATUS);
  const [ic, setIc] = useStateM(icOpts);
  const [mgr, setMgr] = useStateM(mgrOpts);
  const [status, setStatus] = useStateM(statusOpts);
  const [pstatus, setPstatus] = useStateM(pstatusOpts);
  const [view, setView] = useStateM("all");
  const [sort, setSort] = useStateM("hs");
  const [dir, setDir] = useStateM(1);

  let rows = accounts.slice();
  if (view === "esc") rows = rows.filter(isEsc);
  else if (view === "flagged") rows = rows.filter(isFlagged);
  // All options selected = no filter (everything shown, incl. blanks). A subset
  // filters; deselecting all shows none.
  if (senior && mgr.length < mgrOpts.length) rows = rows.filter(a => mgr.includes(a.manager));
  if (ic.length < icOpts.length) rows = rows.filter(a => ic.includes(a.ic));
  if (status.length < statusOpts.length) rows = rows.filter(a => status.includes(a.status));
  if (pstatus.length < pstatusOpts.length) rows = rows.filter(a => pstatus.includes(a.portalStatus));
  if (q.trim()) { const s = q.toLowerCase(); rows = rows.filter(a => a.tenant.toLowerCase().includes(s) || a.ic.toLowerCase().includes(s) || a.trade.toLowerCase().includes(s)); }

  const keyFns = {
    hs: a => a.hs ?? 99, tenant: a => a.tenant.toLowerCase(), ic: a => a.ic, status: a => a.status,
    cmrr: a => a.cmrr, week: a => P.ageDays(a.implStart)||0, pgl: a => a.pgl?new Date(a.pgl).getTime():Infinity,
    trans: a => a.antTransitionDate?new Date(a.antTransitionDate).getTime():Infinity,
    eng: a => a.engagementScore ?? -1,
    koc: a => a.kocDate?new Date(a.kocDate).getTime():Infinity,
    ipgl: a => a.initialPgl?new Date(a.initialPgl).getTime():Infinity,
  };
  rows.sort((a,b) => { const ka=keyFns[sort](a), kb=keyFns[sort](b); return (ka<kb?-1:ka>kb?1:0)*dir; });

  const setSortCol = (c) => { if (sort===c) setDir(d=>-d); else { setSort(c); setDir(c==="cmrr"?-1:1); } };
  const Th = ({ c, children, right }) => <th onClick={()=>setSortCol(c)} style={{ textAlign: right?"right":"left" }}>{children}{sort===c && <MI className="sort-ind">{dir>0?"arrow_drop_up":"arrow_drop_down"}</MI>}</th>;

  return (
    <div className="view-enter">
      <div className="toolbar">
        <div className="seg">
          {[["all","All"],["flagged","Flagged"],["esc","Escalations"]].map(([k,lb])=><button key={k} className={view===k?"on":""} onClick={()=>setView(k)}>{lb}</button>)}
        </div>
        <div className="search"><MI>search</MI><input className="inp" placeholder="Search accounts, ICs, trades…" value={q} onChange={e=>setQ(e.target.value)} /></div>
        {senior && <MultiSelect label="managers" options={mgrOpts} selected={mgr} onChange={setMgr} />}
        <MultiSelect label="ICs" options={P.team.map(t=>t.name)} selected={ic} onChange={setIc} />
        <MultiSelect label="statuses" options={Object.keys(P.STATUS)} selected={status} onChange={setStatus} />
        <MultiSelect label="portal status" options={Object.keys(P.PORTAL_STATUS)} selected={pstatus} onChange={setPstatus} />
        <span className="spacer" />
        <span className="count-note">{rows.length} of {accounts.length}</span>
      </div>

      {mode==="cards" ? (
        <div className="acct-cards">
          {rows.map(a => <AccountCard key={a.id} a={a} onOpen={onOpen} />)}
          {rows.length===0 && <Empty icon="search_off" title="No matches" sub="Try a different search or filter." />}
        </div>
      ) : (
      <div className="tbl-wrap">
        <table className="tbl tbl-compact">
          <thead><tr>
            <Th c="hs">Health</Th><Th c="tenant">Account</Th>{senior && <th>Manager</th>}<Th c="ic">IC</Th><Th c="status">Status</Th>
            <Th c="hs">Health Score</Th><Th c="cmrr" right>CMRR</Th><Th c="koc">KOC Date</Th><Th c="week" right>In OB</Th><Th c="ipgl">Initial PGL</Th><Th c="pgl">Go-Live</Th><Th c="trans">Transition</Th>
          </tr></thead>
          <tbody>
            {rows.map(a => {
              const wk = weeksIn(a.implStart);
              const ps = a.portalStatus ? (P.PORTAL_STATUS[a.portalStatus]||{c:"var(--fg-3)",i:"help"}) : null;
              return <tr key={a.id} onClick={()=>onOpen(a)}>
                <td><HsChip hs={a.hs} mini /></td>
                <td><div style={{ display:"flex", alignItems:"center", gap:6 }}><span className="acct-name">{a.tenant}</span><BalanceBadge amount={a.outstandingBalance} sm /></div><div style={{ fontSize:11, color:"var(--fg-4)", fontWeight:600 }}>{a.trade}</div></td>
                {senior && <td style={{ fontSize:12.5, color:"var(--fg-2)", fontWeight:600 }}>{a.manager || "—"}</td>}
                <td><span style={{ display:"flex", alignItems:"center", gap:7 }}><Avatar name={a.ic} size={20} /><span style={{ fontSize:12.5, color:"var(--fg-2)", fontWeight:600 }}>{firstName(a.ic)}{a.ic.split(" ")[1] ? " " + a.ic.split(" ")[1][0] + "." : ""}</span></span></td>
                <td><span style={{ display:"inline-flex", alignItems:"center", gap:6 }}><StatusChip status={a.status} />{ps && <span title={a.portalStatus} style={{ display:"inline-flex" }}><MI style={{ fontSize:15, color:ps.c }}>{ps.i}</MI></span>}</span></td>
                <td>{a.hs!=null && P.HS[a.hs]
                  ? <span className="chip" style={{ background:P.HS[a.hs].bg, borderColor:P.HS[a.hs].bd, color:P.HS[a.hs].c, whiteSpace:"nowrap" }}>{a.hs}{" \u00b7 "}{HS_SCORE_LABELS[a.hs]}</span>
                  : <span className="muted">\u2014</span>}</td>
                <td style={{ textAlign:"right" }} className="num">{fmtMoney(a.cmrr)}</td>
                <td>{a.kocDate ? <span style={{ fontWeight:600, color:"var(--fg-2)" }}>{fmtDate(a.kocDate)}</span> : <span className="muted">\u2014</span>}</td>
                <td style={{ textAlign:"right", fontWeight:700, color: wk>35?"var(--red)":wk>21?"#E8915B":"var(--fg-2)" }}>{wk!=null?wk+"w":"\u2014"}</td>
                <td>{a.initialPgl ? (() => { const slip = a.pgl ? P.daysBetween(a.initialPgl, a.pgl) : 0; return <span style={{ fontWeight:600, color:"var(--fg-2)" }}>{fmtDate(a.initialPgl)}{slip>0 && <span title={slip+" days slipped from initial"} style={{ color: slip>14?"var(--red)":"var(--yellow)", fontWeight:700, marginLeft:4 }}>+{slip}d</span>}</span>; })() : <span className="muted">\u2014</span>}</td>
                <td>{a.status==="Live" && a.liveDate
                  ? <span style={{ fontWeight:700, color:"var(--green)", display:"inline-flex", alignItems:"center", gap:4 }}><MI style={{fontSize:14}}>check_circle</MI>{fmtDate(a.liveDate)}</span>
                  : <span style={{ fontWeight:600, color: pglOverdue(a)?"var(--red)":a.pgl?"var(--sky)":"var(--fg-4)" }}>{fmtDate(a.pgl)}{pglOverdue(a)&&<MI style={{fontSize:14, verticalAlign:"-2px", marginLeft:3}}>warning</MI>}</span>}</td>
                <td>{a.antTransitionDate
                  ? (() => { const overdue = new Date(a.antTransitionDate) < P.now && a.status!=="Hold"; return <span style={{ fontWeight:600, color: overdue?"var(--red)":"var(--sky)" }}>{fmtDate(a.antTransitionDate)}{overdue&&<MI style={{fontSize:14, verticalAlign:"-2px", marginLeft:3}}>warning</MI>}</span>; })()
                  : <span className="muted">—</span>}</td>
              </tr>;
            })}
          </tbody>
        </table>
        {rows.length===0 && <Empty icon="search_off" title="No matches" sub="Try a different search or filter." />}
      </div>
      )}
    </div>
  );
}

function AccountCard({ a, onOpen }) {
  const ps = a.portalStatus ? (P.PORTAL_STATUS[a.portalStatus]||{c:"var(--fg-3)",i:"help"}) : null;
  const wk = weeksIn(a.implStart);
  const transOverdue = a.antTransitionDate && new Date(a.antTransitionDate) < P.now && a.status!=="Hold";
  return (
    <div className="acct-card" onClick={()=>onOpen(a)}>
      <div style={{ display:"flex", alignItems:"flex-start", gap:8 }}>
        <div style={{ flex:1, minWidth:0 }}>
          <div className="acct-name" style={{ fontSize:14, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{a.tenant}</div>
          <div style={{ fontSize:11, color:"var(--fg-4)", fontWeight:600 }}>{a.trade}</div>
        </div>
        <HsChip hs={a.hs} mini />
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:6, marginTop:10, flexWrap:"wrap" }}>
        <StatusChip status={a.status} />
        {ps && <span title={a.portalStatus} style={{ display:"inline-flex" }}><MI style={{ fontSize:15, color:ps.c }}>{ps.i}</MI></span>}
        {a.escalation && a.escalation.open && <span title="Open escalation"><MI style={{ fontSize:15, color:"var(--red)" }}>warning</MI></span>}
        <BalanceBadge amount={a.outstandingBalance} sm />
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:12 }}>
        <Avatar name={a.ic} size={20} />
        <span style={{ fontSize:12, color:"var(--fg-2)", fontWeight:600, flex:1 }}>{firstName(a.ic)} {a.ic.split(" ")[1][0]}.</span>
        <EngScore score={a.engagementScore} withBar />
      </div>
      <div className="acct-card-foot">
        <div><div className="acl">CMRR</div><div className="acv">{fmtMoney(a.cmrr)}</div></div>
        <div><div className="acl">Go-Live</div><div className="acv" style={{ color: a.status==="Live"&&a.liveDate?"var(--green)":pglOverdue(a)?"var(--red)":"var(--sky)" }}>{a.status==="Live"&&a.liveDate?fmtDate(a.liveDate):fmtDate(a.pgl)}</div></div>
        <div><div className="acl">Transition</div><div className="acv" style={{ color: transOverdue?"var(--red)":"var(--sky)" }}>{fmtDate(a.antTransitionDate)}</div></div>
      </div>
    </div>
  );
}

function Signals_UNUSED() { return null; }

/* ============================ TEAM ============================ */
function Team({ accounts, onOpen, goTo, setIcFocus }) {
  const [period, setPeriod] = useStateM("current");
  const keys = periodKeys(period);
  const statsFor = (icName) => {
    let act=0, trans=0;
    keys.forEach(k => { const h=P.history[k]; if(h){ const b=h.byIc[icName]; if(b){ act+=b.act; trans+=b.trans; } } });
    return { act, trans };
  };
  const [expanded, setExpanded] = useStateM(null);
  const rows = P.team.map(t => {
    const mine = accounts.filter(a=>a.ic===t.name);
    const risk = mine.filter(isEsc);
    const esc = mine.filter(a=>a.escalation && a.escalation.open);
    const hsVals = mine.filter(a=>a.hs!=null).map(a=>a.hs);
    const avgHs = hsVals.length ? hsVals.reduce((s,v)=>s+v,0)/hsVals.length : null;
    const csVals = mine.filter(a=>a.csatAvg!=null).map(a=>a.csatAvg);
    const avgCsat = csVals.length ? csVals.reduce((s,v)=>s+v,0)/csVals.length : null;
    const { act, trans } = statsFor(t.name);
    const cmrr = mine.reduce((s,a)=>s+a.cmrr,0);
    const buckets = { good:0, mid:0, bad:0, none:0 };
    mine.forEach(a=>{ if(a.hs==null)buckets.none++; else if(a.hs>=5)buckets.good++; else if(a.hs>=4)buckets.mid++; else buckets.bad++; });
    const stage = { pre:0, imp:0, live:0, other:0 };
    mine.forEach(a=>{
      if(a.status==="Pre-Implementation") stage.pre++;
      else if(a.status==="Implementation") stage.imp++;
      else if(a.status==="Live") stage.live++;
      else stage.other++;
    });
    return { t, mine, risk, esc, avgHs, avgCsat, act, trans, cmrr, buckets, stage, tot: mine.length||1 };
  });
  const teamTotal = rows.reduce((o,r)=>{ o.act+=r.act; o.trans+=r.trans; o.pre+=r.stage.pre; o.imp+=r.stage.imp; o.live+=r.stage.live; o.other+=r.stage.other; o.accts+=r.mine.length; return o; }, {act:0,trans:0,pre:0,imp:0,live:0,other:0,accts:0});
  const col = (avg, kind) => avg==null ? "var(--fg-4)" : kind==="hs" ? (avg>=5?"var(--green)":avg>=4?"var(--sky)":"var(--red)") : (avg>=4?"var(--green)":avg>=3?"var(--yellow)":"var(--red)");

  return (
    <div className="view-enter">
      <div className="toolbar">
        <span style={{ fontSize:13, fontWeight:700, color:"var(--fg-3)" }}>Activations &amp; transitions for</span>
        <select className="select-sm" value={period} onChange={e=>setPeriod(e.target.value)}>
          <option value="current">This month</option>
          <option value="last">Last month</option>
          <option value="l3">Last 3 months</option>
          <option value="ytd">Year to date</option>
          <option value="l12">Last 12 months</option>
          <optgroup label="By month">
            {P.orderedKeys.slice().reverse().map(k => <option key={k} value={k}>{P.history[k].label}</option>)}
          </optgroup>
        </select>
        <span className="spacer" />
        <span className="count-note" style={{ marginRight:14 }}>Team accounts: <strong>{teamTotal.accts}</strong> · {teamTotal.pre} pre-imp · {teamTotal.imp} imp · {teamTotal.live} live{teamTotal.other>0 ? ` · ${teamTotal.other} other` : ""}</span>
        <span className="count-note">Team total: <strong style={{ color:"var(--green)" }}>{teamTotal.act}</strong> activations · <strong style={{ color:"var(--sky)" }}>{teamTotal.trans}</strong> transitions</span>
      </div>

      <div className="tbl-wrap">
        <table className="tbl">
          <thead><tr>
            <th>Consultant</th>
            <th style={{textAlign:"right"}}>Accts</th>
            <th style={{textAlign:"right"}} title="Pre-Implementation">Pre-Imp</th>
            <th style={{textAlign:"right"}} title="Implementation">Imp</th>
            <th style={{textAlign:"right"}} title="Live, including Hypercare, until moved to Success">Live</th>
            <th style={{textAlign:"right"}} title="Hold, No Payment Method, and any other status">Other</th>
            <th style={{textAlign:"right"}}>At Risk</th>
            <th style={{textAlign:"right"}}>Avg HS</th>
            <th style={{textAlign:"right"}}>CSAT</th>
            <th style={{textAlign:"right"}}>Activations</th>
            <th style={{textAlign:"right"}}>Transitions</th>
            <th>Health mix</th>
            <th style={{width:36}}></th>
          </tr></thead>
          <tbody>
            {rows.map(r => {
              const t = r.t, open = expanded===t.name;
              return <React.Fragment key={t.name}>
                <tr onClick={()=>setExpanded(open?null:t.name)} style={{ background: open?"var(--soft)":undefined }}>
                  <td><span style={{ display:"flex", alignItems:"center", gap:10 }}><Avatar name={t.name} size={28} />
                    <span><span style={{ fontWeight:700 }}>{t.name}</span> <span className="pill-tag" style={{ padding:"0 6px", fontSize:10 }}>{t.level}</span>
                    {t.onLeave && <span style={{ fontSize:11, color:"var(--fg-4)", marginLeft:6, fontWeight:700 }}>· {t.status}</span>}</span></span></td>
                  <td style={{textAlign:"right"}} className="num">{r.mine.length}</td>
                  <td style={{textAlign:"right"}} className="num">{r.stage.pre}</td>
                  <td style={{textAlign:"right"}} className="num">{r.stage.imp}</td>
                  <td style={{textAlign:"right"}} className="num">{r.stage.live}</td>
                  <td style={{textAlign:"right"}} className="num muted">{r.stage.other || "—"}</td>
                  <td style={{textAlign:"right"}}>{r.risk.length>0 ? <span style={{ color:"var(--red)", fontWeight:800, fontFamily:"var(--font-display)" }}>{r.risk.length}</span> : <span className="muted">—</span>}</td>
                  <td style={{textAlign:"right", fontWeight:700, fontFamily:"var(--font-display)", color:col(r.avgHs,"hs")}}>{r.avgHs!=null?r.avgHs.toFixed(1):"—"}</td>
                  <td style={{textAlign:"right", fontWeight:700, fontFamily:"var(--font-display)", color:col(r.avgCsat,"csat")}}>{r.avgCsat!=null?r.avgCsat.toFixed(1):"—"}</td>
                  <td style={{textAlign:"right"}} className="num">{r.act}</td>
                  <td style={{textAlign:"right"}} className="num">{r.trans}</td>
                  <td><div className="bar-stack" style={{ width:120, height:8 }}>
                    <span style={{ width:(r.buckets.good/r.tot*100)+"%", background:"var(--green)" }} />
                    <span style={{ width:(r.buckets.mid/r.tot*100)+"%", background:"var(--sky)" }} />
                    <span style={{ width:(r.buckets.bad/r.tot*100)+"%", background:"var(--red)" }} />
                    <span style={{ width:(r.buckets.none/r.tot*100)+"%", background:"var(--track-empty)" }} />
                  </div></td>
                  <td style={{textAlign:"right"}}><MI style={{ color:"var(--fg-3)", transition:"transform .2s" }}>{open?"expand_less":"expand_more"}</MI></td>
                </tr>
                {open && <tr><td colSpan={13} style={{ padding:0, background:"var(--soft)" }}>
                  <TeamExpand r={r} onOpen={onOpen} goTo={goTo} setIcFocus={setIcFocus} />
                </td></tr>}
              </React.Fragment>;
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
function TeamExpand({ r, onOpen, goTo, setIcFocus }) {
  const t = r.t;
  return <div style={{ padding:"16px 20px", display:"grid", gridTemplateColumns:"1fr 1fr", gap:24 }}>
    <div>
      <div className="eyebrow" style={{ marginBottom:11 }}>Portfolio breakdown</div>
      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        <BreakRow c="var(--green)" label="Healthy · HS 5–6" n={r.buckets.good} />
        <BreakRow c="var(--sky)" label="Watch · HS 4" n={r.buckets.mid} />
        <BreakRow c="var(--red)" label="At risk · HS ≤ 3" n={r.buckets.bad} />
        <BreakRow c="var(--track-empty)" label="No health score" n={r.buckets.none} />
      </div>
      <div style={{ marginTop:14, fontSize:12.5, color:"var(--fg-3)", fontWeight:700 }}>{fmtMoney(r.cmrr)} CMRR managed</div>
      <div style={{ display:"flex", gap:8, marginTop:14 }}>
        <button className="btn btn-sm" onClick={(e)=>{ e.stopPropagation(); setIcFocus(t.name); goTo("oneonone"); }}><MI>summarize</MI>1:1 Prep</button>
        <button className="btn btn-sm btn-ghost" onClick={(e)=>{ e.stopPropagation(); setIcFocus(t.name); goTo("portfolio"); }}>View accounts</button>
      </div>
    </div>
    <div>
      <div className="eyebrow" style={{ marginBottom:11, color:r.esc.length?"var(--red)":"var(--fg-3)" }}>Open escalations · {r.esc.length}</div>
      {r.esc.length===0 ? <div className="hint">No open escalations.</div> :
        r.esc.slice().sort((a,b)=>P.ageDays(b.escalation.opened)-P.ageDays(a.escalation.opened)).map(a =>
          <div key={a.id} className="row" style={{ padding:"6px 0", cursor:"pointer" }} onClick={(e)=>{ e.stopPropagation(); onOpen(a); }}>
            <AgePill days={P.ageDays(a.escalation.opened)} />
            <span style={{ fontWeight:700, flex:1, fontSize:12.5, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{a.tenant}</span>
            <HsChip hs={a.hs} />
          </div>)}
    </div>
  </div>;
}
function BreakRow({ c, label, n }) {
  return <div style={{ display:"flex", alignItems:"center", gap:9, fontSize:12.5 }}><span className="flag-dot" style={{ background:c }} /><span style={{ flex:1, color:"var(--fg-2)", fontWeight:600 }}>{label}</span><span style={{ fontWeight:800 }}>{n}</span></div>;
}
function periodKeys(period){
  const ok = P.orderedKeys, n = ok.length;
  if(period==="current") return [P.currentKey];
  if(period==="last") return [ok[n-2]];
  if(period==="l3") return ok.slice(n-3);
  if(period==="l12") return ok.slice();
  if(period==="ytd") return ok.filter(k => k.startsWith(String(P.now.getFullYear())));
  return [period];
}

/* ============================ PIPELINE ============================ */
function Pipeline({ accounts, onOpen }) {
  const [kind, setKind] = useStateM("both");
  const monday = P.monday;
  // today as a local-midnight Date to avoid UTC timezone shifting date strings back one day
  const todayMidnight = new Date(P.now.getFullYear(), P.now.getMonth(), P.now.getDate());
  const groups = [
    { key:"overdue", label:"Overdue", icon:"warning", color:"var(--red)" },
    { key:"w0", label:"This Week", icon:"event", color:"var(--green)" },
    { key:"w1", label:"Next Week", icon:"event_upcoming", color:"var(--sky)" },
    { key:"later", label:"Later (2–6 weeks)", icon:"calendar_month", color:"var(--fg-3)" },
  ];
  // Parse a date string to local midnight — prevents UTC parsing shifting June 29 to June 28
  const toLocal = (d) => { const x = new Date(d+"T12:00:00"); return new Date(x.getFullYear(), x.getMonth(), x.getDate()); };
  // Offset in days from Monday (for week grouping); separate from overdue which uses today
  const offset = (d) => Math.floor((toLocal(d) - monday)/86400000);
  const isOverdue = (d) => toLocal(d) < todayMidnight;
  const bucket = (d) => {
    if (isOverdue(d)) return "overdue";
    const off = offset(d);
    if (off < 5) return "w0";
    if (off < 10) return "w1";
    return "later";
  };
  const items = [];
  accounts.forEach(a => {
    if ((kind==="both"||kind==="golive") && a.pgl && a.status!=="Live" && a.status!=="Hold") items.push({ a, date:a.pgl, type:"golive", bkt:bucket(a.pgl) });
    // Projected transition = the anticipated success transition date. Accounts that
    // actually transition leave the active list, so transitionDate is empty here.
    if ((kind==="both"||kind==="transition") && a.antTransitionDate && !a.transitioned && a.status!=="Hold") items.push({ a, date:a.antTransitionDate, type:"transition", bkt:bucket(a.antTransitionDate) });
  });

  const golivesThisWeek = items.filter(i=>i.type==="golive" && i.bkt==="w0").length;
  const transThisWeek = items.filter(i=>i.type==="transition" && i.bkt==="w0").length;
  const overdue = items.filter(i=>i.bkt==="overdue" && i.type==="golive").length;

  return (
    <div className="view-enter">
      <div className="kpi-grid" style={{ gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))" }}>
        <KPI icon="rocket_launch" label="Go-Lives This Week" value={golivesThisWeek} accent="var(--green)" foot={`week of ${fmtDate(monday)}`} footDir="flat" />
        <KPI icon="swap_horiz" label="Transitions This Week" value={transThisWeek} accent="var(--sky)" foot="to Success team" footDir="flat" />
        <KPI icon="event_busy" label="Overdue Go-Lives" value={overdue} accent="var(--red)" foot="past projected date" footDir={overdue?"dn":"flat"} />
      </div>

      <div className="toolbar">
        <div className="seg">
          {[["both","All events"],["golive","Go-lives"],["transition","Transitions"]].map(([k,lb])=><button key={k} className={kind===k?"on":""} onClick={()=>setKind(k)}>{lb}</button>)}
        </div>
        <span className="spacer" />
        <span className="hint"><MI style={{fontSize:14, verticalAlign:"-2px", color:"var(--green)"}}>circle</MI> Go-live &nbsp; <MI style={{fontSize:14, verticalAlign:"-2px", color:"var(--sky)"}}>circle</MI> Transition</span>
        {kind !== "golive" && (
          <span className="legend-hover" tabIndex={0} style={{ marginLeft:8 }}>
            <MI style={{ fontSize:17 }}>info</MI>
            <div className="legend-pop">
              <div className="lp-title">Transition status</div>
              {Object.entries(P.TRANSITION_STATUS).map(([k,v]) => (
                <div key={k} className="lp-row">
                  <MI className="lp-icon" style={{ color:v.c }}>{v.i}</MI>
                  <div><div className="lp-name">{k} <span style={{ color:"var(--fg-4)", fontWeight:600 }}>· {v.short}</span></div><div className="lp-desc">{v.desc}</div></div>
                </div>
              ))}
              <div className="lp-foot"><MI style={{ fontSize:13, color:"var(--yellow)" }}>warning</MI> Amber flag = stuck past 24h SLA (Mon–Fri)</div>
            </div>
          </span>
        )}
      </div>

      <div className="col" style={{ gap:18 }}>
        {groups.map(g => {
          const gi = items.filter(i => i.bkt===g.key).sort((x,y)=>new Date(x.date)-new Date(y.date));
          if (gi.length===0 && g.key==="overdue") return null;
          return (
            <div key={g.key}>
              <div className="section-title" style={{ fontSize:15, marginBottom:10, color:g.color }}><MI>{g.icon}</MI>{g.label}<span style={{ fontSize:12, color:"var(--fg-4)", fontWeight:700 }}>· {gi.length}</span></div>
              {gi.length===0 ? <div className="hint" style={{ paddingLeft:26 }}>Nothing scheduled.</div> : (
                <div className="tbl-wrap">
                  {gi.map((i,idx) => {
                    const a=i.a, isGl=i.type==="golive", c=isGl?"var(--green)":"var(--sky)";
                    return <div key={idx} className="lrow" onClick={()=>onOpen(a)} style={{ padding:"12px 16px" }}>
                      <div style={{ width:50, flexShrink:0, textAlign:"center" }}>
                        <div style={{ fontFamily:"var(--font-display)", fontWeight:700, fontSize:18, color:i.off<0?"var(--red)":"var(--fg-1)", lineHeight:1 }}>{new Date(i.date).getDate()}</div>
                        <div style={{ fontSize:10, color:"var(--fg-3)", fontWeight:700, textTransform:"uppercase" }}>{new Date(i.date).toLocaleDateString("en-US",{month:"short"})}</div>
                      </div>
                      <span className="chip" style={{ background: isGl?"rgba(52,201,123,.12)":"rgba(34,112,238,.12)", color:c, borderColor:"transparent", width:96, justifyContent:"center" }}><MI>{isGl?"rocket_launch":"swap_horiz"}</MI>{isGl?"Go-Live":"Transition"}</span>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div className="acct-name" style={{ fontSize:13.5 }}>{a.tenant}</div>
                        <div style={{ fontSize:11.5, color:"var(--fg-3)", fontWeight:600 }}>{a.trade} · {fmtMoney(a.cmrr)} CMRR · {a.techs} techs</div>
                      </div>
                      {!isGl && a.successTransitionStatus && (() => {
                        const ts = P.TRANSITION_STATUS[a.successTransitionStatus];
                        const col = ts ? ts.c : "var(--fg-3)";
                        const hrs = a.transitionStatusUpdatedAt ? P.weekdayHoursBetween(a.transitionStatusUpdatedAt, P.now) : null;
                        const stale = hrs != null && hrs >= 24 && (a.successTransitionStatus === "Needs CSM" || a.successTransitionStatus === "Needs CSM Review");
                        return <span className="chip" title={(ts ? ts.desc : a.successTransitionStatus) + (stale ? ` · stuck ${hrs}h (24h SLA)` : "")}
                          style={{ background:"var(--soft)", borderColor:col, color:col }}>
                          <MI>{ts ? ts.i : "help"}</MI>{ts ? ts.short : a.successTransitionStatus}{stale && <MI style={{ fontSize:13, color:"var(--yellow)", marginLeft:2 }}>warning</MI>}</span>;
                      })()}
                      <HsChip hs={a.hs} />
                      <span style={{ display:"flex", alignItems:"center", gap:6, width:130 }}><Avatar name={a.ic} size={20} /><span style={{ fontSize:12, color:"var(--fg-2)", fontWeight:600 }}>{firstName(a.ic)} {a.ic.split(" ")[1][0]}.</span></span>
                      {i.off<0 && isGl && <span className="chip" style={{ background:"rgba(226,79,79,.14)", color:"var(--red)", borderColor:"rgba(226,79,79,.4)" }}>{Math.abs(i.off)}d late</span>}
                    </div>;
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ============================ ACCOUNTS (list + pipeline) ============================ */
function AccountsView({ accounts, onOpen, senior }) {
  const [mode, setMode] = useStateM("table");
  return (
    <div className="view-enter">
      <div className="seg" style={{ marginBottom:18 }}>
        <button className={mode==="table"?"on":""} onClick={()=>setMode("table")}><MI style={{fontSize:17, verticalAlign:"-3px", marginRight:5}}>list_alt</MI>List</button>
        <button className={mode==="cards"?"on":""} onClick={()=>setMode("cards")}><MI style={{fontSize:17, verticalAlign:"-3px", marginRight:5}}>grid_view</MI>Cards</button>
        <button className={mode==="pipeline"?"on":""} onClick={()=>setMode("pipeline")}><MI style={{fontSize:17, verticalAlign:"-3px", marginRight:5}}>timeline</MI>Pipeline</button>
      </div>
      {mode==="pipeline" ? <Pipeline accounts={accounts} onOpen={onOpen} /> : <Portfolio accounts={accounts} onOpen={onOpen} mode={mode} senior={senior} />}
    </div>
  );
}

/* ============================ 1:1 PREP ============================ */
// This-week calendar summary for the selected IC. Renders only when Google
// Calendar is connected; counts KOCs, go-live check-ins, and transition calls.
function ICWeekCalendar({ ic }) {
  const status = window.useCalStatus ? window.useCalStatus() : null;
  const [data, setData] = React.useState(null);
  const [showAll, setShowAll] = React.useState(false);  // default: customer calls only
  const connected = !!(status && status.connected);
  React.useEffect(() => {
    if (!connected) return;
    setData(null);
    fetch("/api/calendar/ic-week?ic=" + encodeURIComponent(ic)).then(r=>r.json()).then(setData).catch(()=>setData({error:"failed"}));
  }, [ic, connected]);
  if (!connected) return null;
  const koc = (data && data.koc) || [], gl = (data && data.goLive) || [], tr = (data && data.transition) || [];
  const Stat = ({ n, label, color }) => (
    <div style={{ flex:1, textAlign:"center" }}>
      <div style={{ fontFamily:"var(--font-display)", fontWeight:700, fontSize:24, color }}>{n}</div>
      <div style={{ fontSize:10.5, color:"var(--fg-3)", fontWeight:700, marginTop:2 }}>{label}</div>
    </div>
  );
  return (
    <Card title="This week (calendar)">
      {data && data.error === "no_ic_email" ? <Empty icon="alternate_email" title="No calendar email on file" sub="Can't match this IC's calendar." /> :
       data && data.error === "calendar_access_denied" ? <Empty icon="lock" title="Calendar not shared" sub="This IC hasn't shared their calendar with you." /> :
       !data ? <div style={{ padding:"16px", fontSize:12.5, color:"var(--fg-3)" }}>Loading calendar…</div> : <>
        <div style={{ display:"flex", padding:"14px 8px 6px", gap:8 }}>
          <Stat n={koc.length} label="KOCs booked" color="var(--sky)" />
          <Stat n={gl.length} label="Go-live check-ins" color="var(--green)" />
          <Stat n={tr.length} label="Transition calls booked" color="var(--purple)" />
        </div>
        {(() => {
          const allEvents = data.events || [];
          const custEvents = allEvents.filter(e => e.isCustomerCall);
          const shown = showAll ? allEvents : custEvents;
          const otherCount = allEvents.length - custEvents.length;
          return (
            <div style={{ padding:"4px 8px 2px" }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, padding:"4px 6px 6px" }}>
                <span style={{ fontSize:11, fontWeight:800, letterSpacing:".4px", textTransform:"uppercase", color:"var(--fg-4)" }}>
                  {showAll ? "All events" : "Customer calls"} ({shown.length})</span>
                <span style={{ flex:1 }} />
                {otherCount > 0 && <button className="btn btn-sm btn-ghost" onClick={()=>setShowAll(s=>!s)}>
                  <MI style={{ fontSize:15 }}>{showAll ? "filter_alt" : "expand_more"}</MI>{showAll ? "Customer only" : "Show all (" + allEvents.length + ")"}</button>}
              </div>
              {shown.length === 0
                ? <Empty icon="event_busy" title={showAll ? "No calls scheduled this week" : "No customer calls this week"} sub={!showAll && otherCount > 0 ? otherCount + " internal event" + (otherCount!==1?"s":"") + " hidden" : null} />
                : shown.map(ev => <window.EventRow key={ev.id} ev={ev} compact />)}
            </div>
          );
        })()}
      </>}
    </Card>
  );
}

function OneOnOne({ accounts, onOpen, icFocus, setIcFocus }) {
  const ic = icFocus || P.team[0].name;
  // 1:1 talking points (added here or from an account page), stored per IC.
  const [notes, setNotes] = React.useState([]);
  const [noteText, setNoteText] = React.useState("");
  const reloadNotes = () => fetch("/api/oneonone-notes?ic=" + encodeURIComponent(ic))
    .then(r => r.json()).then(d => setNotes(Array.isArray(d) ? d : [])).catch(() => setNotes([]));
  React.useEffect(() => { reloadNotes(); }, [ic]);
  const addNote = () => {
    if (!noteText.trim()) return;
    fetch("/api/oneonone-notes/add", { method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ ic, text: noteText.trim() }) })
      .then(r=>r.json()).then(() => { setNoteText(""); reloadNotes(); }).catch(()=>{});
  };
  const toggleNote = (n) => fetch("/api/oneonone-notes/update", { method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ ic, id: n.id, done: !n.done }) }).then(() => reloadNotes()).catch(()=>{});
  const delNote = (n) => fetch("/api/oneonone-notes/delete", { method:"POST", headers:{"Content-Type":"application/json"},
    body: JSON.stringify({ ic, id: n.id }) }).then(() => reloadNotes()).catch(()=>{});
  const monthOf = (d) => d && new Date(d).getMonth()===P.now.getMonth();
  const mine = accounts.filter(a=>a.ic===ic);
  const esc = mine.filter(a=>a.escalation && a.escalation.open).sort((a,b)=>P.ageDays(b.escalation.opened)-P.ageDays(a.escalation.opened));
  const risk = mine.filter(isEsc);
  const followUps = mine.filter(a=>a.followUpDate && Math.ceil((new Date(a.followUpDate)-P.now)/86400000)<=7).sort((a,b)=>new Date(a.followUpDate)-new Date(b.followUpDate));
  const goLives = mine.filter(a=>a.pgl && a.status!=="Live" && a.status!=="Hold" && new Date(a.pgl)>=P.now && new Date(a.pgl)<P.addDays(P.now,14)).sort((a,b)=>new Date(a.pgl)-new Date(b.pgl));
  const openAI = []; mine.forEach(a=>a.actionItems.filter(x=>!x.done).forEach(x=>openAI.push({a,x})));
  const csVals = mine.filter(a=>a.csatAvg!=null);
  const avgCsat = csVals.length ? (csVals.reduce((s,a)=>s+a.csatAvg,0)/csVals.length) : null;
  const lowCsat = mine.filter(a=>a.csatAvg!=null && a.csatAvg<3);
  const hsVals = mine.filter(a=>a.hs!=null).map(a=>a.hs);
  const avgHs = hsVals.length?(hsVals.reduce((s,v)=>s+v,0)/hsVals.length):null;

  return (
    <div className="view-enter">
      <div className="toolbar">
        <span style={{ fontSize:13, fontWeight:700, color:"var(--fg-3)" }}>Prep for 1:1 with</span>
        <select className="select-sm" value={ic} onChange={e=>setIcFocus(e.target.value)} style={{ fontSize:14 }}>
          {P.team.map(t=><option key={t.name} value={t.name}>{t.name}</option>)}
        </select>
        <span className="spacer" />
        <button className="btn btn-sm btn-ghost" onClick={()=>window.print()}><MI>print</MI>Print</button>
      </div>

      <div className="card card-pad" style={{ display:"flex", gap:16, alignItems:"center", marginBottom:18 }}>
        <Avatar name={ic} size={52} />
        <div style={{ flex:1 }}>
          <div style={{ fontFamily:"var(--font-display)", fontWeight:600, fontSize:20, letterSpacing:"-.4px" }}>{ic}</div>
          <div style={{ fontSize:12.5, color:"var(--fg-3)", fontWeight:600 }}>Implementation Consultant · {mine.length} active accounts</div>
        </div>
        <div style={{ display:"flex", gap:24 }}>
          <HeadStat v={risk.length} l="At risk" c={risk.length?"var(--red)":"var(--green)"} />
          <HeadStat v={avgHs!=null?avgHs.toFixed(1):"\u2014"} l="Avg health" c={avgHs>=5?"var(--green)":avgHs>=4?"var(--sky)":"var(--red)"} />
          <HeadStat v={avgCsat!=null?avgCsat.toFixed(1):"\u2014"} l="Avg CSAT" c={avgCsat>=4?"var(--green)":avgCsat>=3?"var(--yellow)":"var(--red)"} />
          <HeadStat v={mine.filter(a=>monthOf(a.liveDate)).length} l="Activations" c="var(--fg-1)" />
        </div>
      </div>

      <div className="grid-2" style={{ alignItems:"start" }}>
        <div className="col" style={{ gap:16 }}>
          <Card title="Escalations to discuss" count={esc.length}>
            {esc.length===0 ? <Empty icon="verified" title="No open escalations" /> :
              esc.map(a => <div className="lrow" key={a.id} onClick={()=>onOpen(a)}>
                <AgePill days={P.ageDays(a.escalation.opened)} />
                <div style={{ flex:1, minWidth:0 }}><div className="acct-name" style={{ fontSize:13.5 }}>{a.tenant}</div>
                  <div style={{ fontSize:11.5, color:"var(--fg-3)", marginTop:2, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", maxWidth:320 }}>{a.escalation.nextAction||a.escalation.reason}</div></div>
                <HsChip hs={a.hs} />
              </div>)}
          </Card>
          <Card title="Upcoming go-lives (14d)" count={goLives.length}>
            {goLives.length===0 ? <Empty icon="event_available" title="None scheduled" /> :
              goLives.map(a => <div className="lrow" key={a.id} onClick={()=>onOpen(a)}>
                <span className="chip" style={{ background:"rgba(52,201,123,.12)", color:"var(--green)", borderColor:"transparent" }}>{fmtDate(a.pgl)}</span>
                <span className="acct-name" style={{ fontSize:13.5, flex:1 }}>{a.tenant}</span>
                <span style={{ fontSize:11.5, color:"var(--fg-3)", fontWeight:700 }}>{relDay(a.pgl)}</span>
              </div>)}
          </Card>
          <ICWeekCalendar ic={ic} />
          <Card title="All accounts" count={mine.length}>
            {mine.length===0 ? <Empty icon="inbox" title="No active accounts" /> :
              mine.slice().sort((a,b)=>(a.hs??99)-(b.hs??99)).map(a => {
                const openT = (a.actionItems||[]).filter(t=>!t.done).length;
                const notesN = (a.noteLog||[]).length;
                return <div className="lrow" key={a.id} onClick={()=>onOpen(a)} style={{ cursor:"pointer", alignItems:"center" }}>
                  {a.hs!=null ? <HsChip hs={a.hs} mini /> : <span style={{ width:4 }} />}
                  <div style={{ flex:1, minWidth:0 }}>
                    <div className="acct-name" style={{ fontSize:13.5 }}>{a.tenant}</div>
                    <div style={{ marginTop:2 }}><StatusChip status={a.status} /></div>
                  </div>
                  {openT>0 && <span className="chip" title={openT+" open task"+(openT!==1?"s":"")} style={{ fontSize:10.5, background:"var(--soft)", borderColor:"transparent", color:"var(--fg-2)" }}><MI style={{ fontSize:12 }}>checklist</MI>{openT}</span>}
                  {notesN>0 && <span className="chip" title={notesN+" note"+(notesN!==1?"s":"")} style={{ fontSize:10.5, background:"var(--soft)", borderColor:"transparent", color:"var(--fg-2)" }}><MI style={{ fontSize:12 }}>sticky_note_2</MI>{notesN}</span>}
                  <MI style={{ color:"var(--fg-4)", fontSize:18, flexShrink:0 }}>chevron_right</MI>
                </div>;
              })}
          </Card>
        </div>
        <div className="col" style={{ gap:16 }}>
          <Card title="Talking points" count={notes.filter(n=>!n.done).length}>
            <div style={{ display:"flex", gap:8, padding:"10px 14px", borderBottom: notes.length?"1px solid var(--line)":"none" }}>
              <input className="inp" value={noteText} placeholder="Add a talking point for this 1:1…"
                onChange={e=>setNoteText(e.target.value)} onKeyDown={e=>{ if(e.key==="Enter") addNote(); }} />
              <button className="btn btn-sm btn-primary" onClick={addNote} disabled={!noteText.trim()}><MI>add</MI>Add</button>
            </div>
            {notes.length===0 ? <Empty icon="sticky_note_2" title="No talking points yet" sub="Add one above, or from an account's page." /> :
              notes.map(n => (
                <div className="lrow" key={n.id} style={{ alignItems:"flex-start", padding:"9px 14px" }}>
                  <span className={"chk"+(n.done?" on":"")} onClick={()=>toggleNote(n)} style={{ cursor:"pointer" }}>{n.done && <MI>check</MI>}</span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:600, color:n.done?"var(--fg-4)":"var(--fg-1)", textDecoration:n.done?"line-through":"none" }}>{n.text}</div>
                    {n.accountName && <div style={{ fontSize:11, color:"var(--fg-4)", marginTop:2, cursor: n.accountId?"pointer":"default" }}
                      onClick={()=>{ const acct=accounts.find(x=>x.id===n.accountId); if(acct) onOpen(acct); }}>{n.accountName}</div>}
                  </div>
                  <button className="btn icon-btn btn-ghost btn-sm" onClick={()=>delNote(n)}><MI>close</MI></button>
                </div>
              ))}
          </Card>
          <Card title={"Assign a task to " + firstName(ic)}>
            <div style={{ padding:"12px 14px" }}>
              <window.AssignTaskForm defaultAssignee={ic} onCreated={()=>{}} />
            </div>
          </Card>
          <Card title="Follow-ups & open actions" count={followUps.length + openAI.length}>
            {followUps.length===0 && openAI.length===0 ? <Empty icon="task_alt" title="Nothing outstanding" /> : <>
              {followUps.map(a => <div className="lrow" key={"f"+a.id} onClick={()=>onOpen(a)}>
                <MI style={{ color:"var(--sky)" }}>event</MI>
                <span className="acct-name" style={{ fontSize:13, flex:1 }}>{a.tenant}</span>
                <span style={{ fontSize:11.5, color: new Date(a.followUpDate)<P.now?"var(--red)":"var(--fg-3)", fontWeight:700 }}>{relDay(a.followUpDate)}</span>
              </div>)}
              {openAI.slice(0,6).map(({a,x},i) => <div className="lrow" key={"a"+i} onClick={()=>onOpen(a)} style={{ padding:"9px 14px" }}>
                <span className="chk" style={{ cursor:"default" }} />
                <div style={{ flex:1, minWidth:0 }}><div style={{ fontSize:12.5, fontWeight:600, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{x.text}</div>
                  <div style={{ fontSize:11, color:"var(--fg-4)" }}>{a.tenant}</div></div>
                {x.due && <span style={{ fontSize:11, color:new Date(x.due)<P.now?"var(--red)":"var(--fg-3)", fontWeight:700 }}>{relDay(x.due)}</span>}
              </div>)}
            </>}
          </Card>
          {lowCsat.length>0 && (
            <Card title="Low CSAT to address" count={lowCsat.length}>
              {lowCsat.map(a => <div className="lrow" key={a.id} onClick={()=>onOpen(a)}>
                <span style={{ fontFamily:"var(--font-display)", fontWeight:700, color:"var(--red)", fontSize:16, width:34 }}>{a.csatAvg.toFixed(1)}</span>
                <span className="acct-name" style={{ fontSize:13, flex:1 }}>{a.tenant}</span>
                <Stars score={a.csatAvg} />
              </div>)}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
function HeadStat({ v, l, c }) {
  return <div style={{ textAlign:"center" }}><div style={{ fontFamily:"var(--font-display)", fontWeight:700, fontSize:24, letterSpacing:"-1px", color:c }}>{v}</div><div style={{ fontSize:10.5, color:"var(--fg-3)", fontWeight:700, textTransform:"uppercase", letterSpacing:".4px" }}>{l}</div></div>;
}

/* ===================== SENIOR 1:1 PREP (per direct-report manager) =====================
   Mirrors OneOnOne but one altitude up: the dropdown lists her direct-report
   managers (from each IC's .manager), and every stat aggregates that manager's
   whole team — at-risk accounts, avg health, compliance issues, go-lives, and a
   per-IC breakdown. Talking points reuse /api/oneonone-notes keyed by the
   manager's name. */
function seniorComplianceFlags(a) {
  let n = 0;
  if (a.hs == null && a.status !== "Pre-Implementation") n++;
  if (a.hs != null && !a.hsComment) n++;
  if (a.hsLastUpdated && P.ageDays(a.hsLastUpdated) > window.HS_STALE_DAYS) n++;
  if (a.pgl && new Date(a.pgl) < P.now && a.status !== "Live" && a.status !== "Hold") n++;
  if (a.antTransitionDate && new Date(a.antTransitionDate) < P.now && !a.transitioned && a.status !== "Hold") n++;
  return n;
}
function SeniorOneOnOne({ accounts, onOpen, goToCompliance, mgrFocus, setMgrFocus }) {
  const managers = Array.from(new Set((P.team || []).map(t => t.manager).filter(Boolean))).sort();
  const [localMgr, setLocalMgr] = React.useState(mgrFocus && managers.includes(mgrFocus) ? mgrFocus : (managers[0] || ""));
  const mgr = (mgrFocus && managers.includes(mgrFocus)) ? mgrFocus : localMgr;
  const pick = (m) => { setLocalMgr(m); if (setMgrFocus) setMgrFocus(m); };

  const [notes, setNotes] = React.useState([]);
  const [noteText, setNoteText] = React.useState("");
  const reloadNotes = () => fetch("/api/oneonone-notes?ic=" + encodeURIComponent(mgr)).then(r => r.json()).then(d => setNotes(Array.isArray(d) ? d : [])).catch(() => setNotes([]));
  React.useEffect(() => { if (mgr) reloadNotes(); }, [mgr]);
  const addNote = () => { if (!noteText.trim()) return; fetch("/api/oneonone-notes/add", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ ic:mgr, text:noteText.trim() }) }).then(r=>r.json()).then(()=>{ setNoteText(""); reloadNotes(); }).catch(()=>{}); };
  const toggleNote = (n) => fetch("/api/oneonone-notes/update", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ ic:mgr, id:n.id, done:!n.done }) }).then(()=>reloadNotes()).catch(()=>{});
  const delNote = (n) => fetch("/api/oneonone-notes/delete", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ ic:mgr, id:n.id }) }).then(()=>reloadNotes()).catch(()=>{});

  if (!managers.length) return <div className="view-enter"><Empty icon="supervisor_account" title="No managers found" sub="No direct-report managers detected under your team." /></div>;

  const monthOf = (d) => d && new Date(d).getMonth() === P.now.getMonth() && new Date(d).getFullYear() === P.now.getFullYear();
  const mine = accounts.filter(a => a.manager === mgr);
  const ics = Array.from(new Set(mine.map(a => a.ic).filter(Boolean)));
  const esc = mine.filter(a => a.escalation && a.escalation.open).sort((a,b)=>P.ageDays(b.escalation.opened)-P.ageDays(a.escalation.opened));
  const risk = mine.filter(isEsc);
  const goLives = mine.filter(a => a.pgl && a.status !== "Live" && a.status !== "Hold" && new Date(a.pgl) >= P.now && new Date(a.pgl) < P.addDays(P.now, 14)).sort((a,b)=>new Date(a.pgl)-new Date(b.pgl));
  const compAccts = mine.filter(a => seniorComplianceFlags(a) > 0).sort((a,b)=>seniorComplianceFlags(b)-seniorComplianceFlags(a));
  const compCount = mine.reduce((s,a)=>s+seniorComplianceFlags(a),0);
  const hsVals = mine.filter(a=>a.hs!=null).map(a=>a.hs);
  const avgHs = hsVals.length ? hsVals.reduce((s,v)=>s+v,0)/hsVals.length : null;
  const activations = mine.filter(a=>monthOf(a.liveDate)).length;
  const icRows = ics.map(ic => {
    const ia = mine.filter(a=>a.ic===ic);
    return { ic, n: ia.length, risk: ia.filter(isEsc).length, comp: ia.reduce((s,a)=>s+seniorComplianceFlags(a),0) };
  }).sort((a,b)=> b.comp - a.comp || b.risk - a.risk || b.n - a.n);

  return (
    <div className="view-enter">
      <div className="toolbar">
        <span style={{ fontSize:13, fontWeight:700, color:"var(--fg-3)" }}>Prep for 1:1 with</span>
        <select className="select-sm" value={mgr} onChange={e=>pick(e.target.value)} style={{ fontSize:14 }}>
          {managers.map(m=><option key={m} value={m}>{m}</option>)}
        </select>
        <span className="spacer" />
        <button className="btn btn-sm btn-ghost" onClick={()=>window.print()}><MI>print</MI>Print</button>
      </div>

      <div className="card card-pad" style={{ display:"flex", gap:16, alignItems:"center", marginBottom:18 }}>
        <Avatar name={mgr} size={52} />
        <div style={{ flex:1 }}>
          <div style={{ fontFamily:"var(--font-display)", fontWeight:600, fontSize:20, letterSpacing:"-.4px" }}>{mgr}</div>
          <div style={{ fontSize:12.5, color:"var(--fg-3)", fontWeight:600 }}>Manager · {ics.length} ICs · {mine.length} active accounts</div>
        </div>
        <div style={{ display:"flex", gap:24 }}>
          <HeadStat v={risk.length} l="At risk" c={risk.length?"var(--red)":"var(--green)"} />
          <HeadStat v={avgHs!=null?avgHs.toFixed(1):"—"} l="Avg health" c={avgHs>=5?"var(--green)":avgHs>=4?"var(--sky)":"var(--red)"} />
          <HeadStat v={compCount} l="Compliance" c={compCount?"var(--red)":"var(--green)"} />
          <HeadStat v={activations} l="Activations" c="var(--fg-1)" />
        </div>
      </div>

      <div className="grid-2" style={{ alignItems:"start" }}>
        <div className="col" style={{ gap:16 }}>
          <Card title="Escalations to discuss" count={esc.length}>
            {esc.length===0 ? <Empty icon="verified" title="No open escalations" /> :
              esc.map(a => <div className="lrow" key={a.id} onClick={()=>onOpen(a)}>
                <AgePill days={P.ageDays(a.escalation.opened)} />
                <div style={{ flex:1, minWidth:0 }}><div className="acct-name" style={{ fontSize:13.5 }}>{a.tenant}</div>
                  <div style={{ fontSize:11.5, color:"var(--fg-3)", marginTop:2, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", maxWidth:320 }}>{firstName(a.ic)} · {a.escalation.nextAction||a.escalation.reason}</div></div>
                <HsChip hs={a.hs} />
              </div>)}
          </Card>
          <Card title="Compliance issues to chase" count={compCount}
            action={goToCompliance ? <button className="btn btn-sm btn-ghost" onClick={()=>goToCompliance()}>All <MI>arrow_forward</MI></button> : null}>
            {compAccts.length===0 ? <Empty icon="verified" title="All compliant" /> :
              compAccts.slice(0,8).map(a => <div className="lrow" key={a.id} onClick={()=>onOpen(a)}>
                <span className="chip" style={{ background:"var(--tint-red-10)", color:"var(--red)", borderColor:"transparent" }}>{seniorComplianceFlags(a)}</span>
                <div style={{ flex:1, minWidth:0 }}><div className="acct-name" style={{ fontSize:13.5 }}>{a.tenant}</div>
                  <div style={{ fontSize:11.5, color:"var(--fg-3)", marginTop:2 }}>{firstName(a.ic)}</div></div>
                <StatusChip status={a.status} />
              </div>)}
          </Card>
          <Card title="Upcoming go-lives (14d)" count={goLives.length}>
            {goLives.length===0 ? <Empty icon="event_available" title="None scheduled" /> :
              goLives.map(a => <div className="lrow" key={a.id} onClick={()=>onOpen(a)}>
                <span className="chip" style={{ background:"rgba(52,201,123,.12)", color:"var(--green)", borderColor:"transparent" }}>{fmtDate(a.pgl)}</span>
                <span className="acct-name" style={{ fontSize:13.5, flex:1 }}>{a.tenant}</span>
                <span style={{ fontSize:11.5, color:"var(--fg-3)", fontWeight:700 }}>{firstName(a.ic)}</span>
              </div>)}
          </Card>
        </div>
        <div className="col" style={{ gap:16 }}>
          <Card title={"ICs on " + firstName(mgr) + "'s team"} count={ics.length}>
            {icRows.length===0 ? <Empty icon="groups" title="No ICs" /> :
              icRows.map(r => <div className="lrow" key={r.ic} style={{ alignItems:"center" }}>
                <Avatar name={r.ic} size={26} />
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:13.5, fontWeight:700 }}>{r.ic}</div>
                  <div style={{ fontSize:11.5, color:"var(--fg-3)" }}>{r.n} active account{r.n!==1?"s":""}</div>
                </div>
                {r.risk>0 && <span className="chip" title={r.risk+" at risk"} style={{ fontSize:10.5, background:"var(--tint-red-10)", color:"var(--red)", borderColor:"transparent" }}><MI style={{fontSize:12}}>warning</MI>{r.risk}</span>}
                {r.comp>0 && <span className="chip" title={r.comp+" compliance issues"} style={{ fontSize:10.5, background:"var(--soft)", color:"var(--fg-2)", borderColor:"transparent" }}><MI style={{fontSize:12}}>rule</MI>{r.comp}</span>}
              </div>)}
          </Card>
          <Card title="Talking points" count={notes.filter(n=>!n.done).length}>
            <div style={{ display:"flex", gap:8, padding:"10px 14px", borderBottom: notes.length?"1px solid var(--line)":"none" }}>
              <input className="inp" value={noteText} placeholder={"Add a talking point for "+firstName(mgr)+"…"} onChange={e=>setNoteText(e.target.value)} onKeyDown={e=>{ if(e.key==="Enter") addNote(); }} />
              <button className="btn btn-sm btn-primary" onClick={addNote} disabled={!noteText.trim()}><MI>add</MI>Add</button>
            </div>
            {notes.length===0 ? <Empty icon="sticky_note_2" title="No talking points yet" sub="Add one above, or from an account's page." /> :
              notes.map(n => (
                <div className="lrow" key={n.id} style={{ alignItems:"flex-start", padding:"9px 14px" }}>
                  <span className={"chk"+(n.done?" on":"")} onClick={()=>toggleNote(n)} style={{ cursor:"pointer" }}>{n.done && <MI>check</MI>}</span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:13, fontWeight:600, color:n.done?"var(--fg-4)":"var(--fg-1)", textDecoration:n.done?"line-through":"none" }}>{n.text}</div>
                    {n.accountName && <div style={{ fontSize:11, color:"var(--fg-4)", marginTop:2, cursor:n.accountId?"pointer":"default" }} onClick={()=>{ const acct=accounts.find(x=>x.id===n.accountId); if(acct) onOpen(acct); }}>{n.accountName}</div>}
                  </div>
                  <button className="btn icon-btn btn-ghost btn-sm" onClick={()=>delNote(n)}><MI>close</MI></button>
                </div>
              ))}
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ============================ CSAT ============================ */
function Csat({ accounts, onOpen, setIcFocus, goTo }) {
  const all = []; accounts.forEach(a => a.csat.forEach(c => all.push({ a, c })));
  const overall = all.length ? (all.reduce((s,x)=>s+x.c.score,0)/all.length) : 0;
  const distro = [1,2,3,4,5].map(n => all.filter(x=>x.c.score===n).length);
  const maxD = Math.max(...distro, 1);
  const recent = all.slice().sort((x,y)=>new Date(y.c.date)-new Date(x.c.date)).slice(0,8);

  const byIc = P.team.map(t => {
    const mine = []; accounts.filter(a=>a.ic===t.name).forEach(a=>a.csat.forEach(c=>mine.push(c.score)));
    return { name:t.name, avg: mine.length?mine.reduce((s,v)=>s+v,0)/mine.length:null, n:mine.length };
  }).sort((a,b)=>(b.avg??0)-(a.avg??0));

  return (
    <div className="view-enter">
      <div className="grid-2" style={{ gridTemplateColumns:"320px 1fr", alignItems:"start", marginBottom:20 }}>
        <div className="card card-pad" style={{ textAlign:"center" }}>
          <div className="eyebrow" style={{ marginBottom:8 }}>Overall CSAT</div>
          <div style={{ fontFamily:"var(--font-display)", fontWeight:700, fontSize:64, letterSpacing:"-3px", lineHeight:1, color: overall>=4?"var(--green)":overall>=3?"var(--yellow)":"var(--red)" }}>{overall.toFixed(1)}</div>
          <div style={{ marginTop:8 }}><Stars score={overall} /></div>
          <div style={{ fontSize:12, color:"var(--fg-3)", fontWeight:700, marginTop:6 }}>{all.length} responses across {accounts.length} accounts</div>
          <div className="divider" />
          {[5,4,3,2,1].map(n => <div key={n} style={{ display:"flex", alignItems:"center", gap:9, marginBottom:7 }}>
            <span style={{ fontSize:12, fontWeight:700, width:12, color:"var(--fg-3)" }}>{n}</span>
            <MI style={{ fontSize:14, color:"var(--yellow)" }}>star</MI>
            <div style={{ flex:1 }}><Bar value={distro[n-1]} max={maxD} color={n>=4?"var(--green)":n===3?"var(--yellow)":"var(--red)"} height={8} /></div>
            <span style={{ fontSize:12, fontWeight:700, width:24, textAlign:"right", color:"var(--fg-2)" }}>{distro[n-1]}</span>
          </div>)}
        </div>

        <Card title="CSAT by IC" count={`${P.team.length} ICs`}>
          {byIc.map(t => <div className="lrow" key={t.name} onClick={()=>{ setIcFocus(t.name); goTo("portfolio"); }} style={{ padding:"12px 16px" }}>
            <Avatar name={t.name} size={28} />
            <span style={{ fontWeight:700, fontSize:13.5, width:160 }}>{t.name}</span>
            <div style={{ flex:1 }}><Bar value={t.avg||0} max={5} color={t.avg>=4?"var(--green)":t.avg>=3?"var(--yellow)":"var(--red)"} height={9} /></div>
            <span style={{ fontFamily:"var(--font-display)", fontWeight:700, fontSize:17, width:46, textAlign:"right", color: t.avg==null?"var(--fg-4)":t.avg>=4?"var(--green)":t.avg>=3?"var(--yellow)":"var(--red)" }}>{t.avg!=null?t.avg.toFixed(1):"—"}</span>
            <span style={{ fontSize:11, color:"var(--fg-4)", fontWeight:700, width:60, textAlign:"right" }}>{t.n} resp</span>
          </div>)}
        </Card>
      </div>

      <Card title="Recent responses" count={all.length}>
        {recent.map(({a,c},i) => <div className="lrow" key={i} onClick={()=>onOpen(a)} style={{ alignItems:"flex-start", padding:"13px 16px" }}>
          <div style={{ width:120, flexShrink:0 }}><Stars score={c.score} /><div style={{ fontSize:11, color:"var(--fg-4)", fontWeight:700, marginTop:3 }}>{fmtDate(c.date)} · {c.survey}</div></div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:13, color:"var(--fg-2)", lineHeight:1.5 }}>"{c.comment}"</div>
            <div style={{ fontSize:11.5, color:"var(--fg-4)", fontWeight:700, marginTop:4 }}>{a.tenant} · {firstName(a.ic)} · {c.respondent}</div>
          </div>
        </div>)}
      </Card>
    </div>
  );
}

/* ============================ MY PIPELINE (lead IC) ============================ */
function MyPipeline({ accounts, onOpen }) {
  const [q, setQ] = useStateM("");
  const [results, setResults] = useStateM([]);
  const [searching, setSearching] = useStateM(false);
  const [busy, setBusy] = useStateM(false);
  const [capture, setCapture] = useStateM(null);   // account for quick-capture popup
  // classification flow when adding: pending acct + step + rescue setup
  const [pending, setPending] = useStateM(null);    // { id, name, status, ic, cmrr }
  const [step, setStep] = useStateM("classify");    // "classify" | "dates"
  const [stage, setStage] = useStateM(null);        // "Implementation" | "Live"
  const [rescueStart, setRescueStart] = useStateM(() => new Date().toISOString());
  const [goLive, setGoLive] = useStateM(null);
  const [transition, setTransition] = useStateM(null);
  const [endDate, setEndDate] = useStateM(null);  // rescue "Success" engagement end date
  const [list, setList] = useStateM(accounts);   // local copy so add/remove update without a full reload
  const [showCompleted, setShowCompleted] = useStateM(false);
  const myIds = new Set(list.map(a => a.id));

  const search = (val) => {
    setQ(val);
    if (val.trim().length < 2) { setResults([]); return; }
    setSearching(true);
    fetch("/api/my-accounts/search?q=" + encodeURIComponent(val.trim()))
      .then(r => r.json()).then(d => { setResults(Array.isArray(d) ? d : []); setSearching(false); })
      .catch(() => { setResults([]); setSearching(false); });
  };
  const startClassify = (r) => {
    setPending(r); setStep("classify"); setStage(null);
    setRescueStart(new Date().toISOString()); setGoLive(null); setTransition(null); setEndDate(null);
  };
  // Edit the classification of an account already in the pipeline (set/change the
  // Regular vs Rescue tag + milestones). Pre-fills from the account's overlay.
  const startEdit = (a) => {
    setPending({ id: a.id, name: a.tenant, status: a.status, _edit: true });
    setStage(a.leadStage || null);
    setRescueStart(a.leadRescueStart || new Date().toISOString());
    setGoLive(a.leadGoLive || null); setTransition(a.leadTransition || null); setEndDate(a.leadEndDate || null);
    setStep(a.rescue ? "dates" : "classify");
  };
  const cancelClassify = () => setPending(null);
  // Regular: just add (tracks SFDC dates). Rescue: add (if new), then classify with
  // lead-set milestones. In edit mode the account already exists, so skip the add.
  const finishAdd = (kind) => {
    if (busy || !pending) return; setBusy(true);
    const id = pending.id, name = pending.name, isEdit = !!pending._edit;
    const addStep = isEdit
      ? Promise.resolve()
      : fetch("/api/my-accounts/add", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ accountId:id }) }).then(r => r.json());
    addStep
      .then(() => {
        if (kind === "rescue") {
          return fetch("/api/my-accounts/classify", { method:"POST", headers:{"Content-Type":"application/json"},
            body:JSON.stringify({ accountId:id, rescue:true, leadStage:stage, leadRescueStart:rescueStart,
              leadGoLive: stage === "Implementation" ? goLive : null,
              leadTransition: stage === "Success" ? null : transition,
              leadEndDate: stage === "Success" ? endDate : null }) }).then(r => r.json());
        }
        if (isEdit) {  // editing to Regular: clear the rescue classification
          return fetch("/api/my-accounts/classify", { method:"POST", headers:{"Content-Type":"application/json"},
            body:JSON.stringify({ accountId:id, rescue:false, leadStage:null }) }).then(r => r.json());
        }
      })
      .then(() => {
        const done = () => { setBusy(false); setPending(null); showToast(isEdit ? "Updated " + (name || "account") + "." : (name || "Account") + " added" + (kind === "rescue" ? " as a rescue" : "") + "."); };
        // Re-fetch + re-normalize the account list in place (no full page reload).
        if (window.reloadAccounts) return window.reloadAccounts().then(accts => { setList((accts || []).slice()); done(); });
        setList(l => l); done();
      })
      .catch(() => { setBusy(false); showToast("Couldn't save. Try again."); });
  };
  // Mark completed / reactivate — preserves the account + its notes/tasks.
  const setCompleted = (a, completed) => {
    if (busy) return; setBusy(true);
    fetch("/api/my-accounts/complete", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ accountId:a.id, completed }) })
      .then(r => r.json()).then(() => {
        a.leadCompleted = completed; a.leadCompletedAt = completed ? new Date().toISOString() : null;
        setList(l => l.slice()); setBusy(false);
        showToast(completed ? a.tenant + " marked completed." : a.tenant + " reactivated.");
      }).catch(() => { setBusy(false); showToast("Couldn't update. Try again."); });
  };
  const removeAcct = (id, name) => {
    if (busy || !confirm("Remove " + name + " from your pipeline?")) return;
    setBusy(true);
    fetch("/api/my-accounts/remove", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ accountId:id }) })
      .then(r => r.json()).then(() => {
        // Removal is purely subtractive: drop it locally and keep P.accounts in sync. No reload.
        if (window.PORTAL) window.PORTAL.accounts = (window.PORTAL.accounts || []).filter(a => a.id !== id);
        setList(l => l.filter(a => a.id !== id));
        setBusy(false); showToast("Removed " + name + ".");
      })
      .catch(() => { setBusy(false); showToast("Couldn't remove. Try again."); });
  };

  const sorted = list.slice().sort((a, b) => (a.hs ?? 99) - (b.hs ?? 99));
  const DB = window.DateBit;
  const canFinishRescue = stage && rescueStart && (
    stage === "Success" ? !!endDate : stage === "Live" ? !!transition : (!!goLive && !!transition));

  const ChoiceCard = ({ icon, color, title, body, onClick }) => (
    <button onClick={onClick} disabled={busy}
      style={{ display:"flex", gap:12, textAlign:"left", width:"100%", padding:14, cursor:"pointer",
        background:"var(--card)", border:"1px solid var(--line-2)", borderRadius:11 }}>
      <span style={{ width:38, height:38, flexShrink:0, borderRadius:9, display:"inline-flex", alignItems:"center", justifyContent:"center",
        background:"color-mix(in srgb, " + color + " 15%, transparent)", color }}><MI style={{ fontSize:21 }}>{icon}</MI></span>
      <div><div style={{ fontSize:14, fontWeight:800 }}>{title}</div>
        <div style={{ fontSize:12, color:"var(--fg-3)", marginTop:3, lineHeight:1.5 }}>{body}</div></div>
    </button>
  );
  const Seg = ({ id, label }) => (
    <button onClick={() => setStage(id)} style={{ flex:1, padding:"7px 8px", border:0, borderRadius:7, cursor:"pointer",
      font:"800 12px/1 var(--font-body)", background: stage === id ? "var(--accent)" : "transparent", color: stage === id ? "#fff" : "var(--fg-2)" }}>{label}</button>
  );

  const active = sorted.filter(a => !a.leadCompleted);
  const completed = list.filter(a => a.leadCompleted).sort((a, b) => new Date(b.leadCompletedAt || 0) - new Date(a.leadCompletedAt || 0));
  const thead = (
    <thead><tr>
      <th>Health</th><th>Account</th><th>Status</th><th>IC</th>
      <th style={{ textAlign:"right" }}>CMRR</th><th>Go-Live</th><th>Transition</th><th></th>
    </tr></thead>
  );
  const pipeRow = (a, isCompleted) => (
    <tr key={a.id} onClick={() => onOpen(a)} style={{ cursor:"pointer", opacity: isCompleted ? 0.65 : 1 }}>
      <td>{a.hs != null ? <HsChip hs={a.hs} mini /> : "—"}</td>
      <td><div className="acct-name" style={{ fontSize:13.5, display:"flex", alignItems:"center", gap:6 }}>{a.tenant}
        {a.rescue && <span className="chip" style={{ color:"var(--purple)", borderColor:"transparent", background:"color-mix(in srgb, var(--purple) 15%, transparent)", fontSize:10 }}><MI style={{ fontSize:13 }}>healing</MI>Rescue</span>}</div>
        <div style={{ fontSize:11, color:"var(--fg-3)" }}>{a.trade}{isCompleted && a.leadCompletedAt ? " · completed " + fmtDate(a.leadCompletedAt) : ""}</div></td>
      <td><StatusChip status={a.status} /></td>
      <td style={{ fontSize:12.5 }}>{a.ic}</td>
      <td style={{ textAlign:"right", fontWeight:600 }}>{fmtMoney(a.cmrr)}</td>
      <td>{a.rescue && a.leadGoLive ? <span style={{ color:"var(--green)" }}>{fmtDate(a.leadGoLive)}</span> : a.liveDate ? <span style={{ color:"var(--green)" }}>{fmtDate(a.liveDate)}</span> : a.pgl ? <span style={{ color:"var(--sky)" }}>{fmtDate(a.pgl)}</span> : "—"}</td>
      <td>{a.rescue && a.leadTransition ? fmtDate(a.leadTransition) : a.antTransitionDate ? fmtDate(a.antTransitionDate) : "—"}</td>
      <td style={{ textAlign:"right", whiteSpace:"nowrap" }}>
        {isCompleted ? (<>
          <button className="btn icon-btn btn-ghost btn-sm" title="Reactivate" onClick={(e) => { e.stopPropagation(); setCompleted(a, false); }}><MI>replay</MI></button>
          <button className="btn icon-btn btn-ghost btn-sm" title="Remove from pipeline" onClick={(e) => { e.stopPropagation(); removeAcct(a.id, a.tenant); }}><MI>close</MI></button>
        </>) : (<>
          <button className="btn icon-btn btn-ghost btn-sm" title="Set classification (Regular / Rescue)" onClick={(e) => { e.stopPropagation(); startEdit(a); }}><MI>sell</MI></button>
          <button className="btn icon-btn btn-ghost btn-sm" title="Quick capture a note or task" onClick={(e) => { e.stopPropagation(); setCapture(a); }}><MI>bolt</MI></button>
          <button className="btn icon-btn btn-ghost btn-sm" title="Mark completed" onClick={(e) => { e.stopPropagation(); setCompleted(a, true); }}><MI>check_circle</MI></button>
          <button className="btn icon-btn btn-ghost btn-sm" title="Remove from pipeline" onClick={(e) => { e.stopPropagation(); removeAcct(a.id, a.tenant); }}><MI>close</MI></button>
        </>)}
      </td>
    </tr>
  );

  return (
    <div className="view-enter">
      <div className="card card-pad" style={{ marginBottom:18 }}>
        {!pending ? (<>
          <div style={{ fontWeight:700, fontSize:14, marginBottom:8 }}>Add an account to your pipeline</div>
          <div className="search" style={{ maxWidth:560 }}><MI>search</MI>
            <input className="inp" placeholder="Search by name, or paste an onboarding record / account link…" value={q} onChange={e => search(e.target.value)} /></div>
          {q.trim().length >= 2 && (
            <div className="ms-pop" style={{ position:"static", marginTop:8, maxHeight:300, overflowY:"auto", width:"100%", maxWidth:560 }}>
              {searching ? <div className="hint" style={{ padding:"8px 10px" }}>Searching…</div> :
                results.length === 0 ? <div className="hint" style={{ padding:"8px 10px" }}>No matches.</div> :
                results.map(r => (
                  <div key={r.id} className="lrow" style={{ padding:"8px 10px" }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:13, fontWeight:600 }}>{r.name}</div>
                      <div style={{ fontSize:11, color:"var(--fg-3)", display:"flex", alignItems:"center", gap:6, marginTop:2 }}><StatusChip status={r.status} /> {r.ic || "—"} · {fmtMoney(r.cmrr)}</div>
                    </div>
                    {myIds.has(r.id)
                      ? <span className="chip" style={{ color:"var(--green)", borderColor:"transparent", background:"var(--soft)" }}><MI>check</MI>Added</span>
                      : <button className="btn btn-sm btn-primary" disabled={busy} onClick={() => startClassify(r)}><MI>add</MI>Add</button>}
                  </div>
                ))}
            </div>
          )}
        </>) : (<>
          {/* Classification: rescue vs regular */}
          <div style={{ display:"flex", alignItems:"center", gap:9, padding:"10px 12px", background:"var(--card-2)", border:"1px solid var(--line)", borderRadius:9, marginBottom:14 }}>
            <MI style={{ fontSize:20, color:"var(--sky)" }}>store</MI>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:13.5, fontWeight:700 }}>{pending.name}</div>
              <div style={{ fontSize:10.5, fontWeight:700, color:"var(--fg-4)" }}>Salesforce status: {pending.status || "—"}</div>
            </div>
            <button className="btn icon-btn btn-ghost btn-sm" title="Cancel" onClick={cancelClassify}><MI>close</MI></button>
          </div>
          {step === "classify" && (<>
            <div style={{ fontSize:14, fontWeight:800, marginBottom:4 }}>How should this account be handled?</div>
            <div style={{ fontSize:12, color:"var(--fg-3)", marginBottom:13, lineHeight:1.5 }}>Pick <strong style={{ color:"var(--fg-2)" }}>Rescue</strong> if it landed past onboarding or did not pull in from Salesforce the way it should.</div>
            <div style={{ display:"flex", flexDirection:"column", gap:10, maxWidth:560 }}>
              <ChoiceCard icon="route" color="var(--sky)" title="Regular onboarding"
                body="Standard account moving through onboarding. Tracks the go-live and transition dates from Salesforce."
                onClick={() => finishAdd("regular")} />
              <ChoiceCard icon="healing" color="var(--purple)" title="Rescue account"
                body="Came in already Live or in Success, or stalled. You set the stage and the milestone dates yourself."
                onClick={() => { setStep("dates"); }} />
            </div>
          </>)}
          {step === "dates" && (<>
            <div style={{ fontSize:10, fontWeight:800, color:"var(--fg-4)", textTransform:"uppercase", letterSpacing:".5px", marginBottom:7 }}>Treat as</div>
            <div style={{ display:"flex", gap:4, padding:4, background:"var(--card-2)", border:"1px solid var(--line-2)", borderRadius:9, maxWidth:560 }}>
              <Seg id="Implementation" label="Implementation" /><Seg id="Live" label="Live" /><Seg id="Success" label="Success" />
            </div>
            <div style={{ fontSize:11.5, color:"var(--fg-3)", margin:"8px 0 14px", lineHeight:1.5 }}>
              {stage === "Live" ? "Already live. Set a transition date to track."
                : stage === "Implementation" ? "Re-onboarding. Set a go-live and a transition date."
                : stage === "Success" ? "Leave it in Success. Set the date the engagement wraps up."
                : "Choose how to run this rescue."}
            </div>
            {stage && DB && (
              <div style={{ marginBottom:4 }}>
                <div style={{ fontSize:10, fontWeight:800, color:"var(--fg-4)", textTransform:"uppercase", letterSpacing:".5px", marginBottom:7 }}>Dates</div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:10 }}>
                  <DB icon="flag_circle" label="Rescue start" value={rescueStart} onChange={setRescueStart} color="var(--purple)" />
                  {stage === "Implementation" && <DB icon="rocket_launch" label="Go-live" value={goLive} onChange={setGoLive} color="var(--green)" />}
                  {stage === "Success" ? <DB icon="event_available" label="Engagement end" value={endDate} onChange={setEndDate} color="var(--green)" />
                    : <DB icon="swap_horiz" label="Transition" value={transition} onChange={setTransition} color="var(--sky)" />}
                </div>
                <div style={{ fontSize:10.5, color:"var(--fg-4)", fontWeight:600, marginTop:7 }}>Rescue start anchors how long the rescue takes.</div>
              </div>
            )}
            <div style={{ display:"flex", justifyContent:"space-between", marginTop:18, maxWidth:560 }}>
              <button className="btn btn-sm btn-ghost" onClick={() => setStep("classify")}><MI style={{ fontSize:16 }}>arrow_back</MI>Back</button>
              <button className="btn btn-sm btn-primary" disabled={!canFinishRescue || busy} onClick={() => finishAdd("rescue")}><MI style={{ fontSize:16 }}>add</MI>Add to pipeline</button>
            </div>
          </>)}
        </>)}
      </div>

      {list.length === 0 ? <Empty icon="inbox" title="No accounts yet" sub="Search above to add accounts to your pipeline." /> : (<>
        {active.length === 0
          ? <Empty icon="task_alt" title="No active accounts" sub={completed.length ? "All your accounts are completed — see below." : "Search above to add accounts."} />
          : <div className="tbl-wrap"><table className="tbl tbl-compact">{thead}<tbody>{active.map(a => pipeRow(a, false))}</tbody></table></div>}

        {completed.length > 0 && (
          <div style={{ marginTop:18 }}>
            <button onClick={() => setShowCompleted(s => !s)} style={{ display:"inline-flex", alignItems:"center", gap:7, cursor:"pointer",
              background:"transparent", border:0, color:"var(--fg-2)", font:"800 13px/1 var(--font-body)", padding:"4px 2px" }}>
              <MI style={{ fontSize:18, color:"var(--fg-4)" }}>{showCompleted ? "expand_more" : "chevron_right"}</MI>
              Completed ({completed.length})</button>
            {showCompleted && <div className="tbl-wrap" style={{ marginTop:8 }}><table className="tbl tbl-compact">{thead}<tbody>{completed.map(a => pipeRow(a, true))}</tbody></table></div>}
          </div>
        )}
      </>)}

      {capture && window.CapturePop && <window.CapturePop accountId={capture.id} accountName={capture.tenant}
        onClose={() => setCapture(null)} onDone={() => setCapture(null)} />}
    </div>
  );
}

Object.assign(window, { Portfolio, Team, Pipeline, AccountsView, OneOnOne, SeniorOneOnOne, Csat, MyPipeline });


/* ── Settings View ─────────────────────────────────────────── */
function SourceRow({ icon, label, sub, ts, enabled }) {
  const fmtAgo = (iso) => {
    if (!iso) return null;
    const mins = Math.floor((Date.now() - new Date(iso)) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + "m ago";
    const h = Math.floor(mins/60); if (h < 24) return h + "h ago";
    return Math.floor(h/24) + "d ago";
  };
  const ago = fmtAgo(ts);
  const mins = ts ? (Date.now() - new Date(ts))/60000 : Infinity;
  const c = !enabled ? "var(--fg-4)" : mins > 60*24 ? "var(--red)" : mins > 60*12 ? "var(--yellow)" : "var(--green)";
  return (
    <div className="lrow" style={{ padding: "12px 16px", cursor: "default" }}>
      <span style={{ width:34, height:34, borderRadius:8, background:"var(--soft)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}><MI style={{ color:"var(--sky)" }}>{icon}</MI></span>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontWeight:700, fontSize:13.5 }}>{label}</div>
        <div style={{ fontSize:11.5, color:"var(--fg-3)" }}>{sub}</div>
      </div>
      <div style={{ textAlign:"right" }}>
        {enabled
          ? <><div style={{ display:"flex", alignItems:"center", gap:6, justifyContent:"flex-end", fontWeight:700, fontSize:13, color:c }}><span className="flag-dot" style={{ background:c }} />{ago || "—"}</div>
              {ts && <div style={{ fontSize:11, color:"var(--fg-4)", marginTop:2 }}>{new Date(ts).toLocaleString("en-US",{timeZone:"America/New_York",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}) + " ET"}</div>}</>
          : <span className="chip" style={{ background:"var(--soft)", borderColor:"var(--line)", color:"var(--fg-3)" }}>Not connected</span>}
      </div>
    </div>
  );
}

/* Senior roster management — hide departed ICs (and their accounts) from every
   view. The roster is auto-discovered from Snowflake, so there's no add; hiding
   persists to config.excludedICs and is reversible. */
function SeniorRosterCard() {
  const [roster, setRoster] = React.useState(null);
  const [busy, setBusy] = React.useState("");
  React.useEffect(() => { fetch("/api/senior/roster").then(r => r.json()).then(setRoster).catch(() => setRoster({ ics: [], excluded: [] })); }, []);
  if (!roster) return <Card title="Team Roster"><div style={{ padding: 24, color: "var(--fg-3)" }}>Loading roster…</div></Card>;
  const exSet = new Set((roster.excluded || []).map(n => (n || "").toLowerCase()));
  const active = (roster.ics || []).filter(ic => !exSet.has((ic.name || "").toLowerCase()));
  const hidden = (roster.ics || []).filter(ic => exSet.has((ic.name || "").toLowerCase()));
  const byMgr = {};
  active.forEach(ic => { const k = ic.manager || "(unassigned)"; (byMgr[k] = byMgr[k] || []).push(ic); });
  const hide = (name) => {
    if (!confirm("Remove " + name + " from your roster? They and their accounts drop out of all your views. You can add them back anytime.")) return;
    setBusy(name);
    fetch("/api/senior/roster/hide", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }).then(() => location.reload());
  };
  const restore = (name) => { setBusy(name); fetch("/api/senior/roster/restore", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }).then(() => location.reload()); };
  return (
    <>
      <Card title="Team Roster" count={active.length + " ICs"}>
        <div style={{ padding: "4px 14px 8px", fontSize: 11.5, color: "var(--fg-3)" }}>Auto-discovered from Snowflake across all your managers. Remove anyone who's no longer on the team — they and their accounts drop out of every view. You can add them back anytime.</div>
        {Object.keys(byMgr).sort().map(mgr => (
          <div key={mgr}>
            <div style={{ padding: "8px 14px 4px", fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".04em", color: "var(--fg-3)" }}>{mgr}</div>
            {byMgr[mgr].map(ic => (
              <div key={ic.name} className="lrow" style={{ padding: "8px 14px", justifyContent: "space-between" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <Avatar name={ic.name} size={26} />
                  <span style={{ fontWeight: 700, fontSize: 13 }}>{ic.name}</span>
                </div>
                <button className="btn btn-sm" disabled={busy === ic.name} style={{ color: "var(--red)", background: "rgba(226,79,79,.08)", border: "1px solid rgba(226,79,79,.25)" }} onClick={() => hide(ic.name)}>
                  <MI style={{ fontSize: 14 }}>person_remove</MI>Remove</button>
              </div>
            ))}
          </div>
        ))}
      </Card>
      {hidden.length > 0 && (
        <Card title="Removed ICs" count={hidden.length} style={{ marginTop: 16 }}>
          <div style={{ padding: "4px 14px 8px", fontSize: 11.5, color: "var(--fg-3)" }}>Removed from your views. Add back to restore them and their accounts.</div>
          {hidden.map(ic => (
            <div key={ic.name} className="lrow" style={{ padding: "8px 14px", justifyContent: "space-between", opacity: .85 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Avatar name={ic.name} size={26} />
                <div><div style={{ fontWeight: 700, fontSize: 13 }}>{ic.name}</div><div style={{ fontSize: 11, color: "var(--fg-4)" }}>{ic.manager}</div></div>
              </div>
              <button className="btn btn-sm" disabled={busy === ic.name} onClick={() => restore(ic.name)}><MI style={{ fontSize: 14 }}>undo</MI>Add back</button>
            </div>
          ))}
        </Card>
      )}
    </>
  );
}

function SettingsView() {
  const [team, setTeam] = React.useState(P.team || []);
  const [newName, setNewName] = React.useState("");
  const [newLevel, setNewLevel] = React.useState("IC2");
  const [msg, setMsg] = React.useState("");
  const [slack, setSlack] = React.useState(null);     // /api/slack/status
  const [slackBusy, setSlackBusy] = React.useState(false);
  const [slackMsg, setSlackMsg] = React.useState("");
  const [cal, setCal] = React.useState(null);         // /api/calendar/status
  const [calBusy, setCalBusy] = React.useState(false);

  React.useEffect(() => {
    fetch("/api/slack/status").then(r=>r.json()).then(setSlack).catch(()=>setSlack({configured:false}));
    fetch("/api/calendar/status").then(r=>r.json()).then(setCal).catch(()=>setCal({connected:false,configured:false,libsInstalled:false}));
  }, []);

  const connectCalendar = () => {
    setCalBusy(true);
    fetch("/api/calendar/auth").then(r=>r.json()).then(d => {
      if (d.url) { window.location.href = d.url; }
      else { setCalBusy(false); showToast(d.error || "Could not start Google sign-in."); }
    }).catch(() => { setCalBusy(false); showToast("Could not reach the server."); });
  };
  const disconnectCalendar = () => {
    if (!confirm("Disconnect Google Calendar? You'll need to reconnect to see calendar data.")) return;
    setCalBusy(true);
    fetch("/api/calendar/disconnect", { method:"POST" }).then(r=>r.json()).then(() => {
      if (window.clearCalStatus) window.clearCalStatus();
      fetch("/api/calendar/status").then(r=>r.json()).then(d => { setCal(d); setCalBusy(false); });
    }).catch(() => { setCalBusy(false); showToast("Disconnect failed."); });
  };

  const refreshSlackUsers = () => {
    setSlackBusy(true); setSlackMsg("");
    fetch("/api/slack/refresh-users").then(r=>r.json()).then(d => {
      setSlackBusy(false);
      if (d.ok) {
        setSlackMsg(`Matched ${d.matched} of ${d.totalTeam} ICs (${d.totalSlackUsers} Slack users scanned).` + (d.unmatched && d.unmatched.length ? ` Unmatched: ${d.unmatched.join(", ")}.` : ""));
        fetch("/api/slack/status").then(r=>r.json()).then(setSlack).catch(()=>{});
      } else {
        setSlackMsg("Error: " + (d.error || "unknown"));
      }
    }).catch(() => { setSlackBusy(false); setSlackMsg("Request failed."); });
  };

  const refresh = () => {
    fetch("/api/config/team").then(r=>r.json()).then(d => {
      setTeam(d.team || []);
    });
  };

  const addIC = () => {
    if (!newName.trim()) return;
    fetch("/api/config/team/add", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ name: newName.trim(), level: newLevel })
    }).then(r=>r.json()).then(d => {
      if (d.ok) {
        setMsg("Added " + newName.trim());
        setNewName("");
        refresh();
      } else {
        setMsg("Error: " + (d.error || "unknown"));
      }
    });
  };

  const removeIC = (name) => {
    if (!confirm("Remove " + name + " from your team?")) return;
    fetch("/api/config/team/remove", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ name })
    }).then(r=>r.json()).then(d => {
      if (d.ok) { setMsg("Removed " + name); refresh(); }
      else setMsg("Error: " + (d.error || "unknown"));
    });
  };

  const isSenior = P._role === "senior-manager";

  return (
    <div className="view-enter">
      {isSenior && <SeniorRosterCard />}
      {!isSenior && <Card title="Team Roster" count={team.length + " ICs"}>
        <div style={{ padding: "8px 0" }}>
          {team.map(ic => (
            <div key={ic.name} className="lrow" style={{ padding: "10px 14px", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span className="avatar" style={{ width:28, height:28, fontSize:11, background: ic.color || "var(--accent)" }}>{ic.initials}</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>{ic.name}</div>
                  <div style={{ fontSize: 11, color: "var(--fg-3)" }}>{ic.short} · {ic.level} · {ic.status}{ic.onLeave ? " (on leave)" : ""}{ic.filter && ic.filter.onboardingType ? ` · Filter: ${ic.filter.onboardingType}` : ""}</div>
                </div>
              </div>
              <button className="btn btn-sm" style={{ color: "var(--red)", background: "rgba(226,79,79,.08)", border: "1px solid rgba(226,79,79,.25)" }}
                onClick={() => removeIC(ic.name)}>
                <MI style={{fontSize:14}}>close</MI>
              </button>
            </div>
          ))}
        </div>
      </Card>}

      {!isSenior && <Card title="Add Onboarder" style={{ marginTop: 16 }}>
        <div style={{ padding: "12px 14px" }}>
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: "var(--fg-3)", display: "block", marginBottom: 4 }}>Snowflake Name (exact match)</label>
            <input type="text" value={newName} onChange={e => setNewName(e.target.value)}
              placeholder="e.g. Sarah Thompson"
              style={{ width: "100%", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line-2)", background: "var(--card-2)", color: "var(--fg-1)", fontSize: 13 }} />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: "var(--fg-3)", display: "block", marginBottom: 4 }}>Account Filter (optional, for temp ICs from other teams)</label>
            <select id="icFilter" defaultValue=""
              style={{ padding: "8px 12px", borderRadius: 6, border: "1px solid var(--line-2)", background: "var(--card-2)", color: "var(--fg-1)", fontSize: 13 }}>
              <option value="">No filter (show all accounts)</option>
              <option value="Corp 1:1">Corp 1:1 only</option>
              <option value="Franchise Cohort">Franchise Cohort only</option>
            </select>
          </div>
          <button className="btn btn-sm" onClick={addIC} style={{ background: "var(--accent)", color: "#fff" }}>
            <MI style={{fontSize:15}}>person_add</MI> Add to Team
          </button>
          {msg && <div style={{ marginTop: 8, fontSize: 12, color: "var(--fg-2)" }}>{msg}</div>}
        </div>
      </Card>}

      <Card title="Data Freshness" style={{ marginTop: 16 }}>
        <div style={{ padding: "6px 0" }}>
          <SourceRow icon="dataset" label="Snowflake" sub="Onboarding records, dates, CMRR, compliance" ts={P._snowflakeDataAsOf} enabled={true} />
          <SourceRow icon="hub" label="Onboarding Portal" sub="Engagement, portal status, specialists, training" ts={P._portalSyncedAt} enabled={P._portalEnabled} />
        </div>
        <div style={{ display:"flex", gap:8, padding: "10px 16px 14px" }}>
          <button className="btn btn-sm" onClick={() => location.reload()}><MI style={{fontSize:15}}>refresh</MI> Refresh now</button>
          <button className="btn btn-sm btn-ghost" onClick={() => window.open("/connect-portal", "_blank")}><MI style={{fontSize:15}}>sync</MI> Re-connect Portal</button>
        </div>
      </Card>

      <Card title="Slack Integration" style={{ marginTop: 16 }}>
        <div style={{ padding: "6px 0" }}>
          <div className="lrow" style={{ padding: "12px 16px" }}>
            <span style={{ width:34, height:34, borderRadius:8, background:"var(--soft)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}><MI style={{ color:"var(--sky)" }}>forum</MI></span>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontWeight:700, fontSize:13.5 }}>Compliance messaging</div>
              <div style={{ fontSize:11.5, color:"var(--fg-3)" }}>One-click Slack nudges from the Compliance view</div>
            </div>
            <div style={{ textAlign:"right" }}>
              {slack == null
                ? <span style={{ fontSize:12, color:"var(--fg-4)" }}>Checking…</span>
                : slack.configured
                  ? <><div style={{ display:"flex", alignItems:"center", gap:6, justifyContent:"flex-end", fontWeight:700, fontSize:13, color:"var(--green)" }}><span className="flag-dot" style={{ background:"var(--green)" }} />Connected</div>
                      <div style={{ fontSize:11, color:"var(--fg-4)", marginTop:2 }}>{slack.userCount || 0} user{(slack.userCount||0)!==1?"s":""} cached{slack.refreshedAt ? " · " + new Date(slack.refreshedAt).toLocaleString("en-US",{timeZone:"America/New_York",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}) + " ET" : ""}</div></>
                  : <span className="chip" style={{ background:"var(--soft)", borderColor:"var(--line)", color:"var(--fg-3)" }}>Not connected</span>}
            </div>
          </div>
        </div>
        <div style={{ display:"flex", gap:8, padding: "4px 16px 12px", alignItems:"center", flexWrap:"wrap" }}>
          <button className="btn btn-sm" onClick={refreshSlackUsers} disabled={slackBusy || !slack || !slack.configured}>
            <MI style={{fontSize:15}}>{slackBusy?"sync":"group"}</MI>{slackBusy?"Refreshing…":"Refresh Users"}</button>
          {slackMsg && <span style={{ fontSize:11.5, color:"var(--fg-2)" }}>{slackMsg}</span>}
        </div>
        {(!slack || !slack.configured) && (
          <div style={{ fontSize:11.5, color:"var(--fg-3)", padding:"0 16px 14px", lineHeight:1.5 }}>
            To enable, save your Slack bot token to <code style={{ background:"var(--soft)", padding:"1px 5px", borderRadius:4 }}>.data/slack-token.txt</code>, then click Refresh Users.
          </div>
        )}
      </Card>

      <Card title="Google" style={{ marginTop: 16 }}>
        <div style={{ padding: "6px 0" }}>
          <div className="lrow" style={{ padding: "12px 16px" }}>
            <span style={{ width:34, height:34, borderRadius:8, background:"var(--soft)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}><MI style={{ color:"var(--sky)" }}>calendar_month</MI></span>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontWeight:700, fontSize:13.5 }}>Calendar &amp; Shared Tasks</div>
              <div style={{ fontSize:11.5, color:"var(--fg-3)" }}>Match scheduled calls to accounts, flag missing KOC / go-live / transition calls, and read/write the shared task sheet</div>
            </div>
            <div style={{ textAlign:"right" }}>
              {cal == null
                ? <span style={{ fontSize:12, color:"var(--fg-4)" }}>Checking…</span>
                : cal.connected
                  ? <div style={{ display:"flex", alignItems:"center", gap:6, justifyContent:"flex-end", fontWeight:700, fontSize:13, color:"var(--green)" }}><span className="flag-dot" style={{ background:"var(--green)" }} />Connected</div>
                  : <span className="chip" style={{ background:"var(--soft)", borderColor:"var(--line)", color:"var(--fg-3)" }}>Not connected</span>}
            </div>
          </div>
        </div>
        <div style={{ display:"flex", gap:8, padding: "4px 16px 12px", alignItems:"center", flexWrap:"wrap" }}>
          {cal && cal.connected
            ? <>
                <button className="btn btn-sm" onClick={connectCalendar} disabled={calBusy} style={{ background:"var(--accent)", color:"#fff" }}><MI style={{fontSize:15}}>{calBusy?"sync":"refresh"}</MI>Reconnect</button>
                <button className="btn btn-sm" onClick={disconnectCalendar} disabled={calBusy} style={{ color:"var(--red)", background:"rgba(226,79,79,.08)", border:"1px solid rgba(226,79,79,.25)" }}><MI style={{fontSize:15}}>link_off</MI>Disconnect</button>
              </>
            : <button className="btn btn-sm" onClick={connectCalendar} disabled={calBusy || !cal || !cal.configured} style={{ background:"var(--accent)", color:"#fff" }}><MI style={{fontSize:15}}>{calBusy?"sync":"login"}</MI>{calBusy?"Connecting…":"Connect Google"}</button>}
        </div>
        {cal && cal.connected && (
          <div style={{ fontSize:11.5, color:"var(--fg-3)", padding:"0 16px 14px", lineHeight:1.5 }}>
            Connected before Shared Tasks shipped? Click <strong>Reconnect</strong> to grant Google Sheets access.
          </div>
        )}
        {cal && !cal.libsInstalled && (
          <div style={{ fontSize:11.5, color:"var(--fg-3)", padding:"0 16px 14px", lineHeight:1.5 }}>
            Google API libraries aren't installed. Run <code style={{ background:"var(--soft)", padding:"1px 5px", borderRadius:4 }}>pip3 install google-auth-oauthlib google-api-python-client</code> and restart the server.
          </div>
        )}
        {cal && cal.libsInstalled && !cal.configured && (
          <div style={{ fontSize:11.5, color:"var(--fg-3)", padding:"0 16px 14px", lineHeight:1.5 }}>
            Set <code style={{ background:"var(--soft)", padding:"1px 5px", borderRadius:4 }}>GOOGLE_CLIENT_ID</code> and <code style={{ background:"var(--soft)", padding:"1px 5px", borderRadius:4 }}>GOOGLE_CLIENT_SECRET</code> in <code style={{ background:"var(--soft)", padding:"1px 5px", borderRadius:4 }}>server.py</code> (from the Google Cloud Console OAuth client), then restart the server.
          </div>
        )}
      </Card>

      <div style={{ marginTop: 16, fontSize: 11, color: "var(--fg-4)", textAlign: "center" }}>
        Changes take effect after refreshing the dashboard.
      </div>
    </div>
  );
}

Object.assign(window, { SettingsView });


/* ── Compliance View ─────────────────────────────────────────── */
function ComplianceView({ accounts, onOpen, focus, senior }) {
  const [tab, setTab] = React.useState("salesforce");
  const [groupBy, setGroupBy] = React.useState(focus ? "issue" : "ic");
  const [focusIssue, setFocusIssue] = React.useState(focus || null);
  const [slackBusy, setSlackBusy] = React.useState(null); // IC name currently sending
  const [mgrFilter, setMgrFilter] = React.useState(null); // senior: filter to one manager's team
  const now = P.now;
  const inThisWeek = (d) => { if(!d) return false; const x=new Date(d); const mon=P.monday; const diff=Math.floor((x-mon)/86400000); return diff>=0 && diff<=4; };
  const hoursSince = (ts) => ts ? Math.floor((Date.now() - new Date(ts)) / 3600000) : null;
  const fmtAge = (h) => h==null ? "" : (h < 48 ? h + "h" : Math.floor(h/24) + "d");

  // Compliance applies ONLY to accounts in Implementation or Live status.
  // Pre-Implementation, Hold, and No Payment Method are excluded entirely.
  const allAccounts = accounts;  // full list (incl. Pre-Impl) for calendar flag drill-down
  accounts = accounts.filter(a => a.status === "Implementation" || a.status === "Live");

  // Build a compliance nudge for one IC and copy it to the clipboard. Message
  // generation + clipboard work WITHOUT a Slack token. The only thing that needs
  // the token is auto-opening the Slack DM (slackDeepLink), which is present only
  // once users are cached; without it we just tell the user to paste manually.
  const messageOnSlack = (ic) => {
    if (slackBusy) return;
    setSlackBusy(ic);
    fetch("/api/slack/compliance-message", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ icName: ic }),
    }).then(r=>r.json()).then(d => {
      setSlackBusy(null);
      if (d.error) { showToast("Could not build message: " + d.error); return; }
      const afterCopy = () => {
        if (d.slackDeepLink) {
          window.open(d.slackDeepLink);
          showToast("Message copied! Opening Slack, just paste and send.");
        } else {
          // No token / no cached user: auto-open isn't possible, paste manually.
          showToast("Message copied to clipboard! Paste in Slack DM to " + firstName(ic) + ".");
        }
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(d.message).then(afterCopy).catch(() => {
          if (d.slackDeepLink) window.open(d.slackDeepLink);
          showToast("Couldn't copy automatically. Here's the message:\n\n" + d.message);
        });
      } else { afterCopy(); }
    }).catch(() => { setSlackBusy(null); showToast("Slack request failed."); });
  };

  // Always active: works without a Slack token (copies the message either way).
  const SlackBtn = ({ ic }) => {
    const busy = slackBusy===ic;
    return (
      <button className="btn btn-sm" style={{ marginLeft:8 }} disabled={busy}
        onClick={(e)=>{ e.stopPropagation(); messageOnSlack(ic); }}
        title="Copy a compliance nudge to paste into a Slack DM">
        <MI style={{fontSize:15}}>{busy?"sync":"send"}</MI>{busy?"Preparing…":"Message on Slack"}</button>
    );
  };

  // Per-account issue definitions — each yields a labeled chip
  const impLive = a => a.status==="Implementation" || a.status==="Live";
  const reviewHrs = a => a.transitionStatusUpdatedAt ? P.weekdayHoursBetween(a.transitionStatusUpdatedAt, P.now) : null;
  const defs = [
    { key:"noHS", label:"Missing health score", short:"No health score", color:"var(--red)", icon:"error",
      test:a => impLive(a) && a.hs==null, detail:a => "No health score entered" },
    { key:"noComments", label:"Missing HS comments", short:"No HS comments", color:"var(--yellow)", icon:"comment",
      test:a => impLive(a) && a.hs!=null && !a.hsComment, detail:a => `Score ${a.hs}, no comments` },
    { key:"staleHS", label:"Stale health score (>7d)", short:"Stale HS", color:"var(--yellow)", icon:"update",
      test:a => impLive(a) && a.hsLastUpdated && P.ageDays(a.hsLastUpdated)>window.HS_STALE_DAYS, detail:a => `Updated ${P.ageDays(a.hsLastUpdated)}d ago` },
    { key:"pglOverdue", label:"Go-live date passed", short:"Go-live passed", color:"var(--red)", icon:"event_busy",
      test:a => a.pgl && new Date(a.pgl)<now && a.status!=="Live" && a.status!=="Hold", detail:a => `PGL ${fmtDate(a.pgl)} · ${P.ageDays(a.pgl)}d ago` },
    { key:"transOverdue", label:"Success transition overdue", short:"Success transition overdue", color:"var(--red)", icon:"schedule",
      test:a => a.antTransitionDate && new Date(a.antTransitionDate)<now && !a.transitioned && a.status!=="Hold", detail:a => `Ant. Success transition ${fmtDate(a.antTransitionDate)} · ${P.ageDays(a.antTransitionDate)}d ago` },
    { key:"antBeforePgl", label:"Success transition dated before go-live", short:"Success < go-live", color:"#E8915B", icon:"swap_vert",
      test:a => a.antTransitionDate && a.pgl && new Date(a.antTransitionDate)<new Date(a.pgl), detail:a => `Transition ${fmtDate(a.antTransitionDate)} is before go-live ${fmtDate(a.pgl)}` },
    { key:"transWeekNotLive", label:"Moving to Success this week but not live", short:"Success this week, not live", color:"var(--red)", icon:"emergency",
      test:a => a.antTransitionDate && inThisWeek(a.antTransitionDate) && a.status!=="Live" && a.status!=="Hold" && a.status!=="Success", detail:a => `Success transition this week but status is ${a.status}` },
    { key:"awaitingReview", label:"Waiting for CSM Manager review (24h SLA)", short:"Review > 24h", color:"var(--red)", icon:"rate_review",
      test:a => a.successTransitionStatus==="Needs CSM Review" && reviewHrs(a)!=null && reviewHrs(a)>=24,
      detail:a => `In Needs CSM Review for ${fmtAge(reviewHrs(a))} (business hours)` },
    { key:"hypercareLong", label:"In hypercare over 2 weeks", short:"Hypercare > 2 wks", color:"var(--yellow)", icon:"timer",
      test:a => a.status==="Live" && !a.transitioned && a.liveDate && P.ageDays(a.liveDate)>14, detail:a => `Live ${P.ageDays(a.liveDate)}d ago, not yet moved to Success` },
    { key:"noHandoffDate", label:"Live with no Success transition date", short:"No Success date", color:"var(--yellow)", icon:"event_busy",
      test:a => a.status==="Live" && !a.transitioned && !a.antTransitionDate, detail:a => "Live, no anticipated Success transition date set" },
  ];

  // accounts with ≥1 issue, each annotated with its issue list
  const flagged = accounts.map(a => ({ a, issues: defs.filter(d => d.test(a)) })).filter(x => x.issues.length>0);
  const total = flagged.reduce((s,x)=>s+x.issues.length,0);
  const typeCounts = defs.map(d => ({ d, n: flagged.filter(x=>x.issues.some(i=>i.key===d.key)).length })).filter(t=>t.n>0);

  // group by IC (who), sorted by # issues
  const byIc = {};
  flagged.forEach(x => { (byIc[x.a.ic] = byIc[x.a.ic] || []).push(x); });
  const icRows = Object.entries(byIc)
    .map(([ic, items]) => ({ ic, items: items.sort((p,q)=>q.issues.length-p.issues.length), issueCount: items.reduce((s,it)=>s+it.issues.length,0) }))
    .sort((a,b)=>b.issueCount-a.issueCount);

  // Senior: roll issues up by manager, and let a manager chip filter the IC cards.
  const mgrRoll = {};
  if (senior) flagged.forEach(x => { const m = x.a.manager || "(unassigned)"; const r = mgrRoll[m] = mgrRoll[m] || { issues:0, ics:new Set() }; r.issues += x.issues.length; r.ics.add(x.a.ic); });
  const mgrRows = Object.entries(mgrRoll).map(([m,r]) => ({ manager:m, issues:r.issues, ics:r.ics.size })).sort((a,b)=>b.issues-a.issues);
  const shownIcRows = (senior && mgrFilter) ? icRows.filter(r => (r.items[0] && r.items[0].a.manager) === mgrFilter) : icRows;

  return (
    <div className="view-enter">
      <div className="toolbar" style={{ marginBottom:16 }}>
        <div className="seg">
          <button className={tab==="salesforce"?"on":""} onClick={()=>setTab("salesforce")}>Salesforce</button>
          <button className={tab==="calendar"?"on":""} onClick={()=>setTab("calendar")}>Calendar</button>
        </div>
      </div>

      {tab==="calendar" && <CalendarComplianceSection accounts={allAccounts} onOpen={onOpen} />}
      {tab==="salesforce" && <>
      {senior && mgrRows.length > 0 && (
        <div className="card card-pad" style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 9 }}>By manager</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {mgrRows.map(m => (
              <button key={m.manager} onClick={() => setMgrFilter(mgrFilter === m.manager ? null : m.manager)}
                style={{ cursor: "pointer", padding: "6px 12px", borderRadius: "var(--r-pill)", fontSize: 12.5, fontWeight: 700, fontFamily: "inherit",
                  border: "1px solid " + (mgrFilter === m.manager ? "var(--accent)" : "var(--line-2)"),
                  background: mgrFilter === m.manager ? "var(--accent)" : "var(--card-2)", color: mgrFilter === m.manager ? "#fff" : "var(--fg-2)" }}>
                {m.manager.split(" ")[0]}'s team · {m.issues} issue{m.issues !== 1 ? "s" : ""} across {m.ics} IC{m.ics !== 1 ? "s" : ""}</button>
            ))}
            {mgrFilter && <button className="btn btn-sm btn-ghost" onClick={() => setMgrFilter(null)}><MI style={{ fontSize: 15 }}>close</MI>Clear</button>}
          </div>
        </div>
      )}
      {total === 0 ? <Empty icon="verified" title="All clear" sub="No Salesforce compliance issues across your team." /> : <>
      {/* summary banner: total + breakdown by type */}
      <div className="card card-pad" style={{ marginBottom: 20, background:"var(--tint-red-10)", borderColor:"var(--tint-red-25)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:11, flexWrap:"wrap" }}>
          <MI style={{ fontSize:22, color:"var(--red)" }}>rule</MI>
          <span style={{ fontWeight:700, fontSize:15 }}>{total} item{total!==1?"s":""} across {flagged.length} account{flagged.length!==1?"s":""} · {icRows.length} IC{icRows.length!==1?"s":""}</span>
          <span style={{ fontSize:12.5, color:"var(--fg-3)", fontWeight:600 }}>— chase before Monday sync</span>
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginTop:12 }}>
          {typeCounts.map(({d,n}) => <button key={d.key} className="flag-pill flag-pill-btn" style={{ color:d.color }}
            onClick={()=>{ setGroupBy("issue"); setFocusIssue(d.key); }} title={`Show ${n} account${n!==1?"s":""} — ${d.label}`}>
            <strong style={{ fontFamily:"var(--font-display)" }}>{n}</strong> {d.short} <MI style={{ fontSize:13 }}>arrow_forward</MI></button>)}
        </div>
      </div>

      {/* grouping toggle */}
      <div className="toolbar">
        <span style={{ fontSize:13, fontWeight:700, color:"var(--fg-3)" }}>Group by</span>
        <div className="seg">
          {[["ic","By IC"],["issue","By issue"]].map(([k,lb])=><button key={k} className={groupBy===k?"on":""} onClick={()=>{setGroupBy(k); setFocusIssue(null);}}>{lb}</button>)}
        </div>
      </div>

      {/* one card per IC (who), with their accounts + issue chips (what) */}
      {groupBy==="ic" && <div className="col" style={{ gap:14 }}>
        {shownIcRows.map(({ ic, items, issueCount }) => {
          const t = P.team.find(x=>x.name===ic) || {};
          return (
            <div className="card" key={ic}>
              <div className="card-hd">
                <Avatar name={ic} size={30} />
                <div>
                  <div style={{ fontWeight:700, fontSize:14 }}>{ic} {t.level && <span className="pill-tag" style={{ padding:"0 6px", fontSize:10 }}>{t.level}</span>}</div>
                  <div style={{ fontSize:11.5, color:"var(--fg-3)", fontWeight:600 }}>{items.length} account{items.length!==1?"s":""} · {issueCount} item{issueCount!==1?"s":""} to fix</div>
                </div>
                <span className="spacer" />
                <span className="chip" style={{ background:"var(--tint-red-10)", borderColor:"var(--tint-red-25)", color:"var(--red)" }}><MI>warning</MI>{issueCount}</span>
                <SlackBtn ic={ic} />
              </div>
              <div>
                {items.map(({ a, issues }) => (
                  <div key={a.id} className="lrow" onClick={()=>onOpen(a)} style={{ alignItems:"flex-start", padding:"11px 16px" }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                        <span className="acct-name" style={{ fontSize:13.5 }}>{a.tenant}</span>
                        <StatusChip status={a.status} />
                        {a.hs!=null && <HsChip hs={a.hs} mini />}
                      </div>
                      <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginTop:7 }}>
                        {issues.map(i => <span key={i.key} className="flag-pill" style={{ color:i.color }} title={i.detail(a)}><MI style={{ fontSize:13 }}>{i.icon||"error"}</MI>{i.short}</span>)}
                      </div>
                    </div>
                    <MI style={{ color:"var(--fg-4)", fontSize:18, flexShrink:0 }}>chevron_right</MI>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>}

      {/* one card per issue type (what), listing accounts + who owns them */}
      {groupBy==="issue" && <div className="col" style={{ gap:14 }}>
        {focusIssue && <button className="btn btn-sm btn-ghost" style={{ alignSelf:"flex-start" }} onClick={()=>setFocusIssue(null)}><MI>arrow_back</MI>All issues</button>}
        {defs.filter(d => !focusIssue || d.key===focusIssue).map(d => {
          const accts = flagged.filter(x => x.issues.some(i=>i.key===d.key)).map(x=>x.a);
          if (!accts.length) return null;
          return (
            <div className="card" key={d.key}>
              <div className="card-hd">
                <MI style={{ fontSize:20, color:d.color }}>{d.icon}</MI>
                <h3>{d.label}</h3>
                <span className="spacer" />
                <span className="chip" style={{ background:"var(--soft)", borderColor:d.color, color:d.color }}>{accts.length}</span>
              </div>
              <div>
                {accts.sort((a,b)=>a.ic.localeCompare(b.ic)).map(a => (
                  <div key={a.id} className="lrow" onClick={()=>onOpen(a)} style={{ padding:"10px 16px" }}>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                        <span className="acct-name" style={{ fontSize:13.5 }}>{a.tenant}</span>
                        <StatusChip status={a.status} />
                        {a.hs!=null && <HsChip hs={a.hs} mini />}
                      </div>
                      <div style={{ fontSize:11.5, color:"var(--fg-3)", marginTop:3, fontWeight:600 }}>{d.detail(a)}</div>
                    </div>
                    <span style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0 }}><Avatar name={a.ic} size={20} /><span style={{ fontSize:12, color:"var(--fg-2)", fontWeight:600 }}>{firstName(a.ic)} {a.ic.split(" ")[1][0]}.</span></span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>}
      </>}
      </>}
    </div>
  );
}

// Calendar-based compliance: only renders when Google Calendar is connected.
const CAL_FLAG_META = {
  kocMissing:           { label:"KOC not booked",                     color:"var(--red)",    icon:"event_busy" },
};

function CalendarComplianceSection({ accounts, onOpen }) {
  const [data, setData] = React.useState(null);
  const [filterType, setFilterType] = React.useState("all");
  React.useEffect(() => {
    fetch("/api/calendar/compliance").then(r=>r.json()).then(setData).catch(()=>setData({connected:false}));
  }, []);
  if (!data) return <div style={{ padding:24, textAlign:"center", color:"var(--fg-4)" }}>Loading…</div>;
  if (!data.connected) return <Empty icon="calendar_month" title="Calendar not connected" sub="Connect Google Calendar in Settings to see call compliance." />;
  const flags = data.flags || [];
  const byType = data.byType || {};
  const types = Object.keys(byType);
  const openFor = (aid) => { const a = (accounts||[]).find(x=>x.id===aid); if (a) onOpen(a); };
  const visible = filterType === "all" ? flags : flags.filter(f => f.type === filterType);
  return (
    <div>
      {flags.length === 0
        ? <Empty icon="verified" title="All clear" sub="No calendar gaps found across your team." />
        : <>
          <div className="card card-pad" style={{ marginBottom:16, background:"var(--tint-red-10)", borderColor:"var(--tint-red-25)" }}>
            <div style={{ display:"flex", alignItems:"center", gap:11, flexWrap:"wrap" }}>
              <MI style={{ fontSize:22, color:"var(--red)" }}>calendar_month</MI>
              <span style={{ fontWeight:700, fontSize:15 }}>{flags.length} gap{flags.length!==1?"s":""} across {new Set(flags.map(f=>f.accountId)).size} accounts</span>
              <span style={{ fontSize:12.5, color:"var(--fg-3)", fontWeight:600 }}>— booked calls vs Salesforce status</span>
            </div>
          </div>
          <div className="toolbar" style={{ marginBottom:12 }}>
            <span style={{ fontSize:12, fontWeight:700, color:"var(--fg-3)" }}>Filter</span>
            <div className="seg">
              <button className={filterType==="all"?"on":""} onClick={()=>setFilterType("all")}>All ({flags.length})</button>
              {types.map(t => { const m = CAL_FLAG_META[t]||{label:t}; return (
                <button key={t} className={filterType===t?"on":""} onClick={()=>setFilterType(t)}>{m.label} ({byType[t].length})</button>
              ); })}
            </div>
          </div>
          <div className="card">
            {visible.map((f, i) => { const m = CAL_FLAG_META[f.type]||{label:f.type,color:"var(--fg-3)",icon:"event"}; return (
              <div key={i} className="lrow" onClick={()=>openFor(f.accountId)} style={{ padding:"11px 16px", cursor:"pointer", borderBottom: i<visible.length-1?"1px solid var(--line)":"none" }}>
                <MI style={{ fontSize:18, color:m.color, marginRight:10, flexShrink:0 }}>{m.icon}</MI>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                    <span className="acct-name" style={{ fontSize:13.5 }}>{f.account}</span>
                    <span className="flag-pill" style={{ color:m.color }}>{m.label}</span>
                  </div>
                  <div style={{ fontSize:11.5, color:"var(--fg-3)", marginTop:2, fontWeight:600 }}>{f.detail}</div>
                </div>
                <span style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0 }}><Avatar name={f.ic} size={20} /><span style={{ fontSize:12, color:"var(--fg-2)", fontWeight:600 }}>{firstName(f.ic)}</span></span>
              </div>
            ); })}
          </div>
        </>
      }
      {(data.accessErrors && data.accessErrors.length>0) && (
        <div style={{ fontSize:11, color:"var(--fg-4)", marginTop:10 }}>Couldn't read calendars for: {data.accessErrors.join(", ")} (not shared with you).</div>
      )}
    </div>
  );
}

Object.assign(window, { ComplianceView });


/* ── Performance View ─────────────────────────────────────────── */
function PerformanceView() {
  const [period, setPeriod] = React.useState(() => {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  });
  const [data, setData] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [expandedCsat, setExpandedCsat] = React.useState(null);
  const [customOpen, setCustomOpen] = React.useState(false);
  const [cStart, setCStart] = React.useState("");
  const [cEnd, setCEnd] = React.useState("");
  const isCustom = String(period).startsWith("custom:");
  const applyCustom = () => { if (cStart && cEnd) load(`custom:${cStart}:${cEnd}`); };

  const load = (p) => {
    setPeriod(p);
    setLoading(true);
    fetch("/api/ic-stats?period=" + p).then(r => r.json()).then(d => {
      setData(d);
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  React.useEffect(() => { load(period); }, []);

  // Build month options (last 12 months)
  const months = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    const label = d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
    months.push({ key, label });
  }

  // Build fiscal quarter options
  const fqs = [];
  const fy = now.getMonth() >= 2 ? now.getFullYear() : now.getFullYear() - 1;
  for (let y = fy; y >= fy - 1; y--) {
    for (let q = 4; q >= 1; q--) {
      fqs.push({ key: "FY" + y + "Q" + q, label: "FY" + y + " Q" + q });
    }
  }

  const fmtD = (v) => v ? "$" + Math.round(v).toLocaleString() : "$0";
  const fmtCT = (d) => d ? (d / 7).toFixed(1) + "w" : "--";

  if (!data && loading) return <div style={{ padding: 40, textAlign: "center", color: "var(--fg-3)" }}>Loading...</div>;

  const stats = data ? data.stats : [];

  // Totals
  const totals = stats.reduce((t, s) => ({
    actL: t.actL + s.activations.logos, actD: t.actD + s.activations.dollars,
    trL: t.trL + s.transitions.logos, trD: t.trD + s.transitions.dollars,
    pglL: t.pglL + s.projectedGoLives.logos, ptrL: t.ptrL + s.projectedTransitions.logos,
  }), { actL: 0, actD: 0, trL: 0, trD: 0, pglL: 0, ptrL: 0 });

  return (
    <div className="view-enter">
      {/* Period selector — pill presets + dropdown for specific months/quarters */}
      <div className="toolbar">
        <span style={{ fontSize:13, fontWeight:700, color:"var(--fg-3)" }}>Period</span>
        <div className="seg">
          {[["__cur","This month"],["__last","Last month"],["__fq","This quarter"],["YTD","YTD"]].map(([k,lb])=>{
            const cur = now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0");
            const last = new Date(now.getFullYear(),now.getMonth()-1,1); const lastKey=last.getFullYear()+"-"+String(last.getMonth()+1).padStart(2,"0");
            const val = k==="__cur"?cur : k==="__last"?lastKey : k==="__fq"?fqs[0].key : k;
            return <button key={k} className={period===val?"on":""} onClick={()=>load(val)}>{lb}</button>;
          })}
        </div>
        <select value={isCustom ? "" : period} onChange={e => load(e.target.value)} className="select-sm">
          <optgroup label="Months">{months.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}</optgroup>
          <optgroup label="Fiscal Quarters (FY starts Feb 1)">{fqs.map(q => <option key={q.key} value={q.key}>{q.label}</option>)}</optgroup>
          <optgroup label="Ranges"><option value="YTD">Year to Date</option><option value="L3">Last 3 Months</option><option value="L6">Last 6 Months</option><option value="L12">Last 12 Months</option></optgroup>
        </select>
        <button className={"select-sm" + (isCustom?" ms-active":"")} onClick={()=>setCustomOpen(o=>!o)} style={{ cursor:"pointer", display:"inline-flex", alignItems:"center", gap:4 }}><MI style={{fontSize:15}}>date_range</MI>Custom</button>
        {customOpen && (
          <span style={{ display:"inline-flex", alignItems:"center", gap:6 }}>
            <input className="inp" type="date" value={cStart} onChange={e=>setCStart(e.target.value)} style={{ width:150, padding:"6px 9px" }} />
            <span style={{ color:"var(--fg-3)", fontSize:12 }}>to</span>
            <input className="inp" type="date" value={cEnd} onChange={e=>setCEnd(e.target.value)} style={{ width:150, padding:"6px 9px" }} />
            <button className="btn btn-sm btn-primary" onClick={applyCustom} disabled={!cStart||!cEnd}>Apply</button>
          </span>
        )}
        <span className="spacer" />
        {loading && <span style={{ fontSize:12, color:"var(--fg-3)" }}>Loading…</span>}
        {data && <span className="count-note">{data.start} → {data.end}</span>}
      </div>

      {/* Summary KPIs */}
      <div className="kpi-grid" style={{ gridTemplateColumns:"repeat(4,1fr)" }}>
        <KPI icon="rocket_launch" label="Activations" value={totals.actL} accent="var(--green)" foot={fmtD(totals.actD)} footDir="flat" />
        <KPI icon="swap_horiz" label="Transitions" value={totals.trL} accent="var(--sky)" foot={fmtD(totals.trD)} footDir="flat" />
        <KPI icon="flag" label="Projected Go-Lives" value={totals.pglL} accent="var(--yellow)" foot="remaining" footDir="flat" />
        <KPI icon="event_upcoming" label="Projected Transitions" value={totals.ptrL} accent="var(--purple)" foot="remaining" footDir="flat" />
      </div>

      {/* IC Table */}
      <div className="card" style={{ overflow: "auto" }}>
        <table className="tbl" style={{ width: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>IC</th>
              <th>Act (L)</th>
              <th>Act ($)</th>
              <th>Trans (L)</th>
              <th>Trans ($)</th>
              <th>Proj GL</th>
              <th>Proj Tr</th>
              <th>Avg CT</th>
              <th>&gt;4wk</th>
              <th>&gt;5wk</th>
              <th>CSAT</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s, ri) => {
              const ct = s.cycleTime;
              const cs = s.csat;
              const isExpanded = expandedCsat === s.ic;
              return React.createElement(React.Fragment, { key: s.ic }, 
                <tr key={s.ic} style={{ cursor: "pointer", background: ri%2 ? "var(--soft-3)" : undefined }}>
                  <td style={{ fontWeight: 700, fontSize: 13 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Avatar name={s.ic} size={22} />
                      {s.ic.split(" ")[0]} {s.ic.split(" ").pop()[0]}.
                    </div>
                  </td>
                  <td style={{ textAlign: "center", fontWeight: 700, color: s.activations.logos ? "var(--green)" : "var(--fg-4)" }}>{s.activations.logos}</td>
                  <td style={{ textAlign: "center", fontSize: 12 }}>{fmtD(s.activations.dollars)}</td>
                  <td style={{ textAlign: "center", fontWeight: 700, color: s.transitions.logos ? "var(--sky)" : "var(--fg-4)" }}>{s.transitions.logos}</td>
                  <td style={{ textAlign: "center", fontSize: 12 }}>{fmtD(s.transitions.dollars)}</td>
                  <td style={{ textAlign: "center", color: s.projectedGoLives.logos ? "var(--yellow)" : "var(--fg-4)" }}>{s.projectedGoLives.logos}</td>
                  <td style={{ textAlign: "center", color: s.projectedTransitions.logos ? "var(--purple)" : "var(--fg-4)" }}>{s.projectedTransitions.logos}</td>
                  <td style={{ textAlign: "center", fontWeight: 700, color: ct.avgDays/7 > 4 ? "var(--red)" : "var(--fg-1)" }}>{fmtCT(ct.avgDays)}</td>
                  <td style={{ textAlign: "center", color: ct.over4wk ? "var(--red)" : "var(--fg-4)" }}>{ct.over4wk}</td>
                  <td style={{ textAlign: "center", color: ct.over5wk ? "var(--red)" : "var(--fg-4)" }}>{ct.over5wk}</td>
                  <td style={{ textAlign: "center" }}>
                    {cs.avg ? <span style={{ fontWeight: 700, color: cs.avg >= 4 ? "var(--green)" : cs.avg >= 3 ? "var(--yellow)" : "var(--red)" }}>{cs.avg.toFixed(1)}</span> : <span style={{ color: "var(--fg-4)" }}>--</span>}
                    {cs.count > 0 && <span style={{ fontSize: 10, color: "var(--fg-4)", marginLeft: 4 }}>({cs.count})</span>}
                  </td>
                  <td>
                    {s.csatResponses.length > 0 && <button className="btn btn-sm btn-ghost" style={{ padding: "2px 6px" }}
                      onClick={() => setExpandedCsat(isExpanded ? null : s.ic)}>
                      <MI style={{ fontSize: 14 }}>{isExpanded ? "expand_less" : "expand_more"}</MI>
                    </button>}
                  </td>
                </tr>,
                isExpanded && s.csatResponses.map((r, i) => (
                  <tr key={s.ic + "-csat-" + i} style={{ background: "var(--tint-blue-08)" }}>
                    <td colSpan={12} style={{ padding: "8px 14px 8px 50px" }}>
                      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                        <span style={{ fontWeight: 700, fontSize: 18, color: r.score >= 4 ? "var(--green)" : r.score >= 3 ? "var(--yellow)" : "var(--red)", minWidth: 24 }}>{r.score}</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12, fontWeight: 700 }}>{r.accountName}</div>
                          {r.comment && <div style={{ fontSize: 12, color: "var(--fg-2)", marginTop: 2 }}>"{r.comment}"</div>}
                          <div style={{ fontSize: 11, color: "var(--fg-4)", marginTop: 2 }}>{r.respondent} · {r.date}</div>
                        </div>
                      </div>
                    </td>
                  </tr>
                ))
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Forecast vs Actual (snapshot-based, from window._forecastCompare) */}
      <ForecastCard monthName={P.now.toLocaleDateString("en-US",{month:"long"})} />
    </div>
  );
}

Object.assign(window, { PerformanceView });
