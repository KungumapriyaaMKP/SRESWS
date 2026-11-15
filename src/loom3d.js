import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SAREES, createSareeCanvases } from './textures.js';
import { clamp, lerp, smoothstep, easeInOut, applyChapter } from './utils.js';

const LEN = 6.0;
const WID = 1.35;
const HALF_PI = Math.PI / 2;

/* --------------------------------------------------------------------------
   Cloth shader: 3D ribbon arch, twist, deep folds, wind, pleats, and spiral roll.
   -------------------------------------------------------------------------- */
const CLOTH_HEAD = /* glsl */ `
uniform float uTime;
uniform float uUnroll;
uniform float uWind;
uniform float uPleat;
uniform float uArch;
uniform float uTwist;
uniform float uSeed;
uniform vec2 uPointer;

float clothWave(float x, float y, float t) {
  float u01 = clamp((x + ${(LEN / 2).toFixed(2)}) / ${LEN.toFixed(2)}, 0.0, 1.0);
  float w = sin(x * 1.1 + t * 1.2) * 0.28
          + sin(x * 2.4 - t * 1.75 + y * 1.5) * 0.095
          + sin(y * 3.6 + t * 1.05 + x * 0.7) * 0.055
          + sin(x * 4.8 + t * 2.4) * 0.022;
  w *= uWind * (0.38 + 0.62 * u01);
  float pleat = sin(y * 22.0 + sin(x * 0.85) * 0.65) * 0.072 * uPleat * (0.25 + 0.75 * u01);
  float sway = sin(t * 0.85 + u01 * 2.2) * 0.16 * uPleat * u01 * u01;
  return w + pleat + sway;
}

vec3 clothDisplace(vec3 p) {
  float t = uTime + uSeed * 13.0;
  float e = -${(LEN / 2).toFixed(2)} + uUnroll * ${LEN.toFixed(2)};
  float shift = (1.0 - uUnroll) * ${(LEN / 2).toFixed(2)};
  vec3 r;
  if (p.x > e) {
    float d = p.x - e;
    float R0 = 0.082;
    float b = 0.0032;
    float th = (-R0 + sqrt(R0 * R0 + 2.0 * b * d)) / b;
    float rr = R0 + b * th;
    float edgeZ = clothWave(e, p.y, t);
    r = vec3(e + rr * sin(th), p.y, R0 - rr * cos(th) + edgeZ);
  } else {
    float w = clothWave(p.x, p.y, t);
    float u01 = clamp((p.x + ${(LEN / 2).toFixed(2)}) / ${LEN.toFixed(2)}, 0.0, 1.0);
    float pd = length(vec2(u01 * 2.0 - 1.0, p.y) - uPointer);
    w += exp(-pd * pd * 1.6) * 0.16 * uWind;
    r = vec3(p.x, p.y, w);
  }

  // Apply 3D helical twist and vertical/depth ribbon arch cleanly across both cloth and roll
  float xRef = min(p.x, e);
  float ref01 = clamp((xRef + ${(LEN / 2).toFixed(2)}) / ${LEN.toFixed(2)}, 0.0, 1.0);
  float tw = (ref01 - 0.5) * uTwist + sin(t * 0.65 + ref01 * 2.6) * 0.16 * uWind * uUnroll;
  float cs = cos(tw);
  float sn = sin(tw);
  float ry = r.y * cs - r.z * sn;
  float rz = r.y * sn + r.z * cs;
  r.y = ry + sin(ref01 * 4.2 - t * 0.48) * 0.34 * uArch;
  r.z = rz + cos(ref01 * 3.6 + 0.4) * 0.30 * uArch;

  r.x += shift;
  return r;
}

vec3 clothNormal(vec3 p) {
  float h = 0.0045;
  vec3 a = clothDisplace(p);
  vec3 bx = clothDisplace(p + vec3(h, 0.0, 0.0));
  vec3 by = clothDisplace(p + vec3(0.0, h, 0.0));
  return normalize(cross(bx - a, by - a));
}
`;

function makeClothMaterial(maps, palette, maxAniso, isSoftware = false) {
  const uniforms = {
    uTime: { value: 0 },
    uUnroll: { value: 0 },
    uWind: { value: 0.6 },
    uPleat: { value: 0 },
    uArch: { value: 0 },
    uTwist: { value: 0 },
    uSeed: { value: Math.random() },
    uPointer: { value: new THREE.Vector2(9, 9) },
  };

  const map = new THREE.CanvasTexture(maps.color);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = maxAniso;
  const orm = new THREE.CanvasTexture(maps.orm);
  orm.anisotropy = maxAniso;

  const baseOpts = {
    map,
    roughnessMap: orm,
    metalnessMap: orm,
    roughness: 1,
    metalness: 1,
    side: THREE.DoubleSide,
    envMapIntensity: 0.92,
  };
  const mat = isSoftware
    ? new THREE.MeshStandardMaterial(baseOpts)
    : new THREE.MeshPhysicalMaterial({
        ...baseOpts,
        sheen: 1,
        sheenRoughness: 0.28,
        sheenColor: new THREE.Color(palette.sheen),
        anisotropy: 0.65,
        anisotropyRotation: HALF_PI,
      });

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = CLOTH_HEAD + shader.vertexShader
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = clothNormal(position);')
      .replace('#include <begin_vertex>', 'vec3 transformed = clothDisplace(position);');
  };
  mat.customProgramCacheKey = () => 'saree-cloth-v2';
  return { mat, uniforms };
}

/* --------------------------------------------------------------------------
   Keyframe tracks (with 3D arch + twist)
   -------------------------------------------------------------------------- */
const KEYS = ['u', 'wind', 'pleat', 'arch', 'twist', 'x', 'y', 'z', 'rx', 'ry', 'rz', 's'];
const BASE = { u: 1, wind: 0.6, pleat: 0, arch: 0, twist: 0, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, s: 1 };

function track(frames) {
  let prev = { ...BASE };
  return frames.map(([p, v]) => {
    prev = { ...prev, ...v };
    return [p, prev];
  });
}

function sample(tr, p, out) {
  if (p <= tr[0][0]) return Object.assign(out, tr[0][1]);
  for (let i = 0; i < tr.length - 1; i++) {
    const [p0, a] = tr[i];
    const [p1, b] = tr[i + 1];
    if (p <= p1) {
      const t = easeInOut(clamp((p - p0) / Math.max(p1 - p0, 1e-5), 0, 1));
      for (const k of KEYS) out[k] = lerp(a[k], b[k], t);
      return out;
    }
  }
  return Object.assign(out, tr[tr.length - 1][1]);
}

const HANG = { rz: -HALF_PI, s: 0.36, u: 1, pleat: 1.2, arch: 0, twist: 0, wind: 0.36, rx: 0.03 };

