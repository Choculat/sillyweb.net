const db = require('../db');
const { hashPassword } = require('../auth');

const email = process.env.ADMIN_EMAIL;
const username = process.env.ADMIN_USERNAME || (email || '').split('@')[0];
const password = process.env.ADMIN_PASSWORD;

if (!email || !password) {
  console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD in .env before running this.');
  process.exit(1);
}

(async () => {
  const hash = await hashPassword(password);
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    db.prepare('UPDATE users SET password_hash = ?, is_admin = 1 WHERE id = ?').run(hash, existing.id);
    console.log(`Updated existing admin: ${email}`);
  } else {
    db.prepare('INSERT INTO users (email, username, password_hash, is_admin) VALUES (?, ?, ?, 1)')
      .run(email, username, hash);
    console.log(`Created admin: ${email} (username: ${username})`);
  }
})();
