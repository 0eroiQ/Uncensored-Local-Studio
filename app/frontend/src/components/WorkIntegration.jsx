import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  FileCode2,
  Folder,
  FolderOpen,
  GitBranch,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  SquareTerminal,
  X,
} from "lucide-react";

async function api(path, options = {}) {
  const res = await fetch(path, options);
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text || "{}"); } catch (_) {}
  if (!res.ok || data.ok === false) throw new Error(data.error || `Request failed (HTTP ${res.status})`);
  return data;
}

function FolderRows({ path = "", depth = 0, selectedFile, onOpenFile }) {
  const [open, setOpen] = useState(depth === 0);
  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    try {
      const data = await api(`/api/work/tree?path=${encodeURIComponent(path)}`);
      setItems(data.items || []);
      setLoaded(true);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (open && !loaded) load().catch(() => setLoaded(true));
  }, [open, loaded]);

  if (depth === 0) {
    return (
      <div>
        {busy && <div style={{ padding: "8px 10px", opacity: 0.6, fontSize: 12 }}>Loading project…</div>}
        {items.map((item) => (
          item.type === "folder" ? (
            <TreeFolder key={item.path} item={item} depth={0} selectedFile={selectedFile} onOpenFile={onOpenFile} />
          ) : (
            <TreeFile key={item.path} item={item} depth={0} selectedFile={selectedFile} onOpenFile={onOpenFile} />
          )
        ))}
      </div>
    );
  }
  return null;
}

function TreeFolder({ item, depth, selectedFile, onOpenFile }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && !loaded) {
      try {
        const data = await api(`/api/work/tree?path=${encodeURIComponent(item.path)}`);
        setItems(data.items || []);
      } finally {
        setLoaded(true);
      }
    }
  };

  return (
    <>
      <button onClick={toggle} style={treeButtonStyle(depth)} title={item.path}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Folder size={15} />
        <span style={treeTextStyle}>{item.name}</span>
      </button>
      {open && items.map((child) => (
        child.type === "folder" ? (
          <TreeFolder key={child.path} item={child} depth={depth + 1} selectedFile={selectedFile} onOpenFile={onOpenFile} />
        ) : (
          <TreeFile key={child.path} item={child} depth={depth + 1} selectedFile={selectedFile} onOpenFile={onOpenFile} />
        )
      ))}
    </>
  );
}

function TreeFile({ item, depth, selectedFile, onOpenFile }) {
  const selected = selectedFile?.path === item.path;
  return (
    <button onClick={() => onOpenFile(item.path)} style={{ ...treeButtonStyle(depth), background: selected ? "var(--md-sys-color-secondary-container, #34324a)" : "transparent" }} title={item.path}>
      <span style={{ width: 14 }} />
      <FileCode2 size={15} />
      <span style={treeTextStyle}>{item.name}</span>
    </button>
  );
}

const treeButtonStyle = (depth) => ({
  width: "100%",
  border: 0,
  background: "transparent",
  color: "inherit",
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: `6px 7px 6px ${7 + depth * 14}px`,
  borderRadius: 7,
  cursor: "pointer",
  fontSize: 12.5,
  textAlign: "left",
});

const treeTextStyle = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

