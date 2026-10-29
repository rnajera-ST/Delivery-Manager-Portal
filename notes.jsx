/* notes.jsx — account notes log (Direction D from the design pass), wired to the
   real backend (/api/notes/*, /api/tasks/*, /api/tags*). Wrapped in an IIFE so its
   local React hook aliases don't collide with the other scripts' globals. Exports
   NotesLog to window for detail.jsx's Notes tab. */
(function () {
  const { useState, useRef, useEffect, useMemo } = React;

  // In-progress note drafts, keyed by account id. Survives tab switches inside
  // the detail panel (the Notes tab unmounts when you switch away).
  const _noteDrafts = {};

  /* ── time helpers (live "now") ── */
  const relTime = (iso) => {
    const now = new Date(), d = new Date(iso), diff = (now - d) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return Math.floor(diff / 60) + "m ago";
    if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
    const dd = Math.floor(diff / 86400);
    if (dd === 1) return "Yesterday";
    if (dd < 7) return d.toLocaleDateString("en-US", { weekday: "long" });
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };
  const fullStamp = (iso) => new Date(iso).toLocaleString("en-US",
    { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  const dayBucket = (iso) => {
    const now = new Date(), d = new Date(iso);
    const dd = Math.floor((now - d) / 86400000);
    if (d.toDateString() === now.toDateString()) return "Today";
    if (dd <= 1) return "Yesterday";
    if (dd <= 7) return "Earlier this week";
    if (dd <= 31) return "This month";
    return "Earlier";
  };
  const fmtDay = (iso) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const snip = (s, n) => { s = (s || "").trim(); n = n || 34; return s.length > n ? s.slice(0, n - 1) + "…" : s; };

  /* ── people / avatar (initials + deterministic color from the name) ── */
  const PALETTE = ["#2270EE", "#6DBAF8", "#34C97B", "#F5C143", "#9B7BE8", "#E8915B", "#5BC8E8", "#E85B8A"];
  function NAvatar({ name, size = 24 }) {
    const parts = (name || "?").trim().split(/\s+/);
    const initials = ((parts[0] && parts[0][0]) || "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "");
    let h = 0; for (let i = 0; i < (name || "").length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return (
      <span style={{ width: size, height: size, minWidth: size, borderRadius: "50%", background: PALETTE[h % PALETTE.length],
        color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontWeight: 800, fontSize: size * 0.4, letterSpacing: ".2px" }}>{initials.toUpperCase()}</span>
    );
  }

  /* ── tags ── */
  const TAG_META = {
    "Call": { c: "var(--sky)", i: "call" }, "Risk": { c: "var(--red)", i: "warning" },
    "Customer-facing": { c: "var(--green)", i: "outgoing_mail" }, "Internal": { c: "var(--fg-3)", i: "lock" },
    "Go-live": { c: "var(--yellow)", i: "rocket_launch" }, "Data / DQA": { c: "var(--purple)", i: "database" },
    "Pricebook": { c: "var(--blue)", i: "menu_book" }, "Training": { c: "var(--green)", i: "school" },
    "Billing": { c: "var(--yellow)", i: "receipt_long" }, "Escalation": { c: "var(--red)", i: "priority_high" },
    "Champion": { c: "var(--sky)", i: "star" }, "Follow-up": { c: "var(--purple)", i: "event_upcoming" },
  };
  const CUSTOM_PALETTE = ["var(--sky)", "var(--purple)", "var(--green)", "var(--yellow)", "var(--blue)"];
  function tagMeta(t) {
    if (TAG_META[t]) return TAG_META[t];
    let h = 0; for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
    return { c: CUSTOM_PALETTE[h % CUSTOM_PALETTE.length], i: "sell" };
  }

  /* server-backed tag library (per the portal's no-localStorage rule) */
  let _tagLib = null;
  const _subs = new Set();
  function _loadTagLib() {
    if (_tagLib) return;
    fetch("/api/tags").then((r) => r.json()).then((l) => {
      _tagLib = Array.isArray(l) ? l : []; _subs.forEach((fn) => fn(_tagLib.slice()));
    }).catch(() => { _tagLib = []; });
  }
  function addToTagLibrary(name) {
    name = (name || "").trim(); if (!name) return;
    if (_tagLib && !_tagLib.some((t) => t.toLowerCase() === name.toLowerCase())) {
      _tagLib = [..._tagLib, name]; _subs.forEach((fn) => fn(_tagLib.slice()));
    }
    fetch("/api/tags/add", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tag: name }) })
      .then((r) => r.json()).then((d) => { if (d && d.library) { _tagLib = d.library; _subs.forEach((fn) => fn(_tagLib.slice())); } }).catch(() => {});
  }
  function useTagLibrary() {
    const [v, setV] = useState(() => (_tagLib ? _tagLib.slice() : []));
    useEffect(() => { const fn = (l) => setV(l); _subs.add(fn); _loadTagLib(); if (_tagLib) setV(_tagLib.slice()); return () => _subs.delete(fn); }, []);
    return v;
  }

  function renderHighlights(text, spans) {
    if (!spans || !spans.length) return text;
    const ranges = [];
    spans.forEach((s) => { const i = text.indexOf(s); if (i >= 0) ranges.push([i, i + s.length]); });
    ranges.sort((a, b) => a[0] - b[0]);
    const out = []; let pos = 0, k = 0;
    ranges.forEach(([a, b]) => {
      if (a < pos) return;
      if (a > pos) out.push(text.slice(pos, a));
      out.push(
        <mark key={"hl" + (k++)} style={{ background: "var(--tint-blue-15)", color: "var(--sky)", borderRadius: 4, padding: "0 3px" }}>
          <span className="mi" style={{ fontSize: 12, verticalAlign: "-2px", marginRight: 1 }}>task_alt</span>{text.slice(a, b)}
        </mark>
      );
      pos = b;
    });
    if (pos < text.length) out.push(text.slice(pos));
    return out;
  }

  function TagChip({ tag, onRemove, active, onClick, sm }) {
    const m = tagMeta(tag);
    return (
      <span onClick={onClick} style={{ display: "inline-flex", alignItems: "center", gap: 4,
        padding: sm ? "1px 7px 1px 6px" : "2px 9px 2px 7px", borderRadius: "var(--r-pill)",
        fontSize: sm ? 10.5 : 11, fontWeight: 700, lineHeight: 1.5, whiteSpace: "nowrap", cursor: onClick ? "pointer" : "default",
        color: active ? "#fff" : m.c, background: active ? m.c : "color-mix(in srgb, " + m.c + " 13%, transparent)",
        border: "1px solid color-mix(in srgb, " + m.c + " 38%, transparent)" }}>
        <span className="mi" style={{ fontSize: sm ? 12 : 13 }}>{m.i}</span>{tag}
        {onRemove && <span className="mi" style={{ fontSize: 13, marginLeft: 1, opacity: .8 }}
          onClick={(e) => { e.stopPropagation(); onRemove(); }}>close</span>}
      </span>
    );
  }

  function TagPicker({ value, onChange }) {
    const lib = useTagLibrary();
    const [open, setOpen] = useState(false);
    const [q, setQ] = useState("");
    const ref = useRef(null);
    useEffect(() => {
      if (!open) return;
      const h = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setQ(""); } };
      document.addEventListener("mousedown", h);
      return () => document.removeEventListener("mousedown", h);
    }, [open]);
    const toggle = (t) => onChange(value.includes(t) ? value.filter((x) => x !== t) : [...value, t]);
    const qt = q.trim();
    const filtered = lib.filter((t) => t.toLowerCase().includes(qt.toLowerCase()));
    const exact = lib.some((t) => t.toLowerCase() === qt.toLowerCase());
    const create = () => { if (!qt) return; addToTagLibrary(qt); if (!value.includes(qt)) onChange([...value, qt]); setQ(""); };
    return (
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        {value.map((t) => <TagChip key={t} tag={t} sm onRemove={() => toggle(t)} />)}
        <div ref={ref} style={{ position: "relative" }}>
          <button onClick={() => setOpen((o) => !o)} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 9px 2px 7px",
            cursor: "pointer", borderRadius: "var(--r-pill)", border: "1px dashed var(--line-2)", background: "transparent", color: "var(--fg-3)", font: "700 10.5px/1.5 var(--font-body)" }}>
            <span className="mi" style={{ fontSize: 13 }}>sell</span>{value.length ? "Tag" : "Add tag"}
          </button>
          {open && (
            <div style={{ position: "absolute", top: "100%", left: 0, marginTop: 5, zIndex: 40, width: 218,
              background: "var(--elev)", border: "1px solid var(--line-2)", borderRadius: 10, padding: 8, boxShadow: "var(--shadow-lg)" }}>
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && qt && !exact) create(); }} placeholder="Search or create a tag"
                style={{ width: "100%", padding: "7px 9px", borderRadius: 7, border: "1px solid var(--line-2)", background: "var(--card-2)", color: "var(--fg-1)", font: "500 12px/1 var(--font-body)", outline: "none" }} />
              <div style={{ maxHeight: 168, overflowY: "auto", marginTop: 6, display: "flex", flexDirection: "column", gap: 2 }}>
                {qt && !exact && (
                  <button onClick={create} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 8px", border: 0, borderRadius: 6,
                    background: "var(--tint-blue-08)", cursor: "pointer", textAlign: "left", font: "700 12px/1.2 var(--font-body)", color: "var(--sky)" }}>
                    <span className="mi" style={{ fontSize: 16 }}>add</span>Create &ldquo;{qt}&rdquo;
                  </button>
                )}
                {filtered.map((t) => {
                  const on = value.includes(t), m = tagMeta(t);
                  return (
                    <button key={t} onClick={() => toggle(t)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px",
                      border: 0, borderRadius: 6, background: on ? "var(--soft)" : "transparent", cursor: "pointer", textAlign: "left", font: "600 12px/1.2 var(--font-body)", color: "var(--fg-1)" }}>
                      <span className="mi" style={{ fontSize: 15, color: m.c }}>{m.i}</span>{t}
                      {on && <span className="mi" style={{ marginLeft: "auto", fontSize: 16, color: "var(--sky)" }}>check</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  function DateBit({ icon, label, value, onChange, color }) {
    const ref = useRef(null);
    const overdue = value && new Date(value) < new Date();
    const c = overdue ? "var(--red)" : (color || "var(--fg-2)");
    return (
      <span style={{ position: "relative", display: "inline-flex", alignItems: "center" }}>
        <button onClick={() => { try { ref.current.showPicker(); } catch (e) { ref.current.focus(); } }}
          style={{ display: "inline-flex", alignItems: "center", gap: 3, cursor: "pointer", padding: "2px 8px", borderRadius: "var(--r-pill)", font: "700 10.5px/1.4 var(--font-body)",
            border: "1px " + (value ? "solid" : "dashed") + " " + (value ? "color-mix(in srgb, " + c + " 42%, transparent)" : "var(--line-2)"),
            background: value ? "color-mix(in srgb, " + c + " 12%, transparent)" : "transparent", color: value ? c : "var(--fg-4)" }}>
          <span className="mi" style={{ fontSize: 13 }}>{icon}</span>
          {value ? label + " " + fmtDay(value) : "Set " + label.toLowerCase()}
          {value && <span className="mi" style={{ fontSize: 13, marginLeft: 1, opacity: .75 }} onClick={(e) => { e.stopPropagation(); onChange(null); }}>close</span>}
        </button>
        <input ref={ref} type="date" value={value ? value.slice(0, 10) : ""}
          onChange={(e) => onChange(e.target.value ? new Date(e.target.value + "T12:00:00").toISOString() : null)}
          style={{ position: "absolute", left: 0, bottom: 0, width: 1, height: 1, opacity: 0, pointerEvents: "none" }} />
      </span>
    );
  }

  function FilterBar({ query, setQuery, allTags, filterTag, setFilterTag, count }) {
    return (
      <div>
        <div style={{ position: "relative", marginBottom: allTags.length ? 8 : 0 }}>
          <span className="mi" style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", fontSize: 17, color: "var(--fg-4)" }}>search</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={"Search " + count + " note" + (count === 1 ? "" : "s")}
            style={{ width: "100%", padding: "7px 11px 7px 32px", borderRadius: "var(--r-sm)", border: "1px solid var(--line-2)", background: "var(--card-2)", color: "var(--fg-1)", font: "500 12.5px/1 var(--font-body)", outline: "none" }} />
          {query && <button className="mi" onClick={() => setQuery("")} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", border: 0, background: "transparent", color: "var(--fg-3)", cursor: "pointer", fontSize: 16 }}>close</button>}
        </div>
        {allTags.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <button onClick={() => setFilterTag(null)} style={{ cursor: "pointer", padding: "2px 10px", borderRadius: "var(--r-pill)",
              border: "1px solid " + (filterTag ? "var(--line-2)" : "var(--accent)"), background: filterTag ? "transparent" : "var(--tint-blue-15)", color: filterTag ? "var(--fg-3)" : "var(--sky)", font: "700 11px/1.5 var(--font-body)" }}>All</button>
            {allTags.map((t) => <TagChip key={t} tag={t} onClick={() => setFilterTag(filterTag === t ? null : t)} active={filterTag === t} />)}
          </div>
        )}
      </div>
    );
  }

  function TasksPanel({ tasks, toggleTask, addTask, setTaskDate, deleteTask }) {
    const [open, setOpen] = useState(true);
    const [val, setVal] = useState("");
    const openCount = tasks.filter((t) => !t.done).length;
    return (
      <div style={{ borderTop: "1px solid var(--line)", marginTop: 6 }}>
        <button onClick={() => setOpen((o) => !o)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "11px 2px", border: 0, background: "transparent", cursor: "pointer", font: "inherit" }}>
          <span className="mi" style={{ fontSize: 18, color: "var(--sky)" }}>checklist</span>
          <span style={{ fontSize: 12.5, fontWeight: 800, color: "var(--fg-1)", letterSpacing: "-.1px" }}>Tasks from calls</span>
          <span style={{ fontSize: 11, fontWeight: 800, color: openCount ? "var(--yellow)" : "var(--green)", background: openCount ? "rgba(245,193,67,.14)" : "rgba(52,201,123,.14)", padding: "1px 8px", borderRadius: "var(--r-pill)" }}>
            {openCount ? openCount + " open" : "all done"}</span>
          <span style={{ flex: 1 }} />
          <span className="mi" style={{ fontSize: 20, color: "var(--fg-3)", transform: open ? "rotate(180deg)" : "none", transition: "transform .2s" }}>expand_more</span>
        </button>
        {open && (
          <div style={{ paddingBottom: 8 }}>
            {tasks.map((t) => (
              <div key={t.id} className="ai-row" style={{ alignItems: "flex-start" }}>
                <span className={"chk" + (t.done ? " on" : "")} onClick={() => toggleTask(t.id)} style={{ marginTop: 1 }}>{t.done && <span className="mi">check</span>}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: t.done ? "var(--fg-4)" : "var(--fg-1)", textDecoration: t.done ? "line-through" : "none" }}>{t.text}</div>
                  {t.fromNoteId && <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--sky)", marginTop: 3, display: "inline-flex", alignItems: "center", gap: 3 }}>
                    <span className="mi" style={{ fontSize: 12 }}>subdirectory_arrow_right</span>from a note</div>}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 5 }}>
                    <DateBit icon="event" label="Due" value={t.due} onChange={(v) => setTaskDate(t.id, "due", v)} />
                    <DateBit icon="notifications" label="Remind" value={t.remind} onChange={(v) => setTaskDate(t.id, "remind", v)} color="var(--sky)" />
                  </div>
                </div>
                <button className="btn icon-btn btn-ghost btn-sm" title="Remove task" onClick={() => deleteTask(t.id)}><span className="mi" style={{ fontSize: 16 }}>close</span></button>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <input value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && val.trim()) { addTask(val); setVal(""); } }}
                placeholder="Add a task, set dates below" className="inp" style={{ padding: "7px 11px", fontSize: 12.5 }} />
              <button className="btn btn-sm" onClick={() => { if (val.trim()) { addTask(val); setVal(""); } }}><span className="mi" style={{ fontSize: 16 }}>add</span></button>
            </div>
          </div>
        )}
      </div>
    );
  }

  function InlineEditor({ note, onSave, onCancel }) {
    const [text, setText] = useState(note.text);
    const [tags, setTags] = useState(note.tags || []);
    return (
      <div style={{ border: "1px solid var(--accent)", borderRadius: 9, padding: 9, background: "var(--card-2)", boxShadow: "0 0 0 3px var(--tint-blue-15)" }}>
        <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={3}
          style={{ width: "100%", resize: "none", border: 0, outline: "none", background: "transparent", color: "var(--fg-1)", font: "400 13px/1.5 var(--font-body)" }} />
        <div style={{ margin: "6px 0" }}><TagPicker value={tags} onChange={setTags} /></div>
        <div style={{ display: "flex", gap: 7, justifyContent: "flex-end" }}>
          <button className="btn btn-sm btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-sm btn-primary" onClick={() => onSave(text, tags)}>Save</button>
        </div>
      </div>
    );
  }

  function NextStepsBar({ value, onChange }) {
    const [editing, setEditing] = useState(false);
    const [val, setVal] = useState(value);
    useEffect(() => setVal(value), [value]);
    return (
      <div style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: "10px 12px", background: "var(--tint-blue-08)", border: "1px solid var(--tint-blue-30)", borderRadius: 9 }}>
        <span className="mi" style={{ fontSize: 17, color: "var(--sky)", marginTop: 1 }}>bolt</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: "var(--sky)", textTransform: "uppercase", letterSpacing: ".7px", marginBottom: 3 }}>Next steps</div>
          {editing ? (
            <textarea autoFocus value={val} onChange={(e) => setVal(e.target.value)} onBlur={() => { onChange(val); setEditing(false); }} rows={2}
              style={{ width: "100%", resize: "none", border: "1px solid var(--line-2)", borderRadius: 6, background: "var(--card-2)", color: "var(--fg-1)", font: "400 12.5px/1.5 var(--font-body)", padding: "6px 8px", outline: "none" }} />
          ) : (
            <div onClick={() => setEditing(true)} style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--fg-1)", cursor: "text" }}>{value || <span style={{ color: "var(--fg-4)" }}>Set the next step...</span>}</div>
          )}
        </div>
      </div>
    );
  }

  /* composer with highlight-to-task before saving */
  function MergeComposer({ onAdd, accountId }) {
    const [text, setTextRaw] = useState(() => _noteDrafts[accountId] || "");
    const setText = (v) => { setTextRaw(v); if (accountId != null) { if (v) _noteDrafts[accountId] = v; else delete _noteDrafts[accountId]; } };
    const [tags, setTags] = useState([]);
    const [focused, setFocused] = useState(false);
    const [sel, setSel] = useState("");
    const [pending, setPending] = useState([]);
    const grabSel = (e) => { const ta = e.target; setSel(ta.value.slice(ta.selectionStart, ta.selectionEnd)); };
    const addPending = () => { const s = sel.trim(); if (s && !pending.includes(s) && text.includes(s)) setPending([...pending, s]); setSel(""); };
    const submit = () => { if (!text.trim()) return; onAdd(text, tags, pending); setText(""); setTags([]); setPending([]); setSel(""); };
    const canTag = sel.trim().length > 0 && !pending.includes(sel.trim());
    return (
      <div style={{ background: "var(--card)", border: "1px solid " + (focused ? "var(--accent)" : "var(--line-2)"), borderRadius: 11, padding: 11,
        boxShadow: focused ? "0 0 0 3px var(--tint-blue-15)" : "none", transition: "border-color .2s, box-shadow .2s" }}>
        <textarea value={text} rows={3} onChange={(e) => setText(e.target.value)} onSelect={grabSel} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } }} placeholder="Add a note from this call..."
          style={{ width: "100%", resize: "none", border: 0, outline: "none", background: "transparent", color: "var(--fg-1)", font: "400 13.5px/1.55 var(--font-body)", padding: "2px" }} />
        {canTag && (
          <button onClick={addPending} style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 2, padding: "5px 11px", borderRadius: "var(--r-pill)",
            border: "1px solid var(--accent)", background: "var(--tint-blue-15)", color: "var(--sky)", cursor: "pointer", font: "800 11.5px/1 var(--font-body)" }}>
            <span className="mi" style={{ fontSize: 15 }}>add_task</span>Make &ldquo;{snip(sel, 26)}&rdquo; a task
          </button>
        )}
        {pending.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginTop: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: "var(--fg-4)", textTransform: "uppercase", letterSpacing: ".5px" }}>Tasks</span>
            {pending.map((p) => (
              <span key={p} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 6px 2px 8px", borderRadius: "var(--r-pill)", background: "var(--tint-blue-15)", color: "var(--sky)", font: "700 10.5px/1.5 var(--font-body)" }}>
                <span className="mi" style={{ fontSize: 12 }}>task_alt</span>{snip(p, 22)}
                <span className="mi" style={{ fontSize: 13, cursor: "pointer", opacity: .8 }} onClick={() => setPending(pending.filter((x) => x !== p))}>close</span>
              </span>
            ))}
          </div>
        )}
        <div style={{ marginTop: 8 }}><TagPicker value={tags} onChange={setTags} /></div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 9 }}>
          <span style={{ flex: 1 }} />
          <button className="btn btn-primary btn-sm" disabled={!text.trim()} onClick={submit}><span className="mi" style={{ fontSize: 16 }}>send</span>Add note</button>
        </div>
      </div>
    );
  }

  /* ── server-backed hook (operates on the real account + endpoints) ── */
  function useNotes(account) {
    const aid = account.id;
    const [notes, setNotes] = useState(() => (account.noteLog || []).slice());
    const [tasks, setTasks] = useState(() => (account.actionItems || []).slice());
    const [nextSteps, setNS] = useState(account.nextSteps || "");
    const [query, setQuery] = useState("");
    const [filterTag, setFilterTag] = useState(null);
    const post = (url, body) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json());

    // Write local state back to the account object (same reference as P.accounts)
    // so a tab switch / remount and the To-Do + 1:1 cards see the latest notes and
    // tasks immediately — no page refresh needed.
    useEffect(() => { account.noteLog = notes; }, [notes]);
    useEffect(() => { account.actionItems = tasks; }, [tasks]);
    useEffect(() => { account.nextSteps = nextSteps; }, [nextSteps]);

    const allTags = useMemo(() => { const s = new Set(); notes.forEach((n) => (n.tags || []).forEach((t) => s.add(t))); return [...s]; }, [notes]);

    const addNote = (text, tags, spans) => {
      text = (text || "").trim(); if (!text) return;
      post("/api/notes/add", { accountId: aid, text, tags: tags || [], highlights: spans || [] }).then((d) => {
        if (d && d.note) {
          // Mutate the account object directly so the note persists even if this
          // tab unmounted before the save returned (then setNotes is a no-op).
          account.noteLog = [d.note, ...(account.noteLog || [])];
          if (d.tasks) account.actionItems = d.tasks;
          setNotes((p) => [d.note, ...p]);
          if (d.tasks) setTasks(d.tasks);
          const hl = (d.note.highlights || []).length;
          showToast(hl ? "Note added, " + hl + " task" + (hl > 1 ? "s" : "") + " created" : "Note added");
        }
      });
    };
    const highlightToTask = (note, text) => {
      const t = (text || "").trim(); if (!t) return;
      const hl = [...(note.highlights || []), t];
      setNotes((p) => p.map((n) => n.id === note.id ? { ...n, highlights: hl, hasTask: true } : n));
      post("/api/notes/update", { accountId: aid, noteId: note.id, highlights: hl });
      post("/api/tasks/add", { accountId: aid, text: t, fromNoteId: note.id }).then((d) => { if (d && d.task) setTasks((p) => [d.task, ...p]); });
      showToast("Task created from highlight");
    };
    const editNote = (id, text, tags) => {
      setNotes((p) => p.map((n) => n.id === id ? { ...n, text: (text || "").trim(), tags: tags == null ? n.tags : tags, edited: true } : n));
      post("/api/notes/update", { accountId: aid, noteId: id, text, tags });
    };
    const deleteNote = (id) => { setNotes((p) => p.filter((n) => n.id !== id)); post("/api/notes/delete", { accountId: aid, noteId: id }); showToast("Note deleted"); };
    const togglePin = (id) => {
      const cur = notes.find((n) => n.id === id); const np = cur ? !cur.pinned : true;
      setNotes((p) => p.map((n) => n.id === id ? { ...n, pinned: np } : n));
      post("/api/notes/update", { accountId: aid, noteId: id, pinned: np });
    };
    const convertToTask = (note) => {
      const snippet = note.text.length > 60 ? note.text.slice(0, 57) + "..." : note.text;
      setNotes((p) => p.map((n) => n.id === note.id ? { ...n, hasTask: true } : n));
      post("/api/tasks/add", { accountId: aid, text: snippet, fromNoteId: note.id }).then((d) => { if (d && d.task) setTasks((p) => [d.task, ...p]); });
      showToast("Added to tasks");
    };
    const toggleTask = (id) => {
      const cur = tasks.find((t) => t.id === id); const nd = cur ? !cur.done : true;
      setTasks((p) => p.map((t) => t.id === id ? { ...t, done: nd } : t));
      post("/api/tasks/update", { accountId: aid, taskId: id, done: nd });
    };
    const setTaskDate = (id, field, val) => { setTasks((p) => p.map((t) => t.id === id ? { ...t, [field]: val } : t)); post("/api/tasks/update", { accountId: aid, taskId: id, [field]: val }); };
    const addTask = (text, due, remind) => {
      text = (text || "").trim(); if (!text) return;
      post("/api/tasks/add", { accountId: aid, text, due: due || null, remind: remind || null }).then((d) => { if (d && d.task) setTasks((p) => [d.task, ...p]); });
    };
    const deleteTask = (id) => { setTasks((p) => p.filter((t) => t.id !== id)); post("/api/tasks/delete", { accountId: aid, taskId: id }); };
    const setNextSteps = (val) => { setNS(val); fetch("/api/overlays", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: aid, nextSteps: val }) }).catch(() => {}); };

    const filtered = useMemo(() => {
      const q = query.trim().toLowerCase();
      return notes.filter((n) => {
        if (filterTag && !(n.tags || []).includes(filterTag)) return false;
        if (q && !((n.text || "").toLowerCase().includes(q) || (n.tags || []).join(" ").toLowerCase().includes(q))) return false;
        return true;
      }).slice().sort((a, b) => { if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1; return new Date(b.at) - new Date(a.at); });
    }, [notes, query, filterTag]);

    return { notes, filtered, tasks, nextSteps, setNextSteps, query, setQuery, filterTag, setFilterTag, allTags,
      addNote, editNote, deleteNote, togglePin, convertToTask, toggleTask, addTask, setTaskDate, deleteTask, highlightToTask };
  }

  /* ── the notes log (renders inside the account detail Notes tab) ── */
  function NotesLog({ account }) {
    const N = useNotes(account);
    const [editing, setEditing] = useState(null);
    const [selRow, setSelRow] = useState(null);

    const onMouseUp = () => {
      const s = window.getSelection();
      if (!s || s.isCollapsed || !s.toString().trim()) { setSelRow(null); return; }
      let node = s.anchorNode;
      let el = node && (node.nodeType === 3 ? node.parentElement : node);
      const host = el && el.closest && el.closest("[data-note-id]");
      if (host) setSelRow({ id: host.getAttribute("data-note-id"), str: s.toString() });
      else setSelRow(null);
    };

    const groups = [];
    N.filtered.forEach((n) => {
      const b = dayBucket(n.at);
      let g = groups.find((x) => x.bucket === b);
      if (!g) { g = { bucket: b, items: [] }; groups.push(g); }
      g.items.push(n);
    });

    const IconBtn = ({ icon, label, onClick, danger }) => (
      <button title={label} onClick={onClick} className="nrow-act"
        style={{ width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center", border: 0, borderRadius: 5, background: "transparent", cursor: "pointer", color: danger ? "var(--red)" : "var(--fg-3)" }}>
        <span className="mi" style={{ fontSize: 16 }}>{icon}</span>
      </button>
    );

    const Row = ({ n }) => {
      const m = tagMeta(n.tags && n.tags[0] || "");
      if (editing === n.id) return (
        <div style={{ padding: "6px 0 6px 16px" }}>
          <InlineEditor note={n} onCancel={() => setEditing(null)} onSave={(t, tg) => { N.editNote(n.id, t, tg); setEditing(null); }} />
        </div>
      );
      const showSel = selRow && selRow.id === n.id && selRow.str.trim();
      return (
        <div style={{ display: "flex", gap: 9, padding: "9px 4px 9px 0", borderBottom: "1px solid var(--line)" }}>
          <div style={{ width: 4, alignSelf: "stretch", borderRadius: 2, background: n.pinned ? "var(--accent)" : m.c, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
              <span title={fullStamp(n.at)} style={{ fontSize: 10.5, fontWeight: 800, color: "var(--fg-3)", whiteSpace: "nowrap" }}>{relTime(n.at)}</span>
              <NAvatar name={n.by} size={15} />
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--fg-4)", whiteSpace: "nowrap" }}>{n.by}</span>
              {n.pinned && <span className="mi" style={{ fontSize: 12, color: "var(--accent)" }}>push_pin</span>}
              {n.edited && <span style={{ fontSize: 9.5, fontWeight: 700, color: "var(--fg-4)" }}>edited</span>}
              <span style={{ flex: 1 }} />
              <span style={{ display: "flex", gap: 1 }}>
                <IconBtn icon={n.pinned ? "keep_off" : "push_pin"} label={n.pinned ? "Unpin" : "Pin"} onClick={() => N.togglePin(n.id)} />
                <IconBtn icon="add_task" label="Convert whole note to task" onClick={() => N.convertToTask(n)} />
                <IconBtn icon="edit" label="Edit" onClick={() => setEditing(n.id)} />
                <IconBtn icon="delete" label="Delete" onClick={() => N.deleteNote(n.id)} danger />
              </span>
            </div>
            <div data-note-id={n.id} style={{ fontSize: 12.5, lineHeight: 1.55, color: "var(--fg-1)", userSelect: "text" }}>
              {renderHighlights(n.text, n.highlights)}
            </div>
            {showSel && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 7 }}>
                <button onMouseDown={(e) => e.preventDefault()} onClick={() => { N.highlightToTask(n, selRow.str); setSelRow(null); }}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 11px", borderRadius: "var(--r-pill)", border: "1px solid var(--accent)", background: "var(--tint-blue-15)", color: "var(--sky)", cursor: "pointer", font: "800 11.5px/1 var(--font-body)" }}>
                  <span className="mi" style={{ fontSize: 15 }}>add_task</span>Make &ldquo;{snip(selRow.str, 24)}&rdquo; a task
                </button>
              </div>
            )}
            {((n.tags && n.tags.length) || n.hasTask) && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 5 }}>
                {(n.tags || []).map((t) => {
                  const tm = tagMeta(t);
                  return <span key={t} onClick={() => N.setFilterTag(N.filterTag === t ? null : t)} style={{ cursor: "pointer", fontSize: 10.5, fontWeight: 800, color: tm.c, textDecoration: N.filterTag === t ? "underline" : "none" }}>#{t.replace(/\s+/g, "")}</span>;
                })}
                {n.hasTask && <span style={{ display: "inline-flex", alignItems: "center", gap: 2, fontSize: 10, fontWeight: 800, color: "var(--sky)" }}><span className="mi" style={{ fontSize: 12 }}>task_alt</span>has task</span>}
              </div>
            )}
          </div>
        </div>
      );
    };

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <NextStepsBar value={N.nextSteps} onChange={N.setNextSteps} />
        <MergeComposer onAdd={N.addNote} accountId={account.id} />
        <FilterBar query={N.query} setQuery={N.setQuery} allTags={N.allTags} filterTag={N.filterTag} setFilterTag={N.setFilterTag} count={N.notes.length} />
        <div onMouseUp={onMouseUp}>
          {N.filtered.length === 0 && <Empty icon="sticky_note_2" title="No notes yet" sub="Add the first note from this call above." />}
          {groups.map((g) => (
            <div key={g.bucket}>
              <div style={{ padding: "8px 0 5px", fontSize: 10, fontWeight: 800, color: "var(--fg-4)", textTransform: "uppercase", letterSpacing: ".7px" }}>{g.bucket}</div>
              {g.items.map((n) => <Row key={n.id} n={n} />)}
            </div>
          ))}
        </div>
        <TasksPanel tasks={N.tasks} toggleTask={N.toggleTask} addTask={N.addTask} setTaskDate={N.setTaskDate} deleteTask={N.deleteTask} />
      </div>
    );
  }

  /* quick-capture popover (note or task) for the account list / My Pipeline */
  function CapturePop({ accountId, accountName, onClose, onDone }) {
    const [mode, setMode] = useState("note");
    const [text, setText] = useState("");
    const [tags, setTags] = useState([]);
    const [due, setDue] = useState(null);
    const [remind, setRemind] = useState(null);
    const ref = useRef(null);
    useEffect(() => {
      const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
      setTimeout(() => document.addEventListener("mousedown", h), 0);
      return () => document.removeEventListener("mousedown", h);
    }, []);
    const submit = () => {
      if (!text.trim()) return;
      if (mode === "note") {
        fetch("/api/notes/add", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId, text: text.trim(), tags }) })
          .then((r) => r.json()).then(() => { showToast("Note saved to " + (accountName || "account")); onDone && onDone(); onClose(); });
      } else {
        fetch("/api/tasks/add", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId, text: text.trim(), due, remind }) })
          .then((r) => r.json()).then(() => { showToast("Task added to " + (accountName || "account")); onDone && onDone(); onClose(); });
      }
    };
    const Seg = ({ id, icon, label }) => (
      <button onClick={() => setMode(id)} style={{ flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "6px 8px",
        border: 0, borderRadius: 7, cursor: "pointer", font: "800 12px/1 var(--font-body)", background: mode === id ? "var(--accent)" : "transparent", color: mode === id ? "#fff" : "var(--fg-2)" }}>
        <span className="mi" style={{ fontSize: 16 }}>{icon}</span>{label}
      </button>
    );
    return (
      <div ref={ref} style={{ border: "1px solid var(--accent)", borderRadius: 10, background: "var(--card)", padding: 10, boxShadow: "var(--shadow-lg)" }}>
        <div style={{ display: "flex", gap: 4, padding: 3, background: "var(--card-2)", border: "1px solid var(--line-2)", borderRadius: 9, marginBottom: 9 }}>
          <Seg id="note" icon="sticky_note_2" label="Note" /><Seg id="task" icon="add_task" label="Task" />
        </div>
        <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} rows={2}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) submit(); }}
          placeholder={mode === "note" ? "Quick note for this account..." : "What needs to happen?"}
          style={{ width: "100%", resize: "none", border: 0, outline: "none", background: "transparent", color: "var(--fg-1)", font: "400 13px/1.5 var(--font-body)" }} />
        {mode === "task" && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
            <DateBit icon="event" label="Due" value={due} onChange={setDue} />
            <DateBit icon="notifications" label="Remind" value={remind} onChange={setRemind} color="var(--sky)" />
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          <TagPicker value={tags} onChange={setTags} />
          <span style={{ flex: 1 }} />
          <button className="btn btn-sm btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-sm btn-primary" disabled={!text.trim()} onClick={submit}>
            <span className="mi" style={{ fontSize: 15 }}>{mode === "note" ? "send" : "add_task"}</span>{mode === "note" ? "Save note" : "Add task"}
          </button>
        </div>
      </div>
    );
  }

  Object.assign(window, { NotesLog, CapturePop, DateBit, NAvatar, tagMeta, relTime, fmtDay });
})();
