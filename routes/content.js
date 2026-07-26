const express = require('express');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const db = require('../db');
const { requireAuth } = require('../auth');
const { MAX_STORAGE_BYTES, QUOTA_MESSAGE, SANDBOX_CSP, SUSPENDED_NOTICE } = require('../lib/config');
const { isTextFile, siteAbsPath } = require('../lib/paths');
const { getPage, usedBytes, addUsage } = require('../lib/storage');
const { serveFromDisk } = require('../lib/serve');

const router = express.Router();

function editableFile(req, res) {
  const page = getPage(req.params.id, req.user.id);
  if (!page) {
    res.status(404).json({ error: 'Not found.' });
    return null;
  }
  const file = db.prepare('SELECT * FROM files WHERE id = ? AND page_id = ?').get(req.params.fileId, page.id);
  if (!file || !isTextFile(file.filename)) {
    res.status(404).json({ error: 'Not an editable text file.' });
    return null;
  }
  return { page, file };
}

router.get('/api/pages/:id/files/:fileId/content', requireAuth, (req, res) => {
  const found = editableFile(req, res);
  if (!found) return;
  const content = fs.readFileSync(siteAbsPath(found.page.id, found.file.filename), 'utf8');
  res.json({ filename: found.file.filename, content });
});

router.put('/api/pages/:id/files/:fileId', requireAuth, (req, res) => {
  const found = editableFile(req, res);
  if (!found) return;
  const { page, file } = found;

  const content = (req.body || {}).content ?? '';
  if (typeof content !== 'string') return res.status(400).json({ error: 'File content must be text.' });

  const newSize = Buffer.byteLength(content);
  const delta = newSize - file.size_bytes;
  if (delta > 0 && usedBytes(req.user.id) + delta > MAX_STORAGE_BYTES) {
    return res.status(400).json({ error: QUOTA_MESSAGE });
  }

  fs.writeFileSync(siteAbsPath(page.id, file.filename), content);
  db.prepare('UPDATE files SET size_bytes = ? WHERE id = ?').run(newSize, file.id);
  addUsage(req.user.id, delta);
  db.prepare("UPDATE pages SET updated_at = datetime('now') WHERE id = ?").run(page.id);
  res.json({ ok: true });
});

router.get('/api/pages/:id/download', requireAuth, (req, res) => {
  const page = getPage(req.params.id, req.user.id);
  if (!page) return res.status(404).json({ error: 'Not found.' });
  const dir = siteAbsPath(page.id, '');
  const zip = spawn('zip', ['-r', '-', '.', '-x', '.trash/*'], { cwd: dir });
  zip.on('error', (err) => {
    console.error('zip failed (is the zip binary installed?)', err);
    if (!res.headersSent) res.status(500).json({ error: 'Could not build the archive.' });
    else res.end();
  });
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${req.user.username}.zip"`);
  zip.stdout.pipe(res);
});

function pageForPreviewToken(token) {
  if (typeof token !== 'string' || token.length < 16) return null;
  return db.prepare('SELECT id, user_id, suspended FROM pages WHERE preview_token = ?').get(token);
}

function servePreview(req, res, token, rawPath) {
  const page = pageForPreviewToken(token);
  if (!page) return res.status(404).send('Not found');
  if (page.suspended) return res.status(410).send(SUSPENDED_NOTICE);
  let rel;
  try {
    rel = rawPath ? decodeURIComponent(rawPath) : 'index.html';
  } catch {
    return res.status(404).send('Not found');
  }
  res.setHeader('Content-Security-Policy', SANDBOX_CSP);
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'private, no-store');
  serveFromDisk(
    res,
    siteAbsPath(page.id, rel),
    rel,
    `/preview/${token}/`,
    siteAbsPath(page.id, '404.html'),
  );
}

router.get(/^\/preview\/([a-f0-9]{32})\/(.*)$/, (req, res) => {
  servePreview(req, res, req.params[0], req.params[1]);
});

router.get('/preview/:token', (req, res) => {
  const page = pageForPreviewToken(req.params.token);
  if (!page) return res.status(404).send('Not found');
  if (page.suspended) return res.status(410).send(SUSPENDED_NOTICE);
  res.redirect(`/preview/${req.params.token}/`);
});

module.exports = router;
