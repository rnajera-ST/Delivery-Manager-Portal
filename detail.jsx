/* Account detail slide-over — opened from any view. */
const { useState: useStateD } = React;

function AccountDetail({ account, onClose, onSave, onOpenEsc }) {
  const a = account;
  const [tab, setTab] = useStateD("overview");
  const [, force] = useStateD(0);
  const rerender = () => force(x => x + 1);
  const edit = (field, val) => { a[field] = val; rerender(); };
  const commit = () => { onSave && onSave(a); };

  const m = a.hs != null ? P.HS[a.hs] : null;
  const wk = weeksIn(a.implStart);
  const cycle = a.transitionDate ? P.daysBetween(a.implStart, a.transitionDate) : (a.liveDate ? P.daysBetween(a.implStart, a.liveDate) : P.ageDays(a.implStart));
  const fu = a.followUpDate;
  const fuDays = fu ? Math.ceil((new Date(fu) - P.now) / 86400000) : null;

  const tabs = [
    ["overview", "Overview"],
    ["audit", "Audit"],
    ["escalation", "Escalation" + (a.escalation ? "" : "")],
    ["tickets", `Tickets (${a.tickets.length + (a.churnTickets||[]).length})`],
    ["calendar", "Activity"],
    ["notes", "Notes & Actions"],
  ];

  return (
    <>
      <div className="overlay-bg" onClick={onClose} />
      <div className="slideover">
        <button className="btn icon-btn btn-ghost so-close" onClick={onClose}><MI>close</MI></button>
        <div className="so-head">
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:8 }}>
            <Avatar name={a.ic} size={22} />
            <span style={{ fontSize:12.5, fontWeight:700, color:"var(--fg-3)" }}>{a.ic}</span>
            <span style={{ color:"var(--fg-4)" }}>·</span>
            <span style={{ fontSize:12.5, fontWeight:700, color:"var(--fg-3)" }}>{a.trade}</span>
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <h2 style={{ fontFamily:"var(--font-display)", fontWeight:700, fontSize:24, letterSpacing:"-.4px", lineHeight:1.1 }}>{a.tenant}</h2>
            {a.externalLinks && a.externalLinks.sfdcOb && <a href={a.externalLinks.sfdcOb} target="_blank" rel="noopener" title="Open OB Record in Salesforce"
              style={{ flexShrink:0, display:"inline-flex", alignItems:"center", gap:4, fontSize:11, fontWeight:700, color:"var(--accent)", padding:"3px 8px", borderRadius:5, border:"1px solid var(--border)", background:"var(--surface-2)", textDecoration:"none" }}
              onClick={e => e.stopPropagation()}><MI style={{fontSize:14}}>open_in_new</MI>OB Record</a>}
          </div>
          <div style={{ display:"flex", gap:8, marginTop:11, flexWrap:"wrap", alignItems:"center" }}>
            <StatusChip status={a.status} />
            <HsChip hs={a.hs} />
            <PortalStatusChip s={a.portalStatus} />
            {a.sentiment && <span className="pill-tag"><SentDot s={a.sentiment} /> {a.sentiment}</span>}
            {a.escalation && a.escalation.open && <span className="chip" style={{ background:"rgba(226,79,79,.14)", borderColor:"rgba(226,79,79,.45)", color:"var(--red)" }}><MI>warning</MI>Escalated · {P.ageDays(a.escalation.opened)}d</span>}
          </div>
        </div>

        <div className="so-body">
          <div className="tabs">
            {tabs.map(([k, lb]) => <button key={k} className={tab===k?"on":""} onClick={()=>setTab(k)}>{lb}</button>)}
          </div>

          {tab === "overview" && <OverviewTab a={a} wk={wk} cycle={cycle} m={m} />}
          {tab === "audit" && <AuditTab a={a} />}
          {tab === "escalation" && <EscalationTab a={a} commit={commit} edit={edit} rerender={rerender} />}
          {tab === "tickets" && <TicketsTab a={a} commit={commit} rerender={rerender} />}
          {tab === "calendar" && <window.CalendarTab account={a} />}
          {tab === "notes" && <NotesTab a={a} edit={edit} commit={commit} rerender={rerender} fuDays={fuDays} />}
        </div>
      </div>
    </>
  );
}

