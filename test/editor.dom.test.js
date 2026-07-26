const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');
const { JSDOM } = require('jsdom');

const PUBLIC = path.join(__dirname, '../public');
const html = fs.readFileSync(path.join(PUBLIC, 'editor.html'), 'utf8')
  .replace('<script src="/theme.js"></script>', '')
  .replace(/<script src="(\/editor\/[^"]+?)(\?[^"]*)?"><\/script>/g, (_, src) => (
    `<script>${fs.readFileSync(path.join(PUBLIC, src.replace(/^\//, '')), 'utf8')}</script>`
  ));

let nextId = 2;
let serverFiles = [{ id: 1, filename: 'index.html', size_bytes: 20, mime_type: 'text/html' }];
const contents = { 1: '<h1>Hi</h1>' };
const trash = {};
let nextTrashId = 1;
const calls = [];

function jsonRes(obj, ok = true) { return { ok, status: ok ? 200 : 400, json: async () => obj, text: async () => JSON.stringify(obj) }; }

function mockFetch(url, opts = {}) {
  const method = opts.method || 'GET';
  const body = opts.body ? JSON.parse(opts.body) : {};
  calls.push({ url, method, body });

  if (url === '/api/me') return Promise.resolve(jsonRes({ user: { username: 'choculat' } }));
  if (url === '/api/pages/1') return Promise.resolve(jsonRes({ page: { id: 1 }, files: serverFiles, usedBytes: 0, maxBytes: 1e9 }));
  if (/\/files\/(\d+)\/content$/.test(url)) {
    const id = Number(url.match(/\/files\/(\d+)\/content$/)[1]);
    return Promise.resolve(jsonRes({ filename: serverFiles.find((f) => f.id === id).filename, content: contents[id] || '' }));
  }
  if (/\/files\/(\d+)$/.test(url) && method === 'PUT') {
    const id = Number(url.match(/\/files\/(\d+)$/)[1]);
    contents[id] = body.content;
    const f = serverFiles.find((x) => x.id === id);
    f.size_bytes = body.content.length;
    return Promise.resolve(jsonRes({ ok: true }));
  }
  if (url.endsWith('/files/new')) {
    const id = nextId++;
    serverFiles.push({ id, filename: body.filename, size_bytes: 0, mime_type: 'text/html' });
    contents[id] = '';
    return Promise.resolve(jsonRes({ ok: true, filename: body.filename }));
  }
  if (url.endsWith('/delete')) {
    const target = body.path;
    const doomed = serverFiles.filter((f) => f.filename === target || f.filename.startsWith(target + '/'));
    if (!doomed.length) return Promise.resolve(jsonRes({ error: 'Not found.' }, false));
    const trashId = nextTrashId++;
    trash[trashId] = doomed.map((f) => ({ ...f }));
    serverFiles = serverFiles.filter((f) => !doomed.includes(f));
    return Promise.resolve(jsonRes({ ok: true, trashId }));
  }
  if (url.endsWith('/restore')) {
    const items = trash[body.trashId];
    if (!items) return Promise.resolve(jsonRes({ error: 'Nothing to restore.' }, false));
    serverFiles.push(...items);
    delete trash[body.trashId];
    return Promise.resolve(jsonRes({ ok: true }));
  }
  if (url.endsWith('/rename')) {
    const f = serverFiles.find((x) => x.filename === body.from);
    if (!f) return Promise.resolve(jsonRes({ error: 'Not found.' }, false));
    f.filename = body.to;
    return Promise.resolve(jsonRes({ ok: true }));
  }
  if (url.endsWith('/publish')) return Promise.resolve(jsonRes({ ok: true }));
  return Promise.resolve(jsonRes({ ok: true }));
}

const dom = new JSDOM(html, {
  url: 'http://localhost/editor/1',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  beforeParse(window) { window.fetch = mockFetch; },
});
const { window } = dom;
const doc = window.document;
const tick = (n = 1) => Array.from({ length: n }).reduce((p) => p.then(() => new Promise((r) => setTimeout(r, 5))), Promise.resolve());
const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const contextClick = (el) => el.dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, clientX: 5, clientY: 5 }));
const menuItem = (label) => [...doc.querySelectorAll('.context-item')].find((el) => el.textContent === label);
const rowFor = (name) => [...doc.querySelectorAll('.tree-row')].find((r) => r.querySelector('.tree-label')?.textContent === name);

