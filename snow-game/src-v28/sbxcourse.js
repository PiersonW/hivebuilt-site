// The Snowboard Cross course: a groomed track down the left side of the backside bowl with a 6-lane start
// gate, banked turns, rollers and table-top jumps, and a finish arch near the Backside Lift.
//
// The track is a centre line sampled every half metre. A coarse lookup raster maps any (x, z) near the course
// to (s = metres along the course, l = metres across, + = right of travel). The course height is
//   smoothed slope along s  +  features (start drop, rollers, tables)  +  berms (outside of each turn)
// and it blends back into the natural snow beyond the edges.
import * as THREE from 'three';
import { smoothstep } from './noise.js';

// control points (x, z): start below the rocks, six turns, finish on the bowl floor
const CTRL = [[-175, 150], [-170, 195], [-130, 250], [-185, 312], [-133, 372], [-190, 432], [-142, 492], [-160, 540], [-150, 565]];
export const SBX = { hw: 7.5, blend: 11, lanes: [-5, -3, -1, 1, 3, 5], ds: 0.5, finishBack: 30 };

export class SbxCourse {
  constructor(terrain) {
    this.T = terrain;
    const pts = CTRL.map(([x, z]) => new THREE.Vector3(x, 0, z));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const L0 = curve.getLength(), N = Math.round(L0 / SBX.ds);
    const P = curve.getSpacedPoints(N);
    this.n = P.length; this.L = (P.length - 1) * SBX.ds;
    const n = this.n;
    this.px = new Float32Array(n); this.pz = new Float32Array(n); this.tx = new Float32Array(n); this.tz = new Float32Array(n);
    for (let i = 0; i < n; i++) { this.px[i] = P[i].x; this.pz[i] = P[i].z; }
    for (let i = 0; i < n; i++) {
      const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)], dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
      this.tx[i] = dx / l; this.tz[i] = dz / l;
    }
    // curvature (signed: + = turning left, - = turning right), smoothed
    const kap = new Float32Array(n);
    for (let i = 2; i < n - 2; i++) {
      const c = this.tx[i - 2] * this.tz[i + 2] - this.tz[i - 2] * this.tx[i + 2];
      kap[i] = -c / (4 * SBX.ds);
    }
    this.kap = blur(blur(kap, 16), 16);
    // the slope we ride down: the snow under the centre line, smoothed, and never flattening or climbing
    const t = new Float32Array(n);
    for (let i = 0; i < n; i++) t[i] = terrain.terrainHeight(this.px[i], this.pz[i]);
    const base = blur(blur(t, 50), 50);
    for (let i = 1; i < n; i++) base[i] = Math.min(base[i], base[i - 1] - 0.07 * SBX.ds);
    this.base = base;
    // the track leans a little with the hillside (up to ~7°), so it isn't a deep cut on the uphill side
    const tilt = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const nx = -this.tz[i], nz = this.tx[i], w = 14;
      const hr = terrain.terrainHeight(this.px[i] + nx * w, this.pz[i] + nz * w), hl = terrain.terrainHeight(this.px[i] - nx * w, this.pz[i] - nz * w);
      tilt[i] = Math.max(-0.12, Math.min(0.12, (hr - hl) / (2 * w) * 0.45));
    }
    this.tilt = blur(blur(tilt, 30), 30);
    this.finishS = this.L - SBX.finishBack;
    // turns: where the curvature peaks
    const turns = [];
    for (let i = 20; i < n - 20; i++) if (Math.abs(this.kap[i]) > 0.012 && Math.abs(this.kap[i]) >= Math.abs(this.kap[i - 1]) && Math.abs(this.kap[i]) >= Math.abs(this.kap[i + 1])) turns.push(i * SBX.ds);
    this.turns = turns;
    // features along the straights between turns (s ranges), alternating rollers and tables
    const feat = new Float32Array(n);
    const add = (s0, fn) => { for (let i = 0; i < n; i++) { const v = fn(i * SBX.ds - s0); if (v) feat[i] += v; } };
    // start: a raised gate deck, then a steep drop-in
    add(0, (s) => s < -2 ? 0 : s < 5 ? 1.6 : s < 20 ? 1.6 * (1 - smoothstep(5, 20, s)) : 0);
    const legs = [0, ...turns, this.finishS];
    // (features sit on the straights, clear of the turns, so you land with room to set up the next berm)
    let feature = 0;
    for (let k = 0; k < legs.length - 1; k++) {
      const a = legs[k] + (k === 0 ? 24 : 18), b = legs[k + 1] - 35, len = b - a;
      if (len < 12) continue;
      if (feature++ % 2 === 0 || len < 30) {
        // rollers: bumps you pump (or catch a little air off)
        const nb = Math.max(2, Math.min(4, Math.floor(len / 10))), w = len / nb;
        add(a, (s) => s > 0 && s < len ? 0.6 * Math.sin(Math.PI * (s % w) / w) ** 2 : 0);
      } else {
        // table-top: a gentle kicker up, a long flat table, then a long landing back down to the slope
        const kick = 8, table = Math.min(12, len - 20), land = 10, H = 1.0;
        const st = a + (len - (kick + table + land)) / 2;
        add(st, (s) => s < 0 ? 0 : s < kick ? H * (s / kick) ** 1.3 : s < kick + table ? H : s < kick + table + land ? H * (1 - smoothstep(0, land, s - kick - table)) : 0);
      }
    }
    this.feat = feat;
    // berms: how big the bank is at each point (outside of the turn), smoothed in and out
    const bank = new Float32Array(n);
    for (let i = 0; i < n; i++) bank[i] = Math.min(1, Math.abs(this.kap[i]) / 0.025) * 3.6;
    this.bank = blur(blur(bank, 20), 20);
    this._buildRaster();
  }

  // ---- (x, z) -> course coordinates ----
  _buildRaster() {
    const R = SBX.hw + SBX.blend + 3, C = 1;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < this.n; i++) { x0 = Math.min(x0, this.px[i]); x1 = Math.max(x1, this.px[i]); z0 = Math.min(z0, this.pz[i]); z1 = Math.max(z1, this.pz[i]); }
    x0 -= R + 12; x1 += R + 12; z0 -= R + 12; z1 += R + 12;
    const W = Math.ceil((x1 - x0) / C) + 1, H = Math.ceil((z1 - z0) / C) + 1;
    const best = new Int32Array(W * H).fill(-1), dist = new Float32Array(W * H).fill(1e9);
    for (let i = 0; i < this.n; i++) {
      const cx = (this.px[i] - x0) / C, cz = (this.pz[i] - z0) / C, r = Math.ceil(R / C);
      for (let a = Math.max(0, Math.floor(cz - r)); a <= Math.min(H - 1, Math.ceil(cz + r)); a++)
        for (let b = Math.max(0, Math.floor(cx - r)); b <= Math.min(W - 1, Math.ceil(cx + r)); b++) {
          const d = (b - cx) ** 2 + (a - cz) ** 2, q = a * W + b;
          if (d < dist[q]) { dist[q] = d; best[q] = i; }
        }
    }
    // the start of the course extends a little uphill and the finish a little downhill
    this.grid = { x0, z0, W, H, C, best };
  }
  // { s, l } for a point near the course (or null)
  coords(x, z) {
    const G = this.grid, b = Math.floor((x - G.x0) / G.C + 0.5), a = Math.floor((z - G.z0) / G.C + 0.5);
    if (b < 0 || a < 0 || b >= G.W || a >= G.H) return null;
    const i = G.best[a * G.W + b];
    if (i < 0) return null;
    const dx = x - this.px[i], dz = z - this.pz[i];
    return { s: i * SBX.ds + dx * this.tx[i] + dz * this.tz[i], l: -dx * this.tz[i] + dz * this.tx[i], i };
  }
  _at(arr, s) { const f = Math.max(0, Math.min(this.n - 1.001, s / SBX.ds)), i = Math.floor(f); return arr[i] + (arr[i + 1] - arr[i]) * (f - i); }
  point(s, l = 0) {
    const f = Math.max(0, Math.min(this.n - 1, s / SBX.ds)), i = Math.round(f);
    const x = this.px[i] + this.tx[i] * (s - i * SBX.ds) - this.tz[i] * l, z = this.pz[i] + this.tz[i] * (s - i * SBX.ds) + this.tx[i] * l;
    return new THREE.Vector3(x, this.T.heightAt(x, z), z);
  }
  dirAt(s) { const i = Math.round(Math.max(0, Math.min(this.n - 1, s / SBX.ds))); return { x: this.tx[i], z: this.tz[i] }; }
  // height of the course surface at (s, l)
  surface(s, l) {
    const hw = SBX.hw, kap = this._at(this.kap, s);
    let h = this._at(this.base, s) + this._at(this.feat, s) + this._at(this.tilt, s) * l;
    const out = l * Math.sign(kap || 1);             // + = outside of the turn (l is + to the right)
    h += this._at(this.bank, s) * smoothstep(-0.3 * hw, hw + 1, out) ** 1.5;
    h += 0.5 * smoothstep(hw - 1.6, hw + 0.6, Math.abs(l));     // a soft lip along both edges keeps you on course
    h += 1.2 * Math.min(1, this._at(this.bank, s) / 2) * smoothstep(hw - 1, hw + 1.5, out);   // and a taller wall on the outside of each turn
    return h;
  }
  // { s, l, h, k } where the course shapes the snow (k = 1 on the course, fading to 0 at the blend edge)
  weight(x, z) {
    const c = this.coords(x, z);
    if (!c) return null;
    const { s, l } = c, al = Math.abs(l), hw = SBX.hw;
    if (al > hw + 1 + SBX.blend || s < -8 || s > this.L + 6) return null;
    const k = (1 - smoothstep(hw + 1, hw + 1 + SBX.blend, al)) * smoothstep(-8, 0, s) * (1 - smoothstep(this.L - 6, this.L + 6, s));
    if (k <= 0) return null;
    return { s, l, h: this.surface(Math.max(0, Math.min(this.L, s)), l), k };
  }
  near(x, z, m = 0) { const c = this.coords(x, z); return !!c && c.s > -10 - m && c.s < this.L + 8 + m && Math.abs(c.l) < SBX.hw + SBX.blend + 2 + m; }
  onCourse(x, z) { const c = this.coords(x, z); return c && Math.abs(c.l) < SBX.hw + 4 ? c : null; }

  // lane start spots in the gate
  lane(i) {
    const s = 2, p = this.point(s, SBX.lanes[i]), d = this.dirAt(s);
    return { pos: p, yaw: Math.atan2(d.x, -d.z) };
  }
}

