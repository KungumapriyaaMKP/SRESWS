import { clamp, smoothstep, pad, applyChapter } from './utils.js';

/**
 * Scroll driven image sequence.
 * Two films are played back to back on one canvas. Adjacent frames are
 * blended for sub-frame smoothness and the films cross-dissolve where they meet.
 *
 * Uses priority streaming, off-main-thread createImageBitmap decoding, and
 * bounded LRU bitmap caching to eliminate initial load stalls and scroll jank.
 */

const FILMS = [
  { dir: 'v1', count: 188, alignY: 0.35 },
  { dir: 'v2', count: 188, alignY: 0.0 },
];
const X0 = 0.47; // cross dissolve window
const X1 = 0.53;
const PIN_STRIDE = 12;
const MAX_LIVE_BITMAPS = 140;
const CAN_BITMAP = typeof window !== 'undefined' && typeof window.createImageBitmap === 'function';

export class FilmSequence {
  constructor({ canvas, section }) {
    this.canvas = canvas;
    this.section = section;
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    this.size = this.pickSize();
    this.films = FILMS.map((f) => ({
      ...f,
      frames: new Array(f.count).fill(null),
      blobs: new Array(f.count).fill(null),
      inflight: new Array(f.count).fill(null),
      decoding: new Array(f.count).fill(null),
    }));
    this.liveQueue = []; // LRU slots [fi, i] of non-pinned decoded bitmaps
    this.progress = 0;
    this.smooth = 0;
    this.scrollDir = 1;
    this.lastDrawn = -1;
    this.lastFrameNo = -1;
    this.lastUiP = -1;
    this.chapters = [...section.querySelectorAll('.film__chapter')];
    this.rail = document.getElementById('filmRail');
    this.frameLabel = document.getElementById('filmFrame');
    this.cue = document.getElementById('scrollCue');
    this.shade = section.querySelector('.film__shade');
    this.grain = section.querySelector('.film__grain');
    this.grainPaused = false;
    this.isDesktop = window.innerWidth > 820;
    document.getElementById('filmTotal').textContent = pad(FILMS[0].count + FILMS[1].count);
    this.resize();
  }

