import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Bot,
  CheckCircle2,
  FileCode2,
  Loader2,
  Search,
  Send,
  ShieldCheck,
  Square,
  SquareTerminal,
  Wrench,
  X,
} from "lucide-react";
import {
  chatWithLlm,
  getLlmStatus,
  listLlmConversations,
  saveLlmConversation,
} from "../services/api";

const MAX_AGENT_STEPS = 14;
const MAX_HISTORY_MESSAGES = 16;
const MAX_TOOL_RESULT_CHARS = 28000;

async function workApi(path, body = null) {
  const options = body == null
    ? {}
    : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
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
  if (Array.isArray(content)) return content.map((item) => typeof item === "string" ? item : item?.text || item?.content || "").join("\n");
  return content?.text || content?.content || "";
}

function clip(value, max = MAX_TOOL_RESULT_CHARS) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return text.length > max ? `${text.slice(0, max)}\n…[truncated by Work]` : text;
}

function extractJson(text) {
  const raw = String(text || "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] || raw).trim();
  try { return JSON.parse(candidate); } catch (_) {}

  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try { return JSON.parse(candidate.slice(first, last + 1)); } catch (_) {}
  }
  throw new Error("The local model did not return a valid Work action. Try the request again or use the recommended coder model.");
}

function actionLabel(action) {
  switch (action?.tool) {
    case "search_project": return `Search: ${action.query || "project"}`;
    case "read_file": return `Read: ${action.path || "file"}`;
    case "replace_in_file": return `Edit: ${action.path || "file"}`;
    case "create_file": return `Create: ${action.path || "file"}`;
    case "git_status": return "Inspect Git status";
    case "git_diff": return `Inspect diff${action.path ? `: ${action.path}` : ""}`;
    case "run_command": return `Command: ${action.command || ""}`;
    case "finish": return "Finished";
    default: return action?.tool || "Thinking";
  }
}

function toolIcon(tool, size = 14) {
  if (tool === "search_project") return <Search size={size} />;
  if (tool === "read_file" || tool === "replace_in_file" || tool === "create_file") return <FileCode2 size={size} />;
  if (tool === "run_command") return <SquareTerminal size={size} />;
  if (tool === "finish") return <CheckCircle2 size={size} />;
  return <Wrench size={size} />;
}

function buildAgentSystemPrompt(project, memoryText) {
  return `You are Work Agent, a fully local software-engineering agent running inside Uncensored Local Studio.

You have controlled tool access to ONE selected project sandbox. You may inspect the whole project and decide which files are relevant. The user does not need to manually select files.

PROJECT
Name: ${project.name}
Path: ${project.path}
Git: ${project.git ? `${project.branch || "detached"}; ${project.changes || 0} current change(s)` : "not a Git repository"}

PERSISTENT PROJECT MEMORY FROM USB
${memoryText || "No saved project memory yet."}

AVAILABLE TOOLS
1. search_project
   {"tool":"search_project","query":"search terms","maxResults":30}
   Search filenames and text across the selected project. Use this first when you do not already know the needed files.

2. read_file
   {"tool":"read_file","path":"relative/path.ts","startLine":1,"endLine":240}
   Read an exact line range. Maximum 400 lines per request.

3. replace_in_file
   {"tool":"replace_in_file","path":"relative/path.ts","oldText":"exact existing text","newText":"replacement","replaceAll":false}
   Make a precise edit. oldText must exactly match current file contents. Work creates a USB rollback backup automatically before edits.

4. create_file
   {"tool":"create_file","path":"relative/new-file.ts","content":"full file contents"}
   Create a new file. It cannot overwrite an existing file.

5. git_status
   {"tool":"git_status"}

6. git_diff
   {"tool":"git_diff","path":"optional/relative/path"}

7. run_command
   {"tool":"run_command","command":"npm test","timeoutMs":60000,"reason":"why this is needed"}
   Commands require explicit user approval. Only safe allowlisted executables can run, with no shell pipes/redirection and cwd fixed to the selected project.

8. finish
   {"tool":"finish","summary":"what you did","details":"important notes, test result, and anything still needed"}

STRICT RESPONSE PROTOCOL
Return EXACTLY ONE JSON object and no markdown/prose around it.
Choose exactly one tool each turn. After a tool executes, you will receive TOOL_RESULT and then choose the next action.
Never invent file contents. Search/read before editing.
Never claim an edit succeeded until TOOL_RESULT confirms it.
Prefer small precise edits over replacing huge files.
Before finish after code changes, inspect git_diff when Git is available. Run a relevant test/build/lint command when useful; if the user rejects a command, continue without it and state that verification was not run.
Do not access paths outside the selected project.
Do not use network commands.
Do not delete files in this version.
Do not commit, push, reset, checkout, clean, or modify Git history.
If the task is informational only, search/read enough context and then finish without editing.`;
}

