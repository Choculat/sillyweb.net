const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../db');
const { requireAuth } = require('../auth');
const { UPLOADS_DIR, MAX_STORAGE_BYTES, QUOTA_MESSAGE, FILE_TYPE_ERROR, NAME_ERROR } = require('../lib/config');
const { validRelPath, guardedJoin, siteAbsPath, mimeFor, allowedFile } = require('../lib/paths');
const { getPage, usedBytes, addUsage, createFile, uploaderFor, gcTrash } = require('../lib/storage');

const router = express.Router();

function ownedPage(req, res) {
  const page = getPage(req.params.id, req.user.id);
  if (!page) {
    res.status(404).json({ error: 'Not found.' });
    return null;
  }
  return page;
}

router.post('/api/pages/:id/files', requireAuth, (req, res) => {
  const page = ownedPage(req, res);
  if (!page) return;

  uploaderFor(req.user.id, page.id).single('file')(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? QUOTA_MESSAGE : err.message;
      return res.status(400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: 'No file provided.' });
    const cleanup = () => fs.unlink(req.file.path, () => {});

    const dir = (req.body.dir || '').trim();
    if (dir && !validRelPath(dir)) { cleanup(); return res.status(400).json({ error: 'Invalid folder.' }); }
    const base = path.basename(req.file.originalname);
    const filename = dir ? `${dir}/${base}` : base;
    if (!validRelPath(filename)) { cleanup(); return res.status(400).json({ error: 'Invalid filename.' }); }
    const abs = siteAbsPath(page.id, filename);
    if (!abs) { cleanup(); return res.status(400).json({ error: 'Invalid path.' }); }

    const existing = db.prepare('SELECT size_bytes FROM files WHERE page_id = ? AND filename = ?').get(page.id, filename);
    const net = req.file.size - (existing ? existing.size_bytes : 0);
    if (net > 0 && usedBytes(req.user.id) + net > MAX_STORAGE_BYTES) {
      cleanup();
      return res.status(400).json({ error: QUOTA_MESSAGE });
    }

    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.renameSync(req.file.path, abs);
    const mimeType = mimeFor(filename);
    if (existing) {
      addUsage(req.user.id, -existing.size_bytes);
      db.prepare('UPDATE files SET size_bytes = ?, mime_type = ? WHERE page_id = ? AND filename = ?')
        .run(req.file.size, mimeType, page.id, filename);
    } else {
      db.prepare('INSERT INTO files (page_id, filename, size_bytes, mime_type) VALUES (?, ?, ?, ?)')
        .run(page.id, filename, req.file.size, mimeType);
    }
    addUsage(req.user.id, req.file.size);
    res.json({ ok: true, filename, size: req.file.size });
  });
});

