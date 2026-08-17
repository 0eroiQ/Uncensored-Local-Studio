import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { DownloadCloud, Loader2, X } from "lucide-react";
import { cancelModelDownload, formatBytes, getDownloadProgress } from "../services/api";

function formatEta(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value < 0) return "Calculating…";
  if (value < 60) return `${Math.max(0, Math.round(value))}s remaining`;
  const minutes = Math.floor(value / 60);
  const secs = Math.round(value % 60);
  if (minutes < 60) return `${minutes}m ${secs}s remaining`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m remaining`;
}

function shortName(filename = "") {
  const lower = String(filename).toLowerCase();
  if (lower.includes("qwen2.5-coder-14b")) return "Qwen2.5 Coder 14B";
  if (lower.includes("qwen3-coder-30b")) return "Qwen3 Coder 30B";
  if (lower.includes("qwen3-8b")) return "Qwen3 8B";
  return filename || "Local coding model";
}

export default function WorkDownloadMonitor() {
  const [host, setHost] = useState(null);
  const [workOpen, setWorkOpen] = useState(false);
  const [state, setState] = useState({ active: false });
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    let observer = null;
    let stopped = false;
    const attach = () => {
      const nextHost = document.getElementById("local-work-main-host");
      if (!nextHost) return false;
      setHost(nextHost);
      setWorkOpen(nextHost.childElementCount > 0);
      observer = new MutationObserver(() => setWorkOpen(nextHost.childElementCount > 0));
      observer.observe(nextHost, { childList: true, subtree: false });
      return true;
    };
    if (!attach()) {
      const timer = setInterval(() => {
        if (attach()) clearInterval(timer);
      }, 200);
      return () => {
        stopped = true;
        clearInterval(timer);
        observer?.disconnect();
      };
    }
    return () => {
      stopped = true;
      observer?.disconnect();
    };
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer = null;
    const poll = async () => {
      try {
        const next = await getDownloadProgress();
        if (!stopped) setState(next || { active: false });
      } catch (_) {}
      if (!stopped) timer = setTimeout(poll, state?.active ? 600 : 1600);
    };
    poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [workOpen]);

  const isTextDownload = state?.kind === "text" || /\.gguf(?:\.part)?$/i.test(String(state?.filename || ""));
  const visible = Boolean(host && workOpen && isTextDownload && (state?.active || state?.error));

  const progress = Number(state?.progress);
  const determinate = Number.isFinite(progress) && progress >= 0;
  const percent = determinate ? Math.max(0, Math.min(100, progress)) : 0;
  const downloaded = Number(state?.downloadedBytes || 0);
  const total = Number(state?.totalBytes || 0);
  const sizeLabel = total > 0
    ? `${formatBytes(downloaded)} / ${formatBytes(total)}`
    : downloaded > 0 ? formatBytes(downloaded) : "Preparing download…";
  const modelName = useMemo(() => shortName(state?.filename), [state?.filename]);

  const cancel = async () => {
    setCancelling(true);
    try {
      await cancelModelDownload();
      const next = await getDownloadProgress();
      setState(next || { active: false });
    } finally {
      setCancelling(false);
    }
  };

  if (!visible) return null;

  return createPortal(
    <div style={{
      position: "absolute",
      top: 126,
      left: "50%",
      transform: "translateX(-50%)",
      width: "min(560px, calc(100% - 620px))",
      minWidth: 360,
      zIndex: 92,
      padding: "12px 13px",
      borderRadius: 12,
      border: "1px solid var(--md-sys-color-outline-variant, #343640)",
      background: "var(--md-sys-color-surface-container-high, #202129)",
      color: "var(--md-sys-color-on-surface, #f4f4f7)",
      boxShadow: "0 12px 34px rgba(0,0,0,.32)",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          {state.active ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite", flex: "0 0 auto" }} /> : <DownloadCloud size={16} />}
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 750, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {state.active ? `Downloading ${modelName}` : state.error ? "Model download stopped" : modelName}
            </div>
            <div style={{ marginTop: 2, fontSize: 10.5, opacity: .68, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {state.error || `${sizeLabel}${state.speed ? ` • ${state.speed}` : ""}${state.active ? ` • ${formatEta(state.eta)}` : ""}`}
            </div>
          </div>
        </div>
        {state.active && (
          <button onClick={cancel} disabled={cancelling} title="Cancel model download" style={{
            flex: "0 0 auto",
            display: "flex",
            alignItems: "center",
            gap: 5,
            border: "1px solid var(--md-sys-color-outline-variant, #343640)",
            borderRadius: 8,
            padding: "6px 8px",
            background: "transparent",
            color: "inherit",
            cursor: cancelling ? "default" : "pointer",
            opacity: cancelling ? .5 : .85,
            fontSize: 10.5,
          }}><X size={12} /> {cancelling ? "Cancelling…" : "Cancel"}</button>
        )}
      </div>

      {state.active && (
        <div style={{ marginTop: 9 }}>
          <div style={{ height: 6, overflow: "hidden", borderRadius: 999, background: "rgba(255,255,255,.09)" }}>
            <div style={{
              height: "100%",
              width: determinate ? `${percent}%` : "35%",
              borderRadius: 999,
              background: "var(--md-sys-color-primary, #8d88ff)",
              transition: "width .35s ease",
              animation: determinate ? "none" : "uls-download-slide 1.1s ease-in-out infinite alternate",
            }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5, fontSize: 10.5, opacity: .72 }}>
            <span>{determinate ? `${percent}%` : "Downloading…"}</span>
            <span>Saved directly to USB</span>
          </div>
        </div>
      )}
      <style>{`@keyframes uls-download-slide { from { transform: translateX(-40%); } to { transform: translateX(190%); } }`}</style>
    </div>,
    host,
  );
}
