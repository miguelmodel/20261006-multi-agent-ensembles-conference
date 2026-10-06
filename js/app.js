/* ==========================================================================
   app.js — deck runtime: slide loading, fixed-canvas scaling, navigation
   with in-slide reveal steps, notes band, persisted settings, print export,
   and the window.__PRESENTATION_TEST__ hook.
   ========================================================================== */
import {
  transitionSlides,
  cancelTransition,
  revealElement,
  concealElement,
  runEntrance,
  killDeep,
  resetAnimatedProps,
  isAnimating,
} from './transitions.js';
import { initAdmin } from './admin.js';

const TOTAL_SLIDES = 26;
const CANVAS_W = 1920;
const CANVAS_H = 1080;

const THEMES = [
  { id: 'ensemble', label: 'Ensemble (default)' },
  { id: 'github-cosmos', label: 'GitHub Cosmos' },
  { id: 'warm', label: 'Warm' },
  { id: 'corporate', label: 'Corporate' },
  { id: 'cyberpunk', label: 'Cyberpunk' },
];
const THEME_IDS = new Set(THEMES.map((t) => t.id));
const DEFAULT_THEME = 'ensemble';

const KEYS = {
  theme: 'pres-theme',
  notes: 'pres-notes',
  hidden: 'pres-hidden-slides',
  current: 'pres-current-slide',
  showNumber: 'pres-show-slide-number',
  showSection: 'pres-show-section-label',
};

const store = {
  get(key) {
    try { return window.localStorage.getItem(key); } catch (_) { return null; }
  },
  set(key, value) {
    try { window.localStorage.setItem(key, value); } catch (_) { /* private mode */ }
  },
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const raf2 = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* --------------------------------------------------------------------------
   State + DOM
   -------------------------------------------------------------------------- */
const state = {
  ready: false,
  slides: [],
  current: 0,
  step: 1,
  theme: DEFAULT_THEME,
  notesVisible: false,
  hidden: new Set(),
  showSlideNumber: true,
  showSectionLabel: true,
  isTransitioning: false,
};

const dom = {
  scaler: document.getElementById('slide-scaler'),
  container: document.getElementById('slide-container'),
  counter: document.getElementById('slide-counter'),
  sectionLabel: document.getElementById('section-label'),
  notes: document.querySelector('.speaker-notes-overlay'),
  notesBody: document.querySelector('.speaker-notes-overlay .sn-body'),
  notesToggle: document.getElementById('notes-toggle'),
  prev: document.getElementById('nav-prev'),
  next: document.getElementById('nav-next'),
};

let admin = null;
let navToken = 0;
let lastStepAt = 0;
let resolveReady;
const readyPromise = new Promise((r) => { resolveReady = r; });

/* --------------------------------------------------------------------------
   Test hook (exposed immediately; `ready` flips to true once slides load)
   -------------------------------------------------------------------------- */
const testApi = {
  ready: false,
  totalSlides: TOTAL_SLIDES,
  whenReady: () => readyPromise,
};
window.__PRESENTATION_TEST__ = testApi;

/* --------------------------------------------------------------------------
   Helpers
   -------------------------------------------------------------------------- */
const currentSlide = () => state.slides[state.current];

function stepCountOf(slide) {
  if (!slide) return 1;
  const n = parseInt(slide.dataset.steps || '1', 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function resolveStep(slide, step) {
  const n = stepCountOf(slide);
  if (step === 'final' || step === 'last') return n;
  const k = parseInt(step, 10);
  return clamp(Number.isFinite(k) ? k : 1, 1, n);
}

function slideTitle(slide) {
  const t = slide?.querySelector('.slide-title');
  return t ? t.textContent.replace(/\s+/g, ' ').trim() : `Slide ${slide?.dataset.number ?? ''}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function findVisible(from, dir) {
  for (let i = from + dir; i >= 0 && i < state.slides.length; i += dir) {
    if (!state.hidden.has(i + 1)) return i;
  }
  return -1;
}

function firstVisible() {
  for (let i = 0; i < state.slides.length; i += 1) if (!state.hidden.has(i + 1)) return i;
  return 0;
}

function lastVisible() {
  for (let i = state.slides.length - 1; i >= 0; i -= 1) if (!state.hidden.has(i + 1)) return i;
  return state.slides.length - 1;
}

/* --------------------------------------------------------------------------
   Slide loading (parallel)
   -------------------------------------------------------------------------- */
function errorSlide(number, error) {
  const a = document.createElement('article');
  a.className = 'slide';
  a.dataset.number = String(number);
  a.dataset.type = 'error';
  a.dataset.section = 'Error';
  a.innerHTML = `<div class="slide-bg"></div><div class="slide-content layout-section">
    <h1 class="slide-title">Slide ${number} failed to load</h1>
    <p class="slide-body">${escapeHtml(error?.message || 'Unknown error')}</p></div>
    <aside class="speaker-notes" hidden><p>Slide file missing.</p></aside>`;
  return a;
}

async function loadSlides() {
  const base = import.meta.env.BASE_URL;
  const results = await Promise.all(
    Array.from({ length: TOTAL_SLIDES }, (_, i) => {
      const padded = String(i + 1).padStart(3, '0');
      return fetch(`${base}slides/slide-${padded}.html`, { cache: 'no-cache' })
        .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status} for slide-${padded}.html`))))
        .catch((error) => ({ error }));
    }),
  );
  const frag = document.createDocumentFragment();
  results.forEach((res, i) => {
    let article = null;
    if (typeof res === 'string') {
      const tpl = document.createElement('template');
      tpl.innerHTML = res;
      article = tpl.content.querySelector('article.slide');
    }
    frag.appendChild(article || errorSlide(i + 1, res && res.error));
  });
  dom.container.appendChild(frag);
  const slides = [...dom.container.querySelectorAll(':scope > article.slide')];
  if (slides.length !== TOTAL_SLIDES) {
    console.error(`[deck] expected ${TOTAL_SLIDES} slides, found ${slides.length}`);
  }
  return slides;
}

