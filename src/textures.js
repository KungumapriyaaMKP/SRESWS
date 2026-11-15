/**
 * Procedural saree textures.
 * Every saree is painted twice on canvas: once in colour and once as an
 * ORM style map (green = roughness, blue = metalness) so the zari threads
 * respond to light like real gold while the silk keeps its soft sheen.
 *
 * Uses pre-rasterized motif sprites and batched path fills for sub-15ms
 * main-thread generation.
 */

const DESIGN_W = 2000;
const DESIGN_H = 450;

export const SAREES = [
  {
    id: 'kanjivaram',
    body: '#a0142a',
    bodyDeep: '#6e0a1b',
    border: '#0e3b2a',
    pallu: '#8a0f22',
    gold: '#dcb766',
    accent: '#0e3b2a',
    motif: 'paisley',
    sheen: '#ffc2a0',
    glow: '#6b0f1a',
  },
  {
    id: 'banarasi',
    body: '#0d4f36',
    bodyDeep: '#06301f',
    border: '#082a1d',
    pallu: '#0a3f2b',
    gold: '#d9b25c',
    accent: '#7a1022',
    motif: 'jaal',
    sheen: '#c8f0d6',
    glow: '#0b3b28',
  },
  {
    id: 'mysore',
    body: '#1c2f92',
    bodyDeep: '#101b5e',
    border: '#a9123a',
    pallu: '#9a1034',
    gold: '#e0bd6e',
    accent: '#a9123a',
    motif: 'coin',
    sheen: '#c8d0ff',
    glow: '#14215a',
  },
];

const ORM_GOLD = 'rgb(0, 70, 255)';
const ORM_SILK = 'rgb(0, 140, 0)';
const ORM_SILK_DENSE = 'rgb(0, 120, 0)';

function makePainter(mode, p) {
  const isOrm = mode === 'orm';
  return {
    gold: isOrm ? ORM_GOLD : p.gold,
    body: isOrm ? ORM_SILK : p.body,
    bodyDeep: isOrm ? ORM_SILK : p.bodyDeep,
    border: isOrm ? ORM_SILK_DENSE : p.border,
    pallu: isOrm ? ORM_SILK : p.pallu,
    accent: isOrm ? ORM_SILK : p.accent,
    isOrm,
  };
}

/* ---------- motif primitives ---------- */

function paisleyPath(ctx, s) {
  ctx.beginPath();
  ctx.moveTo(0, s);
  ctx.bezierCurveTo(-s * 0.78, s, -s * 0.8, s * 0.05, -s * 0.38, -s * 0.38);
  ctx.bezierCurveTo(-s * 0.08, -s * 0.7, s * 0.12, -s * 0.95, s * 0.5, -s * 1.12);
  ctx.bezierCurveTo(s * 0.3, -s * 0.78, s * 0.78, -s * 0.42, s * 0.72, s * 0.25);
  ctx.bezierCurveTo(s * 0.66, s * 0.76, s * 0.36, s, 0, s);
  ctx.closePath();
}

function paisley(ctx, x, y, s, rot, c, inner) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  paisleyPath(ctx, s);
  ctx.fillStyle = c.gold;
  ctx.fill();
  ctx.scale(0.62, 0.62);
  ctx.translate(0, s * 0.18);
  paisleyPath(ctx, s);
  ctx.fillStyle = inner;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, s * 0.35, s * 0.28, 0, Math.PI * 2);
  ctx.fillStyle = c.gold;
  ctx.fill();
  ctx.restore();
}

function coin(ctx, x, y, r, c, inner) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = c.gold;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, r * 0.62, 0, Math.PI * 2);
  ctx.lineWidth = r * 0.16;
  ctx.strokeStyle = inner;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, r * 0.22, 0, Math.PI * 2);
  ctx.fillStyle = inner;
  ctx.fill();
}

function flower(ctx, x, y, r, c, inner, petals = 6) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = c.gold;
  for (let i = 0; i < petals; i++) {
    ctx.rotate((Math.PI * 2) / petals);
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.55, r * 0.26, r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.26, 0, Math.PI * 2);
  ctx.fillStyle = inner;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.12, 0, Math.PI * 2);
  ctx.fillStyle = c.gold;
  ctx.fill();
  ctx.restore();
}

