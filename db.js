const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data.db');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    used_bytes INTEGER NOT NULL DEFAULT 0,
    reset_token TEXT,
    reset_expires TEXT,
    pending_email TEXT,
    pending_email_token TEXT,
    pending_email_expires TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    published_at TEXT,
    suspended INTEGER NOT NULL DEFAULT 0,
    preview_token TEXT,
    custom_domain TEXT,
    custom_domain_status TEXT,
    custom_domain_error TEXT
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_pages_custom_domain ON pages(custom_domain);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_pages_preview_token ON pages(preview_token);

  CREATE TABLE IF NOT EXISTS pending_signups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    mime_type TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(page_id, filename)
  );

  CREATE TABLE IF NOT EXISTS trash (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_trash_page ON trash(page_id);
`);

const pageColumns = db.prepare('PRAGMA table_info(pages)').all().map((c) => c.name);
if (!pageColumns.includes('preview_token')) {
  db.exec('ALTER TABLE pages ADD COLUMN preview_token TEXT');
}
for (const row of db.prepare('SELECT id FROM pages WHERE preview_token IS NULL').all()) {
  db.prepare('UPDATE pages SET preview_token = ? WHERE id = ?')
    .run(require('node:crypto').randomBytes(16).toString('hex'), row.id);
}

const userColumns = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
for (const dead of ['is_verified', 'verify_token', 'verify_expires']) {
  if (userColumns.includes(dead)) db.exec(`ALTER TABLE users DROP COLUMN ${dead}`);
}

db.exec(`
  UPDATE users SET used_bytes = (
    SELECT COALESCE(SUM(f.size_bytes), 0)
    FROM files f JOIN pages p ON f.page_id = p.id
    WHERE p.user_id = users.id
  )
`);

module.exports = db;
