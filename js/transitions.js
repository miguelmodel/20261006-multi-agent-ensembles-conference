/* ==========================================================================
   transitions.js — GSAP slide transitions, in-slide reveals, chart draw-in.
   Rules: kill tweens on old/new + descendants, position incoming slide before
   it becomes visible, overwrite-safe tweens, clean inline props afterwards.
   ========================================================================== */
import { gsap } from 'gsap';

const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
export const prefersReducedMotion = () => motionQuery.matches;

/* Registry of running animations (anim -> root element) for waitForIdle() */
const running = new Map();

function track(anim, root = null) {
  if (!anim) return anim;
  running.set(anim, root);
  const done = () => running.delete(anim);
  const prevComplete = anim.eventCallback('onComplete');
  anim.eventCallback('onComplete', function onComplete(...args) {
    done();
    if (prevComplete) prevComplete.apply(this, args);
  });
  anim.eventCallback('onInterrupt', done);
  return anim;
}

export function isAnimating() {
  for (const anim of [...running.keys()]) {
    if (anim.progress() >= 1 && !anim.isActive()) running.delete(anim);
  }
  return running.size > 0;
}

/** Selectors GSAP may leave inline props on, with the props that are safe to clear. */
const CLEAR_MAP = [
  ['[data-step]', 'opacity,transform,filter'],
  ['.draw', 'strokeDasharray,strokeDashoffset'],
  ['.draw-fill', 'fillOpacity'],
  ['.pop', 'opacity,transform'],
  ['.th-line, .th-line-glow', 'strokeDasharray,strokeDashoffset'],
  ['.th-dot', 'opacity,transform'],
  ['.th-late, .th-area', 'opacity'],
];

export function resetAnimatedProps(root) {
  if (!root) return;
  for (const [sel, props] of CLEAR_MAP) {
    const els = root.querySelectorAll(sel);
    if (els.length) gsap.set(els, { clearProps: props });
  }
}

export function killDeep(el) {
  if (!el) return;
  gsap.killTweensOf([el, ...el.querySelectorAll('*')]);
  for (const [anim, root] of [...running.entries()]) {
    if (root && (root === el || el.contains(root))) {
      anim.kill();
      running.delete(anim);
    }
  }
}

const SLIDE_PROPS = 'opacity,visibility,transform,zIndex,filter';

/* --------------------------------------------------------------------------
   Slide transitions
   -------------------------------------------------------------------------- */
let activeTransition = null;

/** Jump an in-flight slide transition to its end state (runs its cleanup). */
export function cancelTransition() {
  if (activeTransition) {
    const tl = activeTransition;
    activeTransition = null;
    tl.progress(1);
  }
}

/**
 * Transition between two slide <article>s.
 * @returns {Promise<void>} resolves when the incoming slide is settled.
 */