function diamond(ctx, x, y, s, fill) {
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.lineTo(x + s, y);
  ctx.lineTo(x, y + s);
  ctx.lineTo(x - s, y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function makeSprite(halfDesignUnits, scale, drawFn) {
  const size = Math.ceil(halfDesignUnits * 2 * scale);
  const el = document.createElement('canvas');
  el.width = size;
  el.height = size;
  const sctx = el.getContext('2d');
  sctx.setTransform(scale, 0, 0, scale, size / 2, size / 2);
  drawFn(sctx);
  return { el, half: halfDesignUnits };
}

/* ---------- saree regions ---------- */

const BODY_END = 1440;
const PALLU_START = 1440;
const BORDER = 64;

function drawBorderBand(ctx, c, top) {
  const y0 = top ? 0 : DESIGN_H - BORDER;
  const inner = top ? BORDER : DESIGN_H - BORDER;
  const dir = top ? 1 : -1;

  ctx.fillStyle = c.border;
  ctx.fillRect(0, y0, DESIGN_W, BORDER);

  // fine zari lines framing the band
  ctx.fillStyle = c.gold;
  const outerLine = top ? 5 : DESIGN_H - 9;
  ctx.fillRect(0, outerLine, DESIGN_W, 4);
  ctx.fillRect(0, top ? 13 : DESIGN_H - 15, DESIGN_W, 2);
  ctx.fillRect(0, top ? BORDER - 10 : DESIGN_H - BORDER + 6, DESIGN_W, 4);

  // batched diamond chain
  const mid = top ? 36 : DESIGN_H - 36;
  ctx.beginPath();
  for (let x = 12; x < DESIGN_W; x += 30) {
    ctx.moveTo(x, mid - 9);
    ctx.lineTo(x + 9, mid);
    ctx.lineTo(x, mid + 9);
    ctx.lineTo(x - 9, mid);
    ctx.closePath();
    ctx.moveTo(x + 15 + 2.6, mid);
    ctx.arc(x + 15, mid, 2.6, 0, Math.PI * 2);
  }
  ctx.fillStyle = c.gold;
  ctx.fill();

  ctx.beginPath();
  for (let x = 12; x < DESIGN_W; x += 30) {
    ctx.moveTo(x, mid - 4);
    ctx.lineTo(x + 4, mid);
    ctx.lineTo(x, mid + 4);
    ctx.lineTo(x - 4, mid);
    ctx.closePath();
  }
  ctx.fillStyle = c.border;
  ctx.fill();

  // batched temple teeth (rettai pettu)
  const tw = 28;
  const th = 30;
  ctx.beginPath();
  for (let x = 0; x < DESIGN_W; x += tw) {
    ctx.moveTo(x, inner);
    ctx.lineTo(x + tw / 2, inner + th * dir);
    ctx.lineTo(x + tw, inner);
    ctx.closePath();
  }
  ctx.fillStyle = c.gold;
  ctx.fill();

  ctx.beginPath();
  for (let x = 0; x < DESIGN_W; x += tw) {
    ctx.moveTo(x + 6, inner);
    ctx.lineTo(x + tw / 2, inner + (th - 12) * dir);
    ctx.lineTo(x + tw - 6, inner);
    ctx.closePath();
  }
  ctx.fillStyle = c.border;
  ctx.fill();
}

function drawBody(ctx, c, p, spriteScale) {
  ctx.fillStyle = c.body;
  ctx.fillRect(0, 0, BODY_END, DESIGN_H);

  // subtle shot silk shading in colour mode
  if (!c.isOrm) {
    const g = ctx.createLinearGradient(0, 0, 0, DESIGN_H);
    g.addColorStop(0, 'rgba(0,0,0,0.12)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.03)');
    g.addColorStop(1, 'rgba(0,0,0,0.12)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, BODY_END, DESIGN_H);
  }

  const top = BORDER + 44;
  const bottom = DESIGN_H - BORDER - 44;

  if (p.motif === 'paisley') {
    const spPos = makeSprite(18, spriteScale, (sctx) => paisley(sctx, 0, 0, 13, 0.35, c, c.body));
    const spNeg = makeSprite(18, spriteScale, (sctx) => paisley(sctx, 0, 0, 13, -0.35, c, c.body));
    let row = 0;
    for (let y = top; y <= bottom; y += 58, row++) {
      const sp = row % 2 ? spPos : spNeg;
      const d = sp.half * 2;
      for (let x = 30 + (row % 2) * 45; x < BODY_END - 20; x += 90) {
        ctx.drawImage(sp.el, x - sp.half, y - sp.half, d, d);
      }
    }
  } else if (p.motif === 'coin') {
    const sp = makeSprite(13, spriteScale, (sctx) => coin(sctx, 0, 0, 10, c, c.body));
    const d = sp.half * 2;
    let row = 0;
    for (let y = top; y <= bottom; y += 54, row++) {
      for (let x = 30 + (row % 2) * 40; x < BODY_END - 20; x += 80) {
        ctx.drawImage(sp.el, x - sp.half, y - sp.half, d, d);
      }
    }
  } else {
    // Banarasi jaal: vines with flowers in between
    ctx.strokeStyle = c.gold;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    for (let y = top - 20; y <= bottom + 20; y += 52) {
      for (let x = 0; x <= BODY_END; x += 6) {
        const yy = y + Math.sin(x * 0.06) * 13;
        if (x === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
    }
    ctx.stroke();

    const spFlower = makeSprite(14, spriteScale, (sctx) => flower(sctx, 0, 0, 11, c, c.body, 6));
    const fd = spFlower.half * 2;
    let row = 0;
    for (let y = top; y <= bottom; y += 52, row++) {
      for (let x = 26 + (row % 2) * 26; x < BODY_END - 10; x += 52.36) {
        ctx.drawImage(spFlower.el, x - spFlower.half, y - 26 + 13 - spFlower.half, fd, fd);
      }
    }

    const spLeaf = makeSprite(9, spriteScale, (sctx) => {
      sctx.rotate(0.6);
      sctx.beginPath();
      sctx.ellipse(0, 0, 3, 7, 0, 0, Math.PI * 2);
      sctx.fillStyle = c.gold;
      sctx.fill();
    });
    const ld = spLeaf.half * 2;
    for (let y = top; y <= bottom; y += 52) {
      for (let x = 0; x < BODY_END; x += 52.36) {
        const lx = x + 13;
        const ly = y + Math.sin(lx * 0.06) * 13;
        ctx.drawImage(spLeaf.el, lx - spLeaf.half, ly - spLeaf.half, ld, ld);
      }
    }
  }
}

function drawPallu(ctx, c, p) {
  const x0 = PALLU_START;
  const w = DESIGN_W - x0;
  ctx.fillStyle = c.pallu;
  ctx.fillRect(x0, 0, w, DESIGN_H);

  // separator stripes between body and pallu
  const stripes = [
    [0, 6, c.gold], [6, 12, c.accent], [12, 16, c.gold], [16, 26, c.border],
    [26, 30, c.gold], [30, 34, c.pallu], [34, 38, c.gold],
  ];
  for (const [a, b, col] of stripes) {
    ctx.fillStyle = col;
    ctx.fillRect(x0 + a, 0, b - a, DESIGN_H);
  }
  for (let y = 10; y < DESIGN_H; y += 18) diamond(ctx, x0 + 21, y, 4, c.gold);

  // framed field of large motifs
  const fx = x0 + 52;
  const fw = 360;
  ctx.fillStyle = c.gold;
  ctx.fillRect(fx, BORDER + 8, fw, 3);
  ctx.fillRect(fx, DESIGN_H - BORDER - 11, fw, 3);
  ctx.fillRect(fx, BORDER + 8, 3, DESIGN_H - 2 * BORDER - 16);
  ctx.fillRect(fx + fw - 3, BORDER + 8, 3, DESIGN_H - 2 * BORDER - 16);

  // dense gold ground (pallus are zari heavy)
  ctx.save();
  ctx.beginPath();
  ctx.rect(fx + 8, BORDER + 16, fw - 16, DESIGN_H - 2 * BORDER - 32);
  ctx.clip();
  ctx.fillStyle = c.gold;
  ctx.globalAlpha = c.isOrm ? 1 : 0.92;
  ctx.fillRect(fx, 0, fw, DESIGN_H);
  ctx.globalAlpha = 1;

  // batched lattice
  ctx.strokeStyle = c.pallu;
  ctx.lineWidth = 3;
  ctx.beginPath();
  for (let k = -400; k < 800; k += 46) {
    ctx.moveTo(fx + k, BORDER);
    ctx.lineTo(fx + k + 320, DESIGN_H - BORDER);
    ctx.moveTo(fx + k + 320, BORDER);
    ctx.lineTo(fx + k, DESIGN_H - BORDER);
  }
  ctx.stroke();
  ctx.restore();

  // central medallion rows
  const inv = { ...c, gold: c.pallu };
  for (let y = BORDER + 60, row = 0; y < DESIGN_H - BORDER - 30; y += 70, row++) {
    for (let x = fx + 50 + (row % 2) * 45; x < fx + fw - 30; x += 90) {
      if (p.motif === 'paisley') paisley(ctx, x, y, 20, row % 2 ? 0.4 : -0.4, inv, c.gold);
      else if (p.motif === 'coin') coin(ctx, x, y, 17, inv, c.gold);
      else flower(ctx, x, y, 19, inv, c.gold, 8);
    }
  }

  // end bands
  const ex = fx + fw + 18;
  for (let i = 0; i < 9; i++) {
    ctx.fillStyle = i % 2 ? c.pallu : c.gold;
    ctx.fillRect(ex + i * 12, 0, 6, DESIGN_H);
  }
  // batched small temple teeth facing the fringe
  ctx.beginPath();
  for (let y = 0; y < DESIGN_H; y += 22) {
    ctx.moveTo(ex + 112, y);
    ctx.lineTo(ex + 128, y + 11);
    ctx.lineTo(ex + 112, y + 22);
    ctx.closePath();
  }
  ctx.fillStyle = c.gold;
  ctx.fill();

  // fringe threads
  const fringeX = ex + 134;
  ctx.fillStyle = c.bodyDeep;
  ctx.fillRect(fringeX, 0, DESIGN_W - fringeX, DESIGN_H);
  if (!c.isOrm) {
    ctx.globalAlpha = 0.7;
    ctx.fillStyle = p.body;
    for (let y = 3; y < DESIGN_H; y += 6) {
      ctx.fillRect(fringeX, y, DESIGN_W - fringeX, 1.4);
    }
    ctx.fillStyle = p.gold;
    for (let y = 0; y < DESIGN_H; y += 6) {
      ctx.fillRect(fringeX, y, DESIGN_W - fringeX, 1.4);
    }
    ctx.globalAlpha = 1;
  }
}

let _weaveTile = null;
function getWeaveTile() {
  if (_weaveTile) return _weaveTile;
  const tile = document.createElement('canvas');
  tile.width = 6;
  tile.height = 6;
  const t = tile.getContext('2d');
  t.fillStyle = 'rgba(255,255,255,0.05)';
  t.fillRect(0, 0, 6, 1);
  t.fillRect(0, 3, 6, 1);
  t.fillStyle = 'rgba(0,0,0,0.07)';
  t.fillRect(0, 1, 1, 6);
  t.fillRect(3, 1, 1, 6);
  _weaveTile = tile;
  return tile;
}

function weaveOverlay(ctx, W, H) {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = ctx.createPattern(getWeaveTile(), 'repeat');
  ctx.fillRect(0, 0, W, H);

  // batched slubs: light then dark passes (avoids 1800 fillStyle switches)
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  for (let i = 0; i < 600; i++) {
    ctx.fillRect(Math.random() * W, Math.random() * H, 30 + Math.random() * 140, 1);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.06)';
  for (let i = 0; i < 600; i++) {
    ctx.fillRect(Math.random() * W, Math.random() * H, 30 + Math.random() * 140, 1);
  }
  ctx.restore();
}

function paint(canvas, mode, p) {
  const ctx = canvas.getContext('2d');
  const k = canvas.width / DESIGN_W;
  const spriteScale = Math.max(2, Math.ceil(k * 2));
  ctx.setTransform(k, 0, 0, canvas.height / DESIGN_H, 0, 0);
  const c = makePainter(mode, p);
  drawBody(ctx, c, p, spriteScale);
  drawPallu(ctx, c, p);
  drawBorderBand(ctx, c, true);
  drawBorderBand(ctx, c, false);
  if (mode === 'color') weaveOverlay(ctx, canvas.width, canvas.height);
}

export function createSareeCanvases(p, width = 2048) {
  const height = Math.round(width * (DESIGN_H / DESIGN_W));
  const color = document.createElement('canvas');
  const orm = document.createElement('canvas');
  color.width = orm.width = width;
  color.height = orm.height = height;
  paint(color, 'color', p);
  paint(orm, 'orm', p);
  return { color, orm };
}
