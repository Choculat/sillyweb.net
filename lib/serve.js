const fs = require('node:fs');
const { mimeFor, validRelPath, publishedAbsPath } = require('./paths');

function rewriteAbsoluteLinks(content, base) {
  return content
    .replace(/((?:href|src)\s*=\s*)(["'])\/(?!\/)/gi, (_, attr, quote) => `${attr}${quote}${base}`)
    .replace(/(url\(\s*)(["']?)\/(?!\/)/gi, (_, prefix, quote) => `${prefix}${quote}${base}`);
}

function isFile(abs) {
  return Boolean(abs) && fs.existsSync(abs) && fs.statSync(abs).isFile();
}

function sendFile(res, abs, relPath, base) {
  const mime = mimeFor(relPath);
  if (mime === 'text/html' || mime === 'text/css') {
    return res.type(mime).send(rewriteAbsoluteLinks(fs.readFileSync(abs, 'utf8'), base));
  }
  res.type(mime).sendFile(abs);
}

function serveNotFound(res, notFoundAbs, base) {
  if (isFile(notFoundAbs)) {
    return res.status(404).type('text/html').send(rewriteAbsoluteLinks(fs.readFileSync(notFoundAbs, 'utf8'), base));
  }
  res.status(404).send('Not found');
}

function serveFromDisk(res, abs, relPath, base, notFoundAbs) {
  if (!validRelPath(relPath)) return res.status(404).send('Not found');
  if (!isFile(abs)) return serveNotFound(res, notFoundAbs, base);
  sendFile(res, abs, relPath, base);
}

function servePublished(res, next, pageId, relPath, base) {
  if (!validRelPath(relPath)) return next();
  const abs = publishedAbsPath(pageId, relPath);
  if (!isFile(abs)) return serveNotFound(res, publishedAbsPath(pageId, '404.html'), base);
  sendFile(res, abs, relPath, base);
}

module.exports = { serveFromDisk, servePublished };