const TRACKS = [
  // Kanjivaram ribbon (sweeps in right 3D space around Kanjivaram statue while text sits left)
  track([
    [0.0, { u: 0.02, wind: 0.55, arch: 0.3, twist: 0.15, x: 1.65, y: -0.45, z: -0.45, rx: -0.25, ry: -0.32, rz: 0.16, s: 0.62 }],
    [0.04, { u: 0.08, arch: 0.52 }],
    [0.14, { u: 1.0, wind: 0.95, arch: 0.92, twist: 0.55, x: 1.92, y: -0.52, z: -0.22, rx: -0.26, ry: -0.42, rz: 0.10, s: 0.64 }],
    [0.23, { wind: 1.1, arch: 0.72, twist: -0.45, x: 1.85, y: -0.58, z: 0.05, rx: -0.68, ry: -0.18, rz: 0.22 }],
    [0.30, { u: 0.55, arch: 0.3, x: -10.5, z: -2.8, ry: 0.75, rz: 0.4, s: 0.64 }],
    [0.845, {}],
    [0.85, { ...HANG, x: -6.8, y: 0.75, z: -1.6, ry: 0.45 }],
    [0.95, { x: -1.45, y: 0.88, z: -1.15, ry: 0.26 }],
    [1.0, {}],
  ]),
  // Banarasi ribbon (sweeps in left 3D space behind Banarasi cameo while text sits right)
  track([
    [0.0, { u: 0, arch: 0.4, twist: -0.3, x: 10.5, y: 0.25, z: -2.2, rx: -0.3, rz: -0.3, s: 0.62, wind: 0.55 }],
    [0.27, {}],
    [0.34, { x: -1.72, y: -0.46, z: -0.45, ry: 0.36, rz: -0.12, arch: 0.85, twist: -0.5, s: 0.62 }],
    [0.45, { u: 1.0, wind: 0.92, arch: 0.96, twist: 0.58, x: -1.92, y: -0.54, z: -0.25, rx: -0.26, ry: 0.42, rz: -0.10 }],
    [0.53, { wind: 1.1, arch: 0.72, twist: -0.42, x: -1.82, y: -0.58, z: 0.05, rx: -0.68, ry: 0.18, rz: -0.22 }],
    [0.60, { u: 0.55, x: -10.5, z: -2.8, ry: -0.75, rz: 0.3 }],
    [0.845, {}],
    [0.85, { ...HANG, x: 0, y: 5.2, z: -1.55, ry: 0, s: 0.30 }],
    [0.95, { y: 1.95, z: -1.55, s: 0.30 }],
    [1.0, {}],
  ]),
  // Mysore Silk ribbon (sweeps in right 3D space behind Mysore statue while text sits left)
  track([
    [0.0, { u: 0, arch: 0.4, twist: 0.3, x: 10.5, y: 0.25, z: -2.2, rx: -0.3, rz: 0.3, s: 0.62, wind: 0.55 }],
    [0.56, {}],
    [0.63, { x: 1.72, y: -0.46, z: -0.45, ry: -0.36, rz: 0.12, arch: 0.85, twist: 0.5, s: 0.62 }],
    [0.73, { u: 1.0, wind: 0.92, arch: 0.96, twist: -0.58, x: 1.92, y: -0.54, z: -0.25, rx: -0.26, ry: -0.42, rz: 0.10 }],
    [0.81, { wind: 1.1, arch: 0.72, twist: 0.42, x: 1.82, y: -0.58, z: 0.05, rx: -0.68, ry: -0.18, rz: 0.22 }],
    [0.85, { ...HANG, x: 6.8, y: 0.75, z: -1.6, ry: -0.45 }],
    [0.95, { x: 1.45, y: 0.88, z: -1.15, ry: -0.26 }],
    [1.0, {}],
  ]),
];

/* --------------------------------------------------------------------------
   Volumetric 3D Women-in-Saree Sculptures
   -------------------------------------------------------------------------- */
const MODEL_SPECS = [
  {
    id: 'kanjivaram-red',
    w: 1.24,
    h: 3.10,
    cameo: false,
    sway: 1.0,
    sheen: '#ffc2a0',
  },
  {
    id: 'banarasi-green',
    w: 2.08,
    h: 2.42,
    cameo: true,
    sway: 0.0,
    sheen: '#c8f0d6',
  },
  {
    id: 'mysore-blue',
    w: 1.48,
    h: 3.08,
    cameo: false,
    sway: 1.0,
    sheen: '#c8d0ff',
  },
];

const MKEYS = ['x', 'y', 'z', 'ry', 's'];
const MBASE = { x: 0, y: -4.8, z: -2, ry: 0, s: 0.9 };
function mtrack(frames) {
  let prev = { ...MBASE };
  return frames.map(([p, v]) => {
    prev = { ...prev, ...v };
    return [p, prev];
  });
}
function sampleModel(tr, p, out) {
  if (p <= tr[0][0]) return Object.assign(out, tr[0][1]);
  for (let i = 0; i < tr.length - 1; i++) {
    const [p0, a] = tr[i];
    const [p1, b] = tr[i + 1];
    if (p <= p1) {
      const t = easeInOut(clamp((p - p0) / Math.max(p1 - p0, 1e-5), 0, 1));
      for (const k of MKEYS) out[k] = lerp(a[k], b[k], t);
      return out;
    }
  }
  return Object.assign(out, tr[tr.length - 1][1]);
}

const MODEL_TRACKS = [
  // Kanjivaram Woman Statue (right stage in Act I, left gallery wing in Finale)
  mtrack([
    [0.0,  { x: 2.2, y: -3.2, z: -1.8, ry: -0.45, s: 0.85 }],
    [0.07, { x: 1.48, y: -0.22, z: 0.55, ry: -0.22, s: 0.96 }],
    [0.23, { x: 1.42, y: -0.22, z: 0.62, ry: -0.10, s: 0.98 }],
    [0.31, { x: 5.8, y: -0.4, z: -2.2, ry: -0.8, s: 0.85 }],
    [0.84, {}],
    [0.95, { x: -2.62, y: -0.24, z: 0.32, ry: 0.34, s: 0.88 }],
    [1.0, {}],
  ]),
  // Banarasi Woman Cameo (left stage in Act II, top crown jewel in Finale)
  mtrack([
    [0.0,  { x: -6.2, y: 0.2, z: -2.4, ry: 0.7, s: 0.82 }],
    [0.27, {}],
    [0.35, { x: -1.62, y: 0.12, z: 0.45, ry: 0.24, s: 0.92 }],
    [0.52, { x: -1.56, y: 0.10, z: 0.52, ry: 0.10, s: 0.94 }],
    [0.60, { x: -6.4, y: 0.2, z: -2.5, ry: 0.8, s: 0.8 }],
    [0.84, {}],
    [0.95, { x: 0.0, y: 1.48, z: 0.08, ry: 0.0, s: 0.58 }],
    [1.0, {}],
  ]),
  // Mysore Woman Statue (right stage in Act III, right gallery wing in Finale)
  mtrack([
    [0.0,  { x: 6.2, y: -0.4, z: -2.4, ry: -0.7, s: 0.85 }],
    [0.56, {}],
    [0.64, { x: 1.48, y: -0.22, z: 0.55, ry: -0.22, s: 0.96 }],
    [0.80, { x: 1.42, y: -0.22, z: 0.62, ry: -0.10, s: 0.98 }],
    [0.85, { x: 5.5, y: -0.3, z: -1.5, ry: -0.6, s: 0.86 }],
    [0.95, { x: 2.62, y: -0.24, z: 0.32, ry: -0.34, s: 0.88 }],
    [1.0, {}],
  ]),
];

