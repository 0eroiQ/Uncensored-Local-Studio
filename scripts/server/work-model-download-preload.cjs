const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const LLM_MODELS = path.join(ROOT, "app", "llm-models");
fs.mkdirSync(LLM_MODELS, { recursive: true });

let active = null;
let state = {
  active: false,
  kind: "text",
  filename: "",
  progress: 0,
  speed: "",
  eta: 0,
  totalBytes: 0,
  downloadedBytes: 0,
  resumedBytes: 0,
  error: "",
  complete: false,
};

function sendJson(res, code, payload) {
  if (res.writableEnded) return;
  const body = JSON.stringify(payload);
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1024 * 1024) {
        reject(new Error("Request body is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); }
      catch (_) { reject(new Error("Invalid JSON request.")); }
    });
    req.on("error", reject);
  });
}

function safeFilename(value) {
  const name = path.basename(String(value || "").trim());
  if (!name || !/\.gguf$/i.test(name)) throw new Error("A .gguf filename is required.");
  return name;
}

function resetForStart(filename, resumedBytes) {
  state = {
    active: true,
    kind: "text",
    filename,
    progress: resumedBytes > 0 ? -1 : 0,
    speed: resumedBytes > 0 ? "Resuming…" : "Connecting…",
    eta: -1,
    totalBytes: 0,
    downloadedBytes: resumedBytes,
    resumedBytes,
    error: "",
    complete: false,
  };
}

function finishError(message, keepPartial = true) {
  const current = active;
  active = null;
  state.active = false;
  state.complete = false;
  state.error = message;
  state.speed = "Stopped";
  try { current?.response?.destroy(); } catch (_) {}
  try { current?.request?.destroy(); } catch (_) {}
  try { current?.stream?.destroy(); } catch (_) {}
  if (!keepPartial && current?.partPath) {
    try { fs.unlinkSync(current.partPath); } catch (_) {}
  }
}

function download(url, filename, redirects = 0) {
  if (redirects > 10) {
    finishError("Too many redirects while downloading the model.");
    return;
  }

  const destPath = path.join(LLM_MODELS, filename);
  const partPath = `${destPath}.part`;
  let existingBytes = 0;
  try { existingBytes = fs.statSync(partPath).size; } catch (_) {}
  if (redirects === 0) resetForStart(filename, existingBytes);

  const headers = {
    "User-Agent": "Uncensored-Local-Studio-Work/1.0",
    "Accept": "application/octet-stream,*/*",
    "Referer": "https://huggingface.co/",
  };
  if (existingBytes > 0) headers.Range = `bytes=${existingBytes}-`;

  const client = url.startsWith("https:") ? https : http;
  const req = client.get(url, { headers, timeout: 30000 }, (res) => {
    if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
      const location = res.headers.location;
      res.resume();
      if (!location) {
        finishError("Download redirect did not include a destination URL.");
        return;
      }
      state.speed = "Following redirect…";
      download(new URL(location, url).toString(), filename, redirects + 1);
      return;
    }

    if (![200, 206].includes(res.statusCode)) {
      res.resume();
      finishError(`Model download failed (HTTP ${res.statusCode}).`);
      return;
    }

    const rangeAccepted = res.statusCode === 206 && existingBytes > 0;
    const baseBytes = rangeAccepted ? existingBytes : 0;
    if (existingBytes > 0 && !rangeAccepted) {
      try { fs.truncateSync(partPath, 0); } catch (_) {}
      state.resumedBytes = 0;
      state.downloadedBytes = 0;
    }

    const remaining = Number(res.headers["content-length"] || 0);
    const totalBytes = remaining > 0 ? baseBytes + remaining : 0;
    state.totalBytes = totalBytes;
    state.downloadedBytes = baseBytes;
    state.progress = totalBytes > 0 ? Math.round((baseBytes / totalBytes) * 100) : -1;
    state.speed = rangeAccepted ? "Resumed" : "Downloading…";

    const stream = fs.createWriteStream(partPath, { flags: rangeAccepted ? "a" : "w" });
    let downloaded = baseBytes;
    let lastBytes = downloaded;
    let lastAt = Date.now();

    active = { request: req, response: res, stream, partPath, destPath };

    stream.on("error", (err) => finishError(`Could not write model to USB: ${err.message}`));
    res.on("data", (chunk) => {
      downloaded += chunk.length;
      state.downloadedBytes = downloaded;
      stream.write(chunk);
      const now = Date.now();
      const elapsed = (now - lastAt) / 1000;
      if (elapsed >= 0.5) {
        const bytesPerSecond = (downloaded - lastBytes) / elapsed;
        lastBytes = downloaded;
        lastAt = now;
        state.speed = `${(bytesPerSecond / (1024 * 1024)).toFixed(1)} MB/s`;
        if (totalBytes > 0) {
          state.progress = Math.min(100, Math.round((downloaded / totalBytes) * 100));
          state.eta = bytesPerSecond > 0 ? Math.round((totalBytes - downloaded) / bytesPerSecond) : -1;
        }
      }
    });
    res.on("aborted", () => finishError("Download interrupted. Press Resume to continue from the partial file."));
    res.on("error", (err) => finishError(`Download interrupted: ${err.message}. Press Resume to continue.`));
    res.on("end", () => {
      stream.end(() => {
        if (!active) return;
        try {
          const written = fs.statSync(partPath).size;
          if (totalBytes > 0 && written !== totalBytes) {
            finishError(`Download incomplete: ${written} of ${totalBytes} bytes. Press Resume to continue.`);
            return;
          }
          try { fs.unlinkSync(destPath); } catch (_) {}
          fs.renameSync(partPath, destPath);
          active = null;
          state.active = false;
          state.complete = true;
          state.error = "";
          state.progress = 100;
          state.downloadedBytes = written;
          state.totalBytes = totalBytes || written;
          state.speed = "Complete";
          state.eta = 0;
        } catch (err) {
          finishError(`Could not finalize model download: ${err.message}`);
        }
      });
    });
  });

  req.on("timeout", () => req.destroy(new Error("Download connection timed out.")));
  req.on("error", (err) => finishError(`${err.message}. Press Resume to continue.`));
  active = { ...(active || {}), request: req, partPath, destPath };
}

