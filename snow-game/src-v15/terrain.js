// The mountain: a heightmap with several groomed runs carved into it, kickers, a cliff,
// forest, rocks, trail signs and finish gates at the base. Downhill is -z.
import * as THREE from 'three';
import { fbm, noise2, rng, smoothstep } from './noise.js';
import { makeRuns, DIFF, RUN_STEP } from './runs.js';

export const CELL = 3;                     // grid spacing (m)
export const WORLD = { x0: -390, x1: 390, zTop: 660, zBot: -1490 };   // north of the summit (+z) is the backside bowl
export const SUMMIT = { x: 50, z: 26 };    // top of the mountain / Summit Express
export const RIDGE_TOP = { x: -300, z: -612 };
export const EXPRESS_TOP = { x: 86, z: 26 };    // Summit Express top station, right of the summit
export const BASE_Z = -1370;               // top of the base area
export const LIFT_BOTTOMS = { express: { x: 140, z: -1404 }, ridge: { x: -262, z: -1404 }, backside: { x: 22, z: 588 } };
export const BACKSIDE_TOP = { x: 2, z: 34 };    // Backside Lift top, on the ridge just west of the summit

const GROOM_FADE = 18;                     // m from a run's edge to untouched snow
// jump sizes: [lip angle vs slope, length, width]
const JUMP = { S: [0.4, 6, 5], M: [0.5, 8, 6], L: [0.6, 10, 7], XL: [0.68, 12, 8] };
const KICKERS = [
  // [run id, at world z, offset from center, lip angle vs slope, length, width]
  ['main', -545, 8, 0.5, 9, 8],
  ['long', -300, 0, 0.4, 7, 6],
  ['cross', -420, 0, 0.5, 9, 7],
  ['timber', -980, 0, 0.5, 9, 7],
  ['ridge', -1050, 0, 0.55, 10, 8],
];
// The Yard: jump lines (small / medium / large side by side), rails & boxes, and a halfpipe.
// Positions are by world z (the park runs steadily downhill).
const PARK = {
  run: 'park',
  jumps: [[-200, [['S', -15], ['M', 0], ['L', 15]]], [-330, [['S', -15], ['M', 0], ['L', 15]]], [-680, [['M', -15], ['L', 0], ['XL', 15]]], [-800, [['S', -15], ['M', 0], ['L', 15]]]],
  rails: [
    // [z, offset, length, kind, height at start]
    [-265, -13, 12, 'rail', 0.3], [-265, 0, 9, 'box', 0.25], [-265, 13, 14, 'rail', 0.3],
    [-400, -12, 16, 'rail', 0.3], [-400, 12, 10, 'box', 0.25],
    [-740, -14, 12, 'rail', 0.3], [-740, 0, 14, 'box', 0.25],
    [-1215, -12, 14, 'rail', 0.3], [-1215, 0, 10, 'box', 0.25], [-1215, 12, 12, 'rail', 0.3],
  ],
  pipe: { z0: -1022, z1: -1148 },
};
// Halfpipe shape (m): flat bottom half-width, transition radius, wall height, deck width
export const PIPE = { fw: 4.5, R: 5.5, H: 4.5, deck: 3 };
PIPE.wallW = Math.sqrt(PIPE.R * PIPE.R - (PIPE.R - PIPE.H) ** 2);
PIPE.outer = PIPE.fw + PIPE.wallW + PIPE.deck + PIPE.H * 1.5;
// Off-piste landforms. Gullies (natural halfpipes): [centre line, half width, depth]
const GULLIES = [
  [[[-272, -150], [-280, -260], [-270, -380], [-278, -530]], 13, 7],
  [[[182, -600], [188, -700], [180, -790], [195, -860]], 12, 6],
  [[[262, -990], [270, -1090], [262, -1180], [268, -1260]], 13, 6],
  // backside bowl: three narrow chutes through the rock bands in the headwall
  [[[-40, 38], [-38, 90], [-42, 150]], 7, 5],
  [[[90, 40], [92, 95], [88, 150]], 7, 5],
  [[[200, 45], [198, 95], [203, 150]], 7, 5],
];
// Spines in the backside bowl: sharp-crested ridges running down the fall line to carve along. [a, b, height, half width]
const SPINES = [
  [[-75, 90], [-62, 330], 9, 22],
  [[155, 95], [168, 300], 8, 20],
  [[38, 200], [30, 380], 6, 18],
];
// Ridges you can launch off (gentle ramp up, steep drop on the downhill side): [a, b, height]
const RIDGES = [
  [[150, -405], [200, -415], 3.2],
  [[-28, -470], [8, -480], 3],
  [[255, -935], [295, -948], 3.5],
  [[-262, -575], [-228, -585], 3],
];
// Cliff bands: [a, b, drop]
const CLIFFS = [
  [[150, -478], [205, -490], 6],
  [[-168, -1122], [-140, -1130], 5],
  // rock bands across the backside headwall (they face north, down into the bowl), with the chutes in the gaps
  [[-150, 84], [-52, 88], 6, true], [[-28, 88], [78, 90], 6, true], [[102, 90], [188, 88], 6, true], [[212, 88], [290, 84], 6, true],
];
// Snow-covered rocks that kick you into the air: [x, z, radius, height]
const SNOW_ROCKS = [
  [-245, -210, 3, 1.6], [-250, -340, 2.8, 1.5], [-302, -465, 3, 1.7],
  [170, -375, 3, 1.6], [200, -540, 2.8, 1.5], [168, -560, 3.2, 1.8],
  [152, -650, 3, 1.6], [150, -760, 2.8, 1.5],
  [238, -1160, 3, 1.6], [285, -1200, 3, 1.7],
  [-2, -250, 2.8, 1.5], [5, -420, 3, 1.6],
  [-150, -1060, 3, 1.6], [-145, -1215, 2.8, 1.5],
  [-245, -960, 3, 1.7], [-250, -1130, 3, 1.6],
  // boulders in the backside bowl
  [-100, 180, 3, 1.8], [-20, 240, 3.2, 1.9], [65, 165, 2.8, 1.6], [120, 260, 3, 1.8], [205, 205, 3, 1.7],
  [-55, 395, 3.2, 1.9], [-10, 320, 2.8, 1.6], [150, 400, 3, 1.8], [90, 450, 3, 1.6], [-140, 300, 3, 1.8],
];
// A hidden yeti (way out on the right-hand valley wall; easiest to reach from the air)
export const YETI = { x: 362, z: -560 };
// a line segment's frame: along (ex, ez), downhill-side normal (nx, nz), length
function segFrame([a, b], north = false) {
  let ex = b[0] - a[0], ez = b[1] - a[1]; const len = Math.hypot(ex, ez); ex /= len; ez /= len;
  // the "downhill" side: -z on the front of the mountain, +z in the backside bowl
  let nx = -ez, nz = ex; if ((nz > 0) !== north) { nx = -nx; nz = -nz; }
  return { ax: a[0], az: a[1], ex, ez, nx, nz, len };
}
const RIDGE_F = RIDGES.map(([a, b, H]) => ({ ...segFrame([a, b]), H }));
const CLIFF_F = CLIFFS.map(([a, b, drop, north]) => ({ ...segFrame([a, b], !!north), drop }));
const SPINE_F = SPINES.map(([a, b, H, w]) => ({ ...segFrame([a, b]), H, w }));
const GULLY_F = GULLIES.map(([pts, hw, depth]) => {
  const segs = []; let L = 0;
  for (let i = 0; i < pts.length - 1; i++) { const f = segFrame([pts[i], pts[i + 1]]); f.s0 = L; L += f.len; segs.push(f); }
  const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]);
  return { segs, L, hw, depth, x0: Math.min(...xs) - hw - 5, x1: Math.max(...xs) + hw + 5, z0: Math.min(...zs) - hw - 5, z1: Math.max(...zs) + hw + 5 };
});
// distance from (x, z) to a gully centre line -> { d, s }
function gullyDist(g, x, z) {
  let best = 1e9, bs = 0;
  for (const f of g.segs) {
    const u = Math.max(0, Math.min(f.len, (x - f.ax) * f.ex + (z - f.az) * f.ez));
    const d = Math.hypot(x - f.ax - f.ex * u, z - f.az - f.ez * u);
    if (d < best) { best = d; bs = f.s0 + u; }
  }
  return { d: best, s: bs };
}
const CLIFF = { run: 'chute', z: -560, drop: 7 };
// Natural jumps: snow rolls shaped into the runs (a ramp up, then a quick drop). [run, s along run]
const NATURAL_JUMPS = [
  ['main', 260], ['main', 760], ['main', 1180], ['long', 520], ['long', 1100], ['chute', 300], ['chute', 1050],
  ['cross', 260], ['timber', 280], ['timber', 640], ['ridge', 420], ['ridge', 700],
];
// Downed trees near the run edges you can ride like a rail. [run, s, side (-1 left / 1 right), length]
const LOGS = [
  ['main', 340, -1, 11], ['main', 900, 1, 10], ['long', 620, 1, 10], ['long', 1000, -1, 12], ['chute', 420, -1, 9],
  ['cross', 150, 1, 10], ['timber', 450, -1, 11], ['timber', 800, 1, 10], ['ridge', 500, 1, 10],
];
const PADS = [
  { x: SUMMIT.x, z: SUMMIT.z - 6, r: 34 },     // summit flat (lift top, start of runs)
  { x: RIDGE_TOP.x, z: RIDGE_TOP.z, r: 22 },  // ridge lift top
  { x: EXPRESS_TOP.x, z: EXPRESS_TOP.z - 4, r: 14 },
  { x: LIFT_BOTTOMS.express.x - 4, z: LIFT_BOTTOMS.express.z - 10, r: 30 },   // flat lift-line areas at the base
  { x: LIFT_BOTTOMS.ridge.x - 4, z: LIFT_BOTTOMS.ridge.z - 10, r: 30 },
  { x: LIFT_BOTTOMS.backside.x - 2, z: LIFT_BOTTOMS.backside.z + 8, r: 26 },   // bottom of the backside bowl
  { x: BACKSIDE_TOP.x + 4, z: BACKSIDE_TOP.z - 6, r: 16, level: 0 },   // level with the summit flat, so you roll across to the front runs
];

