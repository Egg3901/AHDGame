#!/usr/bin/env node
// AHD Backup API + Viewer — serves mongodump listings, archives, and a web UI.
// Secured with a static Bearer token (API) and password (web UI).
//
// Endpoints:
//   GET /                          — Web UI (login-protected)
//   GET /backups                   — List available backups (JSON)
//   GET /backups/:id               — List collections in a backup (JSON)
//   GET /backups/:id/:collection/:file — Download a .bson or .json file
//
// Usage:
//   BACKUP_API_KEY=yourkey BACKUP_PASSWORD=yourpass node backup-api.js [port]
//   Default port: 9723

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const BACKUP_DIR = "/root/a-house-divided-backups";
const API_KEY = process.env.BACKUP_API_KEY;
const BACKUP_PASSWORD = process.env.BACKUP_PASSWORD;
if (!BACKUP_PASSWORD) {
  console.error("ERROR: BACKUP_PASSWORD environment variable is required");
  process.exit(1);
}
const PORT = parseInt(process.argv[2] || "9723", 10);

if (!API_KEY) {
  console.error("ERROR: BACKUP_API_KEY environment variable is required");
  process.exit(1);
}

// Session tokens for web UI auth
const sessions = new Map(); // token -> { created: number }
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours

function checkAuth(req) {
  const auth = req.headers["authorization"];
  if (!auth) return false;
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : auth;
  return token === API_KEY;
}

function checkSession(req) {
  const cookies = (req.headers["cookie"] || "").split(";").map((c) => c.trim());
  const sessionCookie = cookies.find((c) => c.startsWith("ahd_session="));
  if (!sessionCookie) return false;
  const token = sessionCookie.split("=").slice(1).join("=");
  const session = sessions.get(token);
  if (!session) return false;
  if (Date.now() - session.created > SESSION_TTL) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function json(res, status, body) {
  addSecurityHeaders(res);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

// Rate limiting for login attempts
const loginAttempts = new Map(); // ip -> { count, lastAttempt }
const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

function checkLoginRateLimit(ip) {
  const entry = loginAttempts.get(ip);
  if (!entry) return true;
  if (Date.now() - entry.lastAttempt > LOGIN_LOCKOUT_MS) {
    loginAttempts.delete(ip);
    return true;
  }
  return entry.count < MAX_LOGIN_ATTEMPTS;
}

function recordLoginFailure(ip) {
  const entry = loginAttempts.get(ip) || { count: 0, lastAttempt: 0 };
  entry.count++;
  entry.lastAttempt = Date.now();
  loginAttempts.set(ip, entry);
}

function clearLoginAttempts(ip) {
  loginAttempts.delete(ip);
}

// Security headers for all responses
function addSecurityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'"
  );
}

