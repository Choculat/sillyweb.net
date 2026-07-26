const fs = require('node:fs');
const { mimeFor, validRelPath, publishedAbsPath } = require('./paths');

function rewriteAbsoluteLinks(content, base) {
  return content
    .replace(/((?:href|src)\s*=\s*)(["'])\/(?!\/)/gi, (_, attr, quote) => `${attr}${quote}${base}`)
    .replace(/(url\(\s*)(["']?)\/(?!\/)/gi, (_, prefix, quote) => `${prefix}${quote}${base}`);
}

const NAV_RELAY = '<script>(function(){document.addEventListener("click",function(e){'
  + 'var a=e.target&&e.target.closest?e.target.closest("a[href]"):null;'
  + 'if(!a||a.target==="_blank"||a.hasAttribute("download"))return;'
  + 'var u;try{u=new URL(a.getAttribute("href"),location.href)}catch(err){return}'
  + 'if(u.origin!==location.origin)return;'
  + 'e.preventDefault();parent.postMessage({previewNav:u.pathname+u.search},"*")'
  + '},true)})();</script>';

function isFile(abs) {
  return Boolean(abs) && fs.existsSync(abs) && fs.statSync(abs).isFile();
}

function readPage(abs, base, relay) {
  const body = rewriteAbsoluteLinks(fs.readFileSync(abs, 'utf8'), base);
  return relay ? body + NAV_RELAY : body;
}

function sendFile(res, abs, relPath, base, relay) {
  const mime = mimeFor(relPath);
  if (mime === 'text/html') return res.type(mime).send(readPage(abs, base, relay));
  if (mime === 'text/css') return res.type(mime).send(readPage(abs, base, false));
  res.type(mime).sendFile(abs);
}

function serveNotFound(res, notFoundAbs, base, relay) {
  if (isFile(notFoundAbs)) {
    return res.status(404).type('text/html').send(readPage(notFoundAbs, base, relay));
  }
  res.status(404).send('Not found');
}

function serveFromDisk(res, abs, relPath, base, notFoundAbs) {
  if (!validRelPath(relPath)) return res.status(404).send('Not found');
  if (!isFile(abs)) return serveNotFound(res, notFoundAbs, base, true);
  sendFile(res, abs, relPath, base, true);
}

function servePublished(res, next, pageId, relPath, base) {
  if (!validRelPath(relPath)) return next();
  const abs = publishedAbsPath(pageId, relPath);
  if (!isFile(abs)) return serveNotFound(res, publishedAbsPath(pageId, '404.html'), base);
  sendFile(res, abs, relPath, base);
}

module.exports = { serveFromDisk, servePublished };
