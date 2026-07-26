const pageId = location.pathname.split('/').pop();
let username = '';
let currentFile = null;
let files = [];
let savedContent = '';
let dirty = false;
const expanded = new Set();
let selected = new Set();
let anchorPath = null;
let uploadDir = '';
let previewUrl = '';
let siteSuspended = false;
let undoStack = [];
let redoStack = [];

const codeEl = document.getElementById('code');
const monacoContainer = document.getElementById('monaco-container');
const binaryPreview = document.getElementById('binary-preview');
const preview = document.getElementById('preview');
const menu = document.getElementById('context-menu');
const uploadInput = document.getElementById('upload-input');

const setError = (msg) => { document.getElementById('error').textContent = msg || ''; };
function isTextFile(name) { return /\.(html|css|js|txt|json|md|xml|svg)$/i.test(name); }