const HTML_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>AHD Backup Viewer</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0a0a0f; color: #e0e0e0; min-height: 100vh; }
.login-wrap { display: flex; align-items: center; justify-content: center; min-height: 100vh; }
.login-box { background: #16161e; border: 1px solid #2a2a3a; border-radius: 12px; padding: 2rem; width: 360px; }
.login-box h1 { font-size: 1.25rem; margin-bottom: 0.25rem; color: #fff; }
.login-box p { font-size: 0.85rem; color: #888; margin-bottom: 1.25rem; }
.login-box input { width: 100%; padding: 0.6rem 0.8rem; background: #1e1e2a; border: 1px solid #333; border-radius: 8px; color: #e0e0e0; font-size: 0.95rem; margin-bottom: 0.75rem; outline: none; }
.login-box input:focus { border-color: #6366f1; }
.login-box button { width: 100%; padding: 0.6rem; background: #6366f1; border: none; border-radius: 8px; color: #fff; font-size: 0.95rem; cursor: pointer; font-weight: 600; }
.login-box button:hover { background: #5558e6; }
.login-error { color: #f87171; font-size: 0.8rem; margin-bottom: 0.5rem; min-height: 1.2rem; }

.app { display: none; }
.app.active { display: block; }

header { background: #16161e; border-bottom: 1px solid #2a2a3a; padding: 1rem 2rem; display: flex; align-items: center; justify-content: space-between; }
header h1 { font-size: 1.1rem; color: #fff; }
header h1 span { color: #6366f1; }
header button { background: #2a2a3a; border: 1px solid #333; border-radius: 6px; color: #888; padding: 0.35rem 0.8rem; cursor: pointer; font-size: 0.8rem; }
header button:hover { color: #fff; border-color: #555; }

.main { max-width: 1100px; margin: 0 auto; padding: 1.5rem 2rem; }

.backup-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 1rem; margin-top: 1rem; }
.backup-card { background: #16161e; border: 1px solid #2a2a3a; border-radius: 10px; padding: 1rem 1.25rem; cursor: pointer; transition: border-color 0.2s, transform 0.15s; }
.backup-card:hover { border-color: #6366f1; transform: translateY(-2px); }
.backup-card .date { font-size: 1.1rem; font-weight: 700; color: #fff; }
.backup-card .meta { font-size: 0.8rem; color: #888; margin-top: 0.35rem; }
.backup-card .size { color: #a78bfa; font-weight: 600; }

.back-view { display: none; }
.back-view.active { display: block; }
.back-btn { background: none; border: 1px solid #333; color: #6366f1; padding: 0.3rem 0.8rem; border-radius: 6px; cursor: pointer; font-size: 0.85rem; margin-bottom: 1rem; }
.back-btn:hover { background: #1e1e2a; }

.coll-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 1rem; }
.coll-header h2 { font-size: 1.3rem; color: #fff; }
.coll-header span { color: #888; font-size: 0.85rem; }

table { width: 100%; border-collapse: collapse; }
th { text-align: left; padding: 0.6rem 0.75rem; background: #1a1a26; color: #888; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #2a2a3a; position: sticky; top: 0; }
td { padding: 0.55rem 0.75rem; border-bottom: 1px solid #1a1a26; font-size: 0.88rem; }
tr:hover td { background: #1a1a26; }
td a { color: #6366f1; text-decoration: none; }
td a:hover { text-decoration: underline; }
.mono { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 0.82rem; }
.size-bar { height: 3px; background: #6366f1; border-radius: 2px; margin-top: 2px; }

.search-wrap { margin-bottom: 1rem; }
.search-wrap input { width: 100%; max-width: 400px; padding: 0.5rem 0.75rem; background: #1e1e2a; border: 1px solid #333; border-radius: 8px; color: #e0e0e0; font-size: 0.9rem; outline: none; }
.search-wrap input:focus { border-color: #6366f1; }

.loading { display: flex; justify-content: center; padding: 3rem; color: #888; }
.empty { text-align: center; padding: 3rem; color: #555; }

@media (max-width: 600px) {
  .main { padding: 1rem; }
  .backup-grid { grid-template-columns: 1fr; }
  header { padding: 0.75rem 1rem; }
  .coll-header { flex-direction: column; gap: 0.25rem; }
}
</style>
</head>
<body>

<div id="login" class="login-wrap">
  <div class="login-box">
    <h1>🔐 AHD Backups</h1>
    <p>Enter password to access backup viewer</p>
    <div id="login-error" class="login-error"></div>
    <input type="password" id="password" placeholder="Password" autofocus>
    <button onclick="doLogin()">Sign In</button>
  </div>
</div>

<div id="app" class="app">
  <header>
    <h1><span>●</span> AHD Backup Viewer</h1>
    <button onclick="doLogout()">Sign Out</button>
  </header>
  <div class="main">
    <div id="backup-list">
      <div class="loading" id="backups-loading">Loading backups…</div>
      <div id="backups-grid" class="backup-grid" style="display:none"></div>
    </div>
    <div id="collection-view" class="back-view">
      <button class="back-btn" onclick="showBackups()">← Back to backups</button>
      <div class="coll-header">
        <h2 id="coll-title"></h2>
        <span id="coll-count"></span>
      </div>
      <div class="search-wrap">
        <input type="text" id="coll-search" placeholder="Search collections…" oninput="filterCollections()">
      </div>
      <table id="coll-table">
        <thead><tr><th style="width:40px">#</th><th>Collection</th><th>BSON Size</th><th>Metadata</th><th style="width:150px">Size</th><th style="width:100px">Download</th></tr></thead>
        <tbody id="coll-tbody"></tbody>
      </table>
    </div>
  </div>
</div>

<script>
const API = '';
let allCollections = [];
let maxSize = 0;

async function doLogin() {
  const pw = document.getElementById('password').value;
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';
  try {
    const r = await fetch('/api/login', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({password: pw})
    });
    if (r.ok) { initApp(); }
    else { errEl.textContent = 'Invalid password'; }
  } catch(e) { errEl.textContent = 'Connection error'; }
}

document.getElementById('password').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

async function doLogout() {
  await fetch('/api/logout', {method:'POST'});
  document.getElementById('app').classList.remove('active');
  document.getElementById('login').style.display = '';
  document.getElementById('password').value = '';
}

async function initApp() {
  document.getElementById('login').style.display = 'none';
  document.getElementById('app').classList.add('active');
  await loadBackups();
}

async function apiFetch(url, opts = {}) {
  const r = await fetch(url, opts);
  if (r.status === 401) { doLogout(); throw new Error('Unauthorized'); }
  return r;
}

function formatBytes(b) {
  if (b === 0) return '0 B';
  const k = 1024, s = ['B','KB','MB','GB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return (b / Math.pow(k, i)).toFixed(1) + ' ' + s[i];
}

async function loadBackups() {
  const loading = document.getElementById('backups-loading');
  const grid = document.getElementById('backups-grid');
  loading.style.display = '';
  try {
    const r = await apiFetch('/backups');
    const data = await r.json();
    grid.innerHTML = '';
    data.backups.forEach(b => {
      const card = document.createElement('div');
      card.className = 'backup-card';
      card.innerHTML = '<div class="date">' + b.date.replace(/_/g,' ') + '</div>' +
        '<div class="meta">' + b.collections + ' collections · <span class="size">' + formatBytes(b.totalBytes) + '</span></div>';
      card.onclick = () => loadCollection(b.date);
      grid.appendChild(card);
    });
    loading.style.display = 'none';
    grid.style.display = '';
  } catch(e) {
    loading.textContent = 'Error loading backups: ' + e.message;
  }
}

async function loadCollection(date) {
  document.getElementById('backup-list').style.display = 'none';
  const view = document.getElementById('collection-view');
  view.classList.add('active');
  document.getElementById('coll-title').textContent = date.replace(/_/g, ' ');
  document.getElementById('coll-search').value = '';
  const tbody = document.getElementById('coll-tbody');
  tbody.innerHTML = '<tr><td colspan="6" class="loading">Loading…</td></tr>';

  try {
    const r = await apiFetch('/backups/' + date);
    const data = await r.json();
    allCollections = data.collections;
    maxSize = Math.max(...allCollections.map(c => c.bsonBytes), 1);
    document.getElementById('coll-count').textContent = data.total + ' collections';
    renderCollections(allCollections);
  } catch(e) {
    tbody.innerHTML = '<tr><td colspan="6">Error: ' + e.message + '</td></tr>';
  }
}

function renderCollections(cols) {
  const tbody = document.getElementById('coll-tbody');
  tbody.innerHTML = '';
  cols.forEach((c, i) => {
    const pct = (c.bsonBytes / maxSize * 100).toFixed(0);
    const tr = document.createElement('tr');
    tr.innerHTML = '<td class="mono">' + (i+1) + '</td>' +
      '<td class="mono">' + c.collection + '</td>' +
      '<td>' + formatBytes(c.bsonBytes) + '</td>' +
      '<td>' + formatBytes(c.metadataBytes) + '</td>' +
      '<td><div class="size-bar" style="width:' + pct + '%; max-width:100px"></div></td>' +
      '<td><a href="/backups/' + currentDate + '/' + c.collection + '/' + c.collection + '.bson" download>.bson</a> ' +
      '<a href="/backups/' + currentDate + '/' + c.collection + '/' + c.collection + '.metadata.json" download>.json</a></td>';
    tbody.appendChild(tr);
  });
}

let currentDate = '';
const origLoad = loadCollection;
loadCollection = function(date) { currentDate = date; origLoad(date); };

function filterCollections() {
  const q = document.getElementById('coll-search').value.toLowerCase();
  const filtered = allCollections.filter(c => c.collection.toLowerCase().includes(q));
  renderCollections(filtered);
}

function showBackups() {
  document.getElementById('collection-view').classList.remove('active');
  document.getElementById('backup-list').style.display = '';
  currentDate = '';
}

// Check if already logged in on load
(async () => {
  try {
    const r = await fetch('/backups');
    if (r.ok) { initApp(); }
  } catch(e) {}
})();
</script>
</body>
</html>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // POST /api/login — session-based auth for web UI
  if (req.method === "POST" && pathname === "/api/login") {
    const ip =
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.headers["x-real-ip"] ||
      req.socket.remoteAddress;
    if (!checkLoginRateLimit(ip)) {
      addSecurityHeaders(res);
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Too many login attempts. Try again in 15 minutes." }));
      return;
    }
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const { password } = JSON.parse(body);
        if (password === BACKUP_PASSWORD) {
          clearLoginAttempts(ip);
          const token = crypto.randomBytes(32).toString("hex");
          sessions.set(token, { created: Date.now() });
          addSecurityHeaders(res);
          res.writeHead(200, {
            "Content-Type": "application/json",
            "Set-Cookie": `ahd_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`,
          });
          res.end(JSON.stringify({ ok: true }));
        } else {
          recordLoginFailure(ip);
          addSecurityHeaders(res);
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Invalid password" }));
        }
      } catch {
        addSecurityHeaders(res);
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Bad request" }));
      }
    });
    return;
  }

  // POST /api/logout
  if (req.method === "POST" && pathname === "/api/logout") {
    const cookies = (req.headers["cookie"] || "").split(";").map((c) => c.trim());
    const sessionCookie = cookies.find((c) => c.startsWith("ahd_session="));
    if (sessionCookie) {
      const token = sessionCookie.split("=").slice(1).join("=");
      sessions.delete(token);
    }
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Set-Cookie": "ahd_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0",
    });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // GET / — serve HTML viewer
  if ((req.method === "GET" || req.method === "HEAD") && pathname === "/") {
    addSecurityHeaders(res);
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(HTML_PAGE);
    return;
  }

  // API endpoints: accept either Bearer token OR session cookie
  const isAuthenticated = checkAuth(req) || checkSession(req);

  // GET /backups — list backups
  if (req.method === "GET" && pathname === "/backups") {
    if (!isAuthenticated) {
      return json(res, 401, { error: "Unauthorized" });
    }
    try {
      const entries = fs
        .readdirSync(BACKUP_DIR)
        .filter((d) => /^\d{4}-\d{2}-\d{2}/.test(d))
        .sort()
        .reverse()
        .map((date) => {
          const dbDir = path.join(BACKUP_DIR, date, "a-house-divided");
          const searchDir = fs.existsSync(dbDir) ? dbDir : path.join(BACKUP_DIR, date);
          const bsonFiles = fs.readdirSync(searchDir).filter((f) => f.endsWith(".bson"));
          const totalBytes = bsonFiles.reduce((sum, f) => {
            try {
              return sum + fs.statSync(path.join(searchDir, f)).size;
            } catch {
              return sum;
            }
          }, 0);
          return { date, collections: bsonFiles.length, totalBytes };
        });
      return json(res, 200, { backups: entries, total: entries.length });
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }

  // GET /backups/:id — list collections in a backup
  const dateMatch = pathname.match(/^\/backups\/(\d{4}-\d{2}-\d{2}(?:_\d{2}-\d{2})?)$/);
  if (req.method === "GET" && dateMatch) {
    if (!isAuthenticated) {
      return json(res, 401, { error: "Unauthorized" });
    }
    const date = dateMatch[1];
    const dbDir = path.join(BACKUP_DIR, date, "a-house-divided");
    const searchDir = fs.existsSync(dbDir) ? dbDir : path.join(BACKUP_DIR, date);
    if (!fs.existsSync(searchDir)) {
      return json(res, 404, { error: `No backup for ${date}` });
    }
    try {
      const entries = fs
        .readdirSync(searchDir)
        .filter((f) => f.endsWith(".bson"))
        .map((f) => {
          const name = f.replace(".bson", "");
          const bsonSize = fs.statSync(path.join(searchDir, f)).size;
          const metaPath = path.join(searchDir, `${name}.metadata.json`);
          const metaSize = fs.existsSync(metaPath) ? fs.statSync(metaPath).size : 0;
          return { collection: name, bsonBytes: bsonSize, metadataBytes: metaSize };
        })
        .sort((a, b) => b.bsonBytes - a.bsonBytes);
      return json(res, 200, { date, collections: entries, total: entries.length });
    } catch (e) {
      return json(res, 500, { error: e.message });
    }
  }

  // GET /backups/:id/:collection/:file — download file
  const fileMatch = pathname.match(
    /^\/backups\/(\d{4}-\d{2}-\d{2}(?:_\d{2}-\d{2})?)\/([a-zA-Z0-9_]+)\/([a-zA-Z0-9_.]+)$/
  );
  if (req.method === "GET" && fileMatch) {
    if (!isAuthenticated) {
      return json(res, 401, { error: "Unauthorized" });
    }
    const date = fileMatch[1];
    const file = fileMatch[3];
    if (!file.endsWith(".bson") && !file.endsWith(".json")) {
      return json(res, 400, { error: "Only .bson and .json files can be downloaded" });
    }
    if (file.includes("..") || file.includes("/")) {
      return json(res, 400, { error: "Invalid filename" });
    }
    const dbDir = path.join(BACKUP_DIR, date, "a-house-divided");
    const searchDir = fs.existsSync(dbDir) ? dbDir : path.join(BACKUP_DIR, date);
    const filePath = path.resolve(path.join(searchDir, file));
    if (!filePath.startsWith(path.resolve(searchDir))) {
      return json(res, 400, { error: "Path traversal denied" });
    }
    if (!fs.existsSync(filePath)) {
      return json(res, 404, { error: `File not found: ${file}` });
    }
    const stat = fs.statSync(filePath);
    const contentType = file.endsWith(".bson") ? "application/octet-stream" : "application/json";
    addSecurityHeaders(res);
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": stat.size,
      "Content-Disposition": `attachment; filename="${file}"`,
    });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  // 404
  return json(res, 404, {
    error: "Not found",
    endpoints: [
      "GET /",
      "POST /api/login",
      "POST /api/logout",
      "GET /backups",
      "GET /backups/:id",
      "GET /backups/:id/:collection/:file",
    ],
  });
});

// Clean expired sessions every hour
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (now - session.created > SESSION_TTL) sessions.delete(token);
  }
}, 3600000);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`AHD Backup API+Viewer listening on http://0.0.0.0:${PORT}`);
  console.log(`Key: ${API_KEY.slice(0, 4)}...${API_KEY.slice(-4)}`);
  console.log(`Backup dir: ${BACKUP_DIR}`);
});