/* --------------------------------------------------------------------------
   Fixed canvas scaling (notes band reserves its height)
   -------------------------------------------------------------------------- */
let fitRaf = 0;

function fit() {
  fitRaf = 0;
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = window.innerHeight || document.documentElement.clientHeight;
  const notesH = state.notesVisible ? dom.notes.getBoundingClientRect().height : 0;
  const availH = Math.max(120, vh - notesH);
  const s = Math.max(0.05, Math.min(vw / CANVAS_W, availH / CANVAS_H));
  const left = (vw - CANVAS_W * s) / 2;
  const top = Math.max(0, (availH - CANVAS_H * s) / 2);
  dom.scaler.style.transform = `translate(${left}px, ${top}px) scale(${s})`;
  document.body.style.setProperty('--avail-h', `${availH}px`);
  document.body.style.setProperty('--canvas-scale', String(s));
}

function requestFit() {
  if (fitRaf) cancelAnimationFrame(fitRaf);
  fitRaf = requestAnimationFrame(fit);
}

/* --------------------------------------------------------------------------
   Chrome, notes, settings
   -------------------------------------------------------------------------- */
/**
 * Audience-facing counter (review R1 F6): position within the VISIBLE slide
 * list and that list's length, so hiding a slide reads e.g. "14 / 25".
 * If the presenter jumps explicitly to a hidden slide, it is counted in place.
 * Checklist labels, go-to-slide and notes keep physical source numbers.
 */
function counterParts() {
  const curHidden = state.hidden.has(state.current + 1);
  let before = 0;
  let visibleTotal = 0;
  for (let i = 0; i < state.slides.length; i += 1) {
    if (state.hidden.has(i + 1)) continue;
    visibleTotal += 1;
    if (i < state.current) before += 1;
  }
  return { position: before + 1, total: visibleTotal + (curHidden ? 1 : 0) };
}

