import React, { useCallback, useEffect, useState } from "react";
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
  ShieldCheck,
  SquareTerminal,
  X,
} from "lucide-react";
import { getLlmStatus } from "../services/api";

async function api(path, options = {}) {
  const res = await fetch(path, options);
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text || "{}"); } catch (_) {}
  if (!res.ok || data.ok === false) throw new Error(data.error || `Request failed (HTTP ${res.status})`);
  return data;
}

function shortFilename(value = "") {
  return String(value).split(/[\\/]/).pop() || "";
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

function TreeFile({ item, depth, selectedFile, onOpenFile }) {
  const selected = selectedFile?.path === item.path;
  return (
    <button
      onClick={() => onOpenFile(item.path)}
      style={{ ...treeButtonStyle(depth), background: selected ? "var(--md-sys-color-secondary-container, #34324a)" : "transparent" }}
      title={item.path}
    >
      <span style={{ width: 14 }} />
      <FileCode2 size={15} />
      <span style={treeTextStyle}>{item.name}</span>
    </button>
  );
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

function Explorer({ refreshKey, selectedFile, onOpenFile }) {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setBusy(true);
      try {
        const data = await api("/api/work/tree?path=");
        if (!cancelled) setItems(data.items || []);
      } catch (_) {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setBusy(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [refreshKey]);

  if (busy) return <div style={{ padding: 10, fontSize: 12, opacity: .6 }}>Loading project…</div>;
  return items.map((item) => (
    item.type === "folder" ? (
      <TreeFolder key={item.path} item={item} depth={0} selectedFile={selectedFile} onOpenFile={onOpenFile} />
    ) : (
      <TreeFile key={item.path} item={item} depth={0} selectedFile={selectedFile} onOpenFile={onOpenFile} />
    )
  ));
}

export default function WorkNativeWorkspace({ active = false }) {
  const [project, setProject] = useState({ connected: false, path: "", name: "", git: false, branch: "", changes: 0 });
  const [manualPath, setManualPath] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const [editorText, setEditorText] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [explorerKey, setExplorerKey] = useState(0);
  const [error, setError] = useState("");
  const [llmStatus, setLlmStatus] = useState({ ready: false, settings: {} });

  const refresh = useCallback(async () => {
    const [work, llm] = await Promise.all([
      api("/api/work/status"),
      getLlmStatus().catch(() => ({ ready: false, settings: {} })),
    ]);
    setProject(work.project || { connected: false });
    if (work.project?.path) setManualPath(work.project.path);
    setLlmStatus(llm || { ready: false, settings: {} });
  }, []);

  useEffect(() => {
    const host = document.getElementById("local-work-main-host");
    if (host) host.dataset.workOpen = active ? "true" : "false";
    window.dispatchEvent(new CustomEvent("uls-work-open-changed", { detail: { open: active } }));
  }, [active]);

  useEffect(() => {
    refresh().catch((err) => setError(err.message || String(err)));
    const timer = setInterval(() => {
      if (active) refresh().catch(() => {});
    }, 3000);
    const modelChanged = () => refresh().catch(() => {});
    const filesChanged = () => {
      setExplorerKey((value) => value + 1);
      refresh().catch(() => {});
    };
    window.addEventListener("uls-work-coder-model-changed", modelChanged);
    window.addEventListener("uls-work-files-changed", filesChanged);
    return () => {
      clearInterval(timer);
      window.removeEventListener("uls-work-coder-model-changed", modelChanged);
      window.removeEventListener("uls-work-files-changed", filesChanged);
    };
  }, [active, refresh]);

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
      setExplorerKey((value) => value + 1);
    } catch (err) {
      setError(err.message || String(err));
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
      setExplorerKey((value) => value + 1);
    } catch (err) {
      setError(err.message || String(err));
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
      setError(err.message || String(err));
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
      setSelectedFile((previous) => ({ ...previous, ...data.file, content: editorText }));
      setDirty(false);
      await refresh();
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setSaving(false);
    }
  };

  const modelName = llmStatus.ready ? shortFilename(llmStatus?.settings?.model || "Local model") : "No local coding model loaded";

  return (
    <div
      id="local-work-main-host"
      data-work-open={active ? "true" : "false"}
      style={{ position: "relative", flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--md-sys-color-surface, #101116)", color: "var(--md-sys-color-on-surface, #f2f2f5)" }}
    >
      <div style={{ height: 58, flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "0 16px", borderBottom: "1px solid var(--md-sys-color-outline-variant, #30313a)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <Code2 size={19} />
          <strong>Work</strong>
          <span style={{ opacity: .42 }}>•</span>
          <span style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", opacity: .78 }}>{project.connected ? project.name : "No project selected"}</span>
          {dirty && <span style={{ fontSize: 11, opacity: .65 }}>Unsaved</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginRight: 260 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 10px", border: "1px solid var(--md-sys-color-outline-variant, #343640)", borderRadius: 9, fontSize: 11.5 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: llmStatus.ready ? "#55cf7a" : "#777" }} />
            <span style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{modelName}</span>
          </div>
        </div>
      </div>

      {error && (
        <div style={{ margin: "8px 12px 0", padding: "8px 10px", borderRadius: 9, border: "1px solid rgba(239,68,68,.35)", background: "rgba(239,68,68,.09)", fontSize: 12, display: "flex", justifyContent: "space-between", gap: 10 }}>
          <span>{error}</span>
          <button onClick={() => setError("")} style={{ border: 0, background: "transparent", color: "inherit", cursor: "pointer" }}><X size={14} /></button>
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "280px minmax(0, 1fr) 250px" }}>
        <aside style={{ minWidth: 0, borderRight: "1px solid var(--md-sys-color-outline-variant, #30313a)", display: "flex", flexDirection: "column", background: "var(--md-sys-color-surface-container-lowest, #0d0e12)" }}>
          <div style={{ padding: 12, borderBottom: "1px solid var(--md-sys-color-outline-variant, #30313a)" }}>
            <button onClick={chooseProject} className="m3-btn m3-btn-filled" style={{ width: "100%", justifyContent: "center", display: "flex", gap: 8, alignItems: "center" }}><FolderOpen size={16} /> Open Project</button>
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <input value={manualPath} onChange={(event) => setManualPath(event.target.value)} onKeyDown={(event) => event.key === "Enter" && connectManual()} placeholder="Or enter project path" style={{ flex: 1, minWidth: 0, border: "1px solid var(--md-sys-color-outline-variant, #343640)", background: "transparent", color: "inherit", borderRadius: 8, padding: "8px 9px", fontSize: 11.5 }} />
              <button onClick={connectManual} title="Connect path" style={{ width: 34, border: "1px solid var(--md-sys-color-outline-variant, #343640)", borderRadius: 8, background: "transparent", color: "inherit", cursor: "pointer" }}><Check size={15} /></button>
            </div>
          </div>

          <div style={{ padding: "10px 7px", flex: 1, overflow: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "3px 7px 8px", fontSize: 11, textTransform: "uppercase", letterSpacing: ".08em", opacity: .6 }}>
              <span>Explorer</span>
              <button onClick={() => setExplorerKey((value) => value + 1)} title="Refresh" style={{ border: 0, background: "transparent", color: "inherit", cursor: "pointer", padding: 2 }}><RefreshCw size={13} /></button>
            </div>
            {project.connected ? <Explorer refreshKey={explorerKey} selectedFile={selectedFile} onOpenFile={openFile} /> : <div style={{ padding: 10, fontSize: 12, opacity: .55 }}>Open a project to browse files.</div>}
          </div>

          <div style={{ padding: 10, borderTop: "1px solid var(--md-sys-color-outline-variant, #30313a)", fontSize: 12, display: "grid", gap: 7 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}><GitBranch size={14} /> {project.git ? (project.branch || "detached") : "Not a Git repo"}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, opacity: .72 }}><ShieldCheck size={14} /> Project sandbox</div>
          </div>
        </aside>

        <main style={{ minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {selectedFile ? (
            <>
              <div style={{ height: 42, flex: "0 0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 10px 0 14px", borderBottom: "1px solid var(--md-sys-color-outline-variant, #30313a)", background: "var(--md-sys-color-surface-container-low, #15161c)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, fontSize: 12 }}><FileCode2 size={15} /><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedFile.path}</span>{dirty && <span>•</span>}</div>
                <button disabled={!dirty || saving} onClick={saveFile} className="m3-btn m3-btn-filled" style={{ padding: "7px 11px", display: "flex", alignItems: "center", gap: 6 }}><Save size={14} /> {saving ? "Saving…" : "Save"}</button>
              </div>
              <textarea value={editorText} onChange={(event) => { setEditorText(event.target.value); setDirty(event.target.value !== selectedFile.content); }} spellCheck={false} style={{ flex: 1, width: "100%", boxSizing: "border-box", resize: "none", border: 0, outline: 0, padding: 16, background: "#0b0c10", color: "#e7e7ec", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace", fontSize: 12.5, lineHeight: 1.55, tabSize: 2 }} />
            </>
          ) : (
            <div style={{ flex: 1, display: "grid", placeItems: "center", padding: "30px 30px 160px" }}>
              <div style={{ maxWidth: 620, textAlign: "center" }}>
                <div style={{ width: 58, height: 58, margin: "0 auto 18px", borderRadius: 18, display: "grid", placeItems: "center", background: "var(--md-sys-color-primary-container, #302d58)" }}><Bot size={28} /></div>
                <h2 style={{ margin: "0 0 8px", fontSize: 24 }}>Local Coding Work</h2>
                <p style={{ opacity: .68, lineHeight: 1.55 }}>{project.connected ? "Ask the Whole Project Agent to inspect, fix, build, refactor, or test this project. You do not need to select files first." : "Open a project folder to give the local coding agent controlled access to that project only."}</p>
              </div>
            </div>
          )}
        </main>

        <aside style={{ borderLeft: "1px solid var(--md-sys-color-outline-variant, #30313a)", display: "flex", flexDirection: "column", background: "var(--md-sys-color-surface-container-lowest, #0d0e12)" }}>
          <div style={{ padding: 14, borderBottom: "1px solid var(--md-sys-color-outline-variant, #30313a)", display: "flex", gap: 8, alignItems: "center", fontWeight: 650, fontSize: 13 }}><SquareTerminal size={16} /> Activity</div>
          <div style={{ padding: 13, display: "grid", gap: 10, fontSize: 12 }}>
            <div><strong>Project</strong><div style={{ marginTop: 3, opacity: .65, wordBreak: "break-word" }}>{project.connected ? project.path : "Not connected"}</div></div>
            <div><strong>Git</strong><div style={{ marginTop: 3, opacity: .65 }}>{project.git ? `${project.branch || "detached"} • ${project.changes || 0} change(s)` : "No Git repository detected"}</div></div>
            <div><strong>Editor</strong><div style={{ marginTop: 3, opacity: .65 }}>{selectedFile ? selectedFile.path : "No file open"}</div></div>
            <div><strong>Model</strong><div style={{ marginTop: 3, opacity: .65, wordBreak: "break-word" }}>{modelName}</div></div>
          </div>
        </aside>
      </div>
    </div>
  );
}
