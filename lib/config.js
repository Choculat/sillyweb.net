const path = require('node:path');

const PORT = process.env.PORT || 4300;
const HOST = process.env.HOST || '127.0.0.1';
const IS_PROD = process.env.NODE_ENV === 'production' || String(process.env.APP_URL || '').startsWith('https://');

const USERNAME_RULE = /^[a-z0-9-]{3,30}$/;
const EMAIL_RULE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DOMAIN_RULE = /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const RESERVED = new Set([
  'signup', 'signin', 'signout', 'dashboard', 'editor',
  'admin', 'api', 'static', 'verify', 'reset', 'account', 'preview',
  'www', 'custom', 'mail', 'email', 'smtp', 'imap', 'pop', 'ftp', 'ns', 'ns1', 'ns2',
  'cdn', 'assets', 'img', 'images', 'files', 'download', 'downloads', 'status', 'docs',
  'help', 'support', 'blog', 'news', 'shop', 'store', 'billing', 'pay', 'payment',
  'app', 'apps', 'dev', 'test', 'staging', 'beta', 'demo', 'root', 'system', 'security',
  'abuse', 'postmaster', 'webmaster', 'hostmaster', 'me', 'my', 'about', 'terms', 'privacy',
]);

const CUSTOM_DOMAIN_CNAME_TARGET = process.env.CUSTOM_DOMAIN_CNAME_TARGET || 'custom.sillyweb.net';
const PLATFORM_ZONE = process.env.PLATFORM_ZONE || 'sillyweb.net';
const PRIMARY_HOSTS = new Set([PLATFORM_ZONE, `www.${PLATFORM_ZONE}`, 'localhost', '127.0.0.1']);
const SESSION_COOKIE = IS_PROD ? '__Host-session' : 'session';

const MAX_SITES_PER_USER = 1;
const MAX_STORAGE_BYTES = 512 * 1024 * 1024;
const QUOTA_MESSAGE = `Storage quota exceeded (${Math.round(MAX_STORAGE_BYTES / (1024 * 1024))}MB total).`;

const MAX_TRASH_BYTES = 256 * 1024 * 1024;
const TRASH_TTL_HOURS = 24;

const ALLOWED_EXTENSIONS = new Set([
  'apng', 'asc', 'atom', 'avif', 'bin', 'cjs', 'css', 'csv', 'dae', 'eot', 'epub', 'geojson',
  'gif', 'glb', 'glsl', 'gltf', 'gpg', 'htm', 'html', 'ico', 'jpeg', 'jpg', 'js', 'json', 'jxl',
  'key', 'kml', 'knowl', 'less', 'manifest', 'map', 'markdown', 'md', 'mf', 'mid', 'midi', 'mjs',
  'mtl', 'obj', 'opml', 'osdx', 'otf', 'pdf', 'pgp', 'pls', 'png', 'py', 'rdf', 'resolveHandle',
  'rss', 'sass', 'scss', 'sf2', 'svg', 'text', 'toml', 'ts', 'tsv', 'ttf', 'txt', 'webapp',
  'webmanifest', 'webp', 'woff', 'woff2', 'xcf', 'xml', 'yaml', 'yml',
]);

const NAME_ERROR = 'A file name cannot contain a slash, and cannot start or end with a space.';

const FILE_TYPE_ERROR = 'Only web file types are allowed, like .html, .css, .js, .png or .svg.';

const SUSPENDED_NOTICE = 'This site has been suspended.';

const SANDBOX_CSP = 'sandbox allow-scripts allow-forms allow-popups allow-modals allow-downloads';

const ROOT_DIR = path.join(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || ROOT_DIR;
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const PUBLISHED_DIR = path.join(DATA_DIR, 'published');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

module.exports = {
  PORT, HOST, IS_PROD,
  USERNAME_RULE, EMAIL_RULE, DOMAIN_RULE, RESERVED,
  CUSTOM_DOMAIN_CNAME_TARGET, PLATFORM_ZONE, PRIMARY_HOSTS, SESSION_COOKIE,
  MAX_SITES_PER_USER, MAX_STORAGE_BYTES, QUOTA_MESSAGE,
  MAX_TRASH_BYTES, TRASH_TTL_HOURS, SANDBOX_CSP, SUSPENDED_NOTICE, ALLOWED_EXTENSIONS, FILE_TYPE_ERROR, NAME_ERROR,
  ROOT_DIR, DATA_DIR, UPLOADS_DIR, PUBLISHED_DIR, PUBLIC_DIR,
};
