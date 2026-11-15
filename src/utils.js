export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const pad = (n, l = 4) => String(n).padStart(l, '0');

export function applyChapter(el, p, isDesktop = true) {
  if (!el._range) {
    el._range = el.dataset.range.split(',').map(Number);
    el._isLoomSide = el.classList.contains('loom__chapter') && !el.classList.contains('is-center');
  }
  const [a, b] = el._range;
  const span = b - a;
  const edge = Math.min(0.05, span * 0.25);
  let o;
  if (p < a || p > b) o = 0;
  else {
    const fin = a <= 0 ? 1 : smoothstep(a, a + edge, p);
    const fout = b >= 1 ? 1 : 1 - smoothstep(b - edge, b, p);
    o = Math.min(fin, fout);
  }
  if (o === el._o) return;
  el._o = o;
  const local = clamp((p - a) / span, 0, 1);
  const y = (0.5 - local) * 56;
  el.style.opacity = o.toFixed(3);
  el.style.visibility = o > 0.001 ? 'visible' : 'hidden';
  el.style.willChange = o > 0.001 && o < 0.999 ? 'opacity, transform' : 'auto';
  const base = el._isLoomSide && isDesktop ? 'translateY(-50%) ' : '';
  el.style.transform = `${base}translate3d(0, ${y.toFixed(1)}px, 0)`;
}
