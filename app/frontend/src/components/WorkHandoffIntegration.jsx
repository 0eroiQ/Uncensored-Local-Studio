import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Bot, Check, FileText, Import, Loader2, Save, X } from "lucide-react";
import { listLlmConversations, saveLlmConversation } from "../services/api";

const HANDOFF_START = "<!-- CHATGPT_HANDOFF_START -->";
const HANDOFF_END = "<!-- CHATGPT_HANDOFF_END -->";

function fnv1a(value) {
  let hash = 0x811c9dc5;
  const text = String(value || "");
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalizeStoredContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((item) => typeof item === "string" ? item : item?.text || item?.content || "").join("\n");
  return content?.text || content?.content || "";
}

async function readJson(res) {
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text || "{}"); } catch (_) {}
  if (!res.ok || data.ok === false) throw new Error(data.error || `Request failed (HTTP ${res.status})`);
  return data;
}

function mergeHandoffIntoMemory(existing, handoff) {
  const base = String(existing || "");
  const pattern = new RegExp(`${HANDOFF_START.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${HANDOFF_END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n*`, "g");
  const cleaned = base.replace(pattern, "").trim();
  const section = [
    HANDOFF_START,
    "# ChatGPT Project Handoff",
    `Imported into Work: ${new Date().toISOString()}`,
    "",
    String(handoff || "").trim(),
    HANDOFF_END,
  ].join("\n");
  return cleaned ? `${cleaned}\n\n${section}` : section;
}

async function readProjectHandoff() {
  try {
    const data = await readJson(await fetch(`/api/work/file?path=${encodeURIComponent("WORK_HANDOFF.md")}`, { cache: "no-store" }));
    return data.file || null;
  } catch (_) {
    return null;
  }
}

async function writeProjectHandoff(existingFile, content) {
  if (existingFile) {
    const data = await readJson(await fetch("/api/work/save-file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "WORK_HANDOFF.md",
        content,
        expectedMtimeMs: existingFile.mtimeMs,
      }),
    }));
    return data.file;
  }
  const data = await readJson(await fetch("/api/work-agent/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: "WORK_HANDOFF.md", content }),
  }));
  return { path: data.change?.path || "WORK_HANDOFF.md", mtimeMs: data.change?.mtimeMs || 0, content };
}

function launchAgentWithPrompt(prompt) {
  const findComposer = () => [...document.querySelectorAll("textarea")].find((node) =>
    String(node.getAttribute("placeholder") || "").includes("Ask Work to inspect")
  );

  let attempts = 0;
  const tryLaunch = () => {
    attempts += 1;
    const textarea = findComposer();
    if (!textarea) {
      if (attempts < 20) setTimeout(tryLaunch, 120);
      return;
    }

    const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    if (valueSetter) valueSetter.call(textarea, prompt);
    else textarea.value = prompt;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));

    setTimeout(() => {
      const button = [...document.querySelectorAll("button")].find((node) => node.getAttribute("title") === "Run whole-project agent");
      if (button && !button.disabled) button.click();
    }, 180);
  };
  setTimeout(tryLaunch, 120);
}

