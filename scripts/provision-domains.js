#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const dns = require('node:dns').promises;
const { execFileSync } = require('node:child_process');
const db = require('../db');

const CERT_PATH = process.env.CLOUDFLARE_CERT_PATH;
const CNAME_TARGET = process.env.CUSTOM_DOMAIN_CNAME_TARGET || 'custom.sillyweb.net';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const APP_PORT = process.env.PORT || 4300;
const SITES_AVAILABLE = '/etc/nginx/sites-available';
const SITES_ENABLED = '/etc/nginx/sites-enabled';
const MANAGED_MARKER = `# ${process.env.MANAGED_MARKER || 'sillyweb'}-managed-custom-domain`;
const DOMAIN_RULE = /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/;

function cloudflareCreds() {
  if (!CERT_PATH) throw new Error('Set CLOUDFLARE_CERT_PATH to your cloudflared origin certificate.');
  const data = fs.readFileSync(CERT_PATH, 'utf8');
  const body = data.split('-----BEGIN ARGO TUNNEL TOKEN-----')[1].split('-----END')[0];
  return JSON.parse(Buffer.from(body, 'base64').toString('utf8'));
}

async function cfApi(method, apiPath, token, body) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${apiPath}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

async function currentPublicIp() {
  const res = await fetch('https://api.ipify.org?format=json');
  return (await res.json()).ip;
}

async function updateDdns(ip) {
  const { zoneID, apiToken } = cloudflareCreds();
  const existing = await cfApi('GET', `/zones/${zoneID}/dns_records?type=A&name=${CNAME_TARGET}`, apiToken);
  const record = existing.result && existing.result[0];
  if (!record) {
    console.error(`No A record found for ${CNAME_TARGET} - create it once manually first.`);
    return;
  }
  if (record.content === ip) return;
  await cfApi('PUT', `/zones/${zoneID}/dns_records/${record.id}`, apiToken, {
    type: 'A', name: CNAME_TARGET, content: ip, ttl: 300, proxied: false,
  });
  console.log(`Updated ${CNAME_TARGET} -> ${ip} (was ${record.content})`);
}

async function domainResolvesToUs(domain, ip) {
  try {
    return (await dns.resolve4(domain)).includes(ip);
  } catch {
    return false;
  }
}

const nginxConfPath = (domain) => path.join(SITES_AVAILABLE, domain);

function writeInitialNginxConf(domain) {
  const conf = `${MANAGED_MARKER}
server {
    listen 80;
    server_name ${domain};
    location / {
        proxy_pass http://localhost:${APP_PORT};
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
`;
  fs.writeFileSync(nginxConfPath(domain), conf);
  const enabled = path.join(SITES_ENABLED, domain);
  if (!fs.existsSync(enabled)) fs.symlinkSync(nginxConfPath(domain), enabled);
}

function nginxTestAndReload() {
  execFileSync('nginx', ['-t'], { stdio: 'pipe' });
  execFileSync('systemctl', ['reload', 'nginx'], { stdio: 'pipe' });
}

function provisionCertbot(domain) {
  execFileSync('certbot', ['--nginx', '-d', domain, '--non-interactive', '--agree-tos', '-m', ADMIN_EMAIL, '--redirect'], { stdio: 'pipe' });
}

function isManagedByUs(domain) {
  const p = nginxConfPath(domain);
  return fs.existsSync(p) && fs.readFileSync(p, 'utf8').includes(MANAGED_MARKER);
}

function removeDomain(domain) {
  try { execFileSync('certbot', ['delete', '--cert-name', domain, '--non-interactive'], { stdio: 'pipe' }); } catch {}
  const enabled = path.join(SITES_ENABLED, domain);
  if (fs.existsSync(enabled)) fs.unlinkSync(enabled);
  const available = nginxConfPath(domain);
  if (fs.existsSync(available)) fs.unlinkSync(available);
}

async function processPending(ip) {
  const pending = db.prepare("SELECT id, custom_domain FROM pages WHERE custom_domain_status = 'pending'").all();
  for (const page of pending) {
    const domain = page.custom_domain;
    if (!DOMAIN_RULE.test(domain)) {
      db.prepare("UPDATE pages SET custom_domain_status = 'error', custom_domain_error = ? WHERE id = ?")
        .run('Invalid domain format.', page.id);
      continue;
    }
    if (!(await domainResolvesToUs(domain, ip))) continue;

    try {
      writeInitialNginxConf(domain);
      nginxTestAndReload();
      provisionCertbot(domain);
      db.prepare("UPDATE pages SET custom_domain_status = 'active', custom_domain_error = NULL WHERE id = ?").run(page.id);
      console.log(`Provisioned ${domain}`);
    } catch (err) {
      const message = String(err.stderr ? err.stderr.toString() : err.message || err).slice(0, 500);
      db.prepare("UPDATE pages SET custom_domain_status = 'error', custom_domain_error = ? WHERE id = ?").run(message, page.id);
      console.error(`Failed to provision ${domain}:`, message);
    }
  }
}

function cleanupOrphaned() {
  if (!fs.existsSync(SITES_AVAILABLE)) return;
  const active = new Set(
    db.prepare("SELECT custom_domain FROM pages WHERE custom_domain_status = 'active'").all().map((p) => p.custom_domain),
  );
  let reloadNeeded = false;
  for (const file of fs.readdirSync(SITES_AVAILABLE)) {
    if (active.has(file)) continue;
    if (!isManagedByUs(file)) continue;
    console.log(`Removing orphaned custom domain: ${file}`);
    removeDomain(file);
    reloadNeeded = true;
  }
  if (reloadNeeded) {
    try { execFileSync('systemctl', ['reload', 'nginx'], { stdio: 'pipe' }); } catch {}
  }
}

(async () => {
  const ip = await currentPublicIp();
  try {
    await updateDdns(ip);
  } catch (err) {
    console.error('DDNS update failed, continuing with domain provisioning:', err.message);
  }
  await processPending(ip);
  cleanupOrphaned();
})().catch((err) => { console.error(err); process.exit(1); });
