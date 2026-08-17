const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const CONFIG_DIR = path.join(ROOT, "app", "config");
const STATE_FILE = path.join(CONFIG_DIR, "work-state.json");
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_FILE_BYTES = 4 * 1024 * 1024;
const HIDDEN_NAMES = new Set([
  ".DS_Store",
  ".git",
  ".idea",
  ".vscode",
  "node_modules",
  "node_modules_mac",
  "node_modules_windows",
  "node_modules_linux",
  "DerivedData",
]);

let projectRoot = "";

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
    return {};
  }
}

function writeState() {
  ensureDir(CONFIG_DIR);
  fs.writeFileSync(STATE_FILE, JSON.stringify({
    projectRoot,
    updatedAt: new Date().toISOString(),
  }, null, 2), "utf8");
}

function restoreSavedProject() {
  const saved = String(readState().projectRoot || "").trim();
  if (!saved) return;
  try {
    const real = fs.realpathSync(saved);
    if (fs.statSync(real).isDirectory()) projectRoot = real;
  } catch (_) {}
}
restoreSavedProject();

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch (_) {
        reject(new Error("Invalid JSON request."));
      }
    });
    req.on("error", reject);
  });
}

function registerProject(candidate) {
  const raw = String(candidate || "").trim();
  if (!raw) throw new Error("Choose a project folder first.");
  if (!fs.existsSync(raw)) throw new Error("That project folder does not exist.");
  const real = fs.realpathSync(raw);
  const stat = fs.statSync(real);
  if (!stat.isDirectory()) throw new Error("The selected project must be a folder.");
  if (real === path.parse(real).root) throw new Error("Choose a project folder, not an entire drive.");
  projectRoot = real;
  writeState();
  return getProjectInfo();
}

function getProjectInfo() {
  if (!projectRoot) return { connected: false, path: "", name: "", branch: "", changes: 0 };
  try {
    if (!fs.statSync(projectRoot).isDirectory()) throw new Error("missing");
  } catch (_) {
    projectRoot = "";
    writeState();
    return { connected: false, path: "", name: "", branch: "", changes: 0 };
  }
  const git = getGitInfo();
  return {
    connected: true,
    path: projectRoot,
    name: path.basename(projectRoot) || projectRoot,
    ...git,
  };
}

function requireProject() {
  if (!projectRoot) throw new Error("Open a project folder first.");
  return projectRoot;
}

function resolveInside(relativePath = "", mustExist = true) {
  const root = requireProject();
  const rel = String(relativePath || "").replace(/\\/g, "/");
  if (path.isAbsolute(rel)) throw new Error("Project file paths must be relative.");
  const target = path.resolve(root, rel);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error("Blocked path outside the selected project.");
  }
  if (!mustExist) return target;
  if (!fs.existsSync(target)) throw new Error("The requested project item no longer exists.");
  const realTarget = fs.realpathSync(target);
  if (realTarget !== root && !realTarget.startsWith(root + path.sep)) {
    throw new Error("Blocked symlink outside the selected project.");
  }
  return realTarget;
}

function relativeFromRoot(fullPath) {
  const rel = path.relative(requireProject(), fullPath);
  return rel.split(path.sep).join("/");
}

