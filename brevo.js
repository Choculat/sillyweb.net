const APP_URL = process.env.APP_URL || 'https://sillyweb.net';
const SENDER_EMAIL = 'noreply@sillyweb.net';

async function send(email, subject, htmlContent) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'Content-Type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { name: 'sillyweb.net', email: SENDER_EMAIL },
      to: [{ email }],
      subject,
      htmlContent,
    }),
  });
  if (!res.ok) {
    throw new Error(`Brevo send failed: ${res.status} ${await res.text()}`);
  }
}

function sendVerificationEmail(email, token) {
  const link = `${APP_URL}/verify?token=${token}`;
  return send(email, 'Verify your sillyweb.net account',
    `<p>Welcome to sillyweb.net! Click below to verify your email and activate your account.</p><p><a href="${link}">${link}</a></p>`);
}

function sendResetEmail(email, token) {
  const link = `${APP_URL}/reset?token=${token}`;
  return send(email, 'Reset your sillyweb.net password',
    `<p>Someone requested a password reset for your sillyweb.net account. If that was you, click below to set a new password. This link expires in 1 hour.</p><p><a href="${link}">${link}</a></p><p>If you didn't request this, you can ignore this email.</p>`);
}

function sendChangeEmailVerification(email, token) {
  const link = `${APP_URL}/verify-email?token=${token}`;
  return send(email, 'Confirm your new sillyweb.net email',
    `<p>Click below to confirm this address as your new sillyweb.net login email. This link expires in 1 hour.</p><p><a href="${link}">${link}</a></p><p>If you didn't request this, you can ignore this email and your login address stays the same.</p>`);
}

module.exports = { sendVerificationEmail, sendResetEmail, sendChangeEmailVerification };
