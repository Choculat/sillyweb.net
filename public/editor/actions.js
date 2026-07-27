async function api(url, body, method = 'POST') {
  const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { setError(data.error || 'Something went wrong.'); return null; }
  setError('');
  return data;
}

async function apiError(url, body) {
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (res.ok) return null;
  const data = await res.json().catch(() => ({}));
  return data.error || 'Something went wrong.';
}

// Toolbar / empty-state: create under the selected folder, or the parent of a
// selected file, otherwise at the site root (same idea as most IDEs).
function newItemDir() {
  if (selected.size !== 1) return '';
  const p = [...selected][0];
  if (files.some((f) => f.filename.startsWith(p + '/'))) return p;
  if (files.some((f) => f.filename === p)) {
    return p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
  }
  return p;
}

async function startNew(dir, isFolder) {
  let created = null;
  const name = await showModal({
    title: isFolder ? 'New Folder' : 'New File',
    value: '',
    placeholder: isFolder ? 'e.g. images' : 'e.g. index.html',
    confirmLabel: 'Create',
    suggest: !isFolder,
    submit: async (typed) => {
      const full = dir ? `${dir}/${typed}` : typed;
      const error = isFolder
        ? await apiError(`/api/pages/${pageId}/folders`, { path: full })
        : await apiError(`/api/pages/${pageId}/files/new`, { filename: full });
      if (error) return error;
      created = full;
      return null;
    },
  });
  if (!name || !created) return;
  pushUndo({ type: 'create', filename: created, isFolder });
  if (dir) expanded.add(dir);
  await load();
  if (!isFolder) { const f = files.find((x) => x.filename === created); if (f) openFile(f); }
}

async function startRename(node) {
  const newName = await showModal({ title: 'Rename', value: node.name, confirmLabel: 'Rename' });
  if (!newName || newName === node.name) return;
  const parent = node.path.includes('/') ? node.path.slice(0, node.path.lastIndexOf('/')) : '';
  const to = parent ? `${parent}/${newName}` : newName;
  const wasCurrent = currentFile && (currentFile.filename === node.path || currentFile.filename.startsWith(node.path + '/'));
  const ok = await api(`/api/pages/${pageId}/rename`, { from: node.path, to });
  if (ok) {
    pushUndo({ type: 'rename', moves: [{ from: node.path, to }] });
    if (wasCurrent) currentFile = null;
    await load();
    refreshPreview();
  }
}

async function moveEntries(paths, targetDir) {
  const moves = [];
  for (const from of paths) {
    if (targetDir === from || targetDir.startsWith(from + '/')) {
      setError("Can't move a folder into itself.");
      continue;
    }
    const base = from.includes('/') ? from.slice(from.lastIndexOf('/') + 1) : from;
    const to = targetDir ? `${targetDir}/${base}` : base;
    if (to === from) continue;
    const wasCurrent = currentFile && (currentFile.filename === from || currentFile.filename.startsWith(from + '/'));
    const ok = await api(`/api/pages/${pageId}/rename`, { from, to });
    if (ok) { moves.push({ from, to }); if (wasCurrent) currentFile = null; if (targetDir) expanded.add(targetDir); }
  }
  if (moves.length) {
    pushUndo({ type: 'rename', moves });
    await load();
    refreshPreview();
  }
}

async function triggerDelete(paths, skipConfirm) {
  const targets = paths.filter((p) => !paths.some((q) => q !== p && p.startsWith(q + '/')));
  if (skipConfirm) return doDelete(targets);
  const message = targets.length === 1 ? `Delete "${targets[0]}"?` : `Delete ${targets.length} items?`;
  const ok = await showModal({ title: 'Delete', message, confirmLabel: 'Delete', danger: true });
  if (ok) doDelete(targets);
}

async function doDelete(targets) {
  const trashIds = [];
  for (const p of targets) {
    const result = await api(`/api/pages/${pageId}/delete`, { path: p });
    if (result) trashIds.push(result.trashId);
  }
  if (!trashIds.length) return;
  pushUndo({ type: 'delete', paths: targets, trashIds });
  selected = new Set();
  if (currentFile && targets.some((p) => currentFile.filename === p || currentFile.filename.startsWith(p + '/'))) currentFile = null;
  await load();
  refreshPreview();
}

function pushUndo(action) {
  undoStack.push(action);
  redoStack = [];
}

async function invertRename(moves, reverse) {
  for (const m of moves) {
    const from = reverse ? m.to : m.from;
    const to = reverse ? m.from : m.to;
    const wasCurrent = currentFile && (currentFile.filename === from || currentFile.filename.startsWith(from + '/'));
    const ok = await api(`/api/pages/${pageId}/rename`, { from, to });
    if (ok && wasCurrent) currentFile = null;
  }
}

async function undo() {
  const action = undoStack.pop();
  if (!action) return;
  if (action.type === 'delete') {
    for (const trashId of action.trashIds) await api(`/api/pages/${pageId}/restore`, { trashId });
  } else if (action.type === 'create') {
    const wasCurrent = currentFile && currentFile.filename === action.filename;
    await api(`/api/pages/${pageId}/delete`, { path: action.filename });
    if (wasCurrent) currentFile = null;
  } else if (action.type === 'rename') {
    await invertRename(action.moves, true);
  }
  redoStack.push(action);
  await load();
  refreshPreview();
  flash('Undid');
}

async function redo() {
  const action = redoStack.pop();
  if (!action) return;
  if (action.type === 'delete') {
    const trashIds = [];
    for (const p of action.paths) {
      const result = await api(`/api/pages/${pageId}/delete`, { path: p });
      if (result) trashIds.push(result.trashId);
    }
    action.trashIds = trashIds;
    if (currentFile && action.paths.some((p) => currentFile.filename === p || currentFile.filename.startsWith(p + '/'))) currentFile = null;
  } else if (action.type === 'create') {
    action.isFolder
      ? await api(`/api/pages/${pageId}/folders`, { path: action.filename })
      : await api(`/api/pages/${pageId}/files/new`, { filename: action.filename });
  } else if (action.type === 'rename') {
    await invertRename(action.moves, false);
  }
  undoStack.push(action);
  await load();
  refreshPreview();
  flash('Redid');
}
