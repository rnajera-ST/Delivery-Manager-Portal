/* Capacity view — read-only look at the MAX New Logo Backlog & Resource
   Assignment Tracker (Google Sheet), to help decide who gets new accounts. */
const { useState: useStateCap, useEffect: useEffectCap } = React;

function CapacityView() {
  const [tab, setTab] = useStateCap("");
  const [data, setData] = useStateCap(null);
  const [loading, setLoading] = useStateCap(true);

  const load = (t) => {
    setLoading(true);
    fetch("/api/capacity" + (t ? "?tab=" + encodeURIComponent(t) : ""))
      .then(r => r.json())
      .then(d => { setData(d); setTab(d.tab || ""); setLoading(false); })
      .catch(() => { setData({ error: "Could not reach the portal server." }); setLoading(false); });
  };
  useEffectCap(() => { load(""); }, []);

  if (!data) return <div className="view-enter"><Empty icon="hourglass_empty" title="Loading the tracker..." /></div>;

  const sheetLink = data.url && (
    <a href={data.url} target="_blank" rel="noreferrer" className="btn btn-sm btn-ghost" style={{ textDecoration:"none" }}>
      <MI>open_in_new</MI>Open in Google Sheets
    </a>
  );

  if (data.connected === false) {
    return <div className="view-enter">
      <Empty icon="link_off" title="Google is not connected"
        sub="Connect your Google account in Settings, then reload this page to load the capacity tracker." />
      <div style={{ textAlign:"center" }}>{sheetLink}</div>
    </div>;
  }
  if (data.error) {
    return <div className="view-enter">
      <Empty icon="error" title="Could not load the tracker" sub={data.error} />
      <div style={{ textAlign:"center" }}>{sheetLink}</div>
    </div>;
  }

  // Trim empty trailing rows and columns so the grid is not padded with blanks.
  const rows = (data.values || []).map(r => r.map(c => (c == null ? "" : String(c))));
  const hasValue = r => r.some(c => c.trim() !== "");
  while (rows.length && !hasValue(rows[rows.length - 1])) rows.pop();
  let width = 0;
  rows.forEach(r => { for (let i = r.length - 1; i >= 0; i--) { if (r[i].trim() !== "") { width = Math.max(width, i + 1); break; } } });
  const grid = rows.map(r => Array.from({ length: width }, (_, i) => r[i] || ""));

  return (
    <div className="view-enter">
      <div className="toolbar">
        <span style={{ fontSize:13, fontWeight:700, color:"var(--fg-3)" }}>Tab</span>
        <select className="select-sm" value={tab} onChange={e => load(e.target.value)}>
          {(data.tabs || []).map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <button className="btn btn-sm btn-ghost" onClick={() => load(tab)} disabled={loading}><MI>refresh</MI>Refresh</button>
        <span className="spacer" />
        <span className="count-note">{grid.length} rows · read-only{data.truncated ? " · showing first rows only" : ""}</span>
        {sheetLink}
      </div>

      {grid.length === 0
        ? <Empty icon="table_chart" title="This tab is empty" />
        : <div className="tbl-wrap" style={{ opacity: loading ? 0.5 : 1 }}>
            <table className="tbl">
              <tbody>
                {grid.map((r, ri) => (
                  <tr key={ri} style={ri === 0 ? { background:"var(--soft)", fontWeight:700 } : undefined}>
                    {r.map((c, ci) => <td key={ci} style={{ whiteSpace:"nowrap" }}>{c}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>}
    </div>
  );
}

Object.assign(window, { CapacityView });