// ---- the course's look: surface with dye lines, flags, start gate and finish arch ----
SbxCourse.prototype.buildArt = function (scene) {
  const T = this.T, hw = SBX.hw, edge = hw + 1 + SBX.blend;
  const along = []; for (let s = -8; s <= this.L + 6; s += 0.75) along.push(s);
  const across = []; for (let l = -edge; l <= edge + 0.01; l += 0.75) across.push(l);
  const pos = [], col = [], uv = [], idx = [];
  for (const s of along) {
    const i = Math.round(Math.max(0, Math.min(this.n - 1, s / SBX.ds))), off = s - i * SBX.ds;
    for (const l of across) {
      const x = this.px[i] + this.tx[i] * off - this.tz[i] * l, z = this.pz[i] + this.tz[i] * off + this.tx[i] * l;
      const w = this.weight(x, z), ground = T.meshHeight(x, z);
      const k = w ? w.k : 0, h = w ? ground + (w.h - ground) * k : ground;
      pos.push(x, h + 0.05 * k, z); uv.push(l / 1.6, s / 1.6);      // corduroy runs down the course
      let c = [0.9, 0.915, 0.945];                                 // packed, groomed snow
      const al = Math.abs(l);
      if (Math.abs(al - hw) < 0.22 && s > 0 && s < this.finishS + 5) c = [0.16, 0.39, 0.85];                 // blue dye along the edges
      if (s > 0 && s < 5 && al < hw && SBX.lanes.some(q => Math.abs(Math.abs(l - q) - 1) < 0.06)) c = [0.7, 0.75, 0.85];   // lane lines
      if (Math.abs(s - this.finishS) < 0.4 && al < hw) c = [0.85, 0.15, 0.15];                               // finish line
      col.push(...c.map(v => v * (0.78 + 0.22 * k)));
    }
  }
  const nA = across.length;
  for (let a = 0; a < along.length - 1; a++) for (let b = 0; b < nA - 1; b++) { const q = a * nA + b; idx.push(q, q + 1, q + nA, q + 1, q + nA + 1, q + nA); }   // facing up
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx); geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, normalMap: corduroy(), normalScale: new THREE.Vector2(0.28, 0.28), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const mesh = new THREE.Mesh(geo, mat); mesh.receiveShadow = true; scene.add(mesh);
  this.mesh = mesh;

  // flag panels along both edges, alternating orange and blue (like a real SBX course)
  const nF = Math.floor(this.finishS / 16) * 2;
  const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.03, 0.03, 1.6, 5), new THREE.MeshStandardMaterial({ color: 0xeeeeee }), nF);
  const panel = new THREE.PlaneGeometry(0.9, 0.7);
  const orange = new THREE.InstancedMesh(panel, new THREE.MeshStandardMaterial({ color: 0xff7a1a, side: THREE.DoubleSide }), nF);
  const blue = new THREE.InstancedMesh(panel, new THREE.MeshStandardMaterial({ color: 0x2a64c8, side: THREE.DoubleSide }), nF);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), UP = new THREE.Vector3(0, 1, 0);
  let ip = 0, io = 0, ib = 0;
  for (let s = 14, k = 0; s < this.finishS - 4; s += 16, k++) for (const side of [-1, 1]) {
    const p = this.point(s, side * (hw + 1.4)), d = this.dirAt(s);
    m.compose(new THREE.Vector3(p.x, p.y + 0.8, p.z), new THREE.Quaternion(), one); pole.setMatrixAt(ip++, m);
    q.setFromAxisAngle(UP, Math.atan2(d.x, d.z));
    m.compose(new THREE.Vector3(p.x, p.y + 1.2, p.z), q, one);
    if ((k + (side > 0 ? 1 : 0)) % 2) orange.setMatrixAt(io++, m); else blue.setMatrixAt(ib++, m);
  }
  pole.count = ip; orange.count = io; blue.count = ib;
  for (const im of [pole, orange, blue]) { im.castShadow = true; im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); scene.add(im); }

  // start house: a deck, a gate in front of each lane (they drop at the start), a banner overhead
  const steel = new THREE.MeshStandardMaterial({ color: 0x3a3f48, roughness: 0.5, metalness: 0.4 });
  const yellow = new THREE.MeshStandardMaterial({ color: 0xffd23a, roughness: 0.5 });
  const d0 = this.dirAt(2), yaw = Math.atan2(d0.x, d0.z);
  this.gates = [];
  for (const l of SBX.lanes) {
    const p = this.point(3.2, l), g = new THREE.Group();
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 0.08), yellow); bar.position.y = 0.25; g.add(bar);
    g.position.copy(p); g.rotation.y = yaw; scene.add(g);
    this.gates.push(g);
  }
  for (const side of [-1, 1]) {
    const p = this.point(1, side * (hw + 0.6));
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 5.5, 0.4), steel); post.position.set(p.x, p.y + 2.75, p.z); post.castShadow = true; scene.add(post);
  }
  const top = this.point(1, 0);
  scene.add(banner('🏂 SNOWBOARD CROSS 🏂', '#d63030', top, yaw, hw * 2 + 1.2, 5.2));
  // finish arch
  const fin = this.point(this.finishS, 0), df = this.dirAt(this.finishS), fyaw = Math.atan2(df.x, df.z);
  for (const side of [-1, 1]) {
    const p = this.point(this.finishS, side * (hw + 0.6));
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 5.5, 0.4), steel); post.position.set(p.x, p.y + 2.75, p.z); post.castShadow = true; scene.add(post);
  }
  scene.add(banner('FINISH', '#163566', fin, fyaw, hw * 2 + 1.2, 5.2));
};

