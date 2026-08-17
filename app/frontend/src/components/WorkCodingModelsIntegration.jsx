import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  BrainCircuit,
  Check,
  ChevronDown,
  DownloadCloud,
  HardDrive,
  Loader2,
  MemoryStick,
  Play,
  RefreshCw,
  Save,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import {
  downloadLlmModel,
  getDownloadProgress,
  getHardwareSpecs,
  getLlmStatus,
  listLlmConversations,
  listLlmModels,
  saveLlmConversation,
  startLlm,
  stopLlm,
} from "../services/api";

const CODING_MODELS = [
  {
    id: "qwen25-coder-14b-q4km",
    rank: "🥇",
    name: "Qwen2.5-Coder 14B Instruct",
    shortName: "Qwen2.5 Coder 14B",
    quant: "Q4_K_M",
    filename: "qwen2.5-coder-14b-instruct-q4_k_m.gguf",
    approxSize: "8.99 GB",
    ramLabel: "16 GB+",
    minRamGb: 16,
    recommended: true,
    description: "Best coding choice for this Mac: code generation, debugging, refactors and repo-level reasoning.",
    url: "https://huggingface.co/Qwen/Qwen2.5-Coder-14B-Instruct-GGUF/resolve/main/qwen2.5-coder-14b-instruct-q4_k_m.gguf",
    contextSize: 4096,
  },
  {
    id: "qwen3-8b-q4km",
    rank: "🥈",
    name: "Qwen3 8B",
    shortName: "Qwen3 8B",
    quant: "Q4_K_M",
    filename: "Qwen3-8B-Q4_K_M.gguf",
    approxSize: "~5.0 GB",
    ramLabel: "12 GB+",
    minRamGb: 12,
    recommended: false,
    description: "Faster and lighter backup model. Good when you want more speed and lower memory use.",
    url: "https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q4_K_M.gguf",
    contextSize: 8192,
  },
  {
    id: "qwen3-coder-30b-q4km",
    rank: "🧠",
    name: "Qwen3-Coder 30B-A3B Instruct",
    shortName: "Qwen3 Coder 30B",
    quant: "Q4_K_M",
    filename: "Qwen3-Coder-30B-A3B-Instruct-Q4_K_M.gguf",
    approxSize: "18.6 GB",
    ramLabel: "32 GB+ recommended",
    minRamGb: 32,
    recommended: false,
    future: true,
    description: "Large agentic coding model for a future 32–64 GB Mac. Keep it available on the USB, but do not load it on a 16 GB machine.",
    url: "https://huggingface.co/lmstudio-community/Qwen3-Coder-30B-A3B-Instruct-GGUF/resolve/main/Qwen3-Coder-30B-A3B-Instruct-Q4_K_M.gguf",
    contextSize: 8192,
  },
];

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

function modelMatches(localModel, wanted) {
  return shortFilename(localModel?.filename || localModel?.name).toLowerCase() === wanted.filename.toLowerCase();
}

async function readJson(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || `Request failed (HTTP ${res.status})`);
  return data;
}

function StatusDot({ active }) {
  return (
    <span
      style={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        flex: "0 0 auto",
        background: active ? "#58d27d" : "var(--md-sys-color-outline, #777)",
        boxShadow: active ? "0 0 0 3px rgba(88,210,125,.12)" : "none",
      }}
    />
  );
}

