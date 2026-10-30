/* Shared UI primitives + formatters for the portal. Exports to window. */
const { useState, useEffect, useRef, useMemo } = React;
const P = window.PORTAL;

/* ── formatters ── */
const fmtMoney = (v, cents) => {
  if (v == null || v === "") return "\u2014";
  const n = Number(v);
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
};
const fmtK = (v) => {
  if (v == null) return "\u2014";
  const n = Number(v);
  if (Math.abs(n) >= 1000) return "$" + (n/1000).toFixed(n%1000===0?0:1) + "K";
  return "$" + n;
};
// Date-only strings ("YYYY-MM-DD") parse as UTC midnight, which renders as the
// PREVIOUS day in US time zones. Anchor them at local noon so the date is stable.
const _localDate = (d) => (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) ? new Date(d + "T12:00:00") : new Date(d);
const fmtDate = (d) => {
  if (!d) return "\u2014";
  const dt = _localDate(d);
  if (isNaN(dt)) return "\u2014";
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};
const fmtDateY = (d) => {
  if (!d) return "\u2014";
  const dt = _localDate(d);
  if (isNaN(dt)) return "\u2014";
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};
const weeksIn = (d) => { const n = P.ageDays(d); return n==null?null:Math.floor(n/7); };
const relDay = (d) => {
  if (!d) return null;
  // Compare calendar days (midnight to midnight), not raw ms, so the time of
  // day on P.now doesn't tip a same-day date into "tomorrow".
  const t = _localDate(d); if (isNaN(t)) return null;
  const a = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  const b = new Date(P.now.getFullYear(), P.now.getMonth(), P.now.getDate());
  const n = Math.round((a - b) / 86400000);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  if (n < 0) return Math.abs(n) + "d ago";
  return "in " + n + "d";
};
const firstName = (n) => n.split(" ")[0];
const icOf = (name) => P.team.find(t => t.name === name) || { initials: (name || "?").slice(0,2).toUpperCase(), color: "#888" };

/* ── tiny components ── */
const MI = ({ children, fill, className, style }) =>
  React.createElement("span", { className: "mi" + (fill ? " fill" : "") + (className ? " " + className : ""), style }, children);

function Avatar({ name, size = 26 }) {
  const ic = icOf(name);
  return <span className="avatar" style={{ width: size, height: size, fontSize: size*0.4,
    background: ic.color, color: "#fff" }}>{ic.initials}</span>;
}

function HsChip({ hs, sm, mini }) {
  if (mini) {
    if (hs == null) return <span className="hs-chip hs-mini" title="No Score" style={{ background:"rgba(245,193,67,.12)", borderColor:"rgba(245,193,67,.4)", color:"var(--yellow)" }}>—</span>;
    const m = P.HS[hs];
    return <span className="hs-chip hs-mini" title={`${hs} · ${m.l}`} style={{ background:m.bg, borderColor:m.bd, color:m.c }}>{hs}</span>;
  }
  if (hs == null) return <span className="hs-chip" style={{ background:"rgba(245,193,67,.12)", borderColor:"rgba(245,193,67,.4)", color:"var(--yellow)" }}><MI>error</MI>No Score</span>;
  const m = P.HS[hs];
  return <span className="hs-chip" style={{ background:m.bg, borderColor:m.bd, color:m.c }}>
    <span className="n">{hs}</span><span>{m.l}</span></span>;
}

function StatusChip({ status }) {
  const m = P.STATUS[status] || { c:"var(--fg-2)", bg:"var(--soft-2)", bd:"var(--line)" };
  return <span className="chip" style={{ background:m.bg, borderColor:m.bd, color:m.c }}>{status}</span>;
}

function SentDot({ s, withLabel }) {
  if (!s) return null;
  const m = P.SENT[s] || { c:"var(--fg-3)" };
  return <span style={{ display:"inline-flex", alignItems:"center", gap:5, fontSize:11.5, fontWeight:700, color:m.c }}>
    <span className="flag-dot" style={{ background:m.c }} />{withLabel ? s : null}</span>;
}

function AgePill({ days }) {
  if (days == null) return null;
  let c = "var(--fg-3)", bg = "var(--soft-2)";
  if (days >= 21) { c = "var(--red)"; bg = "rgba(226,79,79,.14)"; }
  else if (days >= 10) { c = "#E8915B"; bg = "rgba(232,145,91,.14)"; }
  else if (days >= 5) { c = "var(--yellow)"; bg = "rgba(245,193,67,.14)"; }
  else { c = "var(--sky)"; bg = "rgba(109,186,248,.12)"; }
  return <span className="age-pill" style={{ color:c, background:bg }}>{days}d</span>;
}

function Stars({ score }) {
  const full = Math.round(score);
  return <span className="stars">{[1,2,3,4,5].map(i =>
    <MI key={i} fill={i <= full}>{i <= full ? "star" : "star"}</MI>)}</span>;
}

