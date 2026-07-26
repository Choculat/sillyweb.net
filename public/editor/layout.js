const treeBackdrop = document.getElementById('tree-backdrop');
function closeTreeDrawer() {
  document.getElementById('tree').classList.remove('open');
  treeBackdrop.classList.remove('show');
}
document.getElementById('tree-toggle').addEventListener('click', () => {
  document.getElementById('tree').classList.toggle('open');
  treeBackdrop.classList.toggle('show');
});
treeBackdrop.addEventListener('click', closeTreeDrawer);
document.getElementById('files').addEventListener('click', closeTreeDrawer);

const tree = document.getElementById('tree');
tree.addEventListener('dragover', (e) => { e.preventDefault(); tree.classList.add('dragover'); });
tree.addEventListener('dragleave', () => tree.classList.remove('dragover'));
tree.addEventListener('drop', async (e) => {
  e.preventDefault();
  tree.classList.remove('dragover');
  if (e.dataTransfer.types.includes('application/x-sillyweb-paths')) {
    return moveEntries(JSON.parse(e.dataTransfer.getData('application/x-sillyweb-paths')), '');
  }
  const items = await collectDropped(e.dataTransfer);
  const planned = await resolveConflicts(items, '');
  if (!planned || !planned.length) return;
  const failures = await uploadWithProgress(planned, '');
  await load();
  refreshPreview();
  await reportUploadFailures(failures);
});

const editorPane = document.getElementById('editor-pane');
const previewPane = document.getElementById('preview-pane');
const resizer = document.getElementById('resizer');
const ideMain = document.getElementById('ide-main');

function applyRatio(ratio) {
  editorPane.style.flex = `1 1 ${ratio * 100}%`;
  previewPane.style.flex = `1 1 ${(1 - ratio) * 100}%`;
}

function setViewMode(mode) {
  localStorage.setItem('editorViewMode', mode);
  document.querySelectorAll('.view-mode-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  const showCode = mode !== 'preview';
  const showPreview = mode !== 'code';
  editorPane.style.display = showCode ? 'flex' : 'none';
  previewPane.style.display = showPreview ? 'flex' : 'none';
  resizer.style.display = showCode && showPreview ? 'block' : 'none';
  if (showCode && showPreview) {
    applyRatio(parseFloat(localStorage.getItem('editorSplitRatio')) || 0.5);
  } else {
    (showCode ? editorPane : previewPane).style.flex = '1 1 auto';
  }
}
document.querySelectorAll('.view-mode-btn').forEach((b) => b.addEventListener('click', () => setViewMode(b.dataset.mode)));
setViewMode(localStorage.getItem('editorViewMode') || 'split');

const deviceFrame = document.getElementById('device-frame');

function setPreviewDevice(device) {
  localStorage.setItem('previewDevice', device);
  document.querySelectorAll('.icon-btn').forEach((b) => b.classList.toggle('active', b.dataset.device === device));
  deviceFrame.classList.toggle('mobile', device === 'mobile');
  if (device === 'mobile') {
    deviceFrame.style.width = (localStorage.getItem('mobileFrameWidth') || 390) + 'px';
    deviceFrame.style.height = (localStorage.getItem('mobileFrameHeight') || 844) + 'px';
  } else {
    deviceFrame.style.width = '';
    deviceFrame.style.height = '';
  }
}
document.querySelectorAll('.icon-btn').forEach((b) => b.addEventListener('click', () => setPreviewDevice(b.dataset.device)));
setPreviewDevice(localStorage.getItem('previewDevice') || 'desktop');

let resizingCorner = null;
let resizeStartX, resizeStartY, resizeStartW, resizeStartH;
document.querySelectorAll('.resize-handle').forEach((handle) => {
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    resizingCorner = handle.dataset.corner;
    resizeStartX = e.clientX;
    resizeStartY = e.clientY;
    resizeStartW = deviceFrame.offsetWidth;
    resizeStartH = deviceFrame.offsetHeight;
    setPreviewPointer('none');
    document.body.style.userSelect = 'none';
  });
});
document.addEventListener('mousemove', (e) => {
  if (!resizingCorner) return;
  let dx = e.clientX - resizeStartX;
  let dy = e.clientY - resizeStartY;
  if (resizingCorner === 'tl' || resizingCorner === 'bl') dx = -dx;
  if (resizingCorner === 'tl' || resizingCorner === 'tr') dy = -dy;
  const width = Math.max(240, Math.min(900, resizeStartW + dx * 2));
  const height = Math.max(320, Math.min(1200, resizeStartH + dy * 2));
  deviceFrame.style.width = width + 'px';
  deviceFrame.style.height = height + 'px';
});
document.addEventListener('mouseup', () => {
  if (!resizingCorner) return;
  resizingCorner = null;
  setPreviewPointer('');
  document.body.style.userSelect = '';
  localStorage.setItem('mobileFrameWidth', deviceFrame.offsetWidth);
  localStorage.setItem('mobileFrameHeight', deviceFrame.offsetHeight);
});

let resizing = false;
resizer.addEventListener('mousedown', (e) => {
  resizing = true;
  e.preventDefault();
  setPreviewPointer('none');
  document.body.style.userSelect = 'none';
});
document.addEventListener('mousemove', (e) => {
  if (!resizing) return;
  const rect = ideMain.getBoundingClientRect();
  const ratio = Math.min(0.85, Math.max(0.15, (e.clientX - rect.left) / rect.width));
  applyRatio(ratio);
  localStorage.setItem('editorSplitRatio', ratio);
});
document.addEventListener('mouseup', () => {
  if (!resizing) return;
  resizing = false;
  setPreviewPointer('');
  document.body.style.userSelect = '';
});