export function transitionSlides(oldEl, newEl, { direction = 1, instant = false } = {}) {
  cancelTransition();
  return new Promise((resolve) => {
    gsap.killTweensOf([oldEl, newEl].filter(Boolean));
    gsap.set([oldEl, newEl].filter(Boolean), { clearProps: SLIDE_PROPS });

    if (!oldEl || oldEl === newEl || instant || prefersReducedMotion()) {
      if (oldEl && oldEl !== newEl) oldEl.classList.remove('active', 'leaving');
      newEl.classList.remove('leaving');
      newEl.classList.add('active');
      resolve();
      return;
    }

    const type = newEl.dataset.type;
    let fromNew;
    let toOld;
    let duration = 0.6;
    let ease = 'power3.out';
    let overlap = 0.06;

    switch (type) {
      case 'title-slide':
        fromNew = { opacity: 0, scale: 1.05 };
        toOld = { opacity: 0, scale: 0.985 };
        duration = 0.85;
        ease = 'power2.out';
        break;
      case 'transition':
      case 'recap':
        fromNew = { opacity: 0 };
        toOld = { opacity: 0 };
        duration = 0.7;
        ease = 'sine.inOut';
        overlap = 0.12;
        break;
      case 'code-example':
        fromNew = { opacity: 0, scale: 0.985 };
        toOld = { opacity: 0 };
        duration = 0.45;
        ease = 'power2.out';
        break;
      default:
        fromNew = { opacity: 0, x: 96 * direction };
        toOld = { opacity: 0, x: -96 * direction };
        duration = 0.55;
        break;
    }

    // Position the incoming slide BEFORE it becomes visible (no flicker)
    gsap.set(newEl, { ...fromNew, zIndex: 3 });
    oldEl.classList.add('leaving');
    oldEl.classList.remove('active');
    newEl.classList.add('active');

    const tl = gsap.timeline({
      onComplete: () => {
        oldEl.classList.remove('active', 'leaving');
        gsap.set([oldEl, newEl], { clearProps: SLIDE_PROPS });
        if (activeTransition === tl) activeTransition = null;
        resolve();
      },
    });
    tl.to(oldEl, { ...toOld, duration: duration * 0.75, ease: 'power2.in', overwrite: 'auto' }, 0);
    tl.to(newEl, { opacity: 1, x: 0, scale: 1, duration, ease, overwrite: 'auto' }, overlap);
    activeTransition = tl;
    track(tl, null);
  });
}

/* --------------------------------------------------------------------------
   In-slide reveal steps (D3)
   -------------------------------------------------------------------------- */
function pendingOpacity(el) {
  const v = parseFloat(getComputedStyle(el).getPropertyValue('--pending-opacity'));
  return Number.isFinite(v) ? v : 0.17;
}

function geometryLength(el) {
  try {
    if (el && typeof el.getTotalLength === 'function') return el.getTotalLength();
  } catch (_) {
    /* element not rendered */
  }
  return 0;
}

/** Add SVG draw-in (.draw strokes), fill fades (.draw-fill) and pops (.pop) to a timeline. */
export function addDrawIn(tl, root, at = 0) {
  const draws = [...root.querySelectorAll('.draw')];
  draws.forEach((path, i) => {
    const len = geometryLength(path);
    if (!len) return;
    tl.fromTo(
      path,
      { strokeDasharray: `${len} ${len}`, strokeDashoffset: len },
      {
        strokeDashoffset: 0,
        duration: 0.9,
        ease: 'power2.inOut',
        onComplete: () => gsap.set(path, { clearProps: 'strokeDasharray,strokeDashoffset' }),
      },
      at + i * 0.05,
    );
  });
  const fills = [...root.querySelectorAll('.draw-fill')];
  if (fills.length) {
    tl.fromTo(fills, { fillOpacity: 0 }, {
      fillOpacity: 1,
      duration: 0.6,
      ease: 'power1.out',
      onComplete: () => gsap.set(fills, { clearProps: 'fillOpacity' }),
    }, at + 0.35);
  }
  const pops = [...root.querySelectorAll('.pop')];
  if (pops.length) {
    tl.fromTo(pops, { opacity: 0, scale: 0.55, transformOrigin: '50% 50%' }, {
      opacity: 1,
      scale: 1,
      duration: 0.55,
      ease: 'back.out(1.7)',
      stagger: 0.09,
      onComplete: () => gsap.set(pops, { clearProps: 'opacity,transform' }),
    }, at + 0.15);
  }
  return tl;
}

export function revealElement(el, { instant = false } = {}) {
  killDeep(el);
  resetAnimatedProps(el);
  el.classList.remove('is-pending');
  gsap.set(el, { clearProps: 'opacity,transform,filter' });
  if (instant || prefersReducedMotion()) return null;

  const tl = gsap.timeline({
    onComplete: () => gsap.set(el, { clearProps: 'opacity,transform,filter' }),
  });
  tl.fromTo(
    el,
    { opacity: pendingOpacity(el), y: 22, filter: 'grayscale(1)' },
    { opacity: 1, y: 0, filter: 'grayscale(0)', duration: 0.6, ease: 'power2.out', overwrite: 'auto' },
    0,
  );
  addDrawIn(tl, el, 0.05);
  return track(tl, el);
}

