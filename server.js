const express = require('express');
const path = require('node:path');
const { getUserForSession, pruneExpiredSessions } = require('./auth');
const { PORT, HOST, ROOT_DIR, PUBLIC_DIR, SESSION_COOKIE } = require('./lib/config');
const { readCookie } = require('./lib/http');
const { gcTrash, gcTempUploads, backfillPublished } = require('./lib/storage');
const { router: siteRoutes, customDomain, userSubdomain } = require('./routes/site');

const app = express();
app.set('trust proxy', 'loopback');
app.disable('x-powered-by');

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});

app.use((req, res, next) => {
  if (req.hostname === 'www.sillyweb.net') {
    return res.redirect(301, `https://sillyweb.net${req.originalUrl}`);
  }
  next();
});

app.use(userSubdomain);
app.use(customDomain);

app.use(express.json({ limit: '5mb' }));
app.use(express.static(PUBLIC_DIR));
app.use('/vendor/monaco/vs', express.static(path.join(ROOT_DIR, 'node_modules/monaco-editor/min/vs')));

app.use((req, res, next) => {
  req.user = getUserForSession(req.cookies_token = readCookie(req, SESSION_COOKIE));
  next();
});

app.use(require('./routes/auth'));
app.use(require('./routes/pages'));
app.use(require('./routes/files'));
app.use(require('./routes/content'));
app.use(require('./routes/admin'));
app.use(siteRoutes);

app.use((req, res) => res.status(404).send('Not found'));

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  if (req.path.startsWith('/api/')) return res.status(500).json({ error: 'Something went wrong.' });
  res.status(500).send('Something went wrong.');
});

backfillPublished();

function sweep() {
  pruneExpiredSessions();
  gcTrash();
  gcTempUploads();
}
sweep();
setInterval(sweep, 6 * 60 * 60 * 1000).unref();

app.listen(PORT, HOST, () => console.log(`sillyweb.net listening on ${HOST}:${PORT}`));
