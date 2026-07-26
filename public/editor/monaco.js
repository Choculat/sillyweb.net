let monacoEditor = null;
const MONACO_LANG = { html: 'html', css: 'css', js: 'javascript', json: 'json', md: 'markdown', xml: 'xml', svg: 'xml', txt: 'plaintext' };
const langFor = (name) => MONACO_LANG[(name.match(/\.([^.]+)$/) || [])[1]] || 'plaintext';
const monacoTheme = () => (document.documentElement.dataset.theme === 'dark' ? 'vs-dark' : 'vs');
const usingFallbackTextarea = () => monacoEditor && document.activeElement === codeEl;

let showFallback = false;
const codeLoading = document.getElementById('code-loading');
setTimeout(() => {
  if (!monacoEditor) {
    showFallback = true;
    if (currentFile && isTextFile(currentFile.filename)) showCodeEditor(currentFile.filename);
  }
}, 4000);

function getCode() { return monacoEditor ? monacoEditor.getValue() : codeEl.value; }
function setCode(v) { monacoEditor ? monacoEditor.setValue(v) : (codeEl.value = v); }
function showCodeEditor(filename) {
  binaryPreview.style.display = 'none';
  if (monacoEditor && !usingFallbackTextarea()) {
    codeLoading.style.display = 'none';
    codeEl.style.display = 'none';
    monacoContainer.style.display = 'block';
    monaco.editor.setModelLanguage(monacoEditor.getModel(), langFor(filename));
  } else if (monacoEditor || showFallback) {
    codeLoading.style.display = 'none';
    codeEl.style.display = 'block';
    monacoContainer.style.display = 'none';
  } else {
    codeEl.style.display = 'none';
    monacoContainer.style.display = 'none';
    codeLoading.style.display = 'flex';
  }
}
function hideCodeEditor() {
  codeEl.style.display = 'none';
  monacoContainer.style.display = 'none';
  codeLoading.style.display = 'none';
}
function onCodeChanged() {
  if (currentFile && isTextFile(currentFile.filename)) setDirty(getCode() !== savedContent);
}
codeEl.addEventListener('input', onCodeChanged);
codeEl.addEventListener('blur', () => {
  if (monacoEditor && codeEl.style.display !== 'none' && currentFile && isTextFile(currentFile.filename)) {
    monacoEditor.setValue(codeEl.value);
    showCodeEditor(currentFile.filename);
  }
});

if (window.require) {
  require.config({ paths: { vs: '/vendor/monaco/vs' } });
  require(['vs/editor/editor.main'], () => {
    monacoEditor = monaco.editor.create(monacoContainer, {
      value: codeEl.value,
      language: currentFile ? langFor(currentFile.filename) : 'plaintext',
      theme: monacoTheme(),
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13,
      fontFamily: "'SF Mono', Menlo, Consolas, monospace",
    });
    monacoEditor.onDidChangeModelContent(onCodeChanged);
    if (currentFile && isTextFile(currentFile.filename)) showCodeEditor(currentFile.filename);
  });
}
document.addEventListener('themechange', (e) => {
  if (monacoEditor) monaco.editor.setTheme(e.detail.theme === 'dark' ? 'vs-dark' : 'vs');
});
function refreshPreview() {
  if (siteSuspended || !previewUrl) return;
  preview.src = `${previewUrl}?t=${Date.now()}`;
}
const indent = (depth) => (0.5 + depth * 0.9) + 'rem';

function flash(msg) {
  const status = document.getElementById('save-status');
  status.textContent = msg;
  setTimeout(() => { if (status.textContent === msg) status.textContent = ''; }, 2000);
}
