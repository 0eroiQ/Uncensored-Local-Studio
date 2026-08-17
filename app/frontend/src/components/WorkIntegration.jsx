import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  Loader2,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  SquareTerminal,
  X,
} from "lucide-react";
import {
  getLlmStatus,
  listLlmConversations,
  saveLlmConversation,
  streamChatWithLlm,
} from "../services/api";

async function api(path, options = {}) {
  const res = await fetch(path, options);
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text || "{}"); } catch (_) {}
  if (!res.ok || data.ok === false) throw new Error(data.error || `Request failed (HTTP ${res.status})`);
  return data;
}

function fnv1a(value) {
  let hash = 0x811c9dc5;
  const text = String(value || "");
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function shortFilename(value = "") {
  return String(value).split(/[\\/]/).pop() || "";
}

function normalizeStoredContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((item) => typeof item === "string" ? item : item?.text || item?.content || "").join("\n");
  }
  return content?.text || content?.content || "";
}

const TEXT_EXTENSIONS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".json", ".md", ".txt", ".css", ".scss", ".html",
  ".py", ".rs", ".go", ".java", ".kt", ".swift", ".c", ".cc", ".cpp", ".h", ".hpp", ".cs", ".php",
  ".rb", ".sh", ".bash", ".zsh", ".sql", ".toml", ".yaml", ".yml", ".xml", ".env", ".example",
]);

const IMPORTANT_NAMES = new Set([
  "readme.md", "package.json", "architecture.md", "agents.md", "progress.md", "current_state_audit.md",
  "database_schema.md", "migration_report.md", "tsconfig.json", "vite.config.js", "next.config.js", "next.config.mjs",
  "eslint.config.js", "eslint.config.mjs", "dockerfile", "docker-compose.yml", "docker-compose.yaml",
]);

function extensionOf(filename = "") {
  const lower = filename.toLowerCase();
  const dot = lower.lastIndexOf(".");
  return dot >= 0 ? lower.slice(dot) : "";
}

function shouldReadForContext(item) {
  const lower = String(item?.name || "").toLowerCase();
  return IMPORTANT_NAMES.has(lower) || TEXT_EXTENSIONS.has(extensionOf(lower));
}

