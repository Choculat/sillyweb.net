function targetDir(relPath, baseDir) {
  const dirPart = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '';
  return baseDir ? (dirPart ? `${baseDir}/${dirPart}` : baseDir) : dirPart;
}

function targetPath(relPath, baseDir) {
  const dir = targetDir(relPath, baseDir);
  const name = relPath.slice(relPath.lastIndexOf('/') + 1);
  return dir ? `${dir}/${name}` : name;
}

async function resolveConflicts(items, baseDir) {
  const existing = new Set(files.map((f) => f.filename));
  const conflicts = items.filter((it) => existing.has(targetPath(it.relPath, baseDir)));
  if (!conflicts.length) return items;

  const skipped = new Set();
  let applyToRest = null;

  for (let i = 0; i < conflicts.length; i++) {
    const item = conflicts[i];
    let action = applyToRest;
    if (!action) {
      const remaining = conflicts.length - i - 1;
      const answer = await showModal({
        title: 'This file already exists',
        message: targetPath(item.relPath, baseDir),
        checkboxLabel: remaining
          ? `Do the same for the other ${remaining === 1 ? 'file' : `${remaining} files`}`
          : null,
        choices: [
          { label: 'Cancel', value: 'cancel', secondary: true },
          { label: 'Skip', value: 'skip', secondary: true },
          { label: 'Replace', value: 'replace' },
        ],
      });
      if (!answer || answer.value === 'cancel') return null;
      action = answer.value;
      if (answer.applyAll) applyToRest = action;
    }
    if (action === 'skip') skipped.add(item);
  }

  return items.filter((it) => !skipped.has(it));
}

function uploadWithProgress(items, baseDir) {
  const list = document.getElementById('upload-progress');
  const jobs = items.map(({ file, relPath }) => {
    const dir = targetDir(relPath, baseDir);
    const row = document.createElement('div');
    row.className = 'upload-row';
    const name = document.createElement('span');
    name.className = 'upload-name';
    name.textContent = relPath;
    const bar = document.createElement('div');
    bar.className = 'upload-bar';
    const fill = document.createElement('div');
    fill.className = 'upload-fill';
    bar.appendChild(fill);
    row.appendChild(name);
    row.appendChild(bar);
    list.appendChild(row);
    return { file, dir, row, fill };
  });

  const failures = [];
  return Promise.all(jobs.map(({ file, dir, row, fill }) => new Promise((resolve) => {
    const form = new FormData();
    if (dir) form.append('dir', dir);
    form.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/pages/${pageId}/files`);
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) fill.style.width = Math.round((e.loaded / e.total) * 100) + '%';
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        fill.style.width = '100%';
        row.classList.add('done');
      } else {
        row.classList.add('error');
        let reason = 'Upload failed.';
        try { reason = JSON.parse(xhr.responseText).error || reason; } catch {}
        failures.push({ name: file.name, reason });
      }
      setTimeout(() => row.remove(), 1200);
      resolve();
    });
    xhr.addEventListener('error', () => {
      row.classList.add('error');
      failures.push({ name: file.name, reason: 'Upload failed.' });
      setTimeout(() => row.remove(), 1200);
      resolve();
    });
    xhr.send(form);
  }))).then(() => failures);
}

async function reportUploadFailures(failures) {
  if (!failures.length) return;
  const noun = failures.length === 1 ? 'file' : 'files';
  await showModal({
    title: `Couldn't upload ${failures.length} ${noun}`,
    items: failures,
    confirmLabel: 'OK',
    dismissOnly: true,
  });
}

uploadInput.addEventListener('change', async (e) => {
  const items = [...e.target.files].map((file) => ({ file, relPath: file.webkitRelativePath || file.name }));
  const dir = uploadDir;
  e.target.value = '';
  uploadInput.removeAttribute('webkitdirectory');
  const planned = await resolveConflicts(items, dir);
  if (!planned || !planned.length) return;
  const failures = await uploadWithProgress(planned, dir);
  if (dir) expanded.add(dir);
  await load();
  refreshPreview();
  await reportUploadFailures(failures);
});

function readEntry(entry, prefix) {
  return new Promise((resolve) => {
    if (entry.isFile) {
      entry.file((file) => resolve([{ file, relPath: prefix + entry.name }]));
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const nested = [];
      const readBatch = () => reader.readEntries(async (batch) => {
        if (!batch.length) return resolve((await Promise.all(nested)).flat());
        for (const child of batch) nested.push(readEntry(child, prefix + entry.name + '/'));
        readBatch();
      });
      readBatch();
    } else {
      resolve([]);
    }
  });
}

async function collectDropped(dataTransfer) {
  const entries = [...(dataTransfer.items || [])]
    .map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null))
    .filter(Boolean);
  if (!entries.length) return [...dataTransfer.files].map((file) => ({ file, relPath: file.name }));
  return (await Promise.all(entries.map((e) => readEntry(e, '')))).flat();
}
