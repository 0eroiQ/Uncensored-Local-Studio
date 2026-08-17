const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { spawnSync, execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const UPDATE_DIR = path.join(ROOT, ".update");
const BACKUP_DIR = path.join(ROOT, ".backup", "latest");
const STATE_DIR = path.join(ROOT, "app", "config");
const STATE_FILE = path.join(STATE_DIR, "update-state.json");
const REPO = "0eroiQ/Uncensored-Local-Studio";
const BRANCH = "main";
const API_COMMIT_URL = `https://api.github.com/repos/${REPO}/commits/${BRANCH}`;
const ZIP_URL = `https://codeload.github.com/${REPO}/zip/refs/heads/${BRANCH}`;

let busy = false;
let progress = { active: false, phase: "Idle", progress: 0, error: "", restartRequired: false };

function json(res, code, payload) {
  if (res.writableEnded) return;
  const body = JSON.stringify(payload);
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch (_) {
    return { installedSha: "", installedAt: "" };
  }
}

function writeState(next) {
  ensureDir(STATE_DIR);
  fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2), "utf8");
}

function shortSha(value) {
  return value ? String(value).slice(0, 8) : "unknown";
}

function fetchJson(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        "Accept": "application/vnd.github+json",
        "User-Agent": "Uncensored-Local-Studio-Updater",
      },
      timeout: 20000,
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        if (redirects > 8 || !res.headers.location) {
          res.resume();
          reject(new Error("Too many redirects while checking GitHub."));
          return;
        }
        const next = new URL(res.headers.location, url).toString();
        res.resume();
        fetchJson(next, redirects + 1).then(resolve, reject);
        return;
      }
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(body || "{}");
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(parsed.message || `GitHub returned HTTP ${res.statusCode}`));
            return;
          }
          resolve(parsed);
        } catch (err) {
          reject(new Error(`GitHub returned invalid JSON: ${err.message}`));
        }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("GitHub request timed out.")));
  });
}

function download(url, dest, redirects = 0) {
  return new Promise((resolve, reject) => {
    ensureDir(path.dirname(dest));
    const tmp = `${dest}.part`;
    try { fs.unlinkSync(tmp); } catch (_) {}
    const out = fs.createWriteStream(tmp);
    const req = https.get(url, {
      headers: { "User-Agent": "Uncensored-Local-Studio-Updater" },
      timeout: 120000,
    }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        out.close();
        try { fs.unlinkSync(tmp); } catch (_) {}
        if (redirects > 8 || !res.headers.location) {
          res.resume();
          reject(new Error("Too many redirects while downloading update."));
          return;
        }
        const next = new URL(res.headers.location, url).toString();
        res.resume();
        download(next, dest, redirects + 1).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        out.close();
        try { fs.unlinkSync(tmp); } catch (_) {}
        res.resume();
        reject(new Error(`Update download failed (HTTP ${res.statusCode}).`));
        return;
      }
      const total = Number(res.headers["content-length"] || 0);
      let received = 0;
      res.on("data", (chunk) => {
        received += chunk.length;
        if (total > 0) progress.progress = Math.max(5, Math.min(45, Math.round((received / total) * 40) + 5));
      });
      res.pipe(out);
      out.on("finish", () => {
        out.close(() => {
          fs.renameSync(tmp, dest);
          resolve(dest);
        });
      });
    });
    req.on("error", (err) => {
      out.destroy();
      try { fs.unlinkSync(tmp); } catch (_) {}
      reject(err);
    });
    req.on("timeout", () => req.destroy(new Error("Update download timed out.")));
  });
}

function copyPath(src, dst) {
  if (!fs.existsSync(src)) return;
  ensureDir(path.dirname(dst));
  fs.cpSync(src, dst, { recursive: true, force: true });
}

const SOURCE_PATHS = [
  ".gitattributes",
  ".gitignore",
  "LICENSE",
  "README.md",
  "package.json",
  "package-lock.json",
  "index.html",
  "vite.config.js",
  "mac.sh",
  "linux.sh",
  "windows.bat",
  "scripts",
  path.join("app", "frontend"),
];

