(function () {
  const root = document.documentElement;
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const systemTheme = () => (media.matches ? 'dark' : 'light');

  function apply() {
    const pref = localStorage.getItem('theme') || 'system';
    root.dataset.theme = pref === 'system' ? systemTheme() : pref;
    document.dispatchEvent(new CustomEvent('themechange', { detail: { theme: root.dataset.theme } }));
  }

  function sync() {
    const pref = localStorage.getItem('theme') || 'system';
    document.querySelectorAll('.theme-select').forEach((el) => { el.value = pref; });
  }

  window.setTheme = function (pref) {
    if (pref === 'system') localStorage.removeItem('theme'); else localStorage.setItem('theme', pref);
    apply();
    sync();
  };

  apply();
  media.addEventListener('change', () => { if (!localStorage.getItem('theme')) { apply(); sync(); } });

  document.addEventListener('change', (e) => {
    if (e.target.classList.contains('theme-select')) window.setTheme(e.target.value);
  });
  document.addEventListener('DOMContentLoaded', sync);
})();
