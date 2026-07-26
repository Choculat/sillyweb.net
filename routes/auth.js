const express = require('express');
const crypto = require('node:crypto');
const db = require('../db');
const { sendVerificationEmail, sendResetEmail, sendChangeEmailVerification } = require('../brevo');
const { verifyCaptcha } = require('../captcha');
const {
  PASSWORD_RULE, PASSWORD_HINT, hashPassword, verifyPassword,
  createSession, destroySession, destroyUserSessions, requireAuth,
} = require('../auth');
const { USERNAME_RULE, EMAIL_RULE, RESERVED } = require('../lib/config');
const { setSessionCookie, clearSessionCookie, rateLimit } = require('../lib/http');

const router = express.Router();
const HOUR = 60 * 60 * 1000;
const randomToken = () => crypto.randomBytes(32).toString('hex');
const expiresIn = (ms) => new Date(Date.now() + ms).toISOString();

router.post('/api/signup', rateLimit(5, 60 * 1000), async (req, res) => {
  const { email, username, password, captcha } = req.body || {};
  if (!email || !username || !password) {
    return res.status(400).json({ error: 'All fields are required.' });
  }
  if (!(await verifyCaptcha(captcha))) {
    return res.status(400).json({ error: 'Captcha verification failed. Please try again.' });
  }
  if (typeof email !== 'string' || email.length > 254 || !EMAIL_RULE.test(email)) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }
  if (typeof username !== 'string' || !USERNAME_RULE.test(username) || RESERVED.has(username)) {
    return res.status(400).json({ error: 'Username must be 3-30 lowercase letters, numbers, or hyphens.' });
  }
  if (typeof password !== 'string' || !PASSWORD_RULE.test(password)) {
    return res.status(400).json({ error: PASSWORD_HINT });
  }

  const address = email.toLowerCase();
  if (db.prepare('SELECT 1 FROM users WHERE email = ? OR username = ?').get(address, username)) {
    return res.status(400).json({ error: 'Email or username already taken.' });
  }

  const verifyToken = randomToken();
  db.prepare("DELETE FROM pending_signups WHERE expires_at < datetime('now') OR email = ? OR username = ?")
    .run(address, username);
  db.prepare('INSERT INTO pending_signups (email, username, password_hash, token, expires_at) VALUES (?, ?, ?, ?, ?)')
    .run(address, username, await hashPassword(password), verifyToken, expiresIn(48 * HOUR));

  try {
    await sendVerificationEmail(address, verifyToken);
  } catch (err) {
    db.prepare('DELETE FROM pending_signups WHERE token = ?').run(verifyToken);
    console.error(err);
    return res.status(502).json({ error: 'Could not send verification email. Try again shortly.' });
  }

  res.json({ ok: true, message: 'Check your email to verify your account.' });
});

router.get('/verify', (req, res) => {
  const verifyToken = req.query.token;
  const pending = typeof verifyToken === 'string' && verifyToken
    ? db.prepare('SELECT * FROM pending_signups WHERE token = ?').get(verifyToken)
    : null;
  if (!pending || new Date(pending.expires_at) < new Date()) {
    return res.status(400).send('Invalid or expired verification link.');
  }

  let userId;
  try {
    userId = db.prepare('INSERT INTO users (email, username, password_hash) VALUES (?, ?, ?)')
      .run(pending.email, pending.username, pending.password_hash).lastInsertRowid;
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(400).send('That email or username was taken while this link was waiting.');
    }
    throw err;
  }
  db.prepare('DELETE FROM pending_signups WHERE id = ?').run(pending.id);

  const { token, expires } = createSession(userId);
  setSessionCookie(res, token, expires);
  res.redirect('/dashboard');
});

router.post('/api/signin', rateLimit(10, 60 * 1000), async (req, res) => {
  const { email, password, captcha } = req.body || {};
  if (!(await verifyCaptcha(captcha))) {
    return res.status(400).json({ error: 'Captcha verification failed. Please try again.' });
  }
  const user = typeof email === 'string'
    ? db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase())
    : null;
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return res.status(400).json({ error: 'Invalid email or password.' });
  }
  const { token, expires } = createSession(user.id);
  setSessionCookie(res, token, expires);
  res.json({ ok: true });
});