function cancel(removePartial = false) {
  const current = active;
  try { current?.response?.destroy(); } catch (_) {}
  try { current?.request?.destroy(); } catch (_) {}
  try { current?.stream?.destroy(); } catch (_) {}
  if (removePartial && current?.partPath) {
    try { fs.unlinkSync(current.partPath); } catch (_) {}
  }
  active = null;
  state.active = false;
  state.complete = false;
  state.error = removePartial ? "Download cancelled and partial file deleted." : "Download paused. Press Resume to continue.";
  state.speed = "Paused";
  return state;
}

function partialInfo(filename) {
  const safe = safeFilename(filename);
  const partPath = path.join(LLM_MODELS, `${safe}.part`);
  let bytes = 0;
  try { bytes = fs.statSync(partPath).size; } catch (_) {}
  return { filename: safe, partial: bytes > 0, partialBytes: bytes };
}

async function handle(req, res) {
  if (!req.url || !req.url.startsWith("/api/work-model/")) return false;
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
      return true;
    }
    const parsed = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (parsed.pathname === "/api/work-model/download-status" && req.method === "GET") {
      sendJson(res, 200, { ok: true, ...state });
      return true;
    }
    if (parsed.pathname === "/api/work-model/partial" && req.method === "GET") {
      sendJson(res, 200, { ok: true, ...partialInfo(parsed.searchParams.get("filename") || "") });
      return true;
    }
    if (parsed.pathname === "/api/work-model/start-download" && req.method === "POST") {
      if (state.active || active) throw new Error("A Work coding model download is already active.");
      const body = await readBody(req);
      const filename = safeFilename(body.filename);
      const url = String(body.url || "").trim();
      if (!/^https?:\/\//i.test(url)) throw new Error("A valid model download URL is required.");
      download(url, filename, 0);
      sendJson(res, 202, { ok: true, started: true, ...state });
      return true;
    }
    if (parsed.pathname === "/api/work-model/cancel" && req.method === "POST") {
      const body = await readBody(req).catch(() => ({}));
      sendJson(res, 200, { ok: true, ...cancel(body.removePartial === true) });
      return true;
    }
    sendJson(res, 404, { ok: false, error: "Unknown Work model endpoint." });
    return true;
  } catch (err) {
    sendJson(res, 400, { ok: false, error: err.message || String(err) });
    return true;
  }
}

const previousCreateServer = http.createServer;
http.createServer = function workModelCreateServer(options, listener) {
  let actualOptions = options;
  let actualListener = listener;
  if (typeof options === "function") {
    actualListener = options;
    actualOptions = undefined;
  }
  const wrapped = async (req, res) => {
    if (req.url && req.url.startsWith("/api/work-model/")) {
      await handle(req, res);
      return;
    }
    return actualListener(req, res);
  };
  return actualOptions === undefined
    ? previousCreateServer.call(http, wrapped)
    : previousCreateServer.call(http, actualOptions, wrapped);
};
