/* integrations.jsx — RCA tracker, Gong calls, and Gmail thread widgets.
   Exposes: useRca, rcaByAccountId, RcaBadge, AccountCalls, AccountEmails. */
(function () {
  const { useState, useEffect } = React;
  const P = window.PORTAL;

  const fmtDur = (s) => { s = Math.round(s || 0); if (!s) return "—"; const m = Math.round(s / 60); return m < 60 ? m + "m" : Math.floor(m / 60) + "h " + (m % 60) + "m"; };
  const fmtDateShort = (d) => { if (!d) return ""; try { return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" }); } catch (e) { return ""; } };
  const talkPct = (v) => v == null ? null : Math.round(v <= 1 ? v * 100 : v);

  // ── RCA: session-cached fetch of /api/rca/status ──
  let _rcaCache = null, _rcaPromise = null;
  function useRca() {
    const [rca, setRca] = useState(_rcaCache);
    useEffect(() => {
      if (_rcaCache) { setRca(_rcaCache); return; }
      if (!_rcaPromise) _rcaPromise = fetch("/api/rca/status").then(r => r.json()).catch(() => ({ rcas: [], actions: [] }));
      let alive = true;
      _rcaPromise.then(d => { _rcaCache = d; if (alive) setRca(d); });
      return () => { alive = false; };
    }, []);
    return rca;
  }
  function rcaByAccountId(rca) { const m = {}; ((rca && rca.rcas) || []).forEach(r => { if (r.accountId) m[r.accountId] = r; }); return m; }

  // Match an RCA row to an account by normalized NAME (more reliable than the
  // server's account-id match, which can pick a different duplicate account id).
  const _RCA_SUF = new Set(["llc","inc","incorporated","corp","co","ltd","limited","company","companies","corporation","contractors","contracting","services","service","enterprises","enterprise","group","holdings","holding","the","a","an"]);
  function _rcaNorm(name) {
    let s = (name || "").toLowerCase();
    if (s.includes(" dba ")) s = s.split(" dba ")[0];
    s = s.replace(/[^a-z0-9 ]+/g, " ");
    return s.split(/\s+/).filter(t => t && !_RCA_SUF.has(t)).join(" ").trim();
  }
  function rcaForAccount(rca, account) {
    if (!rca || !account) return null;
    const t = _rcaNorm(account.tenant);
    if (!t) return null;
    let contains = null;
    for (const r of (rca.rcas || [])) {
      const n = _rcaNorm(r.customer || "");
      if (!n) continue;
      if (n === t) return r;
      if (!contains && Math.min(t.length, n.length) >= 5 && (t.includes(n) || n.includes(t))) contains = r;
    }
    return contains;
  }
  const churnish = (a) => (a.hs != null && a.hs <= 3) || /churn/i.test(a.status || "");

  function RcaBadge({ account, rca }) {
    if (rca && rca.date) {
      const st = { background: "rgba(52,201,123,.12)", borderColor: "rgba(52,201,123,.4)", color: "var(--green)" };
      const inner = <><MI style={{ fontSize: 12 }}>verified</MI>RCA Filed · {rca.date}</>;
      return rca.link
        ? <a href={rca.link} target="_blank" rel="noreferrer" className="chip" style={{ ...st, textDecoration: "none" }} onClick={e => e.stopPropagation()}>{inner}</a>
        : <span className="chip" style={st}>{inner}</span>;
    }
    if (churnish(account)) return <span className="chip" style={{ background: "rgba(226,79,79,.14)", borderColor: "rgba(226,79,79,.42)", color: "var(--red)" }}><MI style={{ fontSize: 12 }}>error</MI>RCA Needed</span>;
    return null;
  }

  // ── Gong calls ──
  function useFetch(url, dep) {
    const [d, setD] = useState(null);
    useEffect(() => { let a = true; setD(null); fetch(url).then(r => r.json()).then(x => { if (a) setD(x); }).catch(() => { if (a) setD({ error: "fetch" }); }); return () => { a = false; }; }, [dep]);
    return d;
  }
  function CallLine({ c }) {
    return (
      <a href={c.gongUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
        style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderTop: "1px solid var(--line)" }}>
        <MI style={{ fontSize: 15, color: "var(--purple)" }}>graphic_eq</MI>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--fg-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.title}</div>
          <div style={{ fontSize: 11, color: "var(--fg-3)" }}>
            {fmtDateShort(c.start)} · {fmtDur(c.durationSeconds)}{c.callScore != null ? ` · score ${Math.round(c.callScore)}` : ""}{talkPct(c.talkRatio) != null ? ` · talk ${talkPct(c.talkRatio)}%` : ""}{c.hasTranscript ? " · transcript" : ""}
          </div>
        </div>
        <MI style={{ fontSize: 14, color: "var(--fg-4)" }}>open_in_new</MI>
      </a>
    );
  }
  function AccountCalls({ account, compact }) {
    const d = useFetch("/api/gong/calls?accountId=" + encodeURIComponent(account.id), account.id);
    const calls = (d && d.calls) || [];
    if (compact) {
      if (!d) return null;
      if (!calls.length) return <span style={{ fontSize: 11.5, color: "var(--fg-4)" }}><MI style={{ fontSize: 13, verticalAlign: "-2px", color: "var(--fg-4)" }}>graphic_eq</MI> No Gong calls</span>;
      const c = calls[0];
      return <a href={c.gongUrl} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} title={c.title}
        style={{ fontSize: 12, color: "var(--fg-3)", fontWeight: 700, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 5 }}>
        <MI style={{ fontSize: 14, color: "var(--purple)" }}>graphic_eq</MI>Last call {fmtDateShort(c.start)}{c.callScore != null ? ` · ${Math.round(c.callScore)}` : ""}<MI style={{ fontSize: 13, color: "var(--fg-4)" }}>open_in_new</MI></a>;
    }
    return (
      <div style={{ marginTop: 4 }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".5px", textTransform: "uppercase", color: "var(--fg-4)", marginBottom: 2 }}>Recent Calls (Gong)</div>
        {!d ? <div style={{ fontSize: 12.5, color: "var(--fg-4)", padding: "8px 0" }}>Loading…</div>
          : calls.length === 0 ? <div style={{ fontSize: 12.5, color: "var(--fg-4)", padding: "8px 0" }}>No Gong calls found for this account.</div>
          : calls.map(c => <CallLine key={c.id} c={c} />)}
      </div>
    );
  }

  // ── Gmail threads ──
  const senderName = (from) => { if (!from) return ""; const m = from.match(/^\s*"?([^"<]+?)"?\s*</); return (m ? m[1] : from).trim(); };
  const gmailNeedsAuth = (d) => d && d.error === "gmail_access";
  function EmailLine({ t }) {
    return (
      <a href={t.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()}
        style={{ textDecoration: "none", display: "flex", alignItems: "flex-start", gap: 8, padding: "7px 0", borderTop: "1px solid var(--line)" }}>
        <MI style={{ fontSize: 15, color: "var(--sky)", marginTop: 1 }}>mail</MI>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--fg-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.subject}</div>
          <div style={{ fontSize: 11, color: "var(--fg-3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{senderName(t.from)}{t.date ? ` · ${fmtDateShort(t.date)}` : ""} — {t.snippet}</div>
        </div>
        <MI style={{ fontSize: 14, color: "var(--fg-4)" }}>open_in_new</MI>
      </a>
    );
  }
  function AccountEmails({ account, compact }) {
    const d = useFetch("/api/gmail/account-threads?accountId=" + encodeURIComponent(account.id), account.id);
    const threads = (d && d.threads) || [];
    if (compact) {
      if (!d) return null;
      if (gmailNeedsAuth(d)) return <span style={{ fontSize: 11.5, color: "var(--fg-4)" }} title="Reconnect Google in Settings to grant Gmail access"><MI style={{ fontSize: 13, verticalAlign: "-2px" }}>mail</MI> Gmail not connected</span>;
      if (!threads.length) return <span style={{ fontSize: 11.5, color: "var(--fg-4)" }}><MI style={{ fontSize: 13, verticalAlign: "-2px" }}>mail</MI> No emails</span>;
      const t = threads[0];
      return <a href={t.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} title={t.subject}
        style={{ fontSize: 12, color: "var(--fg-3)", fontWeight: 700, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 5, maxWidth: 300 }}>
        <MI style={{ fontSize: 14, color: "var(--sky)" }}>mail</MI><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Last email {fmtDateShort(t.date)} · {t.subject}</span></a>;
    }
    return (
      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".5px", textTransform: "uppercase", color: "var(--fg-4)", marginBottom: 2 }}>Recent Emails</div>
        {!d ? <div style={{ fontSize: 12.5, color: "var(--fg-4)", padding: "8px 0" }}>Loading…</div>
          : gmailNeedsAuth(d) ? <div style={{ fontSize: 12.5, color: "var(--fg-4)", padding: "8px 0" }}>Gmail isn't authorized yet — reconnect Google in Settings to grant inbox access.</div>
          : threads.length === 0 ? <div style={{ fontSize: 12.5, color: "var(--fg-4)", padding: "8px 0" }}>No recent email threads found for this account.</div>
          : threads.map(t => <EmailLine key={t.id} t={t} />)}
      </div>
    );
  }

  Object.assign(window, { useRca, rcaByAccountId, rcaForAccount, RcaBadge, AccountCalls, AccountEmails });
})();