// Camera choreography keyframes: [progress, azimuth, elevation, distance, targetX, targetY]
const CAM_TRACK = [
  [0.0,  -0.38, -0.05, 5.6,  0.10,  0.0],
  [0.14,  0.10,  0.05, 6.0,  0.08,  0.0],
  [0.26,  0.28,  0.11, 5.5,  0.12, -0.04],
  [0.34,  0.38,  0.06, 5.9, -0.12,  0.0],
  [0.45, -0.08, -0.03, 5.8, -0.08,  0.02],
  [0.56, -0.28,  0.11, 5.5, -0.12, -0.04],
  [0.64, -0.38, -0.07, 5.8,  0.10,  0.0],
  [0.74,  0.10,  0.05, 5.8,  0.08,  0.03],
  [0.83,  0.26,  0.10, 6.3,  0.05,  0.0],
  [0.91, -0.10, -0.09, 7.9,  0.0,   0.12],
  [1.0,   0.0,  -0.04, 7.8,  0.0,   0.14],
];

const _camOut = [0, 0, 0, 0, 0, 0];
function sampleCamera(p, out = _camOut) {
  if (p <= CAM_TRACK[0][0]) {
    for (let k = 0; k < 6; k++) out[k] = CAM_TRACK[0][k];
    return out;
  }
  for (let i = 0; i < CAM_TRACK.length - 1; i++) {
    const a = CAM_TRACK[i];
    const b = CAM_TRACK[i + 1];
    if (p <= b[0]) {
      const t = easeInOut(clamp((p - a[0]) / Math.max(b[0] - a[0], 1e-5), 0, 1));
      out[0] = p;
      out[1] = lerp(a[1], b[1], t);
      out[2] = lerp(a[2], b[2], t);
      out[3] = lerp(a[3], b[3], t);
      out[4] = lerp(a[4], b[4], t);
      out[5] = lerp(a[5], b[5], t);
      return out;
    }
  }
  const last = CAM_TRACK[CAM_TRACK.length - 1];
  for (let k = 0; k < 6; k++) out[k] = last[k];
  return out;
}

const _c0 = new THREE.Color(SAREES[0].glow);
const _c1 = new THREE.Color(SAREES[1].glow);
const _c2 = new THREE.Color(SAREES[2].glow);
const _c3 = new THREE.Color('#4a2a10');
const _r0 = new THREE.Color('#ff8a6b');
const _r1 = new THREE.Color('#80ffbe');
const _r2 = new THREE.Color('#7aa2ff');
const _r3 = new THREE.Color('#ffd07a');

const nextFrame = () => new Promise((r) => requestAnimationFrame(r));

function createStudioEnvTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 32;
  const ctx = c.getContext('2d');
  ctx.scale(0.5, 0.5);
  const g = ctx.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0.0, '#ffe8be');
  g.addColorStop(0.32, '#d89b52');
  g.addColorStop(0.55, '#4c1e16');
  g.addColorStop(1.0, '#140508');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 64);

  const spots = [
    [28, 18, 16, 'rgba(255, 244, 214, 0.95)'],
    [96, 20, 18, 'rgba(255, 214, 150, 0.85)'],
    [64, 10, 22, 'rgba(255, 232, 186, 0.75)'],
  ];
  for (const [x, y, r, col] of spots) {
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, col);
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createFloorTextures() {
  const size = 512;
  const color = document.createElement('canvas');
  const rough = document.createElement('canvas');
  color.width = rough.width = size;
  color.height = rough.height = size;

  const c = color.getContext('2d');
  const r = rough.getContext('2d');
  c.scale(0.5, 0.5);
  r.scale(0.5, 0.5);

  // Dark carved temple granite
  c.fillStyle = '#120608';
  c.fillRect(0, 0, 1024, 1024);
  r.fillStyle = '#8e8e8e';
  r.fillRect(0, 0, 1024, 1024);

  const cx = 512;
  const cy = 512;

  // Radial kolam inlay rings in antique gold
  c.strokeStyle = 'rgba(217, 178, 92, 0.34)';
  r.strokeStyle = '#383838';
  for (let rad = 90; rad <= 480; rad += 65) {
    c.lineWidth = rad % 130 === 90 ? 3.5 : 1.5;
    c.beginPath();
    c.arc(cx, cy, rad, 0, Math.PI * 2);
    c.stroke();

    r.lineWidth = c.lineWidth + 1;
    r.beginPath();
    r.arc(cx, cy, rad, 0, Math.PI * 2);
    r.stroke();
  }

  // Radial lotus spokes
  c.strokeStyle = 'rgba(217, 178, 92, 0.22)';
  c.lineWidth = 1.5;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    c.beginPath();
    c.moveTo(cx + Math.cos(a) * 90, cy + Math.sin(a) * 90);
    c.lineTo(cx + Math.cos(a) * 480, cy + Math.sin(a) * 480);
    c.stroke();
  }

  return { color, rough };
}

/* --------------------------------------------------------------------------
   Scene
   -------------------------------------------------------------------------- */
export class Loom {
  constructor({ canvas, section }) {
    this.canvas = canvas;
    this.section = section;
    this.progress = 0;
    this.smooth = 0;
    this.time = 0;
    this.mouse = new THREE.Vector2();
    this.mouseSmooth = new THREE.Vector2();
    this.drag = new THREE.Vector2();
    this.dragTarget = new THREE.Vector2();
    this.isDragging = false;
    this.lastPtr = { x: 0, y: 0 };
    this.isMobile = window.matchMedia('(max-width: 820px)').matches;
    this.isDesktop = !this.isMobile;
    this.chapters = [...section.querySelectorAll('.loom__chapter')];
    this.dots = [...section.querySelectorAll('.loom__progress [data-act]')];
    this.visible = false;
    this.ready = false;
    this._initPromise = null;
    this._w = 0;
    this._h = 0;
    this.state = KEYS.reduce((o, k) => ((o[k] = 0), o), {});
  }