function updateChrome() {
  const slide = currentSlide();
  if (!slide) return;
  const { position, total } = counterParts();
  dom.counter.textContent = `${position} / ${total}`;
  dom.sectionLabel.textContent = slide.dataset.section || '';
  dom.scaler.dataset.surface = slide.dataset.surface || 'default';
  dom.scaler.dataset.type = slide.dataset.type || '';
  const atStart = findVisible(state.current, -1) === -1 && state.step <= 1;
  const atEnd = findVisible(state.current, 1) === -1 && state.step >= stepCountOf(slide);
  dom.prev.setAttribute('aria-disabled', String(atStart));
  dom.next.setAttribute('aria-disabled', String(atEnd));
}

function notesHeadHtml() {
  const slide = currentSlide();
  const steps = stepCountOf(slide);
  const stepText = steps > 1 ? ` · Step ${state.step} of ${steps}` : '';
  return `<span>Slide ${state.current + 1} / ${TOTAL_SLIDES}${stepText}</span><span class="sn-meta">${escapeHtml(slideTitle(slide))}</span>`;
}

function updateNotes({ bodyToo = true } = {}) {
  const slide = currentSlide();
  if (!slide) return;
  let head = dom.notesBody.querySelector('.sn-head');
  let content = dom.notesBody.querySelector('.sn-content');
  if (!head || !content) {
    dom.notesBody.innerHTML = '<div class="sn-head"></div><div class="sn-content"></div>';
    head = dom.notesBody.querySelector('.sn-head');
    content = dom.notesBody.querySelector('.sn-content');
  }
  head.innerHTML = notesHeadHtml();
  if (bodyToo) {
    const src = slide.querySelector('.speaker-notes');
    content.innerHTML = src ? src.innerHTML : '<p>No speaker notes for this slide.</p>';
    dom.notes.scrollTop = 0;
  }
}

function setNotes(visible) {
  state.notesVisible = !!visible;
  dom.notes.classList.toggle('visible', state.notesVisible);
  document.body.classList.toggle('notes-visible', state.notesVisible);
  dom.notesToggle.setAttribute('aria-pressed', String(state.notesVisible));
  dom.notesToggle.setAttribute('aria-label', state.notesVisible ? 'Hide speaker notes (N)' : 'Show speaker notes (N)');
  store.set(KEYS.notes, String(state.notesVisible));
  fit();
  requestFit();
  admin?.refresh();
}

function setTheme(id, { persist = true } = {}) {
  const theme = THEME_IDS.has(id) ? id : DEFAULT_THEME;
  state.theme = theme;
  document.documentElement.dataset.theme = theme;
  if (persist) store.set(KEYS.theme, theme);
  admin?.refresh();
}

function setShowSlideNumber(v) {
  state.showSlideNumber = !!v;
  document.body.classList.toggle('hide-slide-number', !state.showSlideNumber);
  store.set(KEYS.showNumber, String(state.showSlideNumber));
  admin?.refresh();
}

function setShowSectionLabel(v) {
  state.showSectionLabel = !!v;
  document.body.classList.toggle('hide-section-label', !state.showSectionLabel);
  store.set(KEYS.showSection, String(state.showSectionLabel));
  admin?.refresh();
}

function persistHidden() {
  store.set(KEYS.hidden, JSON.stringify([...state.hidden].sort((a, b) => a - b)));
}

function setHiddenSlides(list) {
  state.hidden = new Set(
    (Array.isArray(list) ? list : [])
      .map((n) => parseInt(n, 10))
      .filter((n) => Number.isFinite(n) && n >= 1 && n <= TOTAL_SLIDES),
  );
  persistHidden();
  updateChrome();
  admin?.refresh();
}

function setSlideHidden(n, hidden) {
  const num = parseInt(n, 10);
  if (!Number.isFinite(num) || num < 1 || num > TOTAL_SLIDES) return;
  if (hidden) state.hidden.add(num);
  else state.hidden.delete(num);
  persistHidden();
  updateChrome();
  admin?.refresh();
}

