const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const db = require('../db');
const { requireAuth } = require('../auth');
const {
  DOMAIN_RULE, MAX_SITES_PER_USER, MAX_STORAGE_BYTES, IS_PROD, PORT,
  CUSTOM_DOMAIN_CNAME_TARGET, PLATFORM_ZONE, UPLOADS_DIR, PUBLISHED_DIR,
} = require('../lib/config');
const { getPage, usedBytes, createFile, publishSite } = require('../lib/storage');

const router = express.Router();

function previewToken(page) {
  if (page.preview_token) return page.preview_token;
  const token = require('node:crypto').randomBytes(16).toString('hex');
  db.prepare('UPDATE pages SET preview_token = ? WHERE id = ?').run(token, page.id);
  return token;
}

function publicUrl(username, page) {
  if (page.custom_domain && page.custom_domain_status === 'active') {
    return `https://${page.custom_domain}/`;
  }
  if (IS_PROD) return `https://${username}.${PLATFORM_ZONE}/`;
  return `http://${username}.${PLATFORM_ZONE}:${PORT}/`;
}

router.get('/api/pages', requireAuth, (req, res) => {
  const pages = db.prepare(
    'SELECT id, updated_at, suspended, custom_domain, custom_domain_status, custom_domain_error FROM pages WHERE user_id = ? ORDER BY updated_at DESC',
  ).all(req.user.id).map((p) => ({ ...p, publicUrl: publicUrl(req.user.username, p) }));
  res.json({
    pages,
    usedBytes: usedBytes(req.user.id),
    maxBytes: MAX_STORAGE_BYTES,
    maxSites: MAX_SITES_PER_USER,
    domainCnameTarget: CUSTOM_DOMAIN_CNAME_TARGET,
  });
});

router.post('/api/pages', requireAuth, (req, res) => {
  const siteCount = db.prepare('SELECT COUNT(*) AS n FROM pages WHERE user_id = ?').get(req.user.id).n;
  if (siteCount >= MAX_SITES_PER_USER) {
    const noun = MAX_SITES_PER_USER === 1 ? 'site' : 'sites';
    return res.status(400).json({ error: `You've reached the maximum of ${MAX_SITES_PER_USER} ${noun}.` });
  }
  try {
    const token = require('node:crypto').randomBytes(16).toString('hex');
    const result = db.prepare('INSERT INTO pages (user_id, preview_token) VALUES (?, ?)').run(req.user.id, token);
    createFile(result.lastInsertRowid, req.user.id, 'index.html', '<h1>Hello world</h1>', 'text/html');
    publishSite(result.lastInsertRowid);
    res.json({ id: result.lastInsertRowid });
  } catch (err) {
    if (err && err.status) return res.status(err.status).json({ error: err.message });
    if (String(err.message).includes('UNIQUE')) {
      return res.status(400).json({ error: 'You already have a site.' });
    }
    throw err;
  }
});

router.get('/api/pages/:id', requireAuth, (req, res) => {
  const page = getPage(req.params.id, req.user.id);
  if (!page) return res.status(404).json({ error: 'Not found.' });
  const files = db.prepare(
    'SELECT id, filename, size_bytes, mime_type FROM files WHERE page_id = ? ORDER BY filename',
  ).all(page.id);
  res.json({
    page: { ...page, publicUrl: publicUrl(req.user.username, page), previewUrl: `/preview/${previewToken(page)}/` },
    files,
    usedBytes: usedBytes(req.user.id),
    maxBytes: MAX_STORAGE_BYTES,
    domainCnameTarget: CUSTOM_DOMAIN_CNAME_TARGET,
  });
});

router.post('/api/pages/:id/domain', requireAuth, (req, res) => {
  const page = getPage(req.params.id, req.user.id);
  if (!page) return res.status(404).json({ error: 'Not found.' });
  const domain = ((req.body || {}).domain || '').trim().toLowerCase();
  if (!DOMAIN_RULE.test(domain)) {
    return res.status(400).json({ error: 'Enter a valid domain, e.g. example.com or www.example.com' });
  }
  if (domain === PLATFORM_ZONE || domain.endsWith(`.${PLATFORM_ZONE}`)) {
    return res.status(400).json({ error: `Domains under ${PLATFORM_ZONE} can't be claimed.` });
  }
  if (db.prepare('SELECT 1 FROM pages WHERE custom_domain = ? AND id != ?').get(domain, page.id)) {
    return res.status(400).json({ error: 'That domain is already connected to another site.' });
  }
  db.prepare("UPDATE pages SET custom_domain = ?, custom_domain_status = 'pending', custom_domain_error = NULL WHERE id = ?")
    .run(domain, page.id);
  res.json({ ok: true, domainCnameTarget: CUSTOM_DOMAIN_CNAME_TARGET });
});

router.delete('/api/pages/:id/domain', requireAuth, (req, res) => {
  const page = getPage(req.params.id, req.user.id);
  if (!page) return res.status(404).json({ error: 'Not found.' });
  db.prepare('UPDATE pages SET custom_domain = NULL, custom_domain_status = NULL, custom_domain_error = NULL WHERE id = ?')
    .run(page.id);
  res.json({ ok: true });
});

router.delete('/api/pages/:id', requireAuth, (req, res) => {
  const page = getPage(req.params.id, req.user.id);
  if (!page) return res.status(404).json({ error: 'Not found.' });

  const files = db.prepare('SELECT size_bytes FROM files WHERE page_id = ?').all(page.id);
  const freed = files.reduce((sum, f) => sum + f.size_bytes, 0);

  db.prepare('DELETE FROM files WHERE page_id = ?').run(page.id);
  db.prepare('DELETE FROM trash WHERE page_id = ?').run(page.id);
  db.prepare('DELETE FROM pages WHERE id = ?').run(page.id);
  db.prepare('UPDATE users SET used_bytes = MAX(0, used_bytes - ?) WHERE id = ?').run(freed, req.user.id);
  fs.rm(path.join(UPLOADS_DIR, String(page.id)), { recursive: true, force: true }, () => {});
  fs.rm(path.join(PUBLISHED_DIR, String(page.id)), { recursive: true, force: true }, () => {});
  res.json({ ok: true });
});

router.post('/api/pages/:id/publish', requireAuth, (req, res) => {
  const page = getPage(req.params.id, req.user.id);
  if (!page) return res.status(404).json({ error: 'Not found.' });
  publishSite(page.id);
  res.json({ ok: true });
});

module.exports = router;
