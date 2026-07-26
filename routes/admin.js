const express = require('express');
const path = require('node:path');
const db = require('../db');
const { requireAuth } = require('../auth');
const { PUBLIC_DIR } = require('../lib/config');

const router = express.Router();

function requireAdmin(req, res, next) {
  if (req.user && req.user.is_admin) return next();
  if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'Not allowed.' });
  res.redirect('/dashboard');
}

for (const [route, file] of [['/admin', 'admin'], ['/admin/users', 'admin-users'], ['/admin/sites', 'admin-sites']]) {
  router.get(route, requireAuth, requireAdmin, (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, `${file}.html`));
  });
}

router.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  const users = db.prepare(
    'SELECT id, email, username, is_admin, created_at FROM users ORDER BY created_at DESC',
  ).all();
  res.json({ users });
});

router.get('/api/admin/pages', requireAuth, requireAdmin, (req, res) => {
  const pages = db.prepare(`
    SELECT p.id, p.suspended, p.custom_domain, p.updated_at, u.username
    FROM pages p JOIN users u ON p.user_id = u.id
    ORDER BY p.updated_at DESC
  `).all();
  res.json({ pages });
});

router.post('/api/admin/pages/:id/suspend', requireAuth, requireAdmin, (req, res) => {
  const page = db.prepare('SELECT id FROM pages WHERE id = ?').get(req.params.id);
  if (!page) return res.status(404).json({ error: 'Not found.' });
  const suspended = (req.body || {}).suspended ? 1 : 0;
  db.prepare('UPDATE pages SET suspended = ? WHERE id = ?').run(suspended, page.id);
  res.json({ ok: true, suspended: Boolean(suspended) });
});

module.exports = router;
