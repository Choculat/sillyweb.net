const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { sh, makeUser, makePage, req, onHost, BASE, UPLOADS } = require('../harness');

module.exports = [
  sh('app pages set security headers and carry no sandbox', async () => {
    const app = await fetch(`${BASE}/dashboard`);
    assert.equal(app.headers.get('content-security-policy'), null, 'app pages must not be sandboxed');
    assert.equal(app.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(app.headers.get('x-powered-by'), null);
  }),

  sh('a site is served on its own subdomain, unsandboxed', async () => {
    const user = makeUser('alice');
    const pageId = makePage(user.id);
    await req(`/api/pages/${pageId}/files/new`, { method: 'POST', token: user.token, body: { filename: 'index.html' } });
    await req(`/api/pages/${pageId}/publish`, { method: 'POST', token: user.token });

    const res = await onHost('alice.sillyweb.net');
    assert.equal(res.status, 200, 'subdomain did not serve the site');
    assert.equal(res.headers.get('content-security-policy'), null, 'subdomain should not need the sandbox');

    assert.equal((await onHost('nobody.sillyweb.net')).status, 404, 'unknown subdomain should not fall through to the app');

    const apex = await onHost('sillyweb.net');
    assert.equal(apex.status, 200, 'apex should still serve the landing page');
    assert.match(await apex.text(), /sillyweb\.net<\/h1>/);

    const deep = await onHost('a.b.sillyweb.net', '/index.html');
    assert.equal(deep.status, 404, 'a multi-level host has no certificate and must not resolve');
  }),

  sh('the apex no longer serves sites on a path', async () => {
    const user = makeUser('bob');
    const pageId = makePage(user.id);
    await req(`/api/pages/${pageId}/files/new`, { method: 'POST', token: user.token, body: { filename: 'index.html' } });
    await req(`/api/pages/${pageId}/publish`, { method: 'POST', token: user.token });

    assert.equal((await onHost('bob.sillyweb.net')).status, 200, 'subdomain should serve the site');
    for (const legacy of ['/bob/', '/bob/index.html']) {
      assert.equal((await onHost('sillyweb.net', legacy)).status, 404, `legacy path ${legacy} should be gone`);
    }
  }),

  sh('a site serves its own 404.html', async () => {
    const user = makeUser('notfound');
    const pageId = makePage(user.id);
    for (const filename of ['index.html', '404.html']) {
      await req(`/api/pages/${pageId}/files/new`, { method: 'POST', token: user.token, body: { filename } });
    }
    fs.writeFileSync(path.join(UPLOADS, String(pageId), '404.html'), '<h1>custom 404</h1>');
    await req(`/api/pages/${pageId}/publish`, { method: 'POST', token: user.token });
    const res = await onHost('notfound.sillyweb.net', '/missing.html');
    assert.equal(res.status, 404);
    assert.match(await res.text(), /custom 404/);
  }),

  sh('platform hostnames cannot be claimed as custom domains', async () => {
    const user = makeUser('domains');
    const pageId = makePage(user.id);
    for (const domain of ['sillyweb.net', 'custom.sillyweb.net', 'admin.sillyweb.net']) {
      const res = await req(`/api/pages/${pageId}/domain`, { method: 'POST', token: user.token, body: { domain } });
      assert.equal(res.status, 400, `allowed claiming ${domain}`);
    }
    const ok = await req(`/api/pages/${pageId}/domain`, { method: 'POST', token: user.token, body: { domain: 'mine.example' } });
    assert.equal(ok.status, 200, 'a normal domain should still be accepted');
  }),

  sh('preview is sandboxed, works without cookies, and needs the token', async () => {
    const user = makeUser('previewer');
    const pageId = makePage(user.id);
    await req(`/api/pages/${pageId}/files/new`, { method: 'POST', token: user.token, body: { filename: 'index.html' } });
    await req(`/api/pages/${pageId}/files/new`, { method: 'POST', token: user.token, body: { filename: 'style.css' } });

    const page = await (await req(`/api/pages/${pageId}`, { token: user.token })).json();
    const url = page.page.previewUrl;
    assert.match(url, /^\/preview\/[a-f0-9]{32}\/$/, 'preview url should carry an unguessable token');

    const res = await fetch(BASE + url);
    assert.equal(res.status, 200, 'preview must load without a session cookie');
    assert.match(res.headers.get('content-security-policy') || '', /sandbox/);
    assert.ok(!(res.headers.get('content-security-policy') || '').includes('allow-same-origin'));
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(res.headers.get('cache-control'), 'private, no-store');

    const asset = await fetch(`${BASE}${url}style.css`);
    assert.equal(asset.status, 200, 'sandboxed preview must still load its own assets');

    const wrong = await fetch(`${BASE}/preview/${'0'.repeat(32)}/`);
    assert.equal(wrong.status, 404, 'a wrong token must not expose a draft');
  }),

  sh('an admin can suspend a site and take it off the web', async () => {
    const owner = makeUser('owner');
    const admin = makeUser('mod', 1);
    const pageId = makePage(owner.id);
    await req(`/api/pages/${pageId}/files/new`, { method: 'POST', token: owner.token, body: { filename: 'index.html' } });
    await req(`/api/pages/${pageId}/publish`, { method: 'POST', token: owner.token });
    assert.equal((await onHost('owner.sillyweb.net')).status, 200);

    const nonAdmin = await req(`/api/admin/pages/${pageId}/suspend`, {
      method: 'POST', token: owner.token, body: { suspended: true },
    });
    assert.equal(nonAdmin.status, 403, 'a normal user could suspend a site');

    const res = await req(`/api/admin/pages/${pageId}/suspend`, {
      method: 'POST', token: admin.token, body: { suspended: true },
    });
    assert.equal(res.status, 200);
    assert.equal((await onHost('owner.sillyweb.net')).status, 410, 'suspended site still served');
    assert.equal((await onHost('owner.sillyweb.net', '/index.html')).status, 410, 'suspended asset still served');

    const owned = await (await req('/api/pages', { token: owner.token })).json();
    assert.equal(owned.pages[0].suspended, 1, 'owner cannot see the suspended state');

    await req(`/api/admin/pages/${pageId}/suspend`, { method: 'POST', token: admin.token, body: { suspended: false } });
    assert.equal((await onHost('owner.sillyweb.net')).status, 200, 'unsuspend did not restore the site');
  }),

  sh('suspending a site also kills its preview link', async () => {
    const owner = makeUser('shady');
    const admin = makeUser('mod2', 1);
    const pageId = makePage(owner.id);
    await req(`/api/pages/${pageId}/files/new`, { method: 'POST', token: owner.token, body: { filename: 'index.html' } });
    const page = await (await req(`/api/pages/${pageId}`, { token: owner.token })).json();
    const url = page.page.previewUrl;
    assert.equal((await fetch(BASE + url)).status, 200);

    await req(`/api/admin/pages/${pageId}/suspend`, {
      method: 'POST', token: admin.token, body: { suspended: true },
    });
    assert.equal((await fetch(BASE + url)).status, 410, 'suspended site still reachable through its preview link');
    assert.equal((await fetch(`${BASE}${url}index.html`)).status, 410, 'suspended draft assets still reachable');
  }),
];