async function buildProjectContext(project, selectedFile) {
  const manifest = [];
  const candidates = [];
  const queue = [{ path: "", depth: 0 }];
  const maxManifestItems = 180;
  const maxDepth = 5;

  while (queue.length > 0 && manifest.length < maxManifestItems) {
    const current = queue.shift();
    let data;
    try {
      data = await api(`/api/work/tree?path=${encodeURIComponent(current.path)}`);
    } catch (_) {
      continue;
    }
    for (const item of data.items || []) {
      if (manifest.length >= maxManifestItems) break;
      manifest.push(`${item.type === "folder" ? "[D]" : item.type === "file" ? "[F]" : "[L]"} ${item.path}`);
      if (item.type === "folder" && current.depth < maxDepth) {
        queue.push({ path: item.path, depth: current.depth + 1 });
      } else if (item.type === "file" && shouldReadForContext(item)) {
        const lower = item.path.toLowerCase();
        let score = 0;
        if (IMPORTANT_NAMES.has(item.name.toLowerCase())) score += 100;
        if (/^(src|app|lib|server|api|supabase)\//i.test(item.path)) score += 30;
        if (/test|spec/i.test(lower)) score += 8;
        if (Number(item.size || 0) <= 40000) score += 10;
        candidates.push({ ...item, score });
      }
    }
  }

  const selectedPath = selectedFile?.path || "";
  candidates.sort((a, b) => b.score - a.score || Number(a.size || 0) - Number(b.size || 0));
  const chosen = [];
  const seen = new Set();
  if (selectedPath) {
    chosen.push({ path: selectedPath, name: shortFilename(selectedPath), score: 1000 });
    seen.add(selectedPath);
  }
  for (const item of candidates) {
    if (chosen.length >= 12) break;
    if (seen.has(item.path)) continue;
    seen.add(item.path);
    chosen.push(item);
  }

  const snippets = [];
  let chars = 0;
  const maxChars = 52000;
  for (const item of chosen) {
    if (chars >= maxChars) break;
    try {
      const data = selectedFile?.path === item.path && typeof selectedFile?.content === "string"
        ? { file: selectedFile }
        : await api(`/api/work/file?path=${encodeURIComponent(item.path)}`);
      let content = String(data.file?.content || "");
      const remaining = maxChars - chars;
      if (content.length > remaining) content = `${content.slice(0, Math.max(0, remaining - 80))}\n…[truncated by Work context limit]`;
      snippets.push(`\n--- FILE: ${item.path} ---\n${content}`);
      chars += content.length;
    } catch (_) {}
  }

  return {
    manifest: manifest.join("\n"),
    snippets: snippets.join("\n"),
    fileCount: manifest.filter((line) => line.startsWith("[F]")).length,
    folderCount: manifest.filter((line) => line.startsWith("[D]")).length,
    contextFiles: snippets.length,
  };
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
  const [llmStatus, setLlmStatus] = useState({ ready: false, running: false, settings: {} });
  const [thinking, setThinking] = useState(false);
  const [contextStats, setContextStats] = useState({ fileCount: 0, folderCount: 0, contextFiles: 0 });
  const [memoryLoaded, setMemoryLoaded] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const abortRef = useRef(null);

  const projectHash = useMemo(() => project.connected && project.path ? fnv1a(project.path) : "", [project.connected, project.path]);
  const sessionId = projectHash ? `work-session-${projectHash}` : "";
  const memoryId = projectHash ? `work-memory-${projectHash}` : "";
  const activeModel = llmStatus.ready ? (shortFilename(llmStatus?.settings?.model) || "Local model") : "No local coding model loaded";

  const refreshStatus = useCallback(async () => {
    const [work, llm] = await Promise.all([
      api("/api/work/status"),
      getLlmStatus().catch(() => ({ ready: false, running: false, settings: {} })),
    ]);
    setProject(work.project || { connected: false });
    if (work.project?.path) setManualPath(work.project.path);
    setLlmStatus(llm || { ready: false, running: false, settings: {} });
  }, []);

  useEffect(() => {
    refreshStatus().catch((err) => setError(err.message));
    const timer = setInterval(() => {
      getLlmStatus().then(setLlmStatus).catch(() => {});
    }, 3000);
    const modelChanged = () => getLlmStatus().then(setLlmStatus).catch(() => {});
    window.addEventListener("uls-work-coder-model-changed", modelChanged);
    return () => {
      clearInterval(timer);
      window.removeEventListener("uls-work-coder-model-changed", modelChanged);
      abortRef.current?.abort();
    };
  }, [refreshStatus]);

  useEffect(() => {
    let cancelled = false;
    async function restoreProjectSession() {
      if (!projectHash) {
        setMessages([]);
        setMemoryLoaded(false);
        setHistoryLoaded(false);
        return;
      }
      try {
        const conversations = await listLlmConversations();
        const session = (conversations || []).find((item) => item.id === sessionId);
        const memory = (conversations || []).find((item) => item.id === memoryId);
        if (cancelled) return;
        const restored = Array.isArray(session?.messages)
          ? session.messages
              .filter((item) => item?.role === "user" || item?.role === "assistant")
              .map((item, index) => ({ id: `${sessionId}-${index}`, role: item.role, text: normalizeStoredContent(item.content) }))
          : [];
        setMessages(restored);
        setHistoryLoaded(restored.length > 0);
        setMemoryLoaded(Boolean(normalizeStoredContent(memory?.messages?.[0]?.content).trim()));
      } catch (err) {
        if (!cancelled) setError(err.message || String(err));
      }
    }
    restoreProjectSession();
    return () => { cancelled = true; };
  }, [projectHash, sessionId, memoryId]);

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

  const persistSession = useCallback(async (nextMessages) => {
    if (!sessionId || !project.connected) return;
    await saveLlmConversation({
      id: sessionId,
      title: `Work: ${project.name || "Project"}`,
      model: shortFilename(llmStatus?.settings?.model || "local-coder"),
      timestamp: Date.now(),
      projectPath: project.path,
      kind: "work-session",
      messages: nextMessages.map((item) => ({ role: item.role, content: item.text })),
    });
  }, [sessionId, project.connected, project.name, project.path, llmStatus?.settings?.model]);

  const sendPrompt = async () => {
    const text = draft.trim();
    if (!text || thinking) return;
    if (!project.connected) {
      setError("Open a project before asking Work to code.");
      return;
    }
    if (!llmStatus.ready) {
      setError("Load a local coding model from the Work model picker first.");
      return;
    }

    setError("");
    setDraft("");
    setThinking(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const now = Date.now();
    const userMessage = { id: `${now}-u`, role: "user", text };
    const assistantMessage = { id: `${now}-a`, role: "assistant", text: "" };
    const baseMessages = [...messages, userMessage];
    setMessages([...baseMessages, assistantMessage]);

    try {
      const conversations = await listLlmConversations();
      const memory = (conversations || []).find((item) => item.id === memoryId);
      const memoryText = normalizeStoredContent(memory?.messages?.[0]?.content).trim();
      setMemoryLoaded(Boolean(memoryText));

      const selectedForContext = selectedFile
        ? { ...selectedFile, content: dirty ? editorText : selectedFile.content }
        : null;
      const projectContext = await buildProjectContext(project, selectedForContext);
      setContextStats({
        fileCount: projectContext.fileCount,
        folderCount: projectContext.folderCount,
        contextFiles: projectContext.contextFiles,
      });

      const systemPrompt = [
        "You are Work, a fully local coding assistant running inside Uncensored Local Studio.",
        "Continue the same project across sessions. Use the supplied project memory, prior conversation history, file tree, and code snippets as authoritative context.",
        "Do not claim you changed a file unless the user actually applies/saves an edit. In this phase, explain concrete changes and provide exact code or patches when edits are requested.",
        "Prefer the project's existing architecture, libraries, naming conventions, and patterns. If context is incomplete, say which file you need the user to open rather than inventing it.",
        `Project: ${project.name}`,
        `Project path: ${project.path}`,
        `Git: ${project.git ? `${project.branch || "detached"}, ${project.changes || 0} local change(s)` : "not a Git repository"}`,
        memoryText ? `\nPERSISTENT PROJECT MEMORY (stored on USB):\n${memoryText}` : "\nPERSISTENT PROJECT MEMORY: none saved yet.",
        `\nPROJECT FILE MANIFEST (bounded scan):\n${projectContext.manifest}`,
        projectContext.snippets ? `\nCURRENT PROJECT FILE CONTENT:\n${projectContext.snippets}` : "",
      ].filter(Boolean).join("\n");

      const recentHistory = messages.slice(-12).map((item) => ({ role: item.role, content: item.text }));
      const llmMessages = [
        { role: "system", content: systemPrompt },
        ...recentHistory,
        { role: "user", content: text },
      ];

      let finalText = "";
      const result = await streamChatWithLlm(llmMessages, {
        temperature: 0.2,
        maxTokens: 1800,
        topP: 0.9,
        topK: 40,
        repeatPenalty: 1.08,
        signal: controller.signal,
      }, (token, content) => {
        finalText = content || finalText + token;
        setMessages([...baseMessages, { ...assistantMessage, text: finalText }]);
      });

      finalText = result?.content || finalText || "The local coding model returned no text.";
      const completed = [...baseMessages, { ...assistantMessage, text: finalText }];
      setMessages(completed);
      await persistSession(completed);
      setHistoryLoaded(true);
    } catch (err) {
      if (err?.name === "AbortError") {
        const stopped = [...baseMessages, { ...assistantMessage, text: "Stopped." }];
        setMessages(stopped);
        await persistSession(stopped).catch(() => {});
      } else {
        setError(err.message || String(err));
        setMessages(baseMessages);
        await persistSession(baseMessages).catch(() => {});
      }
    } finally {
      setThinking(false);
      abortRef.current = null;
    }
  };

  const stopThinking = () => abortRef.current?.abort();
  const title = project.connected ? project.name : "No project selected";

  return (
    <div style={{ position: "absolute", inset: "68px 0 0 0", zIndex: 50, display: "flex", flexDirection: "column", background: "#101116", color: "var(--md-sys-color-on-surface, #f2f2f5)", borderTop: "1px solid var(--md-sys-color-outline-variant, #30313a)" }}>
      <div style={{ height: 54, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 18px", borderBottom: "1px solid var(--md-sys-color-outline-variant, #30313a)", background: "var(--md-sys-color-surface-container-low, #15161c)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <Code2 size={20} />
          <strong style={{ fontSize: 15 }}>Work</strong>
          <span style={{ opacity: 0.45 }}>•</span>
          <span style={{ opacity: 0.82, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
          {dirty && <span style={{ fontSize: 11, opacity: 0.7 }}>Unsaved</span>}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginRight: 238 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 10px", borderRadius: 9, border: "1px solid var(--md-sys-color-outline-variant, #343640)", fontSize: 12 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: llmStatus.ready ? "#55cf7a" : "#777" }} />
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
                <p style={{ opacity: 0.68, lineHeight: 1.55 }}>{project.connected ? "Your project is connected. Work can now combine project files, prior Work history, and USB Project Memory when you chat." : "Open a project folder to give Work controlled access to that project only."}</p>
              </div>
            </div>
          )}

          <div style={{ padding: 10, borderTop: "1px solid var(--md-sys-color-outline-variant, #30313a)" }}>
            <div style={{ maxWidth: 820, margin: "0 auto", border: "1px solid var(--md-sys-color-outline-variant, #343640)", borderRadius: 12, background: "var(--md-sys-color-surface-container-low, #15161c)", overflow: "hidden" }}>
              {messages.length > 0 && (
                <div style={{ maxHeight: 220, overflow: "auto", padding: 10, fontSize: 12 }}>
                  {messages.slice(-8).map((m) => (
                    <div key={m.id} style={{ marginBottom: 9, lineHeight: 1.45, opacity: m.role === "user" ? 0.92 : 0.75, whiteSpace: "pre-wrap" }}>
                      <strong>{m.role === "user" ? "You" : "Work"}:</strong> {m.text || (thinking && m.role === "assistant" ? "Thinking…" : "")}
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", gap: 8, padding: 8 }}>
                <input disabled={thinking} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); sendPrompt(); } }} placeholder={llmStatus.ready ? "Ask Work about this project…" : "Load a local coding model first…"} style={{ flex: 1, border: 0, outline: 0, background: "transparent", color: "inherit", padding: "6px 7px", opacity: thinking ? .55 : 1 }} />
                {thinking ? (
                  <button onClick={stopThinking} title="Stop" style={{ border: 0, borderRadius: 8, padding: "8px 10px", background: "var(--md-sys-color-error-container, #5c1d1d)", color: "var(--md-sys-color-on-error-container, #ffdada)", cursor: "pointer" }}><X size={15} /></button>
                ) : (
                  <button onClick={sendPrompt} style={{ border: 0, borderRadius: 8, padding: "8px 10px", background: "var(--md-sys-color-primary, #c5c1ff)", color: "var(--md-sys-color-on-primary, #292653)", cursor: "pointer" }}><Send size={15} /></button>
                )}
              </div>
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
            <div><strong>Work history</strong><div style={{ marginTop: 3, opacity: 0.65 }}>{historyLoaded ? `${messages.length} saved message(s) restored from USB` : "No previous session"}</div></div>
            <div><strong>Project Memory</strong><div style={{ marginTop: 3, opacity: 0.65 }}>{memoryLoaded ? "Loaded from USB" : "No saved memory yet"}</div></div>
            <div><strong>Context scan</strong><div style={{ marginTop: 3, opacity: 0.65 }}>{contextStats.fileCount > 0 || contextStats.folderCount > 0 ? `${contextStats.contextFiles} file(s) supplied • ${contextStats.fileCount} files / ${contextStats.folderCount} folders indexed` : "Built on first prompt"}</div></div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function setNativeWorkspaceVisibility(main, visible) {
  if (!main) return;
  const workHost = document.getElementById("local-work-main-host");
  for (const workspace of main.querySelectorAll(":scope > .workspace-area, :scope > [class*='workspace-area']")) {
    if (workspace === workHost || workHost?.contains(workspace)) continue;
    if (visible) {
      if (workspace.dataset.workPrevDisplay !== undefined) {
        workspace.style.display = workspace.dataset.workPrevDisplay;
        delete workspace.dataset.workPrevDisplay;
      } else {
        workspace.style.removeProperty("display");
      }
      workspace.removeAttribute("aria-hidden");
    } else {
      if (workspace.dataset.workPrevDisplay === undefined) workspace.dataset.workPrevDisplay = workspace.style.display || "";
      workspace.style.display = "none";
      workspace.setAttribute("aria-hidden", "true");
    }
  }
}

function setNativeNavActive(nav, workHost, workOpen) {
  if (!nav) return;
  for (const item of nav.querySelectorAll(".nav-item")) {
    if (workHost?.contains(item)) continue;
    if (workOpen) {
      if (item.classList.contains("active")) item.dataset.workWasActive = "true";
      item.classList.remove("active");
      item.setAttribute("aria-selected", "false");
    } else if (item.dataset.workWasActive === "true") {
      item.classList.add("active");
      item.setAttribute("aria-selected", "true");
      delete item.dataset.workWasActive;
    }
  }
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
    const main = document.querySelector(".main-content");
    const workHost = document.getElementById("local-work-nav-host");
    if (!nav || !main) return undefined;

    setNativeWorkspaceVisibility(main, !open);
    setNativeNavActive(nav, workHost, open);

    if (open) {
      main.dataset.workExclusive = "true";
      document.body.dataset.workExclusive = "true";
    } else {
      delete main.dataset.workExclusive;
      delete document.body.dataset.workExclusive;
    }

    return () => {
      setNativeWorkspaceVisibility(main, true);
      setNativeNavActive(nav, workHost, false);
      delete main.dataset.workExclusive;
      delete document.body.dataset.workExclusive;
    };
  }, [open, mainMount, navMount]);

  useEffect(() => {
    const nav = document.querySelector(".nav-list");
    if (!nav) return undefined;
    const handler = (event) => {
      if (!event.target.closest("#local-work-nav-host")) setOpen(false);
    };
    nav.addEventListener("click", handler);
    return () => nav.removeEventListener("click", handler);
  }, []);

  const navItem = navMount ? createPortal(
    <div
      className={`nav-item ${open ? "active" : ""}`}
      aria-selected={open ? "true" : "false"}
      onClick={() => setOpen(true)}
      title="Local coding workspace"
    >
      <Code2 size={20} /><span>Work</span>
    </div>,
    navMount,
  ) : null;
  const workspace = open && mainMount ? createPortal(<WorkPanel onClose={() => setOpen(false)} />, mainMount) : null;
  return <>{navItem}{workspace}</>;
}