function OverviewTab({ a, wk, cycle, m }) {
  return (
    <div className="view-enter">
      <div className="dgrid" style={{ marginBottom:16 }}>
        <Dcell l="OB Health" v={a.hs!=null ? `${a.hs} · ${m.l}` : "Missing"} alert={a.hs!=null && a.hs<=3} />
        <Dcell l="CMRR" v={fmtMoney(a.cmrr)} />
        <Dcell l="Outstanding Balance" v={a.outstandingBalance < 0 ? fmtMoney(a.outstandingBalance) : "—"} alert={a.outstandingBalance < 0} />
        <Dcell l="Managed Techs" v={a.techs} />
        <Dcell l="Impl Start" v={fmtDateY(a.implStart)} />
        <Dcell l="Projected Go-Live" v={fmtDateY(a.pgl)} alert={pglOverdue(a)} />
        <Dcell l="Ant. Transition" v={fmtDateY(a.antTransitionDate)} alert={a.pgl && a.antTransitionDate && new Date(a.pgl) > new Date(a.antTransitionDate)} />
        <Dcell l="Transition Status" v={a.successTransitionStatus || "Not Set"} alert={a.antTransitionDate && new Date(a.antTransitionDate) <= new Date() && a.successTransitionStatus !== "Pending Handoff Call" && a.successTransitionStatus !== "Completed"} />
        <Dcell l={a.transitionDate ? "Transitioned" : "Cycle (days)"} v={a.transitionDate ? fmtDateY(a.transitionDate) : (cycle!=null ? cycle + "d" : "\u2014")} />
      </div>

      {/* onboarding progress */}
      <div className="card card-pad" style={{ marginBottom:16 }}>
        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:10 }}>
          <span className="eyebrow">Onboarding Stage</span>
          <span style={{ fontSize:12, fontWeight:700, color:"var(--fg-3)" }}>{a.cohort}</span>
        </div>
        <Steps status={a.status} />
        <div style={{ display:"flex", justifyContent:"space-between", marginTop:8, fontSize:11, color:"var(--fg-3)", fontWeight:700 }}>
          <span>Kickoff</span><span>Build</span><span>Train</span><span>Go-Live</span><span>Transition</span>
        </div>
      </div>

      {a.hsComment && (() => {
        const risk = a.hs != null && a.hs <= 3;
        return <div className="card card-pad" style={{ borderColor: risk ? m.bd : "var(--line)", background: risk ? m.bg : "var(--card)", marginBottom:16 }}>
          <span className="eyebrow" style={{ color: risk ? m.c : "var(--fg-3)" }}>Health Score Comments</span>
          <p style={{ fontSize:13.5, lineHeight:1.6, color:"var(--fg-1)", marginTop:8 }}>{a.hsComment}</p>
        </div>;
      })()}

      <div className="grid-2">
        <MiniStat icon="receipt_long" label="Open Tickets" value={a.openTickets} sub={a.escTickets ? a.escTickets + " escalated" : "none escalated"} alert={a.escTickets>0} />
        <MiniStat icon="sentiment_satisfied" label="Avg CSAT" value={a.csatAvg ? a.csatAvg.toFixed(1) : "\u2014"} sub={a.csat.length + " response" + (a.csat.length!==1?"s":"")} alert={a.csatAvg!=null && a.csatAvg<3} />
      </div>
    </div>
  );
}

function Dcell({ l, v, alert }) {
  return <div className={"dcell" + (alert ? " alert" : "")}><div className="dl">{l}</div><div className="dv">{v}</div></div>;
}
function MiniStat({ icon, label, value, sub, alert }) {
  return (
    <div className="card card-pad" style={{ display:"flex", alignItems:"center", gap:13 }}>
      <span className="mi" style={{ fontSize:26, color: alert ? "var(--red)" : "var(--sky)" }}>{icon}</span>
      <div>
        <div style={{ fontFamily:"var(--font-display)", fontWeight:700, fontSize:22, letterSpacing:"-.5px", color: alert?"var(--red)":"var(--fg-1)" }}>{value}</div>
        <div style={{ fontSize:11.5, fontWeight:700, color:"var(--fg-3)" }}>{label} · {sub}</div>
      </div>
    </div>
  );
}
function Steps({ status }) {
  const order = ["Pre-Implementation","Implementation","Implementation","Live","Live"];
  const idx = { "Pre-Implementation":1, "Implementation":3, "Hold":2, "Live":5 }[status] || 0;
  return <div className="steps">{[0,1,2,3,4].map(i => <div key={i} className={"step" + (i < idx ? " done" : "")} />)}</div>;
}

