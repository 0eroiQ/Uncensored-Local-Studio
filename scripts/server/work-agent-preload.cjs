const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const WORK_STATE_FILE = path.join(ROOT, "app", "config", "work-state.json");
const BACKUP_ROOT = path.join(ROOT, "app", "work-backups");
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_READ_BYTES = 1024 * 1024;
const MAX_WRITE_BYTES = 4 * 1024 * 1024;
const MAX_SEARCH_FILES = 6000;
const MAX_SEARCH_RESULTS = 60;
const MAX_COMMAND_OUTPUT = 160000;

const IGNORED_DIRS = new Set([
  ".git", ".idea", ".vscode", ".next", ".nuxt", ".svelte-kit", ".turbo", ".cache", ".parcel-cache",
  "node_modules", "node_modules_mac", "node_modules_windows", "node_modules_linux", "dist", "build", "coverage",
  "DerivedData", "Pods", ".gradle", "target", "vendor", "venv", ".venv", "__pycache__",
]);

const TEXT_EXTENSIONS = new Set([
  ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".json", ".md", ".txt", ".css", ".scss", ".sass", ".less", ".html",
  ".py", ".rs", ".go", ".java", ".kt", ".kts", ".swift", ".c", ".cc", ".cpp", ".h", ".hpp", ".cs", ".php",
  ".rb", ".sh", ".bash", ".zsh", ".sql", ".toml", ".yaml", ".yml", ".xml", ".env", ".example", ".ini", ".conf",
  ".gradle", ".properties", ".plist", ".pbxproj", ".xcconfig", ".graphql", ".gql", ".vue", ".svelte",
]);

const SPECIAL_TEXT_NAMES = new Set([
  "dockerfile", "makefile", "gemfile", "rakefile", "podfile", "brewfile", "procfile", ".gitignore", ".gitattributes",
  ".npmrc", ".nvmrc", ".editorconfig", "license", "readme", "agents.md",
]);

const ALLOWED_COMMANDS = new Set([
  "git", "npm", "pnpm", "yarn", "bun", "node", "python", "python3", "pytest", "cargo", "go", "swift", "xcodebuild",
  "gradle", "gradlew", "make", "cmake", "ninja", "tsc", "eslint", "jest", "vitest", "ruby", "bundle", "pod",
]);

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

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body is too large."));
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

function getProjectRoot() {
  let state = {};
  try { state = JSON.parse(fs.readFileSync(WORK_STATE_FILE, "utf8")); } catch (_) {}
  const candidate = String(state.projectRoot || "").trim();
  if (!candidate) throw new Error("Open a project in Work first.");
  if (!fs.existsSync(candidate)) throw new Error("The selected Work project no longer exists.");
  const real = fs.realpathSync(candidate);
  if (!fs.statSync(real).isDirectory()) throw new Error("The selected Work project is not a folder.");
  if (real === path.parse(real).root) throw new Error("Whole-drive access is not allowed. Open a project folder instead.");
  return real;
}

function normalizeRelative(value = "") {
  const rel = String(value || "").replace(/\\/g, "/").replace(/^\.\//, "");
  if (!rel || rel === ".") return "";
  if (path.posix.isAbsolute(rel) || path.win32.isAbsolute(rel)) throw new Error("Agent paths must be relative to the selected project.");
  const normalized = path.posix.normalize(rel);
  if (normalized === ".." || normalized.startsWith("../")) throw new Error("Blocked path outside the selected project.");
  return normalized;
}

function resolveInsideProject(relativePath = "", mustExist = true) {
  const root = getProjectRoot();
  const rel = normalizeRelative(relativePath);
  const target = path.resolve(root, rel);
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error("Blocked path outside the selected project.");

  if (!mustExist) {
    let parent = path.dirname(target);
    while (!fs.existsSync(parent) && parent !== root) parent = path.dirname(parent);
    const realParent = fs.realpathSync(parent);
    if (realParent !== root && !realParent.startsWith(root + path.sep)) throw new Error("Blocked path through a symlink outside the project.");
    return target;
  }

  if (!fs.existsSync(target)) throw new Error("Project item does not exist.");
  const real = fs.realpathSync(target);
  if (real !== root && !real.startsWith(root + path.sep)) throw new Error("Blocked symlink outside the selected project.");
  return real;
}

function relativeFromRoot(fullPath) {
  return path.relative(getProjectRoot(), fullPath).split(path.sep).join("/");
}

function looksBinary(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  for (const byte of sample) if (byte === 0) return true;
  return false;
}

function isTextCandidate(filename) {
  const lower = String(filename || "").toLowerCase();
  if (SPECIAL_TEXT_NAMES.has(lower)) return true;
  const ext = path.extname(lower);
  return TEXT_EXTENSIONS.has(ext);
}

function walkProjectFiles(limit = MAX_SEARCH_FILES) {
  const root = getProjectRoot();
  const files = [];
  const queue = [root];
  while (queue.length > 0 && files.length < limit) {
    const dir = queue.shift();
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { continue; }
    for (const entry of entries) {
      if (files.length >= limit) break;
      if (entry.name === ".DS_Store") continue;
      const full = path.join(dir, entry.name);
      let stat;
      try { stat = fs.lstatSync(full); } catch (_) { continue; }
      if (stat.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!IGNORED_DIRS.has(entry.name)) queue.push(full);
        continue;
      }
      if (entry.isFile()) files.push({ full, rel: path.relative(root, full).split(path.sep).join("/"), size: stat.size });
    }
  }
  return files;
}