/* --------------------------------------------------------------------------
   Reveal steps
   -------------------------------------------------------------------------- */
function applyStepState(slide, step) {
  slide.querySelectorAll('[data-step]').forEach((el) => {
    const k = parseInt(el.dataset.step, 10) || 1;
    el.classList.toggle('is-pending', k > step);
  });
}

function setStep(k, { animate = true } = {}) {
  const slide = currentSlide();
  if (!slide) return;
  const target = resolveStep(slide, k);
  if (target === state.step) return;
  const forward = target > state.step;

  if (!animate || Math.abs(target - state.step) > 1) {
    slide.querySelectorAll('[data-step]').forEach((el) => {
      killDeep(el);
      resetAnimatedProps(el);
    });
    applyStepState(slide, target);
  } else if (forward) {
    slide.querySelectorAll(`[data-step="${target}"]`).forEach((el) => revealElement(el));
  } else {
    slide.querySelectorAll(`[data-step="${state.step}"]`).forEach((el) => concealElement(el));
  }
  state.step = target;
  updateChrome();
  updateNotes({ bodyToo: false });
}

/* --------------------------------------------------------------------------
   Navigation (single code path for keys, arrows, swipe, panel, test API)
   -------------------------------------------------------------------------- */
async function goTo(index, { direction = 1, step = 1, instant = false } = {}) {
  if (!state.ready && !instant) return;
  if (index < 0 || index >= state.slides.length) return;
  const token = ++navToken;
  const oldEl = currentSlide();
  const newEl = state.slides[index];
  const targetStep = resolveStep(newEl, step);

  if (index === state.current) {
    cancelTransition();
    killDeep(newEl);
    resetAnimatedProps(newEl);
    applyStepState(newEl, targetStep);
    state.step = targetStep;
    state.slides.forEach((s) => {
      s.classList.toggle('active', s === newEl);
      s.classList.remove('leaving');
    });
    updateChrome();
    updateNotes({ bodyToo: false });
    store.set(KEYS.current, String(index + 1));
    admin?.refresh();
    if (!instant) runEntrance(newEl, { step: targetStep });
    return;
  }

  state.isTransitioning = true;
  cancelTransition();
  state.slides.forEach((s) => {
    if (s !== oldEl && s !== newEl) s.classList.remove('active', 'leaving');
  });
  if (oldEl) killDeep(oldEl);
  killDeep(newEl);
  resetAnimatedProps(newEl);
  applyStepState(newEl, targetStep);

  state.current = index;
  state.step = targetStep;
  updateChrome();
  updateNotes();
  store.set(KEYS.current, String(index + 1));
  admin?.refresh();

  const done = transitionSlides(oldEl, newEl, { direction, instant });
  runEntrance(newEl, { step: targetStep, instant });
  await done;
  if (oldEl && oldEl !== newEl) resetAnimatedProps(oldEl);
  if (!instant) await wait(90);
  if (token === navToken) state.isTransitioning = false;
}

function next() {
  if (!state.ready || state.isTransitioning) return;
  const slide = currentSlide();
  if (state.step < stepCountOf(slide)) {
    const now = performance.now();
    if (now - lastStepAt < 110) return; // swallow key auto-repeat floods
    lastStepAt = now;
    setStep(state.step + 1);
    return;
  }
  const target = findVisible(state.current, 1);
  if (target === -1) return;
  goTo(target, { direction: 1, step: 1 });
}

function prev() {
  if (!state.ready || state.isTransitioning) return;
  if (state.step > 1) {
    const now = performance.now();
    if (now - lastStepAt < 110) return;
    lastStepAt = now;
    setStep(state.step - 1);
    return;
  }
  const target = findVisible(state.current, -1);
  if (target === -1) return;
  goTo(target, { direction: -1, step: 'final' });
}