(async () => {
  await tick(2);
  assert.ok(rowFor('index.html'), 'file tree should render a row for index.html');

  contextClick(doc.getElementById('tree'));
  click(menuItem('New File'));
  await tick();
  const input = doc.getElementById('modal-input');
  assert.equal(input.style.display, 'block', 'modal should show a text input for New File');
  input.value = 'about.html';
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await tick(2);
  assert.ok(serverFiles.some((f) => f.filename === 'about.html'), 'Enter in the modal should create the file');
  console.log('PASS: modal New File + Enter creates the file');

  const code = doc.getElementById('code');
  code.value = contents[doc.querySelector('#current-file').textContent.startsWith('about') ? 2 : 1] + ' edited';
  code.dispatchEvent(new window.Event('input', { bubbles: true }));
  await tick();
  assert.ok(doc.getElementById('current-file').textContent.includes('*'), 'tab should show * when unsaved');
  assert.ok(doc.querySelector('.tree-dirty'), 'tree should show an unsaved dot on the open file');
  await doc.getElementById('save').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await tick(2);
  assert.ok(!doc.getElementById('current-file').textContent.includes('*'), 'asterisk should clear after Save');
  console.log('PASS: unsaved asterisk/dot appear and clear on Save');

  const rowIndex = rowFor('index.html');
  const rowAbout = rowFor('about.html');
  click(rowIndex);
  rowAbout.dispatchEvent(new window.MouseEvent('click', { bubbles: true, ctrlKey: true }));
  await tick();
  assert.ok(rowFor('index.html').className.includes('selected') && rowFor('about.html').className.includes('selected'),
    'ctrl+click should select both rows');

  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
  await tick();
  const confirmBtn = doc.getElementById('modal-confirm');
  assert.equal(doc.getElementById('modal-overlay').style.display, 'flex', 'Delete key should open a confirm modal, not delete immediately');
  click(confirmBtn);
  await tick(2);
  assert.equal(serverFiles.length, 0, 'confirming should delete both selected files');
  console.log('PASS: multi-select + Delete key + modal confirm deletes both files');

  assert.equal(doc.getElementById('empty-state').style.display, 'flex', 'empty state should show when a site has no files');
  console.log('PASS: empty state shown with zero files');

  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
  await tick(2);
  assert.equal(serverFiles.length, 2, 'Ctrl+Z should restore both deleted files');
  assert.equal(doc.getElementById('empty-state').style.display, 'none', 'empty state should hide once files come back');
  console.log('PASS: Ctrl+Z restores deleted files and clears the empty state');

  doc.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true }));
  await tick(2);
  assert.equal(serverFiles.length, 0, 'Ctrl+Y should re-delete the files');
  console.log('PASS: Ctrl+Y redoes the delete');

  calls.length = 0;
  serverFiles.push({ id: 9, filename: 'index.html', size_bytes: 5, mime_type: 'text/html' });
  contents[9] = '<h1>x</h1>';
  await tick(2);
  click(doc.getElementById('publish'));
  await tick(2);
  assert.ok(calls.find((c) => c.method === 'POST' && c.url.endsWith('/publish')), 'Publish should POST to /publish');
  console.log('PASS: Publish still works');

  const ctrl = (key) => doc.dispatchEvent(new window.KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true }));

  contextClick(doc.getElementById('tree'));
  click(menuItem('New File'));
  await tick();
  const newInput = doc.getElementById('modal-input');
  newInput.value = 'created.html';
  newInput.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await tick(2);
  assert.ok(serverFiles.some((f) => f.filename === 'created.html'), 'file should be created');

  ctrl('z'); await tick(2);
  assert.ok(!serverFiles.some((f) => f.filename === 'created.html'), 'Ctrl+Z should undo a create by deleting it');
  ctrl('y'); await tick(2);
  assert.ok(serverFiles.some((f) => f.filename === 'created.html'), 'Ctrl+Y should redo the create');
  console.log('PASS: undo/redo a file creation');

  const createdRow = rowFor('created.html');
  contextClick(createdRow);
  click(menuItem('Rename'));
  await tick();
  const renameInput = doc.getElementById('modal-input');
  renameInput.value = 'renamed.html';
  renameInput.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  await tick(2);
  assert.ok(serverFiles.some((f) => f.filename === 'renamed.html'), 'file should be renamed');

  ctrl('z'); await tick(2);
  assert.ok(serverFiles.some((f) => f.filename === 'created.html'), 'Ctrl+Z should undo the rename back to the old name');
  ctrl('y'); await tick(2);
  assert.ok(serverFiles.some((f) => f.filename === 'renamed.html'), 'Ctrl+Y should redo the rename');
  console.log('PASS: undo/redo a rename');

  console.log('\nAll DOM tests passed.');
  process.exit(0);
})().catch((e) => { console.error('FAIL:', e.message, '\n', e.stack); process.exit(1); });
