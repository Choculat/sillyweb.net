const express = require('express');
const db = require('../db');
const { PRIMARY_HOSTS, PLATFORM_ZONE, SUSPENDED_NOTICE } = require('../lib/config');
const { servePublished } = require('../lib/serve');
const { sendPage } = require('../lib/meta');

const router = express.Router();

function pageFor(username) {
  const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (!user) return null;
  return db.prepare('SELECT id, suspended FROM pages WHERE user_id = ?').get(user.id);
}

function siteLabel(host) {
  if (!host || PRIMARY_HOSTS.has(host)) return null;
  const suffix = `.${PLATFORM_ZONE}`;
  if (!host.endsWith(suffix)) return null;
  return host.slice(0, -suffix.length);
}

function requestedPath(req) {
  try {
    return decodeURIComponent(req.path.slice(1)) || 'index.html';
  } catch {
    return null;
  }
}

function userSubdomain(req, res, next) {
  const label = siteLabel(req.hostname);
  if (label === null) return next();
  if (!label || label.includes('.')) return res.status(404).send('Not found');
  const page = pageFor(label);
  if (!page) return res.status(404).send('No site here yet.');
  if (page.suspended) return res.status(410).send(SUSPENDED_NOTICE);
  const filepath = requestedPath(req);
  if (filepath === null) return res.status(404).send('Not found');
  servePublished(res, next, page.id, filepath, '/');
}

function customDomain(req, res, next) {
  const host = req.hostname;
  if (!host || PRIMARY_HOSTS.has(host)) return next();
  const page = db.prepare(
    "SELECT id, suspended FROM pages WHERE custom_domain = ? AND custom_domain_status = 'active'",
  ).get(host);
  if (!page) return next();
  if (page.suspended) return res.status(410).send(SUSPENDED_NOTICE);
  const filepath = requestedPath(req);
  if (filepath === null) return next();
  servePublished(res, next, page.id, filepath, '/');
}

for (const route of ['/', '/signup', '/signin', '/dashboard', '/editor/:id', '/reset', '/account']) {
  router.get(route, (req, res) => {
    sendPage(res, route === '/' ? 'index' : route.split('/')[1]);
  });
}

module.exports = { router, customDomain, userSubdomain };