/** Jump to a 1-based slide number at step 1 (Home/End/go-to/checklist). */
function navigateTo(n) {
  const index = clamp(parseInt(n, 10) - 1, 0, state.slides.length - 1);
  if (!Number.isFinite(index)) return;
  const direction = index >= state.current ? 1 : -1;
  goTo(index, { direction, step: 1 });
}

function toggleFullscreen() {
  const d = document;
  const el = d.documentElement;
  const fsEl = d.fullscreenElement || d.webkitFullscreenElement;
  try {
    if (fsEl) {
      const exit = d.exitFullscreen || d.webkitExitFullscreen;
      const p = exit && exit.call(d);
      if (p && p.catch) p.catch(() => {});
    } else {
      const req = el.requestFullscreen || el.webkitRequestFullscreen;
      const p = req && req.call(el);
      if (p && p.catch) p.catch(() => {});
    }
  } catch (_) {
    /* fullscreen unavailable */
  }
}

/* --------------------------------------------------------------------------
   Print / PDF export
   -------------------------------------------------------------------------- */
const PRINT_PROPS = [
  'opacity', 'visibility', 'transform', 'translate', 'scale', 'rotate', 'filter',
  'z-index', 'stroke-dasharray', 'stroke-dashoffset', 'fill-opacity',
];
let printSaved = null;

function preparePrint() {
  if (printSaved || !state.slides.length) return;
  cancelTransition();
  state.slides.forEach((s) => {
    killDeep(s);
    resetAnimatedProps(s);
  });
  printSaved = [];
  const targets = new Set([...state.slides, ...dom.container.querySelectorAll('[style]')]);
  targets.forEach((el) => {
    printSaved.push([el, el.getAttribute('style')]);
    PRINT_PROPS.forEach((p) => el.style.removeProperty(p));
  });
  let lastPrintable = null;
  state.slides.forEach((s, i) => {
    const hide = state.hidden.has(i + 1);
    s.classList.toggle('print-hidden', hide);
    s.classList.remove('print-last');
    if (!hide) lastPrintable = s;
  });
  if (lastPrintable) lastPrintable.classList.add('print-last');
  document.body.classList.add('printing');
}

function restorePrint() {
  if (!printSaved) return;
  printSaved.forEach(([el, style]) => {
    if (style == null) el.removeAttribute('style');
    else el.setAttribute('style', style);
  });
  printSaved = null;
  state.slides.forEach((s, i) => {
    s.classList.remove('print-hidden', 'print-last', 'leaving');
    s.classList.toggle('active', i === state.current);
  });
  document.body.classList.remove('printing');
  state.isTransitioning = false;
  requestFit();
}

function exportPdf() {
  preparePrint();
  window.print();
}

/* --------------------------------------------------------------------------
   Input bindings
   -------------------------------------------------------------------------- */
function isFormField(t) {
  if (!t || !t.tagName) return false;
  return ['INPUT', 'SELECT', 'TEXTAREA'].includes(t.tagName) || t.isContentEditable;
}

function onKeyDown(e) {
  if (e.defaultPrevented) return;
  if (e.key === 'Escape') {
    if (admin?.isOpen()) {
      e.preventDefault();
      admin.close();
    }
    return;
  }
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  if (isFormField(e.target)) return;
  const inPanel = e.target.closest && e.target.closest('#admin-panel');
  if ((e.key === ' ' || e.key === 'Enter') && e.target.closest && e.target.closest('button')) return;

  switch (e.key) {
    case 'a':
    case 'A':
      e.preventDefault();
      admin?.toggle();
      return;
    default:
      break;
  }
  if (inPanel || admin?.isOpen()) return;

  switch (e.key) {
    case 'ArrowRight':
    case 'ArrowDown':
    case ' ':
    case 'Spacebar':
    case 'PageDown':
      e.preventDefault();
      next();
      break;
    case 'ArrowLeft':
    case 'ArrowUp':
    case 'PageUp':
      e.preventDefault();
      prev();
      break;
    case 'Home':
      e.preventDefault();
      navigateTo(firstVisible() + 1);
      break;
    case 'End':
      e.preventDefault();
      navigateTo(lastVisible() + 1);
      break;
    case 'f':
    case 'F':
      e.preventDefault();
      toggleFullscreen();
      break;
    case 'n':
    case 'N':
      e.preventDefault();
      setNotes(!state.notesVisible);
      break;
    default:
      break;
  }
}