function snapshotCurrentSource(metadata = {}) {
  fs.rmSync(BACKUP_DIR, { recursive: true, force: true });
  ensureDir(BACKUP_DIR);
  for (const rel of SOURCE_PATHS) copyPath(path.join(ROOT, rel), path.join(BACKUP_DIR, rel));
  fs.writeFileSync(path.join(BACKUP_DIR, "backup-meta.json"), JSON.stringify(metadata, null, 2), "utf8");
}

function restoreBackup() {
  if (!fs.existsSync(BACKUP_DIR)) throw new Error("No rollback backup is available.");
  for (const rel of SOURCE_PATHS) copyPath(path.join(BACKUP_DIR, rel), path.join(ROOT, rel));
}

function overlaySource(sourceRoot) {
  for (const rel of SOURCE_PATHS) copyPath(path.join(sourceRoot, rel), path.join(ROOT, rel));
}

function extractZip(zipPath, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  ensureDir(dest);
  if (process.platform === "darwin") {
    execFileSync("/usr/bin/ditto", ["-x", "-k", zipPath, dest], { stdio: "pipe" });
    return;
  }
  const unzip = spawnSync("unzip", ["-q", "-o", zipPath, "-d", dest], { encoding: "utf8" });
  if (unzip.status !== 0) throw new Error((unzip.stderr || unzip.stdout || "Could not extract update archive.").trim());
}

function findExtractedRoot(dest) {
  const dirs = fs.readdirSync(dest, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  if (dirs.length === 0) throw new Error("Update archive did not contain a source folder.");
  return path.join(dest, dirs[0].name);
}

function buildFrontend() {
  const frontend = path.join(ROOT, "app", "frontend");
  const nodeDir = process.platform === "darwin"
    ? path.join(ROOT, "app", "tools", "node-mac")
    : process.platform === "win32"
      ? path.join(ROOT, "app", "tools", "node-win")
      : path.join(ROOT, "app", "tools", "node-linux");
  const npm = process.platform === "win32" ? path.join(nodeDir, "npm.cmd") : path.join(nodeDir, "bin", "npm");
  if (!fs.existsSync(npm)) throw new Error("Portable npm is missing. Run the platform setup script first.");
  const env = { ...process.env, PATH: `${path.dirname(npm)}${path.delimiter}${process.env.PATH || ""}` };
  const result = spawnSync(npm, ["run", "build"], { cwd: frontend, env, encoding: "utf8", timeout: 10 * 60 * 1000 });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || "Frontend build failed.").trim().slice(-3000));
}

async function getStatus() {
  const state = readState();
  const latest = await fetchJson(API_COMMIT_URL);
  const latestSha = String(latest.sha || "");
  const installedSha = String(state.installedSha || "");
  return {
    ok: true,
    repo: REPO,
    branch: BRANCH,
    installedSha,
    installedShort: shortSha(installedSha),
    latestSha,
    latestShort: shortSha(latestSha),
    updateAvailable: !installedSha || installedSha !== latestSha,
    installedAt: state.installedAt || "",
    latestDate: latest.commit?.committer?.date || latest.commit?.author?.date || "",
    latestMessage: latest.commit?.message || "",
    rollbackAvailable: fs.existsSync(path.join(BACKUP_DIR, "backup-meta.json")),
    progress,
  };
}

