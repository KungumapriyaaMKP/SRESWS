import './fonts.css';
import './styles.css';

import Lenis from 'lenis';
import { FilmSequence } from './sequence.js';
import { initUI } from './ui.js';

history.scrollRestoration = 'manual';
window.scrollTo(0, 0);

const lenis = new Lenis({
  lerp: 0.14,
  wheelMultiplier: 1.0,
  touchMultiplier: 1.4,
  smoothWheel: true,
  autoRaf: false,
  respectReducedMotion: true,
});
window.lenis = lenis;
lenis.stop();

const film = new FilmSequence({
  canvas: document.getElementById('filmCanvas'),
  section: document.getElementById('film'),
});

let loom = null;
let loomPromise = null;
function ensureLoom() {
  if (loom?.ready) return Promise.resolve(loom);
  if (loomPromise) return loomPromise;
  loomPromise = import('./loom3d.js')
    .then(({ Loom }) => {
      loom = new Loom({
        canvas: document.getElementById('loomCanvas'),
        section: document.getElementById('loom'),
      });
      return loom.initAsync().then(() => loom);
    })
    .catch((err) => {
      console.error('3D scene failed to initialise', err);
      document.getElementById('loom').classList.add('no-webgl');
      return null;
    });
  return loomPromise;
}

const ui = initUI(lenis, { ensureReady: ensureLoom });

/* ---------- loader ---------- */
const bar = document.getElementById('loaderBar');
const count = document.getElementById('loaderCount');
const loaderEl = document.getElementById('loader');
let shown = 0;
let target = 0;
let loaderDone = false;

function warmDecodeImages() {
  const imgs = [...document.querySelectorAll('img[decoding="async"]')];
  let idx = 0;
  const decodeNext = () => {
    if (idx >= imgs.length) return;
    const img = imgs[idx++];
    const step = () => {
      if (typeof img.decode === 'function') {
        img.decode().catch(() => {}).finally(() => requestAnimationFrame(decodeNext));
      } else {
        requestAnimationFrame(decodeNext);
      }
    };
    if (img.complete) step();
    else img.addEventListener('load', step, { once: true });
  };
  requestAnimationFrame(decodeNext);
}

function tickLoader() {
  shown += (target - shown) * 0.45;
  if (target >= 1 && 1 - shown < 0.03) shown = 1;
  bar.style.transform = `scaleX(${shown})`;
  count.textContent = Math.round(shown * 100);
  if (shown < 1) {
    requestAnimationFrame(tickLoader);
  } else if (!loaderDone) {
    loaderDone = true;
    loaderEl.classList.add('is-done');
    document.body.classList.remove('is-loading');
    document.body.classList.add('is-ready');
    measureAll();
    lenis.start();
    // Defer 3D shader compilation, image pre-decoding, and background frame streaming after first paint
    requestAnimationFrame(() => {
      warmDecodeImages();
      setTimeout(() => {
        ensureLoom().finally(() => film.startBackground());
        setTimeout(() => film.startBackground(), 600);
      }, 40);
    });
  }
}
requestAnimationFrame(tickLoader);

const filmsReady = film.preload((p) => {
  target = Math.max(target, Math.min(p * 0.92, 0.92));
});

const fontsReady = document.fonts?.ready
  ? Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 800))])
  : Promise.resolve();

Promise.all([filmsReady, fontsReady]).then(() => {
  target = 1;
});

/* ---------- layout ---------- */
function measureAll() {
  film.resize();
  if (loom) loom.resize();
  ui.measure();
}

let resizeRaf = 0;
window.addEventListener(
  'resize',
  () => {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      measureAll();
    });
  },
  { passive: true }
);
window.addEventListener('load', measureAll);

/* ---------- main loop ---------- */
let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  lenis.raf(now);
  const y = lenis.scroll ?? window.scrollY;
  film.update(dt, y);
  film.setBackgroundPaused(!film.inView);
  if (loom?.ready) loom.update(dt, y);
  ui.update(dt, y);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