function searchProject(query, maxResults = 30) {
  const needle = String(query || "").trim();
  if (!needle) throw new Error("Search query is required.");
  const lowerNeedle = needle.toLowerCase();
  const terms = lowerNeedle.split(/\s+/).filter(Boolean).slice(0, 8);
  const results = [];
  const files = walkProjectFiles();
  const wanted = Math.max(1, Math.min(MAX_SEARCH_RESULTS, Number(maxResults) || 30));

  for (const file of files) {
    if (results.length >= wanted) break;
    const pathLower = file.rel.toLowerCase();
    const pathScore = terms.reduce((score, term) => score + (pathLower.includes(term) ? 4 : 0), 0);
    if (pathScore > 0) {
      results.push({ path: file.rel, line: 0, kind: "path", snippet: file.rel, score: pathScore });
      if (results.length >= wanted) break;
    }
    if (!isTextCandidate(file.rel) || file.size > MAX_READ_BYTES) continue;
    let buffer;
    try { buffer = fs.readFileSync(file.full); } catch (_) { continue; }
    if (looksBinary(buffer)) continue;
    const text = buffer.toString("utf8");
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length && results.length < wanted; i += 1) {
      const lower = lines[i].toLowerCase();
      const hitCount = terms.reduce((count, term) => count + (lower.includes(term) ? 1 : 0), 0);
      if (hitCount === 0) continue;
      results.push({
        path: file.rel,
        line: i + 1,
        kind: "content",
        snippet: lines[i].trim().slice(0, 260),
        score: hitCount * 10 + pathScore,
      });
    }
  }

  results.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path) || a.line - b.line);
  return { query: needle, scannedFiles: files.length, results: results.slice(0, wanted) };
}

function readFileRange(relativePath, startLine = 1, endLine = 240) {
  const full = resolveInsideProject(relativePath, true);
  const stat = fs.statSync(full);
  if (!stat.isFile()) throw new Error("Requested path is not a file.");
  if (stat.size > MAX_READ_BYTES) throw new Error("File exceeds the 1 MB agent read limit.");
  const buffer = fs.readFileSync(full);
  if (looksBinary(buffer)) throw new Error("Binary files cannot be read by the Work coding agent.");
  const lines = buffer.toString("utf8").split(/\r?\n/);
  const start = Math.max(1, Math.min(lines.length || 1, Number(startLine) || 1));
  const end = Math.max(start, Math.min(lines.length, Number(endLine) || start + 239, start + 399));
  return {
    path: relativeFromRoot(full),
    startLine: start,
    endLine: end,
    totalLines: lines.length,
    mtimeMs: stat.mtimeMs,
    content: lines.slice(start - 1, end).map((line, index) => `${start + index}: ${line}`).join("\n"),
  };
}

function projectKey(root) {
  return crypto.createHash("sha256").update(root).digest("hex").slice(0, 16);
}

function backupFile(fullPath, action) {
  const root = getProjectRoot();
  const rel = path.relative(root, fullPath).split(path.sep).join("/");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = path.join(BACKUP_ROOT, projectKey(root), stamp);
  ensureDir(base);
  const meta = { action, projectRoot: root, path: rel, createdAt: new Date().toISOString(), existed: fs.existsSync(fullPath) };
  if (meta.existed) {
    const dest = path.join(base, "before", rel);
    ensureDir(path.dirname(dest));
    fs.copyFileSync(fullPath, dest);
  }
  fs.writeFileSync(path.join(base, "meta.json"), JSON.stringify(meta, null, 2), "utf8");
  return { backupId: `${projectKey(root)}/${stamp}`, path: rel };
}

function atomicWrite(fullPath, content, mode = null) {
  const text = String(content ?? "");
  if (Buffer.byteLength(text, "utf8") > MAX_WRITE_BYTES) throw new Error("Agent write exceeds the 4 MB limit.");
  ensureDir(path.dirname(fullPath));
  const tmp = `${fullPath}.uls-agent-${process.pid}-${Date.now()}.tmp`;
  fs.writeFileSync(tmp, text, "utf8");
  if (mode != null) {
    try { fs.chmodSync(tmp, mode); } catch (_) {}
  }
  fs.renameSync(tmp, fullPath);
}