function WorkPanel({ onClose }) {
  const [project, setProject] = useState({ connected: false, path: "", name: "", branch: "", changes: 0, git: false });
  const [manualPath, setManualPath] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const [editorText, setEditorText] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [explorerKey, setExplorerKey] = useState(0);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState([]);
  const activeModel = localStorage.getItem("active-model") || "No local model loaded";

  const refreshStatus = async () => {
    const data = await api("/api/work/status");
    setProject(data.project || { connected: false });
    if (data.project?.path) setManualPath(data.project.path);
  };

  useEffect(() => {
    refreshStatus().catch((err) => setError(err.message));
  }, []);

  const chooseProject = async () => {
    setError("");
    try {
      const data = await api("/api/work/choose-project", { method: "POST" });
      if (data.cancelled) return;
      setProject(data.project);
      setManualPath(data.project.path || "");
      setSelectedFile(null);
      setEditorText("");
      setDirty(false);
      setExplorerKey((v) => v + 1);
    } catch (err) {
      setError(err.message);
    }
  };

  const connectManual = async () => {
    setError("");
    try {
      const data = await api("/api/work/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: manualPath }),
      });
      setProject(data.project);
      setSelectedFile(null);
      setEditorText("");
      setDirty(false);
      setExplorerKey((v) => v + 1);
    } catch (err) {
      setError(err.message);
    }
  };

  const openFile = async (filePath) => {
    if (dirty && !window.confirm("Discard unsaved changes and open another file?")) return;
    setError("");
    try {
      const data = await api(`/api/work/file?path=${encodeURIComponent(filePath)}`);
      setSelectedFile(data.file);
      setEditorText(data.file.content || "");
      setDirty(false);
    } catch (err) {
      setError(err.message);
    }
  };

  const saveFile = async () => {
    if (!selectedFile || !dirty || saving) return;
    setSaving(true);
    setError("");
    try {
      const data = await api("/api/work/save-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: selectedFile.path,
          content: editorText,
          expectedMtimeMs: selectedFile.mtimeMs,
        }),
      });
      setSelectedFile((prev) => ({ ...prev, ...data.file, content: editorText }));
      setDirty(false);
      await refreshStatus();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const sendPrompt = () => {
    const text = draft.trim();
    if (!text) return;
    setMessages((current) => [
      ...current,
      { id: `${Date.now()}-u`, role: "user", text },
      { id: `${Date.now()}-a`, role: "assistant", text: "Project access is connected. Local coding-agent execution is the next Work phase; for now you can browse, open, edit, and save project files safely." },
    ]);
    setDraft("");
  };

  const title = project.connected ? project.name : "No project selected";

  return (
    <div style={{ position: "absolute", inset: "68px 0 0 0", zIndex: 50, display: "flex", flexDirection: "column", background: "var(--md-sys-color-surface, #101116)", color: "var(--md-sys-color-on-surface, #f2f2f5)", borderTop: "1px solid var(--md-sys-color-outline-variant, #30313a)" }}>
      <div style={{ height: 54, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 18px", borderBottom: "1px solid var(--md-sys-color-outline-variant, #30313a)", background: "var(--md-sys-color-surface-container-low, #15161c)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <Code2 size={20} />
          <strong style={{ fontSize: 15 }}>Work</strong>
          <span style={{ opacity: 0.45 }}>•</span>
          <span style={{ opacity: 0.82, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
          {dirty && <span style={{ fontSize: 11, opacity: 0.7 }}>Unsaved</span>}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 10px", borderRadius: 9, border: "1px solid var(--md-sys-color-outline-variant, #343640)", fontSize: 12 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: activeModel === "No local model loaded" ? "#777" : "#55cf7a" }} />
            <span style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{activeModel}</span>
          </div>
          <button className="m3-btn m3-btn-outlined" onClick={onClose}>Close</button>
        </div>
      </div>

      {error && (
        <div style={{ margin: "10px 12px 0", padding: "9px 12px", borderRadius: 9, border: "1px solid color-mix(in srgb, #ef4444 45%, transparent)", background: "color-mix(in srgb, #ef4444 10%, transparent)", fontSize: 12, display: "flex", justifyContent: "space-between", gap: 10 }}>
          <span>{error}</span><button onClick={() => setError("")} style={{ border: 0, background: "transparent", color: "inherit", cursor: "pointer" }}><X size={14} /></button>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "280px minmax(0, 1fr) 250px" }}>
        <aside style={{ minWidth: 0, borderRight: "1px solid var(--md-sys-color-outline-variant, #30313a)", display: "flex", flexDirection: "column", background: "var(--md-sys-color-surface-container-lowest, #0d0e12)" }}>
          <div style={{ padding: 12, borderBottom: "1px solid var(--md-sys-color-outline-variant, #30313a)" }}>
            <button onClick={chooseProject} className="m3-btn m3-btn-filled" style={{ width: "100%", justifyContent: "center", display: "flex", gap: 8, alignItems: "center" }}><FolderOpen size={16} /> Open Project</button>
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <input value={manualPath} onChange={(e) => setManualPath(e.target.value)} onKeyDown={(e) => e.key === "Enter" && connectManual()} placeholder="Or enter project path" style={{ flex: 1, minWidth: 0, border: "1px solid var(--md-sys-color-outline-variant, #343640)", background: "transparent", color: "inherit", borderRadius: 8, padding: "8px 9px", fontSize: 11.5 }} />
              <button onClick={connectManual} title="Connect path" style={{ width: 34, border: "1px solid var(--md-sys-color-outline-variant, #343640)", borderRadius: 8, background: "transparent", color: "inherit", cursor: "pointer" }}><Check size={15} /></button>
            </div>
          </div>

          <div style={{ padding: "10px 7px", flex: 1, overflow: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "3px 7px 8px", fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", opacity: 0.6 }}>
              <span>Explorer</span>
              <button onClick={() => setExplorerKey((v) => v + 1)} title="Refresh" style={{ border: 0, background: "transparent", color: "inherit", cursor: "pointer", padding: 2 }}><RefreshCw size={13} /></button>
            </div>
            {project.connected ? <FolderRows key={explorerKey} selectedFile={selectedFile} onOpenFile={openFile} /> : <div style={{ padding: 10, fontSize: 12, opacity: 0.55 }}>Open a project to browse files.</div>}
          </div>

          <div style={{ padding: 10, borderTop: "1px solid var(--md-sys-color-outline-variant, #30313a)", fontSize: 12, display: "grid", gap: 7 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}><GitBranch size={14} /> {project.git ? (project.branch || "detached") : "Not a Git repo"}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, opacity: 0.72 }}><ShieldCheck size={14} /> Project sandbox</div>
          </div>
        </aside>

        <main style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
          {selectedFile ? (
            <>
              <div style={{ height: 42, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 10px 0 14px", borderBottom: "1px solid var(--md-sys-color-outline-variant, #30313a)", background: "var(--md-sys-color-surface-container-low, #15161c)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, fontSize: 12 }}><FileCode2 size={15} /><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedFile.path}</span>{dirty && <span>•</span>}</div>
                <button disabled={!dirty || saving} onClick={saveFile} className="m3-btn m3-btn-filled" style={{ padding: "7px 11px", display: "flex", alignItems: "center", gap: 6 }}><Save size={14} /> {saving ? "Saving…" : "Save"}</button>
              </div>
              <textarea value={editorText} onChange={(e) => { setEditorText(e.target.value); setDirty(e.target.value !== selectedFile.content); }} spellCheck={false} style={{ flex: 1, width: "100%", boxSizing: "border-box", resize: "none", border: 0, outline: 0, padding: 16, background: "#0b0c10", color: "#e7e7ec", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12.5, lineHeight: 1.55, tabSize: 2 }} />
            </>
          ) : (
            <div style={{ flex: 1, display: "grid", placeItems: "center", padding: 30 }}>
              <div style={{ maxWidth: 620, textAlign: "center" }}>
                <div style={{ width: 58, height: 58, margin: "0 auto 18px", borderRadius: 18, display: "grid", placeItems: "center", background: "var(--md-sys-color-primary-container, #302d58)" }}><Bot size={28} /></div>
                <h2 style={{ margin: "0 0 8px", fontSize: 24 }}>Local Coding Work</h2>
                <p style={{ opacity: 0.68, lineHeight: 1.55 }}>{project.connected ? "Your project is connected. Pick a file in Explorer to inspect or edit it." : "Open a project folder to give Work controlled access to that project only."}</p>
              </div>
            </div>
          )}

          <div style={{ padding: 10, borderTop: "1px solid var(--md-sys-color-outline-variant, #30313a)" }}>
            <div style={{ maxWidth: 820, margin: "0 auto", border: "1px solid var(--md-sys-color-outline-variant, #343640)", borderRadius: 12, background: "var(--md-sys-color-surface-container-low, #15161c)", overflow: "hidden" }}>
              {messages.length > 0 && <div style={{ maxHeight: 130, overflow: "auto", padding: 10, fontSize: 12 }}>{messages.slice(-4).map((m) => <div key={m.id} style={{ marginBottom: 7, opacity: m.role === "user" ? 0.9 : 0.65 }}><strong>{m.role === "user" ? "You" : "Work"}:</strong> {m.text}</div>)}</div>}
              <div style={{ display: "flex", gap: 8, padding: 8 }}><input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); sendPrompt(); } }} placeholder="Ask Work about this project…" style={{ flex: 1, border: 0, outline: 0, background: "transparent", color: "inherit", padding: "6px 7px" }} /><button onClick={sendPrompt} style={{ border: 0, borderRadius: 8, padding: "8px 10px", background: "var(--md-sys-color-primary, #c5c1ff)", color: "var(--md-sys-color-on-primary, #292653)", cursor: "pointer" }}><Send size={15} /></button></div>
            </div>
          </div>
        </main>

        <aside style={{ borderLeft: "1px solid var(--md-sys-color-outline-variant, #30313a)", display: "flex", flexDirection: "column", background: "var(--md-sys-color-surface-container-lowest, #0d0e12)" }}>
          <div style={{ padding: 14, borderBottom: "1px solid var(--md-sys-color-outline-variant, #30313a)", display: "flex", gap: 8, alignItems: "center", fontWeight: 650, fontSize: 13 }}><SquareTerminal size={16} /> Activity</div>
          <div style={{ padding: 13, display: "grid", gap: 10, fontSize: 12 }}>
            <div><strong>Project</strong><div style={{ marginTop: 3, opacity: 0.65, wordBreak: "break-word" }}>{project.connected ? project.path : "Not connected"}</div></div>
            <div><strong>Git</strong><div style={{ marginTop: 3, opacity: 0.65 }}>{project.git ? `${project.branch || "detached"} • ${project.changes || 0} change(s)` : "No Git repository detected"}</div></div>
            <div><strong>Editor</strong><div style={{ marginTop: 3, opacity: 0.65 }}>{selectedFile ? selectedFile.path : "No file open"}</div></div>
            <div><strong>Model</strong><div style={{ marginTop: 3, opacity: 0.65, wordBreak: "break-word" }}>{activeModel}</div></div>
          </div>
        </aside>
      </div>
    </div>
  );
}

export default function WorkIntegration() {
  const [navMount, setNavMount] = useState(null);
  const [mainMount, setMainMount] = useState(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const ensureMounts = () => {
      const nav = document.querySelector(".nav-list");
      const main = document.querySelector(".main-content");
      if (!nav || !main) return false;
      let navHost = document.getElementById("local-work-nav-host");
      if (!navHost) {
        navHost = document.createElement("div");
        navHost.id = "local-work-nav-host";
        const modelsItem = [...nav.children].find((child) => child.textContent?.includes("Model Manager"));
        if (modelsItem) nav.insertBefore(navHost, modelsItem);
        else nav.appendChild(navHost);
      }
      let mainHost = document.getElementById("local-work-main-host");
      if (!mainHost) {
        mainHost = document.createElement("div");
        mainHost.id = "local-work-main-host";
        main.appendChild(mainHost);
      }
      if (getComputedStyle(main).position === "static") main.style.position = "relative";
      if (!cancelled) { setNavMount(navHost); setMainMount(mainHost); }
      return true;
    };
    if (!ensureMounts()) {
      const timer = setInterval(() => { if (ensureMounts()) clearInterval(timer); }, 100);
      return () => { cancelled = true; clearInterval(timer); };
    }
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const nav = document.querySelector(".nav-list");
    if (!nav) return;
    const handler = (event) => { if (!event.target.closest("#local-work-nav-host")) setOpen(false); };
    nav.addEventListener("click", handler);
    return () => nav.removeEventListener("click", handler);
  }, []);

  const navItem = navMount ? createPortal(<div className={`nav-item ${open ? "active" : ""}`} onClick={() => setOpen(true)} title="Local coding workspace"><Code2 size={20} /><span>Work</span></div>, navMount) : null;
  const workspace = open && mainMount ? createPortal(<WorkPanel onClose={() => setOpen(false)} />, mainMount) : null;
  return <>{navItem}{workspace}</>;
}