function WorkCodingModelsPanel({ onClose }) {
  const [localModels, setLocalModels] = useState([]);
  const [llmStatus, setLlmStatus] = useState({ ready: false, running: false, settings: {} });
  const [specs, setSpecs] = useState({ ram_total_gb: 0 });
  const [busyModel, setBusyModel] = useState("");
  const [download, setDownload] = useState({ active: false, filename: "", progress: 0, speed: "", error: null });
  const [error, setError] = useState("");
  const [project, setProject] = useState({ connected: false, path: "", name: "" });
  const [memoryText, setMemoryText] = useState("");
  const [memorySavedText, setMemorySavedText] = useState("");
  const [memoryBusy, setMemoryBusy] = useState(false);
  const [section, setSection] = useState("models");

  const activeFilename = shortFilename(llmStatus?.settings?.model || "");
  const selectedFilename = localStorage.getItem("work-coding-model") || "";
  const activeCatalogModel = CODING_MODELS.find((model) => model.filename.toLowerCase() === activeFilename.toLowerCase());

  const refresh = useCallback(async () => {
    try {
      const [models, status, hardware, work] = await Promise.all([
        listLlmModels().catch(() => []),
        getLlmStatus().catch(() => ({ ready: false, running: false, settings: {} })),
        getHardwareSpecs().catch(() => ({ ram_total_gb: 0 })),
        fetch("/api/work/status").then(readJson).catch(() => ({ project: { connected: false, path: "", name: "" } })),
      ]);
      setLocalModels(models || []);
      setLlmStatus(status || { ready: false, running: false, settings: {} });
      setSpecs(hardware || { ram_total_gb: 0 });
      setProject(work.project || { connected: false, path: "", name: "" });
    } catch (err) {
      setError(err.message || String(err));
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 3500);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    let timer = null;
    const poll = async () => {
      try {
        const state = await getDownloadProgress();
        const normalized = state || {};
        setDownload(normalized);
        if (normalized.active) {
          timer = setTimeout(poll, 700);
        } else {
          setBusyModel("");
          await refresh();
        }
      } catch (_) {
        timer = setTimeout(poll, 1000);
      }
    };
    if (busyModel) poll();
    return () => timer && clearTimeout(timer);
  }, [busyModel, refresh]);

  const memoryId = useMemo(() => project.connected && project.path ? `work-memory-${fnv1a(project.path)}` : "", [project.connected, project.path]);

  useEffect(() => {
    let cancelled = false;
    async function loadMemory() {
      if (!memoryId) {
        setMemoryText("");
        setMemorySavedText("");
        return;
      }
      setMemoryBusy(true);
      try {
        const conversations = await listLlmConversations();
        const memory = (conversations || []).find((item) => item.id === memoryId);
        const text = String(memory?.messages?.[0]?.content || "");
        if (!cancelled) {
          setMemoryText(text);
          setMemorySavedText(text);
        }
      } catch (err) {
        if (!cancelled) setError(err.message || String(err));
      } finally {
        if (!cancelled) setMemoryBusy(false);
      }
    }
    loadMemory();
    return () => { cancelled = true; };
  }, [memoryId]);

  const handleDownload = async (model) => {
    setError("");
    setBusyModel(model.filename);
    localStorage.setItem("work-coding-model", model.filename);
    try {
      await downloadLlmModel(model.url, model.filename);
      const initial = await getDownloadProgress().catch(() => ({}));
      setDownload(initial || {});
      if (!initial?.active) {
        setBusyModel("");
        await refresh();
      }
    } catch (err) {
      setBusyModel("");
      setError(err.message || String(err));
    }
  };

  const handleLoad = async (model) => {
    const ram = Number(specs?.ram_total_gb || 0);
    if (ram > 0 && ram < model.minRamGb) {
      setError(`${model.shortName} is intended for ${model.ramLabel}. This machine reports ${ram.toFixed(0)} GB RAM, so Work blocked the load to avoid memory pressure.`);
      return;
    }
    setError("");
    setBusyModel(model.filename);
    localStorage.setItem("work-coding-model", model.filename);
    try {
      await startLlm(model.filename, {
        contextSize: model.contextSize,
        threads: Math.max(4, Math.min(12, Number(specs?.cpu_cores_physical || navigator.hardwareConcurrency || 8))),
        gpuLayers: -1,
        enableThinking: false,
        flashAttn: true,
        cacheTypeK: "q8_0",
        cacheTypeV: "q8_0",
        batchSize: 512,
        ubatchSize: 512,
        preferredBackend: "auto",
        performanceProfile: "balanced",
      });
      await refresh();
      window.dispatchEvent(new CustomEvent("uls-work-coder-model-changed", { detail: { filename: model.filename } }));
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusyModel("");
    }
  };

  const handleStop = async () => {
    setError("");
    try {
      await stopLlm();
      await refresh();
      window.dispatchEvent(new CustomEvent("uls-work-coder-model-changed", { detail: { filename: "" } }));
    } catch (err) {
      setError(err.message || String(err));
    }
  };

  const saveMemory = async () => {
    if (!memoryId || !project.connected) return;
    setMemoryBusy(true);
    setError("");
    try {
      await saveLlmConversation({
        id: memoryId,
        title: `Work Memory: ${project.name || "Project"}`,
        model: "work-project-memory",
        timestamp: Date.now(),
        projectPath: project.path,
        kind: "work-memory",
        messages: [{ role: "system", content: memoryText }],
      });
      setMemorySavedText(memoryText);
      window.dispatchEvent(new CustomEvent("uls-work-memory-changed", { detail: { projectPath: project.path } }));
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setMemoryBusy(false);
    }
  };

  const ram = Number(specs?.ram_total_gb || 0);

  return (
    <div style={{
      position: "absolute",
      top: 122,
      right: 16,
      width: "min(520px, calc(100% - 32px))",
      maxHeight: "calc(100% - 144px)",
      overflow: "auto",
      zIndex: 95,
      borderRadius: 16,
      border: "1px solid var(--md-sys-color-outline-variant, #343640)",
      background: "var(--md-sys-color-surface-container, #17181f)",
      color: "var(--md-sys-color-on-surface, #f4f4f7)",
      boxShadow: "0 24px 70px rgba(0,0,0,.38)",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 15px", borderBottom: "1px solid var(--md-sys-color-outline-variant, #343640)", position: "sticky", top: 0, zIndex: 2, background: "inherit" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <BrainCircuit size={19} />
          <div>
            <div style={{ fontWeight: 750, fontSize: 14 }}>Work Local AI</div>
            <div style={{ opacity: .62, fontSize: 11 }}>100% local inference • models stored on USB</div>
          </div>
        </div>
        <button onClick={onClose} title="Close" style={{ border: 0, background: "transparent", color: "inherit", cursor: "pointer", padding: 6 }}><X size={18} /></button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", borderBottom: "1px solid var(--md-sys-color-outline-variant, #343640)" }}>
        <button onClick={() => setSection("models")} style={{ padding: 11, border: 0, borderBottom: section === "models" ? "2px solid var(--md-sys-color-primary, #8d88ff)" : "2px solid transparent", background: "transparent", color: "inherit", cursor: "pointer", fontWeight: section === "models" ? 700 : 500 }}>Coding Models</button>
        <button onClick={() => setSection("memory")} style={{ padding: 11, border: 0, borderBottom: section === "memory" ? "2px solid var(--md-sys-color-primary, #8d88ff)" : "2px solid transparent", background: "transparent", color: "inherit", cursor: "pointer", fontWeight: section === "memory" ? 700 : 500 }}>Project Memory</button>
      </div>

      {error && (
        <div style={{ margin: 12, padding: "10px 11px", borderRadius: 10, background: "rgba(220,70,70,.12)", border: "1px solid rgba(220,70,70,.3)", fontSize: 12, lineHeight: 1.45 }}>{error}</div>
      )}

      {section === "models" ? (
        <div style={{ padding: 12, display: "grid", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "2px 2px 5px", fontSize: 12 }}>
            <span style={{ opacity: .72 }}>{ram > 0 ? `${ram.toFixed(0)} GB system memory detected` : "Checking system memory..."}</span>
            <button onClick={refresh} style={{ border: 0, background: "transparent", color: "inherit", cursor: "pointer", display: "flex", alignItems: "center", gap: 5, fontSize: 11, opacity: .75 }}><RefreshCw size={13} /> Refresh</button>
          </div>

          {CODING_MODELS.map((model) => {
            const installed = localModels.some((item) => modelMatches(item, model));
            const active = llmStatus.ready && activeFilename.toLowerCase() === model.filename.toLowerCase();
            const isBusy = busyModel === model.filename;
            const blocked = ram > 0 && ram < model.minRamGb;
            const selected = selectedFilename.toLowerCase() === model.filename.toLowerCase();
            const progressValue = isBusy && download.active ? Number(download.progress || 0) : 0;

            return (
              <div key={model.id} style={{ border: selected || active ? "1px solid color-mix(in srgb, var(--md-sys-color-primary) 58%, transparent)" : "1px solid var(--md-sys-color-outline-variant, #343640)", borderRadius: 13, padding: 13, background: active ? "color-mix(in srgb, var(--md-sys-color-primary) 8%, transparent)" : "var(--md-sys-color-surface-container-low, #121319)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                      <span>{model.rank}</span>
                      <strong style={{ fontSize: 13.5 }}>{model.name}</strong>
                      {model.recommended && <span style={{ fontSize: 10, padding: "3px 6px", borderRadius: 999, background: "var(--md-sys-color-primary-container, #302d58)" }}>Recommended</span>}
                      {model.future && <span style={{ fontSize: 10, padding: "3px 6px", borderRadius: 999, border: "1px solid var(--md-sys-color-outline-variant, #343640)" }}>Future Mac</span>}
                    </div>
                    <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap", fontSize: 10.5, opacity: .7 }}>
                      <span>{model.quant}</span><span>•</span><span>{model.approxSize}</span><span>•</span><span>{model.ramLabel}</span>
                    </div>
                    <p style={{ margin: "8px 0 0", fontSize: 11.5, lineHeight: 1.45, opacity: .72 }}>{model.description}</p>
                  </div>
                  <StatusDot active={active} />
                </div>

                {isBusy && download.active && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ height: 5, borderRadius: 999, background: "rgba(255,255,255,.08)", overflow: "hidden" }}><div style={{ width: `${Math.max(0, Math.min(100, progressValue))}%`, height: "100%", background: "var(--md-sys-color-primary, #8d88ff)" }} /></div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5, fontSize: 10.5, opacity: .7 }}><span>{progressValue >= 0 ? `${progressValue}%` : "Downloading"}</span><span>{download.speed || ""}</span></div>
                  </div>
                )}

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 11 }}>
                  <div style={{ fontSize: 10.5, opacity: .68, display: "flex", alignItems: "center", gap: 5 }}>
                    <HardDrive size={12} /> {installed ? "On USB" : "Not downloaded"}
                  </div>
                  <div style={{ display: "flex", gap: 7 }}>
                    {!installed ? (
                      <button disabled={Boolean(busyModel)} onClick={() => handleDownload(model)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 9px", borderRadius: 8, border: "1px solid var(--md-sys-color-outline-variant, #343640)", background: "transparent", color: "inherit", cursor: busyModel ? "default" : "pointer", opacity: busyModel ? .5 : 1, fontSize: 11.5 }}>
                        {isBusy ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <DownloadCloud size={13} />} Download
                      </button>
                    ) : active ? (
                      <button onClick={handleStop} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 9px", borderRadius: 8, border: "1px solid var(--md-sys-color-outline-variant, #343640)", background: "transparent", color: "inherit", cursor: "pointer", fontSize: 11.5 }}><Square size={12} /> Stop</button>
                    ) : (
                      <button disabled={Boolean(busyModel) || blocked} onClick={() => handleLoad(model)} title={blocked ? `Requires ${model.ramLabel}` : "Load coding model"} style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", borderRadius: 8, border: 0, background: "var(--md-sys-color-primary, #8d88ff)", color: "var(--md-sys-color-on-primary, #15132b)", cursor: blocked || busyModel ? "not-allowed" : "pointer", opacity: blocked || busyModel ? .45 : 1, fontSize: 11.5, fontWeight: 700 }}>
                        {isBusy ? <Loader2 size={13} /> : blocked ? <MemoryStick size={13} /> : <Play size={13} />} {blocked ? "More RAM needed" : "Load for Work"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          <div style={{ padding: "9px 10px", borderRadius: 10, border: "1px solid var(--md-sys-color-outline-variant, #343640)", fontSize: 11, lineHeight: 1.5, opacity: .75 }}>
            <Sparkles size={13} style={{ verticalAlign: "-2px", marginRight: 6 }} />
            All three run through the Studio&apos;s local llama.cpp backend. Once downloaded, inference does not require an API key or cloud service.
          </div>
        </div>
      ) : (
        <div style={{ padding: 14 }}>
          {!project.connected ? (
            <div style={{ padding: 14, borderRadius: 11, border: "1px solid var(--md-sys-color-outline-variant, #343640)", fontSize: 12, lineHeight: 1.55 }}>
              Open a project in Work first. Memory is stored per project so unrelated projects do not share context.
            </div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 9, marginBottom: 11 }}>
                <BrainCircuit size={17} style={{ marginTop: 2 }} />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>USB-backed memory for {project.name}</div>
                  <div style={{ fontSize: 11, opacity: .65, marginTop: 3, lineHeight: 1.45 }}>Stored in the Studio chat-history folder on the USB. This is project memory, not training the model&apos;s weights.</div>
                </div>
              </div>
              <textarea
                value={memoryText}
                onChange={(e) => setMemoryText(e.target.value)}
                disabled={memoryBusy}
                rows={11}
                placeholder={"Keep durable context here, for example:\n- Architecture decisions\n- Important commands\n- Bugs already fixed\n- Files the agent should remember\n- Next tasks"}
                style={{ width: "100%", boxSizing: "border-box", border: "1px solid var(--md-sys-color-outline-variant, #343640)", borderRadius: 11, padding: 11, resize: "vertical", background: "var(--md-sys-color-surface-container-lowest, #0d0e12)", color: "inherit", font: "12px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace", outline: 0 }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: 9 }}>
                <span style={{ fontSize: 10.5, opacity: .62 }}>{memoryText === memorySavedText ? "Saved on USB" : "Unsaved memory changes"}</span>
                <button disabled={memoryBusy || memoryText === memorySavedText} onClick={saveMemory} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 11px", borderRadius: 8, border: 0, background: "var(--md-sys-color-primary, #8d88ff)", color: "var(--md-sys-color-on-primary, #15132b)", cursor: memoryBusy || memoryText === memorySavedText ? "default" : "pointer", opacity: memoryBusy || memoryText === memorySavedText ? .45 : 1, fontWeight: 700, fontSize: 11.5 }}>
                  {memoryBusy ? <Loader2 size={13} /> : memoryText === memorySavedText ? <Check size={13} /> : <Save size={13} />} Save Memory
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default function WorkCodingModelsIntegration() {
  const [host, setHost] = useState(null);
  const [workOpen, setWorkOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [status, setStatus] = useState({ ready: false, settings: {} });

  useEffect(() => {
    let observer = null;
    let cancelled = false;

    const attach = () => {
      const nextHost = document.getElementById("local-work-main-host");
      if (!nextHost) return false;
      if (!cancelled) {
        setHost(nextHost);
        setWorkOpen(nextHost.childElementCount > 0);
      }
      observer = new MutationObserver(() => {
        const open = nextHost.childElementCount > 0;
        setWorkOpen(open);
        if (!open) setPanelOpen(false);
      });
      observer.observe(nextHost, { childList: true, subtree: false });
      return true;
    };

    if (!attach()) {
      const timer = setInterval(() => {
        if (attach()) clearInterval(timer);
      }, 200);
      return () => {
        cancelled = true;
        clearInterval(timer);
        observer?.disconnect();
      };
    }
    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, []);

  const refreshStatus = useCallback(async () => {
    const next = await getLlmStatus().catch(() => ({ ready: false, settings: {} }));
    setStatus(next || { ready: false, settings: {} });
  }, []);

  useEffect(() => {
    if (!workOpen) return undefined;
    refreshStatus();
    const timer = setInterval(refreshStatus, 2500);
    const handler = () => refreshStatus();
    window.addEventListener("uls-work-coder-model-changed", handler);
    return () => {
      clearInterval(timer);
      window.removeEventListener("uls-work-coder-model-changed", handler);
    };
  }, [workOpen, refreshStatus]);

  if (!host || !workOpen) return null;

  const activeFilename = shortFilename(status?.settings?.model || "");
  const active = CODING_MODELS.find((model) => model.filename.toLowerCase() === activeFilename.toLowerCase());
  const saved = CODING_MODELS.find((model) => model.filename.toLowerCase() === String(localStorage.getItem("work-coding-model") || "").toLowerCase());
  const label = status.ready ? (active?.shortName || activeFilename || "Local model") : (saved ? saved.shortName : "Choose coding model");

  return createPortal(
    <>
      <button
        onClick={() => setPanelOpen((value) => !value)}
        title="Choose the local model used by Work"
        style={{
          position: "absolute",
          top: 78,
          right: 108,
          zIndex: 90,
          height: 34,
          maxWidth: 230,
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "0 10px",
          borderRadius: 9,
          border: "1px solid var(--md-sys-color-outline-variant, #343640)",
          background: "var(--md-sys-color-surface-container-low, #15161c)",
          color: "var(--md-sys-color-on-surface, #f4f4f7)",
          cursor: "pointer",
          fontSize: 11.5,
          boxShadow: "0 4px 14px rgba(0,0,0,.16)",
        }}
      >
        <StatusDot active={Boolean(status.ready)} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
        <ChevronDown size={13} style={{ opacity: .65, flex: "0 0 auto" }} />
      </button>
      {panelOpen && <WorkCodingModelsPanel onClose={() => setPanelOpen(false)} />}
    </>,
    host,
  );
}
