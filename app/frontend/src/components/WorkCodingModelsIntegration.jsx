import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BrainCircuit, Check, ChevronDown, DownloadCloud, HardDrive, Loader2, MemoryStick, Pause, Play, RefreshCw, Save, Square, X } from "lucide-react";
import { formatBytes, getHardwareSpecs, getLlmStatus, listLlmConversations, listLlmModels, saveLlmConversation, startLlm, stopLlm } from "../services/api";

const CODING_MODELS = [
  { id: "qwen25-coder-14b-q4km", rank: "🥇", name: "Qwen2.5-Coder 14B Instruct", shortName: "Qwen2.5 Coder 14B", quant: "Q4_K_M", filename: "qwen2.5-coder-14b-instruct-q4_k_m.gguf", approxSize: "8.99 GB", ramLabel: "16 GB+", minRamGb: 16, recommended: true, description: "Recommended coding model for a 16 GB Apple Silicon Mac.", url: "https://huggingface.co/Qwen/Qwen2.5-Coder-14B-Instruct-GGUF/resolve/main/qwen2.5-coder-14b-instruct-q4_k_m.gguf", contextSize: 4096 },
  { id: "qwen3-8b-q4km", rank: "🥈", name: "Qwen3 8B", shortName: "Qwen3 8B", quant: "Q4_K_M", filename: "Qwen3-8B-Q4_K_M.gguf", approxSize: "~5.0 GB", ramLabel: "12 GB+", minRamGb: 12, description: "Faster, lighter backup model for Work.", url: "https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q4_K_M.gguf", contextSize: 8192 },
  { id: "qwen3-coder-30b-q4km", rank: "🧠", name: "Qwen3-Coder 30B-A3B Instruct", shortName: "Qwen3 Coder 30B", quant: "Q4_K_M", filename: "Qwen3-Coder-30B-A3B-Instruct-Q4_K_M.gguf", approxSize: "18.6 GB", ramLabel: "32 GB+ recommended", minRamGb: 32, future: true, description: "Large agentic coding model for a future higher-memory Mac.", url: "https://huggingface.co/lmstudio-community/Qwen3-Coder-30B-A3B-Instruct-GGUF/resolve/main/Qwen3-Coder-30B-A3B-Instruct-Q4_K_M.gguf", contextSize: 8192 },
];

function fnv1a(value) { let hash = 0x811c9dc5; for (const ch of String(value || "")) { hash ^= ch.charCodeAt(0); hash = Math.imul(hash, 0x01000193); } return (hash >>> 0).toString(16).padStart(8, "0"); }
function shortFilename(value = "") { return String(value).split(/[\\/]/).pop() || ""; }
function sameFilename(a, b) { return shortFilename(a).toLowerCase() === shortFilename(b).toLowerCase(); }
async function jsonFetch(url, options) { const res = await fetch(url, options); const text = await res.text(); let data = {}; try { data = JSON.parse(text || "{}"); } catch (_) {} if (!res.ok || data.ok === false) throw new Error(data.error || `Request failed (HTTP ${res.status})`); return data; }
function StatusDot({ active }) { return <span style={{ width: 8, height: 8, borderRadius: "50%", flex: "0 0 auto", background: active ? "#58d27d" : "#777", boxShadow: active ? "0 0 0 3px rgba(88,210,125,.12)" : "none" }} />; }
function formatEta(seconds) { const n = Number(seconds); if (!Number.isFinite(n) || n < 0) return "Calculating…"; if (n < 60) return `${Math.round(n)}s`; const m = Math.floor(n / 60); return m < 60 ? `${m}m ${Math.round(n % 60)}s` : `${Math.floor(m / 60)}h ${m % 60}m`; }