async function applyUpdate() {
  if (busy) throw new Error("An update operation is already running.");
  busy = true;
  progress = { active: true, phase: "Checking GitHub...", progress: 2, error: "", restartRequired: false };
  const previous = readState();
  try {
    const latest = await fetchJson(API_COMMIT_URL);
    const latestSha = String(latest.sha || "");
    if (!latestSha) throw new Error("Could not determine the latest GitHub commit.");
    if (previous.installedSha === latestSha) {
      progress = { active: false, phase: "Already up to date", progress: 100, error: "", restartRequired: false };
      return { alreadyCurrent: true, latestSha };
    }

    fs.rmSync(UPDATE_DIR, { recursive: true, force: true });
    ensureDir(UPDATE_DIR);
    const zipPath = path.join(UPDATE_DIR, "latest.zip");
    const extractDir = path.join(UPDATE_DIR, "extract");

    progress.phase = "Downloading latest source...";
    progress.progress = 5;
    await download(ZIP_URL, zipPath);

    progress.phase = "Creating rollback backup...";
    progress.progress = 50;
    snapshotCurrentSource({ previousState: previous, createdAt: new Date().toISOString() });

    progress.phase = "Extracting update...";
    progress.progress = 58;
    extractZip(zipPath, extractDir);
    const sourceRoot = findExtractedRoot(extractDir);

    progress.phase = "Installing application files...";
    progress.progress = 68;
    overlaySource(sourceRoot);

    progress.phase = "Rebuilding interface on USB...";
    progress.progress = 82;
    try {
      buildFrontend();
    } catch (err) {
      progress.phase = "Build failed — restoring previous version...";
      restoreBackup();
      try { buildFrontend(); } catch (_) {}
      throw err;
    }

    writeState({ installedSha: latestSha, installedAt: new Date().toISOString(), repo: REPO, branch: BRANCH });
    progress = { active: false, phase: "Update complete", progress: 100, error: "", restartRequired: true };
    return { latestSha, restartRequired: true };
  } catch (err) {
    progress = { active: false, phase: "Update failed", progress: 0, error: err.message || String(err), restartRequired: false };
    throw err;
  } finally {
    busy = false;
  }
}

async function rollback() {
  if (busy) throw new Error("An update operation is already running.");
  busy = true;
  progress = { active: true, phase: "Restoring previous version...", progress: 20, error: "", restartRequired: false };
  try {
    const metaPath = path.join(BACKUP_DIR, "backup-meta.json");
    if (!fs.existsSync(metaPath)) throw new Error("No rollback backup is available.");
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    restoreBackup();
    progress.phase = "Rebuilding previous interface...";
    progress.progress = 75;
    buildFrontend();
    writeState(meta.previousState || { installedSha: "", installedAt: "" });
    progress = { active: false, phase: "Rollback complete", progress: 100, error: "", restartRequired: true };
    return { restartRequired: true };
  } catch (err) {
    progress = { active: false, phase: "Rollback failed", progress: 0, error: err.message || String(err), restartRequired: false };
    throw err;
  } finally {
    busy = false;
  }
}

async function handleUpdateRequest(req, res) {
  if (!req.url.startsWith("/api/update/")) return false;
  try {
    if (req.url === "/api/update/status" && req.method === "GET") {
      return json(res, 200, await getStatus()), true;
    }
    if (req.url === "/api/update/progress" && req.method === "GET") {
      return json(res, 200, { ok: true, progress }), true;
    }
    if (req.url === "/api/update/apply" && req.method === "POST") {
      const result = await applyUpdate();
      return json(res, 200, { ok: true, ...result, progress }), true;
    }
    if (req.url === "/api/update/rollback" && req.method === "POST") {
      const result = await rollback();
      return json(res, 200, { ok: true, ...result, progress }), true;
    }
    if (req.url === "/api/update/restart" && req.method === "POST") {
      json(res, 200, { ok: true, restarting: true });
      setTimeout(() => process.exit(75), 250);
      return true;
    }
    return json(res, 404, { ok: false, error: "Unknown update endpoint" }), true;
  } catch (err) {
    json(res, 500, { ok: false, error: err.message || String(err), progress });
    return true;
  }
}

const originalCreateServer = http.createServer;
http.createServer = function patchedCreateServer(options, listener) {
  let actualOptions = options;
  let actualListener = listener;
  if (typeof options === "function") {
    actualListener = options;
    actualOptions = undefined;
  }
  const wrapped = async (req, res) => {
    if (req.url && req.url.startsWith("/api/update/")) {
      await handleUpdateRequest(req, res);
      return;
    }
    return actualListener(req, res);
  };
  return actualOptions === undefined
    ? originalCreateServer.call(http, wrapped)
    : originalCreateServer.call(http, actualOptions, wrapped);
};
