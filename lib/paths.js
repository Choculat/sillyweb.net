const path = require('node:path');
const { UPLOADS_DIR, PUBLISHED_DIR, ALLOWED_EXTENSIONS } = require('./config');

const UNSAFE_IN_NAME = /[\u0000-\u001f\u007f\\]/;

const MIME_TYPES = {
  '.html': 'text/html', '.htm': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.mjs': 'text/javascript', '.cjs': 'text/javascript', '.ts': 'text/plain',
  '.png': 'image/png', '.apng': 'image/apng', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.jxl': 'image/jxl', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
  '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf', '.eot': 'application/vnd.ms-fontobject',
  '.txt': 'text/plain', '.text': 'text/plain', '.md': 'text/markdown', '.markdown': 'text/markdown',
  '.json': 'application/json', '.geojson': 'application/geo+json', '.xml': 'application/xml',
  '.csv': 'text/csv', '.tsv': 'text/tab-separated-values', '.pdf': 'application/pdf',
  '.yaml': 'text/yaml', '.yml': 'text/yaml', '.toml': 'text/plain', '.less': 'text/plain',
  '.sass': 'text/plain', '.scss': 'text/plain', '.glsl': 'text/plain', '.py': 'text/plain',
  '.rss': 'application/rss+xml', '.atom': 'application/atom+xml', '.rdf': 'application/rdf+xml',
  '.opml': 'text/x-opml', '.manifest': 'text/cache-manifest', '.webmanifest': 'application/manifest+json',
  '.webapp': 'application/x-web-app-manifest+json', '.map': 'application/json',
  '.mid': 'audio/midi', '.midi': 'audio/midi', '.epub': 'application/epub+zip',
  '.gltf': 'model/gltf+json', '.glb': 'model/gltf-binary', '.obj': 'text/plain', '.mtl': 'text/plain',
  '.dae': 'model/vnd.collada+xml', '.kml': 'application/vnd.google-earth.kml+xml',
};

const TEXT_EXTENSIONS = new Set([
  '.html', '.htm', '.css', '.js', '.mjs', '.cjs', '.ts', '.txt', '.text', '.json', '.md', '.markdown',
  '.xml', '.svg', '.csv', '.tsv', '.yaml', '.yml', '.toml', '.less', '.sass', '.scss', '.glsl', '.py',
  '.rss', '.atom', '.rdf', '.opml', '.manifest', '.webmanifest', '.map', '.obj', '.mtl',
]);

function mimeFor(filename) {
  return MIME_TYPES[path.extname(filename).toLowerCase()] || 'application/octet-stream';
}

function isTextFile(filename) {
  return TEXT_EXTENSIONS.has(path.extname(filename).toLowerCase());
}

function allowedFile(filename) {
  const ext = path.extname(filename).slice(1).toLowerCase();
  return ALLOWED_EXTENSIONS.has(ext);
}

function reservedSegment(seg) {
  return seg === '.trash' || seg.startsWith('.tmp-');
}

function validSegment(seg) {
  if (!seg || seg.length > 200) return false;
  if (seg === '.' || seg === '..') return false;
  if (seg !== seg.trim()) return false;
  if (UNSAFE_IN_NAME.test(seg)) return false;
  return !reservedSegment(seg);
}

function validRelPath(p) {
  if (typeof p !== 'string' || !p || p.length > 400) return false;
  return p.split('/').every(validSegment);
}

function guardedJoin(baseRoot, pageId, relPath) {
  const base = path.join(baseRoot, String(pageId));
  const abs = path.join(base, relPath);
  if (abs !== base && !abs.startsWith(base + path.sep)) return null;
  return abs;
}

const siteAbsPath = (pageId, relPath) => guardedJoin(UPLOADS_DIR, pageId, relPath);
const publishedAbsPath = (pageId, relPath) => guardedJoin(PUBLISHED_DIR, pageId, relPath);

module.exports = {
  mimeFor, isTextFile, allowedFile, validSegment, validRelPath,
  guardedJoin, siteAbsPath, publishedAbsPath,
};