function replaceInFile(relativePath, oldText, newText, replaceAll = false) {
  const full = resolveInsideProject(relativePath, true);
  const stat = fs.statSync(full);
  if (!stat.isFile()) throw new Error("replace_in_file requires an existing file.");
  if (stat.size > MAX_WRITE_BYTES) throw new Error("File exceeds the 4 MB edit limit.");
  const buffer = fs.readFileSync(full);
  if (looksBinary(buffer)) throw new Error("Binary files cannot be edited by Work.");
  const before = buffer.toString("utf8");
  const oldValue = String(oldText ?? "");
  if (!oldValue) throw new Error("oldText must not be empty.");
  const occurrences = before.split(oldValue).length - 1;
  if (occurrences === 0) throw new Error("The exact oldText was not found. Read the file again and use an exact snippet.");
  if (!replaceAll && occurrences !== 1) throw new Error(`oldText matched ${occurrences} places. Provide a more specific snippet or set replaceAll=true.`);
  const backup = backupFile(full, "replace");
  const after = replaceAll ? before.split(oldValue).join(String(newText ?? "")) : before.replace(oldValue, String(newText ?? ""));
  atomicWrite(full, after, stat.mode);
  const next = fs.statSync(full);
  return { path: relativeFromRoot(full), replacements: replaceAll ? occurrences : 1, size: next.size, mtimeMs: next.mtimeMs, backupId: backup.backupId };
}

function createProjectFile(relativePath, content) {
  const rel = normalizeRelative(relativePath);
  if (!rel) throw new Error("File path is required.");
  const full = resolveInsideProject(rel, false);
  if (fs.existsSync(full)) throw new Error("File already exists. Use replace_in_file to modify existing files.");
  const backup = backupFile(full, "create");
  atomicWrite(full, content, 0o644);
  const stat = fs.statSync(full);
  return { path: relativeFromRoot(full), created: true, size: stat.size, mtimeMs: stat.mtimeMs, backupId: backup.backupId };
}

function gitStatus() {
  const root = getProjectRoot();
  const probe = spawnSync("git", ["-C", root, "rev-parse", "--show-toplevel"], { encoding: "utf8", timeout: 5000 });
  if (probe.status !== 0) return { git: false, branch: "", changes: [] };
  const branch = spawnSync("git", ["-C", root, "branch", "--show-current"], { encoding: "utf8", timeout: 5000 });
  const status = spawnSync("git", ["-C", root, "status", "--porcelain"], { encoding: "utf8", timeout: 8000 });
  return {
    git: true,
    branch: String(branch.stdout || "").trim() || "detached",
    changes: String(status.stdout || "").split(/\r?\n/).filter(Boolean).slice(0, 200),
  };
}

function gitDiff(relativePath = "") {
  const root = getProjectRoot();
  const args = ["-C", root, "diff", "--no-ext-diff", "--unified=3"];
  const rel = normalizeRelative(relativePath);
  if (rel) args.push("--", rel);
  const result = spawnSync("git", args, { encoding: "utf8", timeout: 10000, maxBuffer: 1024 * 1024 });
  if (result.status !== 0 && !result.stdout) throw new Error(String(result.stderr || "git diff failed").trim());
  const diff = String(result.stdout || "");
  return { path: rel, diff: diff.length > 120000 ? `${diff.slice(0, 120000)}\n…[diff truncated]` : diff };
}

