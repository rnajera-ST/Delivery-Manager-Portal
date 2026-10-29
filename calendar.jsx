/* calendar.jsx — Google Calendar UI: shared status hook, event rows, the
   account-detail Calendar tab, and small summary widgets. IIFE-wrapped to avoid
   the top-level `const {useState}` collision other scripts hit. */
(function () {
  const { useState, useEffect } = React;
  const MI = window.MI;
  const Empty = window.Empty;

  // ── Formatting ──────────────────────────────────────────────────────────
  const fmtEvtTime = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  };
  const fmtEvtDay = (iso) => {
    if (!iso) return "";
    const d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  };
  const stName = (email) => (email || "").split("@")[0].replace(/[._]/g, " ");

  // ── Connection status (cached across mounts for the session) ──────────────
  let _statusCache = null;
  function useCalStatus() {
    const [status, setStatus] = useState(_statusCache);
    useEffect(() => {
      if (_statusCache) return;
      let alive = true;
      fetch("/api/calendar/status").then(r => r.json()).then(s => {
        _statusCache = s; if (alive) setStatus(s);
      }).catch(() => { const s = { connected: false, configured: false }; _statusCache = s; if (alive) setStatus(s); });
      return () => { alive = false; };
    }, []);
    return status;
  }
  const clearCalStatus = () => { _statusCache = null; };

  // ── Small pieces ──────────────────────────────────────────────────────────
  function AttendeePills({ attendees }) {
    if (!attendees || !attendees.length) return null;
    const cust = attendees.filter(a => a.email && !a.email.toLowerCase().includes("@servicetitan.com"));
    const internal = attendees.length - cust.length;
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 5 }}>
        {cust.map((a, i) => (
          <span key={i} className="chip" style={{ fontSize: 10.5, color: "var(--purple)", borderColor: "transparent", background: "color-mix(in srgb, var(--purple) 14%, transparent)" }}>
            <MI style={{ fontSize: 12 }}>person</MI>{a.email}</span>
        ))}
        {internal > 0 && <span className="chip" style={{ fontSize: 10.5, color: "var(--fg-3)", background: "var(--soft)", borderColor: "transparent" }}>{internal} internal</span>}
      </div>
    );
  }

  function EventRow({ ev, compact }) {
    return (
      <div className="lrow" style={{ alignItems: "flex-start", padding: compact ? "7px 0" : "10px 0", borderBottom: "1px solid var(--line)" }}>
        <span style={{ width: 30, height: 30, flexShrink: 0, borderRadius: 8, display: "inline-flex", alignItems: "center", justifyContent: "center",
          background: ev.isCustomerCall ? "color-mix(in srgb, var(--purple) 14%, transparent)" : "var(--soft)", color: ev.isCustomerCall ? "var(--purple)" : "var(--fg-3)", marginRight: 10 }}>
          <MI style={{ fontSize: 16 }}>{ev.isCustomerCall ? "groups" : "event"}</MI></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{ev.summary}</div>
          <div style={{ fontSize: 11.5, color: "var(--fg-3)", marginTop: 1 }}>{fmtEvtTime(ev.start)}</div>
          {!compact && <AttendeePills attendees={ev.attendees} />}
        </div>
      </div>
    );
  }

  const CONF = {
    high: { c: "var(--green)", t: "Calls matched", i: "check_circle" },
    medium: { c: "var(--yellow)", t: "Likely matches", i: "help" },
    none: { c: "var(--fg-3)", t: "No calls found", i: "event_busy" },
  };
  function ConfBadge({ confidence }) {
    const m = CONF[confidence || "none"];
    return (
      <span className="chip" style={{ fontSize: 11, fontWeight: 800, color: m.c, borderColor: "transparent", background: "color-mix(in srgb, " + m.c + " 13%, transparent)" }}>
        <MI style={{ fontSize: 13 }}>{m.i}</MI>{m.t}</span>
    );
  }

  function NotConnected({ sub }) {
    return <Empty icon="calendar_month" title="Calendar not connected" sub={sub || "Connect Google Calendar in Settings to see scheduled calls."} />;
  }

  // ── Account-detail Calendar tab (replaces the old CSAT tab) ────────────────
  function CalendarTab({ account }) {
    const status = useCalStatus();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
      if (!status) return;
      if (!status.connected) { setLoading(false); return; }
      let alive = true; setLoading(true);
      fetch("/api/calendar/account?accountId=" + encodeURIComponent(account.id))
        .then(r => r.json()).then(d => { if (alive) { setData(d); setLoading(false); } })
        .catch(() => { if (alive) setLoading(false); });
      return () => { alive = false; };
    }, [status, account.id]);

    const events = (data && data.allEvents) || [];
    let calBody;
    if (!status || loading) calBody = <div style={{ padding: "10px 2px", color: "var(--fg-3)", fontSize: 13 }}>Loading calendar…</div>;
    else if (!status.connected) calBody = <NotConnected />;
    else if (data && data.error === "no_ic_email") calBody = <Empty icon="alternate_email" title="No calendar email on file" sub={"No Snowflake email found for " + (data.ic || "this IC") + ", so their calendar can't be matched."} />;
    else if (data && data.error === "calendar_access_denied") calBody = <Empty icon="lock" title="Calendar not shared" sub={"Can't read " + (data.ic || "the IC") + "'s calendar. They may need to share it with you."} />;
    else if (!data) calBody = <NotConnected />;
    else calBody = (
      <>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
          <ConfBadge confidence={data.matchConfidence} />
          <span style={{ fontSize: 11.5, color: "var(--fg-4)" }}>{data.ic ? data.ic + "'s calendar" : ""}{data.icEmail ? " · " + data.icEmail : ""}</span>
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
          <div style={{ flex: 1, minWidth: 220, padding: 13, borderRadius: 11, border: "1px solid var(--line)", background: "var(--card-2)" }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".5px", textTransform: "uppercase", color: "var(--fg-4)", marginBottom: 6 }}>Next call</div>
            {data.nextCall ? (<>
              <div style={{ fontSize: 13.5, fontWeight: 700 }}>{data.nextCall.summary}</div>
              <div style={{ fontSize: 12, color: "var(--sky)", fontWeight: 700, marginTop: 2 }}>{fmtEvtTime(data.nextCall.start)}</div>
              <AttendeePills attendees={data.nextCall.attendees} />
            </>) : <div style={{ fontSize: 12.5, color: "var(--fg-4)" }}>Nothing scheduled.</div>}
          </div>
          <div style={{ flex: 1, minWidth: 220, padding: 13, borderRadius: 11, border: "1px solid var(--line)", background: "var(--card-2)" }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".5px", textTransform: "uppercase", color: "var(--fg-4)", marginBottom: 6 }}>Last call</div>
            {data.lastCall ? (<>
              <div style={{ fontSize: 13.5, fontWeight: 700 }}>{data.lastCall.summary}</div>
              <div style={{ fontSize: 12, color: "var(--fg-3)", fontWeight: 700, marginTop: 2 }}>{fmtEvtTime(data.lastCall.start)}</div>
              <AttendeePills attendees={data.lastCall.attendees} />
            </>) : <div style={{ fontSize: 12.5, color: "var(--fg-4)" }}>No recent calls found.</div>}
          </div>
        </div>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".5px", textTransform: "uppercase", color: "var(--fg-4)", margin: "4px 0 2px" }}>
          Matched events ({events.length})</div>
        {events.length === 0
          ? <div style={{ fontSize: 12.5, color: "var(--fg-4)", padding: "10px 0" }}>No calendar events matched this account (last 30 / next 14 days).</div>
          : events.map(ev => <EventRow key={ev.id} ev={ev} />)}
      </>
    );

    // Gong calls (Snowflake — always available) on top, then the Google Calendar
    // section (gated on connection), then Gmail threads.
    return (
      <div className="view-enter" style={{ padding: "4px 2px" }}>
        {window.AccountCalls && <window.AccountCalls account={account} />}
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".5px", textTransform: "uppercase", color: "var(--fg-4)", margin: "18px 0 10px" }}>Calendar</div>
        {calBody}
        {window.AccountEmails && <window.AccountEmails account={account} />}
      </div>
    );
  }

  Object.assign(window, { CalendarTab, useCalStatus, clearCalStatus, EventRow, ConfBadge, AttendeePills, fmtEvtTime, fmtEvtDay });
})();
