const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PORT = 4399;
const BASE = `http://127.0.0.1:${PORT}`;

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'sillyweb-test-'));
const DB = path.join(SANDBOX, 'test.db');
const UPLOADS = path.join(SANDBOX, 'uploads');
const PUBLISHED = path.join(SANDBOX, 'published');

if (path.resolve(DB) === path.resolve(ROOT, 'data.db') || !path.resolve(DB).startsWith(path.resolve(os.tmpdir()))) {
  throw new Error(`refusing to run destructive tests against ${DB}`);
}

process.env.DB_PATH = DB;
process.env.DATA_DIR = SANDBOX;

let server;

function sh(name, fn) {
  return { name, fn };
}

function db() {
  const { DatabaseSync } = require('node:sqlite');
  return new DatabaseSync(DB);
}

function reset() {
  const d = db();
  for (const t of ['files', 'pages', 'users', 'sessions', 'trash', 'pending_signups']) d.prepare(`DELETE FROM ${t}`).run();
  for (const dir of [UPLOADS, PUBLISHED]) {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
  }
}

function makeUser(username, isAdmin = 0) {
  const { createSession } = require('../auth');
  const d = db();
  d.prepare('INSERT INTO users (email, username, password_hash, is_admin) VALUES (?, ?, ?, ?)')
    .run(`${username}@example.com`, username, 'x', isAdmin);
  const id = d.prepare('SELECT id FROM users WHERE username = ?').get(username).id;
  return { id, token: createSession(id).token };
}

function makePage(userId) {
  const d = db();
  d.prepare('INSERT INTO pages (user_id) VALUES (?)').run(userId);
  return d.prepare('SELECT id FROM pages WHERE user_id = ?').get(userId).id;
}

function onHost(host, urlPath = '/') {
  return fetch(BASE + urlPath, { headers: { 'X-Forwarded-Host': host } });
}

function req(url, { token, method = 'GET', body, raw, ip } = {}) {
  const headers = {};
  if (ip) headers['CF-Connecting-IP'] = ip;
  if (token) headers.Cookie = `session=${token}`;
  if (body && !raw) headers['Content-Type'] = 'application/json';
  return fetch(BASE + url, { method, headers, body: raw || (body ? JSON.stringify(body) : undefined), redirect: 'manual' });
}

function upload(pageId, token, filename, contents) {
  const form = new FormData();
  form.append('file', new Blob([contents]), filename);
  return fetch(`${BASE}/api/pages/${pageId}/files`, {
    method: 'POST', headers: { Cookie: `session=${token}` }, body: form,
  });
}

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try {
      await fetch(`${BASE}/api/me`);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  throw new Error('server did not start');
}

function cleanup() {
  if (server) server.kill();
  fs.rmSync(SANDBOX, { recursive: true, force: true });
}

async function run(suites) {
  require('../db');
  reset();
  server = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: '127.0.0.1',
      NODE_ENV: 'test',
      APP_URL: BASE,
      DB_PATH: DB,
      DATA_DIR: SANDBOX,
    },
    stdio: 'ignore',
  });
  await waitForServer();

  let passed = 0;
  for (const test of suites.flat()) {
    reset();
    try {
      await test.fn();
      console.log(`PASS: ${test.name}`);
      passed++;
    } catch (err) {
      console.error(`FAIL: ${test.name}\n  ${err.message}`);
      cleanup();
      process.exit(1);
    }
  }

  cleanup();
  console.log(`\nAll ${passed} API tests passed.`);
  process.exit(0);
}

module.exports = { BASE, SANDBOX, UPLOADS, sh, db, makeUser, makePage, onHost, req, upload, run, cleanup };