async function executeTool(action, approveCommand) {
  switch (action.tool) {
    case "search_project":
      return await workApi("/api/work-agent/search", { query: action.query, maxResults: action.maxResults || 30 });
    case "read_file":
      return await workApi("/api/work-agent/read", { path: action.path, startLine: action.startLine || 1, endLine: action.endLine || 240 });
    case "replace_in_file":
      return await workApi("/api/work-agent/replace", { path: action.path, oldText: action.oldText, newText: action.newText, replaceAll: action.replaceAll === true });
    case "create_file":
      return await workApi("/api/work-agent/create", { path: action.path, content: action.content || "" });
    case "git_status":
      return await workApi("/api/work-agent/git-status", {});
    case "git_diff":
      return await workApi("/api/work-agent/git-diff", { path: action.path || "" });
    case "run_command": {
      const approved = await approveCommand(action);
      if (!approved) return { ok: false, rejected: true, message: "User rejected this command. Continue without running it." };
      return await workApi("/api/work-agent/run-command", { approved: true, command: action.command, timeoutMs: action.timeoutMs || 60000 });
    }
    default:
      throw new Error(`Unknown Work tool '${action.tool}'.`);
  }
}

function WorkAgentPanel({ onClose }) {
  const [project, setProject] = useState({ connected: false, path: "", name: "", git: false, branch: "", changes: 0 });
  const [llmStatus, setLlmStatus] = useState({ ready: false, settings: {} });
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState([]);
  const [activity, setActivity] = useState([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [pendingCommand, setPendingCommand] = useState(null);
  const [memoryLoaded, setMemoryLoaded] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const stopRef = useRef(false);
  const approvalResolverRef = useRef(null);

  const projectHash = useMemo(() => project.connected && project.path ? fnv1a(project.path) : "", [project.connected, project.path]);
  const sessionId = projectHash ? `work-agent-session-${projectHash}` : "";
  const memoryId = projectHash ? `work-memory-${projectHash}` : "";
  const modelName = llmStatus.ready ? shortFilename(llmStatus?.settings?.model || "local-coder") : "No local coding model loaded";

  const refresh = useCallback(async () => {
    const [work, llm] = await Promise.all([
      workApi("/api/work/status"),
      getLlmStatus().catch(() => ({ ready: false, settings: {} })),
    ]);
    setProject(work.project || { connected: false });
    setLlmStatus(llm || { ready: false, settings: {} });
  }, []);

  useEffect(() => {
    refresh().catch((err) => setError(err.message));
    const timer = setInterval(refresh, 3000);
    const handler = () => refresh().catch(() => {});
    window.addEventListener("uls-work-coder-model-changed", handler);
    return () => {
      clearInterval(timer);
      window.removeEventListener("uls-work-coder-model-changed", handler);
      stopRef.current = true;
      if (approvalResolverRef.current) approvalResolverRef.current(false);
    };
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    async function restore() {
      if (!sessionId) {
        setMessages([]);
        setHistoryLoaded(false);
        return;
      }
      try {
        const all = await listLlmConversations();
        const session = (all || []).find((item) => item.id === sessionId);
        const memory = (all || []).find((item) => item.id === memoryId);
        if (cancelled) return;
        const restored = Array.isArray(session?.messages)
          ? session.messages
              .filter((item) => item?.role === "user" || item?.role === "assistant")
              .map((item, i) => ({ id: `${sessionId}-${i}`, role: item.role, text: normalizeStoredContent(item.content) }))
          : [];
        setMessages(restored);
        setHistoryLoaded(restored.length > 0);
        setMemoryLoaded(Boolean(normalizeStoredContent(memory?.messages?.[0]?.content).trim()));
      } catch (err) {
        if (!cancelled) setError(err.message || String(err));
      }
    }
    restore();
    return () => { cancelled = true; };
  }, [sessionId, memoryId]);

  const persist = useCallback(async (nextMessages) => {
    if (!sessionId || !project.connected) return;
    await saveLlmConversation({
      id: sessionId,
      title: `Work Agent: ${project.name || "Project"}`,
      model: modelName,
      timestamp: Date.now(),
      projectPath: project.path,
      kind: "work-agent-session",
      messages: nextMessages.map((item) => ({ role: item.role, content: item.text })),
    });
  }, [sessionId, project.connected, project.name, project.path, modelName]);

  const approveCommand = useCallback((action) => new Promise((resolve) => {
    approvalResolverRef.current = resolve;
    setPendingCommand(action);
  }), []);

  const resolveCommand = (approved) => {
    const resolver = approvalResolverRef.current;
    approvalResolverRef.current = null;
    setPendingCommand(null);
    resolver?.(approved);
  };

  const addActivity = (entry) => {
    setActivity((current) => [...current.slice(-39), { id: `${Date.now()}-${Math.random()}`, time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }), ...entry }]);
  };

  const runAgent = async () => {
    const request = draft.trim();
    if (!request || running) return;
    if (!project.connected) {
      setError("Open a project first. Work Agent only operates inside the selected project sandbox.");
      return;
    }
    if (!llmStatus.ready) {
      setError("Load one of the local coding models from the Work model picker first.");
      return;
    }

    setDraft("");
    setError("");
    setRunning(true);
    stopRef.current = false;
    setActivity([]);

    const now = Date.now();
    const userMessage = { id: `${now}-u`, role: "user", text: request };
    const startingMessages = [...messages, userMessage];
    setMessages(startingMessages);
    await persist(startingMessages).catch(() => {});

    try {
      const conversations = await listLlmConversations();
      const memory = (conversations || []).find((item) => item.id === memoryId);
      const memoryText = normalizeStoredContent(memory?.messages?.[0]?.content).trim();
      setMemoryLoaded(Boolean(memoryText));

      await workApi("/api/work-agent/status");
      const systemPrompt = buildAgentSystemPrompt(project, memoryText);
      const history = messages.slice(-MAX_HISTORY_MESSAGES).map((item) => ({ role: item.role, content: item.text }));
      const agentMessages = [
        { role: "system", content: systemPrompt },
        ...history,
        { role: "user", content: request },
      ];

      let finalSummary = "";
      let finalDetails = "";

      for (let step = 1; step <= MAX_AGENT_STEPS; step += 1) {
        if (stopRef.current) throw new DOMException("Stopped", "AbortError");
        addActivity({ tool: "thinking", label: `Planning step ${step}`, status: "running" });

        const response = await chatWithLlm(agentMessages, {
          temperature: 0.1,
          maxTokens: 1800,
          topP: 0.85,
          topK: 30,
          repeatPenalty: 1.05,
        });
        if (stopRef.current) throw new DOMException("Stopped", "AbortError");

        const action = extractJson(response.content);
        if (!action?.tool) throw new Error("Work Agent action is missing a tool name.");
        addActivity({ tool: action.tool, label: actionLabel(action), status: action.tool === "finish" ? "done" : "running" });
        agentMessages.push({ role: "assistant", content: JSON.stringify(action) });

        if (action.tool === "finish") {
          finalSummary = String(action.summary || "Task finished.");
          finalDetails = String(action.details || "");
          break;
        }

        let toolResult;
        try {
          toolResult = await executeTool(action, approveCommand);
          addActivity({ tool: action.tool, label: actionLabel(action), status: toolResult?.rejected ? "rejected" : "done" });
          if (["replace_in_file", "create_file"].includes(action.tool)) {
            window.dispatchEvent(new CustomEvent("uls-work-files-changed", { detail: { path: action.path || "" } }));
          }
        } catch (toolErr) {
          toolResult = { ok: false, error: toolErr.message || String(toolErr) };
          addActivity({ tool: action.tool, label: `${actionLabel(action)} — failed`, status: "error" });
        }

        agentMessages.push({
          role: "user",
          content: `TOOL_RESULT for ${action.tool}:\n${clip(toolResult)}\n\nChoose the next tool action. Return exactly one JSON object.`,
        });
      }

      if (!finalSummary) {
        finalSummary = `I reached the ${MAX_AGENT_STEPS}-step safety limit before returning finish.`;
        finalDetails = "Review the Activity log and ask me to continue if more work is needed.";
      }

      const assistantText = finalDetails ? `${finalSummary}\n\n${finalDetails}` : finalSummary;
      const completed = [...startingMessages, { id: `${Date.now()}-a`, role: "assistant", text: assistantText }];
      setMessages(completed);
      await persist(completed);
      setHistoryLoaded(true);
      await refresh();
    } catch (err) {
      if (err?.name === "AbortError") {
        const stopped = [...startingMessages, { id: `${Date.now()}-a`, role: "assistant", text: "Stopped. Any file changes already completed remain in the project and have USB rollback backups." }];
        setMessages(stopped);
        await persist(stopped).catch(() => {});
      } else {
        setError(err.message || String(err));
        const failed = [...startingMessages, { id: `${Date.now()}-a`, role: "assistant", text: `Work Agent stopped because of an error: ${err.message || String(err)}` }];
        setMessages(failed);
        await persist(failed).catch(() => {});
      }
    } finally {
      if (approvalResolverRef.current) approvalResolverRef.current(false);
      approvalResolverRef.current = null;
      setPendingCommand(null);
      setRunning(false);
      stopRef.current = false;
    }
  };

  const stopAgent = () => {
    stopRef.current = true;
    if (approvalResolverRef.current) approvalResolverRef.current(false);
  };

  return (
    <div style={{ position: "absolute", inset: "54px 0 0", zIndex: 72, pointerEvents: "none" }}>
      <div style={{ position: "absolute", left: "max(294px, calc(50% - 390px))", right: 264, bottom: 10, pointerEvents: "auto" }}>
        <div style={{ border: "1px solid var(--md-sys-color-outline-variant, #343640)", borderRadius: 14, background: "var(--md-sys-color-surface-container, #17181f)", color: "var(--md-sys-color-on-surface, #f3f3f7)", boxShadow: "0 14px 45px rgba(0,0,0,.3)", overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "9px 11px", borderBottom: "1px solid var(--md-sys-color-outline-variant, #343640)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <Bot size={16} />
              <strong style={{ fontSize: 12.5 }}>Whole Project Agent</strong>
              <span style={{ fontSize: 10.5, opacity: .6, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{project.connected ? project.name : "No project"} • {modelName}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span title="Project sandbox" style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10.5, opacity: .62 }}><ShieldCheck size={12} /> sandbox</span>
              <button onClick={onClose} title="Hide agent composer" style={{ border: 0, background: "transparent", color: "inherit", cursor: "pointer", padding: 3 }}><X size={14} /></button>
            </div>
          </div>

          {messages.length > 0 && (
            <div style={{ maxHeight: 180, overflow: "auto", padding: "9px 11px 3px", fontSize: 11.5, lineHeight: 1.5 }}>
              {messages.slice(-6).map((message) => (
                <div key={message.id} style={{ marginBottom: 8, opacity: message.role === "user" ? .93 : .76 }}>
                  <strong>{message.role === "user" ? "You" : "Work Agent"}:</strong> {message.text}
                </div>
              ))}
            </div>
          )}

          {activity.length > 0 && (
            <div style={{ maxHeight: 112, overflow: "auto", margin: "4px 9px", padding: "7px 8px", borderRadius: 9, background: "var(--md-sys-color-surface-container-lowest, #0d0e12)", fontSize: 10.5 }}>
              {activity.slice(-10).map((entry) => (
                <div key={entry.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0", opacity: entry.status === "error" ? 1 : .72 }}>
                  {entry.status === "running" ? <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} /> : toolIcon(entry.tool, 12)}
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.label}</span>
                  <span style={{ opacity: .45 }}>{entry.time}</span>
                </div>
              ))}
            </div>
          )}

          {error && <div style={{ margin: "6px 9px", padding: "7px 8px", borderRadius: 8, background: "rgba(220,70,70,.12)", border: "1px solid rgba(220,70,70,.28)", fontSize: 11 }}>{error}</div>}

          {pendingCommand && (
            <div style={{ margin: "7px 9px", padding: 10, borderRadius: 10, border: "1px solid var(--md-sys-color-outline-variant, #343640)", background: "var(--md-sys-color-surface-container-low, #121319)", fontSize: 11.5 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700 }}><SquareTerminal size={14} /> Work wants to run a command</div>
              <code style={{ display: "block", margin: "7px 0", padding: 8, borderRadius: 7, background: "#090a0d", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{pendingCommand.command}</code>
              {pendingCommand.reason && <div style={{ opacity: .68, marginBottom: 8 }}>{pendingCommand.reason}</div>}
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 7 }}>
                <button onClick={() => resolveCommand(false)} className="m3-btn m3-btn-outlined" style={{ padding: "6px 10px" }}>Reject</button>
                <button onClick={() => resolveCommand(true)} className="m3-btn m3-btn-filled" style={{ padding: "6px 10px" }}>Approve once</button>
              </div>
            </div>
          )}

          <div style={{ display: "flex", alignItems: "flex-end", gap: 7, padding: 8 }}>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  runAgent();
                }
              }}
              disabled={running}
              rows={2}
              placeholder={project.connected ? "Ask Work to inspect, fix, build, refactor, or test the whole project…" : "Open a project first…"}
              style={{ flex: 1, resize: "none", minHeight: 44, maxHeight: 120, border: 0, outline: 0, borderRadius: 9, padding: "8px 9px", background: "var(--md-sys-color-surface-container-lowest, #0d0e12)", color: "inherit", font: "12px/1.45 inherit" }}
            />
            {running ? (
              <button onClick={stopAgent} title="Stop agent" style={{ width: 38, height: 38, display: "grid", placeItems: "center", border: 0, borderRadius: 9, cursor: "pointer", background: "var(--md-sys-color-error-container, #5d1b1b)", color: "inherit" }}><Square size={14} /></button>
            ) : (
              <button onClick={runAgent} disabled={!draft.trim()} title="Run whole-project agent" style={{ width: 38, height: 38, display: "grid", placeItems: "center", border: 0, borderRadius: 9, cursor: draft.trim() ? "pointer" : "default", opacity: draft.trim() ? 1 : .42, background: "var(--md-sys-color-primary, #c5c1ff)", color: "var(--md-sys-color-on-primary, #292653)" }}><Send size={15} /></button>
            )}
          </div>

          <div style={{ display: "flex", gap: 10, padding: "0 10px 7px", fontSize: 9.5, opacity: .48 }}>
            <span>{historyLoaded ? "History restored from USB" : "New agent session"}</span>
            <span>•</span>
            <span>{memoryLoaded ? "Project Memory loaded" : "No Project Memory"}</span>
            <span>•</span>
            <span>File edits backed up on USB</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function WorkAgentIntegration() {
  const [host, setHost] = useState(null);
  const [workOpen, setWorkOpen] = useState(false);
  const [visible, setVisible] = useState(true);

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
        if (open) setVisible(true);
      });
      observer.observe(nextHost, { childList: true, subtree: false });
      return true;
    };
    if (!attach()) timer = setInterval(() => { if (attach()) clearInterval(timer); }, 200);
    return () => { if (timer) clearInterval(timer); observer?.disconnect(); };
  }, []);

  useEffect(() => {
    if (!workOpen) return undefined;
    const hideLegacyComposer = () => {
      const input = [...document.querySelectorAll("#local-work-main-host input")].find((node) => node.placeholder?.includes("Ask Work about this project"));
      const outer = input?.parentElement?.parentElement?.parentElement;
      if (outer) outer.style.display = "none";
    };
    hideLegacyComposer();
    const observer = new MutationObserver(hideLegacyComposer);
    observer.observe(document.getElementById("local-work-main-host"), { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [workOpen]);

  if (!host || !workOpen || !visible) return null;
  return createPortal(<WorkAgentPanel onClose={() => setVisible(false)} />, host);
}