router.post('/api/pages/:id/files/new', requireAuth, (req, res) => {
  const page = ownedPage(req, res);
  if (!page) return;
  const filename = (req.body || {}).filename || '';
  if (!validRelPath(filename)) return res.status(400).json({ error: NAME_ERROR });
  if (!allowedFile(filename)) return res.status(400).json({ error: FILE_TYPE_ERROR });
  if (db.prepare('SELECT 1 FROM files WHERE page_id = ? AND filename = ?').get(page.id, filename)) {
    return res.status(400).json({ error: 'A file with that name already exists.' });
  }
  try {
    createFile(page.id, req.user.id, filename, '', mimeFor(filename));
    res.json({ ok: true, filename });
  } catch (err) {
    if (err && err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }
});

router.post('/api/pages/:id/folders', requireAuth, (req, res) => {
  const page = ownedPage(req, res);
  if (!page) return;
  const folder = (req.body || {}).path || '';
  if (!validRelPath(folder)) {
    return res.status(400).json({ error: NAME_ERROR });
  }
  const keep = `${folder}/.keep`;
  const all = db.prepare('SELECT filename FROM files WHERE page_id = ?').all(page.id);
  if (all.some((f) => f.filename === folder || f.filename === keep || f.filename.startsWith(folder + '/'))) {
    return res.status(400).json({ error: 'That folder already exists.' });
  }
  try {
    createFile(page.id, req.user.id, keep, '', 'text/plain');
    res.json({ ok: true, path: folder });
  } catch (err) {
    if (err && err.status) return res.status(err.status).json({ error: err.message });
    throw err;
  }
});

router.post('/api/pages/:id/rename', requireAuth, (req, res) => {
  const page = ownedPage(req, res);
  if (!page) return;
  const { from, to } = req.body || {};
  if (!validRelPath(from) || !validRelPath(to)) return res.status(400).json({ error: 'Invalid name.' });

  const all = db.prepare('SELECT id, filename FROM files WHERE page_id = ?').all(page.id);
  const renamingFile = all.some((f) => f.filename === from);
  if (renamingFile && !allowedFile(to)) return res.status(400).json({ error: FILE_TYPE_ERROR });
  const moves = all
    .filter((f) => f.filename === from || f.filename.startsWith(from + '/'))
    .map((f) => ({ id: f.id, from: f.filename, to: to + f.filename.slice(from.length) }));
  if (!moves.length) return res.status(404).json({ error: 'Not found.' });
  if (moves.some((m) => all.some((f) => f.filename === m.to))) {
    return res.status(400).json({ error: 'Something with that name already exists.' });
  }

  for (const m of moves) {
    const src = siteAbsPath(page.id, m.from);
    const dst = siteAbsPath(page.id, m.to);
    if (!src || !dst) return res.status(400).json({ error: 'Invalid path.' });
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.renameSync(src, dst);
    db.prepare('UPDATE files SET filename = ?, mime_type = ? WHERE id = ?').run(m.to, mimeFor(m.to), m.id);
  }
  if (to !== from && !to.startsWith(from + '/')) {
    fs.rm(siteAbsPath(page.id, from), { recursive: true, force: true }, () => {});
  }
  db.prepare("UPDATE pages SET updated_at = datetime('now') WHERE id = ?").run(page.id);
  res.json({ ok: true });
});

router.post('/api/pages/:id/delete', requireAuth, (req, res) => {
  const page = ownedPage(req, res);
  if (!page) return;
  const target = (req.body || {}).path || '';
  if (!validRelPath(target)) return res.status(400).json({ error: 'Invalid path.' });

  const all = db.prepare('SELECT id, filename, size_bytes, mime_type FROM files WHERE page_id = ?').all(page.id);
  const doomed = all.filter((f) => f.filename === target || f.filename.startsWith(target + '/'));
  if (!doomed.length) return res.status(404).json({ error: 'Not found.' });

  const payload = doomed.map((f) => ({ filename: f.filename, size_bytes: f.size_bytes, mime_type: f.mime_type }));
  const trash = db.prepare('INSERT INTO trash (page_id, payload) VALUES (?, ?)').run(page.id, JSON.stringify(payload));

  let freed = 0;
  for (const f of doomed) {
    const from = siteAbsPath(page.id, f.filename);
    const to = guardedJoin(UPLOADS_DIR, page.id, `.trash/${trash.lastInsertRowid}/${f.filename}`);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
    db.prepare('DELETE FROM files WHERE id = ?').run(f.id);
    freed += f.size_bytes;
  }
  addUsage(req.user.id, -freed);
  fs.rm(siteAbsPath(page.id, target), { recursive: true, force: true }, () => {});
  gcTrash();
  res.json({ ok: true, trashId: trash.lastInsertRowid });
});

router.post('/api/pages/:id/restore', requireAuth, (req, res) => {
  const page = ownedPage(req, res);
  if (!page) return;
  const trashId = (req.body || {}).trashId;
  const trashRow = db.prepare('SELECT * FROM trash WHERE id = ? AND page_id = ?').get(trashId, page.id);
  if (!trashRow) return res.status(404).json({ error: 'Nothing to restore.' });

  let items;
  try {
    items = JSON.parse(trashRow.payload);
  } catch {
    return res.status(500).json({ error: 'That trash entry is unreadable.' });
  }

  const collision = items.find((it) => (
    db.prepare('SELECT 1 FROM files WHERE page_id = ? AND filename = ?').get(page.id, it.filename)
  ));
  if (collision) return res.status(400).json({ error: `Can't restore: "${collision.filename}" already exists.` });

  const needed = items.reduce((sum, it) => sum + it.size_bytes, 0);
  if (usedBytes(req.user.id) + needed > MAX_STORAGE_BYTES) {
    return res.status(400).json({ error: 'Not enough space to restore these files. Free some up and try again.' });
  }

  for (const it of items) {
    const from = guardedJoin(UPLOADS_DIR, page.id, `.trash/${trashId}/${it.filename}`);
    const to = siteAbsPath(page.id, it.filename);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
    db.prepare('INSERT INTO files (page_id, filename, size_bytes, mime_type) VALUES (?, ?, ?, ?)')
      .run(page.id, it.filename, it.size_bytes, it.mime_type);
  }
  addUsage(req.user.id, needed);
  db.prepare('DELETE FROM trash WHERE id = ?').run(trashId);
  fs.rm(guardedJoin(UPLOADS_DIR, page.id, `.trash/${trashId}`), { recursive: true, force: true }, () => {});
  res.json({ ok: true, filenames: items.map((it) => it.filename) });
});

module.exports = router;