function AuditTab({ a }) {
  const sp = a.specialists, eb = a.engagementBreakdown, tr = a.training;
  const [briefOpen, setBriefOpen] = useStateD(false);
  const staleDays = a.hsLastUpdated ? P.ageDays(a.hsLastUpdated) : null;
  const Link = ({ href, icon, label }) => <a href={href} target="_blank" rel="noreferrer" className="btn btn-sm" style={{ textDecoration:"none" }} onClick={e=>e.stopPropagation()}><MI>{icon}</MI>{label}</a>;
  if (!eb) return <div className="view-enter"><Empty icon="query_stats" title="No engagement data" sub="Portal engagement metrics haven't synced for this account yet." /></div>;

  // weakest breakdown dimension drives the "what's dragging it down" line
  const dims = [["Go-Live readiness",eb.goLiveReadiness],["Transition readiness",eb.transitionReadiness],["Product setup",eb.productSetup],["Product usage",eb.productUsage],["Training",eb.training]];
  const weakest = dims.slice().sort((x,y)=>x[1]-y[1])[0];
  const buckets = [
    { label:"Launch Readiness", rows:[["Go-Live readiness",eb.goLiveReadiness],["Transition readiness",eb.transitionReadiness]] },
    { label:"Product Adoption", rows:[["Product setup",eb.productSetup],["Product usage",eb.productUsage]] },
    { label:"Commitment", rows:[["Training",eb.training]] },
  ];

  return (
    <div className="view-enter">
      {/* quick links — at the top of the tab for fast access */}
      <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginBottom:16 }}>
        <Link href={a.externalLinks.sfdc} icon="cloud" label="SFDC Account" />
        <Link href={a.externalLinks.sfdcOb} icon="assignment" label="SFDC OB Record" />
        <Link href={a.externalLinks.gong} icon="graphic_eq" label="Gong" />
        <Link href={a.externalLinks.dcc} icon="build" label="DCC Tools" />
        <Link href={a.externalLinks.tenant} icon="dns" label="Tenant Mgmt" />
        <Link href={a.externalLinks.portal} icon="open_in_new" label="OB Portal" />
      </div>

      {/* hero score */}
      <div className="card card-pad" style={{ marginBottom:16, display:"flex", alignItems:"center", gap:20 }}>
        <div style={{ textAlign:"center", flexShrink:0, minWidth:96 }}>
          <div style={{ fontFamily:"var(--font-display)", fontWeight:700, fontSize:52, letterSpacing:"-2.5px", color:P.engColor(a.engagementScore), lineHeight:1 }}>{a.engagementScore ?? "—"}</div>
          <div style={{ fontSize:10, fontWeight:700, color:"var(--fg-3)", textTransform:"uppercase", letterSpacing:".6px", marginTop:4 }}>Engagement</div>
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <PortalStatusChip s={a.portalStatus} />
          <div style={{ fontSize:13, color:"var(--fg-2)", marginTop:10, lineHeight:1.5 }}>
            <MI style={{ fontSize:15, verticalAlign:"-3px", color:P.engColor(weakest[1]) }}>trending_down</MI> Lowest area: <strong>{weakest[0]}</strong> at <strong style={{ color:P.engColor(weakest[1]) }}>{weakest[1]}%</strong>
          </div>
        </div>
      </div>

      {/* breakdown grouped into 3 buckets */}
      <div className="card card-pad" style={{ marginBottom:16 }}>
        {buckets.map((b, i) => (
          <div key={b.label} style={{ marginTop: i?16:0 }}>
            <div className="eyebrow" style={{ marginBottom:9 }}>{b.label}</div>
            {b.rows.map(([label,v]) => <ScoreBar key={label} label={label} v={v} />)}
          </div>
        ))}
      </div>

      {/* specialist teams */}
      <span className="eyebrow">Specialist Teams</span>
      <div className="dgrid" style={{ gridTemplateColumns:"repeat(3,1fr)", margin:"10px 0 16px" }}>
        {["DQA","Telecom","Fintech"].map(k => { const s=sp[k]; const m=P.SPEC_STATUS[s.status]||{c:"var(--fg-3)"}; return (
          <div className="dcell" key={k}><div className="dl">{k}</div>
            <div className="dv" style={{ fontSize:12.5, color:m.c, display:"flex", alignItems:"center", gap:5 }}><span className="flag-dot" style={{ background:m.c }} />{s.status}</div>
            <div style={{ fontSize:11, color:"var(--fg-3)", marginTop:3 }}>{s.name}</div></div>); })}
      </div>

      {/* product usage as stat tiles */}
      <span className="eyebrow">Product Usage</span>
      <div className="dgrid" style={{ gridTemplateColumns:"repeat(4,1fr)", margin:"10px 0 16px" }}>
        <UsageTile icon="group" label="Users" v={a.usage.usersLoggedIn} sub="logged in" />
        <UsageTile icon="engineering" label="Techs" v={a.usage.techsLoggedIn} sub="logged in" />
        <UsageTile icon="speed" label="TAD" v={a.usage.tadScore} sub="score" />
        <UsageTile icon="event_available" label="Jobs" v={a.usage.jobsBooked} sub="booked" />
      </div>

      {/* training */}
      <div className="card card-pad" style={{ marginBottom:16 }}>
        <span className="eyebrow">Training Progress</span>
        <div style={{ marginTop:10 }}>
          <ScoreBar label="POC" v={tr.poc} sm /><ScoreBar label="Admins" v={tr.admins} sm /><ScoreBar label="Non-admins" v={tr.nonAdmins} sm /><ScoreBar label="Technicians" v={tr.technicians} sm />
        </div>
      </div>

      <div className="dgrid" style={{ marginBottom:16 }}>
        <Dcell l="PGL Confidence" v={a.pglConfidence} />
        <Dcell l="Health updated" v={staleDays!=null?staleDays+"d ago":"—"} alert={staleDays!=null&&staleDays>14} />
        <Dcell l="Prev. software" v={a.previousSoftware} />
        <Dcell l="Package" v={a.packageName} />
        <Dcell l="Account level" v={a.accountLevel} />
        <Dcell l="Cohort" v={a.cohort} />
        <Dcell l="CSM" v={a.csm||"Not assigned"} />
        <Dcell l="Business focus" v={a.businessFocus} />
      </div>

      <div className="card card-pad" style={{ marginBottom:16 }}>
        <span className="eyebrow">Primary Contact</span>
        <div style={{ marginTop:8, fontSize:13.5, fontWeight:700 }}>{a.poc.name}</div>
        <div style={{ fontSize:12.5, color:"var(--fg-3)", marginTop:2 }}>{a.poc.email} · {a.poc.phone}</div>
      </div>

      {/* collapsible flash brief */}
      <div className="card card-pad" style={{ marginBottom:16, background:"var(--tint-blue-08)", borderColor:"var(--tint-blue-30)" }}>
        <span className="eyebrow" style={{ color:"var(--sky)" }}><MI style={{fontSize:15, verticalAlign:"-2px", marginRight:4}}>auto_awesome</MI>Flash Brief</span>
        <p style={{ fontSize:13.5, lineHeight:1.6, color:"var(--fg-1)", marginTop:8, display:"-webkit-box", WebkitLineClamp: briefOpen?"unset":2, WebkitBoxOrient:"vertical", overflow:"hidden" }}>{a.flashBrief}</p>
        <button className="btn btn-sm btn-ghost" style={{ marginTop:8, padding:"3px 8px" }} onClick={()=>setBriefOpen(o=>!o)}>{briefOpen?"Show less":"Show more"}<MI style={{fontSize:16}}>{briefOpen?"expand_less":"expand_more"}</MI></button>
      </div>

    </div>
  );
}
function UsageTile({ icon, label, v, sub }) {
  return <div className="dcell" style={{ display:"flex", alignItems:"center", gap:10 }}>
    <MI style={{ fontSize:20, color:"var(--sky)" }}>{icon}</MI>
    <div><div style={{ fontFamily:"var(--font-display)", fontWeight:700, fontSize:20, letterSpacing:"-.5px", lineHeight:1 }}>{v}</div>
    <div style={{ fontSize:10.5, color:"var(--fg-3)", fontWeight:700, marginTop:2 }}>{label} · {sub}</div></div>
  </div>;
}
function ScoreBar({ label, v, sm }) { const c = P.engColor(v); return <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:sm?6:7 }}><span style={{ fontSize:12, color:"var(--fg-2)", fontWeight:600, width:sm?92:140 }}>{label}</span><span className="bar" style={{ flex:1 }}><span style={{ width:v+"%", background:c }} /></span><span style={{ fontSize:12, fontWeight:700, color:c, width:34, textAlign:"right" }}>{v}%</span></div>; }
function KV({ k, v }) { return <div style={{ display:"flex", justifyContent:"space-between", fontSize:13 }}><span style={{ color:"var(--fg-3)", fontWeight:600 }}>{k}</span><span style={{ fontWeight:700 }}>{v}</span></div>; }