function parseCommand(command) {
  const raw = String(command || "").trim();
  if (!raw) throw new Error("Command is empty.");
  if (/[;&|`<>]/.test(raw) || /\$\(/.test(raw) || /\r|\n/.test(raw)) {
    throw new Error("Shell operators, pipelines, redirects, command substitution, and multiline commands are blocked.");
  }
  const tokens = [];
  let current = "";
  let quote = "";
  let escape = false;
  for (const ch of raw) {
    if (escape) { current += ch; escape = false; continue; }
    if (ch === "\\" && quote !== "'") { escape = true; continue; }
    if (quote) {
      if (ch === quote) quote = "";
      else current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; continue; }
    if (/\s/.test(ch)) {
      if (current) { tokens.push(current); current = ""; }
      continue;
    }
    current += ch;
  }
  if (quote) throw new Error("Unclosed quote in command.");
  if (current) tokens.push(current);
  if (!tokens.length) throw new Error("Command is empty.");
  return tokens;
}

function validateCommand(tokens) {
  const rawExe = tokens[0];
  const exe = rawExe.startsWith("./") ? path.basename(rawExe) : path.basename(rawExe);
  if (!ALLOWED_COMMANDS.has(exe)) throw new Error(`Command '${rawExe}' is not in the Work allowlist.`);
  const root = getProjectRoot();
  for (const arg of tokens.slice(1)) {
    if (arg.includes("\0")) throw new Error("Invalid command argument.");
    if (arg === ".." || arg.startsWith("../") || arg.includes("/../")) throw new Error("Command arguments may not escape the selected project.");
    if (path.isAbsolute(arg)) {
      const resolved = path.resolve(arg);
      if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new Error("Absolute paths outside the selected project are blocked.");
    }
  }
  return { rawExe, exe };
}

function runApprovedCommand(command, timeoutMs = 60000) {
  const root = getProjectRoot();
  const tokens = parseCommand(command);
  validateCommand(tokens);
  const executable = tokens.shift();
  const timeout = Math.max(1000, Math.min(120000, Number(timeoutMs) || 60000));
  const env = { ...process.env, CI: "1", PAGER: "cat", GIT_PAGER: "cat", NO_COLOR: "1" };
  const result = spawnSync(executable, tokens, {
    cwd: root,
    env,
    encoding: "utf8",
    timeout,
    maxBuffer: 1024 * 1024,
    shell: false,
  });
  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  const combined = [stdout, stderr].filter(Boolean).join(stderr && stdout ? "\n--- stderr ---\n" : "");
  return {
    command,
    exitCode: Number.isInteger(result.status) ? result.status : null,
    signal: result.signal || "",
    timedOut: Boolean(result.error && result.error.code === "ETIMEDOUT"),
    output: combined.length > MAX_COMMAND_OUTPUT ? `${combined.slice(0, MAX_COMMAND_OUTPUT)}\n…[command output truncated]` : combined,
  };
}

async function handleAgentRequest(req, res) {
  if (!req.url || !req.url.startsWith("/api/work-agent/")) return false;
  try {
    const parsed = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
      return true;
    }

    if (parsed.pathname === "/api/work-agent/status" && req.method === "GET") {
      const root = getProjectRoot();
      sendJson(res, 200, { ok: true, projectRoot: root, tools: ["search_project", "read_file", "replace_in_file", "create_file", "git_status", "git_diff", "run_command"] });
      return true;
    }

    const body = req.method === "POST" ? await readJsonBody(req) : {};
    if (parsed.pathname === "/api/work-agent/search" && req.method === "POST") {
      sendJson(res, 200, { ok: true, ...searchProject(body.query, body.maxResults) });
      return true;
    }
    if (parsed.pathname === "/api/work-agent/read" && req.method === "POST") {
      sendJson(res, 200, { ok: true, file: readFileRange(body.path, body.startLine, body.endLine) });
      return true;
    }
    if (parsed.pathname === "/api/work-agent/replace" && req.method === "POST") {
      sendJson(res, 200, { ok: true, change: replaceInFile(body.path, body.oldText, body.newText, body.replaceAll === true) });
      return true;
    }
    if (parsed.pathname === "/api/work-agent/create" && req.method === "POST") {
      sendJson(res, 200, { ok: true, change: createProjectFile(body.path, body.content) });
      return true;
    }
    if (parsed.pathname === "/api/work-agent/git-status" && req.method === "POST") {
      sendJson(res, 200, { ok: true, ...gitStatus() });
      return true;
    }
    if (parsed.pathname === "/api/work-agent/git-diff" && req.method === "POST") {
      sendJson(res, 200, { ok: true, ...gitDiff(body.path) });
      return true;
    }
    if (parsed.pathname === "/api/work-agent/run-command" && req.method === "POST") {
      if (body.approved !== true) throw new Error("Command execution requires explicit UI approval.");
      sendJson(res, 200, { ok: true, result: runApprovedCommand(body.command, body.timeoutMs) });
      return true;
    }

    sendJson(res, 404, { ok: false, error: "Unknown Work agent endpoint." });
    return true;
  } catch (err) {
    sendJson(res, 400, { ok: false, error: err.message || String(err) });
    return true;
  }
}

const previousCreateServer = http.createServer;
http.createServer = function workAgentPatchedCreateServer(options, listener) {
  let actualOptions = options;
  let actualListener = listener;
  if (typeof options === "function") {
    actualListener = options;
    actualOptions = undefined;
  }
  const wrapped = async (req, res) => {
    if (req.url && req.url.startsWith("/api/work-agent/")) {
      await handleAgentRequest(req, res);
      return;
    }
    return actualListener(req, res);
  };
  return actualOptions === undefined
    ? previousCreateServer.call(http, wrapped)
    : previousCreateServer.call(http, actualOptions, wrapped);
};
