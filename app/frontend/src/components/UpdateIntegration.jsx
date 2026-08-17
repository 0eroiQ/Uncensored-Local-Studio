import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, DownloadCloud, RefreshCw, RotateCcw, Usb, AlertTriangle, Loader2 } from "lucide-react";

async function readJson(res) {
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text || "{}"); } catch (_) {}
  if (!res.ok || data.ok === false) throw new Error(data.error || `Request failed (HTTP ${res.status})`);
  return data;
}

async function getUpdateStatus() {
  return readJson(await fetch("/api/update/status", { cache: "no-store" }));
}

async function postUpdate(path) {
  return readJson(await fetch(path, { method: "POST" }));
}

function UpdateCard() {
  const [status, setStatus] = useState(null);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const refresh = async () => {
    setChecking(true);
    setError("");
    try {
      setStatus(await getUpdateStatus());
    } catch (err) {
      setStatus(null);
      setError(err.message || String(err));
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const apply = async () => {
    setBusy(true);
    setError("");
    setMessage("Downloading and installing the latest verified GitHub version...");
    try {
      await postUpdate("/api/update/apply");
      setMessage("Update complete. Restart Local AI Studio to load the new version.");
      await refresh();
    } catch (err) {
      setError(err.message || String(err));
      setMessage("");
    } finally {
      setBusy(false);
    }
  };

  const rollback = async () => {
    setBusy(true);
    setError("");
    setMessage("Restoring the previous application version...");
    try {
      await postUpdate("/api/update/rollback");
      setMessage("Rollback complete. Restart Local AI Studio to load the restored version.");
      await refresh();
    } catch (err) {
      setError(err.message || String(err));
      setMessage("");
    } finally {
      setBusy(false);
    }
  };

  const restart = async () => {
    setBusy(true);
    setError("");
    setMessage("Restarting Local AI Studio...");
    try {
      await postUpdate("/api/update/restart");
      setTimeout(() => {
        const tryReload = () => fetch("/api/health", { cache: "no-store" })
          .then((res) => res.ok && window.location.reload())
          .catch(() => {});
        setInterval(tryReload, 1200);
      }, 1500);
    } catch (err) {
      setBusy(false);
      setError(err.message || String(err));
    }
  };

  const installed = status?.installedShort || "unknown";
  const latest = status?.latestShort || "unknown";
  const verified = Boolean(status?.remoteVerified);
  const updateAvailable = verified && Boolean(status?.updateAvailable);
  const restartRequired = Boolean(status?.progress?.restartRequired);

  let stateTitle = "Checking for updates";
  let stateText = "Verifying the latest commit on GitHub...";
  let StateIcon = Loader2;

  if (!checking) {
    if (restartRequired) {
      stateTitle = "Restart required";
      stateText = "The latest files are installed on the USB. Restart to load them.";
      StateIcon = RefreshCw;
    } else if (!status || !verified) {
      stateTitle = "Unable to verify updates";
      stateText = "The updater could not confirm the latest GitHub commit. Your installed files are unchanged. Try Check for Updates again when GitHub is reachable.";
      StateIcon = AlertTriangle;
    } else if (updateAvailable) {
      stateTitle = "New version available";
      stateText = "Update Now downloads the exact verified commit, creates a rollback backup, preserves your local models and runtime folders, and rebuilds the interface on the USB.";
      StateIcon = DownloadCloud;
    } else {
      stateTitle = "You're up to date";
      stateText = "This USB installation matches the latest GitHub commit verified by the updater.";
      StateIcon = CheckCircle2;
    }
  }

  return (
    <div style={{ marginTop: 18, marginBottom: 26 }}>
      <div className="settings-section-header" style={{ borderLeftColor: "#8b5cf6", cursor: "default" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div className="settings-section-icon" style={{ background: "#8b5cf615", color: "#8b5cf6" }}>
            <DownloadCloud size={22} />
          </div>
          <div>
            <div className="settings-section-title">Updates</div>
            <div style={{ fontSize: ".82rem", opacity: .7, marginTop: 3 }}>Update the USB installation directly from your GitHub main branch.</div>
          </div>
        </div>
      </div>

      <div className="settings-expanded-content">
        <div className="settings-subsection">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
            <div className="m3-field-group" style={{ padding: 14 }}>
              <div style={{ fontSize: 12, opacity: .65, marginBottom: 6 }}>Repository</div>
              <div style={{ fontWeight: 650 }}>0eroiQ/Uncensored-Local-Studio</div>
              <div style={{ fontSize: 12, opacity: .65, marginTop: 5 }}>Branch: main</div>
            </div>
            <div className="m3-field-group" style={{ padding: 14 }}>
              <div style={{ fontSize: 12, opacity: .65, marginBottom: 6 }}>Installed</div>
              <div style={{ fontFamily: "monospace", fontWeight: 700 }}>{installed}</div>
            </div>
            <div className="m3-field-group" style={{ padding: 14 }}>
              <div style={{ fontSize: 12, opacity: .65, marginBottom: 6 }}>Latest</div>
              <div style={{ fontFamily: "monospace", fontWeight: 700 }}>{latest}</div>
            </div>
          </div>

          <div style={{ marginTop: 14, padding: 14, borderRadius: 12, border: "1px solid var(--border-color)", display: "flex", gap: 10, alignItems: "flex-start" }}>
            <StateIcon size={18} style={checking ? { animation: "spin 1s linear infinite" } : undefined} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 650 }}>{stateTitle}</div>
              <div style={{ opacity: .72, fontSize: 13, marginTop: 3, lineHeight: 1.45 }}>{stateText}</div>
            </div>
          </div>

          {status?.latestMessage && (
            <div style={{ marginTop: 10, fontSize: 12, opacity: .7 }}>
              Latest commit: {String(status.latestMessage).split("\n")[0]}
            </div>
          )}

          {status?.remoteWarning && (
            <div style={{ marginTop: 10, padding: 10, borderRadius: 10, border: "1px solid var(--border-color)", fontSize: 12, opacity: .82 }}>
              GitHub API was unavailable, but the updater successfully verified main using the Git fallback.
            </div>
          )}

          {status?.remoteError && !verified && (
            <div style={{ marginTop: 12, padding: 12, borderRadius: 10, border: "1px solid color-mix(in srgb, #f59e0b 45%, transparent)", display: "flex", gap: 8 }}>
              <AlertTriangle size={17} style={{ flexShrink: 0 }} />
              <span style={{ fontSize: 13 }}>{status.remoteError}</span>
            </div>
          )}

          {message && <div style={{ marginTop: 12, fontSize: 13 }}>{message}</div>}
          {error && (
            <div style={{ marginTop: 12, padding: 12, borderRadius: 10, border: "1px solid color-mix(in srgb, #ef4444 45%, transparent)", display: "flex", gap: 8 }}>
              <AlertTriangle size={17} style={{ flexShrink: 0 }} />
              <span style={{ fontSize: 13 }}>{error}</span>
            </div>
          )}

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
            <button className="m3-btn m3-btn-outlined" onClick={refresh} disabled={busy || checking}>
              <RefreshCw size={16} /> {checking ? "Checking..." : "Check for Updates"}
            </button>
            {!restartRequired && (
              <button className="m3-btn m3-btn-filled" onClick={apply} disabled={busy || checking || !verified || !updateAvailable}>
                <DownloadCloud size={16} /> {busy ? "Updating..." : "Update Now"}
              </button>
            )}
            {restartRequired && (
              <button className="m3-btn m3-btn-filled" onClick={restart} disabled={busy}>
                <RefreshCw size={16} /> Restart Now
              </button>
            )}
            <button className="m3-btn m3-btn-outlined" onClick={rollback} disabled={busy || !status?.rollbackAvailable}>
              <RotateCcw size={16} /> Roll Back
            </button>
          </div>

          <div style={{ marginTop: 15, display: "flex", gap: 8, alignItems: "center", fontSize: 12, opacity: .72 }}>
            <Usb size={15} /> Models, generated outputs, chat history, downloaded backends, Work memory, and local AI runtimes stay on the USB and are not replaced by normal source updates.
          </div>
        </div>
      </div>
    </div>
  );
}

export default function UpdateIntegration() {
  const [mount, setMount] = useState(null);

  useEffect(() => {
    let stopped = false;
    const locate = () => {
      const workspaces = [...document.querySelectorAll(".workspace-area")];
      const settings = workspaces.find((node) => node.querySelector(".workspace-title")?.textContent?.includes("Settings"));
      if (!settings) return false;
      let host = settings.querySelector("#local-update-settings-host");
      if (!host) {
        host = document.createElement("div");
        host.id = "local-update-settings-host";
        settings.appendChild(host);
      }
      if (!stopped) setMount(host);
      return true;
    };
    if (!locate()) {
      const timer = setInterval(() => { if (locate()) clearInterval(timer); }, 120);
      return () => { stopped = true; clearInterval(timer); };
    }
    return () => { stopped = true; };
  }, []);

  return mount ? createPortal(<UpdateCard />, mount) : null;
}