function HandoffPanel({ onClose }) {
  const [project, setProject] = useState({ connected: false, path: "", name: "" });
  const [text, setText] = useState("");
  const [source, setSource] = useState("paste");
  const [existingFile, setExistingFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const projectHash = useMemo(() => project.connected && project.path ? fnv1a(project.path) : "", [project.connected, project.path]);
  const memoryId = projectHash ? `work-memory-${projectHash}` : "";

  const refresh = useCallback(async () => {
    try {
      const status = await readJson(await fetch("/api/work/status", { cache: "no-store" }));
      const nextProject = status.project || { connected: false, path: "", name: "" };
      setProject(nextProject);
      if (!nextProject.connected) return;
      const handoff = await readProjectHandoff();
      setExistingFile(handoff);
      if (handoff?.content?.trim()) {
        setText(handoff.content);
        setSource("file");
      }
    } catch (err) {
      setError(err.message || String(err));
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const save = async ({ continueProject = false } = {}) => {
    const handoff = text.trim();
    if (!handoff || !project.connected || !memoryId) return;
    setBusy(true);
    setSaved(false);
    setError("");
    try {
      const conversations = await listLlmConversations();
      const currentMemory = (conversations || []).find((item) => item.id === memoryId);
      const existingMemoryText = normalizeStoredContent(currentMemory?.messages?.[0]?.content);
      const mergedMemory = mergeHandoffIntoMemory(existingMemoryText, handoff);

      await saveLlmConversation({
        id: memoryId,
        title: `Work Memory: ${project.name || "Project"}`,
        model: "work-project-memory",
        timestamp: Date.now(),
        projectPath: project.path,
        kind: "work-memory",
        messages: [{ role: "system", content: mergedMemory }],
      });

      const nextFile = await writeProjectHandoff(existingFile, handoff);
      setExistingFile({ ...nextFile, content: handoff });
      setSource("file");
      setSaved(true);
      window.dispatchEvent(new CustomEvent("uls-work-memory-changed", { detail: { projectPath: project.path, source: "chatgpt-handoff" } }));
      window.dispatchEvent(new CustomEvent("uls-work-files-changed", { detail: { path: "WORK_HANDOFF.md" } }));

      if (continueProject) {
        const prompt = [
          "Continue this project from the imported ChatGPT handoff.",
          "Read WORK_HANDOFF.md and the saved Project Memory first.",
          "Inspect the whole project and verify the current code against the handoff before changing anything.",
          "Do not redo work that is already complete.",
          "Identify the next unfinished task from the handoff, continue it, and use the normal Work safety rules for edits and commands.",
        ].join(" ");
        onClose();
        launchAgentWithPrompt(prompt);
      }
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ position: "absolute", top: 122, right: 16, width: "min(560px, calc(100% - 32px))", maxHeight: "calc(100% - 144px)", overflow: "auto", zIndex: 97, borderRadius: 16, border: "1px solid var(--md-sys-color-outline-variant, #343640)", background: "var(--md-sys-color-surface-container, #17181f)", color: "var(--md-sys-color-on-surface, #f4f4f7)", boxShadow: "0 24px 70px rgba(0,0,0,.4)" }}>
      <div style={{ position: "sticky", top: 0, zIndex: 2, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "14px 15px", borderBottom: "1px solid var(--md-sys-color-outline-variant, #343640)", background: "inherit" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <Bot size={19} />
          <div>
            <div style={{ fontWeight: 750, fontSize: 14 }}>ChatGPT Handoff</div>
            <div style={{ opacity: .62, fontSize: 11 }}>{project.connected ? project.name : "Open a project first"} • saved to USB memory + project file</div>
          </div>
        </div>
        <button onClick={onClose} title="Close" style={{ border: 0, background: "transparent", color: "inherit", cursor: "pointer", padding: 5 }}><X size={18} /></button>
      </div>

      <div style={{ padding: 14 }}>
        {!project.connected ? (
          <div style={{ padding: 12, borderRadius: 10, border: "1px solid var(--md-sys-color-outline-variant, #343640)", fontSize: 12, lineHeight: 1.5 }}>Open a project in Work before importing a ChatGPT handoff.</div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 10px", borderRadius: 10, background: "var(--md-sys-color-surface-container-low, #121319)", fontSize: 11.5, marginBottom: 10 }}>
              <FileText size={15} />
              <div style={{ flex: 1 }}>
                <strong>WORK_HANDOFF.md</strong>
                <div style={{ opacity: .62, marginTop: 2 }}>{existingFile ? "Detected in this project and loaded automatically." : "Will be created in the project when you save."}</div>
              </div>
              {existingFile && <Check size={15} />}
            </div>

            <div style={{ fontSize: 11.5, opacity: .7, lineHeight: 1.5, marginBottom: 9 }}>
              Paste the project handoff from ChatGPT below. Work stores the same handoff in its per-project USB memory so the local coding agent can use it even if the project file is later changed.
            </div>

            <textarea
              value={text}
              onChange={(e) => { setText(e.target.value); setSource("paste"); setSaved(false); }}
              rows={16}
              placeholder={"Paste a ChatGPT project handoff here. Include what is complete, architecture decisions, current issues, important files, and the next task."}
              style={{ width: "100%", boxSizing: "border-box", resize: "vertical", border: "1px solid var(--md-sys-color-outline-variant, #343640)", borderRadius: 11, padding: 11, background: "var(--md-sys-color-surface-container-lowest, #0d0e12)", color: "inherit", outline: 0, font: "12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace" }}
            />

            {error && <div style={{ marginTop: 9, padding: 9, borderRadius: 9, background: "rgba(220,70,70,.12)", border: "1px solid rgba(220,70,70,.28)", fontSize: 11.5 }}>{error}</div>}
            {saved && <div style={{ marginTop: 9, padding: 9, borderRadius: 9, background: "rgba(88,210,125,.1)", border: "1px solid rgba(88,210,125,.25)", fontSize: 11.5 }}>Handoff saved to Project Memory and WORK_HANDOFF.md.</div>}

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: 11, flexWrap: "wrap" }}>
              <span style={{ fontSize: 10.5, opacity: .58 }}>{source === "file" ? "Loaded from WORK_HANDOFF.md" : "Paste/import mode"}</span>
              <div style={{ display: "flex", gap: 8 }}>
                <button disabled={busy || !text.trim()} onClick={() => save({ continueProject: false })} className="m3-btn m3-btn-outlined" style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 10px" }}>
                  {busy ? <Loader2 size={14} /> : <Save size={14} />} Save Handoff
                </button>
                <button disabled={busy || !text.trim()} onClick={() => save({ continueProject: true })} className="m3-btn m3-btn-filled" style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 11px" }}>
                  {busy ? <Loader2 size={14} /> : <ArrowRight size={14} />} Save & Continue
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function WorkHandoffIntegration() {
  const [host, setHost] = useState(null);
  const [workOpen, setWorkOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    let observer = null;
    let timer = null;
    const attach = () => {
      const nextHost = document.getElementById("local-work-main-host");
      if (!nextHost) return false;
      setHost(nextHost);
      setWorkOpen(nextHost.childElementCount > 0);
      observer = new MutationObserver(() => {
        const open = nextHost.childElementCount > 0;
        setWorkOpen(open);
        if (!open) setPanelOpen(false);
      });
      observer.observe(nextHost, { childList: true, subtree: false });
      return true;
    };
    if (!attach()) timer = setInterval(() => { if (attach()) { clearInterval(timer); timer = null; } }, 180);
    return () => { if (timer) clearInterval(timer); observer?.disconnect(); };
  }, []);

  if (!host || !workOpen) return null;

  return createPortal(
    <>
      <button
        onClick={() => setPanelOpen((value) => !value)}
        title="Import a ChatGPT project handoff"
        style={{ position: "absolute", top: 78, right: 350, zIndex: 92, height: 34, display: "flex", alignItems: "center", gap: 7, padding: "0 10px", borderRadius: 9, border: "1px solid var(--md-sys-color-outline-variant, #343640)", background: "var(--md-sys-color-surface-container-low, #15161c)", color: "var(--md-sys-color-on-surface, #f4f4f7)", cursor: "pointer", fontSize: 11.5 }}
      >
        <Import size={14} /> ChatGPT Handoff
      </button>
      {panelOpen && <HandoffPanel onClose={() => setPanelOpen(false)} />}
    </>,
    host,
  );
}
