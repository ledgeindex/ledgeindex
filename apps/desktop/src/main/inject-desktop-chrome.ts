/**
 * Inject a always-on desktop chrome bar into whatever page is showing.
 * Uses window.ledgeindexDesktop from preload when available.
 */
export const INJECT_DESKTOP_CHROME_SCRIPT = `
(() => {
  try {
    if (document.getElementById('li-desktop-chrome')) return true;
    const api = window.ledgeindexDesktop;
    window.__LEDGEINDEX_DESKTOP__ = true;

    const bar = document.createElement('div');
    bar.id = 'li-desktop-chrome';
    bar.setAttribute('style', [
      'position:fixed',
      'top:0',
      'left:0',
      'right:0',
      'height:36px',
      'z-index:2147483646',
      'display:flex',
      'align-items:center',
      'gap:8px',
      'padding:0 8px 0 12px',
      'box-sizing:border-box',
      'background:rgba(20,20,22,0.94)',
      'border-bottom:1px solid rgba(255,255,255,0.1)',
      'color:#e8eaed',
      'font:600 12px/1 Segoe UI,system-ui,sans-serif',
      'user-select:none',
      '-webkit-app-region:drag'
    ].join(';'));

    const title = document.createElement('span');
    title.textContent = 'LedgeIndex';
    title.style.opacity = '0.9';
    bar.appendChild(title);

    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    bar.appendChild(spacer);

    const mkBtn = (label, titleText, onClick, danger) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.title = titleText;
      b.setAttribute('style', [
        'height:28px',
        'min-width:28px',
        'padding:0 8px',
        'border-radius:6px',
        'border:1px solid rgba(255,255,255,0.14)',
        'background:' + (danger ? 'rgba(232,17,35,0.15)' : 'rgba(255,255,255,0.06)'),
        'color:#e8eaed',
        'cursor:pointer',
        '-webkit-app-region:no-drag',
        'font:600 11px/1 Segoe UI,system-ui,sans-serif'
      ].join(';'));
      b.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      });
      return b;
    };

    if (api) {
      bar.appendChild(mkBtn('↻', 'Reload', () => location.reload()));
      bar.appendChild(mkBtn('Dev', 'Toggle DevTools (right)', () => {
        void api.toggleDevTools();
      }));
      if (api.platform !== 'darwin') {
        bar.appendChild(mkBtn('—', 'Minimize', () => { void api.minimizeWindow(); }));
        bar.appendChild(mkBtn('□', 'Maximize', () => { void api.toggleMaximizeWindow(); }));
        bar.appendChild(mkBtn('✕', 'Close', () => { void api.closeWindow(); }, true));
      }
    } else {
      const warn = document.createElement('span');
      warn.textContent = 'no preload';
      warn.style.opacity = '0.5';
      warn.style.webkitAppRegion = 'no-drag';
      bar.appendChild(warn);
    }

    const root = document.documentElement;
    root.style.setProperty('--li-desktop-chrome-height', '36px');
    if (document.body) {
      const pad = getComputedStyle(document.body).paddingTop;
      // only bump if we haven't already
      if (!root.dataset.liChromePad) {
        root.dataset.liChromePad = '1';
        document.body.style.paddingTop = '36px';
      }
    }

    (document.body || root).appendChild(bar);
    return Boolean(api);
  } catch (err) {
    console.error('[li-desktop-chrome]', err);
    return false;
  }
})();
`

export const MARK_DESKTOP_SCRIPT = `
(() => { window.__LEDGEINDEX_DESKTOP__ = true; return true; })();
`
