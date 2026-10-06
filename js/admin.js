/* ==========================================================================
   admin.js — settings panel: theme, notes, chrome toggles, go-to-slide,
   PDF export, slide checklist (show/hide + ▶ navigate).
   All state changes go through the app API so keyboard, buttons and panel
   share one code path and one persisted value.
   ========================================================================== */

const TITLE_MAX = 46;

function truncate(text, max = TITLE_MAX) {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

export function initAdmin(api) {
  const panel = document.getElementById('admin-panel');
  const overlay = document.getElementById('admin-overlay');
  const gear = document.getElementById('admin-toggle');
  const closeBtn = document.getElementById('admin-close');
  const themeSelect = document.getElementById('theme-select');
  const optNotes = document.getElementById('opt-notes');
  const optNumber = document.getElementById('opt-slide-number');
  const optSection = document.getElementById('opt-section-label');
  const gotoInput = document.getElementById('goto-input');
  const gotoBtn = document.getElementById('goto-btn');
  const exportBtn = document.getElementById('export-pdf');
  const showAllBtn = document.getElementById('show-all');
  const list = document.getElementById('slide-checklist');

  let lastFocus = null;

  /* ---- Theme options --------------------------------------------------- */
  themeSelect.innerHTML = '';
  api.themes.forEach(({ id, label }) => {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = label;
    themeSelect.appendChild(opt);
  });

  /* ---- Checklist rows -------------------------------------------------- */
  list.innerHTML = '';
  api.slideMeta().forEach(({ number, title }) => {
    const li = document.createElement('li');
    li.dataset.slide = String(number);

    const label = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.slide = String(number);
    cb.setAttribute('aria-label', `Show slide ${number} in the presentation`);
    const span = document.createElement('span');
    span.className = 'cl-title';
    const full = `Slide ${number}: ${title}`;
    span.textContent = truncate(full);
    span.title = full;
    label.append(cb, span);

    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'cl-go';
    go.textContent = '▶';
    go.setAttribute('aria-label', `Go to slide ${number}`);
    go.addEventListener('click', () => {
      api.navigateTo(number);
      refresh();
    });

    cb.addEventListener('change', () => {
      api.setSlideHidden(number, !cb.checked);
      refresh();
    });

    li.append(label, go);
    list.appendChild(li);
  });

  /* ---- Controls -------------------------------------------------------- */
  themeSelect.addEventListener('change', () => api.setTheme(themeSelect.value));
  optNotes.addEventListener('change', () => api.setNotes(optNotes.checked));
  optNumber.addEventListener('change', () => api.setShowSlideNumber(optNumber.checked));
  optSection.addEventListener('change', () => api.setShowSectionLabel(optSection.checked));

  const doGoto = () => {
    const n = parseInt(gotoInput.value, 10);
    if (Number.isFinite(n) && n >= 1 && n <= api.total) {
      api.navigateTo(n);
      refresh();
    } else {
      gotoInput.focus();
      gotoInput.select();
    }
  };
  gotoBtn.addEventListener('click', doGoto);
  gotoInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      doGoto();
    }
  });

  exportBtn.addEventListener('click', () => {
    close();
    // Let the panel close before the print dialog snapshots the page
    requestAnimationFrame(() => requestAnimationFrame(() => api.exportPdf()));
  });

  showAllBtn.addEventListener('click', () => {
    api.setHiddenSlides([]);
    refresh();
  });

  /* ---- Open / close ---------------------------------------------------- */
  function isOpen() {
    return document.body.classList.contains('admin-open');
  }

  function open() {
    if (isOpen()) return;
    lastFocus = document.activeElement;
    refresh();
    overlay.hidden = false;
    panel.hidden = false;
    // next frame so the CSS transition runs
    requestAnimationFrame(() => document.body.classList.add('admin-open'));
    gear.setAttribute('aria-expanded', 'true');
    closeBtn.focus({ preventScroll: true });
  }

  function close() {
    if (!isOpen() && panel.hidden) return;
    document.body.classList.remove('admin-open');
    gear.setAttribute('aria-expanded', 'false');
    overlay.hidden = true;
    panel.hidden = true;
    if (lastFocus && typeof lastFocus.focus === 'function' && lastFocus !== document.body) {
      lastFocus.focus({ preventScroll: true });
    } else {
      gear.focus({ preventScroll: true });
    }
    lastFocus = null;
  }

  function toggle() {
    if (isOpen() || !panel.hidden) close();
    else open();
  }

  gear.addEventListener('click', (e) => {
    toggle();
    if (e.detail > 0 && !isOpen()) gear.blur();
  });
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', close);

  // Keep Tab focus inside the panel while open
  panel.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const focusables = [...panel.querySelectorAll('button, input, select, [tabindex]:not([tabindex="-1"])')]
      .filter((el) => !el.disabled && el.offsetParent !== null);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  /* ---- Sync from app state --------------------------------------------- */
  function refresh() {
    const s = api.getState();
    themeSelect.value = s.theme;
    optNotes.checked = s.notesVisible;
    optNumber.checked = s.showSlideNumber;
    optSection.checked = s.showSectionLabel;
    gotoInput.max = String(api.total);
    if (document.activeElement !== gotoInput) gotoInput.value = String(s.current);
    const hidden = new Set(s.hidden);
    list.querySelectorAll('li').forEach((li) => {
      const n = parseInt(li.dataset.slide, 10);
      const cb = li.querySelector('input[type="checkbox"]');
      cb.checked = !hidden.has(n);
      li.classList.toggle('is-hidden', hidden.has(n));
      const current = n === s.current;
      li.classList.toggle('is-current', current);
      if (current) li.setAttribute('aria-current', 'true');
      else li.removeAttribute('aria-current');
    });
  }

  refresh();
  return { open, close, toggle, isOpen: () => isOpen() || !panel.hidden, refresh };
}