function bindInputs() {
  document.addEventListener('keydown', onKeyDown);

  const blurOnMouse = (btn, fn) => btn.addEventListener('click', (e) => {
    fn();
    if (e.detail > 0) btn.blur();
  });
  blurOnMouse(dom.prev, prev);
  blurOnMouse(dom.next, next);
  blurOnMouse(dom.notesToggle, () => setNotes(!state.notesVisible));

  // Touch swipe (~50px threshold)
  let touch = null;
  document.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || admin?.isOpen()) { touch = null; return; }
    if (e.target.closest('.speaker-notes-overlay, #admin-panel')) { touch = null; return; }
    touch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, { passive: true });
  document.addEventListener('touchend', (e) => {
    if (!touch) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touch.x;
    const dy = t.clientY - touch.y;
    touch = null;
    if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) next();
      else prev();
    }
  }, { passive: true });

  // Edge-proximity arrows + idle chrome
  let idleTimer = 0;
  const markActive = () => {
    document.body.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => document.body.classList.add('idle'), 2600);
  };
  document.addEventListener('mousemove', (e) => {
    markActive();
    const w = window.innerWidth;
    document.body.classList.toggle('near-left', e.clientX < 150);
    document.body.classList.toggle('near-right', e.clientX > w - 150);
  }, { passive: true });
  document.documentElement.addEventListener('mouseleave', () => {
    document.body.classList.remove('near-left', 'near-right');
  });
  markActive();

  window.addEventListener('resize', requestFit);
  document.addEventListener('fullscreenchange', requestFit);
  document.addEventListener('webkitfullscreenchange', requestFit);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', requestFit);
  if ('ResizeObserver' in window) new ResizeObserver(requestFit).observe(dom.notes);

  window.addEventListener('beforeprint', preparePrint);
  window.addEventListener('afterprint', restorePrint);
  const printMq = window.matchMedia('print');
  const onPrintChange = (e) => { if (!e.matches) restorePrint(); };
  if (printMq.addEventListener) printMq.addEventListener('change', onPrintChange);
  else if (printMq.addListener) printMq.addListener(onPrintChange);
}

/* --------------------------------------------------------------------------
   Idle detection for tests
   -------------------------------------------------------------------------- */
async function waitForImages(slide, ms = 4000) {
  const imgs = slide ? [...slide.querySelectorAll('img')] : [];
  const pending = imgs.filter((img) => !img.complete).map((img) => new Promise((r) => {
    img.addEventListener('load', r, { once: true });
    img.addEventListener('error', r, { once: true });
  }));
  if (pending.length) await Promise.race([Promise.all(pending), wait(ms)]);
}

async function waitForIdle(timeout = 12000) {
  const start = performance.now();
  await readyPromise;
  if (document.fonts && document.fonts.ready) {
    await Promise.race([document.fonts.ready, wait(4000)]).catch(() => {});
  }
  while (performance.now() - start < timeout) {
    if (state.ready && !state.isTransitioning && !isAnimating()) break;
    await wait(40);
  }
  await waitForImages(currentSlide());
  await raf2();
  return true;
}

function publicState() {
  return {
    ready: state.ready,
    current: state.current + 1,
    total: TOTAL_SLIDES,
    step: state.step,
    steps: stepCountOf(currentSlide()),
    theme: state.theme,
    notesVisible: state.notesVisible,
    hidden: [...state.hidden].sort((a, b) => a - b),
    showSlideNumber: state.showSlideNumber,
    showSectionLabel: state.showSectionLabel,
    isTransitioning: state.isTransitioning,
    counter: dom.counter.textContent,
    title: slideTitle(currentSlide()),
    section: currentSlide()?.dataset.section || '',
    type: currentSlide()?.dataset.type || '',
  };
}