  pickSize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w <= 900 || navigator.connection?.saveData) return 'sm';
    const px = Math.max(w, h * (16 / 9)) * Math.min(window.devicePixelRatio || 1, 1.5);
    return px > 1360 ? 'lg' : 'sm';
  }

  src(film, i) {
    return `/frames/${film.dir}-${this.size}/${pad(i + 1)}.webp`;
  }

  isPinned(i) {
    return i === 0 || i === 187 || i % PIN_STRIDE === 0;
  }

  touchBitmap(fi, i, bmp) {
    const film = this.films[fi];
    film.frames[i] = bmp;
    if (!this.iw && bmp) {
      this.iw = bmp.width || bmp.naturalWidth;
      this.ih = bmp.height || bmp.naturalHeight;
      this.computeCover();
    }
    if (!CAN_BITMAP || this.isPinned(i)) return;
    const key = fi * 1000 + i;
    const prevIdx = this.liveQueue.indexOf(key);
    if (prevIdx !== -1) this.liveQueue.splice(prevIdx, 1);
    this.liveQueue.push(key);
    this.evictIfNeeded();
  }

  evictIfNeeded() {
    if (!CAN_BITMAP || this.liveQueue.length <= MAX_LIVE_BITMAPS) return;
    // Evict farthest from active playhead rather than oldest only
    const p = this.progress;
    const [f1, f2] = this.films;
    const curPos = p < X1 ? (p / X1) * (f1.count - 1) : f1.count + ((p - X0) / (1 - X0)) * (f2.count - 1);
    while (this.liveQueue.length > MAX_LIVE_BITMAPS) {
      let worstIdx = 0;
      let worstDist = -1;
      for (let q = 0; q < Math.min(this.liveQueue.length, 24); q++) {
        const key = this.liveQueue[q];
        const fi = key >= 1000 ? 1 : 0;
        const idx = key % 1000;
        const absIdx = fi === 0 ? idx : f1.count + idx;
        const dist = Math.abs(absIdx - curPos);
        if (dist > worstDist) {
          worstDist = dist;
          worstIdx = q;
        }
      }
      const [evictKey] = this.liveQueue.splice(worstIdx, 1);
      const fi = evictKey >= 1000 ? 1 : 0;
      const idx = evictKey % 1000;
      const bmp = this.films[fi].frames[idx];
      if (bmp && typeof bmp.close === 'function') {
        bmp.close();
      }
      this.films[fi].frames[idx] = null;
    }
  }

  decodeFromBlob(fi, i) {
    const film = this.films[fi];
    if (film.frames[i]) return Promise.resolve(film.frames[i]);
    if (film.decoding[i]) return film.decoding[i];
    const blob = film.blobs[i];
    if (!blob) return Promise.resolve(null);
    const prom = createImageBitmap(blob)
      .then((bmp) => {
        this.touchBitmap(fi, i, bmp);
        film.decoding[i] = null;
        return bmp;
      })
      .catch(() => {
        film.decoding[i] = null;
        return null;
      });
    film.decoding[i] = prom;
    return prom;
  }

  loadFrame(fi, i) {
    const film = this.films[fi];
    if (film.frames[i]) return Promise.resolve();
    if (film.blobs[i] && CAN_BITMAP) return this.decodeFromBlob(fi, i);
    if (film.inflight[i]) return film.inflight[i];

    const url = this.src(film, i);
    let prom;
    if (CAN_BITMAP) {
      prom = fetch(url, { priority: i === 0 && fi === 0 ? 'high' : 'auto' })
        .then((res) => (res.ok ? res.blob() : null))
        .then((blob) => {
          if (!blob) return null;
          film.blobs[i] = blob;
          return this.decodeFromBlob(fi, i);
        })
        .catch(() => null)
        .finally(() => {
          film.inflight[i] = null;
        });
    } else {
      prom = new Promise((resolve) => {
        const img = new Image();
        img.decoding = 'async';
        img.src = url;
        const done = () => {
          this.touchBitmap(fi, i, img);
          film.inflight[i] = null;
          resolve(img);
        };
        img.onload = () => (img.decode ? img.decode().then(done, done) : done());
        img.onerror = () => {
          film.inflight[i] = null;
          resolve(null);
        };
      });
    }
    film.inflight[i] = prom;
    return prom;
  }

  /**
   * Resolves quickly once the hero frame and coarse scrub anchors are ready (~17 frames),
   * then streams remaining frames in scroll-priority order in the background.
   */
  preload(onProgress) {
    const gateQueue = [];
    const bgQueue = [];
    const seen = new Set();

    const pushGate = (fi, i) => {
      const k = fi * 1000 + i;
      if (!seen.has(k)) {
        seen.add(k);
        gateQueue.push([fi, i]);
      }
    };
    const pushBg = (fi, i) => {
      const k = fi * 1000 + i;
      if (!seen.has(k)) {
        seen.add(k);
        bgQueue.push([fi, i]);
      }
    };

    // Gate: immediate hero + sparse v1 anchors for sub-second first interactive paint
    for (const i of [0, 1, 2, 32, 64, 96, 128, 160, FILMS[0].count - 1]) {
      if (i < FILMS[0].count) pushGate(0, i);
    }

    // Background multi-pass fill: v2 coarse anchors, then pinned keyframes, then stride 8 -> 4 -> 2 -> 1
    for (let i = 0; i < FILMS[1].count; i += 48) pushBg(1, i);
    pushBg(1, FILMS[1].count - 1);
    for (let i = 0; i < FILMS[0].count; i += PIN_STRIDE) pushBg(0, i);
    for (let i = 0; i < FILMS[1].count; i += PIN_STRIDE) pushBg(1, i);
    for (const s of [8, 4, 2, 1]) {
      for (let i = 0; i < FILMS[0].count; i += s) pushBg(0, i);
    }
    for (const s of [8, 4, 2, 1]) {
      for (let i = 0; i < FILMS[1].count; i += s) pushBg(1, i);
    }

    const gateTotal = gateQueue.length;
    let gateLoaded = 0;
    let gateCursor = 0;
    let bgCursor = 0;
    let gateDone = false;
    let gateResolve;
    const gatePromise = new Promise((r) => (gateResolve = r));

    const pickBgJob = () => {
      // Prioritize un-fetched frames in an active window around scroll playhead
      const p = this.progress;
      const activeFi = p < X0 ? 0 : 1;
      const activePos =
        activeFi === 0
          ? Math.round(clamp(p / X1) * (FILMS[0].count - 1))
          : Math.round(clamp((p - X0) / (1 - X0)) * (FILMS[1].count - 1));
      const f = this.films[activeFi];
      const step = this.scrollDir >= 0 ? 1 : -1;
      for (let offset = 0; offset <= 20; offset++) {
        const idx = activePos + offset * step;
        if (idx >= 0 && idx < f.count && !f.blobs[idx] && !f.frames[idx] && !f.inflight[idx]) {
          return [activeFi, idx];
        }
      }
      while (bgCursor < bgQueue.length) {
        const [fi, i] = bgQueue[bgCursor++];
        const tf = this.films[fi];
        if (!tf.blobs[i] && !tf.frames[i] && !tf.inflight[i]) {
          return [fi, i];
        }
      }
      return null;
    };

    const nextGate = () => {
      if (gateCursor >= gateQueue.length) return;
      const [fi, i] = gateQueue[gateCursor++];
      this.loadFrame(fi, i).then(() => {
        if (!gateDone) {
          gateLoaded++;
          onProgress?.(Math.min(gateLoaded / gateTotal, 1));
          if (gateLoaded === 1) this.draw(true);
          if (gateLoaded >= gateTotal) {
            gateDone = true;
            gateResolve();
          }
        }
        nextGate();
      });
    };
    for (let k = 0; k < 5; k++) nextGate();

    this._startBgStream = () => {
      if (this.bgStarted) return;
      this.bgStarted = true;
      let activeWorkers = 0;
      const maxWorkers = 2;
      const nextBg = () => {
        if (this.bgPaused) {
          activeWorkers = Math.max(0, activeWorkers - 1);
          return;
        }
        const job = pickBgJob();
        if (!job) {
          activeWorkers = Math.max(0, activeWorkers - 1);
          return;
        }
        const [fi, i] = job;
        this.loadFrame(fi, i).then(() => {
          setTimeout(nextBg, 24);
        });
      };
      this._pumpBg = () => {
        while (!this.bgPaused && activeWorkers < maxWorkers) {
          activeWorkers++;
          nextBg();
        }
      };
      this._pumpBg();
    };

    return gatePromise;
  }

  startBackground() {
    this._startBgStream?.();
  }

  setBackgroundPaused(paused) {
    const next = !!paused;
    if (this.bgPaused === next) return;
    this.bgPaused = next;
    if (!next) this._pumpBg?.();
  }

  prefetchAhead(fi, pos) {
    if (!CAN_BITMAP) return;
    const film = this.films[fi];
    const base = Math.floor(pos);
    const dir = this.scrollDir >= 0 ? 1 : -1;
    for (let o = -2; o <= 10; o++) {
      const idx = base + o * dir;
      if (idx >= 0 && idx < film.count && !film.frames[idx] && film.blobs[idx] && !film.decoding[idx]) {
        this.decodeFromBlob(fi, idx);
      }
    }
  }

  computeCover() {
    if (!this.iw) return;
    this.cw = this.canvas.width;
    this.ch = this.canvas.height;
    const s = Math.max(this.cw / this.iw, this.ch / this.ih);
    this.dw = this.iw * s;
    this.dh = this.ih * s;
    this.dx = (this.cw - this.dw) / 2;
  }

  resize() {
    const w = window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.isDesktop = w > 820;
    const rawDpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const maxBackingW = this.size === 'lg' ? 1920 : 1280;
    const dpr = Math.min(rawDpr, maxBackingW / Math.max(w, 1));
    const cw = Math.max(1, Math.round(w * dpr));
    const ch = Math.max(1, Math.round(h * dpr));

    if (cw !== this.canvas.width || ch !== this.canvas.height) {
      this.canvas.width = cw;
      this.canvas.height = ch;
      this.ctx.imageSmoothingEnabled = true;
      this.ctx.imageSmoothingQuality = 'medium';
      this.computeCover();
      this.lastDrawn = -1;
    }
    this.top = this.section.offsetTop;
    this.height = this.section.offsetHeight;
    this.draw(true);
  }

  nearest(film, fi, i) {
    const f = film.frames;
    if (f[i]) return f[i];
    if (CAN_BITMAP && film.blobs[i] && !film.decoding[i]) {
      this.decodeFromBlob(fi, i);
    } else if (!film.blobs[i] && !film.inflight[i]) {
      this.loadFrame(fi, i);
    }
    for (let d = 1; d < film.count; d++) {
      if (f[i - d]) return f[i - d];
      if (f[i + d]) return f[i + d];
    }
    return null;
  }

  paintFilm(film, fi, pos, alpha) {
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const dy = (this.ch - this.dh) * film.alignY;
    const ctx = this.ctx;

    if (frac >= 0.98 && i0 + 1 < film.count && film.frames[i0 + 1]) {
      ctx.globalAlpha = alpha;
      ctx.drawImage(film.frames[i0 + 1], this.dx, dy, this.dw, this.dh);
      ctx.globalAlpha = 1;
      return;
    }

    const a = this.nearest(film, fi, i0);
    if (!a) return;
    ctx.globalAlpha = alpha;
    ctx.drawImage(a, this.dx, dy, this.dw, this.dh);
    if (frac > 0.02 && i0 + 1 < film.count) {
      const b = film.frames[i0 + 1];
      if (b && b !== a) {
        ctx.globalAlpha = alpha * frac;
        ctx.drawImage(b, this.dx, dy, this.dw, this.dh);
      }
    }
    ctx.globalAlpha = 1;
  }

  draw(force = false) {
    if (!this.iw) return;
    const p = this.smooth;
    if (!force && Math.abs(p - this.lastDrawn) < 0.00002) return;
    this.lastDrawn = p;

    const [f1, f2] = this.films;
    const pos1 = clamp(p / X1) * (f1.count - 1);
    const pos2 = clamp((p - X0) / (1 - X0)) * (f2.count - 1);
    const mix = smoothstep(X0, X1, p);

    if (mix < 1) {
      this.paintFilm(f1, 0, pos1, 1);
      this.prefetchAhead(0, pos1);
    }
    if (mix > 0) {
      this.paintFilm(f2, 1, pos2, mix);
      this.prefetchAhead(1, pos2);
    }

    const frameNo = mix < 0.5 ? Math.round(pos1) + 1 : f1.count + Math.round(pos2) + 1;
    if (frameNo !== this.lastFrameNo) {
      this.lastFrameNo = frameNo;
      this.frameLabel.textContent = pad(frameNo);
    }
  }

  update(dt, scrollY) {
    const vh = window.innerHeight;
    const raw = (scrollY - this.top) / (this.height - vh);
    const nextProgress = clamp(raw);
    if (nextProgress !== this.progress) {
      this.scrollDir = nextProgress >= this.progress ? 1 : -1;
      this.progress = nextProgress;
    }
    // Crisp sub-frame tracking without stacking noticeable latency onto Lenis
    this.smooth += (this.progress - this.smooth) * (1 - Math.exp(-dt * 34));
    if (Math.abs(this.progress - this.smooth) < 0.00002) this.smooth = this.progress;

    const onScreen = scrollY < this.top + this.height;
    if (!onScreen) {
      if (this.grain && !this.grainPaused) {
        this.grain.style.animationPlayState = 'paused';
        this.grainPaused = true;
      }
      return;
    }
    if (this.grain && this.grainPaused) {
      this.grain.style.animationPlayState = 'running';
      this.grainPaused = false;
    }

    this.draw();
    const p = this.smooth;
    if (Math.abs(p - this.lastUiP) > 0.00005 || this.lastUiP < 0) {
      this.lastUiP = p;
      for (const el of this.chapters) applyChapter(el, p, this.isDesktop);
      this.rail.style.transform = `scaleY(${p.toFixed(4)})`;
      this.cue.style.opacity = String(1 - smoothstep(0.0, 0.03, p));
      this.shade.style.setProperty('--fade', smoothstep(0.93, 1, p).toFixed(3));
    }
  }
}
