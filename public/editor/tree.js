function buildTree() {
  const root = { name: '', path: '', type: 'folder', children: new Map() };
  for (const f of files) {
    const parts = f.filename.split('/');
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const here = parts.slice(0, i + 1).join('/');
      if (isLast && part === '.keep') break;
      if (isLast) {
        node.children.set(part, { name: part, path: here, type: 'file', file: f });
      } else {
        if (!node.children.has(part)) node.children.set(part, { name: part, path: here, type: 'folder', children: new Map() });
        node = node.children.get(part);
      }
    }
  }
  return root;
}

function sortedChildren(node) {
  return [...node.children.values()].sort((a, b) =>
    a.type !== b.type ? (a.type === 'folder' ? -1 : 1) : a.name.localeCompare(b.name));
}

let visibleOrder = [];

function renderNode(node, depth, container) {
  for (const child of sortedChildren(node)) {
    visibleOrder.push(child.path);
    const row = document.createElement('div');
    row.className = 'tree-row';
    if (selected.has(child.path)) row.className += ' selected';
    row.style.paddingLeft = indent(depth);
    row.appendChild(iconSpan(child.type === 'folder' ? (expanded.has(child.path) ? '▾' : '▸') : ''));

    const isOpen = child.type === 'file' && currentFile && currentFile.filename === child.file.filename;
    if (isOpen) row.className += ' active';
    const label = document.createElement('span');
    label.className = 'tree-label';
    label.textContent = child.name;
    row.appendChild(label);
    if (isOpen && dirty) {
      const dot = document.createElement('span');
      dot.className = 'tree-dirty';
      row.appendChild(dot);
    }

    row.addEventListener('click', (e) => handleRowClick(child, e));
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (!selected.has(child.path)) { selected = new Set([child.path]); anchorPath = child.path; renderFiles(); }
      showMenu(e, child);
    });

    const dropDir = child.type === 'folder' ? child.path : (child.path.includes('/') ? child.path.slice(0, child.path.lastIndexOf('/')) : '');
    row.draggable = true;
    row.addEventListener('dragstart', (e) => {
      const paths = selected.has(child.path) && selected.size > 1 ? [...selected] : [child.path];
      e.dataTransfer.setData('application/x-sillyweb-paths', JSON.stringify(paths));
      e.dataTransfer.effectAllowed = 'move';
      row.classList.add('dragging');
    });
    row.addEventListener('dragend', () => row.classList.remove('dragging'));
    row.addEventListener('dragover', (e) => {
      if (!e.dataTransfer.types.includes('application/x-sillyweb-paths')) return;
      e.preventDefault();
      e.stopPropagation();
      row.classList.add('drop-target');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-target'));
    row.addEventListener('drop', (e) => {
      if (!e.dataTransfer.types.includes('application/x-sillyweb-paths')) return;
      e.preventDefault();
      e.stopPropagation();
      row.classList.remove('drop-target');
      moveEntries(JSON.parse(e.dataTransfer.getData('application/x-sillyweb-paths')), dropDir);
    });

    container.appendChild(row);

    if (child.type === 'folder' && expanded.has(child.path)) renderNode(child, depth + 1, container);
  }
}

function iconSpan(text) {
  const s = document.createElement('span');
  s.className = 'tree-icon';
  s.textContent = text;
  return s;
}

function handleRowClick(node, e) {
  if (e.shiftKey && anchorPath) {
    const i1 = visibleOrder.indexOf(anchorPath);
    const i2 = visibleOrder.indexOf(node.path);
    if (i1 !== -1 && i2 !== -1) {
      selected = new Set(visibleOrder.slice(Math.min(i1, i2), Math.max(i1, i2) + 1));
      return renderFiles();
    }
  }
  if (e.ctrlKey || e.metaKey) {
    selected.has(node.path) ? selected.delete(node.path) : selected.add(node.path);
    anchorPath = node.path;
    return renderFiles();
  }
  selected = new Set([node.path]);
  anchorPath = node.path;
  if (node.type === 'folder') {
    expanded.has(node.path) ? expanded.delete(node.path) : expanded.add(node.path);
    renderFiles();
  } else {
    openFile(node.file);
  }
}

function renderFiles() {
  const list = document.getElementById('files');
  list.innerHTML = '';
  visibleOrder = [];
  renderNode(buildTree(), 0, list);
}

function showMenu(e, node) {
  const items = [];
  const multi = selected.size > 1 && node && selected.has(node.path);
  if ((!node || node.type === 'folder') && !multi) {
    const base = node ? node.path : '';
    items.push({ label: 'New File', fn: () => startNew(base, false) });
    items.push({ label: 'New Folder', fn: () => startNew(base, true) });
    items.push({ label: 'Upload Files', fn: () => { uploadDir = base; uploadInput.removeAttribute('webkitdirectory'); uploadInput.click(); } });
    items.push({ label: 'Upload Folder', fn: () => { uploadDir = base; uploadInput.setAttribute('webkitdirectory', ''); uploadInput.click(); } });
  }
  if (node) {
    if (!multi) items.push({ label: 'Rename', fn: () => startRename(node) });
    items.push({
      label: multi ? `Delete ${selected.size} items` : 'Delete',
      danger: true,
      fn: (ev) => triggerDelete(multi ? [...selected] : [node.path], ev.shiftKey),
    });
  }
  menu.innerHTML = '';
  for (const it of items) {
    const el = document.createElement('div');
    el.className = 'context-item' + (it.danger ? ' danger' : '');
    el.textContent = it.label;
    el.addEventListener('click', (ev) => { ev.stopPropagation(); hideMenu(); it.fn(ev); });
    menu.appendChild(el);
  }
  menu.style.display = 'block';
  menu.style.left = Math.min(e.clientX, window.innerWidth - menu.offsetWidth - 4) + 'px';
  menu.style.top = Math.min(e.clientY, window.innerHeight - menu.offsetHeight - 4) + 'px';
}
function hideMenu() { menu.style.display = 'none'; }
document.addEventListener('click', hideMenu);
document.addEventListener('scroll', hideMenu, true);
document.getElementById('tree').addEventListener('contextmenu', (e) => {
  if (e.target.closest('.tree-row')) return;
  e.preventDefault();
  showMenu(e, null);
});