router.post('/api/signout', (req, res) => {
  if (req.cookies_token) destroySession(req.cookies_token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.post('/api/forgot-password', rateLimit(5, 60 * 1000), async (req, res) => {
  const { email, captcha } = req.body || {};
  if (!(await verifyCaptcha(captcha))) {
    return res.status(400).json({ error: 'Captcha verification failed. Please try again.' });
  }
  const user = typeof email === 'string'
    ? db.prepare('SELECT id FROM users WHERE email = ?').get(email.trim().toLowerCase())
    : null;
  if (user) {
    const token = randomToken();
    db.prepare('UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?').run(token, expiresIn(HOUR), user.id);
    try {
      await sendResetEmail(email, token);
    } catch (err) {
      console.error(err);
    }
  }
  res.json({ ok: true, message: 'If that email has an account, a reset link is on its way.' });
});

router.post('/api/reset-password', rateLimit(10, 60 * 1000), async (req, res) => {
  const { token, newPassword } = req.body || {};
  const user = typeof token === 'string' && token
    ? db.prepare('SELECT id, reset_expires FROM users WHERE reset_token = ?').get(token)
    : null;
  if (!user || new Date(user.reset_expires) < new Date()) {
    return res.status(400).json({ error: 'This reset link is invalid or has expired.' });
  }
  if (typeof newPassword !== 'string' || !PASSWORD_RULE.test(newPassword)) {
    return res.status(400).json({ error: PASSWORD_HINT });
  }
  db.prepare('UPDATE users SET password_hash = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?')
    .run(await hashPassword(newPassword), user.id);
  destroyUserSessions(user.id);
  res.json({ ok: true });
});

router.post('/api/change-password', requireAuth, rateLimit(10, 60 * 1000), async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!(await verifyPassword(currentPassword, user.password_hash))) {
    return res.status(400).json({ error: 'Current password is incorrect.' });
  }
  if (typeof newPassword !== 'string' || !PASSWORD_RULE.test(newPassword)) {
    return res.status(400).json({ error: PASSWORD_HINT });
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(newPassword), user.id);
  destroyUserSessions(user.id, req.cookies_token);
  res.json({ ok: true });
});

router.post('/api/change-email', requireAuth, rateLimit(10, 60 * 1000), async (req, res) => {
  const { currentPassword, newEmail } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!(await verifyPassword(currentPassword || '', user.password_hash))) {
    return res.status(400).json({ error: 'Current password is incorrect.' });
  }
  if (typeof newEmail !== 'string' || newEmail.length > 254 || !EMAIL_RULE.test(newEmail)) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }
  const nextEmail = newEmail.trim().toLowerCase();
  if (nextEmail === user.email) {
    return res.status(400).json({ error: 'That\'s already your email.' });
  }
  if (db.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').get(nextEmail, user.id)) {
    return res.status(400).json({ error: 'That email is already in use.' });
  }

  const token = randomToken();
  db.prepare('UPDATE users SET pending_email = ?, pending_email_token = ?, pending_email_expires = ? WHERE id = ?')
    .run(nextEmail, token, expiresIn(HOUR), user.id);
  try {
    await sendChangeEmailVerification(nextEmail, token);
  } catch (err) {
    console.error(err);
    return res.status(502).json({ error: 'Could not send verification email. Try again shortly.' });
  }
  res.json({ ok: true, message: 'Check the new address for a verification link to finish changing your email.' });
});

router.get('/verify-email', (req, res) => {
  const user = db.prepare('SELECT id, pending_email, pending_email_expires FROM users WHERE pending_email_token = ?')
    .get(req.query.token || '');
  if (!user || new Date(user.pending_email_expires) < new Date()) {
    return res.status(400).send('Invalid or expired verification link.');
  }
  if (db.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').get(user.pending_email, user.id)) {
    return res.status(400).send('That email is already in use.');
  }
  db.prepare('UPDATE users SET email = ?, pending_email = NULL, pending_email_token = NULL, pending_email_expires = NULL WHERE id = ?')
    .run(user.pending_email, user.id);
  res.redirect('/account');
});

router.get('/api/me', (req, res) => {
  res.json({ user: req.user || null });
});

module.exports = router;
