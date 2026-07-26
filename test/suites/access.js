const assert = require('node:assert');
const { sh, db, makeUser, makePage, req, BASE } = require('../harness');

const pendingSignup = (username, email, token, expiresAt) => db()
  .prepare('INSERT INTO pending_signups (email, username, password_hash, token, expires_at) VALUES (?, ?, ?, ?, ?)')
  .run(email, username, 'x', token, expiresAt);

const userCount = () => db().prepare('SELECT COUNT(*) c FROM users').get().c;

module.exports = [
  sh('unauthenticated API calls are rejected', async () => {
    assert.equal((await req('/api/pages')).status, 401);
    assert.equal((await req('/api/pages', { method: 'POST' })).status, 401);
  }),

  sh('a user cannot touch another user\'s site', async () => {
    const victim = makeUser('victim');
    const attacker = makeUser('attacker');
    const pageId = makePage(victim.id);
    for (const [url, opts] of [
      [`/api/pages/${pageId}`, {}],
      [`/api/pages/${pageId}/download`, {}],
      [`/api/pages/${pageId}/publish`, { method: 'POST' }],
      [`/api/pages/${pageId}/files/new`, { method: 'POST', body: { filename: 'a.html' } }],
    ]) {
      const res = await req(url, { ...opts, token: attacker.token });
      assert.equal(res.status, 404, `${url} leaked to a non-owner`);
    }
    assert.equal((await req(`/api/pages/${pageId}`, { method: 'DELETE', token: attacker.token })).status, 404);
    assert.ok(db().prepare('SELECT 1 FROM pages WHERE id = ?').get(pageId), 'victim page was deleted');
  }),

  sh('admin routes are closed to non-admins', async () => {
    const plain = makeUser('plain');
    const admin = makeUser('boss', 1);
    assert.equal((await req('/api/admin/users', { token: plain.token })).status, 403);
    assert.equal((await req('/api/admin/users', { token: admin.token })).status, 200);
    assert.equal((await req('/admin', { token: plain.token })).status, 302);
  }),

  sh('malformed input is rejected rather than crashing', async () => {
    const user = makeUser('input');
    const pageId = makePage(user.id);
    await req(`/api/pages/${pageId}/files/new`, { method: 'POST', token: user.token, body: { filename: 'a.html' } });
    const fileId = db().prepare("SELECT id FROM files WHERE filename = 'a.html'").get().id;
    const res = await req(`/api/pages/${pageId}/files/${fileId}`, {
      method: 'PUT', token: user.token, body: { content: { not: 'a string' } },
    });
    assert.equal(res.status, 400, 'non-string content should be a 400, not a 500');
    assert.equal((await req('/api/signup', { method: 'POST', body: { email: 'nope', username: 'u', password: 'Passw0rd!' } })).status, 400);
  }),

  sh('signing up creates no user until the link is opened', async () => {
    const res = await req('/api/signup', {
      method: 'POST', body: { email: 'new@example.com', username: 'newbie', password: 'Passw0rd!x' },
    });
    assert.ok([200, 502].includes(res.status), `unexpected signup status ${res.status}`);
    assert.equal(userCount(), 0, 'signup created a user before the email was confirmed');

    const token = 'a'.repeat(64);
    pendingSignup('newbie', 'new@example.com', token, new Date(Date.now() + 3600000).toISOString());
    const verify = await fetch(`${BASE}/verify?token=${token}`, { redirect: 'manual' });
    assert.equal(verify.status, 302, 'a valid link should sign the new user in');
    assert.equal(db().prepare('SELECT username FROM users').get().username, 'newbie', 'verifying did not create the user');
    assert.equal(db().prepare('SELECT COUNT(*) c FROM pending_signups').get().c, 0, 'pending row outlived the signup');
  }),

  sh('an expired or unknown verification link creates nothing', async () => {
    const token = 'b'.repeat(64);
    pendingSignup('oldie', 'old@example.com', token, new Date(Date.now() - 1000).toISOString());
    assert.equal((await fetch(`${BASE}/verify?token=${token}`)).status, 400, 'an expired link was accepted');
    assert.equal((await fetch(`${BASE}/verify?token=${'c'.repeat(64)}`)).status, 400, 'an unknown token was accepted');
    assert.equal(userCount(), 0, 'a dead link still created a user');
  }),

  sh('a taken username cannot be parked as a pending signup', async () => {
    makeUser('taken');
    const res = await req('/api/signup', {
      method: 'POST', body: { email: 'other@example.com', username: 'taken', password: 'Passw0rd!x' },
    });
    assert.equal(res.status, 400, 'signup reserved a username that already exists');
    assert.equal(db().prepare('SELECT COUNT(*) c FROM pending_signups').get().c, 0);
  }),

  sh('passwords are capped at 128 characters', async () => {
    const password = (length) => `A1!${'a'.repeat(length - 3)}`;
    const signup = (username, pw) => req('/api/signup', {
      method: 'POST', body: { email: `${username}@example.com`, username, password: pw },
    });

    const tooLong = await signup('longpw', password(129));
    assert.equal(tooLong.status, 400, 'a 129 character password was accepted');
    assert.match((await tooLong.json()).error, /8-128/);

    const atLimit = await signup('maxpw', password(128));
    assert.ok([200, 502].includes(atLimit.status), `a 128 character password was rejected (${atLimit.status})`);
  }),

  sh('signin is rate limited', async () => {
    const codes = [];
    for (let i = 0; i < 12; i++) {
      const res = await req('/api/signin', { method: 'POST', body: { email: 'a@b.co', password: 'Wrong1!x' } });
      codes.push(res.status);
    }
    assert.ok(codes.includes(429), `expected a 429, got ${codes.join(',')}`);
  }),
];