function WorkCodingModelsPanel({ onClose }) {
  const [localModels, setLocalModels] = useState([]);
  const [llmStatus, setLlmStatus] = useState({ ready: false, settings: {} });
  const [specs, setSpecs] = useState({ ram_total_gb: 0 });
  const [download, setDownload] = useState({ active: false, complete: false, filename: "", progress: 0, downloadedBytes: 0, totalBytes: 0, speed: "", eta: 0, error: "" });
  const [partials, setPartials] = useState({});
  const [busyModel, setBusyModel] = useState("");
  const [error, setError] = useState("");
  const [section, setSection] = useState("models");
  const [project, setProject] = useState({ connected: false, path: "", name: "" });
  const [memoryText, setMemoryText] = useState("");
  const [memorySavedText, setMemorySavedText] = useState("");
  const [memoryBusy, setMemoryBusy] = useState(false);
  const autoLoadedRef = useRef("");

  const activeFilename = shortFilename(llmStatus?.settings?.model || "");
  const selectedFilename = localStorage.getItem("work-coding-model") || "";
  const ram = Number(specs?.ram_total_gb || 0);
  const memoryId = useMemo(() => project.connected && project.path ? `work-memory-${fnv1a(project.path)}` : "", [project.connected, project.path]);

  const refreshCore = useCallback(async () => {
    const [models, status, hardware, work] = await Promise.all([
      listLlmModels().catch(() => []),
      getLlmStatus().catch(() => ({ ready: false, settings: {} })),
      getHardwareSpecs().catch(() => ({ ram_total_gb: 0 })),
      jsonFetch("/api/work/status").catch(() => ({ project: { connected: false, path: "", name: "" } })),
    ]);
    setLocalModels(models || []);
    setLlmStatus(status || { ready: false, settings: {} });
    setSpecs(hardware || { ram_total_gb: 0 });
    setProject(work.project || { connected: false, path: "", name: "" });
  }, []);

  const refreshPartials = useCallback(async () => {
    const entries = await Promise.all(CODING_MODELS.map(async (model) => {
      try { const data = await jsonFetch(`/api/work-model/partial?filename=${encodeURIComponent(model.filename)}`); return [model.filename, data]; }
      catch (_) { return [model.filename, { partial: false, partialBytes: 0 }]; }
    }));
    setPartials(Object.fromEntries(entries));
  }, []);

  useEffect(() => { refreshCore(); refreshPartials(); const timer = setInterval(refreshCore, 3000); return () => clearInterval(timer); }, [refreshCore, refreshPartials]);

  useEffect(() => {
    let stopped = false;
    let timer = null;
    const poll = async () => {
      try {
        const next = await jsonFetch("/api/work-model/download-status");
        if (stopped) return;
        setDownload(next);
        if (!next.active && (next.complete || next.error)) {
          await refreshCore();
          await refreshPartials();
          setBusyModel("");
        }
      } catch (_) {}
      if (!stopped) timer = setTimeout(poll, 650);
    };
    poll();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [refreshCore, refreshPartials]);

  const loadModel = useCallback(async (model) => {
    const minRam = Number(model.minRamGb || 0);
    if (ram > 0 && minRam > 0 && ram < minRam) {
      setError(`${model.shortName || model.name} needs ${model.ramLabel || `${minRam} GB+`}. This machine reports ${ram.toFixed(0)} GB.`);
      return;
    }
    setBusyModel(model.filename);
    setError("");
    localStorage.setItem("work-coding-model", model.filename);
    try {
      await startLlm(model.filename, {
        contextSize: Number(model.contextSize || 4096),
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
      await refreshCore();
      window.dispatchEvent(new CustomEvent("uls-work-coder-model-changed", { detail: { filename: model.filename } }));
    } catch (err) { setError(err.message || String(err)); }
    finally { setBusyModel(""); }
  }, [ram, specs, refreshCore]);

  useEffect(() => {
    if (!download.complete || !download.filename || autoLoadedRef.current === download.filename) return;
    const selected = CODING_MODELS.find((m) => sameFilename(m.filename, download.filename) && sameFilename(localStorage.getItem("work-coding-model") || "", m.filename));
    if (!selected) return;
    autoLoadedRef.current = download.filename;
    loadModel(selected);
  }, [download.complete, download.filename, loadModel]);

  useEffect(() => {
    let cancelled = false;
    async function loadMemory() {
      if (!memoryId) { setMemoryText(""); setMemorySavedText(""); return; }
      setMemoryBusy(true);
      try {
        const conversations = await listLlmConversations();
        const memory = (conversations || []).find((item) => item.id === memoryId);
        const text = String(memory?.messages?.[0]?.content || "");
        if (!cancelled) { setMemoryText(text); setMemorySavedText(text); }
      } catch (err) { if (!cancelled) setError(err.message || String(err)); }
      finally { if (!cancelled) setMemoryBusy(false); }
    }
    loadMemory();
    return () => { cancelled = true; };
  }, [memoryId]);

  const startDownload = async (model) => {
    setError("");
    setBusyModel(model.filename);
    localStorage.setItem("work-coding-model", model.filename);
    try {
      await jsonFetch("/api/work-model/start-download", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: model.url, filename: model.filename }) });
    } catch (err) { setBusyModel(""); setError(err.message || String(err)); }
  };

  const pauseDownload = async () => {
    try { await jsonFetch("/api/work-model/cancel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ removePartial: false }) }); await refreshPartials(); }
    catch (err) { setError(err.message || String(err)); }
  };

  const stopActive = async () => {
    try { await stopLlm(); await refreshCore(); window.dispatchEvent(new CustomEvent("uls-work-coder-model-changed", { detail: { filename: "" } })); }
    catch (err) { setError(err.message || String(err)); }
  };

  const saveMemory = async () => {
    if (!memoryId || !project.connected) return;
    setMemoryBusy(true); setError("");
    try {
      await saveLlmConversation({ id: memoryId, title: `Work Memory: ${project.name || "Project"}`, model: "work-project-memory", timestamp: Date.now(), projectPath: project.path, kind: "work-memory", messages: [{ role: "system", content: memoryText }] });
      setMemorySavedText(memoryText);
      window.dispatchEvent(new CustomEvent("uls-work-memory-changed", { detail: { projectPath: project.path } }));
    } catch (err) { setError(err.message || String(err)); }
    finally { setMemoryBusy(false); }
  };

  const known = new Set(CODING_MODELS.map((m) => m.filename.toLowerCase()));
  const otherModels = localModels.filter((m) => !known.has(shortFilename(m.filename || m.name).toLowerCase()) && !m.isProjector);

  return <div style={{ position: "absolute", top: 122, right: 16, width: "min(560px, calc(100% - 32px))", maxHeight: "calc(100% - 144px)", overflow: "auto", zIndex: 95, borderRadius: 16, border: "1px solid var(--md-sys-color-outline-variant,#343640)", background: "var(--md-sys-color-surface-container,#17181f)", color: "var(--md-sys-color-on-surface,#f4f4f7)", boxShadow: "0 24px 70px rgba(0,0,0,.38)" }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 15px", borderBottom: "1px solid var(--md-sys-color-outline-variant,#343640)", position: "sticky", top: 0, zIndex: 2, background: "inherit" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 9 }}><BrainCircuit size={19}/><div><div style={{ fontWeight: 750, fontSize: 14 }}>Work Model Manager</div><div style={{ opacity: .62, fontSize: 11 }}>Coding GGUFs • resumable USB downloads • local load/unload</div></div></div>
      <button onClick={onClose} style={{ border: 0, background: "transparent", color: "inherit", cursor: "pointer" }}><X size={18}/></button>
    </div>

    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", borderBottom: "1px solid var(--md-sys-color-outline-variant,#343640)" }}>
      <button onClick={() => setSection("models")} style={{ padding: 11, border: 0, borderBottom: section === "models" ? "2px solid var(--md-sys-color-primary,#8d88ff)" : "2px solid transparent", background: "transparent", color: "inherit", fontWeight: section === "models" ? 700 : 500, cursor: "pointer" }}>Coding Models</button>
      <button onClick={() => setSection("memory")} style={{ padding: 11, border: 0, borderBottom: section === "memory" ? "2px solid var(--md-sys-color-primary,#8d88ff)" : "2px solid transparent", background: "transparent", color: "inherit", fontWeight: section === "memory" ? 700 : 500, cursor: "pointer" }}>Project Memory</button>
    </div>

    {error && <div style={{ margin: 12, padding: 10, borderRadius: 9, background: "rgba(220,70,70,.12)", border: "1px solid rgba(220,70,70,.28)", fontSize: 11.5 }}>{error}</div>}

    {section === "models" ? <div style={{ padding: 12, display: "grid", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 11.5, opacity: .72 }}><span>{ram ? `${ram.toFixed(0)} GB system memory detected` : "Checking memory…"}</span><button onClick={() => { refreshCore(); refreshPartials(); }} style={{ border: 0, background: "transparent", color: "inherit", cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}><RefreshCw size={13}/> Refresh</button></div>

      {download.active && <div style={{ padding: 11, borderRadius: 11, border: "1px solid var(--md-sys-color-primary,#8d88ff)", background: "rgba(141,136,255,.08)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}><strong style={{ fontSize: 12 }}>Downloading {shortFilename(download.filename)}</strong><button onClick={pauseDownload} className="m3-btn m3-btn-outlined" style={{ padding: "6px 8px", display: "flex", gap: 5, alignItems: "center" }}><Pause size={12}/> Pause</button></div>
        <div style={{ height: 6, marginTop: 8, borderRadius: 999, overflow: "hidden", background: "rgba(255,255,255,.08)" }}><div style={{ height: "100%", width: `${Math.max(0, Math.min(100, Number(download.progress) || 0))}%`, background: "var(--md-sys-color-primary,#8d88ff)" }}/></div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5, fontSize: 10.5, opacity: .72 }}><span>{download.totalBytes ? `${formatBytes(download.downloadedBytes)} / ${formatBytes(download.totalBytes)}` : formatBytes(download.downloadedBytes)}</span><span>{download.speed || ""}{download.eta >= 0 ? ` • ${formatEta(download.eta)}` : ""}</span></div>
      </div>}

      {CODING_MODELS.map((model) => {
        const installedModel = localModels.find((m) => sameFilename(m.filename || m.name, model.filename));
        const installed = Boolean(installedModel);
        const active = llmStatus.ready && sameFilename(activeFilename, model.filename);
        const blocked = ram > 0 && ram < model.minRamGb;
        const partial = partials[model.filename]?.partial;
        const partialBytes = Number(partials[model.filename]?.partialBytes || 0);
        const thisDownload = download.active && sameFilename(download.filename, model.filename);
        const busy = busyModel === model.filename;
        return <div key={model.id} style={{ padding: 12, borderRadius: 12, border: active ? "1px solid #58d27d" : "1px solid var(--md-sys-color-outline-variant,#343640)", background: active ? "rgba(88,210,125,.06)" : "var(--md-sys-color-surface-container-low,#121319)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><div><div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}><span>{model.rank}</span><strong style={{ fontSize: 13 }}>{model.name}</strong>{model.recommended && <span style={{ fontSize: 9.5, padding: "2px 6px", borderRadius: 999, background: "var(--md-sys-color-primary-container,#302d58)" }}>Recommended</span>}{model.future && <span style={{ fontSize: 9.5, padding: "2px 6px", borderRadius: 999, border: "1px solid #444" }}>Future Mac</span>}</div><div style={{ marginTop: 5, fontSize: 10.5, opacity: .65 }}>{model.quant} • {model.approxSize} • {model.ramLabel}</div><div style={{ marginTop: 7, fontSize: 11.5, opacity: .72 }}>{model.description}</div></div><StatusDot active={active}/></div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 10 }}><div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, opacity: .7 }}><HardDrive size={12}/>{installed ? `On USB${installedModel?.size ? ` • ${installedModel.size}` : ""}` : partial ? `Partial on USB • ${formatBytes(partialBytes)}` : "Not downloaded"}</div><div style={{ display: "flex", gap: 7 }}>
            {!installed ? <button disabled={download.active && !thisDownload} onClick={() => startDownload(model)} className="m3-btn m3-btn-outlined" style={{ padding: "7px 9px", display: "flex", gap: 6, alignItems: "center" }}>{thisDownload || busy ? <Loader2 size={13}/> : <DownloadCloud size={13}/>} {partial ? "Resume" : "Download"}</button> : active ? <button onClick={stopActive} className="m3-btn m3-btn-outlined" style={{ padding: "7px 9px", display: "flex", gap: 6, alignItems: "center" }}><Square size={12}/> Stop</button> : <button disabled={blocked || busyModel} onClick={() => loadModel(model)} className="m3-btn m3-btn-filled" style={{ padding: "7px 9px", display: "flex", gap: 6, alignItems: "center", opacity: blocked ? .45 : 1 }}>{blocked ? <MemoryStick size={13}/> : busy ? <Loader2 size={13}/> : <Play size={13}/>} {blocked ? "More RAM needed" : "Load for Work"}</button>}
          </div></div>
        </div>;
      })}

      {otherModels.length > 0 && <div style={{ marginTop: 4 }}><div style={{ fontSize: 11, fontWeight: 700, marginBottom: 7 }}>Other installed GGUF models</div><div style={{ display: "grid", gap: 7 }}>{otherModels.map((model) => {
        const filename = shortFilename(model.filename || model.name); const active = llmStatus.ready && sameFilename(activeFilename, filename);
        return <div key={filename} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: 9, borderRadius: 9, border: "1px solid var(--md-sys-color-outline-variant,#343640)" }}><div style={{ minWidth: 0 }}><div style={{ fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{filename}</div><div style={{ fontSize: 10, opacity: .6 }}>{model.size || "GGUF on USB"}</div></div>{active ? <button onClick={stopActive} className="m3-btn m3-btn-outlined" style={{ padding: "6px 8px" }}>Stop</button> : <button onClick={() => loadModel({ filename, shortName: filename, minRamGb: 0, contextSize: 4096 })} className="m3-btn m3-btn-filled" style={{ padding: "6px 8px" }}>Load</button>}</div>;
      })}</div></div>}
    </div> : <div style={{ padding: 14 }}>{!project.connected ? <div style={{ fontSize: 12, opacity: .7 }}>Open a project first. Project Memory is isolated per project.</div> : <><div style={{ fontSize: 12, fontWeight: 700, marginBottom: 7 }}>USB-backed memory for {project.name}</div><textarea value={memoryText} onChange={(e) => setMemoryText(e.target.value)} rows={13} style={{ width: "100%", boxSizing: "border-box", border: "1px solid var(--md-sys-color-outline-variant,#343640)", borderRadius: 10, padding: 10, resize: "vertical", background: "var(--md-sys-color-surface-container-lowest,#0d0e12)", color: "inherit", font: "12px/1.5 ui-monospace,monospace" }}/><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}><span style={{ fontSize: 10.5, opacity: .6 }}>{memoryText === memorySavedText ? "Saved on USB" : "Unsaved memory changes"}</span><button disabled={memoryBusy || memoryText === memorySavedText} onClick={saveMemory} className="m3-btn m3-btn-filled" style={{ padding: "7px 9px", display: "flex", gap: 6, alignItems: "center" }}>{memoryBusy ? <Loader2 size={13}/> : memoryText === memorySavedText ? <Check size={13}/> : <Save size={13}/>} Save Memory</button></div></>}</div>}
  </div>;
}

export default function WorkCodingModelsIntegration() {
  const [host, setHost] = useState(null);
  const [workOpen, setWorkOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [status, setStatus] = useState({ ready: false, settings: {} });

  useEffect(() => {
    let timer = null;
    const attach = () => {
      const nextHost = document.getElementById("local-work-main-host");
      if (!nextHost) return false;
      setHost(nextHost);
      setWorkOpen(nextHost.dataset.workOpen === "true");
      return true;
    };
    if (!attach()) timer = setInterval(() => { if (attach()) { clearInterval(timer); timer = null; } }, 180);
    const handler = (event) => { setWorkOpen(Boolean(event.detail?.open)); if (!event.detail?.open) setPanelOpen(false); };
    window.addEventListener("uls-work-open-changed", handler);
    return () => { if (timer) clearInterval(timer); window.removeEventListener("uls-work-open-changed", handler); };
  }, []);

  useEffect(() => {
    if (!workOpen) return undefined;
    const refresh = () => getLlmStatus().then(setStatus).catch(() => {});
    refresh(); const timer = setInterval(refresh, 2500);
    window.addEventListener("uls-work-coder-model-changed", refresh);
    return () => { clearInterval(timer); window.removeEventListener("uls-work-coder-model-changed", refresh); };
  }, [workOpen]);

  if (!host || !workOpen) return null;
  const activeFilename = shortFilename(status?.settings?.model || "");
  const selected = CODING_MODELS.find((m) => sameFilename(m.filename, localStorage.getItem("work-coding-model") || ""));
  const active = CODING_MODELS.find((m) => sameFilename(m.filename, activeFilename));
  const label = status.ready ? (active?.shortName || activeFilename || "Local model") : (selected?.shortName || "Work Model Manager");

  return createPortal(<><button onClick={() => setPanelOpen((v) => !v)} title="Manage coding models for Work" style={{ position: "absolute", top: 78, right: 108, zIndex: 90, height: 34, maxWidth: 250, display: "flex", alignItems: "center", gap: 7, padding: "0 10px", borderRadius: 9, border: "1px solid var(--md-sys-color-outline-variant,#343640)", background: "var(--md-sys-color-surface-container-low,#15161c)", color: "inherit", cursor: "pointer", fontSize: 11.5 }}><StatusDot active={Boolean(status.ready)}/><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span><ChevronDown size={13}/></button>{panelOpen && <WorkCodingModelsPanel onClose={() => setPanelOpen(false)}/>}</>, host);
}
