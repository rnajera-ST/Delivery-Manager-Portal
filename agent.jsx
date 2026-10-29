/* agent.jsx — AI Assistant chat panel. Slides in from the right, toggled by a
   floating button (above the feedback FAB) or Cmd/Ctrl+K. Session-only history,
   cleared each time the panel is opened. IIFE-wrapped to avoid the top-level
   `const {useState}` collision other scripts hit. */
(function () {
  const { useState, useEffect, useRef } = React;
  const MI = window.MI;

  function Bubble({ m }) {
    const isUser = m.role === "user";
    return (
      <div style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start", marginBottom: 10 }}>
        <div style={{
          maxWidth: "85%", padding: "9px 12px", borderRadius: 12, fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word",
          background: isUser ? "var(--accent)" : "var(--card-2)", color: isUser ? "#fff" : "var(--fg-1)",
          border: isUser ? "none" : "1px solid var(--line)",
          borderBottomRightRadius: isUser ? 3 : 12, borderBottomLeftRadius: isUser ? 12 : 3 }}>
          {m.content}
          {!isUser && m.toolsUsed && m.toolsUsed.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 7 }}>
              {m.toolsUsed.map((t, i) => (
                <span key={i} className="chip" style={{ fontSize: 10, color: "var(--purple)", background: "color-mix(in srgb, var(--purple) 13%, transparent)", borderColor: "transparent" }}>
                  <MI style={{ fontSize: 12 }}>build</MI>{t}</span>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  function AgentChat({ account }) {
    const [open, setOpen] = useState(false);
    const [messages, setMessages] = useState([]);
    const [input, setInput] = useState("");
    const [loading, setLoading] = useState(false);
    const [suggestions, setSuggestions] = useState([]);
    const scrollRef = useRef(null);
    const inputRef = useRef(null);

    // Cmd/Ctrl+K toggles the panel.
    useEffect(() => {
      const onKey = (e) => {
        if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) { e.preventDefault(); setOpen(o => !o); }
        if (e.key === "Escape" && open) setOpen(false);
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [open]);

    // Each open starts a fresh session and pulls contextual suggestions.
    useEffect(() => {
      if (!open) return;
      setMessages([]); setInput("");
      fetch("/api/agent/suggestions").then(r => r.json()).then(d => setSuggestions(d.suggestions || [])).catch(() => setSuggestions([]));
      setTimeout(() => inputRef.current && inputRef.current.focus(), 80);
    }, [open]);

    useEffect(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [messages, loading]);

    const send = (text) => {
      const msg = (text != null ? text : input).trim();
      if (!msg || loading) return;
      const history = messages.map(m => ({ role: m.role, content: m.content }));
      const next = [...messages, { role: "user", content: msg }];
      setMessages(next); setInput(""); setLoading(true);
      fetch("/api/agent/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, accountId: account ? account.id : null, conversationHistory: history }),
      }).then(r => r.json()).then(d => {
        setMessages(m => [...m, { role: "assistant", content: d.response || "(no response)", toolsUsed: d.toolsUsed || [] }]);
        setLoading(false);
      }).catch(() => {
        setMessages(m => [...m, { role: "assistant", content: "Something went wrong reaching the assistant. Try again." }]);
        setLoading(false);
      });
    };

    return (
      <>
        {!open && (
          <button onClick={() => setOpen(true)} title="AI Assistant (Cmd+K)"
            style={{ position: "fixed", right: 22, bottom: 78, zIndex: 9000, width: 46, height: 46, borderRadius: "50%", border: "none", cursor: "pointer",
              background: "var(--accent)", color: "#fff", boxShadow: "0 6px 22px rgba(0,0,0,.28)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
            <MI style={{ fontSize: 22 }}>auto_awesome</MI>
          </button>
        )}
        {open && (
          <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, width: 400, maxWidth: "100vw", zIndex: 10000,
            background: "var(--bg-page)", borderLeft: "1px solid var(--line-2)", boxShadow: "-8px 0 30px rgba(0,0,0,.22)",
            display: "flex", flexDirection: "column", fontFamily: "var(--font-body)" }}>
            {/* header */}
            <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "14px 16px", borderBottom: "1px solid var(--line)" }}>
              <span style={{ width: 30, height: 30, borderRadius: 8, background: "color-mix(in srgb, var(--accent) 16%, transparent)", color: "var(--accent)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                <MI style={{ fontSize: 18 }}>auto_awesome</MI></span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>AI Assistant</div>
                <div style={{ fontSize: 10.5, color: "var(--fg-4)" }}>Cmd+K to toggle</div>
              </div>
              <button className="btn icon-btn btn-ghost btn-sm" onClick={() => setOpen(false)} title="Close"><MI>close</MI></button>
            </div>

            {/* account context */}
            {account && (
              <div style={{ padding: "8px 16px", fontSize: 11.5, color: "var(--fg-3)", background: "var(--card-2)", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 6 }}>
                <MI style={{ fontSize: 14, color: "var(--accent)" }}>my_location</MI>
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  Context: <strong style={{ color: "var(--fg-2)" }}>{account.tenant}</strong> · {account.ic} · {account.status}{account.hs != null ? " · HS " + account.hs : ""}</span>
              </div>
            )}

            {/* messages */}
            <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "14px 16px" }}>
              {messages.length === 0 && (
                <div style={{ color: "var(--fg-4)", fontSize: 12.5, lineHeight: 1.6, marginBottom: 14 }}>
                  Ask about your pipeline, risks, 1:1 prep, or have me draft a message. I can see your team's accounts, compliance, and calendar.
                </div>
              )}
              {messages.map((m, i) => <Bubble key={i} m={m} />)}
              {loading && (
                <div style={{ display: "flex", alignItems: "center", gap: 7, color: "var(--fg-3)", fontSize: 12.5, padding: "2px 0" }}>
                  <MI style={{ fontSize: 16, animation: "spin 1s linear infinite" }}>progress_activity</MI> Thinking…
                </div>
              )}
            </div>

            {/* suggestions */}
            {messages.length === 0 && suggestions.length > 0 && (
              <div style={{ padding: "0 16px 10px", display: "flex", flexDirection: "column", gap: 6 }}>
                {suggestions.map((s, i) => (
                  <button key={i} onClick={() => send(s)} style={{ textAlign: "left", cursor: "pointer", padding: "8px 11px", borderRadius: 999,
                    border: "1px solid var(--line-2)", background: "var(--card)", color: "var(--fg-2)", fontSize: 12, fontWeight: 600, fontFamily: "inherit" }}>
                    {s}
                  </button>
                ))}
              </div>
            )}

            {/* input */}
            <div style={{ padding: "10px 12px 12px", borderTop: "1px solid var(--line)", display: "flex", gap: 8, alignItems: "flex-end" }}>
              <textarea ref={inputRef} rows={1} value={input} placeholder="Ask anything about your pipeline…"
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                style={{ flex: 1, resize: "none", maxHeight: 120, padding: "9px 11px", borderRadius: 10, border: "1px solid var(--line-2)",
                  background: "var(--card-2)", color: "var(--fg-1)", fontSize: 13, fontFamily: "inherit", outline: "none", lineHeight: 1.4 }} />
              <button onClick={() => send()} disabled={loading || !input.trim()} title="Send"
                style={{ width: 38, height: 38, flexShrink: 0, borderRadius: 10, border: "none", cursor: loading || !input.trim() ? "default" : "pointer",
                  background: loading || !input.trim() ? "var(--soft-2)" : "var(--accent)", color: loading || !input.trim() ? "var(--fg-4)" : "#fff",
                  display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                <MI style={{ fontSize: 19, animation: loading ? "spin 1s linear infinite" : "none" }}>{loading ? "progress_activity" : "arrow_upward"}</MI>
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  Object.assign(window, { AgentChat });
})();
