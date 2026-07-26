const fs = require('node:fs');
const path = require('node:path');
const { VIEWS_DIR } = require('./config');

const SITE_URL = 'https://sillyweb.net/';
const IMAGE = `${SITE_URL}assets/og.png`;
const TITLE = 'free static hosting!!<3';
const IMAGE_ALT = 'sillyweb.net on lined paper beside a pencil drawing of a sleepy cat';

const TAGS = [
  '<meta property="og:type" content="website">',
  '<meta property="og:site_name" content="sillyweb.net">',
  `<meta property="og:title" content="${TITLE}">`,
  `<meta property="og:url" content="${SITE_URL}">`,
  `<meta property="og:image" content="${IMAGE}">`,
  '<meta property="og:image:type" content="image/png">',
  '<meta property="og:image:width" content="1200">',
  '<meta property="og:image:height" content="630">',
  `<meta property="og:image:alt" content="${IMAGE_ALT}">`,
  '<meta name="twitter:card" content="summary_large_image">',
  `<meta name="twitter:title" content="${TITLE}">`,
  `<meta name="twitter:image" content="${IMAGE}">`,
].join('\n  ');

const rendered = new Map();

function pageHtml(name) {
  if (!rendered.has(name)) {
    const html = fs.readFileSync(path.join(VIEWS_DIR, `${name}.html`), 'utf8');
    rendered.set(name, html.replace('</head>', `  ${TAGS}\n</head>`));
  }
  return rendered.get(name);
}

function sendPage(res, name) {
  res.type('html').send(pageHtml(name));
}

module.exports = { sendPage, pageHtml };
