const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'data.db');
const DATA_DIR = process.env.DATA_DIR || ROOT;
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(os.homedir(), 'db-backups');
const KEEP_DAYS = Number(process.env.BACKUP_KEEP_DAYS || 14);

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
const archive = path.join(BACKUP_DIR, `sillyweb-${stamp}.tar.gz`);

fs.mkdirSync(BACKUP_DIR, { recursive: true });

const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'sillyweb-backup-'));

try {
  const snapshot = path.join(staging, 'data.db');
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  db.exec(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`);
  db.close();

  const args = ['-czf', archive, '-C', staging, 'data.db'];
  for (const dir of ['uploads', 'published']) {
    if (fs.existsSync(path.join(DATA_DIR, dir))) args.push('-C', DATA_DIR, dir);
  }
  execFileSync('tar', args);

  const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  let pruned = 0;
  for (const name of fs.readdirSync(BACKUP_DIR)) {
    if (!/^sillyweb-\d{8}-\d{6}\.tar\.gz$/.test(name)) continue;
    const file = path.join(BACKUP_DIR, name);
    if (fs.statSync(file).mtimeMs < cutoff) {
      fs.rmSync(file);
      pruned++;
    }
  }

  const size = (fs.statSync(archive).size / 1024).toFixed(0);
  console.log(`Backed up to ${archive} (${size} KB), pruned ${pruned} older than ${KEEP_DAYS} days.`);

  if (process.env.SMB_SHARE) {
    const authFile = path.join(staging, 'smb.auth');
    fs.writeFileSync(
      authFile,
      `username=${process.env.SMB_USER || ''}\npassword=${process.env.SMB_PASS || ''}\n`,
      { mode: 0o600 },
    );
    const folder = process.env.SMB_FOLDER || 'sillyweb';
    const name = path.basename(archive);
    execFileSync('smbclient', [
      process.env.SMB_SHARE, '-A', authFile,
      '-c', `mkdir ${folder}; cd ${folder}; put ${archive} ${name}`,
    ], { stdio: 'pipe' });
    console.log(`Uploaded ${name} to ${process.env.SMB_SHARE}/${folder}.`);
  }
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
}