  _setupCore(skipEnv = false) {
    const renderer = (this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      powerPreference: 'high-performance',
      alpha: false,
    }));
    const gl = renderer.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const gpuName = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '' : '';
    this.isSoftware = /swiftshader|llvmpipe|software/i.test(gpuName);
    const maxDpr = this.isSoftware ? 1 : this.isMobile ? 1.25 : 1.4;
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    renderer.setPixelRatio(dpr);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    renderer.setClearColor(0x0c0406, 1);

    const scene = (this.scene = new THREE.Scene());
    scene.fog = new THREE.Fog(0x0c0406, 8.5, 22);

    if (!skipEnv) this._setupEnvironment();

    const camera = (this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 60));
    camera.position.set(0, 0, 6.2);

    // Three-point + orbiting diya lights (balanced so silk pigment never blows out)
    const key = new THREE.DirectionalLight(0xffe0b0, 1.18);
    key.position.set(-3.2, 4.4, 5.2);
    this.rim = new THREE.DirectionalLight(0xff8e5a, 1.35);
    this.rim.position.set(4.5, 2.0, -4.5);
    const fill = (this.fill = new THREE.HemisphereLight(0xffe7c7, 0x2a0a10, 0.38));
    this.spot = new THREE.PointLight(0xffc77a, 1.1, 11, 1.8);
    this.spot.position.set(0, 2.0, 2.8);
    this.accentLight = new THREE.PointLight(0xffb454, 0.95, 10, 1.8);
    this.accentLight.position.set(-2.2, -0.5, 1.4);
    scene.add(key, this.rim, fill, this.spot, this.accentLight);
  }

  _setupEnvironment() {
    if (this.isSoftware) {
      // Software WebGL compiles PMREM convolution shaders slowly on CPU; compensate with stronger studio fill
      this.fill.intensity = 0.72;
      return;
    }
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envTex = createStudioEnvTexture();
    this.scene.environment = pmrem.fromEquirectangular(envTex).texture;
    this.scene.environmentIntensity = 0.56;
    envTex.dispose();
    pmrem.dispose();
  }

  _setupComposer() {
    if (this.isSoftware) {
      this.composer = null;
      this.bloom = null;
      return;
    }
    const rt = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: this.isMobile ? 0 : 2,
    });
    const composer = (this.composer = new EffectComposer(this.renderer, rt));
    composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.16, 0.45, 0.94);
    composer.addPass(this.bloom);
    composer.addPass(new OutputPass());
  }

  _warmupShaders() {
    const prevSarees = this.sarees.map((s) => s.group.visible);
    const prevModels = this.models.map((m) => m.grp.visible);
    const prevRods = this.rods.map((r) => r.visible);
    const warmRT = new THREE.WebGLRenderTarget(16, 16);
    this.renderer.setRenderTarget(warmRT);
    for (const s of this.sarees) s.group.visible = false;
    for (const m of this.models) m.grp.visible = false;
    for (const r of this.rods) r.visible = false;
    if (this.sarees[0]) {
      this.sarees[0].group.visible = true;
      this.renderer.render(this.scene, this.camera);
      this.sarees[0].group.visible = false;
    }
    if (this.models[0]) {
      this.models[0].grp.visible = true;
      this.renderer.render(this.scene, this.camera);
      this.models[0].grp.visible = false;
    }
    this.renderer.setRenderTarget(null);
    warmRT.dispose();
    if (this.composer) this.composer.render(0.016);
    this.sarees.forEach((s, i) => (s.group.visible = prevSarees[i]));
    this.models.forEach((m, i) => (m.grp.visible = prevModels[i]));
    this.rods.forEach((r, i) => (r.visible = prevRods[i]));
  }

  async _warmupShadersAsync() {
    const prevSarees = this.sarees.map((s) => s.group.visible);
    const prevModels = this.models.map((m) => m.grp.visible);
    const prevRods = this.rods.map((r) => r.visible);
    for (const s of this.sarees) s.group.visible = false;
    for (const m of this.models) m.grp.visible = false;
    for (const r of this.rods) r.visible = false;

    const warmRT = new THREE.WebGLRenderTarget(16, 16);

    // Warm shared cloth shader + room geometry into 16x16 RT
    if (this.sarees[0]) {
      this.sarees[0].group.visible = true;
      this.renderer.setRenderTarget(warmRT);
      this.renderer.render(this.scene, this.camera);
      this.sarees[0].group.visible = false;
      this.renderer.setRenderTarget(null);
    }
    await nextFrame();

    // Pre-upload remaining saree canvas textures one per frame
    for (let i = 1; i < this.sarees.length; i++) {
      const m = this.sarees[i].mesh.material;
      this.renderer.initTexture(m.map);
      this.renderer.initTexture(m.roughnessMap);
      await nextFrame();
    }

    // Warm unified statue relief shader once in 16x16 RT
    if (this.models[0]) {
      this.models[0].grp.visible = true;
      this.renderer.setRenderTarget(warmRT);
      this.renderer.render(this.scene, this.camera);
      this.models[0].grp.visible = false;
      this.renderer.setRenderTarget(null);
      await nextFrame();
    }

    // Pre-warm hanging rods + hardware composer once off-screen
    if (this.rods[0]) {
      this.rods[0].visible = true;
      this.renderer.setRenderTarget(warmRT);
      this.renderer.render(this.scene, this.camera);
      this.rods[0].visible = false;
      this.renderer.setRenderTarget(null);
    }
    warmRT.dispose();

    if (this.composer) {
      await nextFrame();
      this.composer.render(0.016);
    }

    this.sarees.forEach((s, i) => (s.group.visible = prevSarees[i]));
    this.models.forEach((m, i) => (m.grp.visible = prevModels[i]));
    this.rods.forEach((r, i) => (r.visible = prevRods[i]));
  }

  init() {
    this._setupCore();
    this.buildBackdrop();
    this.buildFloor();
    this.buildPillars();
    this.buildSarees();
    this.buildModels();
    this.buildMandala();
    this.buildLoomProps();
    this.buildRods();
    this.buildDust();
    this._setupComposer();
    this.bindEvents();
    this.resize();
    this._warmupShaders();
    this.measure();
    this.ready = true;
  }

  /**
   * Incremental non-blocking initialization spread across animation frames so
   * the hero film stays 100% responsive with zero Long Task startup freezes.
   */
  initAsync() {
    if (this._initPromise) return this._initPromise;
    this._initPromise = (async () => {
      const texReady = this._preloadModelTextures();
      this._setupCore(true);
      await nextFrame();

      this._setupEnvironment();
      this.buildBackdrop();
      await nextFrame();

      this.buildFloor();
      this.buildPillars();
      await nextFrame();

      this.buildMandala();
      this.buildLoomProps();
      this.buildRods();
      this.buildDust();
      await nextFrame();

      const maxAniso = Math.min(this.renderer.capabilities.getMaxAnisotropy(), 8);
      const texW = this.isSoftware ? 1024 : this.isMobile ? 1280 : 1536;
      const segX = this.isSoftware ? 96 : this.isMobile ? 128 : 180;
      const segY = this.isSoftware ? 18 : this.isMobile ? 22 : 30;
      const geo = new THREE.PlaneGeometry(LEN, WID, segX, segY);
      this.sarees = [];
      for (let i = 0; i < SAREES.length; i++) {
        const p = SAREES[i];
        const maps = createSareeCanvases(p, texW);
        const { mat, uniforms } = makeClothMaterial(maps, p, maxAniso, this.isSoftware);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.frustumCulled = false;
        const group = new THREE.Group();
        group.add(mesh);
        this.scene.add(group);
        this.sarees.push({ group, mesh, uniforms, track: TRACKS[i], state: { ...BASE }, palette: p });
        await nextFrame();
      }

      await texReady;
      this.buildModels();
      this._setupComposer();
      this.bindEvents();
      this.resize();
      await nextFrame();

      for (const { colorTex, depthTex } of this._modelTexCache) {
        this.renderer.initTexture(colorTex);
        this.renderer.initTexture(depthTex);
        await nextFrame();
      }
      await this._warmupShadersAsync();
      this.measure();
      this.ready = true;
    })();
    return this._initPromise;
  }

  ensureReady() {
    return this.ready ? Promise.resolve() : this.initAsync();
  }

  _preloadModelTextures() {
    if (this._modelTexPromise) return this._modelTexPromise;
    const loader = new THREE.TextureLoader();
    const maxAniso = 8;
    const loadOne = (url, isColor) =>
      new Promise((resolve) => {
        const tex = loader.load(
          url,
          () => resolve(tex),
          undefined,
          () => resolve(tex)
        );
        if (isColor) tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = maxAniso;
      });
    this._modelTexPromise = Promise.all(
      MODEL_SPECS.map(async (sp) => {
        const [colorTex, depthTex] = await Promise.all([
          loadOne(`/images/3d/${sp.id}-model.webp`, true),
          loadOne(`/images/3d/${sp.id}-depth.png`, false),
        ]);
        return { colorTex, depthTex };
      })
    ).then((cache) => {
      this._modelTexCache = cache;
      return cache;
    });
    return this._modelTexPromise;
  }

  bindEvents() {
    window.addEventListener('pointermove', (e) => {
      this.mouse.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
      if (!this.isDragging) return;
      const dx = (e.clientX - this.lastPtr.x) / window.innerWidth;
      const dy = (e.clientY - this.lastPtr.y) / window.innerHeight;
      this.lastPtr = { x: e.clientX, y: e.clientY };
      this.dragTarget.x = clamp(this.dragTarget.x - dx * 2.4, -0.75, 0.75);
      this.dragTarget.y = clamp(this.dragTarget.y + dy * 1.4, -0.45, 0.45);
    });

    const sticky = this.section.querySelector('.loom__sticky');
    sticky.addEventListener('pointerdown', (e) => {
      if (e.target.closest('a, button')) return;
      this.isDragging = true;
      this.lastPtr = { x: e.clientX, y: e.clientY };
      sticky.classList.add('is-grabbing');
    });
    window.addEventListener('pointerup', () => {
      this.isDragging = false;
      sticky.classList.remove('is-grabbing');
    });
  }

  buildBackdrop() {
    const geo = new THREE.PlaneGeometry(46, 28);
    this.bgUniforms = {
      uGlow: { value: new THREE.Color(SAREES[0].glow) },
      uTime: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.bgUniforms,
      depthWrite: false,
      fog: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        uniform vec3 uGlow;
        uniform float uTime;
        void main() {
          vec2 p = (vUv - 0.5) * vec2(1.66, 1.0);
          float d = length(p - vec2(0.0, 0.02));
          vec3 base = vec3(0.032, 0.011, 0.016);
          float glow = smoothstep(0.52, 0.0, d);
          vec3 col = base + uGlow * glow * 0.58;
          float rings = smoothstep(0.004, 0.0, abs(fract(d * 9.0 - uTime * 0.03) - 0.5) - 0.495);
          col += vec3(0.85, 0.65, 0.3) * rings * 0.025 * smoothstep(0.52, 0.06, d);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }
      `,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.z = -11;
    mesh.renderOrder = -1;
    this.scene.add(mesh);
  }

  buildFloor() {
    const maps = createFloorTextures();
    const map = new THREE.CanvasTexture(maps.color);
    map.colorSpace = THREE.SRGBColorSpace;
    const rough = new THREE.CanvasTexture(maps.rough);
    const mat = new THREE.MeshStandardMaterial({
      map,
      roughnessMap: rough,
      roughness: 1,
      metalness: 0.22,
      envMapIntensity: 0.42,
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(18, 18), mat);
    floor.rotation.x = -HALF_PI;
    floor.position.set(0, -2.35, -1.8);
    this.scene.add(floor);
  }

  buildPillars() {
    // Turned South Indian temple pillar profile
    const pts = [
      new THREE.Vector2(0.42, -2.35),
      new THREE.Vector2(0.42, -2.05),
      new THREE.Vector2(0.32, -1.92),
      new THREE.Vector2(0.36, -1.82),
      new THREE.Vector2(0.24, -1.68),
      new THREE.Vector2(0.20, -1.05),
      new THREE.Vector2(0.27, -0.95),
      new THREE.Vector2(0.21, -0.84),
      new THREE.Vector2(0.18, 0.45),
      new THREE.Vector2(0.25, 0.58),
      new THREE.Vector2(0.19, 0.72),
      new THREE.Vector2(0.22, 1.55),
      new THREE.Vector2(0.34, 1.75),
      new THREE.Vector2(0.28, 1.88),
      new THREE.Vector2(0.42, 2.05),
      new THREE.Vector2(0.42, 2.35),
    ];
    const shaftGeo = new THREE.LatheGeometry(pts, 18);
    const wood = new THREE.MeshStandardMaterial({
      color: 0x2c110c,
      roughness: 0.52,
      metalness: 0.14,
      envMapIntensity: 0.85,
    });
    const gold = new THREE.MeshStandardMaterial({
      color: 0xd9b25c,
      metalness: 1,
      roughness: 0.28,
      envMapIntensity: 1.3,
    });
    const ringGeo = new THREE.TorusGeometry(0.27, 0.016, 10, 32);

    const coords = [
      [-4.6, -0.7], [4.6, -0.7],
      [-4.2, -4.4], [4.2, -4.4],
      [-3.9, -8.2], [3.9, -8.2],
    ];
    this.pillars = coords.map(([x, z], idx) => {
      const g = new THREE.Group();
      const shaft = new THREE.Mesh(shaftGeo, wood);
      const rLow = new THREE.Mesh(ringGeo, gold);
      rLow.rotation.x = HALF_PI;
      rLow.position.y = -0.95;
      const rMid = new THREE.Mesh(ringGeo, gold);
      rMid.rotation.x = HALF_PI;
      rMid.position.y = 0.58;
      g.add(shaft, rLow, rMid);
      g.position.set(x, 0, z);
      g.rotation.y = idx * 0.4;
      this.scene.add(g);
      return g;
    });
  }

  buildSarees() {
    const maxAniso = Math.min(this.renderer.capabilities.getMaxAnisotropy(), 8);
    const texW = this.isSoftware ? 1024 : this.isMobile ? 1280 : 1536;
    const segX = this.isSoftware ? 96 : this.isMobile ? 128 : 180;
    const segY = this.isSoftware ? 18 : this.isMobile ? 22 : 30;
    const geo = new THREE.PlaneGeometry(LEN, WID, segX, segY);

    this.sarees = SAREES.map((p, i) => {
      const maps = createSareeCanvases(p, texW);
      const { mat, uniforms } = makeClothMaterial(maps, p, maxAniso, this.isSoftware);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      const group = new THREE.Group();
      group.add(mesh);
      this.scene.add(group);
      return { group, mesh, uniforms, track: TRACKS[i], state: { ...BASE }, palette: p };
    });
  }

  buildModels() {
    this._preloadModelTextures();
    const maxAniso = Math.min(this.renderer.capabilities.getMaxAnisotropy(), 8);
    const gold = new THREE.MeshStandardMaterial({ color: 0xd9b25c, metalness: 1, roughness: 0.25, envMapIntensity: 1.35 });
    const teak = new THREE.MeshStandardMaterial({ color: 0x260d09, roughness: 0.5, metalness: 0.15, envMapIntensity: 0.7 });
    const segW = this.isMobile || this.isSoftware ? 40 : 72;
    const segH = this.isMobile || this.isSoftware ? 64 : 120;

    this.models = MODEL_SPECS.map((sp, i) => {
      const grp = new THREE.Group();

      const { colorTex, depthTex } = this._modelTexCache[i];
      colorTex.anisotropy = maxAniso;
      depthTex.anisotropy = maxAniso;

      const uniforms = {
        uTime: { value: 0 },
        uSway: { value: sp.sway },
        uSeed: { value: i * 2.4 },
      };

      const baseOpts = {
        map: colorTex,
        displacementMap: depthTex,
        displacementScale: 0.34,
        displacementBias: -0.04,
        bumpMap: depthTex,
        bumpScale: 0.032,
        transparent: true,
        alphaTest: 0.08,
        roughness: 0.58,
        metalness: 0.06,
        side: THREE.DoubleSide,
        envMapIntensity: 0.72,
      };
      const mat = this.isSoftware
        ? new THREE.MeshStandardMaterial(baseOpts)
        : new THREE.MeshPhysicalMaterial({
            ...baseOpts,
            sheen: 0.65,
            sheenRoughness: 0.38,
            sheenColor: new THREE.Color(sp.sheen),
          });

      mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader =
          `uniform float uTime;\nuniform float uSway;\nuniform float uSeed;\n` +
          shader.vertexShader.replace(
            '#include <begin_vertex>',
            /* glsl */ `
              vec3 transformed = vec3(position);
              float hem = smoothstep(0.46, 0.02, uv.y) * uSway;
              transformed.z += sin(uv.x * 8.5 + uTime * 1.45 + uSeed) * 0.042 * hem;
              transformed.x += sin(uTime * 0.95 + uv.y * 5.0 + uSeed) * 0.022 * hem;
            `
          );
      };
      mat.customProgramCacheKey = () => 'saree-model-relief';

      const fig = new THREE.Mesh(new THREE.PlaneGeometry(sp.w, sp.h, segW, segH), mat);
      fig.frustumCulled = false;
      grp.add(fig);

      // Architectural 3D temple frame behind & plinth below each woman statue
      if (sp.cameo) {
        const ringOuter = new THREE.Mesh(new THREE.TorusGeometry(1.32, 0.022, 14, 120), gold);
        ringOuter.position.set(0, -0.02, -0.14);
        const ringInner = new THREE.Mesh(new THREE.TorusGeometry(1.18, 0.011, 10, 100), gold);
        ringInner.position.set(0, -0.02, -0.08);
        // Sculpted bottom cradle shelf hugging hip edge cleanly
        const cradle = new THREE.Mesh(new THREE.TorusGeometry(1.24, 0.045, 14, 60, Math.PI * 0.82), gold);
        cradle.rotation.z = Math.PI * 1.09;
        cradle.position.set(0, -0.04, 0.06);
        const lotus = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.24, 0.24, 24), teak);
        lotus.position.set(0, -1.32, 0.02);
        const lotusRim = new THREE.Mesh(new THREE.TorusGeometry(0.47, 0.018, 10, 36), gold);
        lotusRim.rotation.x = HALF_PI;
        lotusRim.position.set(0, -1.21, 0.02);
        grp.add(ringOuter, ringInner, cradle, lotus, lotusRim);
      } else {
        const archRad = 0.88;
        const arch = new THREE.Mesh(new THREE.TorusGeometry(archRad, 0.022, 12, 96, Math.PI * 1.32), gold);
        arch.rotation.z = -Math.PI * 0.16;
        arch.position.set(0, 0.45, -0.22);
        const innerHalo = new THREE.Mesh(new THREE.TorusGeometry(archRad * 0.86, 0.010, 10, 84, Math.PI * 1.24), gold);
        innerHalo.rotation.z = -Math.PI * 0.12;
        innerHalo.position.set(0, 0.45, -0.18);

        // Turned lotus pedestal ground dais
        const topDisk = new THREE.Mesh(new THREE.CylinderGeometry(0.76, 0.82, 0.12, 32), teak);
        topDisk.position.set(0, -sp.h / 2 - 0.06, 0.05);
        const rimTop = new THREE.Mesh(new THREE.TorusGeometry(0.77, 0.018, 10, 48), gold);
        rimTop.rotation.x = HALF_PI;
        rimTop.position.set(0, -sp.h / 2 - 0.01, 0.05);
        const baseStep = new THREE.Mesh(new THREE.CylinderGeometry(0.86, 0.98, 0.34, 32), teak);
        baseStep.position.set(0, -sp.h / 2 - 0.29, 0.05);
        const rimBot = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.020, 10, 48), gold);
        rimBot.rotation.x = HALF_PI;
        rimBot.position.set(0, -sp.h / 2 - 0.44, 0.05);
        grp.add(arch, innerHalo, topDisk, rimTop, baseStep, rimBot);
      }

      grp.visible = false;
      this.scene.add(grp);
      return { grp, uniforms, track: MODEL_TRACKS[i], state: { ...MBASE }, spec: sp };
    });
  }

  buildMandala() {
    const g = (this.mandala = new THREE.Group());
    const gold = new THREE.MeshStandardMaterial({ color: 0xd9b25c, metalness: 1, roughness: 0.25, envMapIntensity: 1.4 });
    const copper = new THREE.MeshStandardMaterial({ color: 0xc28a46, metalness: 0.95, roughness: 0.3, envMapIntensity: 1.2 });

    // Primary mandala wheel
    const r1 = new THREE.Mesh(new THREE.TorusGeometry(2.65, 0.015, 14, 240), gold);
    const r2 = new THREE.Mesh(new THREE.TorusGeometry(2.86, 0.008, 10, 240), gold);
    const r3 = new THREE.Mesh(new THREE.TorusGeometry(1.92, 0.010, 10, 200), gold);
    g.add(r1, r2, r3);

    // Nested 3D gyroscopic rings tilted orthogonally for strong 3D volume
    this.gyroA = new THREE.Mesh(new THREE.TorusGeometry(2.15, 0.012, 12, 180), copper);
    this.gyroA.rotation.set(0.75, 0.4, 0);
    this.gyroB = new THREE.Mesh(new THREE.TorusGeometry(1.52, 0.011, 12, 160), gold);
    this.gyroB.rotation.set(-0.65, -0.5, 0.3);
    g.add(this.gyroA, this.gyroB);

    const petalGeo = new THREE.SphereGeometry(1, 20, 10);
    const petals = new THREE.InstancedMesh(petalGeo, gold, 48);
    const dots = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.036, 0), gold, 72);
    const m = new THREE.Object3D();
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      m.position.set(Math.cos(a) * 2.36, Math.sin(a) * 2.36, Math.sin(a * 4) * 0.06);
      m.rotation.set(0, 0, a - HALF_PI);
      m.scale.set(0.048, 0.21, 0.028);
      m.updateMatrix();
      petals.setMatrixAt(i, m.matrix);
    }
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2;
      const r = i % 2 ? 2.08 : 2.75;
      m.position.set(Math.cos(a) * r, Math.sin(a) * r, 0);
      m.rotation.set(0, 0, a);
      m.scale.setScalar(i % 2 ? 0.9 : 0.65);
      m.updateMatrix();
      dots.setMatrixAt(i, m.matrix);
    }
    g.add(petals, dots);
    g.position.set(0, 0.12, -4.3);
    this.scene.add(g);
  }

  buildLoomProps() {
    const gold = new THREE.MeshStandardMaterial({ color: 0xd9b25c, metalness: 1, roughness: 0.24, envMapIntensity: 1.4 });
    const teak = new THREE.MeshStandardMaterial({ color: 0x4b1d14, roughness: 0.42, metalness: 0.15 });

    // Wooden & brass handloom shuttles (dobby shuttles)
    const shuttlePts = [
      new THREE.Vector2(0.001, -0.34),
      new THREE.Vector2(0.028, -0.24),
      new THREE.Vector2(0.056, -0.10),
      new THREE.Vector2(0.060, 0.0),
      new THREE.Vector2(0.056, 0.10),
      new THREE.Vector2(0.028, 0.24),
      new THREE.Vector2(0.001, 0.34),
    ];
    const shuttleGeo = new THREE.LatheGeometry(shuttlePts, 16);
    const tipGeo = new THREE.ConeGeometry(0.022, 0.09, 12);

    const shuttleSpecs = [
      { pos: [-2.4, 1.15, 0.9], rot: [0.4, 0.2, 0.8], speed: 0.45 },
      { pos: [2.5, -1.05, 1.1], rot: [-0.3, 0.5, -0.9], speed: 0.38 },
      { pos: [-2.1, -1.1, -1.6], rot: [0.6, -0.4, 0.5], speed: 0.52 },
      { pos: [2.2, 1.2, -1.9], rot: [-0.5, 0.3, -0.6], speed: 0.42 },
    ];

    this.shuttles = shuttleSpecs.map((sp, i) => {
      const grp = new THREE.Group();
      const body = new THREE.Mesh(shuttleGeo, teak);
      const t1 = new THREE.Mesh(tipGeo, gold);
      t1.position.y = 0.33;
      const t2 = new THREE.Mesh(tipGeo, gold);
      t2.rotation.x = Math.PI;
      t2.position.y = -0.33;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.14, 16), gold);
      grp.add(body, t1, t2, band);
      grp.position.set(...sp.pos);
      grp.rotation.set(...sp.rot);
      this.scene.add(grp);
      return { grp, base: sp.pos, speed: sp.speed, phase: i * 1.7 };
    });

    // 3D golden zari threads sweeping through depth
    this.threads = [];
    for (let k = 0; k < 3; k++) {
      const pts = [];
      for (let i = 0; i <= 40; i++) {
        const u = i / 40;
        const a = u * Math.PI * 2.2 + k * 2.1;
        pts.push(
          new THREE.Vector3(
            lerp(-4.8, 4.8, u),
            Math.sin(a * 1.4) * (1.2 + k * 0.25) + (k - 1) * 0.55,
            Math.cos(a) * 1.8 - 1.2 - k * 0.8
          )
        );
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      const geo = new THREE.TubeGeometry(curve, 96, 0.0085, 8, false);
      const mesh = new THREE.Mesh(geo, gold);
      this.scene.add(mesh);
      this.threads.push(mesh);
    }
  }

  buildRods() {
    const gold = new THREE.MeshStandardMaterial({ color: 0xd9b25c, metalness: 1, roughness: 0.22 });
    this.rods = SAREES.map(() => {
      const rod = new THREE.Group();
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 1.0, 16), gold);
      bar.rotation.z = HALF_PI;
      const capGeo = new THREE.SphereGeometry(0.048, 16, 12);
      const c1 = new THREE.Mesh(capGeo, gold);
      const c2 = new THREE.Mesh(capGeo, gold);
      c1.position.x = -0.52;
      c2.position.x = 0.52;
      rod.add(bar, c1, c2);
      rod.visible = false;
      this.scene.add(rod);
      return rod;
    });
  }

  buildDust() {
    const count = this.isMobile ? 1000 : 2600;
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 17;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 9.5;
      pos[i * 3 + 2] = -7 + Math.random() * 10.5;
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.dustUniforms = {
      uTime: { value: 0 },
      uPixel: { value: 1 },
      uBoost: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.dustUniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute float aSeed;
        uniform float uTime;
        uniform float uPixel;
        uniform float uBoost;
        varying float vAlpha;
        void main() {
          vec3 p = position;
          float t = uTime * (0.08 + aSeed * 0.12);
          p.y = mod(p.y + 4.75 + t * (1.0 + uBoost * 2.0), 9.5) - 4.75;
          p.x += sin(uTime * 0.35 + aSeed * 40.0) * 0.3;
          p.z += cos(uTime * 0.28 + aSeed * 20.0) * 0.3;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float size = (0.65 + aSeed * 2.4) * (1.0 + uBoost * 0.6);
          gl_PointSize = size * uPixel * (7.2 / -mv.z);
          float tw = 0.5 + 0.5 * sin(uTime * (1.5 + aSeed * 3.0) + aSeed * 60.0);
          vAlpha = (0.25 + 0.75 * tw) * smoothstep(-15.0, -2.5, mv.z) * (0.55 + uBoost * 0.45);
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d);
          a = a * a;
          gl_FragColor = vec4(vec3(1.0, 0.82, 0.48) * a * vAlpha, a * vAlpha);
        }
      `,
    });
    this.dust = new THREE.Points(geo, mat);
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);
  }

  measure() {
    this.top = this.section.offsetTop;
    this.height = this.section.offsetHeight;
  }

  resize() {
    if (!this.renderer) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.isMobile = window.matchMedia('(max-width: 820px)').matches;
    this.isDesktop = !this.isMobile;
    if (w !== this._w || h !== this._h) {
      this._w = w;
      this._h = h;
      this.renderer.setSize(w, h, false);
      if (this.composer) {
        this.composer.setSize(w, h);
        this.bloom.setSize(w, h);
      }
      this.camera.aspect = w / h;
      this.camera.fov = w / h < 1 ? 38 + (1 - w / h) * 34 : 38;
      this.camera.updateProjectionMatrix();
      this.dustUniforms.uPixel.value = this.renderer.getPixelRatio() * (h / 900);
    }
    this.measure();
  }

  update(dt, scrollY) {
    const vh = window.innerHeight;
    const raw = (scrollY - this.top) / (this.height - vh);
    const nextVisible = scrollY + vh > this.top && scrollY < this.top + this.height;
    const entered = !this.visible && nextVisible;
    this.visible = nextVisible;
    this.progress = clamp(raw, 0, 1);
    if (entered || Math.abs(this.progress - this.smooth) > 0.35) {
      this.smooth = this.progress;
    } else {
      this.smooth += (this.progress - this.smooth) * (1 - Math.exp(-dt * 30));
      if (Math.abs(this.progress - this.smooth) < 0.00002) this.smooth = this.progress;
    }
    const P = this.smooth;

    this.updateChapters(P);
    if (!this.visible || !this.ready || !this.renderer) return;

    this.time += dt;
    const t = this.time;

    this.mouseSmooth.lerp(this.mouse, 1 - Math.exp(-dt * 5.0));
    if (!this.isDragging) {
      this.dragTarget.multiplyScalar(Math.exp(-dt * 1.4));
    }
    this.drag.lerp(this.dragTarget, 1 - Math.exp(-dt * 10));

    // Sarees
    for (const s of this.sarees) {
      const st = sample(s.track, P, s.state);
      s.uniforms.uTime.value = t;
      s.uniforms.uUnroll.value = st.u;
      s.uniforms.uWind.value = st.wind;
      s.uniforms.uPleat.value = st.pleat;
      s.uniforms.uArch.value = st.arch;
      s.uniforms.uTwist.value = st.twist;
      s.uniforms.uPointer.value.copy(this.mouseSmooth);
      s.group.position.set(st.x, st.y, st.z);
      s.group.rotation.set(st.rx, st.ry, st.rz);
      s.group.scale.setScalar(st.s);
      s.group.visible = Math.abs(st.x) < 9.0 && st.y < 4.5;
    }

    // 3D volumetric Women-in-Saree statues
    this.models.forEach((md, i) => {
      const st = sampleModel(md.track, P, md.state);
      md.uniforms.uTime.value = t;
      md.grp.position.set(
        st.x,
        st.y + Math.sin(t * 0.9 + i * 2.1) * 0.028,
        st.z
      );
      md.grp.rotation.set(
        Math.sin(t * 0.65 + i) * 0.02,
        st.ry + Math.sin(t * 0.72 + i * 1.6) * 0.065,
        0
      );
      md.grp.scale.setScalar(st.s);
      md.grp.visible = Math.abs(st.x) < 5.6 && st.y > -2.9 && st.y < 4.4;
    });

    // Brass hanging rods in the finale
    const fin = smoothstep(0.88, 0.97, P);
    this.rods.forEach((rod, i) => {
      const s = this.sarees[i];
      rod.visible = fin > 0.001 && s.group.visible;
      if (!rod.visible) return;
      const topY = s.group.position.y + (LEN / 2) * s.state.s + 0.02;
      rod.position.set(s.group.position.x, topY, s.group.position.z + 0.02);
      rod.rotation.y = s.group.rotation.y;
      rod.scale.set(fin * s.state.s * 1.9, 1, 1);
    });

    // Multi-axis 3D Mandala + Gyroscope rings
    const m = this.mandala;
    m.rotation.z = t * 0.06 + P * 1.4;
    m.rotation.x = Math.sin(t * 0.22) * 0.14;
    m.rotation.y = Math.cos(t * 0.18) * 0.18;
    const ms = lerp(0.88, 1.22, fin);
    m.scale.setScalar(ms);
    m.position.z = lerp(-4.5, -3.4, fin);
    this.gyroA.rotation.x = 0.75 + t * 0.18 + P * 2.1;
    this.gyroA.rotation.y = 0.4 + t * 0.11;
    this.gyroB.rotation.y = -0.5 - t * 0.22 - P * 1.8;
    this.gyroB.rotation.z = 0.3 + t * 0.15;

    // 3D shuttles + golden zari threads
    for (const sh of this.shuttles) {
      sh.grp.position.y = sh.base[1] + Math.sin(t * sh.speed + sh.phase) * 0.24;
      sh.grp.position.x = sh.base[0] + Math.cos(t * 0.3 + sh.phase) * 0.15;
      sh.grp.rotation.x += dt * 0.28 * sh.speed;
      sh.grp.rotation.y += dt * 0.45 * sh.speed;
    }
    this.threads.forEach((th, i) => {
      th.rotation.x = Math.sin(t * 0.2 + i) * 0.08 + P * 0.4;
      th.rotation.y = Math.cos(t * 0.15 + i * 2) * 0.12;
      th.position.y = Math.sin(t * 0.3 + i) * 0.12;
    });

    // Dynamic palette glow + rim light color (zero per-frame allocations)
    this.bgUniforms.uGlow.value
      .copy(_c0)
      .lerp(_c1, smoothstep(0.27, 0.36, P))
      .lerp(_c2, smoothstep(0.56, 0.65, P))
      .lerp(_c3, smoothstep(0.84, 0.94, P));
    this.bgUniforms.uTime.value = t;

    this.rim.color
      .copy(_r0)
      .lerp(_r1, smoothstep(0.27, 0.36, P))
      .lerp(_r2, smoothstep(0.56, 0.65, P))
      .lerp(_r3, smoothstep(0.84, 0.94, P));

    this.dustUniforms.uTime.value = t;
    this.dustUniforms.uBoost.value = fin;

    // 3D orbiting camera choreography + user drag + mouse parallax
    const camState = sampleCamera(P);
    const az = camState[1] + this.mouseSmooth.x * 0.16 + this.drag.x + Math.sin(t * 0.18) * 0.04;
    const el = camState[2] + this.mouseSmooth.y * 0.10 + this.drag.y + Math.cos(t * 0.14) * 0.025;
    const dist = camState[3];
    const tx = camState[4];
    const ty = camState[5];
    const cam = this.camera;
    const cosEl = Math.cos(el);
    cam.position.set(
      tx + Math.sin(az) * cosEl * dist,
      ty + Math.sin(el) * dist,
      Math.cos(az) * cosEl * dist
    );
    cam.lookAt(tx, ty, 0);

    // Sweeping specular lights across folds
    this.spot.position.set(Math.sin(t * 0.55) * 2.2, 1.4 + Math.cos(t * 0.35) * 0.4, 2.8);
    this.accentLight.position.set(Math.cos(t * 0.4) * -2.6, -1.1, 1.2 + Math.sin(t * 0.5) * 0.8);

    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  updateChapters(p) {
    for (const el of this.chapters) {
      applyChapter(el, p, this.isDesktop);
    }
    const idx = p < 0.29 ? 0 : p < 0.58 ? 1 : p < 0.86 ? 2 : 3;
    if (idx !== this.lastIdx) {
      this.dots.forEach((d, i) => d.classList.toggle('is-active', i === idx));
      this.lastIdx = idx;
    }
  }
}

export { applyChapter };
