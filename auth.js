const crypto = require('node:crypto');
const { promisify } = require('node:util');
const db = require('./db');

const scrypt = promisify(crypto.scrypt);

const PASSWORD_RULE = /^(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,128}$/;
const PASSWORD_HINT = 'Password must be 8-128 characters and include one uppercase letter, one number, and one special character.';

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = (await scrypt(password, salt, 64)).toString('hex');
  return `${salt}:${hash}`;
}

async function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = await scrypt(password, salt, 64);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires);
  return { token, expires };
}

function destroySession(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

function destroyUserSessions(userId, keepToken) {
  if (keepToken) {
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(userId, keepToken);
  } else {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }
}

function pruneExpiredSessions() {
  db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
}

function getUserForSession(token) {
  if (!token) return null;
  const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!session) return null;
  if (new Date(session.expires_at) < new Date()) {
    destroySession(token);
    return null;
  }
  return db.prepare('SELECT id, email, username, is_admin FROM users WHERE id = ?').get(session.user_id);
}

function requireAuth(req, res, next) {
  if (req.user) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Sign in required.' });
  res.redirect('/signin');
}

module.exports = {
  PASSWORD_RULE,
  PASSWORD_HINT,
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  destroyUserSessions,
  pruneExpiredSessions,
  getUserForSession,
  requireAuth,
};
