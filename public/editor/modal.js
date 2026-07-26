const SUGGESTED_EXTENSIONS = ['html', 'css', 'js', 'json', 'md', 'svg', 'png', 'jpg', 'txt'];

function showModal({
  title, message, value, placeholder, confirmLabel = 'OK',
  danger = false, suggest = false, submit = null, items = null, dismissOnly = false,
  choices = null, checkboxLabel = null,
}) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('modal-overlay');
    const input = document.getElementById('modal-input');
    const msgEl = document.getElementById('modal-message');
    const errEl = document.getElementById('modal-error');
    const listEl = document.getElementById('modal-suggest');
    const itemsEl = document.getElementById('modal-list');
    const confirmBtn = document.getElementById('modal-confirm');
    const cancelBtn = document.getElementById('modal-cancel');
    const actionsEl = document.getElementById('modal-actions');
    const choicesEl = document.getElementById('modal-choices');
    const applyAllEl = document.getElementById('modal-applyall');
    const applyAllInput = document.getElementById('modal-applyall-input');
    const hasInput = value !== undefined;

    document.getElementById('modal-title').textContent = title;
    if (message) { msgEl.textContent = message; msgEl.style.display = 'block'; } else { msgEl.style.display = 'none'; }
    errEl.style.display = 'none';
    errEl.textContent = '';
    itemsEl.replaceChildren();
    itemsEl.style.display = items && items.length ? 'block' : 'none';
    for (const item of items || []) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'modal-list-name';
      name.textContent = item.name;
      li.appendChild(name);
      if (item.reason) {
        const reason = document.createElement('span');
        reason.className = 'modal-list-reason';
        reason.textContent = item.reason;
        li.appendChild(reason);
      }
      itemsEl.appendChild(li);
    }
    listEl.replaceChildren();
    input.style.display = hasInput ? 'block' : 'none';
    if (hasInput) { input.value = value; input.placeholder = placeholder || ''; }
    confirmBtn.textContent = confirmLabel;
    confirmBtn.classList.toggle('btn-danger', danger);
    cancelBtn.style.display = dismissOnly ? 'none' : 'block';

    actionsEl.style.display = choices ? 'none' : 'flex';
    choicesEl.style.display = choices ? 'flex' : 'none';
    choicesEl.replaceChildren();
    applyAllEl.style.display = checkboxLabel ? 'flex' : 'none';
    applyAllInput.checked = false;
    if (checkboxLabel) document.getElementById('modal-applyall-label').textContent = checkboxLabel;
    for (const choice of choices || []) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = choice.label;
      if (choice.secondary) button.className = 'btn-secondary';
      button.addEventListener('click', () => {
        cleanup({ value: choice.value, applyAll: applyAllInput.checked });
      });
      choicesEl.appendChild(button);
    }
    overlay.style.display = 'flex';
    setTimeout(() => {
      if (choices) choicesEl.lastChild?.focus();
      else if (hasInput) input.focus();
      else confirmBtn.focus();
    }, 0);

    function refreshSuggestions() {
      const base = input.value.trim();
      listEl.replaceChildren();
      if (!base || base.endsWith('/') || base.split('/').pop().includes('.')) return;
      for (const ext of SUGGESTED_EXTENSIONS) {
        const option = document.createElement('option');
        option.value = `${base}.${ext}`;
        listEl.appendChild(option);
      }
    }
    if (suggest) {
      refreshSuggestions();
      input.addEventListener('input', refreshSuggestions);
    }

    function showError(text) {
      errEl.textContent = text;
      errEl.style.display = 'block';
      input.focus();
      input.select();
    }

    function cleanup(result) {
      overlay.style.display = 'none';
      if ([input, confirmBtn, cancelBtn].includes(document.activeElement)) {
        document.activeElement.blur();
      }
      input.removeEventListener('input', refreshSuggestions);
      document.removeEventListener('keydown', onKey, true);
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
      overlay.removeEventListener('mousedown', onOverlayClick);
      resolve(result);
    }

    async function onConfirm() {
      const result = hasInput ? (input.value.trim() || null) : true;
      if (hasInput && !result) return;
      if (submit) {
        confirmBtn.disabled = true;
        const error = await submit(result);
        confirmBtn.disabled = false;
        if (error) return showError(error);
      }
      cleanup(result);
    }
    function onCancel() { cleanup(null); }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
      else if (choices) return;
      else if (e.key === 'Enter' && (!hasInput || document.activeElement === input)) { e.preventDefault(); onConfirm(); }
    }
    function onOverlayClick(e) { if (e.target === overlay) onCancel(); }
    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
    document.addEventListener('keydown', onKey, true);
    overlay.addEventListener('mousedown', onOverlayClick);
  });
}