function KPI({ label, icon, value, unit, foot, footDir, accent, onClick, size }) {
  const dirClass = footDir === "up" ? "trend-up" : footDir === "dn" ? "trend-dn" : "trend-flat";
  return (
    <div className={"kpi" + (onClick ? " kpi-click" : "") + (size==="lg" ? " kpi-lg" : size==="sm" ? " kpi-sm" : "")}
      onClick={onClick} role={onClick ? "button" : undefined}>
      {accent && <span className="accent-bar" style={{ background: accent }} />}
      <div className="kl">{icon && <MI>{icon}</MI>}{label}{onClick && <MI className="kpi-go">chevron_right</MI>}</div>
      <div className="kv">{value}{unit && <span className="unit">{unit}</span>}</div>
      {foot && <div className={"kfoot " + dirClass}>
        {footDir && <MI>{footDir==="up"?"trending_up":footDir==="dn"?"trending_down":"trending_flat"}</MI>}{foot}</div>}
    </div>
  );
}

function Card({ title, count, action, children, pad }) {
  return (
    <div className="card">
      {(title || action) && (
        <div className="card-hd">
          {title && <h3>{title}</h3>}
          {count != null && <span className="ct">{count}</span>}
          <span className="spacer" />
          {action}
        </div>
      )}
      {pad ? <div className="card-pad">{children}</div> : children}
    </div>
  );
}

function Bar({ value, max, color, height = 7 }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return <div className="bar" style={{ height }}><span style={{ width: pct + "%", background: color }} /></div>;
}

function Empty({ icon, title, sub }) {
  return <div className="empty"><MI>{icon || "inbox"}</MI><div style={{ fontWeight:700, color:"var(--fg-2)", fontSize:14 }}>{title}</div>{sub && <div style={{ fontSize:13, marginTop:4 }}>{sub}</div>}</div>;
}

function PortalStatusChip({ s, short }) {
  if (!s) return null;
  const m = P.PORTAL_STATUS[s] || { c:"var(--fg-3)", i:"help" };
  return <span className="chip" style={{ background:"var(--soft)", borderColor:m.c, color:m.c }}><MI>{m.i}</MI>{short ? s.replace(" - Needs Action","") : s}</span>;
}

// Red "Balance" badge for accounts carrying a NEGATIVE outstanding balance
// (the warehouse convention: negative = money owed / in arrears; small positive
// balances are normal pre-billing amounts and aren't flagged). The dollar amount
// is on the tooltip; pass sm for a compact variant.
function BalanceBadge({ amount, sm }) {
  if (!amount || amount >= 0) return null;
  return <span className="chip" title={"Outstanding balance: " + fmtMoney(amount)}
    style={{ background:"rgba(226,79,79,.14)", borderColor:"rgba(226,79,79,.42)", color:"var(--red)", fontSize: sm?9.5:10.5 }}>
    <MI style={{ fontSize: sm?11:13 }}>account_balance_wallet</MI>Balance</span>;
}

function EngScore({ score, withBar }) {
  if (score == null) return <span className="muted">—</span>;
  const c = P.engColor(score);
  if (withBar) return <span style={{ display:"flex", alignItems:"center", gap:8, justifyContent:"flex-end" }}>
    <span style={{ fontFamily:"var(--font-display)", fontWeight:700, color:c, width:24, textAlign:"right" }}>{score}</span>
    <span className="bar" style={{ width:54 }}><span style={{ width:score+"%", background:c }} /></span></span>;
  return <span style={{ fontFamily:"var(--font-display)", fontWeight:700, color:c }}>{score}</span>;
}

function SpecDots({ specialists }) {
  if (!specialists) return null;
  return <span style={{ display:"inline-flex", gap:4 }}>{["DQA","Telecom","Fintech"].map(k => {
    const st = specialists[k]; const m = P.SPEC_STATUS[st.status] || { c:"var(--fg-3)" };
    return <span key={k} title={`${k}: ${st.status}`} className="flag-dot" style={{ background:m.c, width:7, height:7, opacity: st.status==="Opted Out"?.4:1 }} />;
  })}</span>;
}

