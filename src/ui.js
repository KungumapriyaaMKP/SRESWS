import { clamp } from './utils.js';

export function initUI(lenis, loom) {
  const nav = document.getElementById('nav');
  const burger = document.getElementById('burger');
  const menu = document.getElementById('menu');
  const lightSections = [...document.querySelectorAll('.heritage, .collections, .craft, .store')];
  const parallaxItems = [...document.querySelectorAll('[data-parallax]')].map((img) => ({
    img,
    parent: img.parentElement,
    factor: Number(img.dataset.parallax) * 100,
    top: 0,
    height: 0,
    active: false,
  }));
  const tiltCards = [...document.querySelectorAll('.card[data-tilt]')].map((card, index) => ({
    card,
    media: card.querySelector('.card__media'),
    body: card.querySelector('.card__body'),
    index,
    top: 0,
    height: 0,
    rect: null,
    active: false,
  }));

  let lightRanges = [];
  let vh = window.innerHeight;
  let lastY = -1;
  let needsSync = true;
  let lastLight = null;
  let lastSolid = null;
  let lastHidden = null;

  document.getElementById('year').textContent = new Date().getFullYear();

  /* ---------- menu + anchors ---------- */
  const setMenu = (open) => {
    document.body.classList.toggle('menu-open', open);
    burger.setAttribute('aria-expanded', String(open));
    menu.setAttribute('aria-hidden', String(!open));
    open ? lenis.stop() : lenis.start();
  };
  burger.addEventListener('click', () => setMenu(!document.body.classList.contains('menu-open')));

  document.querySelectorAll('[data-link]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const id = a.getAttribute('href');
      if (!id || !id.startsWith('#')) return;
      const el = document.querySelector(id);
      if (!el) return;
      e.preventDefault();
      if (document.body.classList.contains('menu-open')) setMenu(false);
      if (id === '#loom') loom?.ensureReady?.();
      // the loom is a long pinned section; land where the first weave is visible
      const offset = id === '#loom' ? window.innerHeight * 0.4 : 0;
      lenis.scrollTo(el, { offset, duration: 1.65, easing: (t) => 1 - Math.pow(1 - t, 4) });
    });
  });

  // Prevent placeholder social links from jumping scroll to top
  document.querySelectorAll('.footer a[href="#"]').forEach((a) => {
    a.addEventListener('click', (e) => e.preventDefault());
  });

  const loomEl = document.getElementById('loom');
  document.querySelectorAll('.loom__progress [data-act]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!loomEl) return;
      loom?.ensureReady?.();
      const p = Number(btn.dataset.act);
      const targetY = loomEl.offsetTop + Math.max(0, loomEl.offsetHeight - window.innerHeight) * p;
      lenis.scrollTo(targetY, { duration: 1.4, easing: (t) => 1 - Math.pow(1 - t, 4) });
    });
  });

  /* ---------- split headings into words ---------- */
  document.querySelectorAll('.split').forEach((el) => {
    const words = el.textContent.trim().split(/\s+/);
    el.innerHTML = words
      .map((w, i) => `<span class="w"><span style="--i:${i}">${w}</span></span>`)
      .join(' ');
  });

  /* ---------- reveal on view + pause offscreen marquee ---------- */
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        en.target.classList.add('is-in');
        if (en.target.querySelector?.('[data-count]') || en.target.matches('[data-count]')) {
          countUp(en.target.querySelector('[data-count]') || en.target);
        }
        io.unobserve(en.target);
      });
    },
    { rootMargin: '240px 0px 240px 0px', threshold: 0 }
  );
  document.querySelectorAll('.reveal, .reveal-mask, .split').forEach((el) => io.observe(el));

  const marqueeTrack = document.querySelector('.marquee__track');
  if (marqueeTrack) {
    const mqIo = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          marqueeTrack.style.animationPlayState = en.isIntersecting ? 'running' : 'paused';
        }
      },
      { rootMargin: '120px 0px 120px 0px' }
    );
    mqIo.observe(marqueeTrack.parentElement);
  }

  function countUp(el) {
    const end = Number(el.dataset.count);
    const suffix = el.dataset.suffix || '';
    const t0 = performance.now();
    const dur = 1800;
    const fmt = new Intl.NumberFormat('en-IN');
    const step = (now) => {
      const t = clamp((now - t0) / dur);
      const e = 1 - Math.pow(1 - t, 4);
      el.textContent = fmt.format(Math.round(end * e)) + (t === 1 ? suffix : '');
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* ---------- cursor ---------- */
  const cursor = document.getElementById('cursor');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const cur = { x: -100, y: -100, tx: -100, ty: -100, dirty: false };
  if (finePointer) {
    window.addEventListener(
      'pointermove',
      (e) => {
        cur.tx = e.clientX;
        cur.ty = e.clientY;
        cur.dirty = true;
      },
      { passive: true }
    );
    document.addEventListener('mouseleave', () => cursor.classList.add('is-hidden'));
    document.addEventListener('mouseenter', () => cursor.classList.remove('is-hidden'));
    document.querySelectorAll('a, button, [data-tilt], input, select').forEach((el) => {
      el.addEventListener('mouseenter', () => cursor.classList.add('is-hover'));
      el.addEventListener('mouseleave', () => cursor.classList.remove('is-hover'));
    });
  }

  /* ---------- magnetic buttons + card tilt ---------- */
  if (finePointer) {
    document.querySelectorAll('[data-magnetic]').forEach((el) => {
      let btnRect = null;
      el.addEventListener('pointerenter', () => {
        btnRect = el.getBoundingClientRect();
        el.style.transition = '';
      });
      el.addEventListener('pointermove', (e) => {
        const r = btnRect || el.getBoundingClientRect();
        const x = (e.clientX - r.left - r.width / 2) * 0.25;
        const y = (e.clientY - r.top - r.height / 2) * 0.35;
        el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      });
      el.addEventListener('pointerleave', () => {
        btnRect = null;
        el.style.transition = 'transform 0.55s cubic-bezier(0.16,1,0.3,1)';
        el.style.transform = '';
        setTimeout(() => (el.style.transition = ''), 560);
      });
    });

    tiltCards.forEach((item) => {
      const { card, media, body } = item;
      card.addEventListener('pointerenter', () => {
        item.rect = media.getBoundingClientRect();
        card.dataset.hover = '1';
        media.classList.remove('is-returning');
      });
      card.addEventListener('pointermove', (e) => {
        const r = item.rect || media.getBoundingClientRect();
        const nx = (e.clientX - r.left) / r.width;
        const ny = (e.clientY - r.top) / r.height;
        const x = nx - 0.5;
        const y = ny - 0.5;
        media.style.setProperty('--mx', `${(nx * 100).toFixed(1)}%`);
        media.style.setProperty('--my', `${(ny * 100).toFixed(1)}%`);
        media.style.setProperty('--px', x.toFixed(3));
        media.style.setProperty('--py', y.toFixed(3));
        media.style.transform = `perspective(960px) rotateY(${(x * 18).toFixed(2)}deg) rotateX(${(-y * 16).toFixed(2)}deg) translateZ(20px)`;
        if (body) body.style.transform = `translate3d(${(x * 10).toFixed(1)}px, ${(y * 6).toFixed(1)}px, 24px)`;
      });
      card.addEventListener('pointerleave', () => {
        delete card.dataset.hover;
        item.rect = null;
        media.classList.add('is-returning');
        media.style.setProperty('--px', '0');
        media.style.setProperty('--py', '0');
        media.style.transform = '';
        if (body) body.style.transform = '';
        needsSync = true;
      });
    });
  }

  /* ---------- forms ---------- */
  const dateInput = document.getElementById('fDate');
  if (dateInput) {
    dateInput.min = new Date().toISOString().split('T')[0];
  }
  const form = document.getElementById('bookingForm');
  const note = document.getElementById('formNote');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    let ok = true;
    form.querySelectorAll('[required]').forEach((f) => {
      const bad = !f.value.trim() || (f.type === 'tel' && f.value.replace(/\D/g, '').length < 10);
      f.closest('.field').classList.toggle('is-error', bad);
      if (bad) ok = false;
    });
    if (!ok) {
      note.textContent = 'Please complete the highlighted fields.';
      return;
    }
    const name = form.elements.namedItem('name').value.trim().split(' ')[0];
    note.textContent = `Thank you, ${name}. Our concierge will call you within one working day to confirm your viewing.`;
    form.reset();
  });
  form.querySelectorAll('input, select').forEach((f) =>
    f.addEventListener('input', () => f.closest('.field').classList.remove('is-error'))
  );

  const news = document.getElementById('newsletter');
  news.addEventListener('submit', (e) => {
    e.preventDefault();
    const input = news.querySelector('input');
    if (!/^\S+@\S+\.\S+$/.test(input.value)) {
      input.focus();
      return;
    }
    news.querySelector('label').textContent = 'Thank you. The first letter arrives with the season.';
    input.value = '';
  });

  /* ---------- measure (batched read) + zero-reflow update ---------- */
  function measure() {
    const sy = window.scrollY;
    vh = window.innerHeight;
    lightRanges = lightSections.map((s) => [s.offsetTop, s.offsetTop + s.offsetHeight]);
    for (const item of parallaxItems) {
      const r = item.parent.getBoundingClientRect();
      item.top = r.top + sy;
      item.height = r.height;
    }
    for (const item of tiltCards) {
      const r = item.card.getBoundingClientRect();
      item.top = r.top + sy;
      item.height = r.height;
      item.rect = null;
    }
    needsSync = true;
  }
  measure();

  function update(dt, y) {
    // cursor interpolation (skipped when stationary)
    if (finePointer && cur.dirty) {
      const k = 1 - Math.exp(-dt * 22);
      cur.x += (cur.tx - cur.x) * k;
      cur.y += (cur.ty - cur.y) * k;
      if (Math.abs(cur.tx - cur.x) < 0.05 && Math.abs(cur.ty - cur.y) < 0.05) {
        cur.x = cur.tx;
        cur.y = cur.ty;
        cur.dirty = false;
      }
      cursor.style.transform = `translate3d(${cur.x.toFixed(1)}px, ${cur.y.toFixed(1)}px, 0)`;
    }

    const scrollChanged = needsSync || Math.abs(y - lastY) > 0.05;
    if (!scrollChanged) return;

    const delta = y - lastY;
    lastY = y;
    needsSync = false;

    // nav state
    const probe = y + 40;
    const light = lightRanges.some(([a, b]) => probe >= a && probe < b);
    const solid = y > vh * 0.5 && light;
    if (light !== lastLight) {
      nav.classList.toggle('is-light', light);
      lastLight = light;
    }
    if (solid !== lastSolid) {
      nav.classList.toggle('is-solid', solid);
      lastSolid = solid;
    }
    if (Math.abs(delta) > 2 && !document.body.classList.contains('menu-open')) {
      const hidden = delta > 0 && y > vh * 0.6;
      if (hidden !== lastHidden) {
        nav.classList.toggle('is-hidden', hidden);
        lastHidden = hidden;
      }
    }

    // parallax images (pure arithmetic, zero layout reads)
    for (const item of parallaxItems) {
      const top = item.top - y;
      const bottom = top + item.height;
      if (bottom < -120 || top > vh + 120) continue;
      const c = (top + item.height * 0.5 - vh * 0.5) / vh;
      item.img.style.transform = `translate3d(0, ${(-c * item.factor).toFixed(2)}%, 0)`;
    }

    // continuous scroll-driven 3D angle & Z depth on non-hovered collection cards
    for (const item of tiltCards) {
      if (item.card.dataset.hover) continue;
      const top = item.top - y;
      const bottom = top + item.height;
      if (bottom < -100 || top > vh + 100) continue;
      const media = item.media;
      if (!media) continue;
      if (media.classList.contains('is-returning')) media.classList.remove('is-returning');
      const c = clamp((top + item.height * 0.5 - vh * 0.5) / vh, -1, 1);
      const fanYaw = (item.index - 1.5) * 4.5;
      media.style.transform = `perspective(980px) rotateX(${(-c * 8).toFixed(2)}deg) rotateY(${fanYaw.toFixed(1)}deg)`;
    }
  }

  return { measure, update };
}
