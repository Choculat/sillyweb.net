const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { sh, db, makeUser, makePage, req, upload, SANDBOX } = require('../harness');
const { MAX_STORAGE_BYTES } = require('../../lib/config');

module.exports = [
  sh('path traversal and reserved names are refused', async () => {
    const user = makeUser('paths');
    const pageId = makePage(user.id);
    for (const filename of ['../escape.html', '/etc/passwd', 'a/../../b.html', '.trash', '.trash/x', '.tmp-abc', 'css/.trash']) {
      const res = await req(`/api/pages/${pageId}/files/new`, { method: 'POST', token: user.token, body: { filename } });
      assert.equal(res.status, 400, `accepted bad filename: ${filename}`);
    }
    assert.ok(!fs.existsSync(path.join(SANDBOX, 'escape.html')));

    for (const filename of ['My Photo (1).png', 'café notes.md', 'sub dir/deep file.css']) {
      const res = await req(`/api/pages/${pageId}/files/new`, { method: 'POST', token: user.token, body: { filename } });
      assert.equal(res.status, 200, `rejected a reasonable filename: ${filename}`);
    }
  }),

  sh('only web file types are accepted', async () => {
    const user = makeUser('types');
    const pageId = makePage(user.id);

    for (const filename of ['movie.mp4', 'installer.exe', 'dump.zip', 'noextension']) {
      const res = await req(`/api/pages/${pageId}/files/new`, { method: 'POST', token: user.token, body: { filename } });
      assert.equal(res.status, 400, `accepted a non-web file type: ${filename}`);
    }
    for (const filename of ['index.html', 'style.css', 'app.js', 'photo.png', 'font.woff2']) {
      const res = await req(`/api/pages/${pageId}/files/new`, { method: 'POST', token: user.token, body: { filename } });
      assert.equal(res.status, 200, `rejected a valid web file: ${filename}`);
    }

    assert.equal((await upload(pageId, user.token, 'payload.exe', 'MZ')).status, 400, 'uploaded an executable');

    const renamed = await req(`/api/pages/${pageId}/rename`, {
      method: 'POST', token: user.token, body: { from: 'index.html', to: 'index.exe' },
    });
    assert.equal(renamed.status, 400, 'renamed a page into a blocked type');

    const folder = await req(`/api/pages/${pageId}/folders`, { method: 'POST', token: user.token, body: { path: 'images' } });
    assert.equal(folder.status, 200, 'folder creation broke on the extension check');
  }),

  sh('quota blocks new files but allows shrinking a replacement', async () => {
    const user = makeUser('quota');
    const pageId = makePage(user.id);
    await req(`/api/pages/${pageId}/files/new`, { method: 'POST', token: user.token, body: { filename: 'big.bin' } });
    const d = db();
    d.prepare("UPDATE files SET size_bytes = ? WHERE filename = 'big.bin'").run(MAX_STORAGE_BYTES);
    d.prepare('UPDATE users SET used_bytes = ? WHERE id = ?').run(MAX_STORAGE_BYTES, user.id);

    const overflow = await upload(pageId, user.token, 'more.bin', 'some real bytes');
    assert.equal(overflow.status, 400, 'quota did not block a new upload');

    const replace = await upload(pageId, user.token, 'big.bin', 'tiny');
    assert.equal(replace.status, 200, 'could not shrink a file while at quota');
    const used = db().prepare('SELECT used_bytes FROM users WHERE id = ?').get(user.id).used_bytes;
    assert.equal(used, 4, `usage should drop to the new size, got ${used}`);
  }),

  sh('restore is refused when it would exceed the quota', async () => {
    const user = makeUser('restore');
    const pageId = makePage(user.id);
    await req(`/api/pages/${pageId}/files/new`, { method: 'POST', token: user.token, body: { filename: 'f.html' } });
    const d = db();
    const chunk = Math.floor(MAX_STORAGE_BYTES / 2);
    d.prepare("UPDATE files SET size_bytes = ? WHERE filename = 'f.html'").run(chunk);
    d.prepare('UPDATE users SET used_bytes = ? WHERE id = ?').run(chunk, user.id);

    const del = await (await req(`/api/pages/${pageId}/delete`, {
      method: 'POST', token: user.token, body: { path: 'f.html' },
    })).json();
    db().prepare('UPDATE users SET used_bytes = ? WHERE id = ?').run(MAX_STORAGE_BYTES, user.id);

    const res = await req(`/api/pages/${pageId}/restore`, {
      method: 'POST', token: user.token, body: { trashId: del.trashId },
    });
    assert.equal(res.status, 400, 'restore bypassed the quota');
  }),

  sh('delete then restore round-trips a file', async () => {
    const user = makeUser('undo');
    const pageId = makePage(user.id);
    await req(`/api/pages/${pageId}/files/new`, { method: 'POST', token: user.token, body: { filename: 'keep.html' } });
    const del = await (await req(`/api/pages/${pageId}/delete`, {
      method: 'POST', token: user.token, body: { path: 'keep.html' },
    })).json();
    assert.ok(!db().prepare("SELECT 1 FROM files WHERE filename = 'keep.html'").get());
    const res = await req(`/api/pages/${pageId}/restore`, {
      method: 'POST', token: user.token, body: { trashId: del.trashId },
    });
    assert.equal(res.status, 200);
    assert.ok(db().prepare("SELECT 1 FROM files WHERE filename = 'keep.html'").get(), 'file did not come back');
  }),
];