function EscalationTab({ a, commit, edit, rerender }) {
  const e = a.escalation;
  if (!e) {
    return (
      <div className="view-enter">
        <Empty icon="shield" title="No active escalation" sub="This account isn't flagged as an escalation." />
        <div style={{ textAlign:"center" }}>
          <button className="btn btn-primary" onClick={() => {
            a.escalation = { open:true, severity:"IC-Owned", owner:a.ic, opened:P.iso(P.now),
              reason:"", nextAction:"", nextActionDue:P.iso(P.addDays(P.now,3)), source:"Manual",
              concession:{ status:"None", tier:null, detail:null, amt:null },
              history:[{ date:P.iso(P.now), type:"opened", text:"Escalation opened manually." }] };
            commit(); rerender();
          }}><MI>add</MI>Open an escalation</button>
        </div>
      </div>
    );
  }
  const sev = P.SEV[e.severity] || { c:"var(--fg-2)" };
  const age = P.ageDays(e.opened);
  return (
    <div className="view-enter">
      <div className="card card-pad" style={{ marginBottom:16, display:"flex", gap:18, flexWrap:"wrap" }}>
        <div><div className="dl" style={{ fontSize:10, fontWeight:700, color:"var(--fg-3)", textTransform:"uppercase", letterSpacing:".5px" }}>Age</div>
          <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:4 }}><AgePill days={age} /><span style={{ fontSize:12, color:"var(--fg-3)" }}>since {fmtDate(e.opened)}</span></div></div>
        <div><div className="dl" style={{ fontSize:10, fontWeight:700, color:"var(--fg-3)", textTransform:"uppercase", letterSpacing:".5px" }}>Severity</div>
          <div style={{ marginTop:6 }}><span className="chip" style={{ background:"var(--soft)", borderColor:sev.c, color:sev.c }}><MI>flag</MI>{e.severity}</span></div></div>
        <div><div className="dl" style={{ fontSize:10, fontWeight:700, color:"var(--fg-3)", textTransform:"uppercase", letterSpacing:".5px" }}>Owner</div>
          <div style={{ display:"flex", alignItems:"center", gap:7, marginTop:5 }}><Avatar name={e.owner} size={20} /><span style={{ fontSize:13, fontWeight:700 }}>{e.owner}</span></div></div>
        <div><div className="dl" style={{ fontSize:10, fontWeight:700, color:"var(--fg-3)", textTransform:"uppercase", letterSpacing:".5px" }}>Source</div>
          <div style={{ fontSize:13, fontWeight:700, marginTop:6 }}>{e.source}</div></div>
        <div style={{ marginLeft:"auto" }}>
          <button className={"btn " + (e.open ? "" : "btn-ghost")} onClick={() => {
            e.open = !e.open;
            e.history.push({ date:P.iso(P.now), type:e.open?"reopened":"resolved", text:e.open?"Escalation re-opened.":"Escalation marked resolved." });
            commit(); rerender();
          }}>
            <MI>{e.open ? "check_circle" : "replay"}</MI>{e.open ? "Mark resolved" : "Re-open"}
          </button>
        </div>
      </div>

      <div className="field"><label>Reason</label>
        <textarea className="inp" value={e.reason} placeholder="What's driving this escalation?" onChange={ev => { e.reason = ev.target.value; rerender(); }} onBlur={commit} /></div>

      <div className="card card-pad" style={{ background:"var(--tint-blue-08)", borderColor:"var(--tint-blue-30)", marginBottom:16 }}>
        <span className="eyebrow" style={{ color:"var(--sky)" }}><MI style={{fontSize:15, verticalAlign:"-2px", marginRight:4}}>bolt</MI>Next Action</span>
        <div className="grid-2" style={{ marginTop:10, gridTemplateColumns:"2fr 1fr" }}>
          <input className="inp" value={e.nextAction} placeholder="What needs to happen next?" onChange={ev=>{e.nextAction=ev.target.value;rerender();}} onBlur={commit} />
          <input className="inp" type="date" value={e.nextActionDue||""} onChange={ev=>{e.nextActionDue=ev.target.value;rerender();}} onBlur={commit} />
        </div>
      </div>

      <ConcessionBlock e={e} commit={commit} rerender={rerender} />

      <span className="eyebrow">Escalation Timeline</span>
      <div className="tl" style={{ marginTop:14 }}>
        {e.history.map((h, i) => {
          const col = h.type==="opened"?"var(--red)":h.type==="resolved"?"var(--green)":h.type==="reopened"?"var(--yellow)":"var(--sky)";
          return <div className="tl-item" key={i}>
            <span className="tl-dot" style={{ background:col }} />
            <div className="tl-date">{fmtDateY(h.date)} · {h.type}</div>
            <div className="tl-text">{h.text}</div>
          </div>;
        })}
      </div>
    </div>
  );
}