export class Terrain {
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.opts = opts;
    this.x0 = WORLD.x0; this.z0 = WORLD.zTop;
    this.cols = Math.round((WORLD.x1 - WORLD.x0) / CELL);
    this.rows = Math.round((WORLD.zTop - WORLD.zBot) / CELL);
    this.runs = makeRuns();
    this.runById = Object.fromEntries(this.runs.map(r => [r.id, r]));
    this.kickers = [];
    this.rails = [];
    this.trees = [];
    this._buildElevationTable();
    this._buildHeights();
    this._buildMesh();
    this._buildKickers();
    this._buildPark();
    this._buildFeatures();
    this._buildLogs();
    this._buildYeti();
    this._buildTrees();
    this._bakeShadows();
    this._buildRocks();
    this._buildSigns();
  }

  // ---------- shape of the mountain ----------
  // Slope (rise/run) along the fall line, s = meters below the summit.
  _steep(s) {
    if (s < 0) {
      // the backside bowl (north of the summit): a gentle crest, a steep headwall, an open powder bowl,
      // a flat floor at the Backside Lift and a wall rising behind it
      const b = -s;
      const rate = 0.15 + 0.70 * smoothstep(6, 20, b) - 0.35 * smoothstep(95, 130, b) - 0.25 * smoothstep(280, 320, b)
        - 0.19 * smoothstep(440, 480, b) - 0.36 * smoothstep(548, 578, b) - 0.012 * Math.max(0, b - 578);
      return -rate;
    }
    let k = 0.21;
    k += 0.21 * smoothstep(90, 280, s);                       // steep middle
    k += 0.05 * Math.sin(s / 95);                            // rolls and steps
    k -= 0.22 * smoothstep(1050, 1300, s);                   // easing out toward the base
    k -= 0.08 * smoothstep(1330, 1400, s);                   // flat base area
    return Math.max(0.03, k);
  }

  _buildElevationTable() {
    this.eS0 = -800; this.E = new Float32Array(2550);
    let h = 0;
    for (let i = 0; i < this.E.length; i++) { this.E[i] = h; h -= this._steep(this.eS0 + i); }
    const off = 1090 - this.E[-this.eS0];        // summit stays at the same height as before
    for (let i = 0; i < this.E.length; i++) this.E[i] += off;
  }

  _elev(s) {
    const f = Math.max(0, Math.min(this.E.length - 2, s - this.eS0)), i = Math.floor(f);
    return this.E[i] + (this.E[i + 1] - this.E[i]) * (f - i);
  }

  // Natural height with the flat pads (lift tops) pressed in, so runs start level with them.
  rawHeight(x, z) {
    let h = this._natural(x, z);
    for (const p of PADS) {
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < p.r + 25) {
        if (p.h === undefined) p.h = p.level !== undefined ? (PADS[p.level].h ?? (PADS[p.level].h = this._natural(PADS[p.level].x, PADS[p.level].z))) : this._natural(p.x, p.z);
        h += (p.h - h) * (1 - smoothstep(p.r, p.r + 25, d));
      }
    }
    return h;
  }

  // Natural (ungroomed) mountain height.
  _natural(x, z) {
    const s = SUMMIT.z - z;
    let h = this._elev(s);
    // summit is a peak: the top falls off to the sides (on the front); behind it the bowl's rim rises to the sides
    h -= 0.16 * Math.abs(x - SUMMIT.x) * (s >= 0 ? Math.max(0, 1 - s / 450) : 1 - smoothstep(10, 70, -s));
    if (s < 0) h += 0.0007 * (x - 40) * (x - 40) * smoothstep(15, 120, -s);
    // valley walls at the edges of the resort
    const ax = Math.abs(x);
    if (ax > 255) { const e = ax - 255; h += 0.12 * e + 0.0011 * e * e; }
    // big landforms: gullies and ridges running down the fall line, plus rolling ground
    const warp = 1.8 * fbm(x / 300, z / 300, 2);
    h += 5.5 * Math.sin(x / 52 + warp) * smoothstep(-50, 150, s) * (1 - smoothstep(1250, 1380, s));
    h += 15 * fbm(x / 260 + 3.1, z / 260, 3);
    h += 1.3 * fbm(x / 42, z / 42, 3);
    h += 0.2 * fbm(x / 9, z / 9, 2);
    // past the lifts the base area turns uphill so you roll to a stop instead of leaving the mountain
    if (z < BASE_Z - 75) { const e = BASE_Z - 75 - z; h += 0.25 * e + 0.012 * e * e; }
    return h + this._landforms(x, z);
  }

  // Gullies, launch ridges and cliff bands carved into the natural snow (off the groomed runs).
  _landforms(x, z) {
    let h = 0;
    for (const g of GULLY_F) {
      if (x < g.x0 || x > g.x1 || z < g.z0 || z > g.z1) continue;
      const { d, s } = gullyDist(g, x, z);
      if (d >= g.hw) continue;
      const te = smoothstep(0, 25, s) * smoothstep(0, 25, g.L - s);
      const t = d / g.hw;
      h -= g.depth * te * (1 - t * t * t);        // wide floor, walls steepening toward a sharp rim
    }
    for (const r of RIDGE_F) {
      const dx = x - r.ax, dz = z - r.az, u = dx * r.ex + dz * r.ez, v = dx * r.nx + dz * r.nz;
      if (u < -3 || u > r.len + 3 || v < -17 || v > 4) continue;
      const te = smoothstep(-2, 8, u) * smoothstep(-2, 8, r.len - u);
      const prof = v <= -16 ? 0 : v <= 0 ? Math.pow((v + 16) / 16, 1.5) : 1 - smoothstep(0, 3.5, v);
      h += r.H * te * Math.max(0, prof);
    }
    for (const p of SPINE_F) {
      const dx = x - p.ax, dz = z - p.az, u = dx * p.ex + dz * p.ez;
      if (u < -30 || u > p.len + 30) continue;
      const uc = Math.max(0, Math.min(p.len, u)), d = Math.hypot(x - p.ax - p.ex * uc, z - p.az - p.ez * uc);
      if (d >= p.w) continue;
      const te = smoothstep(-25, 20, u) * smoothstep(-25, 20, p.len - u);
      h += p.H * te * Math.pow(1 - d / p.w, 1.5);      // sharp crest, steep flanks
    }
    for (const c of CLIFF_F) {
      const dx = x - c.ax, dz = z - c.az, u = dx * c.ex + dz * c.ez, v = dx * c.nx + dz * c.nz;
      if (u < -14 || u > c.len + 14 || v < -2 || v > 75) continue;
      const te = smoothstep(-12, 0, u) * smoothstep(-12, 0, c.len - u);
      h -= c.drop * te * smoothstep(-0.5, 2.5, v) * (1 - smoothstep(12, 70, v));
    }
    return h;
  }

  // Is (x, z) inside a landform, the halfpipe or a snow rock? (keeps trees and loose rocks out)
  inFeature(x, z, margin = 0) {
    for (const g of GULLY_F) {
      if (x < g.x0 - margin || x > g.x1 + margin || z < g.z0 - margin || z > g.z1 + margin) continue;
      if (gullyDist(g, x, z).d < g.hw + margin) return true;
    }
    for (const r of RIDGE_F) {
      const dx = x - r.ax, dz = z - r.az, u = dx * r.ex + dz * r.ez, v = dx * r.nx + dz * r.nz;
      if (u > -4 - margin && u < r.len + 4 + margin && v > -18 - margin && v < 22 + margin) return true;
    }
    for (const c of CLIFF_F) {
      const dx = x - c.ax, dz = z - c.az, u = dx * c.ex + dz * c.ez, v = dx * c.nx + dz * c.nz;
      if (u > -4 - margin && u < c.len + 4 + margin && v > -12 - margin && v < 30 + margin) return true;
    }
    if (this.pipe) { const P = this.pipe, dx = x - P.ox, dz = z - P.oz, u = dx * P.ax + dz * P.az, l = dx * P.cx + dz * P.cz;
      if (u > -8 - margin && u < P.L + 8 + margin && Math.abs(l) < PIPE.outer + 3 + margin) return true; }
    for (const b of this.snowRocks || []) if (Math.hypot(x - b.x, z - b.z) < b.r * 2.6 + 2 + margin) return true;
    return false;
  }

  _buildHeights() {
    const { cols, rows } = this, W = cols + 1, N = W * (rows + 1);
    const raw = new Float32Array(N);
    for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) raw[j * W + i] = this.rawHeight(this.x0 + i * CELL, this.z0 - j * CELL);

    // groomed profile along each run: smoothed natural height, always heading downhill
    for (const run of this.runs) {
      const n = run.n, base = new Float32Array(n);
      for (let i = 0; i < n; i++) base[i] = this.rawHeight(run.xs[i], run.zs[i]);
      // two passes of a wide moving average -> long, smooth rollers instead of bumps
      const smooth = (src, dst, win) => {
        for (let i = 0; i < n; i++) {
          const w = Math.min(win, i, n - 1 - i);     // narrower near the ends so runs start and finish at ground level
          let sum = 0, c = 0;
          for (let k = i - w; k <= i + w; k++) { sum += src[k]; c++; }
          dst[i] = sum / c;
        }
      };
      const tmp = new Float32Array(n);
      smooth(base, tmp, 35); smooth(tmp, run.prof, 35); smooth(run.prof, tmp, 35); run.prof.set(tmp);
      const minSlope = DIFF[run.diff].minSlope;
      for (let i = 1; i < n; i++) {
        const nearEnd = (n - i) * RUN_STEP < 120 || run.zs[i] < BASE_Z + 30;
        run.prof[i] = Math.min(run.prof[i], run.prof[i - 1] - (nearEnd ? 0.02 : minSlope) * RUN_STEP);
      }
      if (run.id === CLIFF.run) {
        const sC = run.sAtZ(CLIFF.z);
        run.cliffS = sC;
        for (let i = 0; i < n; i++) run.prof[i] -= CLIFF.drop * smoothstep(sC, sC + 2.5, i * RUN_STEP);
      }
    }

    // distance from every grid point to each run (splatted along the path)
    this.runDist = this.runs.map(() => new Float32Array(N).fill(1e9));
    this.runS = this.runs.map(() => new Float32Array(N));
    this.runs.forEach((run, ri) => {
      const D = this.runDist[ri], S = this.runS[ri], R = run.hw + GROOM_FADE + 4;
      for (let k = 0; k < run.n; k++) {
        const cx = run.xs[k], cz = run.zs[k];
        const i0 = Math.max(0, Math.floor((cx - R - this.x0) / CELL)), i1 = Math.min(cols, Math.ceil((cx + R - this.x0) / CELL));
        const j0 = Math.max(0, Math.floor((this.z0 - cz - R) / CELL)), j1 = Math.min(rows, Math.ceil((this.z0 - cz + R) / CELL));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const d = Math.hypot(this.x0 + i * CELL - cx, this.z0 - j * CELL - cz), q = j * W + i;
          if (d < D[q]) { D[q] = d; S[q] = k * RUN_STEP; }
        }
      }
    });

    // carve: blend toward the groomed surface near runs; flatten the pads
    this.H = new Float32Array(N);
    this.groom = new Float32Array(N);       // 0 = wild snow, 1 = groomed run
    this.edgeDist = new Float32Array(N);    // meters outside the nearest run edge (negative = on a run)
    for (let q = 0; q < N; q++) {
      const i = q % W, j = (q - i) / W, x = this.x0 + i * CELL, z = this.z0 - j * CELL;
      let sumW = 0, sumWP = 0, maxW = 0, edge = 1e9;
      this.runs.forEach((run, ri) => {
        const d = this.runDist[ri][q];
        edge = Math.min(edge, d - run.hw);
        if (d > run.hw + GROOM_FADE) return;
        const w = 1 - smoothstep(run.hw + 4, run.hw + GROOM_FADE, d);
        sumW += w; sumWP += w * run.profileAt(this.runS[ri][q]); maxW = Math.max(maxW, w);
      });
      let h = raw[q];
      if (maxW > 0) h += (sumWP / sumW + 0.05 * fbm(x / 25, z / 25, 2) - h) * maxW;   // groomed = smooth
      // the pads stay flat even where a run starts on them
      for (const p of PADS) {
        const d = Math.hypot(x - p.x, z - p.z);
        if (d < p.r) h += (p.h - h) * (1 - smoothstep(p.r * 0.6, p.r, d));
      }
      this.H[q] = h; this.groom[q] = maxW; this.edgeDist[q] = edge;
    }
    // blur the groomed snow a little so crossings and run edges are smooth (2 passes, 3-cell box)
    const chute = this.runById[CLIFF.run], ci = this.runs.indexOf(chute);
    for (let pass = 0; pass < 2; pass++) {
      const src = Float32Array.from(this.H), R = 2;
      for (let j = R; j <= rows - R; j++) for (let i = R; i <= cols - R; i++) {
        const q = j * W + i, g = this.groom[q];
        if (g <= 0) continue;
        if (this.runDist[ci][q] < chute.hw + 20 && Math.abs(this.runS[ci][q] - chute.cliffS) < 14) continue;   // keep the cliff a cliff
        let sum = 0;
        for (let b = -R; b <= R; b++) for (let a = -R; a <= R; a++) sum += src[q + b * W + a];
        this.H[q] = src[q] + (sum / ((2 * R + 1) ** 2) - src[q]) * g;
      }
    }
    // natural jumps: a smooth 14 m ramp up to a 1.8 m lip, then a quick drop back to the run
    for (const [rid, s0] of NATURAL_JUMPS) {
      const ri = this.runs.findIndex(r => r.id === rid), run = this.runs[ri];
      const a = run.at(s0), R = run.hw + 4;
      const i0 = Math.max(0, Math.floor((a.x - R - this.x0) / CELL)), i1 = Math.min(cols, Math.ceil((a.x + R - this.x0) / CELL));
      const j0 = Math.max(0, Math.floor((this.z0 - a.z - R) / CELL)), j1 = Math.min(rows, Math.ceil((this.z0 - a.z + R) / CELL));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const q = j * W + i, d = this.runDist[ri][q], u = this.runS[ri][q] - s0;
        if (d > run.hw || u < -14 || u > 4) continue;
        const w = 1 - smoothstep(run.hw * 0.55, run.hw, d);
        const h = u <= 0 ? 1.8 * ((u + 14) / 14) ** 2 : 1.8 * (1 - smoothstep(0, 4, u));
        this.H[q] += h * w;
      }
      run.naturalJumps = (run.naturalJumps || []).concat(s0);
    }
  }

  // Smooth ground height for riding (Catmull-Rom across the grid, so no bumps at triangle edges).
  terrainHeight(x, z) {
    const gx = (x - this.x0) / CELL, gz = (this.z0 - z) / CELL;
    const i = Math.max(1, Math.min(this.cols - 2, Math.floor(gx))), j = Math.max(1, Math.min(this.rows - 2, Math.floor(gz)));
    const fx = Math.min(1, Math.max(0, gx - i)), fz = Math.min(1, Math.max(0, gz - j));
    const W = this.cols + 1, H = this.H;
    const cr = (p0, p1, p2, p3, t) => p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
    const row = (jj) => { const o = jj * W + i; return cr(H[o - 1], H[o], H[o + 1], H[o + 2], fx); };
    return cr(row(j - 1), row(j), row(j + 1), row(j + 2), fz);
  }

  // Height of the rendered terrain mesh (exact triangle interpolation).
  meshHeight(x, z) {
    const gx = (x - this.x0) / CELL, gz = (this.z0 - z) / CELL;
    let i = Math.floor(gx), j = Math.floor(gz);
    i = Math.max(0, Math.min(this.cols - 1, i)); j = Math.max(0, Math.min(this.rows - 1, j));
    const fx = Math.min(1, Math.max(0, gx - i)), fz = Math.min(1, Math.max(0, gz - j));
    const W = this.cols + 1, H = this.H;
    const a = H[j * W + i], b = H[j * W + i + 1], c = H[(j + 1) * W + i], d = H[(j + 1) * W + i + 1];
    if (fx >= fz) return a + (b - a) * fx + (d - b) * fz;
    return a + (d - c) * fx + (c - a) * fz;
  }

  // Ground height including kickers.
  heightAt(x, z) {
    let h = this.terrainHeight(x, z) + this.bumpAt(x, z);
    for (const k of this.kickers) {
      const dx = x - k.x, dz = z - k.z;
      if (dx * dx + dz * dz > 150) continue;
      const u = dx * k.dx + dz * k.dz, v = dx * k.px + dz * k.pz;
      if (u < 0 || u > k.len || Math.abs(v) > k.w / 2) continue;
      h = Math.max(h, k.baseH + k.profile(u));
    }
    return h;
  }

  // Extra height from the halfpipe walls and the snow-covered rocks (on top of the terrain grid).
  bumpAt(x, z) {
    let h = 0;
    const P = this.pipe;
    if (P) {
      const dx = x - P.ox, dz = z - P.oz, u = dx * P.ax + dz * P.az;
      if (u > -2 && u < P.L + 2) {
        const l = dx * P.cx + dz * P.cz;
        if (Math.abs(l) < PIPE.outer) h += 0.04 + this._pipeProfile(Math.abs(l)) * this._pipeTaper(u);
      }
    }
    for (const b of this.snowRocks || []) {
      const dx = x - b.x, dz = z - b.z;
      if (dx * dx + dz * dz > b.R2) continue;
      const u = dx * b.dx + dz * b.dz, v = -dx * b.dz + dz * b.dx;
      if (Math.abs(v) > b.r || u < -b.Lu || u > b.r * 0.6) continue;
      const fl = 1 - smoothstep(b.r * 0.35, b.r, Math.abs(v));
      const fu = u < 0 ? Math.pow((u + b.Lu) / b.Lu, 1.6) : 1 - smoothstep(0, b.r * 0.6, u);
      h += b.H * fl * fu;
    }
    return h;
  }

  // Where am I among the off-piste landforms? Used for achievements and gap detection.
  // -> { gully: {i, d, side, hw} | null, cliff: {i, u, v, len} | null, ridge: {i, u, v, len} | null }
  landformAt(x, z) {
    const out = { gully: null, cliff: null, ridge: null };
    GULLY_F.forEach((g, i) => {
      if (out.gully || x < g.x0 - 10 || x > g.x1 + 10 || z < g.z0 - 10 || z > g.z1 + 10) return;
      let best = 1e9, side = 0;
      for (const f of g.segs) {
        const u = Math.max(0, Math.min(f.len, (x - f.ax) * f.ex + (z - f.az) * f.ez));
        const dx = x - f.ax - f.ex * u, dz = z - f.az - f.ez * u, d = Math.hypot(dx, dz);
        if (d < best) { best = d; side = Math.sign(f.ex * dz - f.ez * dx) || 1; }
      }
      if (best < g.hw + 10) out.gully = { i, d: best, side, hw: g.hw };
    });
    const frame = (list, key) => list.forEach((c, i) => {
      if (out[key]) return;
      const dx = x - c.ax, dz = z - c.az, u = dx * c.ex + dz * c.ez, v = dx * c.nx + dz * c.nz;
      if (u > -4 && u < c.len + 4 && v > -25 && v < 60) out[key] = { i, u, v, len: c.len };
    });
    frame(CLIFF_F, 'cliff'); frame(RIDGE_F, 'ridge');
    return out;
  }

  snowRockIndex(x, z) {
    const list = this.snowRocks || [];
    for (let i = 0; i < list.length; i++) { const b = list[i]; if ((x - b.x) ** 2 + (z - b.z) ** 2 < b.R2) return i; }
    return -1;
  }

  _buildYeti() {
    const fur = new THREE.MeshStandardMaterial({ color: 0xf4f6fa, flatShading: true, roughness: 1 });
    const skin = new THREE.MeshStandardMaterial({ color: 0x6d7d93, flatShading: true });
    const dark = new THREE.MeshStandardMaterial({ color: 0x15161a });
    const g = new THREE.Group();
    const ball = (r, x, y, z, m = fur, sx = 1, sy = 1, sz = 1) => { const b = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), m); b.position.set(x, y, z); b.scale.set(sx, sy, sz); b.castShadow = true; g.add(b); return b; };
    ball(0.95, 0, 1.25, 0, fur, 1, 1.25, 0.9);                 // body
    ball(0.6, 0, 2.55, 0.05);                                   // head
    ball(0.38, 0, 2.5, 0.42, skin, 1, 0.9, 0.5);                // face
    for (const sx of [-1, 1]) {
      ball(0.3, sx * 1.05, 1.55, 0.1, fur, 0.8, 1.6, 0.8).rotation.z = sx * 0.5;          // arms (one waving)
      ball(0.32, sx * 0.45, 0.25, 0.1, fur, 1, 0.8, 1.2);                                  // feet
      const lens = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.14, 0.05), dark); lens.position.set(sx * 0.16, 2.6, 0.62); g.add(lens);
    }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, 0.04), dark); bridge.position.set(0, 2.62, 0.62); g.add(bridge);
    const y = this.terrainHeight(YETI.x, YETI.z);
    g.position.set(YETI.x, y - 0.1, YETI.z); g.rotation.y = -2.4;   // looking out over the resort
    this.scene.add(g);
    this.addObstacle(YETI.x, YETI.z, 1.0, 3, 'yeti');
  }

  snowRockNear(x, z) {
    for (const b of this.snowRocks || []) if ((x - b.x) ** 2 + (z - b.z) ** 2 < b.R2) return b;
    return null;
  }

  _pipeProfile(a) {
    const { fw, R, H, deck, wallW } = PIPE;
    if (a < fw) return 0;
    let x = a - fw;
    if (x < wallW) return R - Math.sqrt(R * R - x * x);
    x -= wallW;
    if (x < deck) return H;
    x -= deck;
    return Math.max(0, H - x / 1.5);
  }

  _pipeTaper(u) { return smoothstep(-2, 14, u) * (1 - smoothstep(this.pipe.L - 12, this.pipe.L + 2, u)); }

  // In the halfpipe? -> { l (across, + = right wall), u (along), cx, cz (across unit), onWall } or null
  pipeAt(x, z) {
    const P = this.pipe;
    if (!P) return null;
    const dx = x - P.ox, dz = z - P.oz, u = dx * P.ax + dz * P.az;
    if (u < 0 || u > P.L) return null;
    const l = dx * P.cx + dz * P.cz;
    if (Math.abs(l) > PIPE.fw + PIPE.wallW + 0.6) return null;
    return { l, u, cx: P.cx, cz: P.cz, ax: P.ax, az: P.az, onWall: Math.abs(l) > PIPE.fw + 0.4 && this._pipeTaper(u) > 0.6 };
  }

  normalAt(x, z, out = new THREE.Vector3()) {
    const e = 0.35;
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    out.set(-hx, 2 * e, -hz).normalize();
    if (out.y < 0.55 && !this.pipeAt(x, z)) {   // kicker side walls are vertical; use the snow under them
      const tx = this.terrainHeight(x + e, z) - this.terrainHeight(x - e, z);
      const tz = this.terrainHeight(x, z + e) - this.terrainHeight(x, z - e);
      out.set(-tx, 2 * e, -tz).normalize();
    }
    return out;
  }

  // Ground normal measured from the snow just behind the rider (keeps a kicker's angle to the lip).
  normalBehind(x, z, tx, tz, out = new THREE.Vector3()) {
    const l = Math.hypot(tx, tz);
    if (l < 1e-3) return this.normalAt(x, z, out);
    tx /= l; tz /= l;
    const e = 0.4, sx = -tz, sz = tx;
    const h0 = this.heightAt(x, z), hb = this.heightAt(x - tx * e, z - tz * e);
    const hl = this.heightAt(x - sx * e, z - sz * e), hr = this.heightAt(x + sx * e, z + sz * e);
    const along = new THREE.Vector3(tx * e, h0 - hb, tz * e);
    const across = new THREE.Vector3(sx * 2 * e, hr - hl, sz * 2 * e);
    out.crossVectors(across, along).normalize();
    if (out.y < 0) out.negate();
    if (out.y < 0.55 && !this.pipeAt(x, z)) return this.normalAt(x, z, out);
    return out;
  }

  _q(x, z) {
    const i = Math.max(0, Math.min(this.cols, Math.round((x - this.x0) / CELL)));
    const j = Math.max(0, Math.min(this.rows, Math.round((this.z0 - z) / CELL)));
    return j * (this.cols + 1) + i;
  }

  // Which run is this point on (or nearest to)? -> { run, s, d (from center), onRun }
  runAt(x, z) {
    const q = this._q(x, z);
    let best = null, bd = 1e9;
    this.runs.forEach((run, ri) => { const d = this.runDist[ri][q]; if (d - run.hw < bd) { bd = d - run.hw; best = ri; } });
    if (best === null || bd > 200) return null;
    return { run: this.runs[best], s: this.runS[best][q], d: this.runDist[best][q], onRun: bd < 2 };
  }

  slopeAt(x, z) {
    const e = 1.5;
    return Math.hypot(this.terrainHeight(x + e, z) - this.terrainHeight(x - e, z), this.terrainHeight(x, z + e) - this.terrainHeight(x, z - e)) / (2 * e);
  }

  // ---------- rendering ----------
  _snowNormalMap() {
    const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d'), img = g.createImageData(S, S);
    const hgt = new Float32Array(S * S);
    // tileable: blend four shifted copies of the noise
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const f = (u, v) => fbm(u, v, 4);
      const u = x / S, v = y / S, A = 6;
      const n00 = f(u * A, v * A), n10 = f((u - 1) * A, v * A), n01 = f(u * A, (v - 1) * A), n11 = f((u - 1) * A, (v - 1) * A);
      hgt[y * S + x] = (n00 * (1 - u) + n10 * u) * (1 - v) + (n01 * (1 - u) + n11 * u) * v;
    }
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const hx = hgt[y * S + ((x + 1) % S)] - hgt[y * S + ((x + S - 1) % S)];
      const hy = hgt[((y + 1) % S) * S + x] - hgt[((y + S - 1) % S) * S + x];
      const nx = -hx * 3, ny = -hy * 3, nz = 1, l = Math.hypot(nx, ny, nz), k = (y * S + x) * 4;
      img.data[k] = (nx / l * 0.5 + 0.5) * 255; img.data[k + 1] = (ny / l * 0.5 + 0.5) * 255; img.data[k + 2] = (nz / l * 0.5 + 0.5) * 255; img.data[k + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4;
    return t;
  }

  _buildMesh() {
    const { cols, rows } = this, W = cols + 1, H = this.H;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, normalMap: this._snowNormalMap(), normalScale: new THREE.Vector2(0.55, 0.55) });
    this.material = mat;
    // baked shadows (filled in by _bakeShadows once the trees exist): a world-space map that tints shaded snow blue
    const blank = new THREE.DataTexture(new Uint8Array([0]), 1, 1, THREE.RedFormat, THREE.UnsignedByteType); blank.needsUpdate = true;
    this.bakedUniforms = { shadowTex: { value: blank }, shadowArea: { value: new THREE.Vector4(WORLD.x0, WORLD.zTop, 1, 1) } };
    const U = this.bakedUniforms;
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform vec4 shadowArea;\nvarying vec2 vBakedUv;\nattribute float groomed;\nvarying float vGroom;\nvarying vec3 vSnowW;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvec4 bwp = modelMatrix * vec4(transformed, 1.0);\nvBakedUv = vec2((bwp.x - shadowArea.x) / shadowArea.z, (shadowArea.y - bwp.z) / shadowArea.w);\nvGroom = groomed; vSnowW = bwp.xyz;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D shadowTex;\nvarying vec2 vBakedUv;\nvarying float vGroom;\nvarying vec3 vSnowW;')
        .replace('#include <color_fragment>', `#include <color_fragment>
float baked = texture2D(shadowTex, vBakedUv).r;
diffuseColor.rgb *= mix(vec3(1.0), vec3(0.34, 0.42, 0.64), baked);
// fresh powder off the groomed runs: tiny crystals that glint as you move past (only up close)
vec2 cell = floor(vSnowW.xz * 16.0);
float hsh = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
vec3 toCam = normalize(cameraPosition - vSnowW);
float tw = fract(hsh * 17.0 + dot(toCam, vec3(3.1, 5.7, 2.3)) * 2.0);
float glint = step(0.993, hsh) * step(0.55, tw) * (1.0 - vGroom) * smoothstep(45.0, 6.0, length(cameraPosition - vSnowW));
diffuseColor.rgb += glint * 0.9 * (1.0 - baked * 0.7);`);
    };
    mat.customProgramCacheKey = () => 'snow-baked-shadows';
    // untracked powder is bright and soft; the groomed runs are a touch flatter and greyer (packed corduroy)
    const snow = new THREE.Color(0.97, 0.98, 1.0), powder = new THREE.Color(0.93, 0.955, 0.995), groomed = new THREE.Color(0.9, 0.915, 0.94);
    const rock = new THREE.Color(0.38, 0.36, 0.35), rockLight = new THREE.Color(0.55, 0.52, 0.49), c = new THREE.Color();
    const CH = 64;
    this.chunks = [];
    for (let cj = 0; cj < rows; cj += CH) for (let ci = 0; ci < cols; ci += CH) {
      const i1 = Math.min(cols, ci + CH), j1 = Math.min(rows, cj + CH), w = i1 - ci + 1, h = j1 - cj + 1;
      const pos = new Float32Array(w * h * 3), nor = new Float32Array(w * h * 3), col = new Float32Array(w * h * 3), uv = new Float32Array(w * h * 2), grm = new Float32Array(w * h);
      for (let j = cj; j <= j1; j++) for (let i = ci; i <= i1; i++) {
        const q = j * W + i, v = (j - cj) * w + (i - ci);
        const x = this.x0 + i * CELL, z = this.z0 - j * CELL;
        // deep powder sits in soft pillows a little above the base you ride on, so you sink into it
        pos[v * 3] = x; pos[v * 3 + 1] = H[q] + this.powderDepth(x, z, this.groom[q]); pos[v * 3 + 2] = z;
        grm[v] = this.groom[q];
        const hL = H[j * W + Math.max(0, i - 1)], hR = H[j * W + Math.min(cols, i + 1)];
        const hU = H[Math.max(0, j - 1) * W + i], hD = H[Math.min(rows, j + 1) * W + i];
        const dx = (hR - hL) / (2 * CELL), dz = (hU - hD) / (2 * CELL);
        const nl = Math.hypot(dx, 1, dz);
        nor[v * 3] = -dx / nl; nor[v * 3 + 1] = 1 / nl; nor[v * 3 + 2] = -dz / nl;
        const g = Math.hypot(dx, dz);
        c.copy(snow).lerp(powder, 0.5 + 0.5 * fbm(x / 60, z / 60, 2));
        c.lerp(groomed, this.groom[q] * 0.9);
        const rk = smoothstep(0.7, 1.15, g) * (1 - this.groom[q]);
        if (rk > 0) c.lerp(rockLight.clone().lerp(rock, 0.5 + 0.5 * noise2(x / 7, z / 7)), rk);
        col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b;
        uv[v * 2] = x / 5; uv[v * 2 + 1] = z / 5;
      }
      const idx = [];
      for (let j = 0; j < h - 1; j++) for (let i = 0; i < w - 1; i++) {
        const a = j * w + i, b = a + 1, cc = a + w, d = cc + 1;
        idx.push(a, b, d, a, d, cc);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setAttribute('groomed', new THREE.BufferAttribute(grm, 1));
      geo.setIndex(idx);
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.chunks.push(mesh);
    }
  }

  // How deep the soft powder looks off the groomed runs (visual only: you ride on the packed base below it).
  powderDepth(x, z, g = this.groomAt(x, z)) {
    // (the base area is packed down by everyone walking around the lifts and lodge)
    const wild = (1 - smoothstep(0.05, 0.5, g)) * smoothstep(BASE_Z - 10, BASE_Z + 60, z);
    if (wild <= 0) return 0;
    return wild * Math.max(0, 0.1 + 0.12 * fbm(x / 6, z / 6, 2) + 0.04 * noise2(x / 2.1, z / 2.1));
  }

  groomAt(x, z) { return this.groom[this._q(x, z)]; }

  _buildKickers() {
    const mat = new THREE.MeshStandardMaterial({ color: 0xeef4fb, roughness: 0.8, side: THREE.DoubleSide, normalMap: this.material.normalMap, normalScale: new THREE.Vector2(0.4, 0.4) });
    const lipMat = new THREE.MeshStandardMaterial({ color: 0x2a64c8, roughness: 0.6 });
    const list = KICKERS.map(([rid, zAt, off, lip, len, w]) => [rid, this.runById[rid].sAtZ(zAt), off, lip, len, w]);
    for (const [zAt, line] of PARK.jumps) for (const [size, off] of line) list.push([PARK.run, this.runById[PARK.run].sAtZ(zAt), off, ...JUMP[size]]);
    this.parkMat = { mat, lipMat };
    for (const [rid, sAt, off, lipAngle, len, w] of list) {
      const run = this.runById[rid];
      const a = run.at(sAt);
      const height = lipAngle * len / 1.65;
      const dx = a.tx, dz = a.tz;
      const k = { x: a.x - dz * off, z: a.z + dx * off, dx, dz, px: -dz, pz: dx, len, w, height, run: rid };
      k.baseH = Infinity;
      for (let u = 0; u <= len; u += 1) for (let v = -w / 2; v <= w / 2; v += 1)
        k.baseH = Math.min(k.baseH, this.terrainHeight(k.x + dx * u + k.px * v, k.z + dz * u + k.pz * v));
      const startH = this.terrainHeight(k.x, k.z) - k.baseH, N = 8, prof = [];
      for (let n = 0; n <= N; n++) { const t = n / N; prof.push(startH * (1 - t) + height * (0.35 * t + 0.65 * t * t)); }
      k.profile = (u) => { const f = Math.min(N - 1e-6, (u / len) * N); const n = Math.floor(f); return prof[n] + (prof[n + 1] - prof[n]) * (f - n); };
      this.kickers.push(k);
      this.scene.add(this._kickerMesh(k, prof, N, mat, lipMat));
    }
  }

  // Rails and boxes in the park, plus the entrance banner.
  _buildPark() {
    const run = this.runById[PARK.run];
    const metal = new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 0.8, roughness: 0.3 });
    const post = new THREE.MeshStandardMaterial({ color: 0x3a3f48, roughness: 0.6 });
    const boxTop = new THREE.MeshStandardMaterial({ color: 0xffd23a, roughness: 0.5 });
    const boxSide = new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.7 });
    for (const [zAt, off, len, kind, h0] of PARK.rails) {
      const sAt = run.sAtZ(zAt);
      const a = run.at(sAt), b = run.at(sAt + len);
      const px = -a.tz, pz = a.tx;
      const x0 = a.x + px * off, z0 = a.z + pz * off, x1 = b.x + px * off, z1 = b.z + pz * off;
      const g0 = this.terrainHeight(x0, z0), g1 = this.terrainHeight(x1, z1);
      // the rail drops more gently than the slope, so it gets higher toward the end (a down rail)
      const p0 = new THREE.Vector3(x0, g0 + h0, z0);
      const p1 = new THREE.Vector3(x1, Math.max(g1 + h0, g0 + h0 - (g0 - g1) * 0.85), z1);
      const d = p1.clone().sub(p0), L = d.length(), dir3 = d.clone().normalize();
      const dirH = new THREE.Vector3(d.x, 0, d.z); const lenH = dirH.length(); dirH.normalize();
      const r = { p0, p1, dir3, dirH, len: L, lenH, kind, halfW: kind === 'box' ? 0.3 : 0.06, top: kind === 'box' ? 0.06 : 0.05 };
      this.rails.push(r);
      const mid = p0.clone().lerp(p1, 0.5);
      const yaw = Math.atan2(dir3.x, dir3.z), pitch = -Math.asin(dir3.y);
      const g = new THREE.Group();
      if (kind === 'rail') {
        const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, L, 8), metal);
        bar.rotation.x = Math.PI / 2; g.add(bar);
        g.position.copy(mid); g.rotation.set(0, yaw, 0, 'YXZ'); g.rotateX(pitch);
        this.scene.add(g);
        for (let t = 0.08; t <= 0.95; t += 0.29) {          // support posts
          const q = p0.clone().lerp(p1, t), gy = this.terrainHeight(q.x, q.z);
          const pst = new THREE.Mesh(new THREE.BoxGeometry(0.08, q.y - gy + 0.2, 0.08), post);
          pst.position.set(q.x, (q.y + gy - 0.2) / 2, q.z); pst.castShadow = true; this.scene.add(pst);
        }
        bar.castShadow = true;
      } else {
        const top = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.06, L), boxTop); top.position.y = 0.03; g.add(top);
        const hMid = mid.y - this.terrainHeight(mid.x, mid.z);
        const side = new THREE.Mesh(new THREE.BoxGeometry(0.56, hMid + 0.6, L), boxSide); side.position.y = -(hMid + 0.6) / 2; g.add(side);
        g.position.copy(mid); g.rotation.set(0, yaw, 0, 'YXZ'); g.rotateX(pitch);
        g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        this.scene.add(g);
      }
    }
    // entrance banner across the top of the park
    const a = run.at(28), px = -a.tz, pz = a.tx, hw = run.hw - 4;
    const c = document.createElement('canvas'); c.width = 1024; c.height = 96;
    const gx = c.getContext('2d');
    gx.fillStyle = '#ff7a1a'; gx.fillRect(0, 0, 1024, 96);
    gx.fillStyle = '#fff'; gx.font = 'bold 60px Trebuchet MS, sans-serif'; gx.textAlign = 'center'; gx.textBaseline = 'middle';
    gx.fillText('THE YARD · TERRAIN PARK', 512, 52);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    let topY = -Infinity;
    for (const sgn of [-1, 1]) {
      const x = a.x + px * hw * sgn, z = a.z + pz * hw * sgn, y = this.terrainHeight(x, z);
      topY = Math.max(topY, y + 7);
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.5, 8, 0.5), post);
      pole.position.set(x, y + 4, z); pole.castShadow = true; this.scene.add(pole);
    }
    const banner = new THREE.Mesh(new THREE.BoxGeometry(hw * 2, 2, 0.2), new THREE.MeshStandardMaterial({ map: tex }));
    banner.position.set(a.x, topY, a.z); banner.rotation.y = Math.atan2(px, pz) - Math.PI / 2;
    this.scene.add(banner);
  }

  _inGullyOrPipe(x, z) {
    if (GULLY_F.some(g => x > g.x0 && x < g.x1 && z > g.z0 && z < g.z1 && gullyDist(g, x, z).d < g.hw - 1)) return true;
    if (this.pipeAt(x, z)) return true;
    return (this.snowRocks || []).some(b => Math.hypot(x - b.x, z - b.z) < b.r * 2.6);
  }

  // The halfpipe and the snow-covered rocks (shape lives in bumpAt; these are the meshes).
  _buildFeatures() {
    const run = this.runById[PARK.run];
    const a = run.at(run.sAtZ(PARK.pipe.z0)), b = run.at(run.sAtZ(PARK.pipe.z1));
    let ax = b.x - a.x, az = b.z - a.z; const L = Math.hypot(ax, az); ax /= L; az /= L;
    this.pipe = { ox: a.x, oz: a.z, ax, az, cx: -az, cz: ax, L };
    const snowMat = new THREE.MeshStandardMaterial({ color: 0xf3f7fc, roughness: 0.8, normalMap: this.material.normalMap, normalScale: new THREE.Vector2(0.45, 0.45), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    // pipe surface: fine across the walls, coarser on the floor and deck
    const ls = [];
    for (let l = 0; l <= PIPE.outer + 0.01;) { ls.push(l); l += l < PIPE.fw - 0.5 ? 0.75 : l < PIPE.fw + PIPE.wallW + 0.3 ? 0.25 : 0.75; }
    const across = [...ls.slice(1).reverse().map(l => -l), ...ls];
    const along = []; for (let u = -2; u <= L + 2.01; u += 0.8) along.push(u);
    const P = this.pipe, pos = [], uv = [], idx = [], col = [];
    for (const u of along) for (const l of across) {
      const x = P.ox + ax * u + P.cx * l, z = P.oz + az * u + P.cz * l;
      const edge = Math.abs(l) > PIPE.outer - 0.3 || u < -1.5 || u > L + 1.5;
      pos.push(x, this.meshHeight(x, z) + this.bumpAt(x, z) + (edge ? 0 : 0.03), z); uv.push(x / 6, z / 6);
      // a little shading so the walls read: darker down in the transitions, bright on the decks
      const a = Math.abs(l), hh = this._pipeProfile(a) * this._pipeTaper(u) / PIPE.H;
      let c = a < PIPE.fw ? 0.9 : a < PIPE.fw + PIPE.wallW ? 0.8 + 0.15 * hh : a < PIPE.fw + PIPE.wallW + PIPE.deck ? 0.98 : 0.95;
      c = c + (1 - c) * (1 - this._pipeTaper(u)) * 0.6;
      col.push(c * 0.95, c * 0.97, c);
    }
    const nA = across.length;
    for (let i = 0; i < along.length - 1; i++) for (let j = 0; j < nA - 1; j++) {
      const q = i * nA + j; idx.push(q, q + 1, q + nA, q + 1, q + nA + 1, q + nA);   // counter-clockwise from above
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx); geo.computeVertexNormals();
    const fix = (g) => { const n = g.attributes.normal; for (let i = 0; i < n.count; i++) if (n.getY(i) < 0) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i)); };
    fix(geo);
    const pipeMat = snowMat.clone(); pipeMat.vertexColors = true; pipeMat.color.set(0xffffff); pipeMat.roughness = 0.95;
    const mesh = new THREE.Mesh(geo, pipeMat); mesh.receiveShadow = true; mesh.castShadow = true;
    this.scene.add(mesh);
    // blue lines along the lips so you can read the walls
    const blue = new THREE.MeshStandardMaterial({ color: 0x2a64c8, roughness: 0.6 });
    for (const sgn of [-1, 1]) {
      const l = sgn * (PIPE.fw + PIPE.wallW + 0.15), pts = [];
      for (let u = 12; u <= L - 10; u += 2) { const x = P.ox + ax * u + P.cx * l, z = P.oz + az * u + P.cz * l; pts.push(new THREE.Vector3(x, this.meshHeight(x, z) + this.bumpAt(x, z) + 0.05, z)); }
      const strip = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), pts.length * 2, 0.07, 4), blue);
      this.scene.add(strip);
    }
    // banner over the drop-in
    const c = document.createElement('canvas'); c.width = 512; c.height = 96;
    const gx = c.getContext('2d'); gx.fillStyle = '#163566'; gx.fillRect(0, 0, 512, 96);
    gx.fillStyle = '#fff'; gx.font = 'bold 58px Trebuchet MS, sans-serif'; gx.textAlign = 'center'; gx.textBaseline = 'middle'; gx.fillText('HALFPIPE', 256, 52);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const postM = new THREE.MeshStandardMaterial({ color: 0x3a3f48 });
    const bw = (PIPE.fw + PIPE.wallW + PIPE.deck) * 2, bx = P.ox - ax * 4, bz = P.oz - az * 4;
    let topY = -Infinity;
    for (const sgn of [-1, 1]) {
      const x = bx + P.cx * sgn * bw / 2, z = bz + P.cz * sgn * bw / 2, y = this.terrainHeight(x, z);
      topY = Math.max(topY, y + 8);
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.4, 9, 0.4), postM); pole.position.set(x, y + 4.5, z); this.scene.add(pole);
    }
    const banner = new THREE.Mesh(new THREE.BoxGeometry(bw, 1.8, 0.2), new THREE.MeshStandardMaterial({ map: tex }));
    banner.position.set(bx, topY, bz); banner.rotation.y = Math.atan2(P.cx, P.cz) - Math.PI / 2; this.scene.add(banner);

    // snow-covered rocks: a long gentle ramp up, a lip, and a short steep face with rock showing
    this.snowRocks = [];
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x5f5b58, flatShading: true, roughness: 1 });
    for (const [x, z, r, H] of SNOW_ROCKS) {
      const n = this.normalAt(x, z);
      let dx = n.x, dz = n.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;   // downhill
      const b = { x, z, r, H, dx, dz, Lu: r * 2.2 };
      b.R2 = (b.Lu + r) ** 2;
      this.snowRocks.push(b);
      const gp = [], gi = [], NU = 16, NV = 10;
      for (let i = 0; i <= NU; i++) for (let j = 0; j <= NV; j++) {
        const u = -b.Lu + (b.Lu + r * 0.6) * i / NU, v = -r + 2 * r * j / NV;
        const px = x + dx * u - dz * v, pz = z + dz * u + dx * v;
        gp.push(px, this.meshHeight(px, pz) + this.bumpAt(px, pz) + 0.02, pz);
      }
      for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) { const q = i * (NV + 1) + j; gi.push(q, q + 1, q + NV + 1, q + 1, q + NV + 2, q + NV + 1); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3)); g.setIndex(gi); g.computeVertexNormals(); fix(g);
      const cap = new THREE.Mesh(g, snowMat); cap.receiveShadow = true; cap.castShadow = true; this.scene.add(cap);
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), rockMat);
      const rx = x + dx * r * 0.45, rz = z + dz * r * 0.45;
      rock.position.set(rx, this.terrainHeight(rx, rz) + H * 0.3, rz);
      rock.scale.set(r * 0.75, H * 0.55, r * 0.45); rock.rotation.y = Math.atan2(dx, dz); rock.castShadow = true;
      this.scene.add(rock);
    }
    this.mapMarks = { cliffs: CLIFF_F.map(c => [[c.ax, c.az], [c.ax + c.ex * c.len, c.az + c.ez * c.len]]), rocks: SNOW_ROCKS.map(([x, z]) => [x, z]) };
  }

  // Downed trees along the run edges: ride them like a rail.
  _buildLogs() {
    const bark = new THREE.MeshStandardMaterial({ color: 0x5b4030, roughness: 0.95, flatShading: true });
    const wood = new THREE.MeshStandardMaterial({ color: 0xb08a5a, roughness: 0.9, flatShading: true });
    const snowM = new THREE.MeshStandardMaterial({ color: 0xf2f6fb, roughness: 0.9 });
    const R = 0.28;
    for (const [rid, sAt, side, len] of LOGS) {
      const run = this.runById[rid], a = run.at(sAt);
      const off = side * (run.hw - 4);
      // angled ~20 degrees in toward the run so you can ride onto it
      const ang = -side * 0.35, ca = Math.cos(ang), sa = Math.sin(ang);
      const dx = a.tx * ca - a.tz * sa, dz = a.tx * sa + a.tz * ca;
      const x0 = a.x - a.tz * off, z0 = a.z + a.tx * off, x1 = x0 + dx * len, z1 = z0 + dz * len;
      const p0 = new THREE.Vector3(x0, this.terrainHeight(x0, z0) + 2 * R * 0.9, z0);
      const p1 = new THREE.Vector3(x1, this.terrainHeight(x1, z1) + 2 * R * 0.9, z1);
      const d = p1.clone().sub(p0), L = d.length(), dir3 = d.clone().normalize();
      const dirH = new THREE.Vector3(d.x, 0, d.z); const lenH = dirH.length(); dirH.normalize();
      this.rails.push({ p0, p1, dir3, dirH, len: L, lenH, kind: 'log', halfW: 0.2, top: 0.02, snapBelow: 0.65 });
      const g = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.85, R, L, 7), bark); trunk.rotation.x = Math.PI / 2; g.add(trunk);
      const snowCap = new THREE.Mesh(new THREE.BoxGeometry(R * 1.1, 0.06, L * 0.9), snowM); snowCap.position.y = R * 0.95; g.add(snowCap);
      const roots = new THREE.Mesh(new THREE.CylinderGeometry(R * 2.6, R * 2.2, 0.35, 8), wood); roots.rotation.x = Math.PI / 2; roots.position.z = -L / 2; g.add(roots);
      for (const t of [-0.2, 0.15, 0.35]) {        // broken branch stubs
        const stub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.7, 5), bark);
        stub.position.set(R * 0.9, 0.1, L * t); stub.rotation.z = -1.1; g.add(stub);
      }
      const mid = p0.clone().lerp(p1, 0.5); mid.y -= R * 0.9;
      g.position.copy(mid);
      g.rotation.set(0, Math.atan2(dir3.x, dir3.z), 0, 'YXZ'); g.rotateX(-Math.asin(dir3.y));
      g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.scene.add(g);
    }
  }

  // Shadows for the whole mountain, worked out once (the sun doesn't move): trees and ridges
  // darken the snow with a cool blue shade. Live shadows near the rider are added on top by the renderer.
  _bakeShadows() {
    const sun = (this.opts.sunDir || new THREE.Vector3(-0.5, 0.5, 0.4)).clone().normalize();
    const RES = this.opts.shadowRes || 1.0, w = Math.ceil((WORLD.x1 - WORLD.x0) / RES), h = Math.ceil((WORLD.zTop - WORLD.zBot) / RES);
    const shade = new Float32Array(w * h);
    const sx = -sun.x, sz = -sun.z, sl = Math.hypot(sx, sz) || 1;
    const shx = sx / sl, shz = sz / sl;                       // shadows fall this way on the ground
    const tanE = sun.y / Math.hypot(sun.x, sun.z);            // sun height per meter toward the sun
    // ridges: march toward the sun from each grid point
    const { cols, rows } = this, W = cols + 1;
    const self = new Float32Array(W * (rows + 1));
    for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
      const q = j * W + i, x = this.x0 + i * CELL, z = this.z0 - j * CELL, y = this.H[q] + 0.3;
      let lit = 1;
      for (let t = 6; t < 360; t += 6) {
        const xx = x - shx * t, zz = z - shz * t;
        if (xx < WORLD.x0 || xx > WORLD.x1 || zz > WORLD.zTop || zz < WORLD.zBot) break;
        const above = this.H[this._q(xx, zz)] - (y + t * tanE);
        if (above > 0) { lit = 0; break; }
        if (above > -1.5) lit = Math.min(lit, -above / 1.5);
      }
      self[q] = 1 - lit;
    }
    for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
      const x = WORLD.x0 + px * RES, z = WORLD.zTop - py * RES;
      const gi = (x - this.x0) / CELL, gj = (this.z0 - z) / CELL, i = Math.min(cols - 1, Math.floor(gi)), j = Math.min(rows - 1, Math.floor(gj));
      const fi = gi - i, fj = gj - j, q = j * W + i;
      shade[py * w + px] = (self[q] * (1 - fi) + self[q + 1] * fi) * (1 - fj) + (self[q + W] * (1 - fi) + self[q + W + 1] * fi) * fj;
    }
    // trees: a cone-shaped shadow stretched away from the sun
    const stretch = 1 / tanE;
    for (const t of this.trees) {
      if (t.kind !== 'tree') continue;
      const size = t.h / 6.5, Ls = t.h * stretch, crown = 1.9 * size;
      const minX = Math.min(t.x, t.x + shx * Ls) - crown - 1, maxX = Math.max(t.x, t.x + shx * Ls) + crown + 1;
      const minZ = Math.min(t.z, t.z + shz * Ls) - crown - 1, maxZ = Math.max(t.z, t.z + shz * Ls) + crown + 1;
      for (let z = maxZ; z >= minZ; z -= RES) for (let x = minX; x <= maxX; x += RES) {
        const px = Math.round((x - WORLD.x0) / RES), py = Math.round((WORLD.zTop - z) / RES);
        if (px < 0 || py < 0 || px >= w || py >= h) continue;
        const dx = x - t.x, dz = z - t.z, along = dx * shx + dz * shz, lat = Math.abs(-dx * shz + dz * shx);
        if (along < -1 || along > Ls + 1) continue;
        const hgt = along / stretch;                                  // height on the tree that casts this spot
        const r = hgt < 1.4 * size ? 0.25 * size + 0.6 : crown * Math.max(0, 1 - (hgt - 1.4 * size) / (t.h - 1.4 * size)) + 0.3;
        const v = 1 - smoothstep(r - 0.5, r + 0.5, lat);
        const k = py * w + px;
        if (v > shade[k]) shade[k] = v;
      }
    }
    // soften edges (one 3x3 pass)
    const out = new Uint8Array(w * h);
    for (let py = 0; py < h; py++) for (let px = 0; px < w; px++) {
      let sum = 0, n = 0;
      for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) { const xx = px + a, yy = py + b; if (xx >= 0 && yy >= 0 && xx < w && yy < h) { sum += shade[yy * w + xx]; n++; } }
      out[py * w + px] = Math.min(255, (sum / n) * 255);
    }
    const tex = new THREE.DataTexture(out, w, h, THREE.RedFormat, THREE.UnsignedByteType);
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.needsUpdate = true;
    this.shadowTex = tex;
    this.bakedUniforms.shadowTex.value = tex;
    this.bakedUniforms.shadowArea.value.set(WORLD.x0, WORLD.zTop, w * RES, h * RES);
  }

  _kickerMesh(k, prof, N, mat, lipMat) {
    const verts = [], uvs = [];
    const P = (u, v, hOff) => {
      const x = k.x + k.dx * u + k.px * v, z = k.z + k.dz * u + k.pz * v;
      return [x, hOff === null ? this.terrainHeight(x, z) - 0.3 : k.baseH + hOff, z];
    };
    const tri = (a, b, c) => { verts.push(...a, ...b, ...c); uvs.push(a[0] / 5, a[2] / 5, b[0] / 5, b[2] / 5, c[0] / 5, c[2] / 5); };
    const hw = k.w / 2;
    for (let n = 0; n < N; n++) {
      const u0 = k.len * n / N, u1 = k.len * (n + 1) / N;
      const L0 = P(u0, -hw, prof[n]), R0 = P(u0, hw, prof[n]), L1 = P(u1, -hw, prof[n + 1]), R1 = P(u1, hw, prof[n + 1]);
      tri(L0, L1, R1); tri(L0, R1, R0);
      const L0b = P(u0, -hw, null), L1b = P(u1, -hw, null), R0b = P(u0, hw, null), R1b = P(u1, hw, null);
      tri(L0b, L1b, L1); tri(L0b, L1, L0);
      tri(R0b, R1, R1b); tri(R0b, R0, R1);
    }
    const Lt = P(k.len, -hw, prof[N]), Rt = P(k.len, hw, prof[N]), Lb = P(k.len, -hw, null), Rb = P(k.len, hw, null);
    tri(Lt, Lb, Rb); tri(Lt, Rb, Rt);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.computeVertexNormals();
    const g = new THREE.Group();
    const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true;
    g.add(m);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(k.w, 0.08, 0.3), lipMat);
    const lp = P(k.len - 0.15, 0, prof[N] + 0.02);
    lip.position.set(lp[0], lp[1], lp[2]);
    lip.rotation.y = Math.atan2(-k.dx, -k.dz);
    g.add(lip);
    return g;
  }

  // One merged low-poly pine: trunk + four tiers of branches with snow on top.
  _treeGeometry() {
    const parts = [];
    const add = (geo, color, y) => {
      const g = geo.toNonIndexed(); g.translate(0, y, 0);
      const n = g.attributes.position.count, col = new Float32Array(n * 3), c = new THREE.Color(color);
      for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.deleteAttribute('uv');
      parts.push(g);
    };
    add(new THREE.CylinderGeometry(0.14, 0.22, 1.6, 5, 1, true), 0x5a3b26, 0.8);
    const tiers = [[1.9, 2.7, 2.1], [1.5, 2.4, 3.5], [1.05, 2.1, 4.8], [0.6, 1.5, 5.9]];
    for (const [r, h, y] of tiers) {
      add(new THREE.ConeGeometry(r, h, 7, 1, true), 0x2c5e3f, y);
      add(new THREE.ConeGeometry(r * 0.62, h * 0.42, 7, 1, true), 0xf2f6fb, y + h * 0.3);
    }
    let total = 0; for (const p of parts) total += p.attributes.position.count;
    const pos = new Float32Array(total * 3), col = new Float32Array(total * 3);
    let o = 0;
    for (const p of parts) { pos.set(p.attributes.position.array, o * 3); col.set(p.attributes.color.array, o * 3); o += p.attributes.position.count; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    return geo;
  }

  _buildTrees() {
    const r = rng(42), sp = this.opts.treeSpacing || 9.5;
    const byChunk = new Map();
    const lifts = this.opts.liftLines || [];
    for (let z = WORLD.zTop - 2; z > WORLD.zBot + 2; z -= sp) for (let x = WORLD.x0 + 2; x < WORLD.x1 - 2; x += sp) {
      const tx = x + (r() - 0.5) * sp * 0.9, tz = z + (r() - 0.5) * sp * 0.9;
      const s = SUMMIT.z - tz;
      let dens = 0.8 + 0.45 * fbm(tx / 90, tz / 90, 3);
      dens *= 0.15 + 0.85 * smoothstep(40, 160, s) + 0.25 * smoothstep(330, 460, -s);   // sparse above the tree line (a few low in the bowl)
      if (tz < BASE_Z + 10) dens *= 0.12;                       // open base area
      if (r() > dens) continue;
      const q = this._q(tx, tz);
      if (this.edgeDist[q] < 5 + r() * 6) continue;              // keep runs (and a margin) clear
      if (this.slopeAt(tx, tz) > 1.0) continue;
      if (PADS.some(p => Math.hypot(tx - p.x, tz - p.z) < p.r + 8)) continue;
      if (this.kickers.some(k => Math.hypot(tx - k.x, tz - k.z) < k.len + 8)) continue;
      if (this.inFeature(tx, tz, 2)) continue;
      if (Math.hypot(tx - YETI.x, tz - YETI.z) < 9) continue;
      if (this.rails.some(rl => distToSeg(tx, tz, rl.p0, rl.p1) < 6)) continue;
      if (lifts.some(([a, b]) => distToSeg(tx, tz, a, b) < 8)) continue;
      const size = 0.75 + r() * 0.55 + 0.25 * smoothstep(300, 1200, s);
      const key = `${Math.floor((tx - this.x0) / 192)},${Math.floor((this.z0 - tz) / 192)}`;
      if (!byChunk.has(key)) byChunk.set(key, []);
      byChunk.get(key).push([tx, tz, size, r() * 6.28, r()]);
    }
    const geo = this._treeGeometry();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 });
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), tint = new THREE.Color();
    const UPV = new THREE.Vector3(0, 1, 0);
    this.treeMeshes = [];
    for (const list of byChunk.values()) {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach(([x, z, size, rot, shade], i) => {
        const y = this.terrainHeight(x, z) - 0.2;
        q.setFromAxisAngle(UPV, rot);
        sc.set(size, size * (0.9 + shade * 0.25), size);
        m.compose(p.set(x, y, z), q, sc); im.setMatrixAt(i, m);
        tint.setHSL(0.33, 0.1 + shade * 0.2, 0.85 + shade * 0.3);
        im.setColorAt(i, tint);
        this.trees.push({ x, z, y, r: 0.3 * size, h: 6.5 * size, kind: 'tree', mesh: im, i });
      });
      im.castShadow = false; im.receiveShadow = true;
      im.computeBoundingSphere();
      this.scene.add(im);
      this.treeMeshes.push(im);
    }
    this._rebuildTreeGrid();
  }

  // Remove trees within `width` meters of the line a-b (used to cut lift lines).
  clearTreesAlong(a, b, width) {
    const zero = new THREE.Matrix4().makeScale(0, 0, 0), touched = new Set();
    this.trees = this.trees.filter(t => {
      if (t.kind !== 'tree' || distToSeg(t.x, t.z, a, b) >= width) return true;
      t.mesh.setMatrixAt(t.i, zero); touched.add(t.mesh); return false;
    });
    for (const im of touched) im.instanceMatrix.needsUpdate = true;
    this._rebuildTreeGrid();
  }

  // Something solid the rider can hit (lift towers, etc.).
  addObstacle(x, z, r, h, kind) {
    this.trees.push({ x, z, y: this.terrainHeight(x, z), r, h, kind });
    this._rebuildTreeGrid();
  }

  _rebuildTreeGrid() {
    this.treeGrid = new Map();
    for (const t of this.trees) {
      const key = `${Math.floor(t.x / 10)},${Math.floor(t.z / 10)}`;
      if (!this.treeGrid.has(key)) this.treeGrid.set(key, []);
      this.treeGrid.get(key).push(t);
    }
  }

  treeNear(x, z) {
    const bx = Math.floor(x / 10), bz = Math.floor(z / 10);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const list = this.treeGrid.get(`${bx + a},${bz + b}`);
      if (!list) continue;
      for (const t of list) if (Math.hypot(t.x - x, t.z - z) < t.r + 0.2) return t;
    }
    return null;
  }

  _buildRocks() {
    const r = rng(99), spots = [];
    // outcrops on steep ground
    for (let k = 0; k < 9000 && spots.length < 700; k++) {
      const x = WORLD.x0 + r() * (WORLD.x1 - WORLD.x0), z = WORLD.zTop - r() * (WORLD.zTop - WORLD.zBot);
      if (this.slopeAt(x, z) < 0.85 || this.edgeDist[this._q(x, z)] < 3) continue;
      if (this._inGullyOrPipe(x, z)) continue;
      spots.push([x, z, 0.8 + r() * 2.2]);
    }
    // rocks along the cliff face
    const run = this.runById[CLIFF.run];
    for (let n = 0; n < 24; n++) {
      const a = run.at(run.cliffS + 1 + r() * 1.5), v = (r() - 0.5) * (run.width + 6);
      spots.push([a.x - a.tz * v, a.z + a.tx * v, 0.8 + r() * 1.4]);
    }
    // and along the natural cliff bands
    for (const c of CLIFF_F) for (let n = 0; n < c.len / 1.6; n++) {
      const u = r() * c.len, v = 0.6 + r() * 1.6;
      spots.push([c.ax + c.ex * u + c.nx * v, c.az + c.ez * u + c.nz * v, 0.9 + r() * 1.5]);
    }
    const mat = new THREE.MeshStandardMaterial({ color: 0x6f6b68, flatShading: true, roughness: 1 });
    const im = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), mat, spots.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    spots.forEach(([x, z, sz], i) => {
      e.set(r() * 3, r() * 3, r() * 3); q.setFromEuler(e);
      m.compose(new THREE.Vector3(x, this.terrainHeight(x, z) - sz * 0.35, z), q, new THREE.Vector3(sz * 1.4, sz * 0.8, sz));
      im.setMatrixAt(i, m);
    });
    im.castShadow = true; im.receiveShadow = true;
    this.scene.add(im);
    // orange warning poles above the cliff
    const flagMat = new THREE.MeshStandardMaterial({ color: 0xff8a1f });
    for (const v of [-10, -5, 0, 5, 10]) {
      const a = run.at(run.cliffS - 22);
      const x = a.x - a.tz * v, z = a.z + a.tx * v;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.8, 4), flagMat);
      pole.position.set(x, this.terrainHeight(x, z) + 0.9, z);
      this.scene.add(pole);
    }
  }

  // Trail sign: post with a board showing the difficulty symbol and the run name.
  _sign(x, z, faceYaw, lines) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64 * lines.length;
    const g = c.getContext('2d');
    g.fillStyle = '#f4efe2'; g.fillRect(0, 0, c.width, c.height);
    lines.forEach(([name, diff], i) => {
      const y = 32 + i * 64;
      drawDiffIcon(g, diff, 34, y, 18);
      g.fillStyle = '#1b2533'; g.font = 'bold 28px Trebuchet MS, sans-serif'; g.textBaseline = 'middle';
      g.fillText(name, 64, y + 1);
    });
    g.strokeStyle = '#1b2533'; g.lineWidth = 6; g.strokeRect(3, 3, c.width - 6, c.height - 6);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const y0 = this.terrainHeight(x, z);
    const grp = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2f });
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2.4, 0.15), wood);
    post.position.set(x, y0 + 1.2, z); grp.add(post);
    const hgt = 0.5 * lines.length;
    const board = new THREE.Mesh(new THREE.BoxGeometry(2, hgt, 0.08), [wood, wood, wood, wood, new THREE.MeshStandardMaterial({ map: tex }), wood]);
    board.position.set(x, y0 + 2.2 + hgt / 2, z); board.rotation.y = faceYaw;
    board.castShadow = true;
    grp.add(board);
    this.scene.add(grp);
  }

  _buildSigns() {
    // at the top of each run, and where runs cross or join
    const faceUphill = (a) => Math.atan2(-a.tx, -a.tz);
    for (const run of this.runs) {
      const a = run.at(12);
      this._sign(a.x - a.tz * (run.hw + 2), a.z + a.tx * (run.hw + 2), faceUphill(a), [[run.name, run.diff]]);
    }
    this.junctions = [];
    for (const A of this.runs) for (const B of this.runs) {
      if (A === B) continue;
      // first point on A that is inside B
      for (let i = 30; i < A.n; i += 2) {
        const q = this._q(A.xs[i], A.zs[i]), bi = this.runs.indexOf(B);
        if (A.zs[i] < BASE_Z) break;
        if (this.runDist[bi][q] < B.hw) {
          const a = A.at(Math.max(0, i * RUN_STEP - 30));
          const side = A.hw + 2;
          this._sign(a.x - a.tz * side, a.z + a.tx * side, faceUphill(a), [[A.name, A.diff], [B.name, B.diff]]);
          this.junctions.push({ a: A.id, b: B.id, x: A.xs[i], z: A.zs[i] });
          break;
        }
      }
    }
  }

  // Where a new session starts: the summit, facing down Main Street.
  spawnPoint() {
    const x = SUMMIT.x, z = SUMMIT.z - 18;
    return new THREE.Vector3(x, this.heightAt(x, z), z);
  }
}

export function distToSeg(x, z, a, b) {
  const abx = b.x - a.x, abz = b.z - a.z, L2 = abx * abx + abz * abz || 1;
  const u = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / L2));
  return Math.hypot(x - (a.x + abx * u), z - (a.z + abz * u));
}

// Green circle, blue square, black diamond, orange park.
export function drawDiffIcon(g, diff, x, y, r) {
  g.fillStyle = DIFF[diff].color;
  g.beginPath();
  if (diff === 'green') g.arc(x, y, r, 0, Math.PI * 2);
  else if (diff === 'blue') g.rect(x - r * 0.85, y - r * 0.85, r * 1.7, r * 1.7);
  else if (diff === 'black') { g.moveTo(x, y - r * 1.1); g.lineTo(x + r * 0.8, y); g.lineTo(x, y + r * 1.1); g.lineTo(x - r * 0.8, y); g.closePath(); }
  else g.roundRect(x - r, y - r * 0.7, r * 2, r * 1.4, 4);
  g.fill();
}