export function concealElement(el, { instant = false } = {}) {
  killDeep(el);
  resetAnimatedProps(el);
  if (instant || prefersReducedMotion()) {
    el.classList.add('is-pending');
    gsap.set(el, { clearProps: 'opacity,transform,filter' });
    return null;
  }
  const tw = gsap.to(el, {
    opacity: pendingOpacity(el),
    filter: 'grayscale(1)',
    duration: 0.3,
    ease: 'power1.out',
    overwrite: 'auto',
    onComplete: () => {
      el.classList.add('is-pending');
      gsap.set(el, { clearProps: 'opacity,transform,filter' });
    },
  });
  return track(tw, el);
}

/* --------------------------------------------------------------------------
   Entrance extras (run when a slide is entered with animation)
   -------------------------------------------------------------------------- */
function animateChart(svg) {
  const line = svg.querySelector('.th-line');
  const glow = svg.querySelector('.th-line-glow');
  const dots = [...svg.querySelectorAll('.th-dot')];
  const late = [...svg.querySelectorAll('.th-late')];
  const area = svg.querySelector('.th-area');
  const len = geometryLength(line);
  if (!line || !len || !dots.length) return null;

  // Fraction along the polyline at which each solid-line dot is reached
  const pts = dots.map((d) => [parseFloat(d.getAttribute('cx')), parseFloat(d.getAttribute('cy'))]);
  const seg = [0];
  for (let i = 1; i < pts.length; i += 1) {
    seg.push(seg[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  const total = seg[seg.length - 1] || 1;
  const D = 2.6;
  const lines = [line, glow].filter(Boolean);
  const fades = [...late, area].filter(Boolean);

  gsap.set(lines, { strokeDasharray: `${len} ${len}`, strokeDashoffset: len });
  gsap.set(dots, { opacity: 0, scale: 0.3, transformOrigin: '50% 50%' });
  gsap.set(fades, { opacity: 0 });

  const tl = gsap.timeline({
    delay: 0.35,
    onComplete: () => {
      gsap.set(lines, { clearProps: 'strokeDasharray,strokeDashoffset' });
      gsap.set(dots, { clearProps: 'opacity,transform' });
      gsap.set(fades, { clearProps: 'opacity' });
    },
  });
  tl.to(lines, { strokeDashoffset: 0, duration: D, ease: 'none' }, 0);
  dots.forEach((dot, i) => {
    tl.to(dot, { opacity: 1, scale: 1, duration: 0.35, ease: 'back.out(2.2)' }, (seg[i] / total) * D);
  });
  if (area) tl.to(area, { opacity: 1, duration: 0.8, ease: 'power1.out' }, D * 0.7);
  tl.to(late, { opacity: 1, duration: 0.5, ease: 'power1.out', stagger: 0.12 }, D + 0.1);
  return track(tl, svg);
}

/**
 * Per-slide entrance flourishes. Never runs when instant / reduced motion.
 * - Slide 7: chart line draws left→right, dots appear as reached, labels last.
 * - Stepped slides entered forward at step 1: the step-1 element draws in.
 */
export function runEntrance(slide, { step = 1, instant = false } = {}) {
  if (!slide || instant || prefersReducedMotion()) return;
  const chart = slide.querySelector('svg.th-chart');
  if (chart) animateChart(chart);

  const steps = parseInt(slide.dataset.steps || '1', 10);
  if (steps > 1 && step === 1) {
    const first = [...slide.querySelectorAll('[data-step="1"]')];
    if (first.length) {
      const tl = gsap.timeline({ delay: 0.25 });
      first.forEach((el) => addDrawIn(tl, el, 0));
      track(tl, slide);
    }
  }
}
