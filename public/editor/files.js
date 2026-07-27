function updateTab() {
  document.getElementById('current-file').textContent =
    currentFile ? currentFile.filename + (dirty ? ' *' : '') : 'Select a file';
}
function setDirty(d) {
  const changed = d !== dirty;
  dirty = d;
  updateTab();
  if (changed) renderFiles();
}

function showEditorPane() {
  document.getElementById('empty-state').style.display = 'none';
}
function showEmptyState() {
  hideCodeEditor();
  binaryPreview.style.display = 'none';
  document.getElementById('empty-state').style.display = 'flex';
  previewFrames.forEach((f) => { f.src = 'about:blank'; });
}

async function openFile(f) {
  currentFile = f;
  dirty = false;
  showEditorPane();
  updateTab();
  renderFiles();
  if (/\.html?$/i.test(f.filename) && f.filename !== previewPath) {
    previewPath = f.filename;
    refreshPreview();
  }
  if (isTextFile(f.filename)) {
    const res = await fetch(`/api/pages/${pageId}/files/${f.id}/content`);
    const data = await res.json();
    savedContent = data.content;
    setCode(data.content);
    setDirty(false);
    showCodeEditor(f.filename);
  } else {
    hideCodeEditor();
    binaryPreview.style.display = 'flex';
    const url = `${previewUrl}${f.filename}`;
    binaryPreview.replaceChildren();
    if (siteSuspended) {
      const note = document.createElement('p');
      note.textContent = 'Preview is unavailable while this site is suspended.';
      binaryPreview.appendChild(note);
      return;
    }
    let node;
    if (f.mime_type.startsWith('image/')) {
      node = document.createElement('img');
      node.src = url;
    } else if (f.mime_type.startsWith('video/')) {
      node = document.createElement('video');
      node.src = url;
      node.controls = true;
    } else {
      node = document.createElement('a');
      node.href = url;
      node.target = '_blank';
      node.textContent = f.filename;
    }
    binaryPreview.appendChild(node);
  }
}

async function load() {
  const meRes = await fetch('/api/me');
  const { user } = await meRes.json();
  if (!user) return location.href = '/signin';
  username = user.username;

  const res = await fetch(`/api/pages/${pageId}`);
  if (!res.ok) return setError('Site not found.');
  const data = await res.json();
  document.getElementById('view-link').href = data.page.publicUrl;
  previewUrl = data.page.previewUrl;
  siteSuspended = Boolean(data.page.suspended);
  const notice = document.getElementById('preview-notice');
  notice.style.display = siteSuspended ? 'block' : 'none';
  notice.textContent = siteSuspended
    ? 'This site is suspended, so it is not being served and cannot be previewed. Your files are safe and still editable. Contact us if you think this is a mistake.'
    : '';
  document.getElementById('device-frame').style.display = siteSuspended ? 'none' : '';
  document.getElementById('tree-usage').textContent =
    `${(Math.max(0, data.usedBytes) / 1048576).toFixed(1)} / ${(data.maxBytes / 1048576).toFixed(0)} MB`;
  files = data.files;
  renderFiles();

  const realFiles = files.filter((f) => !f.filename.endsWith('.keep'));
  if (!realFiles.length) {
    currentFile = null;
    showEmptyState();
    return;
  }
  if (currentFile) {
    const stillThere = files.find((f) => f.filename === currentFile.filename);
    stillThere ? openFile(stillThere) : openFile(realFiles.find((f) => f.filename === 'index.html') || realFiles[0]);
  } else {
    openFile(realFiles.find((f) => f.filename === 'index.html') || realFiles[0]);
  }
  refreshPreview();
}

document.getElementById('empty-create').addEventListener('click', () => startNew('', false));
document.getElementById('new-file').addEventListener('click', () => startNew(newItemDir(), false));
document.getElementById('new-folder').addEventListener('click', () => startNew(newItemDir(), true));

async function save() {
  if (!currentFile || !isTextFile(currentFile.filename)) return true;
  const res = await fetch(`/api/pages/${pageId}/files/${currentFile.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: getCode() }),
  });
  if (res.ok) {
    savedContent = getCode();
    setDirty(false);
    flash('Saved');
    refreshPreview();
    return true;
  }
  flash((await res.json()).error);
  return false;
}

async function publish() {
  if (dirty && !(await save())) return;
  const res = await fetch(`/api/pages/${pageId}/publish`, { method: 'POST' });
  flash(res.ok ? 'Published' : 'Publish failed');
}

document.getElementById('save').addEventListener('click', save);
document.getElementById('publish').addEventListener('click', publish);

document.addEventListener('keydown', (e) => {
  if (document.getElementById('modal-overlay').style.display !== 'none') return;
  const meta = e.ctrlKey || e.metaKey;
  const typing = document.activeElement === codeEl
    || /^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)
    || (monacoEditor && monacoEditor.hasTextFocus());

  if (meta && e.key.toLowerCase() === 's') { e.preventDefault(); save(); return; }
  if (typing) return;

  if (meta && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
  if ((meta && e.key.toLowerCase() === 'y') || (meta && e.shiftKey && e.key.toLowerCase() === 'z')) {
    e.preventDefault(); redo(); return;
  }
  if (e.key === 'Delete' && selected.size) { e.preventDefault(); triggerDelete([...selected], e.shiftKey); }
});