/* --------------------------------------------------------------------------
   Init
   -------------------------------------------------------------------------- */
async function init() {
  const params = new URLSearchParams(window.location.search);

  const themeParam = params.get('theme');
  if (themeParam && THEME_IDS.has(themeParam)) setTheme(themeParam, { persist: false });
  else setTheme(store.get(KEYS.theme) || DEFAULT_THEME);

  setShowSlideNumber(store.get(KEYS.showNumber) !== 'false');
  setShowSectionLabel(store.get(KEYS.showSection) !== 'false');
  try {
    const raw = JSON.parse(store.get(KEYS.hidden) || '[]');
    state.hidden = new Set((Array.isArray(raw) ? raw : [])
      .map((n) => parseInt(n, 10))
      .filter((n) => Number.isFinite(n) && n >= 1 && n <= TOTAL_SLIDES));
  } catch (_) {
    state.hidden = new Set();
  }

  fit();
  state.slides = await loadSlides();
  state.slides.forEach((s) => applyStepState(s, 1));

  const startNum = clamp(parseInt(params.get('slide') || store.get(KEYS.current) || '1', 10) || 1, 1, state.slides.length);
  const startIndex = startNum - 1;
  const startEl = state.slides[startIndex];
  state.current = startIndex;
  state.step = resolveStep(startEl, params.get('step') || 1);
  applyStepState(startEl, state.step);
  startEl.classList.add('active');
  store.set(KEYS.current, String(startNum));

  updateChrome();
  updateNotes();

  admin = initAdmin({
    total: TOTAL_SLIDES,
    themes: THEMES,
    slideMeta: () => state.slides.map((s, i) => ({ number: i + 1, title: slideTitle(s) })),
    getState: publicState,
    setTheme: (id) => setTheme(id),
    setNotes,
    setShowSlideNumber,
    setShowSectionLabel,
    setSlideHidden,
    setHiddenSlides,
    navigateTo,
    exportPdf,
  });

  setNotes(params.get('notes') === '1' || store.get(KEYS.notes) === 'true');
  bindInputs();
  fit();

  state.ready = true;
  runEntrance(startEl, { step: state.step });

  Object.assign(testApi, {
    ready: true,
    goToSlideInstant: async (n, step) => {
      const index = clamp(parseInt(n, 10) - 1, 0, state.slides.length - 1);
      await goTo(index, { direction: 1, step: step == null ? 1 : step, instant: true });
      await raf2();
      return publicState();
    },
    goToSlide: (n) => navigateTo(n),
    next,
    prev,
    waitForIdle,
    getState: publicState,
    getCurrentSlide: () => state.current + 1,
    getThemes: () => THEMES.map((t) => t.id),
    setTheme: (id) => { setTheme(id); return state.theme; },
    getTheme: () => state.theme,
    setNotes: (v) => { setNotes(v); return state.notesVisible; },
    setNotesVisible: (v) => { setNotes(v); return state.notesVisible; },
    setHiddenSlides: (list) => { setHiddenSlides(list); return [...state.hidden]; },
    setSlideHidden: (n, hidden = true) => { setSlideHidden(n, hidden); return [...state.hidden]; },
    setShowSlideNumber: (v) => { setShowSlideNumber(v); return state.showSlideNumber; },
    setShowSectionLabel: (v) => { setShowSectionLabel(v); return state.showSectionLabel; },
    setStep: (k, opts = {}) => { setStep(k, { animate: !!opts.animate }); return state.step; },
    getStep: () => state.step,
    getStepCount: (n) => stepCountOf(n == null ? currentSlide() : state.slides[parseInt(n, 10) - 1]),
    preparePrint,
    restorePrint,
    printPrepare: preparePrint,
    printRestore: restorePrint,
  });
  resolveReady(true);
}

init().catch((err) => {
  console.error('[deck] init failed', err);
});