/* Multi-select checkbox dropdown — empty selection = "all shown" */
function MultiSelect({ label, options, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  // Explicit selection: `selected` is exactly what's checked. All checked = show
  // all (the parent treats a full selection as no filter); none checked = show none.
  const isOn = (v) => selected.includes(v);
  const toggle = (v) => onChange(isOn(v) ? selected.filter(x => x !== v) : [...selected, v]);
  const allShown = selected.length === options.length;
  const noneShown = selected.length === 0;
  const summary = allShown ? `All ${label}` : noneShown ? `No ${label}` : selected.length === 1 ? selected[0] : `${selected.length} of ${options.length} ${label}`;
  return (
    <div className="ms" ref={ref}>
      <button className={"select-sm ms-trigger" + (allShown ? "" : " ms-active")} onClick={() => setOpen(o => !o)}>
        {summary}<MI style={{ fontSize: 16, marginLeft: 2 }}>{open ? "expand_less" : "expand_more"}</MI>
      </button>
      {open && (
        <div className="ms-pop">
          <div className="ms-allrow">
            <button className="ms-all" onClick={() => onChange(options.slice())}>Select all</button>
            <button className="ms-all" onClick={() => onChange([])}>Deselect all</button>
          </div>
          {options.map(o => (
            <button key={o} className="ms-opt" onClick={() => toggle(o)}>
              <span className={"ms-check" + (isOn(o) ? " on" : "")}>{isOn(o) && <MI>check</MI>}</span>
              <span style={{ flex: 1, textAlign: "left" }}>{o}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* health-score helpers used across views */
const isEsc = (a) => a.hs != null && a.hs <= 3;
const impLive = (a) => a.status === "Implementation" || a.status === "Live";
const reviewHrs = (a) => a.transitionStatusUpdatedAt ? P.weekdayHoursBetween(a.transitionStatusUpdatedAt, P.now) : null;
const inThisWeek = (d) => { if(!d) return false; const x=new Date(d); const diff=Math.floor((x-P.monday)/86400000); return diff>=0 && diff<=4; };
// Single source of truth for compliance rules; used by Compliance and by the Accounts "Flagged" filter.
const COMPLIANCE_TESTS = {
  noHS: a => impLive(a) && a.hs==null,
  noComments: a => impLive(a) && a.hs!=null && !a.hsComment,
  staleHS: a => impLive(a) && a.hsLastUpdated && P.ageDays(a.hsLastUpdated)>window.HS_STALE_DAYS,
  pglOverdue: a => a.pgl && new Date(a.pgl)<P.now && a.status!=="Live" && a.status!=="Hold",
  transOverdue: a => a.antTransitionDate && new Date(a.antTransitionDate)<P.now && !a.transitioned && a.status!=="Hold",
  antBeforePgl: a => a.antTransitionDate && a.pgl && new Date(a.antTransitionDate)<new Date(a.pgl),
  transWeekNotLive: a => a.antTransitionDate && inThisWeek(a.antTransitionDate) && a.status!=="Live" && a.status!=="Hold" && a.status!=="Success",
  awaitingReview: a => a.successTransitionStatus==="Needs CSM Review" && reviewHrs(a)!=null && reviewHrs(a)>=24,
  hypercareLong: a => a.status==="Live" && !a.transitioned && a.liveDate && P.ageDays(a.liveDate)>14,
  noHandoffDate: a => impLive(a) && !a.transitioned && !a.antTransitionDate,
};
const COMPLIANCE_LABELS = {
  noHS: { short:"No health score", color:"var(--red)", icon:"error" },
  noComments: { short:"No HS comments", color:"var(--yellow)", icon:"comment" },
  staleHS: { short:"Stale health score", color:"var(--yellow)", icon:"update" },
  pglOverdue: { short:"Go-live date passed", color:"var(--red)", icon:"event_busy" },
  transOverdue: { short:"Success transition overdue", color:"var(--red)", icon:"schedule" },
  antBeforePgl: { short:"Success date before go-live", color:"#E8915B", icon:"swap_vert" },
  transWeekNotLive: { short:"Success this week, not live", color:"var(--red)", icon:"emergency" },
  awaitingReview: { short:"Review over 24h", color:"var(--red)", icon:"rate_review" },
  hypercareLong: { short:"Hypercare over 2 weeks", color:"var(--yellow)", icon:"timer" },
  noHandoffDate: { short:"No Success transition date", color:"var(--yellow)", icon:"event_busy" },
};
const isFlagged = (a) => impLive(a) && Object.values(COMPLIANCE_TESTS).some(t => t(a));
const pglOverdue = (a) => a.pgl && new Date(a.pgl) < P.now && a.status !== "Live" && a.status !== "Hold";

/* ── toast ── */
function showToast(msg, ms = 3800) {
  let host = document.getElementById("toast-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "toast-host";
    host.style.cssText = "position:fixed;bottom:26px;left:50%;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;gap:8px;align-items:center;pointer-events:none;";
    document.body.appendChild(host);
  }
  const t = document.createElement("div");
  t.textContent = msg;
  t.style.cssText = "background:var(--accent);color:#fff;padding:11px 18px;border-radius:9px;font-size:13px;font-weight:600;box-shadow:0 6px 22px rgba(0,0,0,.28);max-width:440px;text-align:center;opacity:0;transform:translateY(8px);transition:opacity .2s,transform .2s;";
  host.appendChild(t);
  requestAnimationFrame(() => { t.style.opacity = "1"; t.style.transform = "translateY(0)"; });
  setTimeout(() => { t.style.opacity = "0"; t.style.transform = "translateY(8px)"; setTimeout(() => t.remove(), 250); }, ms);
}

Object.assign(window, {
  fmtMoney, fmtK, fmtDate, fmtDateY, weeksIn, relDay, firstName, icOf,
  MI, Avatar, HsChip, StatusChip, SentDot, AgePill, Stars, KPI, Card, Bar, Empty,
  PortalStatusChip, EngScore, SpecDots, MultiSelect, BalanceBadge,
  isEsc, isFlagged, pglOverdue, COMPLIANCE_TESTS, COMPLIANCE_LABELS, reviewHrs, impLive, showToast,
});