function listDirectory(relativePath = "") {
  const dir = resolveInside(relativePath, true);
  const stat = fs.statSync(dir);
  if (!stat.isDirectory()) throw new Error("Explorer path is not a folder.");

  const items = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (HIDDEN_NAMES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    let lst;
    try { lst = fs.lstatSync(full); } catch (_) { continue; }
    const rel = relativeFromRoot(full);
    if (lst.isSymbolicLink()) {
      items.push({ name: entry.name, path: rel, type: "symlink", size: lst.size });
      continue;
    }
    if (entry.isDirectory()) {
      items.push({ name: entry.name, path: rel, type: "folder", size: 0 });
      continue;
    }
    if (entry.isFile()) {
      items.push({ name: entry.name, path: rel, type: "file", size: lst.size });
    }
  }
  items.sort((a, b) => {
    if (a.type === "folder" && b.type !== "folder") return -1;
    if (b.type === "folder" && a.type !== "folder") return 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
  return items;
}

function looksBinary(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  for (const byte of sample) if (byte === 0) return true;
  return false;
}

function readProjectFile(relativePath) {
  const file = resolveInside(relativePath, true);
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error("Select a file to open.");
  if (stat.size > MAX_TEXT_FILE_BYTES) throw new Error("This file is too large for the built-in editor (4 MB limit).");
  const buffer = fs.readFileSync(file);
  if (looksBinary(buffer)) throw new Error("Binary files cannot be opened in the built-in editor.");
  return {
    path: relativeFromRoot(file),
    name: path.basename(file),
    content: buffer.toString("utf8"),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
  };
}

function saveProjectFile(relativePath, content, expectedMtimeMs) {
  const file = resolveInside(relativePath, true);
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error("Only existing files can be edited in this version of Work.");
  if (stat.size > MAX_TEXT_FILE_BYTES) throw new Error("This file is too large for the built-in editor.");
  const current = fs.readFileSync(file);
  if (looksBinary(current)) throw new Error("Binary files cannot be edited in Work.");
  const expected = Number(expectedMtimeMs || 0);
  if (expected > 0 && Math.abs(stat.mtimeMs - expected) > 1) {
    const err = new Error("This file changed on disk after you opened it. Reopen it before saving so external changes are not overwritten.");
    err.code = "FILE_CHANGED";
    throw err;
  }
  const text = String(content ?? "");
  if (Buffer.byteLength(text, "utf8") > MAX_TEXT_FILE_BYTES) throw new Error("Edited file exceeds the 4 MB editor limit.");
  const tmp = `${file}.uls-work-${process.pid}-${Date.now()}.tmp`;
  fs.writeFileSync(tmp, text, "utf8");
  try { fs.chmodSync(tmp, stat.mode); } catch (_) {}
  fs.renameSync(tmp, file);
  const next = fs.statSync(file);
  return { path: relativeFromRoot(file), size: next.size, mtimeMs: next.mtimeMs };
}

function getGitInfo() {
  if (!projectRoot) return { branch: "", changes: 0, git: false };
  try {
    const probe = spawnSync("git", ["-C", projectRoot, "rev-parse", "--show-toplevel"], { encoding: "utf8", timeout: 4000 });
    if (probe.status !== 0) return { branch: "", changes: 0, git: false };
    const branchResult = spawnSync("git", ["-C", projectRoot, "branch", "--show-current"], { encoding: "utf8", timeout: 4000 });
    const statusResult = spawnSync("git", ["-C", projectRoot, "status", "--porcelain", "-uno"], { encoding: "utf8", timeout: 5000 });
    const changes = String(statusResult.stdout || "").split(/\r?\n/).filter(Boolean).length;
    return {
      git: true,
      branch: String(branchResult.stdout || "").trim() || "detached",
      changes,
    };
  } catch (_) {
    return { branch: "", changes: 0, git: false };
  }
}

function chooseProjectNative() {
  if (process.platform === "darwin") {
    const script = 'POSIX path of (choose folder with prompt "Choose a project for Local AI Studio Work")';
    const result = spawnSync("/usr/bin/osascript", ["-e", script], { encoding: "utf8" });
    if (result.status !== 0) {
      if (/cancel/i.test(String(result.stderr || ""))) return { cancelled: true };
      throw new Error(String(result.stderr || "Could not open the macOS folder picker.").trim());
    }
    return { cancelled: false, path: String(result.stdout || "").trim().replace(/\/$/, "") };
  }

  if (process.platform === "win32") {
    const command = [
      "Add-Type -AssemblyName System.Windows.Forms;",
      "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog;",
      "$dialog.Description = 'Choose a project for Local AI Studio Work';",
      "if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }",
    ].join(" ");
    const result = spawnSync("powershell.exe", ["-NoProfile", "-STA", "-Command", command], { encoding: "utf8" });
    const selected = String(result.stdout || "").trim();
    return { cancelled: !selected, path: selected };
  }

  for (const candidate of [
    { cmd: "zenity", args: ["--file-selection", "--directory", "--title=Choose a project for Local AI Studio Work"] },
    { cmd: "kdialog", args: ["--getexistingdirectory", process.env.HOME || "/"] },
  ]) {
    const result = spawnSync(candidate.cmd, candidate.args, { encoding: "utf8" });
    const selected = String(result.stdout || "").trim();
    if (result.status === 0 && selected) return { cancelled: false, path: selected };
  }
  throw new Error("No native folder picker is available. Enter the project path manually.");
}

async function handleWorkRequest(req, res) {
  if (!req.url || !req.url.startsWith("/api/work/")) return false;
  try {
    const parsed = new URL(req.url, `http://${req.headers.host || "localhost"}`);

    if (parsed.pathname === "/api/work/status" && req.method === "GET") {
      json(res, 200, { ok: true, project: getProjectInfo() });
      return true;
    }
    if (parsed.pathname === "/api/work/choose-project" && req.method === "POST") {
      const chosen = chooseProjectNative();
      if (chosen.cancelled) {
        json(res, 200, { ok: true, cancelled: true, project: getProjectInfo() });
        return true;
      }
      json(res, 200, { ok: true, cancelled: false, project: registerProject(chosen.path) });
      return true;
    }
    if (parsed.pathname === "/api/work/connect" && req.method === "POST") {
      const body = await readJsonBody(req);
      json(res, 200, { ok: true, project: registerProject(body.path) });
      return true;
    }
    if (parsed.pathname === "/api/work/disconnect" && req.method === "POST") {
      projectRoot = "";
      writeState();
      json(res, 200, { ok: true, project: getProjectInfo() });
      return true;
    }
    if (parsed.pathname === "/api/work/tree" && req.method === "GET") {
      json(res, 200, { ok: true, path: parsed.searchParams.get("path") || "", items: listDirectory(parsed.searchParams.get("path") || "") });
      return true;
    }
    if (parsed.pathname === "/api/work/file" && req.method === "GET") {
      json(res, 200, { ok: true, file: readProjectFile(parsed.searchParams.get("path") || "") });
      return true;
    }
    if (parsed.pathname === "/api/work/save-file" && req.method === "POST") {
      const body = await readJsonBody(req);
      json(res, 200, { ok: true, file: saveProjectFile(body.path, body.content, body.expectedMtimeMs) });
      return true;
    }
    if (parsed.pathname === "/api/work/git-status" && req.method === "GET") {
      json(res, 200, { ok: true, ...getGitInfo() });
      return true;
    }

    json(res, 404, { ok: false, error: "Unknown Work endpoint" });
    return true;
  } catch (err) {
    json(res, err.code === "FILE_CHANGED" ? 409 : 400, { ok: false, error: err.message || String(err), code: err.code || "" });
    return true;
  }
}

const previousCreateServer = http.createServer;
http.createServer = function workPatchedCreateServer(options, listener) {
  let actualOptions = options;
  let actualListener = listener;
  if (typeof options === "function") {
    actualListener = options;
    actualOptions = undefined;
  }
  const wrapped = async (req, res) => {
    if (req.url && req.url.startsWith("/api/work/")) {
      await handleWorkRequest(req, res);
      return;
    }
    return actualListener(req, res);
  };
  return actualOptions === undefined
    ? previousCreateServer.call(http, wrapped)
    : previousCreateServer.call(http, actualOptions, wrapped);
};

// Load the whole-project coding-agent API after the base Work API so both
// wrappers participate in the same portable HTTP server.
require("./work-agent-preload.cjs");
