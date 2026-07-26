const IS_PROD = process.env.NODE_ENV === 'production' || String(process.env.APP_URL || '').startsWith('https://');

if (IS_PROD && !process.env.HCAPTCHA_SECRET) {
  throw new Error('HCAPTCHA_SECRET is required in production. Set it in .env, or unset APP_URL/NODE_ENV for local dev.');
}

async function verifyCaptcha(token) {
  if (!process.env.HCAPTCHA_SECRET) return true;
  if (!token) return false;
  const res = await fetch('https://api.hcaptcha.com/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret: process.env.HCAPTCHA_SECRET, response: token }),
  });
  const data = await res.json();
  return data.success === true;
}

module.exports = { verifyCaptcha };
