const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');
const db = require('../db');
const {
  UPLOADS_DIR, PUBLISHED_DIR,
  MAX_STORAGE_BYTES, QUOTA_MESSAGE, MAX_TRASH_BYTES, TRASH_TTL_HOURS,
  FILE_TYPE_ERROR, NAME_ERROR,
} = require('./config');
const { guardedJoin, siteAbsPath, allowedFile, validSegment } = require('./paths');

fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(PUBLISHED_DIR, { recursive: true });

function getPage(id, userId) {
  return db.prepare('SELECT * FROM pages WHERE id = ? AND user_id = ?').get(id, userId);
}

function usedBytes(userId) {
  return db.prepare('SELECT used_bytes FROM users WHERE id = ?').get(userId).used_bytes;
}

function addUsage(userId, delta) {
  db.prepare('UPDATE users SET used_bytes = MAX(0, used_bytes + ?) WHERE id = ?').run(delta, userId);
}

function createFile(pageId, userId, filename, content, mimeType) {
  const size = Buffer.byteLength(content);
  if (usedBytes(userId) + size > MAX_STORAGE_BYTES) {
    throw { status: 400, message: QUOTA_MESSAGE };
  }
  const abs = siteAbsPath(pageId, filename);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  db.prepare('INSERT INTO files (page_id, filename, size_bytes, mime_type) VALUES (?, ?, ?, ?)')
    .run(pageId, filename, size, mimeType);
  addUsage(userId, size);
}

function publishSite(pageId) {
  const src = path.join(UPLOADS_DIR, String(pageId));
  const dst = path.join(PUBLISHED_DIR, String(pageId));
  fs.rmSync(dst, { recursive: true, force: true });
  if (fs.existsSync(src)) {
    fs.cpSync(src, dst, {
      recursive: true,
      filter: (from) => {
        const name = path.basename(from);
        return name !== '.trash' && !name.startsWith('.tmp-');
      },
    });
  }
  db.prepare("UPDATE pages SET published_at = datetime('now') WHERE id = ?").run(pageId);
}

function trashBytes(payload) {
  try {
    return JSON.parse(payload).reduce((sum, it) => sum + (it.size_bytes || 0), 0);
  } catch {
    return 0;
  }
}

function dropTrash(row) {
  const dir = guardedJoin(UPLOADS_DIR, row.page_id, `.trash/${row.id}`);
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  db.prepare('DELETE FROM trash WHERE id = ?').run(row.id);
}

function gcTempUploads() {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const page of db.prepare('SELECT id FROM pages').all()) {
    const dir = path.join(UPLOADS_DIR, String(page.id));
    let entries = [];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!name.startsWith('.tmp-')) continue;
      const abs = path.join(dir, name);
      try {
        if (fs.statSync(abs).mtimeMs < cutoff) fs.rmSync(abs, { force: true });
      } catch {}
    }
  }
}

function gcTrash() {
  const expired = db.prepare(
    `SELECT id, page_id FROM trash WHERE created_at < datetime('now', '-${TRASH_TTL_HOURS} hours')`,
  ).all();
  for (const row of expired) dropTrash(row);

  const owners = db.prepare('SELECT DISTINCT p.user_id AS id FROM trash t JOIN pages p ON t.page_id = p.id').all();
  for (const owner of owners) {
    const rows = db.prepare(
      'SELECT t.id, t.page_id, t.payload FROM trash t JOIN pages p ON t.page_id = p.id WHERE p.user_id = ? ORDER BY t.created_at ASC',
    ).all(owner.id);
    let total = rows.reduce((sum, r) => sum + trashBytes(r.payload), 0);
    for (const row of rows.slice(0, -1)) {
      if (total <= MAX_TRASH_BYTES) break;
      total -= trashBytes(row.payload);
      dropTrash(row);
    }
  }
}

function uploaderFor(userId, pageId) {
  const biggest = db.prepare('SELECT MAX(size_bytes) AS n FROM files WHERE page_id = ?').get(pageId).n || 0;
  const remaining = Math.min(
    MAX_STORAGE_BYTES,
    Math.max(0, MAX_STORAGE_BYTES - usedBytes(userId)) + biggest,
  );
  return multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        const dir = path.join(UPLOADS_DIR, String(pageId));
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (req, file, cb) => cb(null, `.tmp-${crypto.randomBytes(8).toString('hex')}`),
    }),
    limits: { fileSize: remaining, files: 1 },
    fileFilter: (req, file, cb) => {
      const name = path.basename(file.originalname);
      if (!validSegment(name)) {
        return cb(new Error(NAME_ERROR));
      }
      if (!allowedFile(name)) return cb(new Error(FILE_TYPE_ERROR));
      cb(null, true);
    },
  });
}

function backfillPublished() {
  for (const p of db.prepare('SELECT id FROM pages').all()) {
    if (!fs.existsSync(path.join(PUBLISHED_DIR, String(p.id)))) publishSite(p.id);
  }
}

module.exports = {
  getPage, usedBytes, addUsage, createFile, publishSite,
  gcTrash, gcTempUploads, uploaderFor, backfillPublished,
};