// drop / raise the start gates (t: 0 = up, 1 = flat on the snow)
SbxCourse.prototype.setGates = function (t) { for (const g of this.gates || []) g.children[0].rotation.x = -Math.PI / 2 * t, g.children[0].position.set(0, 0.25 - 0.22 * t, -0.25 * t); };

// groomer corduroy: fine ridges running along the course (one tile = 2 m, 8 ridges)
function corduroy() {
  const S = 64, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const ph = (x / S) * 12 * Math.PI * 2, slope = Math.cos(ph) * 0.9 + Math.sin(y * 0.9 + x * 0.3) * 0.04;
    const nx = -slope, nz = 1, l = Math.hypot(nx, nz), k = (y * S + x) * 4;
    img.data[k] = (nx / l * 0.5 + 0.5) * 255; img.data[k + 1] = 128; img.data[k + 2] = (nz / l * 0.5 + 0.5) * 255; img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}

function banner(text, color, at, yaw, width, y) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 128;
  const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, 1024, 128);
  g.fillStyle = '#fff'; g.font = 'bold 70px Trebuchet MS, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 512, 68);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const b = new THREE.Mesh(new THREE.BoxGeometry(width, 1.3, 0.15), new THREE.MeshStandardMaterial({ map: tex }));
  b.position.set(at.x, at.y + y, at.z); b.rotation.y = yaw + Math.PI; b.castShadow = true;
  return b;
}

function blur(a, r) {
  const n = a.length, out = new Float32Array(n);
  let sum = 0, cnt = 0;
  for (let i = -r; i < n + r; i++) {
    const add = i + r, rem = i - r - 1;
    if (add >= 0 && add < n) { sum += a[add]; cnt++; }
    if (rem >= 0 && rem < n) { sum -= a[rem]; cnt--; }
    if (i >= 0 && i < n) out[i] = sum / cnt;
  }
  return out;
}