function TicketsTab({ a, commit, rerender }) {
  const linked = new Set(a.linkedTickets || []);
  const churn = a.churnTickets || [];
  const hasAny = a.tickets.length > 0 || churn.length > 0;
  if (!hasAny) return <div className="view-enter"><Empty icon="receipt_long" title="No SFDC tickets" sub="No support cases found." /></div>;
  return (
    <div className="view-enter">
      {churn.length > 0 && (
        <div style={{ marginBottom:16 }}>
          <div className="eyebrow" style={{ color:"var(--red)", marginBottom:8 }}>Churn-Related Tickets ({churn.length})</div>
          {churn.map((ct, i) => (
            <div key={"churn-"+i} style={{ border:"1px solid rgba(226,79,79,.3)", borderRadius:8, marginBottom:8, background:"rgba(226,79,79,.06)", padding:"12px 14px" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:"flex", gap:7, alignItems:"center", flexWrap:"wrap" }}>
                    <span className="mono" style={{ fontSize:12, fontWeight:700 }}>{ct.num}</span>
                    <span className="chip" style={{ background:"rgba(226,79,79,.14)", color:"var(--red)", borderColor:"rgba(226,79,79,.4)" }}>{ct.component}</span>
                    <span className="chip" style={{ background: ct.status==="Closed"?"rgba(52,201,123,.12)":"rgba(245,193,67,.12)", color: ct.status==="Closed"?"var(--green)":"var(--yellow)" }}>{ct.status}</span>
                    {ct.terminationType && <span className="chip" style={{ background:"rgba(245,193,67,.12)", color:"var(--yellow)", borderColor:"rgba(245,193,67,.35)" }}>{ct.terminationType}</span>}
                  </div>
                  <div style={{ fontSize:13, color:"var(--fg-1)", marginTop:5, fontWeight:600 }}>{ct.subject}</div>
                  <div style={{ fontSize:11.5, color:"var(--fg-3)", marginTop:3 }}>{ct.created} · {ct.owner}</div>
                  {ct.reason && <div style={{ fontSize:12.5, color:"var(--fg-2)", marginTop:8, padding:"8px 10px", background:"rgba(226,79,79,.04)", borderRadius:6, lineHeight:1.5 }}>{ct.reason}</div>}
                  {ct.disposition && <div style={{ fontSize:11, color:"var(--fg-4)", marginTop:4 }}>Disposition: {ct.disposition}</div>}
                  {ct.churnMrr > 0 && <div style={{ fontSize:11, color:"var(--red)", fontWeight:700, marginTop:4 }}>Churn MRR: ${ct.churnMrr.toLocaleString()}</div>}
                </div>
                {ct.sfdcUrl && <a href={ct.sfdcUrl} target="_blank" rel="noopener" style={{ flexShrink:0, marginLeft:8 }}
                  onClick={e => e.stopPropagation()}>
                  <button className="btn btn-sm" style={{ fontSize:11, padding:"4px 8px" }}><MI style={{fontSize:14}}>open_in_new</MI> SFDC</button>
                </a>}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="hint" style={{ marginBottom:12 }}>Select cases related to this account's escalation. Linked: <strong style={{color:"var(--sky)"}}>{linked.size}</strong></div>
      {a.tickets.map((t, i) => {
        const on = linked.has(t.num);
        const open = !["Resolved","Closed"].includes(t.status);
        return (
          <div key={i} className="lrow" style={{ alignItems:"flex-start", border:"1px solid " + (on?"var(--tint-blue-30)":"var(--line)"), borderRadius:8, marginBottom:8, background: on?"var(--tint-blue-08)":"transparent" }}
            onClick={() => { if(on) a.linkedTickets = a.linkedTickets.filter(x=>x!==t.num); else a.linkedTickets=[...(a.linkedTickets||[]),t.num]; commit(); rerender(); }}>
            <span className={"chk" + (on?" on":"")} style={{ borderColor: on?"var(--accent)":"var(--line-2)", background: on?"var(--accent)":"transparent" }}>{on && <MI>check</MI>}</span>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:"flex", gap:7, alignItems:"center", flexWrap:"wrap" }}>
                <span className="mono" style={{ fontSize:12, fontWeight:700 }}>{t.num}</span>
                <span className="chip" style={{ background: open?"rgba(245,193,67,.12)":"rgba(52,201,123,.12)", color: open?"var(--yellow)":"var(--green)", borderColor: open?"rgba(245,193,67,.35)":"rgba(52,201,123,.35)" }}>{t.status}</span>
                {t.escFlag && <span className="chip" style={{ background:"rgba(226,79,79,.14)", color:"var(--red)", borderColor:"rgba(226,79,79,.4)" }}>Escalation</span>}
                <span className="chip" style={{ background:"var(--soft)", color:"var(--fg-3)", borderColor:"var(--line)" }}>{t.priority}</span>
              </div>
              <div style={{ fontSize:13, color:"var(--fg-1)", marginTop:5, fontWeight:600 }}>{t.subject}</div>
              <div style={{ fontSize:11.5, color:"var(--fg-3)", marginTop:3 }}>{fmtDateY(t.created)} · {t.agent}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CsatTab({ a }) {
  if (!a.csat.length) return <div className="view-enter"><Empty icon="reviews" title="No CSAT responses" sub="No survey responses recorded yet." /></div>;
  return (
    <div className="view-enter">
      {a.csatAvg != null && (
        <div className="card card-pad" style={{ display:"flex", alignItems:"center", gap:16, marginBottom:16 }}>
          <div style={{ fontFamily:"var(--font-display)", fontWeight:700, fontSize:42, letterSpacing:"-2px", color: a.csatAvg>=4?"var(--green)":a.csatAvg>=3?"var(--yellow)":"var(--red)" }}>{a.csatAvg.toFixed(1)}</div>
          <div><Stars score={a.csatAvg} /><div style={{ fontSize:12, color:"var(--fg-3)", fontWeight:700, marginTop:4 }}>{a.csat.length} response{a.csat.length!==1?"s":""}</div></div>
        </div>
      )}
      {a.csat.map((c, i) => (
        <div key={i} className="card card-pad" style={{ marginBottom:10 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <span style={{ display:"flex", alignItems:"center", gap:8 }}><Stars score={c.score} /><span className="pill-tag">{c.survey}</span></span>
            <span style={{ fontSize:11.5, color:"var(--fg-3)", fontWeight:700 }}>{fmtDateY(c.date)}</span>
          </div>
          <p style={{ fontSize:13.5, color:"var(--fg-2)", marginTop:9, lineHeight:1.55 }}>"{c.comment}"</p>
          <div style={{ fontSize:11.5, color:"var(--fg-4)", marginTop:6, fontWeight:700 }}>— {c.respondent}</div>
        </div>
      ))}
    </div>
  );
}

function NotesTab({ a }) {
  const [one11, setOne11] = useStateD("");
  const addToOneOnOne = () => {
    if (!one11.trim()) return;
    fetch("/api/oneonone-notes/add", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ic: a.ic, text: one11.trim(), accountId: a.id, accountName: a.tenant }),
    }).then(r => r.json()).then(() => {
      setOne11("");
      showToast("Added to your 1:1 with " + firstName(a.ic) + ".");
    }).catch(() => showToast("Couldn't add to 1:1. Try again."));
  };
  return (
    <div className="view-enter">
      {/* Running notes log + Next steps + call tasks (notes.jsx) */}
      <NotesLog account={a} />

      <div className="divider" />
      <span className="eyebrow">Add to 1:1 with {firstName(a.ic)}</span>
      <div style={{ fontSize:11.5, color:"var(--fg-3)", margin:"4px 0 10px" }}>A talking point for your next 1:1, tagged to {a.tenant}.</div>
      <div style={{ display:"flex", gap:8 }}>
        <input className="inp" value={one11} placeholder={"e.g. Discuss " + a.tenant + " timeline…"} onChange={e=>setOne11(e.target.value)}
          onKeyDown={e=>{ if(e.key==="Enter") addToOneOnOne(); }} />
        <button className="btn" onClick={addToOneOnOne} disabled={!one11.trim()}><MI>summarize</MI>Add to 1:1</button>
      </div>

      <div className="divider" />
      <span className="eyebrow">Assign a task</span>
      <div style={{ fontSize:11.5, color:"var(--fg-3)", margin:"4px 0 10px" }}>Assign a shared task to a teammate, tagged to {a.tenant}.</div>
      <window.AssignTaskForm accountId={a.id} account={a.tenant} defaultAssignee={a.ic} />
    </div>
  );
}

function ConcessionBlock({ e, commit, rerender }) {
  const c = e.concession || (e.concession = { status:"None", tier:null, detail:null, amt:null });
  const statuses = ["None","Offered","Accepted","Rejected"];
  const cs = P.CONCESSION_STATUS[c.status];
  const tierInfo = c.tier ? P.CTIER[c.tier] : null;
  return (
    <div className="card card-pad" style={{ marginBottom:16 }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
        <MI style={{ fontSize:18, color: cs ? cs.c : "var(--fg-3)" }}>redeem</MI>
        <span className="eyebrow">Concession</span>
        <span className="spacer" />
        {cs && <span className="chip" style={{ background:"var(--soft)", borderColor:cs.c, color:cs.c }}><MI>{cs.i}</MI>{c.status}</span>}
      </div>
      <div style={{ display:"flex", gap:6, marginBottom:c.status==="None"?0:12 }}>
        {statuses.map(s => {
          const on = c.status===s; const sc = P.CONCESSION_STATUS[s];
          return <button key={s} className="btn btn-sm" style={{ flex:1, justifyContent:"center",
            background: on ? (sc?sc.c:"var(--soft-2)") : "var(--soft)",
            color: on ? (s==="None"?"var(--fg-1)":"#fff") : "var(--fg-2)",
            borderColor: on ? (sc?sc.c:"var(--line-2)") : "var(--line)" }}
            onClick={()=>{ c.status=s; if(s==="None"){c.tier=null;c.detail=null;c.amt=null;} else if(!c.tier){c.tier="Tier 1 · Roberto";} commit(); rerender(); }}>{s}</button>;
        })}
      </div>
      {c.status!=="None" && (
        <div className="grid-2" style={{ gridTemplateColumns:"1fr 1fr", marginTop:4 }}>
          <div className="field" style={{ margin:0 }}><label>Approval tier</label>
            <select className="inp" value={c.tier||"Tier 1 · Roberto"} onChange={ev=>{c.tier=ev.target.value;commit();rerender();}}>
              {Object.keys(P.CTIER).map(k=><option key={k} value={k}>{k}</option>)}
            </select></div>
          <div className="field" style={{ margin:0 }}><label>What was offered</label>
            <input className="inp" value={c.detail||""} placeholder="e.g. 1 free month" onChange={ev=>{c.detail=ev.target.value;rerender();}} onBlur={commit} /></div>
          {tierInfo && <div className="hint full" style={{ gridColumn:"1/-1", marginTop:2 }}>
            <MI style={{fontSize:14, verticalAlign:"-2px", color:tierInfo.c}}>verified_user</MI> Requires approval from <strong>{tierInfo.approver}</strong></div>}
        </div>
      )}
    </div>
  );
}

Object.assign(window, { AccountDetail });
