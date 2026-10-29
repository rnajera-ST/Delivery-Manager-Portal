/* Escalation tracker module — aging, owner/next-action, quick-add */
const { useState: useStateE } = React;

function RcaMissingPanel({ accounts, onOpen }) {
  const [expanded, setExpanded] = useStateE(false);
  const [icFilter, setIcFilter] = useStateE("All");

  const ics = [...new Set(accounts.map(a => a.ic))].sort();
  const visible = icFilter === "All" ? accounts : accounts.filter(a => a.ic === icFilter);

  return (
    <div className="card" style={{ marginBottom:16, borderColor:"var(--tint-red-25)" }}>
      <div className="card-hd" style={{ cursor:"pointer", background:"var(--tint-red-10)" }}
        onClick={() => setExpanded(x => !x)}>
        <MI style={{ fontSize:19, color:"var(--red)" }}>assignment_late</MI>
        <div>
          <div style={{ fontWeight:800, fontSize:14 }}>{accounts.length} account{accounts.length!==1?"s":""} missing an RCA</div>
          <div style={{ fontSize:11.5, color:"var(--fg-3)", fontWeight:600 }}>health 0–2 · escalation opened after Apr 1 · no RCA row in tracker</div>
        </div>
        <span className="spacer" />
        <MI style={{ fontSize:18, color:"var(--fg-4)" }}>{expanded ? "expand_less" : "expand_more"}</MI>
      </div>

      {expanded && <>
        {ics.length > 1 && (
          <div style={{ padding:"10px 16px", borderBottom:"1px solid var(--line)", display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:11, fontWeight:800, color:"var(--fg-4)", textTransform:"uppercase", letterSpacing:".5px" }}>IC</span>
            <div className="seg">
              <button className={icFilter==="All"?"on":""} onClick={e=>{e.stopPropagation();setIcFilter("All")}}>All ({accounts.length})</button>
              {ics.map(ic => (
                <button key={ic} className={icFilter===ic?"on":""} onClick={e=>{e.stopPropagation();setIcFilter(ic)}}>
                  {firstName(ic)} ({accounts.filter(a=>a.ic===ic).length})
                </button>
              ))}
            </div>
          </div>
        )}
        <div>
          {visible.map((a, i) => (
            <div key={a.id} className="lrow" onClick={() => onOpen(a)}
              style={{ padding:"12px 16px", cursor:"pointer", borderBottom: i<visible.length-1?"1px solid var(--line)":"none", alignItems:"flex-start" }}>
              <HsChip hs={a.hs} />
              <div style={{ flex:1, minWidth:0, marginLeft:10 }}>
                <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                  <span className="acct-name" style={{ fontSize:13.5 }}>{a.tenant}</span>
                  <StatusChip status={a.status} />
                </div>
                <div style={{ display:"flex", gap:16, marginTop:5, flexWrap:"wrap" }}>
                  <span style={{ fontSize:12, color:"var(--fg-3)", fontWeight:600, display:"flex", alignItems:"center", gap:4 }}>
                    <Avatar name={a.ic} size={16} />{a.ic}
                  </span>
                  {a.escalation && <>
                    <span style={{ fontSize:12, color:"var(--fg-3)", fontWeight:600 }}>
                      <MI style={{ fontSize:13, verticalAlign:"-2px" }}>flag</MI> {a.escalation.severity}
                    </span>
                    <span style={{ fontSize:12, color:"var(--fg-3)", fontWeight:600 }}>
                      <MI style={{ fontSize:13, verticalAlign:"-2px" }}>schedule</MI> Opened {P.ageDays(a.escalation.opened)}d ago
                    </span>
                  </>}
                  {a.cmrr > 0 && (
                    <span style={{ fontSize:12, color:"var(--fg-3)", fontWeight:600 }}>
                      <MI style={{ fontSize:13, verticalAlign:"-2px" }}>payments</MI> {fmtMoney(a.cmrr)}
                    </span>
                  )}
                </div>
                {a.escalation && a.escalation.reason && (
                  <div style={{ fontSize:12, color:"var(--fg-4)", marginTop:4, fontStyle:"italic" }}>{a.escalation.reason}</div>
                )}
              </div>
              <MI style={{ color:"var(--fg-4)", fontSize:18, flexShrink:0 }}>chevron_right</MI>
            </div>
          ))}
        </div>
      </>}
    </div>
  );
}

