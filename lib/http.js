const { IS_PROD, SESSION_COOKIE } = require('./config');

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

function setSessionCookie(res, token, expires) {
  const secure = IS_PROD ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; Expires=${new Date(expires).toUTCString()}; SameSite=Lax${secure}`,
  );
}

function clearSessionCookie(res) {
  const secure = IS_PROD ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=; HttpOnly; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax${secure}`,
  );
}

function clientIp(req) {
  return req.headers['cf-connecting-ip'] || req.ip || 'unknown';
}

const rateBuckets = new Map();
setInterval(() => rateBuckets.clear(), 10 * 60 * 1000).unref();

function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const key = `${req.path}:${clientIp(req)}`;
    const now = Date.now();
    const hits = (rateBuckets.get(key) || []).filter((t) => now - t < windowMs);
    if (hits.length >= max) {
      return res.status(429).json({ error: 'Too many attempts. Wait a minute and try again.' });
    }
    hits.push(now);
    rateBuckets.set(key, hits);
    next();
  };
}

module.exports = { readCookie, setSessionCookie, clearSessionCookie, rateLimit };