function Escalations({ accounts, onOpen, onSave }) {
  const [mode, setMode] = useStateE("open");
  const [sort, setSort] = useStateE("age");
  const [icFilter, setIcFilter] = useStateE("All");
  const [adding, setAdding] = useStateE(false);
  const [, force] = useStateE(0);

  const rca = window.useRca ? window.useRca() : null;
  const rcaFor = (a) => window.rcaForAccount ? window.rcaForAccount(rca, a) : null;
  // RCA required: hs 0-2 with an escalation opened on or after April 1 2026, no RCA row yet.
  const RCA_CUTOFF = new Date("2026-04-01");
  const rcaMissing = accounts.filter(a =>
    a.hs != null && a.hs <= 2 &&
    a.escalation && a.escalation.opened && new Date(a.escalation.opened) >= RCA_CUTOFF &&
    !rcaFor(a)
  ).sort((a, b) => (a.hs ?? 9) - (b.hs ?? 9));

  const withEsc = accounts.filter(a => a.escalation);
  let rows = withEsc.filter(a => mode==="open" ? a.escalation.open : mode==="resolved" ? !a.escalation.open : true);
  if (icFilter !== "All") rows = rows.filter(a => a.ic === icFilter);

  const sortFns = {
    age: (a,b) => P.ageDays(b.escalation.opened) - P.ageDays(a.escalation.opened),
    severity: (a,b) => sevRank(b.escalation.severity) - sevRank(a.escalation.severity),
    cmrr: (a,b) => b.cmrr - a.cmrr,
    due: (a,b) => new Date(a.escalation.nextActionDue||"2099") - new Date(b.escalation.nextActionDue||"2099"),
  };
  rows = [...rows].sort(sortFns[sort]);

  const openCount = withEsc.filter(a=>a.escalation.open).length;
  const resolvedCount = withEsc.length - openCount;
  const cmrrAtStake = withEsc.filter(a=>a.escalation.open).reduce((s,a)=>s+a.cmrr,0);
  const overdueActions = withEsc.filter(a=>a.escalation.open && a.escalation.nextActionDue && new Date(a.escalation.nextActionDue)<P.now).length;
  const avgAge = openCount ? Math.round(withEsc.filter(a=>a.escalation.open).reduce((s,a)=>s+P.ageDays(a.escalation.opened),0)/openCount) : 0;

  return (
    <div className="view-enter">
      <div className="kpi-grid" style={{ gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))" }}>
        <KPI icon="warning" label="Open" value={openCount} accent="var(--red)" foot={`${resolvedCount} resolved`} footDir="flat" />
        <KPI icon="payments" label="CMRR at Stake" value={fmtK(cmrrAtStake)} accent="var(--yellow)" foot="open escalations" footDir="flat" />
        <KPI icon="hourglass_top" label="Avg Open Age" value={avgAge} unit="d" accent="var(--sky)" foot="time since opened" footDir="flat" />
        <KPI icon="event_busy" label="Overdue Actions" value={overdueActions} accent="var(--red)" foot="next-action past due" footDir={overdueActions?"dn":"flat"} />
      </div>

      {rcaMissing.length > 0 && (
        <RcaMissingPanel accounts={rcaMissing} onOpen={onOpen} />
      )}

      <div className="toolbar">
        <div className="seg">
          {[["open",`Open (${openCount})`],["resolved",`Resolved (${resolvedCount})`],["all",`All (${withEsc.length})`]].map(([k,lb]) =>
            <button key={k} className={mode===k?"on":""} onClick={()=>setMode(k)}>{lb}</button>)}
        </div>
        <select className="select-sm" value={icFilter} onChange={e=>setIcFilter(e.target.value)}>
          <option value="All">All ICs</option>
          {P.team.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
        </select>
        <select className="select-sm" value={sort} onChange={e=>setSort(e.target.value)}>
          <option value="age">Sort: Age</option>
          <option value="severity">Sort: Severity</option>
          <option value="cmrr">Sort: CMRR</option>
          <option value="due">Sort: Next action due</option>
        </select>
        <span className="spacer" />
        <button className="btn btn-primary" onClick={()=>setAdding(true)}><MI>add</MI>Quick-add escalation</button>
      </div>

      {adding && <QuickAdd accounts={accounts} onClose={()=>setAdding(false)} onSave={onSave} onDone={(a)=>{ setAdding(false); force(x=>x+1); onOpen(a); }} />}

      {rows.length===0 ? <Empty icon="verified" title="No escalations here" sub="Nothing matches this filter." /> : (
        <div className="col" style={{ gap:11 }}>
          {rows.map(a => <EscCard key={a.id} a={a} onOpen={onOpen} rca={rcaFor(a)} />)}
        </div>
      )}
    </div>
  );
}

function EscCard({ a, onOpen, rca }) {
  const e = a.escalation;
  const sev = P.SEV[e.severity] || { c:"var(--fg-2)" };
  const age = P.ageDays(e.opened);
  const dueOverdue = e.nextActionDue && new Date(e.nextActionDue) < P.now && e.open;
  return (
    <div className="card" style={{ display:"flex", overflow:"hidden", cursor:"pointer", borderColor: e.open?"var(--line)":"var(--soft)", opacity: e.open?1:.62 }}
      onClick={()=>onOpen(a)}
      onMouseEnter={e2=>e2.currentTarget.style.borderColor="var(--tint-blue-30)"}
      onMouseLeave={e2=>e2.currentTarget.style.borderColor=e.open?"var(--line)":"var(--soft)"}>
      <div style={{ width:4, background:sev.c, flexShrink:0 }} />
      <div className="card-pad" style={{ flex:1, padding:"16px 20px" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
          <span className="acct-name" style={{ fontSize:15 }}>{a.tenant}</span>
          <HsChip hs={a.hs} />
          <StatusChip status={a.status} />
          <span className="chip" style={{ background:"var(--soft)", borderColor:sev.c, color:sev.c }}><MI>flag</MI>{e.severity}</span>
          {e.source==="Manual"
            ? <span className="chip" style={{ background:"var(--soft)", borderColor:"var(--line-2)", color:"var(--fg-2)" }}><MI>person_edit</MI>Manager-created</span>
            : <span className="chip" style={{ background:"var(--tint-blue-08)", borderColor:"var(--tint-blue-30)", color:"var(--sky)" }}><MI>sensors</MI>Auto-detected</span>}
          {!e.open && <span className="chip" style={{ background:"rgba(52,201,123,.12)", color:"var(--green)", borderColor:"rgba(52,201,123,.35)" }}><MI>check_circle</MI>Resolved</span>}
          {window.RcaBadge && <window.RcaBadge account={a} rca={rca} />}
          <span className="spacer" />
          <span style={{ display:"flex", alignItems:"center", gap:7 }}>
            <span style={{ fontSize:11, color:"var(--fg-4)", fontWeight:700, textTransform:"uppercase", letterSpacing:".5px" }}>Open</span>
            <AgePill days={age} />
          </span>
        </div>
        <p style={{ fontSize:13, color:"var(--fg-2)", marginTop:9, lineHeight:1.5, maxWidth:680 }}>{e.reason}</p>
        <div style={{ display:"flex", alignItems:"center", gap:18, marginTop:12, flexWrap:"wrap" }}>
          <span style={{ display:"flex", alignItems:"center", gap:7 }}><Avatar name={e.owner} size={20} />
            <span style={{ fontSize:12, fontWeight:700 }}>{e.owner}</span>
            <span style={{ fontSize:11.5, color:"var(--fg-4)" }}>owner</span></span>
          <span style={{ fontSize:12, color:"var(--fg-3)", fontWeight:700 }}><MI style={{fontSize:14, verticalAlign:"-2px"}}>person</MI> {firstName(a.ic)} · IC</span>
          <span style={{ fontSize:12, color:"var(--fg-3)", fontWeight:700 }}><MI style={{fontSize:14, verticalAlign:"-2px"}}>payments</MI> {fmtMoney(a.cmrr)} CMRR</span>
          <span style={{ fontSize:12, color:"var(--fg-3)", fontWeight:700 }}><MI style={{fontSize:14, verticalAlign:"-2px"}}>source</MI> {e.source}</span>
          {e.concession && e.concession.status!=="None" && (()=>{ const cs=P.CONCESSION_STATUS[e.concession.status]||{c:"var(--fg-3)",i:"redeem"}; return (
            <span style={{ fontSize:12, fontWeight:700, color:cs.c, display:"inline-flex", alignItems:"center", gap:5 }}><MI style={{fontSize:14}}>{cs.i}</MI>Concession {e.concession.status.toLowerCase()} · {e.concession.detail}</span>
          ); })()}
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:18, marginTop:10, flexWrap:"wrap" }}>
          {window.AccountCalls && <window.AccountCalls account={a} compact />}
          {window.AccountEmails && <window.AccountEmails account={a} compact />}
        </div>
        {e.open && e.nextAction && (
          <div style={{ marginTop:12, padding:"10px 13px", borderRadius:8, background:"var(--tint-blue-08)", border:"1px solid var(--tint-blue-30)", display:"flex", alignItems:"center", gap:10 }}>
            <MI style={{ color:"var(--sky)", fontSize:18 }}>bolt</MI>
            <span style={{ fontSize:13, fontWeight:600, flex:1 }}>{e.nextAction}</span>
            {e.nextActionDue && <span className="chip" style={{ background: dueOverdue?"rgba(226,79,79,.14)":"var(--soft)", color: dueOverdue?"var(--red)":"var(--fg-3)", borderColor: dueOverdue?"rgba(226,79,79,.4)":"var(--line)" }}>{dueOverdue?"Overdue · ":""}{relDay(e.nextActionDue)}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function QuickAdd({ accounts, onClose, onSave, onDone }) {
  const free = accounts.filter(a => !a.escalation).sort((a,b)=>(a.hs??9)-(b.hs??9));
  const [acctId, setAcctId] = useStateE(free[0]?.id || "");
  const [sev, setSev] = useStateE("Manager-Engaged");
  const [owner, setOwner] = useStateE("Roberto");
  const [reason, setReason] = useStateE("");
  const [nextAction, setNextAction] = useStateE("");

  const submit = () => {
    const a = accounts.find(x => x.id === acctId);
    if (!a) return;
    a.escalation = { open:true, severity:sev, owner, opened:P.iso(P.now), reason: reason||"(no detail provided)",
      nextAction, nextActionDue:P.iso(P.addDays(P.now,3)), source:"Manual", concession:{ status:"None", tier:null, detail:null, amt:null },
      history:[{ date:P.iso(P.now), type:"opened", text:"Escalation opened manually" + (reason?` — ${reason}`:".") }] };
    onSave && onSave(a);
    onDone(a);
  };

  return (
    <>
      <div className="overlay-bg" onClick={onClose} />
      <div className="card" style={{ position:"fixed", top:"12%", left:"50%", transform:"translateX(-50%)", width:"min(560px,92vw)", zIndex:92, boxShadow:"var(--shadow-lg)", background:"var(--bg-page)" }}>
        <div className="card-hd"><h3>Quick-add escalation</h3><span className="spacer" /><button className="btn icon-btn btn-ghost" onClick={onClose}><MI>close</MI></button></div>
        <div className="card-pad">
          <div className="field"><label>Account</label>
            <select className="inp" value={acctId} onChange={e=>setAcctId(e.target.value)}>
              {free.map(a => <option key={a.id} value={a.id}>{a.tenant} — {a.ic}{a.hs!=null?` (HS ${a.hs})`:""}</option>)}
            </select></div>
          <div className="grid-2">
            <div className="field"><label>Severity</label>
              <select className="inp" value={sev} onChange={e=>setSev(e.target.value)}>{Object.keys(P.SEV).map(s=><option key={s} value={s}>{s}</option>)}</select></div>
            <div className="field"><label>Owner</label>
              <select className="inp" value={owner} onChange={e=>setOwner(e.target.value)}>
                <option>Roberto</option><option>Alyssa Conway</option>
                {P.team.map(t=><option key={t.name}>{t.name}</option>)}
              </select></div>
          </div>
          <div className="field"><label>Reason</label>
            <textarea className="inp" value={reason} placeholder="What's driving this escalation?" onChange={e=>setReason(e.target.value)} /></div>
          <div className="field"><label>Next action</label>
            <input className="inp" value={nextAction} placeholder="First recovery step…" onChange={e=>setNextAction(e.target.value)} /></div>
          <div style={{ display:"flex", justifyContent:"flex-end", gap:9, marginTop:6 }}>
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={!acctId} onClick={submit}><MI>add</MI>Open escalation</button>
          </div>
        </div>
      </div>
    </>
  );
}

function sevRank(s){ return { "IC-Owned":1, "Manager-Engaged":2, "Leadership":3 }[s] || 0; }

Object.assign(window, { Escalations });
